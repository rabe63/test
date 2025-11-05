<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, getCurrentInstance } from 'vue'
import * as echarts from 'echarts'
import PlotSelect from './PlotSelect.vue'
import { plotsData } from './data/treeSpeciesData.js'

// Supabase aus globalProperties
const instance = getCurrentInstance()
const supabase = instance.appContext.config.globalProperties.$supabase

// disable-Liste: Plots, die in der Auswahl deaktiviert angezeigt werden sollen
const DISABLED_PLOTS = new Set(['1201','1206'])

// Plots für die Auswahl, mit disabled-Flag
const plotsForSelect = computed(() => {
  return Object.fromEntries(
    Object.entries(plotsData || {}).map(([k, v]) => [
      k,
      { ...(v || {}), code: v?.code ?? k, disabled: DISABLED_PLOTS.has(String(k)) }
    ])
  )
})

// Zustand
const selectedPlots = ref(['1203'])         // Mehrfachauswahl möglich (wir begrenzen auf max 2)
const selectionOrder = ref(['1203'])        // merkt sich die Reihenfolge (ältestes zuerst)
const windowDays = ref(14)                  // Gleitendes Minimum (Tage)
const errorMessage = ref('')
const isLoading = ref(false)
let adjustingSelection = false              // Reentrancy-Guard für Watcher

// Robust-Parameter
const TRIM_PCT = 0.2            // Trimmed Mean: 20% je Seite
const MIN_COHORT = 2            // mindestens 2 Bäume für Aggregation
const COVERAGE_THRESHOLD = 0.9   // Baum muss >=90% der Tage im Fenster liefern
const JUMP_ABS = 0.6            // mm: Sprung-Detektor am Datenende
const JUMP_LOOKBACK = 30         // Tage vom Ende, in denen wir Sprünge detektieren
const JUMP_CONSEC = 1            // Anzahl aufeinanderfolgender Sprungtage (1 genügt)

// Daten
const rawRows = ref([])                        // rohe DB-Zeilen
const perPlotTreeDaily = ref(new Map())        // Map<plot, Map<tree, Array<{date, dmin, davg}>>>
const perTreeSeries = ref(new Map())           // Map<plot, Map<tree, {baseline: [ts,val][], elastic:[ts,val][]}>>
const aggregatedByPlot = ref(new Map())        // Map<plot, {baseline:[ts,val][], elastic:[ts,val][], cohort:number[] }>

// Chart
let myChart = null
const chartEl = ref(null)
const chartHeight = ref(520)

// Layout (zu grid passend)
const GRID_LEFT = 64
const GRID_RIGHT = 40

// Farben
const PALETTE = ['#0072B2','#E69F00','#009E73','#D55E00','#CC79A7','#56B4E9','#F0E442','#2C3E50','#1ABC9C','#3D5B2D','#E91E63']
function colorForPlot(code, idx){ return PALETTE[idx % PALETTE.length] }
function withAlpha(hex, a=0.28){
  const h = String(hex || '').replace('#','')
  if (h.length < 6) return `rgba(0,0,0,${a})`
  const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16)
  return `rgba(${r},${g},${b},${a})`
}

// Sichtbare Plots
function normalizePlotCode(c){ return String(c) }
function getVisiblePlots() {
  const arr = Array.isArray(selectedPlots.value) ? selectedPlots.value : (selectedPlots.value ? [selectedPlots.value] : [])
  const uniq = Array.from(new Set(arr.map(normalizePlotCode)))
  return uniq.map((code, i) => ({
    code: String(code),
    name: plotsData?.[String(code)]?.name || '',
    color: colorForPlot(code, i)
  }))
}

const chartTitle = computed(()=> 'Wachstum vs. Wasserstatus')

// Hilfsfunktionen
function mean(xs){ if(!xs.length) return NaN; return xs.reduce((a,b)=>a+b,0)/xs.length }
function trimmedMean(values, trimPct = TRIM_PCT) {
  const xs = values.filter(Number.isFinite).slice().sort((a,b)=>a-b)
  const n = xs.length
  if (n === 0) return NaN
  const k = Math.min(Math.floor(n * trimPct), Math.floor((n-1)/2))
  const slice = xs.slice(k, n - k)
  return mean(slice.length ? slice : xs)
}

// Rolling-Minimum (gleitendes Minimum) mit Deque O(n)
function rollingMin(values, window) {
  const n = values.length
  if (n === 0 || window <= 1) return values.slice()
  const res = new Array(n)
  const dq = [] // speichert Indizes, deren values monoton steigend
  for (let i=0; i<n; i++) {
    while (dq.length && dq[0] < i - window + 1) dq.shift()
    while (dq.length && values[dq[dq.length-1]] >= values[i]) dq.pop()
    dq.push(i)
    res[i] = values[dq[0]]
  }
  return res
}

// Sprung am Ende erkennen und abschneiden
function clipEndJumps(values, jumpAbs = JUMP_ABS, lookBack = JUMP_LOOKBACK, consecutive = JUMP_CONSEC) {
  const n = values.length
  if (n < 3) return n
  const start = Math.max(1, n - lookBack)
  let run = 0
  for (let i = n - 1; i >= start; i--) {
    const prev = values[i - 1]
    const cur = values[i]
    if (!Number.isFinite(prev) || !Number.isFinite(cur)) { run = 0; continue }
    const diff = Math.abs(cur - prev)
    if (diff > jumpAbs) {
      run++
      if (run >= consecutive) {
        return i
      }
    } else {
      run = 0
    }
  }
  return n
}

// Daten laden
async function fetchData() {
  errorMessage.value = ''
  rawRows.value = []
  perPlotTreeDaily.value = new Map()
  perTreeSeries.value = new Map()
  aggregatedByPlot.value = new Map()

  const plots = getVisiblePlots().map(p => p.code)
  if (!plots.length) return
  try {
    isLoading.value = true
    const { data, error } = await supabase
      .schema('public')
      .from('mv_dendro')
      .select('code_plot,tree_number,date_assessment,dendro_kind,d_min,d_avg')
      .eq('dendro_kind','dendro_log')
      .in('code_plot', plots)
      .gt('date_assessment', '2012-01-01')
      .order('date_assessment', { ascending: true })
    if (error) throw error

    // Rohfilter inkl. Sonderfall 1101 (erst ab 2014-01-01)
    const cutoff1101 = +new Date('2014-01-01T00:00:00Z')
    rawRows.value = (data || []).filter(r => {
      if (!r || r.code_plot == null || !r.date_assessment) return false
      const ts = +new Date(String(r.date_assessment) + 'T00:00:00Z')
      if (String(r.code_plot) === '1101' && ts < cutoff1101) return false
      const tnum = Number(r.tree_number)
      const dmin = Number(r.d_min)
      const davg = Number(r.d_avg)
      return Number.isFinite(tnum) && Number.isFinite(dmin) && Number.isFinite(davg)
    })

    // Map: plot -> tree -> daily array
    const mp = new Map()
    for (const r of rawRows.value) {
      const p = String(r.code_plot)
      const t = Number(r.tree_number)
      const dateStr = String(r.date_assessment) // 'YYYY-MM-DD'
      const d = new Date(dateStr + 'T00:00:00Z')
      if (!mp.has(p)) mp.set(p, new Map())
      const mt = mp.get(p)
      if (!mt.has(t)) mt.set(t, [])
      mt.get(t).push({ date: d, dmin: Number(r.d_min), davg: Number(r.d_avg) })
    }
    // sortieren + Endsprünge je Baum clippen
    for (const [, mt] of mp.entries()) {
      for (const [tree, arr] of mt.entries()) {
        arr.sort((a,b)=> a.date - b.date)
        const valsAvg = arr.map(x=>x.davg)
        const valsMin = arr.map(x=>x.dmin)
        const cut1 = clipEndJumps(valsAvg)
        const cut2 = clipEndJumps(valsMin)
        const cut = Math.min(cut1, cut2)
        if (cut < arr.length) arr.splice(cut)
      }
    }
    perPlotTreeDaily.value = mp

    // Per-Baum dekomponieren
    computePerTreeSeries()
    // Initiale Aggregation (aktueller Zoom oder Vollbereich)
    updateAggregatesForCurrentZoom()
  } catch (e) {
    console.error('[fetchData] error', e)
    errorMessage.value = 'Fehler beim Laden der Daten: ' + (e?.message || e)
  } finally { isLoading.value = false }
}

// Per-Baum: Baseline/Elastik berechnen
function computePerTreeSeries() {
  const win = Math.max(1, Math.floor(windowDays.value || 7))
  const resPlot = new Map()
  for (const [plot, mt] of perPlotTreeDaily.value.entries()) {
    const resTrees = new Map()
    for (const [tree, arr] of mt.entries()) {
      if (!arr.length) continue
      const valsMin = arr.map(d => d.dmin)
      const rollMin = rollingMin(valsMin, win)
      const baselineVals = new Array(rollMin.length)
      for (let i=0; i<rollMin.length; i++) {
        baselineVals[i] = i === 0 ? rollMin[i] : Math.max(baselineVals[i-1], rollMin[i])
      }
      const elasticVals = arr.map((d, i) => d.davg - baselineVals[i])
      const baseline = arr.map((d,i) => [d.date, Number.isFinite(baselineVals[i]) ? baselineVals[i] : null])
      const elastic  = arr.map((d,i) => [d.date, Number.isFinite(elasticVals[i])  ? elasticVals[i]  : null])
      resTrees.set(tree, { baseline, elastic })
    }
    resPlot.set(plot, resTrees)
  }
  perTreeSeries.value = resPlot
}

// Globaler Zeitbereich (über sichtbare Plots)
function getGlobalTimeExtent() {
  let minT = Number.POSITIVE_INFINITY
  let maxT = Number.NEGATIVE_INFINITY
  for (const p of getVisiblePlots()) {
    const trees = perTreeSeries.value.get(String(p.code))
    if (!trees) continue
    for (const [, series] of trees.entries()) {
      for (const pt of series.baseline) {
        const t = +new Date(pt[0])
        if (Number.isFinite(t)) { if (t < minT) minT = t; if (t > maxT) maxT = t }
      }
    }
  }
  if (!Number.isFinite(minT) || !Number.isFinite(maxT)) return null
  return { min: minT, max: maxT }
}

// Aktuelles dataZoom-Fenster (Zeit) als [start,end] in ms
function getZoomRangeMs() {
  if (!myChart) return null
  const opt = myChart.getOption()
  const dzArr = Array.isArray(opt?.dataZoom) ? opt.dataZoom : []
  const ext = getGlobalTimeExtent()
  if (!ext) return null
  let startPct = 0, endPct = 100
  for (const z of dzArr) {
    if (typeof z?.start === 'number') startPct = z.start
    if (typeof z?.end === 'number') endPct = z.end
    if (z?.startValue != null || z?.endValue != null) {
      const sVal = z.startValue != null ? +new Date(z.startValue) : null
      const eVal = z.endValue   != null ? +new Date(z.endValue)   : null
      if (Number.isFinite(sVal) && Number.isFinite(eVal)) return { start: sVal, end: eVal }
    }
  }
  const span = ext.max - ext.min
  const start = ext.min + (startPct/100) * span
  const end   = ext.min + (endPct/100) * span
  return { start, end }
}

// Aggregation pro Plot im aktuellen Zoomfenster
function updateAggregatesForCurrentZoom() {
  const zr = getZoomRangeMs()
  const res = new Map()
  for (const p of getVisiblePlots()) {
    const plot = String(p.code)
    const trees = perTreeSeries.value.get(plot)
    if (!trees) continue

    // Fensterbezogene Zeitreihen je Baum als Map<dateISO, value>
    const treeMaps = []
    let unionDates = new Set()
    for (const [tree, s] of trees.entries()) {
      const baseMap = new Map()
      const elaMap  = new Map()
      for (const [t, v] of s.baseline) {
        const tm = +new Date(t)
        if (!zr || (tm >= zr.start && tm <= zr.end)) {
          const iso = new Date(t).toISOString().slice(0,10)
          baseMap.set(iso, v)
          unionDates.add(iso)
        }
      }
      for (const [t, v] of s.elastic) {
        const tm = +new Date(t)
        if (!zr || (tm >= zr.start && tm <= zr.end)) {
          const iso = new Date(t).toISOString().slice(0,10)
          elaMap.set(iso, v)
          unionDates.add(iso)
        }
      }
      treeMaps.push({ tree, baseMap, elaMap })
    }

    // Coverage je Baum bestimmen
    const unionCount = unionDates.size || 1
    const cohort = treeMaps
      .map(x => {
        const covSet = new Set([...x.baseMap.keys()].filter(k => x.elaMap.has(k)))
        return { tree: x.tree, baseMap: x.baseMap, elaMap: x.elaMap, coverage: covSet.size / unionCount }
      })
      .filter(x => x.coverage >= COVERAGE_THRESHOLD)

    // Wenn zu wenige Bäume, nimm die Bäume mit bester Coverage bis MIN_COHORT
    if (cohort.length < MIN_COHORT) {
      const sorted = treeMaps
        .map(x => {
          const covSet = new Set([...x.baseMap.keys()].filter(k => x.elaMap.has(k)))
          return { tree: x.tree, baseMap: x.baseMap, elaMap: x.elaMap, coverage: covSet.size / unionCount }
        })
        .sort((a,b)=> b.coverage - a.coverage)
      while (sorted.length && cohort.length < Math.min(MIN_COHORT, sorted.length)) cohort.push(sorted.shift())
    }

    // Schnittmenge der Tage über die Kohorte (konstante Zusammensetzung)
    if (!cohort.length) { res.set(plot, { baseline: [], elastic: [], cohort: [] }); continue }
    let common = null
    for (const c of cohort) {
      const setC = new Set([...c.baseMap.keys()].filter(k => c.elaMap.has(k)))
      common = common ? new Set([...common].filter(k => setC.has(k))) : setC
    }
    const commonDates = [...(common || [])].sort()

    // Pro Tag Trimmed Mean berechnen
    const baseline = []
    const elastic  = []
    for (const iso of commonDates) {
      const baseVals = cohort.map(c => c.baseMap.get(iso)).filter(Number.isFinite)
      const elaVals  = cohort.map(c => c.elaMap.get(iso)).filter(Number.isFinite)
      if (baseVals.length >= 1 && elaVals.length >= 1) {
        const b = trimmedMean(baseVals, TRIM_PCT)
        const e = trimmedMean(elaVals, TRIM_PCT)
        const d = new Date(iso + 'T00:00:00Z')
        baseline.push([d, Number.isFinite(b) ? b : null])
        elastic.push([d, Number.isFinite(e) ? e : null])
      }
    }
    res.set(plot, { baseline, elastic, cohort: cohort.map(c => c.tree) })
  }
  aggregatedByPlot.value = res
}

// Chart
function ensureChart() {
  if (!chartEl.value || myChart) return
  myChart = echarts.init(chartEl.value)
}

// Legende: nur pro Plot ein Eintrag (Baseline), runde Icons
function buildChartOption() {
  const isMobile = (chartEl.value?.clientWidth || 800) < 600
  const series = []
  const legend = []

  const plots = getVisiblePlots()
  plots.forEach((p) => {
    const code = String(p.code)
    const name = p.name
    const color = p.color || colorForPlot(code, 0)
    const agg = aggregatedByPlot.value.get(code)
    if (!agg) return

    // Ein Legendeneintrag je Plot (Baseline-Namen verwenden, Elastik nicht in legend.data)
    const baseName = `${code} ${name}\nBaseline`
    legend.push(baseName)

    // Baseline
    series.push({
      id: `base-${code}`,
      name: baseName,
      type: 'line',
      data: agg.baseline,
      showSymbol: false,
      smooth: 0,
      lineStyle: { color, width: 2 },
      symbol: 'circle',
      emphasis: { focus: 'series' },
      encode: { x: 0, y: 1 }
    })

    // Elastik (nicht in Legendendaten → kein Eintrag)
    series.push({
      id: `elas-${code}`,
      name: `${code} ${name}\nElastik`,
      type: 'line',
      data: agg.elastic,
      showSymbol: false,
      smooth: 0,
      lineStyle: { color: withAlpha(color, 0.6), width: 1.5, type: 'dashed' },
      symbol: 'circle',
      emphasis: { focus: 'series' },
      encode: { x: 0, y: 1 },
      yAxisIndex: 1
    })
  })

  return {
    backgroundColor: 'transparent',
    title: [
      { left: 'left', top: 28, 
        text: 'Irreversibles Wachstum (Baseline) und elastische Komponente (Turgor)', 
        textStyle: { fontSize: 16, fontWeight: 600, color: '#444' } }
    ],
    legend: {
      top: isMobile ? 56 : 60,
      type: 'scroll',
      selectedMode: false,        // Legendentoggles deaktivieren (Plot-Auswahl erfolgt über PlotSelect)
      icon: 'circle',             // rundes Farbicon
      itemWidth: 12,
      itemHeight: 12,
      inactiveColor: '#bbb',
      textStyle: { fontSize: isMobile ? 10 : 12 },
      data: legend
    },
    tooltip: {
      trigger: 'axis',
      confine: true,
      axisPointer: { type: 'cross' },
      formatter: (params) => {
        try {
          const ts = params?.[0]?.value?.[0] ?? params?.[0]?.axisValueLabel
          const dateStr = ts ? new Date(ts).toISOString().slice(0,10) : ''
          const lines = [`<strong>${dateStr}</strong>`]
          for (const it of params) {
            const nm = String(it.seriesName || '')
            const val = Array.isArray(it.value) ? it.value[1] : it.data?.[1]
            lines.push(`${nm}: ${Number.isFinite(Number(val)) ? Number(val).toFixed(3) : ''} mm`)
          }
          return lines.join('<br/>')
        } catch(_){ return '' }
      }
    },
    grid: { left: GRID_LEFT, right: GRID_RIGHT, top: isMobile?96:104, bottom: 72 },
    dataZoom: [
      { type: 'inside' },
      { type: 'slider', bottom: 26, height: isMobile?20:26, brushSelect:false, showDetail: false, showDataShadow: true }
    ],
    xAxis: {
      type: 'time',
      boundaryGap: false,
      axisLabel: { fontSize: isMobile?10:12 }
    },
    yAxis: [
      {
        type: 'value', name: 'Irreversibles Wachstum\nDurchmesser [mm]',
        nameTextStyle: { fontSize:isMobile?10:12, padding:[0,0,0,10] },
        axisLabel: { fontSize: isMobile?10:12, margin: 8 },
        splitLine: { show: true }
      },
      {
        type: 'value', name: 'Turgor\nElastik [mm]',
        nameTextStyle: { fontSize:isMobile?10:12, padding:[0,0,0,0] },
        axisLabel: { fontSize: isMobile?10:12, margin: 8 },
        splitLine: { show: false }
      }
    ],
    series,
    animation: false,
    animationDurationUpdate: 0
  }
}

function renderChart() {
  if (!myChart) return
  const opt = buildChartOption()
  myChart.setOption(opt, true, false)
  wireZoomHandler()
  // Nach Neu-Render direkt auf vollen Bereich zoomen (v2-Verhalten)
  resetZoomToFullExtent()
}

// Nur die Series-Daten aktualisieren (z. B. nach dataZoom)
function applySeriesUpdates() {
  if (!myChart) return
  const updates = []
  for (const p of getVisiblePlots()) {
    const code = String(p.code)
    const agg = aggregatedByPlot.value.get(code)
    if (!agg) continue
    updates.push({ id: `base-${code}`, data: agg.baseline })
    updates.push({ id: `elas-${code}`, data: agg.elastic })
  }
  if (updates.length) myChart.setOption({ series: updates }, false, true)
}

// Größten verfügbaren Zeitraum setzen (wie v2)
function resetZoomToFullExtent() {
  if (!myChart) return
  const ext = getGlobalTimeExtent()
  if (!ext) return
  try {
    myChart.dispatchAction({ type: 'dataZoom', startValue: new Date(ext.min), endValue: new Date(ext.max) })
    updateAggregatesForCurrentZoom()
    applySeriesUpdates()
  } catch (e) { console.error('resetZoomToFullExtent failed', e) }
}

// Expliziter Reset-Button
function resetZoom() {
  resetZoomToFullExtent()
}

// CSV/PNG
function downloadName(ext){
  if(ext==='header'){
    const visible = getVisiblePlots().map(p=>`${p.code} ${p.name}`).join(', ')
    const created = new Date().toISOString().replace('T',' ').substring(0,19)
    return [
      '# Wachstum vs. Wasserstatus der Loggerbäume je Bestandsfläche',
      `# Plots:\t${visible}`,
      `# Erstellt:\t${created} UTC`,
      '# Quelle:\tICP Forest Data des Landesbetrieb Forst Brandenburg',
      '# Link:\t\thttps://forstliche-umweltkontrolle.de/dauerbeobachtung/level-ii/'
    ].join('\n')
  }
  const ts = new Date().toISOString().substring(0,19).replace(/[:]/g,'-')
  return `wasserstatus_${ts}.${ext}`
}
function fmtCsv(x){ const n=Number(x); return Number.isFinite(n) ? n.toFixed(3) : '' }

function generateCSV() {
  const plots = getVisiblePlots()
  if (!plots.length) return ''
  const csv = []
  csv.push(downloadName('header'))
  csv.push('')
  csv.push('date,plotcode,plotname,baseline_mm,elastic_mm,cohort_trees')

  for (const p of plots) {
    const code = String(p.code)
    const name = p.name
    const agg = aggregatedByPlot.value.get(code)
    if (!agg) continue
    const len = Math.max(agg.baseline.length, agg.elastic.length)
    const cohortStr = (agg.cohort || []).join(';')
    for (let i=0; i<len; i++) {
      const t = agg.baseline[i]?.[0] ?? agg.elastic[i]?.[0]
      const tStr = t ? new Date(t).toISOString().slice(0,10) : ''
      const base = agg.baseline[i]?.[1]
      const ela  = agg.elastic[i]?.[1]
      csv.push([tStr, `"${code}"`, `"${name}"`, fmtCsv(base), fmtCsv(ela), `"${cohortStr}"`].join(','))
    }
  }
  return csv.join('\n')
}
function downloadCSV(){
  const csv=generateCSV()
  if(!csv){ errorMessage.value='Keine Daten zum Download verfügbar'; return }
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'})
  const a=document.createElement('a'); const url=URL.createObjectURL(blob)
  a.href=url; a.download=downloadName('csv'); document.body.appendChild(a)
  a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
}
function downloadChartPNG() {
  if (!myChart) return
  try {
    const dataURL = myChart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' })
    const a = document.createElement('a')
    a.href = dataURL
    a.download = downloadName('png')
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  } catch (e) { console.error('PNG download error:', e) }
}

// dataZoom-Handler: dynamische Kohorte + Trimmed Mean
function wireZoomHandler() {
  if (!myChart) return
  myChart.off('dataZoom')
  myChart.on('dataZoom', () => {
    try {
      updateAggregatesForCurrentZoom()
      applySeriesUpdates()
    } catch (e) {
      console.error('[dataZoom] update failed', e)
    }
  })
}

// Auswahl auf max 2 Plots begrenzen, älteste fliegt raus
function enforceMaxTwo(newVal, oldVal) {
  if (adjustingSelection) return
  const newArr = Array.isArray(newVal) ? newVal.map(String) : (newVal ? [String(newVal)] : [])
  const oldArr = Array.isArray(oldVal) ? oldVal.map(String) : (oldVal ? [String(oldVal)] : [])

  // entfernte Plots aus der Order entfernen
  for (const code of oldArr) {
    if (!newArr.includes(code)) {
      selectionOrder.value = selectionOrder.value.filter(c => c !== code)
    }
  }
  // hinzugefügte Plots hinten anhängen
  for (const code of newArr) {
    if (!selectionOrder.value.includes(code)) {
      selectionOrder.value.push(code)
    }
  }
  // wenn mehr als 2, halte die zwei letzten
  if (newArr.length > 2) {
    const limited = selectionOrder.value.slice(-2)
    adjustingSelection = true
    selectedPlots.value = limited
    selectionOrder.value = limited.slice()
    adjustingSelection = false
  }
}

// Reaktionen
watch(selectedPlots, async (nv, ov) => {
  enforceMaxTwo(nv, ov)
  if (adjustingSelection) return
  await fetchData()
  await nextTick(); ensureChart(); renderChart()
  // Nach Plotwechsel immer auf vollen Zeitraum
  resetZoomToFullExtent()
})
watch(windowDays, () => {
  // Per-Baum neu dekomponieren, Aggregation nach aktuellem Zoom neu berechnen
  computePerTreeSeries()
  // Bei Parameterwechsel: auf vollen Zeitraum zurücksetzen
  resetZoomToFullExtent()
  nextTick(() => { ensureChart(); applySeriesUpdates() })
})

// Lifecycle
onMounted(async () => {
  // initiale Order synchronisieren
  selectionOrder.value = Array.isArray(selectedPlots.value) ? selectedPlots.value.map(String) : (selectedPlots.value ? [String(selectedPlots.value)] : [])
  await nextTick(); ensureChart()
  await fetchData()
  await nextTick(); renderChart()
})
onBeforeUnmount(() => {
  if (myChart) { myChart.dispose(); myChart=null }
})
</script>

<template>
  <div class="page">
    <!-- Card 1: Bestandsflächen (Mehrfachauswahl, intern max 2) -->
    <PlotSelect
      v-model="selectedPlots"
      :plots="plotsForSelect"
      :multiple="true"
      :columns="5"
      color="green-darken-2"
      class="mb-3"
    />

    <!-- Card 2: Chart -->
    <v-card elevation="1" class="mb-3 soft-card">
      <v-toolbar density="comfortable" color="transparent" flat>
        <div class="toolbar-left">
          <h2 class="chart-title">Wachstum vs. Wasserstatus</h2>
        </div>
    
        <div class="toolbar-right">
          <v-btn size="small" variant="elevated tonal" color="secondary"
                 class="mr-2" @click="resetZoom" title="Zoom zurücksetzen">
            <v-icon start size="16">mdi-refresh</v-icon> Reset
          </v-btn>
          <v-btn size="small" variant="elevated tonal" color="primary"
                 @click="downloadChartPNG" title="Chart als PNG speichern">PNG</v-btn>
          <v-btn size="small" variant="elevated tonal" color="primary"
                 class="ml-2" @click="downloadCSV" title="Daten als CSV exportieren">CSV</v-btn>
        </div>   
      </v-toolbar>

      <div class="slider-row">
        <div class="slider-inner">
          <div class="slider-label">gleitendes Minimum (Baseline):</div>
          <v-slider
            :min="3" :max="30" :step="1"
            hide-details density="compact"
            v-model="windowDays"
            color="green-darken-2"
            style="width:100%;"
          />
          <div class="slider-value">{{ windowDays }} Tage</div>
        </div>
      </div>

      <v-card-text>
        <div class="chart-wrap">
          <div ref="chartEl" :style="{ width: '100%', height: chartHeight + 'px' }" />
          <v-overlay v-model="isLoading" contained class="align-center justify-center">
            <v-progress-circular color="primary" indeterminate size="52" />
          </v-overlay>
          <v-alert v-if="errorMessage" type="error" variant="tonal" class="mt-3" dismissible @click:close="errorMessage = ''">
            {{ errorMessage }}
          </v-alert>
        </div>
      </v-card-text>
    </v-card>
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 12px; }
.soft-card { border: 1px solid rgba(var(--v-theme-primary), 0.22); border-radius: 8px; }
.chart-wrap { position: relative; width: 100%; }
.toolbar-left { display:flex; align-items:center; }
.toolbar-right { margin-left: auto; display:flex; align-items:center; gap:8px; }
.toolbar-actions { margin-left: auto; display: flex; align-items: center; }

/* Titel styling */
.chart-title { margin-left:15px; font-size:1.4rem; font-weight:700; }

/* Slider unterhalb */
.slider-row { display:flex; justify-content:left; padding:8px 16px 0 16px; }
.slider-inner { width:90%; display:flex; align-items:center; gap:10px; }
.slider-label { white-space:nowrap; font-size:1em; color:var(--v-theme-on-surface); }
.slider-value { white-space:nowrap; font-size:1em; margin-left:6px; color:var(--v-theme-on-surface); text-align:right; }
.slider-wrap { display: inline-flex; align-items: center; gap: 6px; }
</style>
