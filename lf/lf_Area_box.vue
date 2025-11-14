<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, getCurrentInstance, nextTick } from 'vue'
import * as echarts from 'echarts'
import TreeSpeciesSelect from './TreeSpeciesSelect.vue'
import MetricSelect from './MetricSelect.vue'
import { defaultTreeSpecies, plotsData, getSpeciesNameByCode } from './data/treeSpeciesData.js'
import { computeBoxForValues } from './data/boxplot.js'

const props = defineProps({
  code_plot: { type: [String, Number, null], default: null },
  chartHeight: { type: Number, default: 560 }
})

const instance = getCurrentInstance()
const supabase = instance?.appContext?.config?.globalProperties?.$supabase
if (!supabase) console.error('Supabase-Client ($supabase) fehlt. Bitte globalProperties.$supabase bereitstellen.')

const chartContainer = ref(null)
let myChart = null
let rafId = 0

const isLoading = ref(false)
const errorMessage = ref('')
const rawData = ref([])

const selectedSpecies = ref([])
const metric = ref('mass')

const unitOnly = computed(() => metric.value === 'area' ? 'm²' : 'g')
const yAxisName = computed(() => metric.value === 'area' ? 'Fläche (m²)' : 'Masse (g)')
const titleMain = 'Masse (100 Blätter / 1000 Nadeln)'

/* Aggregationsergebnis pro Plot */
let allEntries = [] // [{ code, xLabel, legendLabel, color, n, stats, outliers, singles }]
const legendSelected = ref({}) // name -> boolean

// Guard, um rekursive legendselectchanged-Ereignisse zu verhindern
let suppressLegendEvent = false

const fmt = (v, d = 2) => (v == null || isNaN(v) ? '-' : Number(v).toFixed(d))
function schedule(fn) { if (rafId) cancelAnimationFrame(rafId); rafId = requestAnimationFrame(() => { rafId = 0; fn() }) }

/* Daten laden */
async function fetchData() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const { data: icpData, error } = await supabase
      .schema('icp_download')
      .from('lf_lfa')
      .select('survey_year, code_plot, mass, area')
      .or('area.gt.0,mass.gt.0')
    if (error) throw error
    rawData.value = icpData || []
  } catch (e) {
    console.error('Supabase fetchData error:', e)
    errorMessage.value = 'Daten konnten nicht geladen werden.'
  } finally {
    isLoading.value = false
  }
}

/* Normalisierung */
function norm(x) { return String(x ?? '').toLowerCase().trim() }
function num(x) { const n = Number(x); return Number.isFinite(n) ? n : null }

/* Sichtbare Einträge, mit Fallback wenn alles unsichtbar ist */
function getVisibleEntries() {
  const vis = allEntries.filter(e => legendSelected.value[e.legendLabel] !== false)
  return vis.length ? vis : allEntries
}

/* Aggregation aller Plots (unabhängig von Legenden-Auswahl) */
function buildAllEntries() {
  allEntries = []
  const sel = selectedSpecies.value || []
  if (sel.length === 0) { legendSelected.value = {}; return }

  // 1) Name/Label → Code-Mapping
  const nameToCode = new Map()
  for (const s of defaultTreeSpecies || []) {
    const c = num(s?.code)
    const v = norm(s?.value)
    const l = norm(s?.label)
    if (c != null) {
      if (v) nameToCode.set(v, c)
      if (l) nameToCode.set(l, c)
    }
  }

  // 2) erlaubte Species-Codes aus Auswahl ableiten
  const allowedSpeciesCodes = new Set()
  for (const t of sel) {
    if (t && typeof t === 'object') {
      const c1 = num(t.code); if (c1 != null) { allowedSpeciesCodes.add(c1); continue }
      const v1 = norm(t.value); if (v1 && nameToCode.has(v1)) { allowedSpeciesCodes.add(nameToCode.get(v1)); continue }
      const l1 = norm(t.label); if (l1 && nameToCode.has(l1)) { allowedSpeciesCodes.add(nameToCode.get(l1)); continue }
      const f1 = norm(t); if (f1 && nameToCode.has(f1)) { allowedSpeciesCodes.add(nameToCode.get(f1)); continue }
      continue
    }
    if (typeof t === 'number' && Number.isFinite(t)) { allowedSpeciesCodes.add(t); continue }
    const n1 = num(t); if (n1 != null) { allowedSpeciesCodes.add(n1); continue }
    const sNorm = norm(t); if (nameToCode.has(sNorm)) { allowedSpeciesCodes.add(nameToCode.get(sNorm)); continue }
  }

  if (allowedSpeciesCodes.size === 0) { legendSelected.value = {}; return }

  // 3) Kandidaten-Plots nach Species-Code (robust: Zahl ODER String)
  const allowedSpeciesCodesStr = new Set(Array.from(allowedSpeciesCodes).map(String))
  let candidatePlots = Object.values(plotsData).filter(p =>
    (p.species || []).some(sc => {
      const scNum = num(sc)
      return (scNum != null && allowedSpeciesCodes.has(scNum)) || allowedSpeciesCodesStr.has(String(sc))
    })
  )

  // Optional: nur ein Plot
  if (props.code_plot != null) {
    const only = String(props.code_plot)
    candidatePlots = candidatePlots.filter(p => p.code === only)
  }

  // 4) Werte je Plot einsammeln
  const field = metric.value === 'area' ? 'area' : 'mass'
  const byPlot = new Map()
  const allowedPlotCodes = new Set(candidatePlots.map(p => p.code))
  for (const row of rawData.value) {
    const code = String(row.code_plot)
    if (!allowedPlotCodes.has(code)) continue
    const v = row[field]
    if (v == null || isNaN(v) || v <= 0) continue
    if (!byPlot.has(code)) byPlot.set(code, [])
    byPlot.get(code).push(Number(v))
  }

  // 5) Nur Plots mit Daten
  const withData = candidatePlots.filter(p => (byPlot.get(p.code) || []).length > 0)

  for (const p of withData) {
    const code = p.code
    const values = byPlot.get(code) || []
    const speciesShort = getSpeciesNameByCode(p.species[0]) || ''
    const xLabel = `${code} (${speciesShort})`
    const legendLabel = `${code}\n(${speciesShort})`

    if (values.length < 3) {
      allEntries.push({
        code, xLabel, legendLabel,
        color: p.color || '#66BB6A',
        n: values.length,
        stats: [NaN, NaN, NaN, NaN, NaN],
        outliers: [],
        singles: values.slice()
      })
    } else {
      const res = computeBoxForValues(values)
      allEntries.push({
        code, xLabel, legendLabel,
        color: p.color || '#66BB6A',
        n: res?.n ?? values.length,
        stats: res?.stats ?? [NaN, NaN, NaN, NaN, NaN],
        outliers: res?.outliers ?? [],
        singles: []
      })
    }
  }

  // 6) Legendenselektion beibehalten, neue Items default true; Fallback wenn alles aus
  const nextSel = {}
  for (const e of allEntries) {
    nextSel[e.legendLabel] = legendSelected.value[e.legendLabel] !== false
  }
  const vals = Object.values(nextSel)
  if (vals.length === 0 || vals.every(v => v === false)) {
    for (const e of allEntries) nextSel[e.legendLabel] = true
  }
  legendSelected.value = nextSel
}

function hexToRgba(hex, alpha = 1) {
  const h = String(hex || '').replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return `rgba(102,187,106,${alpha})`
  const bigint = parseInt(h, 16)
  const r = (bigint >> 16) & 255
  const g = (bigint >> 8) & 255
  const b = bigint & 255
  return `rgba(${r},${g},${b},${alpha})`
}

/* Chart-Option erzeugen: eine Boxplot-Serie (zentriert), eine Scatter-Serie (Punkte), und Dummy-Serien für Legende */
function makeOption() {
  const visible = getVisibleEntries()
  const categories = visible.map(e => e.xLabel)

  // Boxplot-Daten: je Kategorie 1 Item, mit individueller Farbe pro Kategorie
  const boxData = visible.map(e => ({
    value: e.stats,
    itemStyle: {
      color: hexToRgba(e.color, 0.4), // 0.4 = 40% Deckkraft
      borderColor: e.color,
      borderWidth: 2
    },
    emphasis: {
      itemStyle: { borderColor: e.color, borderWidth: 3 }
    }
  }))

  // Punkte: für n<3 => Einzelwerte, sonst Ausreißer; X als Kategorienlabel (damit mittig)
  const points = []
  visible.forEach(e => {
    const arr = e.n < 3 ? e.singles : e.outliers
    arr.forEach(v => points.push({
      value: [e.xLabel, v],
      name: e.legendLabel,
      singleValue: e.n < 3,
      itemStyle: { color: e.color }
    }))
  })

  // Dummy-Serien für Legende, mit gewünschtem Symbol:
  // - n >= 3: roundRect (abgerundetes Rechteck)
  // - n < 3: circle (Einzelwerte)
  const legendSeries = allEntries.map(e => ({
    name: e.legendLabel,
    type: 'scatter',
    data: [],
    symbol: e.n < 3 ? 'circle' : 'roundRect',
    symbolKeepAspect: true,
    symbolSize: e.n < 3 ? 10 : [18, 10],
    itemStyle: { color: e.color },
    silent: true,
    tooltip: { show: false }
  }))

  return {
    title: [
      { left: 'left', text: titleMain },
      { left: 'left', text: 'ICP Forest Data des Landesbetrieb Forst Brandenburg', bottom: 0, textStyle: { fontSize: 12, color: '#999' } },
      { left: 'right', text: 'forstliche-umweltkontrolle.de', bottom: 0, textStyle: { fontSize: 12, color: '#999' } }
    ],
    legend: {
      top: 40,
      type: 'scroll',
      data: allEntries.map(e => e.legendLabel),
      selected: legendSelected.value,
      formatter: (name) => name
    },
    grid: { left: 50, top: 90, right: 10, bottom: 100, containLabel: true },
    xAxis: { type: 'category', data: categories, axisLabel: { interval: 0, rotate: 30 } },
    yAxis: { type: 'value', name: yAxisName.value, scale: true },
    tooltip: {
      trigger: 'item',
      axisPointer: { type: 'shadow' },
      formatter: (p) => {
        // Boxplot: Kategorienindex -> sichtbarer Eintrag
        if (p?.seriesType === 'boxplot') {
          const e = getVisibleEntries()[p.dataIndex]
          if (!e) return ''
          const header = `${e.code}, ${(plotsData[e.code]?.name || '')} <br/>(${e.xLabel.split('(')[1]?.replace(')','') || ''})`
          const [min,q1,med,q3,max] = e.stats
          const outs = e.outliers || []
          const outsBlock = outs.length ? `<br/>Ausreißer:<br/>${outs.map(v => fmt(v)).join('<br/>')}` : ''
          return `<div style="min-width:240px">
            <strong>${header}</strong><br/>
            ${metric.value === 'area' ? 'Fläche' : 'Trockengewicht'}<br/>
            n: ${e.n}<br/>
            min: ${fmt(min)} ${unitOnly.value}<br/>
            Q1: ${fmt(q1)} ${unitOnly.value}<br/>
            Median: ${fmt(med)} ${unitOnly.value}<br/>
            Q3: ${fmt(q3)} ${unitOnly.value}<br/>
            max: ${fmt(max)} ${unitOnly.value}
            ${outsBlock}
          </div>`
        }
        // Punkte: name enthält legendLabel, value[0] das Kategorienlabel
        if (p?.seriesType === 'scatter' && Array.isArray(p.value)) {
          const cat = p.value[0]
          const e = getVisibleEntries().find(x => x.xLabel === cat)
          if (!e) return ''
          const header = `${e.code}, ${(plotsData[e.code]?.name || '')} (${e.xLabel.split('(')[1]?.replace(')','') || ''})`
          const v = p.value[1]
          const isSingle = p.data?.singleValue
          return `<strong>${header}</strong><br/>${isSingle ? 'Einzelwert (n<3):' : 'Ausreißer:'} ${fmt(v)} ${unitOnly.value}`
        }
        return ''
      }
    },
    series: [
      // Dummy-Farb-/Formserien für Legende
      ...legendSeries,
      // Eine zentrierte Boxplot-Serie (Farbe je Kategorie am Datenobjekt)
      {
        name: '_box_',
        type: 'boxplot',
        data: boxData,
        boxWidth: [8, 40]
      },
      // Eine kombinierte Scatter-Serie (immer mittig über der Kategorie)
      {
        name: '_pts_',
        type: 'scatter',
        data: points,
        symbol: 'circle',
        symbolSize: 6
      }
    ]
  }
}

/* Chart init/dispose */
function ensureChart() { if (!myChart && chartContainer.value) myChart = echarts.init(chartContainer.value) }
function disposeChart() { if (myChart) { myChart.dispose(); myChart = null } }

/* Render */
function drawChart() {
  if (!chartContainer.value) return
  if ((selectedSpecies.value || []).length === 0) { if (myChart) myChart.clear(); return }
  ensureChart()

  const option = makeOption()
  schedule(() => {
    try {
      myChart.clear()
      myChart.setOption(option, true)
      myChart.resize({ height: props.chartHeight, width: chartContainer.value.clientWidth })
      myChart.off('legendselectchanged')
      myChart.on('legendselectchanged', (evt) => {
        if (suppressLegendEvent) return
        const selectedMap = { ...(evt?.selected || {}) }
        const values = Object.values(selectedMap)
        const allFalse = values.length > 0 && values.every(v => v === false)

        if (allFalse) {
          // Benutzer hat alle abgewählt → wir reaktivieren ALLE und synchronisieren die Legende
          const nextSel = {}
          for (const e of allEntries) nextSel[e.legendLabel] = true
          legendSelected.value = nextSel

          // Re-Render ohne weiteres User-Event
          suppressLegendEvent = true
          drawChart()
          // kurze Verzögerung, dann wieder Events zulassen
          setTimeout(() => { suppressLegendEvent = false }, 0)
        } else {
          // Normale Übernahme der Selektion
          legendSelected.value = selectedMap
          drawChart()
        }
      })
    } catch (e) {
      console.error('setOption/resize error:', e)
    }
  })
}

/* CSV Export */
function generateCSV() {
  if (!getVisibleEntries().length) return ''
  const csv = []
  csv.push(downloadName('header'))
  csv.push('')
  csv.push('Plotname,Plotcode,Species,n,min,Q1,Median,Q3,max,Ausreißer')

  getVisibleEntries().forEach(e => {
    // Auch Einträge mit n<3 (nur Einzelwerte) exportieren
    if (!e || (e.n ?? 0) === 0) return

    const [min, q1, med, q3, max] = e.stats || [NaN, NaN, NaN, NaN, NaN]
    const plotName = plotsData[e.code]?.name || ''
    const plotCode = e.code
    const species = getSpeciesNameByCode(plotsData[e.code]?.species?.[0]) || ''

    // Ausreißer + Einzelwerte zusammenführen
    const outsMerged = [...(e.outliers || []), ...(e.singles || [])]

    csv.push([
      `"${plotName}"`,
      `"${plotCode}"`,
      `"${species}"`,
      e.n,                     // n
      fmt(min, 2), fmt(q1, 2), fmt(med, 2), fmt(q3, 2), fmt(max, 2),
      outsMerged.length ? `"${outsMerged.map(v => fmt(v, 2)).join(';')}"` : ''
    ].join(','))
  })
  return csv.join('\n')
}

function downloadName(dat_ext) {
  if (dat_ext === 'header') {
  return '# Streufall (100 Blaetter / 1000 Nadeln)\n' +
        `# Metrik:\t${metric.value === 'area' ? 'Flaeche (m²)' : 'Masse (g)'}\n` +
        `# Erstellt:\t${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC\n` +
        '# Quelle:\tICP Forest Data des Landesbetrieb Forst Brandenburg\n' +
        '# Link:\t\thttps://forstliche-umweltkontrolle.de/dauerbeobachtung/level-ii/\n' +
        `# HBA:\t\t${selectedSpecies.value.join(', ')}\n`
  } 
  const ts = new Date().toISOString().substring(0,19).replace(/[:]/g,'-')
  const partname = computed(() => metric.value === 'area' ? 'flaeche' : 'masse')
  const filename = `streufall_${partname.value}_${ts}.${dat_ext}`
  return filename
}

function downloadCSV() {
  const csvContent = generateCSV()
  if (!csvContent) { errorMessage.value = 'Keine Daten zum Download verfügbar'; return }
  const filename = downloadName('csv')
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  const url = URL.createObjectURL(blob)
  a.href = url; a.download = filename; a.style.visibility = 'hidden'
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/* PNG Export (unverändert) */
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

/* Resize */
function handleResize() {
  if (!myChart) return
  schedule(() => {
    try { myChart.resize({ height: props.chartHeight, width: chartContainer.value.clientWidth }) } catch {}
  })
}

/* Watcher & Lifecycle */
// Robuster Watcher: reagiert auf jede Änderung des Arrays
watch(
  () => JSON.stringify(selectedSpecies.value),
  async () => { buildAllEntries(); await nextTick(); drawChart() }
)
watch(metric, async () => { buildAllEntries(); await nextTick(); drawChart() })
watch(() => props.code_plot, async () => { buildAllEntries(); await nextTick(); drawChart() })

onMounted(async () => {
  window.addEventListener('resize', handleResize, { passive: true })
  await fetchData()
  buildAllEntries()
  await nextTick()
  drawChart()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
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

  <MetricSelect v-model="metric" class="mb-2" />

  <v-card elevation="1" class="mb-3 soft-card">
    <v-toolbar density="comfortable" color="transparent" flat>
      <div class="toolbar-actions">
        <v-btn size="small" variant="elevated tonal" elevation="1" color="primary"
               @click="downloadChartPNG" :disabled="isLoading || (selectedSpecies || []).length === 0"
               title="Chart als PNG speichern">PNG</v-btn>
        <v-btn size="small" variant="elevated tonal" elevation="1" color="primary" class="ml-2"
               @click="downloadCSV" :disabled="isLoading || (selectedSpecies || []).length === 0 || !rawData || !rawData.length"
               title="Chartdaten als CSV exportieren">CSV</v-btn>
      </div>
    </v-toolbar>
    <v-divider />
    <v-card-text>
      <div :style="{ position: 'relative', width: '100%', height: chartHeight + 'px' }">
        <!-- Chart-Container: IMMER im DOM und sichtbar -->
        <div ref="chartContainer" :style="{ width: '100%', height: chartHeight + 'px' }" />

        <!-- Hinweis als Overlay ein-/ausblenden -->
        <div v-show="(selectedSpecies || []).length === 0"
             class="empty-overlay"
             :style="{ height: chartHeight + 'px' }">
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

  <v-alert v-if="errorMessage" type="error" variant="tonal" class="mt-3" dismissible @click:close="errorMessage = ''">
    {{ errorMessage }}
  </v-alert>
</template>

<style scoped>
.soft-card { border: 1px solid rgba(var(--v-theme-primary), 0.22); border-radius: 6px; }
.toolbar-actions { width: 100%; display: flex; justify-content: flex-end; align-items: center; margin-right: 10px;}

/* Overlay über dem Chart, Container bleibt sichtbar/gerendert */
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

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: large;
  padding: 16px;
  background: linear-gradient(180deg, rgba(var(--v-theme-primary), 0.08) 0%, rgba(var(--v-theme-primary), 0.04) 100%);
  border: 1px solid rgba(var(--v-theme-primary), 0.22);
  border-radius: 8px;
}

@media (max-width: 959px) {
  .chart-card { margin-bottom: 10px; }
  .toolbar-actions .v-btn { min-width: 56px; padding: 0 10px; }
}
@media (max-width: 599px) {
  .toolbar-actions { gap: 6px; }
  .toolbar-actions .ml-2 { margin-left: 6px !important; }
}
</style>