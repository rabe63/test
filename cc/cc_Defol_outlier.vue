
<script setup>
import { ref, watch, onMounted, onBeforeUnmount, getCurrentInstance, nextTick } from 'vue'
import * as echarts from 'echarts'
import TreeSpeciesSelect from './TreeSpeciesSelect.vue'
import { defaultTreeSpecies, plotsData, getSpeciesNameByCode } from './data/treeSpeciesData.js'
import { computeBoxForValues } from './data/boxplot.js'

const props = defineProps({
  code_plot: { type: [String, Number, null], default: null },
  chartHeight: { type: Number, default: 560 }
})

const instance = getCurrentInstance()
const supabase = instance?.appContext?.config?.globalProperties?.$supabase
if (!supabase) console.error('Supabase-Client ($supabase) fehlt.')

const chartContainer = ref(null)
let myChart = null
let rafId = 0

const isLoading = ref(false)
const errorMessage = ref('')
const rawData = ref([])
const selectedSpecies = ref([])

const titleMain = 'Kronenverlichtung mit Ausreißern (nach Jahren)'

let plotsSummary = []      // ALLE Plots der aktuellen HBA-Auswahl (bleiben in der Legende)
let years = []
let perPlotYear = new Map()

const legendSelected = ref({})  // legendLabel -> boolean (grau/farbig)
let suppressLegendEvent = false

// DataZoom Zustand in Prozent (0..100) – wird gemerkt
const zoomState = ref({
  userSet: false,
  start: 100,
  end: 100
})

// Darstellung
const BASE_BOX_ALPHA = 0.6
const POINT_OUTLIER_SIZE = 2
const GROUP_SPAN = 0.87
const DRAW_MIN_BOXES = 1

// Utils
const fmt = (v, d = 2) => (v == null || isNaN(v) ? '-' : Number(v).toFixed(d))
function schedule(fn) { if (rafId) cancelAnimationFrame(rafId); rafId = requestAnimationFrame(() => { rafId = 0; fn() }) }
function norm(x) { return String(x ?? '').toLowerCase().trim() }
function num(x) { const n = Number(x); return Number.isFinite(n) ? n : null }
function hexToRgba(hex, alpha = 1) {
  const h = String(hex || '').replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return `rgba(102,187,106,${alpha})`
  const bigint = parseInt(h, 16)
  const r = (bigint >> 16) & 255
  const g = (bigint >> 8) & 255
  const b = bigint & 255
  return `rgba(${r},${g},${b},${alpha})`
}
function getPlotColorByCode(code) {
  return plotsData?.[String(code)]?.color || '#66BB6A'
}

// Daten laden
async function fetchData() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const { data, error } = await supabase
      .schema('public')
      .from('v_cc_defol_box')
      .select('*')
      .order('survey_year, code_plot')
    if (error) throw error
    rawData.value = data || []
  } catch (e) {
    console.error('Supabase fetchData error:', e)
    errorMessage.value = 'Daten konnten nicht geladen werden.'
  } finally {
    isLoading.value = false
  }
}

// Sichtbare Plots aus legendSelected ableiten
function getVisiblePlots() {
  return plotsSummary.filter(p => legendSelected.value[p.legendLabel] !== false)
}

// Aufbereitung
function buildYearSplitData() {
  plotsSummary = []
  years = []
  perPlotYear = new Map()
  const sel = selectedSpecies.value || []
  legendSelected.value = legendSelected.value || {}
  if (!sel.length) { legendSelected.value = {}; return }

  // Auswahl: Name -> Code
  const nameToCode = new Map()
  for (const s of defaultTreeSpecies || []) {
    const c = num(s?.code)
    if (c != null) {
      if (s.value) nameToCode.set(norm(s.value), c)
      if (s.label) nameToCode.set(norm(s.label), c)
    }
  }

  // erlaubte Species-Codes
  const allowedSpeciesCodes = new Set()
  for (const t of sel) {
    if (t && typeof t === 'object') {
      const c1 = num(t.code); if (c1 != null) { allowedSpeciesCodes.add(c1); continue }
      const v1 = norm(t.value); if (nameToCode.has(v1)) { allowedSpeciesCodes.add(nameToCode.get(v1)); continue }
      const l1 = norm(t.label); if (nameToCode.has(l1)) { allowedSpeciesCodes.add(nameToCode.get(l1)); continue }
      continue
    }
    if (typeof t === 'number' && Number.isFinite(t)) { allowedSpeciesCodes.add(t); continue }
    const n1 = num(t); if (n1 != null) { allowedSpeciesCodes.add(n1); continue }
    const sNorm = norm(t); if (nameToCode.has(sNorm)) { allowedSpeciesCodes.add(nameToCode.get(sNorm)); continue }
  }
  if (!allowedSpeciesCodes.size) { legendSelected.value = {}; return }

  // Plots wählen
  let candidatePlots = Object.values(plotsData).filter(p =>
    (p.species || []).some(sc => allowedSpeciesCodes.has(num(sc)))
  )
  if (props.code_plot != null) {
    const only = String(props.code_plot)
    candidatePlots = candidatePlots.filter(p => p.code === only)
  }
  if (!candidatePlots.length) { legendSelected.value = {}; return }

  // Rohdaten filtern
  const filtered = rawData.value.filter(r => {
    const plotCode = String(r.code_plot)
    if (!candidatePlots.some(p => p.code === plotCode)) return false
    const sc = num(r.code_tree_species)
    if (sc != null && !allowedSpeciesCodes.has(sc)) return false
    return r.code_defoliation != null && !isNaN(r.code_defoliation)
  })

  // Jahre sammeln
  const yearSet = new Set()
  for (const row of filtered) {
    const y = num(row.survey_year)
    if (y != null) yearSet.add(y)
  }
  years = Array.from(yearSet).sort((a, b) => a - b)

  // Strukturen
  for (const p of candidatePlots) {
    const speciesName = getSpeciesNameByCode(p.species[0]) || ''
    const legendLabel = `${p.code}\n(${speciesName})`
    plotsSummary.push({ code: p.code, legendLabel, color: p.color || '#66BB6A', speciesName })
    const yearMap = new Map()
    years.forEach(y => yearMap.set(y, { values: [], box: null, outliers: [], n: 0, fences: null }))
    perPlotYear.set(p.code, yearMap)
  }

  // Werte einsortieren
  for (const row of filtered) {
    const code = String(row.code_plot)
    const y = num(row.survey_year)
    const v = num(row.code_defoliation)
    if (!perPlotYear.has(code)) continue
    if (y == null || v == null) continue
    perPlotYear.get(code).get(y).values.push(v)
  }

  // Boxen + Ausreißer
  for (const p of plotsSummary) {
    const ym = perPlotYear.get(p.code)
    for (const y of years) {
      const bucket = ym.get(y)
      bucket.n = bucket.values.length
      if (bucket.values.length >= DRAW_MIN_BOXES) {
        const res = computeBoxForValues(bucket.values)
        if (res) {
          bucket.box = res.stats
          bucket.outliers = res.outliers
          bucket.fences = res.fences
        }
      }
    }
  }

  // Legenden-Selektion initialisieren/erhalten (alle neuen Keys auf true, vorhandene beibehalten)
  const nextSel = {}
  for (const p of plotsSummary) {
    nextSel[p.legendLabel] = legendSelected.value[p.legendLabel] !== false
  }
  legendSelected.value = nextSel

  // DataZoom Default (nur wenn User noch nicht gezoomt hat)
  initDefaultZoomIfNeeded()

  console.log(`Prep fertig: years=${years.length}, plots=${plotsSummary.length}`)
}

// DataZoom Standard: letzte 5 Jahre (Prozent)
function initDefaultZoomIfNeeded() {
  if (zoomState.value.userSet) return
  const n = years.length
  if (!n) { zoomState.value.start = 0; zoomState.value.end = 100; return }
  const show = Math.min(5, n)
  const startPct = Math.max(0, Math.round(((n - show) / n) * 100))
  zoomState.value.start = startPct
  zoomState.value.end = 100
}

// Ausreißer-Dataset für Custom-Serie (seitlich gruppiert) – nur für aktuell sichtbare Plots
function buildOutlierDataset(visiblePlots) {
  const data = []
  const plotCount = visiblePlots.length || 1
  const step = GROUP_SPAN / plotCount
  const start = -GROUP_SPAN / 2 + step / 2

  visiblePlots.forEach((p, pi) => {
    const ym = perPlotYear.get(p.code)
    years.forEach((y, yi) => {
      const bucket = ym.get(y)
      if (!bucket || !bucket.box || !bucket.outliers?.length) return
      const relOffset = start + pi * step // normiert zur Kategoriebreite
      bucket.outliers.forEach(v => {
        data.push([yi, v, relOffset, p.code, y]) // 0:yearIdx,1:val,2:offset,3:plotCode,4:year
      })
    })
  })
  return data
}

// Custom-Renderer für Ausreißer
function renderOutlier(params, api) {
  const yi = api.value(0)
  const v = api.value(1)
  const relOffset = api.value(2)
  const plotCode = api.value(3)
  const coordCenter = api.coord([yi, v])
  const catSize = api.size([1, 0])[0]
  const x = coordCenter[0] + relOffset * catSize
  const y = coordCenter[1]

  const color = getPlotColorByCode(plotCode)

  return {
    type: 'circle',
    shape: { cx: x, cy: y, r: POINT_OUTLIER_SIZE },
    style: api.style({ fill: color, stroke: color, lineWidth: 1 }),
    z: 10
  }
}

function makeOption() {
  if (!years.length) {
    return {
      title: [{ left: 'left', text: titleMain }],
      xAxis: { type: 'category', data: [] },
      yAxis: { type: 'value' },
      series: []
    }
  }

  const categories = years.slice()

  // Boxplot-Serien IMMER für alle Plots der HBA-Auswahl.
  // ECharts blendet sie per Legende selbst aus/ein (grau/farbig via legend.selected).
  const boxplotSeries = plotsSummary.map(p => {
    const ym = perPlotYear.get(p.code)
    const data = years.map(y => {
      const b = ym?.get(y)
      if (b?.box) {
        return { value: b.box, year: y, plotCode: p.code }
      }
      return { value: [NaN, NaN, NaN, NaN, NaN], year: y, plotCode: p.code }
    })

    const color = getPlotColorByCode(p.code)

    return {
      name: p.legendLabel,
      type: 'boxplot',
      data,
      itemStyle: {
        color: hexToRgba(color, BASE_BOX_ALPHA),
        borderColor: color,
        borderWidth: 2
      },
      emphasis: { itemStyle: { borderColor: color, borderWidth: 3 } },
      boxWidth: [8, 40],
      tooltip: { trigger: 'item' }
    }
  })

  // Ausreißer (Custom) nur für aktuell sichtbare Plots (laut legendSelected)
  const visibleNow = getVisiblePlots()
  const outlierData = buildOutlierDataset(visibleNow)
  const outlierSeries = {
    id: '_outliers_',
    name: '_outliers_',
    type: 'custom',
    renderItem: renderOutlier,
    data: outlierData,
    encode: { x: 0, y: 1 },
    tooltip: {
      trigger: 'item',
      formatter: p => {
        const val = p.data[1]
        const year = p.data[4]
        const code = p.data[3]
        const plot = plotsSummary.find(pl => pl.code === code)
        if (!plot) return ''
        return `<strong>${plot.code} (${plot.speciesName}) – ${year}</strong><br/>Ausreißer: ${fmt(val)} %`
      }
    },
    z: 10
  }

  return {
    title: [
      { left: 'left', text: titleMain },
      { left: 'left', text: 'ICP Forest Data des Landesbetrieb Forst Brandenburg', bottom: 0, textStyle: { fontSize: 12, color: '#999' } },
      { left: 'right', text: 'forstliche-umweltkontrolle.de', bottom: 0, textStyle: { fontSize: 12, color: '#999' } }
    ],
    legend: {
      top: 40,
      type: 'scroll',
      selectedMode: 'multiple',
      data: plotsSummary.map(p => p.legendLabel),   // alle Plots bleiben in der Legende
      selected: legendSelected.value,               // grau/farbig steuern
      inactiveColor: '#bbb'
    },
    grid: { left: 60, top: 90, right: 15, bottom: 120, containLabel: true },
    // Nur Prozentwerte – Sliderstand bleibt beim HBA-Wechsel erhalten
    dataZoom: [
      { type: 'slider', xAxisIndex: 0, height: 24, bottom: 80, start: zoomState.value.start, end: zoomState.value.end },
      { type: 'inside', xAxisIndex: 0, start: zoomState.value.start, end: zoomState.value.end }
    ],
    xAxis: { type: 'category', data: categories, axisLabel: { interval: 0, rotate: 40 } },
    yAxis: { type: 'value', name: 'Kronenverlichtung (%)', scale: true },
    tooltip: {
      trigger: 'item',
      confine: true,
      formatter: params => {
        if (params.seriesType === 'boxplot') {
          const year = params.data?.year
          const plotCode = params.data?.plotCode
          const plot = plotsSummary.find(pl => pl.code === plotCode)
          if (!plot || year == null) return ''
          const bucket = perPlotYear.get(plot.code)?.get(year)
          if (!bucket || !bucket.box) return `<strong>${plot.code} (${plot.speciesName}) – ${year}</strong><br/>Keine Daten`
          const [min, q1, med, q3, max] = bucket.box
          const outs = bucket.outliers || []
          const outsBlock = outs.length ? `<br/>Ausreißer:<br/>${outs.map(v => fmt(v)).join('<br/>')}` : ''
          return `<div style="min-width:240px">
            <strong>${plot.code} (${plot.speciesName}) – ${year}</strong><br/>
            n: ${bucket.n}<br/>
            min: ${fmt(min)} %<br/>Q1: ${fmt(q1)} %<br/>Median: ${fmt(med)} %<br/>Q3: ${fmt(q3)} %<br/>max: ${fmt(max)} %
            ${outsBlock}
          </div>`
        }
        return ''
      }
    },
    series: [
      ...boxplotSeries,
      outlierSeries
    ]
  }
}

// Chart Handling
function ensureChart() { if (!myChart && chartContainer.value) myChart = echarts.init(chartContainer.value) }
function disposeChart() { if (myChart) { myChart.dispose(); myChart = null } }

function drawChart() {
  if (!chartContainer.value) return
  if ((selectedSpecies.value || []).length === 0) {
    if (myChart) myChart.clear()
    return
  }
  ensureChart()
  const option = makeOption()
  schedule(() => {
    try {
      myChart.clear()
      myChart.setOption(option, true)
      myChart.resize({ height: props.chartHeight, width: chartContainer.value.clientWidth })

      // Legende: Einträge bleiben bestehen; wir mergen die States, damit keine Keys "verloren" gehen.
      myChart.off('legendselectchanged')
      myChart.on('legendselectchanged', evt => {
        if (suppressLegendEvent) return

        const allNames = plotsSummary.map(p => p.legendLabel)
        const incoming = evt?.selected || {}
        const merged = {}
        for (const name of allNames) {
          merged[name] = Object.prototype.hasOwnProperty.call(incoming, name)
            ? incoming[name]
            : (legendSelected.value[name] ?? true)
        }
        legendSelected.value = merged

        // Nur die Outlier-Daten müssen wir neu berechnen; Boxplot-Sichtbarkeit regelt die Legende selbst.
        const visibleNow = getVisiblePlots()
        const outlierData = buildOutlierDataset(visibleNow)
        suppressLegendEvent = true
        myChart.setOption({
          series: [{ id: '_outliers_', data: outlierData }]
        }, false)
        // legend.selected lassen wir ECharts aus dem Event übernehmen
        setTimeout(() => { suppressLegendEvent = false }, 0)
      })

      // DataZoom – Prozentwerte speichern
      myChart.off('datazoom')
      myChart.on('datazoom', () => {
        const opt = myChart.getOption()
        const dz = (opt.dataZoom && opt.dataZoom[0]) || {}
        if (typeof dz.start === 'number' && typeof dz.end === 'number') {
          zoomState.value.userSet = true
          zoomState.value.start = dz.start
          zoomState.value.end = dz.end
        }
      })
    } catch (e) {
      console.error('ECharts setOption error:', e)
    }
  })
}

function handleResize() {
  if (!myChart) return
  schedule(() => {
    try { myChart.resize({ height: props.chartHeight, width: chartContainer.value.clientWidth }) } catch {}
  })
}

// CSV/PNG
function downloadName(ext){
  if(ext==='header'){
    const visible = getVisiblePlots().map(p=>p.code).join(', ')
    const created = new Date().toISOString().replace('T',' ').substring(0,19)
    const hba = Array.isArray(selectedSpecies.value) ? selectedSpecies.value.join(', ') : String(selectedSpecies.value ?? '')

    return [
      '# Kronenverlichtung mit Ausreißern',
      `# Plots:\t${visible}`,
      `# Erstellt:\t${created} UTC`,
      '# Quelle:\tICP Forest Data des Landesbetrieb Forst Brandenburg',
      '# Link:\t\thttps://forstliche-umweltkontrolle.de/dauerbeobachtung/level-ii/',
      `# HBA:\t\t${hba}`
    ].join('\n')
  }
  const ts = new Date().toISOString().substring(0,19).replace(/[:]/g,'-')
  return `kronenverlichtung_boxplots_${ts}.${ext}`
}

function generateCSV() {
  if (!plotsSummary.length || !years.length) return ''
  const csv = []
  csv.push(downloadName('header'))
  csv.push('')
  csv.push('Jahr,Plotcode,Plotname,HBA,n,min,Q1,Median,Q3,max,Ausreisser')
  const visible = getVisiblePlots()
  for (const p of visible) {
    const ym = perPlotYear.get(p.code)
    for (const y of years) {
      const bucket = ym.get(y)
      if (!bucket || !bucket.box || !bucket.n) continue
      const [min,q1,med,q3,max] = bucket.box
      const outs = bucket.outliers || []
      csv.push([
        y,
        `"${p.code}"`,
        `"${plotsData[p.code]?.name || ''}"`,
        `"${p.speciesName}"`,
        bucket.n,
        fmt(min), fmt(q1), fmt(med), fmt(q3), fmt(max),
        outs.length ? `"${outs.map(v=>fmt(v)).join(';')}"` : ''
      ].join(','))
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

// Watcher
watch(
  () => JSON.stringify(selectedSpecies.value),
  async () => {
    buildYearSplitData()
    await nextTick()
    drawChart()
  }
)
watch(() => props.code_plot, async () => { buildYearSplitData(); await nextTick(); drawChart() })

// Lifecycle
onMounted(async () => {
  window.addEventListener('resize', handleResize, { passive: true })
  await fetchData()
  buildYearSplitData()
  await nextTick()
  drawChart()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  if (rafId) cancelAnimationFrame(rafId)
  disposeChart()
})

defineExpose({ refreshData: fetchData, selectedSpecies })
</script>

<template>
  <TreeSpeciesSelect
    v-model="selectedSpecies"
    :select-all-by-default="true"
    :show-debug="false"
    :min-selection="0"
    class="mb-4"
  />

  <v-card elevation="1" class="mb-3 soft-card">
    <v-toolbar density="comfortable" color="transparent" flat>
      <div class="toolbar-actions">
        <v-btn
          size="small"
          variant="elevated tonal"
          elevation="1"
          color="primary"
          @click="downloadChartPNG"
          :disabled="isLoading || (selectedSpecies || []).length === 0"
        >PNG</v-btn>
        <v-btn
          size="small"
          variant="elevated tonal"
          elevation="1"
          color="primary"
          class="ml-2"
          @click="downloadCSV"
          :disabled="isLoading || (selectedSpecies || []).length === 0 || !rawData || !rawData.length"
        >CSV</v-btn>
      </div>
    </v-toolbar>
    <v-divider />
    <v-card-text>
      <div :style="{ position: 'relative', width: '100%', height: chartHeight + 'px' }">
        <div ref="chartContainer" :style="{ width: '100%', height: chartHeight + 'px' }"></div>

        <div
          v-show="(selectedSpecies || []).length === 0"
          class="empty-overlay"
          :style="{ height: chartHeight + 'px' }"
        >
          <v-alert variant="plain" color="primary" border="start" elevation="0">
            Bitte wählen Sie mindestens eine Baumart.
          </v-alert>
        </div>

        <v-overlay v-model="isLoading" contained class="align-center justify-center">
          <v-progress-circular color="primary" indeterminate size="52" />
        </v-overlay>
      </div>
    </v-card-text>
  </v-card>

  <v-alert
    v-if="errorMessage"
    type="error"
    variant="tonal"
    class="mt-3"
    dismissible
    @click:close="errorMessage = ''"
  >
    {{ errorMessage }}
  </v-alert>
</template>

<style scoped>
.soft-card { border: 1px solid rgba(var(--v-theme-primary), 0.22); border-radius: 6px; }
.toolbar-actions { width: 100%; display: flex; justify-content: flex-end; align-items: center; margin-right: 10px;}
.empty-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  pointer-events: none;
  z-index: 2;
}
@media (max-width: 959px) {
  .chart-card { margin-bottom: 10px; }
}
@media (max-width: 599px) {
  .toolbar-actions { gap: 6px; }
  .toolbar-actions .ml-2 { margin-left: 6px !important; }
}
</style>