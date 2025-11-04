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

const plotsForSelect = computed(() => {
  return Object.fromEntries(
    Object.entries(plotsData || {}).map(([k, v]) => [
      k,
      { ...(v || {}), code: v?.code ?? k, disabled: DISABLED_PLOTS.has(String(k)) }
    ])
  )
})

// Zustand
const selectedPlots = ref(['1203'])         // Mehrfachauswahl möglich
const windowDays = ref(14)                   // Gleitendes Minimum (Tage) – default 7
const errorMessage = ref('')
const isLoading = ref(false)

// Daten
const rawRows = ref([])                     // rohe DB-Zeilen
const perPlotDaily = ref(new Map())         // Map<string plot> -> Array<{date: Date, dmin: number, davg: number}>
const seriesByPlot = ref(new Map())         // Map<string plot> -> { baseline: Array<[time,value]>, elastic: Array<[time,value]> }

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

// Sichtbare Plots (Codes als String!)
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

// Daten laden
async function fetchData() {
  errorMessage.value = ''
  rawRows.value = []
  perPlotDaily.value = new Map()
  seriesByPlot.value = new Map()

  const plots = getVisiblePlots().map(p => p.code)
  if (!plots.length) return
  try {
    isLoading.value = true
    // mv_dendro: tägliche Aggregation je Baum
    const { data, error } = await supabase
      .schema('public')
      .from('mv_dendro')
      .select('code_plot,tree_number,date_assessment,dendro_kind,d_min,d_avg')
      .eq('dendro_kind','dendro_log')
      .in('code_plot', plots)
      .gt('date_assessment', '2015-12-31')
      .order('date_assessment', { ascending: true })
    if (error) throw error

    rawRows.value = (data || []).filter(r =>
      r && r.code_plot != null && r.date_assessment && Number.isFinite(Number(r.d_min)) && Number.isFinite(Number(r.d_avg))
    )

    // Auf Tagesebene je Plot über Loggerbäume mitteln
    const mpAgg = new Map() // Map plot -> Map dateStr -> { sumMin, sumAvg, cnt }
    for (const r of rawRows.value) {
      const p = String(r.code_plot)
      const dateStr = String(r.date_assessment) // 'YYYY-MM-DD'
      if (!mpAgg.has(p)) mpAgg.set(p, new Map())
      const m = mpAgg.get(p)
      if (!m.has(dateStr)) m.set(dateStr, { sumMin: 0, sumAvg: 0, cnt: 0 })
      const a = m.get(dateStr)
      a.sumMin += Number(r.d_min)
      a.sumAvg += Number(r.d_avg)
      a.cnt += 1
    }

    // In Arrays umwandeln, nach Datum sortiert
    const perPlot = new Map()
    for (const [p, m] of mpAgg.entries()) {
      const arr = []
      for (const [dateStr, a] of m.entries()) {
        if (a.cnt > 0) {
          const d = new Date(dateStr + 'T00:00:00Z') // konsistente Zeit
          arr.push({ date: d, dmin: a.sumMin / a.cnt, davg: a.sumAvg / a.cnt })
        }
      }
      arr.sort((x,y)=> x.date - y.date)
      perPlot.set(p, arr)
    }
    perPlotDaily.value = perPlot

    // Ableiten der Kurven
    computeSeries()
  } catch (e) {
    console.error('[fetchData] error', e)
    errorMessage.value = 'Fehler beim Laden der Daten: ' + (e?.message || e)
  } finally { isLoading.value = false }
}

// Rolling-Minimum (gleitendes Minimum) mit Deque O(n)
function rollingMin(values, window) {
  const n = values.length
  if (n === 0 || window <= 1) return values.slice()
  const res = new Array(n)
  const dq = [] // speichert Indizes, deren values monoton steigend
  for (let i=0; i<n; i++) {
    // Entferne Indizes außerhalb des Fensters [i-window+1, i]
    while (dq.length && dq[0] < i - window + 1) dq.shift()
    // Halte deque aufsteigend (kleinster Wert vorne)
    while (dq.length && values[dq[dq.length-1]] >= values[i]) dq.pop()
    dq.push(i)
    // Minimum ist vorne
    res[i] = values[dq[0]]
  }
  return res
}

// Baseline/Elastik pro Plot berechnen
function computeSeries() {
  const res = new Map()
  const win = Math.max(1, Math.floor(windowDays.value || 7))
  for (const p of getVisiblePlots()) {
    const arr = perPlotDaily.value.get(String(p.code)) || []
    if (!arr.length) continue
    const valsMin = arr.map(d => d.dmin)
    // Gleitendes Minimum
    const rollMin = rollingMin(valsMin, win)
    // Monoton steigende (irreversible) Baseline erzwingen
    const baselineVals = new Array(rollMin.length)
    for (let i=0; i<rollMin.length; i++) {
      baselineVals[i] = i === 0 ? rollMin[i] : Math.max(baselineVals[i-1], rollMin[i])
    }
    // Elastische Komponente
    const elasticVals = arr.map((d, i) => d.davg - baselineVals[i])

    // Als Zeitreihen [ts,value]
    const baseline = arr.map((d,i) => [d.date, Number.isFinite(baselineVals[i]) ? baselineVals[i] : null])
    const elastic  = arr.map((d,i) => [d.date, Number.isFinite(elasticVals[i])  ? elasticVals[i]  : null])

    res.set(String(p.code), { baseline, elastic })
  }
  seriesByPlot.value = res
}

// Chart
function ensureChart() {
  if (!chartEl.value || myChart) return
  myChart = echarts.init(chartEl.value)
}

function buildChartOption() {
  const isMobile = (chartEl.value?.clientWidth || 800) < 600
  const series = []
  const legend = []

  const plots = getVisiblePlots()
  plots.forEach((p) => {
    const code = String(p.code)
    const name = p.name
    const color = p.color || colorForPlot(code, 0)
    const data = seriesByPlot.value.get(code)
    if (!data) return

    // Baseline
    legend.push(`${code} ${name}\nBaseline`)
    series.push({
      id: `base-${code}`,
      name: `${code} ${name}\nBaseline`,
      type: 'line',
      data: data.baseline,
      showSymbol: false,
      smooth: 0, // 0 = keine Glättung
      lineStyle: { color, width: 2 },
      emphasis: { focus: 'series' },
      encode: { x: 0, y: 1 }
    })

    // Elastik
    legend.push(`${code} ${name}\nElastik`)
    series.push({
      id: `elas-${code}`,
      name: `${code} ${name}\nElastik`,
      type: 'line',
      data: data.elastic,
      showSymbol: false,
      smooth: 0,
      lineStyle: { color: withAlpha(color, 0.6), width: 1.5, type: 'dashed' },
      emphasis: { focus: 'series' },
      encode: { x: 0, y: 1 },
      yAxisIndex: 1 // optional: separater Maßstab für Elastik (kleine Werte). Wenn nicht gewünscht, auf 0 setzen und yAxis entfernen.
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
      icon: 'line',
      itemWidth: 22,
      itemHeight: 8,
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
          // Gruppiert nach Plotcode
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
    // yAxis 0: Durchmesser (mm), yAxis 1: Elastik (mm, kleiner Bereich)
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
  csv.push('date,plotcode,plotname,baseline_mm,elastic_mm')

  for (const p of plots) {
    const code = String(p.code)
    const name = p.name
    const s = seriesByPlot.value.get(code)
    if (!s) continue
    // Annahme: baseline und elastic haben gleiche Zeitbasis
    const len = Math.max(s.baseline.length, s.elastic.length)
    for (let i=0; i<len; i++) {
      const t = s.baseline[i]?.[0] ?? s.elastic[i]?.[0]
      const tStr = t ? new Date(t).toISOString().slice(0,10) : ''
      const base = s.baseline[i]?.[1]
      const ela  = s.elastic[i]?.[1]
      csv.push([tStr, `"${code}"`, `"${name}"`, fmtCsv(base), fmtCsv(ela)].join(','))
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

// Reaktionen
watch(selectedPlots, async () => {
  await fetchData()
  await nextTick(); ensureChart(); renderChart()
})
watch(windowDays, () => {
  // Nur Ableitung neu berechnen (keine neuen Daten)
  computeSeries()
  nextTick(() => { ensureChart(); renderChart() })
})

// Lifecycle
onMounted(async () => {
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
    <!-- Card 1: Bestandsflächen (Mehrfachauswahl) -->
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

/* Slider unterhalb: zentriert, 80% Breite */
.slider-row { display:flex; justify-content:left; padding:8px 16px 0 16px; }
.slider-inner { width:90%; display:flex; align-items:center; gap:10px; }
.slider-label { white-space:nowrap; font-size:1em; color:var(--v-theme-on-surface); }
.slider-value { white-space:nowrap; font-size:1em; margin-left:6px; color:var(--v-theme-on-surface); text-align:right; }
.slider-wrap { display: inline-flex; align-items: center; gap: 6px; }
</style>
