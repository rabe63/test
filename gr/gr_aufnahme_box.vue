<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, getCurrentInstance } from 'vue'
import * as echarts from 'echarts'
import PlotSelect from './PlotSelect.vue'
import { plotsData, getSpeciesNameByCode } from './data/treeSpeciesData.js'
import * as BoxLib from './data/boxplot.js'

const instance = getCurrentInstance()
const supabase = instance.appContext.config.globalProperties.$supabase

const props = defineProps({
  dataSchema: { type: String, default: 'icp_download' },
  dataTable:  { type: String, default: 'gr_ipm' },
  themeMode:  { type: String, default: 'auto' }
})

// Zustand
//const selectedPlots = ref(['1203'])
const selectedPlots = ref(Object.keys(plotsData || {}).map(String))
const speciesMode = ref('ALL')  // 'HBA' | 'ALL'
const rawRows = ref([])
const years = ref([])
const perPlotYear = ref(new Map())   // Map<string plot> -> Map<number year> -> { values, box, outliers, n }
const hbaNameByPlot = ref(new Map())
const errorMessage = ref('')
const isLoading = ref(false)

// Chart
let myChart = null
const chartEl = ref(null)
const chartHeight = ref(520)

// Layout (zu grid passend)
const GRID_LEFT = 64
const GRID_RIGHT = 28

// Farben
const PALETTE = ['#0072B2','#E69F00','#009E73','#D55E00','#CC79A7','#56B4E9','#F0E442','#2C3E50','#1ABC9C','#3D5B2D','#E91E63']
function colorForPlot(code, idx){ return PALETTE[idx % PALETTE.length] }
function withAlpha(hex, a=0.28){
  const h = String(hex || '').replace('#','')
  if (h.length < 6) return `rgba(0,0,0,${a})`
  const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16)
  return `rgba(${r},${g},${b},${a})`
}

// Boxplot-Utils
function percentile(sorted, p) {
  if (!sorted.length) return NaN
  const pos = (sorted.length - 1) * p
  const lo = Math.floor(pos), hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}
function computeBoxFallback(values) {
  const xs = (values || []).filter(v => Number.isFinite(v)).slice().sort((a,b)=>a-b)
  const n = xs.length
  if (n === 0) return { box: null, outliers: [], n: 0 }
  const q1 = percentile(xs, 0.25)
  const med= percentile(xs, 0.50)
  const q3 = percentile(xs, 0.75)
  const iqr = q3 - q1
  const lowerFence = q1 - 1.5 * iqr
  const upperFence = q3 + 1.5 * iqr
  const inliers = xs.filter(v => v >= lowerFence && v <= upperFence)
  const outliers = xs.filter(v => v < lowerFence || v > upperFence)
  const whiskerMin = inliers.length ? inliers[0] : xs[0]
  const whiskerMax = inliers.length ? inliers[inliers.length-1] : xs[xs.length-1]
  return { box: [whiskerMin, q1, med, q3, whiskerMax], outliers, n }
}
function computeBox(values) {
  try {
    if (BoxLib?.computeBox) return BoxLib.computeBox(values)
    if (BoxLib?.calcBox)    return BoxLib.calcBox(values)
    if (BoxLib?.fiveNumberSummary) {
      const res = BoxLib.fiveNumberSummary(values) || {}
      const { min, q1, median, q3, max, outliers=[] } = res
      const n = Array.isArray(values) ? values.length : 0
      if ([min,q1,median,q3,max].every(Number.isFinite)) return { box:[min,q1,median,q3,max], outliers, n }
    }
  } catch(_){}
  return computeBoxFallback(values)
}

// Sichtbare Plots (Codes als String!)
function normalizePlotCode(c){ return String(c) }
function getVisiblePlots() {
  const arr = Array.isArray(selectedPlots.value) ? selectedPlots.value : (selectedPlots.value ? [selectedPlots.value] : [])
  const uniq = Array.from(new Set(arr.map(normalizePlotCode)))
  return uniq.map((code, i) => ({
    code: String(code),
    name: plotsData?.[String(code)]?.name || '',
    color: colorForPlot(code, i),
    speciesName: hbaNameByPlot.value.get(String(code)) || ''
  }))
}

const chartTitle = computed(()=>{
  const mode = speciesMode.value === 'HBA' ? 'HBA' : 'alle'
  return `Gesamtbestand (${mode}): Durchmesser (mm)`
})

const MIN_VALID_DIAM = 3

// Daten laden
async function fetchData() {
  errorMessage.value = ''
  rawRows.value = []
  years.value = []
  perPlotYear.value = new Map()
  hbaNameByPlot.value = new Map()

  const plots = getVisiblePlots().map(p => p.code)
  if (!plots.length) return
  try {
    isLoading.value = true
    const { data, error } = await supabase
      .schema(props.dataSchema)
      .from(props.dataTable)
      .select('survey_year,code_plot,code_tree_species,diameter')
      .in('code_plot', plots)
      .not('diameter', 'is', null)
      .order('survey_year', { ascending: true })
    if (error) throw error

    rawRows.value = (data || []).filter(r => {
      const v = Number(r?.diameter)
      return Number.isFinite(v) && v >= MIN_VALID_DIAM
    })

    years.value = Array.from(
      new Set(rawRows.value.map(r => Number(r.survey_year)).filter(Number.isFinite))
    ).sort((a,b)=>a-b)

    // HBA je Plot
    const hbaCodeByPlot = new Map()
    for (const code of plots) {
      let best = plotsData?.[String(code)]?.species?.[0]
      if (best == null) {
        const rowsP = rawRows.value.filter(r => String(r.code_plot) === String(code))
        const counts = new Map()
        for (const r of rowsP) {
          const sp = Number(r.code_tree_species)
          if (!Number.isFinite(sp)) continue
          counts.set(sp, 1 + (counts.get(sp) || 0))
        }
        let bestC = -1
        for (const [sp, c] of counts.entries()) { if (c > bestC) { best = sp; bestC = c } }
      }
      if (best != null) {
        hbaCodeByPlot.set(String(code), Number(best))
        hbaNameByPlot.value.set(String(code), getSpeciesNameByCode(Number(best)))
      }
    }

    // Modus-Filter
    let rowsForCalc = rawRows.value.slice()
    if (speciesMode.value === 'HBA') {
      rowsForCalc = rowsForCalc.filter(r => {
        const plot = String(r.code_plot)
        const hba = hbaCodeByPlot.get(plot)
        if (!Number.isFinite(hba)) return true
        return Number(r.code_tree_species) === Number(hba)
      })
    }

    // Aggregation Plot x Jahr
    const mp = new Map()
    for (const r of rowsForCalc) {
      const p = String(r.code_plot)
      const y = Number(r.survey_year)
      if (!mp.has(p)) mp.set(p, new Map())
      const my = mp.get(p)
      if (!my.has(y)) my.set(y, { values: [] })
      my.get(y).values.push(Number(r.diameter))
    }

    // Box/Outliers
    for (const [p, my] of mp.entries()) {
      for (const [y, bucket] of my.entries()) {
        const { box, outliers, n } = computeBox(bucket.values || [])
        bucket.n = n || (bucket.values?.length || 0)
        bucket.box = (box && box.length === 5 && box.every(Number.isFinite)) ? box : null
        bucket.outliers = Array.isArray(outliers) ? outliers.filter(Number.isFinite) : []
      }
    }

    perPlotYear.value = mp
  } catch (e) {
    console.error('[fetchData] error', e)
    errorMessage.value = 'Fehler beim Laden der Daten: ' + (e?.message || e)
  } finally { isLoading.value = false }
}

// Legendenname → Plotcode (robust)
function codeFromSeriesName(name) {
  const s = String(name ?? '').trim()
  // Erst: führende Plotnummer (3-5 Ziffern) extrahieren
  const m = s.match(/^\s*(\d{3,5})\b/)
  if (m && m[1]) return String(m[1])

  // Fallback: bei Trennzeichen hyphen, en/em dash oder Newline splitten
  const parts = s.split(/[\n\r\-–—]+/)
  return String((parts[0] ?? '').trim())
}

// Hilfsfunktion: aktuelles DataZoom-Fenster (sichtbare Kategorien) bestimmen
function getZoomWindow(opt, cats) {
  const n = cats.length
  let iStart = 0
  let iEnd = n > 0 ? n - 1 : 0

  const dzArr = Array.isArray(opt?.dataZoom) ? opt.dataZoom : []
  for (const z of dzArr) {
    // Prozentbasierte Angaben haben Priorität
    if (typeof z?.start === 'number' && typeof z?.end === 'number') {
      const s = Math.max(0, Math.min(100, z.start))
      const e = Math.max(0, Math.min(100, z.end))
      iStart = Math.round((s / 100) * Math.max(0, n - 1))
      iEnd   = Math.round((e / 100) * Math.max(0, n - 1))
      continue
    }
    // startValue/endValue (können Index oder Wert sein)
    let sIdx = iStart
    let eIdx = iEnd
    if (z?.startValue != null) {
      const sv = z.startValue
      if (typeof sv === 'number') sIdx = Math.max(0, Math.min(n - 1, sv))
      else {
        const pos = cats.indexOf(String(sv))
        if (pos >= 0) sIdx = pos
      }
    }
    if (z?.endValue != null) {
      const ev = z.endValue
      if (typeof ev === 'number') eIdx = Math.max(0, Math.min(n - 1, ev))
      else {
        const pos = cats.indexOf(String(ev))
        if (pos >= 0) eIdx = pos
      }
    }
    iStart = Math.min(iStart, sIdx)
    iEnd   = Math.max(iEnd, eIdx)
  }

  if (iEnd < iStart) [iStart, iEnd] = [iEnd, iStart]
  const visibleCount = Math.max(1, iEnd - iStart + 1)
  return { iStart, iEnd, visibleCount }
}

// DataZoom-bewusste Offsets berechnen (KEIN setOption hier!)
function computeOutlierOffsetUpdates() {
  if (!myChart || !chartEl.value) return []
  const opt = myChart.getOption()
  const legendData = (opt?.legend?.[0]?.data || [])
  const selectedMap = (opt?.legend?.[0]?.selected) || {}
  const activeNames = legendData.filter(n => selectedMap[n] !== false)
  const total = Math.max(1, activeNames.length)

  const cats = (opt?.xAxis?.[0]?.data || [])
  if (!cats.length) return []

  // existierende Outlier-Serien ermitteln
  const existingOutIds = new Set(
    (opt?.series || [])
      .map(s => s?.id)
      .filter(id => typeof id === 'string' && id.startsWith('out-'))
  )

  // Sichtbares Fenster und Bandbreite je sichtbarer Kategorie
  const { visibleCount } = getZoomWindow(opt, cats)
  const plotWidth = Math.max(8, (chartEl.value?.clientWidth || 800) - GRID_LEFT - GRID_RIGHT)
  const bandPx = Math.max(8, plotWidth / Math.max(1, visibleCount))
  const centerIdx = (total - 1) / 2
  const coef = 0.85

  const updates = []
  for (const name of activeNames) {
    const code = codeFromSeriesName(name)
    const outId = `out-${String(code)}`
    if (!existingOutIds.has(outId)) continue
    const ordIdx = activeNames.findIndex(n => n === name)
    const dx = bandPx * ((ordIdx - centerIdx) / total) * coef
    updates.push({ id: outId, symbolOffset: [dx, 0] })
  }
  return updates
}

// setOption strikt außerhalb des Renderzyklus anwenden
let offsetTimer = 0
function scheduleApplyOutlierOffsets() {
  if (!myChart) return
  clearTimeout(offsetTimer)
  offsetTimer = setTimeout(() => {
    try {
      const updates = computeOutlierOffsetUpdates()
      if (updates.length) myChart.setOption({ series: updates }, false, true)
    } catch (e) {
      // optionales Debug:
      // console.error('[scheduleApplyOutlierOffsets] setOption failed', e)
    }
  }, 0)
}

// Event-Handler für Offsets
function wireLegendAndZoomHandlers() {
  if (!myChart) return
  myChart.off('legendselectchanged')
  myChart.on('legendselectchanged', () => scheduleApplyOutlierOffsets())

  myChart.off('dataZoom')
  myChart.on('dataZoom', () => scheduleApplyOutlierOffsets())
}

function getBucket(seriesName, yearStr) {
  const code = codeFromSeriesName(seriesName)
  const y = Number(yearStr)
  return perPlotYear.value.get(String(code))?.get(y)
}

// Chart
function ensureChart() {
  if (!chartEl.value || myChart) return
  myChart = echarts.init(chartEl.value)
}

const DRAW_MIN_BOXES = 3

function buildChartSeries() {
  const catYears = (years.value || []).map(String)
  const visible = getVisiblePlots()

  const series = []
  const legend = []

  visible.forEach((p) => {
    const code = String(p.code)
    const seriesName = `${code}\n${p.name}`
    legend.push(seriesName)

    // Boxplotdaten
    const dataBox = catYears.map(yStr => {
      const y = Number(yStr)
      const bucket = perPlotYear.value.get(code)?.get(y)

      // Wenn es keinen Bucket gibt, oder keine gültige Box vorliegt:
      if (!bucket || !(bucket.box && bucket.box.length === 5 && bucket.box.every(Number.isFinite)) || bucket.n < DRAW_MIN_BOXES) {
        // WICHTIG: Kein null mehr zurückgeben → Dummy-Eintrag mit value setzen
        return { value: ['-', '-', '-', '-', '-'] }
      }

      // Gültige Box
      return bucket.box
    })

    series.push({
      id: `box-${code}`,
      name: seriesName,
      type: 'boxplot',
      data: dataBox,
      itemStyle: { color: withAlpha(p.color, 0.28), borderColor: p.color, borderWidth: 1.5 },
      emphasis: { itemStyle: { borderWidth: 2 } },
      boxWidth: [8, 30],
      tooltip: { trigger: 'item' },
      animation: false,
      animationDurationUpdate: 0
    })

    // Ausreißer als Scatter (Offset via scheduleApplyOutlierOffsets)
    const outData = []
    for (const yStr of catYears) {
      const y = Number(yStr)
      const bucket = perPlotYear.value.get(code)?.get(y)
      if (!bucket) continue
      const vals = (bucket.box && bucket.n >= DRAW_MIN_BOXES) ? (bucket.outliers || []) : (bucket.values || [])
      for (const v of vals) if (Number.isFinite(v)) outData.push([yStr, v])
    }
    series.push({
      id: `out-${code}`,
      name: seriesName,
      type: 'scatter',
      data: outData,
      encode: { x: 0, y: 1 },
      symbolSize: 5,
      itemStyle: { color: p.color, opacity: 0.90 },
      tooltip: { trigger: 'item' },
      z: 5,
      animation: false,
      animationDurationUpdate: 0
    })
  })

  return { series, legend, catYears }
}

function fmt(x){ const n=Number(x); return Number.isFinite(n) ? n.toFixed(2) : '' }

// DEFENSIVER TOOLTIP
function tooltipFormatter(params, cats) {
  try {
    const p = Array.isArray(params) ? params[0] : params
    if (!p || typeof p !== 'object') return ''

    const seriesName = typeof p.seriesName === 'string' ? p.seriesName : ''
    let yearStr = ''

    const subType = p.componentSubType || p.seriesType
    if (subType === 'scatter') {
      const v = p && Array.isArray(p.value) ? p.value
              : (p && Array.isArray(p.data) ? p.data : null)
      yearStr = v && (v.length > 0) ? String(v[0]) : ''
    } else if (subType === 'boxplot') {
      const idx = Number.isInteger(p?.dataIndex) ? p.dataIndex : -1
      yearStr = (idx >= 0 && idx < (cats?.length || 0)) ? String(cats[idx]) : ''
    } else {
      const idx = Number.isInteger(p?.dataIndex) ? p.dataIndex : -1
      yearStr = (idx >= 0 && idx < (cats?.length || 0)) ? String(cats[idx]) : ''
    }

    if (!seriesName) return ''
    if (!yearStr) return `<strong>${seriesName}</strong>`

    const bucket = getBucket(seriesName, yearStr)
    if (!bucket) return `<strong>${seriesName}</strong><br/>Jahr: ${yearStr}`

    if (subType === 'boxplot') {
      const d = Array.isArray(bucket.box) ? bucket.box : []
      const [min,q1,med,q3,max] = d
      const n = bucket?.n ?? ''
      const outs = Array.isArray(bucket.outliers) ? bucket.outliers : []
      const lines = [
        `<strong>${seriesName}</strong>`,
        `Jahr: ${yearStr}`,
        `n: ${n}`,
        `min: ${fmt(min)} mm`,
        `Q1: ${fmt(q1)} mm`,
        `Median: ${fmt(med)} mm`,
        `Q3: ${fmt(q3)} mm`,
        `max: ${fmt(max)} mm`
      ]
      if (outs.length) lines.push('Ausreißer:', ...outs.map(v => ` ${fmt(v)} mm`))
      return lines.join('<br/>')
    } else {
      const raw = Array.isArray(p.value) ? p.value
                : (Array.isArray(p.data) ? p.data : [])
      const val = raw.length > 1 ? raw[1] : undefined
      const n = bucket?.n ?? ''
      return [
        `<strong>${seriesName}</strong>`,
        `Jahr: ${yearStr}`,
        `n: ${n}`,
        `Wert: ${fmt(val)} mm`
      ].filter(Boolean).join('<br/>')
    }
  } catch (e) {
    return ''
  }
}

function renderChart() {
  if (!myChart) return
  const { series, legend, catYears } = buildChartSeries()
  const isMobile = (chartEl.value?.clientWidth || 800) < 600

  myChart.setOption({
    backgroundColor: 'transparent',
    title: [
      { left: 'left', text: '5-jährige Vollaufnahme der Bestandsflächen' },
      { left: 'left', top: 28, text: chartTitle.value, textStyle: { fontSize: 14, fontWeight: 400, color: '#444' } }
    ],
    legend: {
      top: isMobile ? 56 : 60,
      type: 'scroll',
      icon: 'circle',
      itemWidth: 14,
      itemHeight: 10,
      inactiveColor: '#bbb',
      textStyle: { fontSize: isMobile ? 10 : 12 },
      data: legend
    },
    tooltip: { show: true, trigger: 'item', confine: true, enterable: true, formatter: (p) => tooltipFormatter(p, catYears) },
    grid: { left: GRID_LEFT, right: GRID_RIGHT, top: isMobile?96:104, bottom: 72 },
    dataZoom: [
      { type: 'inside' },
      { type: 'slider', bottom: 26, height: isMobile?20:26, brushSelect:false, showDetail: false, showDataShadow: true }
    ],
    xAxis: { type: 'category', boundaryGap: true, data: catYears, axisLabel: { fontSize: isMobile?10:12 } },
    yAxis: { type: 'value', name: '[mm]', 
        nameTextStyle: { fontSize:isMobile?10:12, padding:[0,0,0,-10] }, 
        axisLabel: { fontSize: isMobile?10:12, margin: 5}, splitLine: { show: true } },
    series,
    animation: false,
    animationDurationUpdate: 0
  }, true, false)
  wireLegendAndZoomHandlers()
  scheduleApplyOutlierOffsets()
}

// CSV/PNG
function downloadName(ext){
  if(ext==='header'){
    const visible = getVisiblePlots().map(p=>p.code).join(', ')
    const created = new Date().toISOString().replace('T',' ').substring(0,19)
    const hba = speciesMode.value === 'HBA'
      ? (getVisiblePlots().length===1 ? (getVisiblePlots()[0].speciesName || 'HBA') : 'HBA')
      : 'alle'
    return [
      '# 5-jährige Vollaufnahme der Bestandsflächen',
      `# Plots:\t${visible}`,
      `# Erstellt:\t${created} UTC`,
      '# Quelle:\tICP Forest Data des Landesbetrieb Forst Brandenburg',
      '# Link:\t\thttps://forstliche-umweltkontrolle.de/dauerbeobachtung/level-ii/',
      `# Baumart:\t${hba}`
    ].join('\n')
  }
  const ts = new Date().toISOString().substring(0,19).replace(/[:]/g,'-')
  return `aufnahme_5j_${ts}.${ext}`
}
function fmtCsv(x){ const n=Number(x); return Number.isFinite(n) ? n.toFixed(2) : '' }
function generateCSV() {
  if (!perPlotYear.value || !years.value.length) return ''
  const csv = []
  csv.push(downloadName('header'))
  csv.push('')
  csv.push('Jahr,Plotcode,Plotname,HBA,n,min,Q1,Median,Q3,max,Ausreisser')

  const visible = getVisiblePlots()
  for (const p of visible) {
    const ym = perPlotYear.value.get(String(p.code)) || new Map()
    for (const y of years.value) {
      const bucket = ym.get(y)
      if (!bucket || !(bucket.n>0)) continue
      const hasBox = !!(bucket.box && bucket.n >= DRAW_MIN_BOXES)
      const outs = hasBox ? (bucket.outliers || []) : (bucket.values || [])
      if (hasBox) {
        const [min,q1,med,q3,max] = bucket.box
        csv.push([
          y,
          `"${p.code}"`,
          `"${plotsData[String(p.code)]?.name || ''}"`,
          `"${p.speciesName || (speciesMode.value==='ALL'?'alle':'HBA')}"`,
          bucket.n,
          fmtCsv(min), fmtCsv(q1), fmtCsv(med), fmtCsv(q3), fmtCsv(max),
          outs.length ? `"${outs.map(v=>fmtCsv(v)).join(';')}"` : ''
        ].join(','))
      } else {
        csv.push([
          y,
          `"${p.code}"`,
          `"${plotsData[String(p.code)]?.name || ''}"`,
          `"${p.speciesName || (speciesMode.value==='ALL'?'alle':'HBA')}"`,
          bucket.n,
          '', '', '', '', '',
          outs.length ? `"${outs.map(v=>fmtCsv(v)).join(';')}"` : ''
        ].join(','))
      }
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
    const a=document.createElement('a'); a.href=dataURL; a.download=downloadName('png')
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  } catch (e) { console.error('PNG download error:', e) }
}

// Reaktionen
watch([selectedPlots, speciesMode], async () => {
  await fetchData()
  await nextTick(); ensureChart(); renderChart()
})

// Lifecycle
onMounted(async () => {
  await nextTick(); ensureChart()
  await fetchData()
  await nextTick(); renderChart()
})
onBeforeUnmount(() => {
  clearTimeout(offsetTimer)
  if (myChart) { myChart.dispose(); myChart=null }
})
</script>

<template>
  <div class="page">
    <!-- Card 1: Bestandsflächen (Mehrfachauswahl) -->
    <PlotSelect
      v-model="selectedPlots"
      :plots="plotsData"
      :multiple="true"
      :columns="5"
      color="green-darken-2"
      class="mb-3"
    />

    <!-- Card 2: Baumarten -->
    <v-card elevation="1" class="mb-3 soft-card">
      <v-card-title class="pb-2 title-row soft-green">Baumarten</v-card-title>
      <v-card-text>
        <div class="mode-row">
          <v-checkbox
            :model-value="speciesMode==='HBA'"
            @update:modelValue="v => { if (v) speciesMode='HBA' }"
            label="Hauptbaumart"
            color="green-darken-2"
            density="compact"
            hide-details
          />
          <v-checkbox
            :model-value="speciesMode==='ALL'"
            @update:modelValue="v => { if (v) speciesMode='ALL' }"
            label="alle Baumarten"
            color="green-darken-2"
            density="compact"
            hide-details
          />
        </div>
      </v-card-text>
    </v-card>

    <!-- Card 3: Boxplot -->
    <v-card elevation="1" class="mb-3 soft-card">
      <v-toolbar density="comfortable" color="transparent" flat>
        <div class="toolbar-actions">
          <v-btn size="small" variant="elevated tonal" color="primary"
                 @click="downloadChartPNG" title="Chart als PNG speichern">PNG</v-btn>
          <v-btn size="small" variant="elevated tonal" color="primary"
                 class="ml-2" @click="downloadCSV" title="Daten als CSV exportieren">CSV</v-btn>
        </div>
      </v-toolbar>

      <v-card-text>
        <div class="chart-wrap">
          <div ref="chartEl" :style="{ width: '100%', height: chartHeight + 'px' }" />
          <v-overlay v-model="isLoading" contained class="align-center justify-center">
            <v-progress-circular color="primary" indeterminate size="52" />
          </v-overlay>
        </div>

        <v-alert v-if="errorMessage" type="error" variant="tonal" class="mt-3" dismissible @click:close="errorMessage = ''">
          {{ errorMessage }}
        </v-alert>
      </v-card-text>
    </v-card>
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 12px; }
.soft-card { border: 1px solid rgba(var(--v-theme-primary), 0.22); border-radius: 8px; }
.soft-green { background: linear-gradient(180deg, rgba(var(--v-theme-primary), 0.06) 0%, rgba(var(--v-theme-primary), 0.03) 100%); }
.mode-row { display: flex; gap: 18px; align-items: center; flex-wrap: wrap; }
.toolbar-actions { width: 100%; display: flex; justify-content: flex-end; align-items: center; }
.chart-wrap { position: relative; width: 100%; }
</style>
