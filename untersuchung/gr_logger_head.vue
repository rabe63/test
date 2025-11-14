<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, getCurrentInstance } from 'vue'
import * as echarts from 'echarts'
import PlotSelect from './PlotSelect.vue'
import { plotsData } from './data/treeSpeciesData.js'

const instance = getCurrentInstance()
const supabase = instance.appContext.config.globalProperties.$supabase

// disable-Liste: Plots, die in der Auswahl deaktiviert angezeigt werden sollen
const DISABLED_PLOTS = new Set(['1201','1206'])

// Plots für die Auswahl, mit disabled-Flag (von PlotSelect.vue unterstützt)
const plotsForSelect = computed(() => {
  return Object.fromEntries(
    Object.entries(plotsData || {}).map(([k, v]) => [
      k,
      { ...(v || {}), code: v?.code ?? k, disabled: DISABLED_PLOTS.has(String(k)) }
    ])
  )
})

// Props
const props = defineProps({
  schema: { type: String, default: 'public' },
  dendroView: { type: String, default: 'mv_dendro' },       // benötigt: dendro_kind = 'dendro_log'
  rainView:   { type: String, default: 'mv_rain_daily' },   // Spalten: code_plot, date_assessment, rain_mm
  defaultPlot:{ type: [String, Number], default: '1203' },
  themeMode:  { type: String, default: 'auto' }
})

// Auswahl
const selectedPlot = ref(String(props.defaultPlot || '1203'))
const availableTrees = ref([])   // number[]
const selectedTree = ref(null)   // number | null (Single-Select über Checkboxen)
const metric = ref('daily_inc')  // 'daily_inc' | 'daily_amp'

// Daten
const dendroRows = ref([])       // rows: {date_assessment, d_avg, d_min, d_max}
const rainRows = ref([])         // rows: {date_assessment, rain_mm}
const years = ref([])            // number[]
const selectedYear = ref(null)   // number | null

// Charts
let heatChart = null
let rainChart = null
const heatRef = ref(null)
const rainRef = ref(null)
const isLoading = ref(false)
const errorMessage = ref('')

// Responsive
const chartHeightHeat = ref(260) // Heatmap-Höhe
const chartHeightRain = ref(96)  // kompakter Regen-Panel
function onResize() {
  if (heatChart && heatRef.value) heatChart.resize({ height: chartHeightHeat.value, width: heatRef.value.clientWidth })
  if (rainChart && rainRef.value) rainChart.resize({ height: chartHeightRain.value, width: rainRef.value.clientWidth })
}

// Kalender-Layout-Konstanten (auch für visuelle Skala genutzt)
const CAL_TOP = 60
const CAL_BOTTOM = 10
const CAL_LEFT = 64
const CAL_RIGHT = 86
const CELL_W = 16
const CELL_H = 16

// Farbpaletten (kräftiger)
const DIV_RG = [
  '#67001f','#b2182b','#d6604d','#f4a582','#f7f7f7','#92c5de','#4393c3','#2166ac','#053061'
] // RdBu-kräftig, divergierend (Zuwachs)
const SEQ_BLUE = [
  '#deebf7','#c6dbef','#9ecae1','#6baed6','#4292c6','#2171b5','#084594'
] // kräftiger Blautonverlauf (Schwankung)

// Quantile/Range
function quantile(arr, q) {
  const v = arr.filter(x => Number.isFinite(x)).slice().sort((a,b)=>a-b)
  if (!v.length) return null
  const pos = (v.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  if (v[base+1] !== undefined) return v[base] + rest * (v[base+1]-v[base])
  return v[base]
}
function robustRange(values, mode) {
  const v = values.filter(x => Number.isFinite(x))
  if (!v.length) return {min:0, max:1}
  const p05 = quantile(v, 0.05)
  const p95 = quantile(v, 0.95)
  if (mode === 'daily_inc') {
    const maxAbs = Math.max(Math.abs(p05 ?? 0), Math.abs(p95 ?? 0), 0.1)
    return { min: -maxAbs, max: maxAbs }
  } else {
    const lo = Math.max(0, p05 ?? 0)
    const hi = Math.max(lo + 0.1, p95 ?? (lo+1))
    return { min: lo, max: hi }
  }
}

// Monat-/Wochentagslabels
const monthNameMap = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez']
const dayNameMap = ['So','Mo','Di','Mi','Do','Fr','Sa']

// Bäume laden
async function fetchTrees() {
  availableTrees.value = []
  selectedTree.value = null
  try {
    const { data, error } = await supabase
      .schema(props.schema)
      .from(props.dendroView)
      .select('tree_number')
      .eq('code_plot', Number(selectedPlot.value))
      .eq('dendro_kind', 'dendro_log')
      .order('tree_number', { ascending: true })
    if (error) throw error
    const set = new Set()
    for (const r of (data||[])) if (r?.tree_number != null) set.add(Number(r.tree_number))
    const list = Array.from(set).sort((a,b)=>a-b)
    availableTrees.value = list
    if (list.length) selectedTree.value = list[0]
  } catch (e) {
    console.error('[fetchTrees] error', e)
    errorMessage.value = 'Bäume konnten nicht geladen werden.'
  }
}

// Dendro (alle Jahre) für Baum
async function fetchDendro() {
  dendroRows.value = []
  years.value = []
  selectedYear.value = null
  if (!selectedTree.value) return
  try {
    const { data, error } = await supabase
      .schema(props.schema)
      .from(props.dendroView)
      .select('date_assessment,d_avg,d_min,d_max')
      .eq('code_plot', Number(selectedPlot.value))
      .eq('dendro_kind', 'dendro_log')
      .eq('tree_number', Number(selectedTree.value))
      .order('date_assessment', { ascending: true })
    if (error) throw error
    dendroRows.value = data || []
    const yset = new Set(dendroRows.value.map(r => new Date(r.date_assessment).getFullYear()))
    const ylist = Array.from(yset).sort((a,b)=>a-b)
    years.value = ylist
    if (ylist.length) selectedYear.value = ylist[ylist.length - 1]
  } catch (e) {
    console.error('[fetchDendro] error', e)
    errorMessage.value = 'Dendrometer-Daten konnten nicht geladen werden.'
  }
}

// Regen für Jahr
async function fetchRainForYear() {
  rainRows.value = []
  if (!selectedYear.value) return
  try {
    const start = `${selectedYear.value}-01-01`
    const end   = `${selectedYear.value}-12-31`
    const { data, error } = await supabase
      .schema(props.schema)
      .from(props.rainView)
      .select('date_assessment,rain_mm')
      .eq('code_plot', Number(selectedPlot.value))
      .gte('date_assessment', start)
      .lte('date_assessment', end)
      .order('date_assessment', { ascending: true })
    if (error) throw error
    rainRows.value = data || []
  } catch (e) {
    console.error('[fetchRainForYear] error', e)
  }
}
const rainMapForYear = computed(() => {
  const m = new Map()
  for (const r of (rainRows.value || [])) m.set(String(r.date_assessment), Number(r.rain_mm))
  return m
})

// Heatmap-Daten berechnen
function buildMetricDataForYear() {
  if (!selectedYear.value || !dendroRows.value.length) return {data:[], values:[]}
  const all = dendroRows.value.slice().sort((a,b)=> new Date(a.date_assessment) - new Date(b.date_assessment))
  const avgMap = new Map(all.map(r => [String(r.date_assessment), Number(r.d_avg)]))
  const minMap = new Map(all.map(r => [String(r.date_assessment), Number(r.d_min)]))
  const maxMap = new Map(all.map(r => [String(r.date_assessment), Number(r.d_max)]))

  const prevAvgMap = new Map()
  for (let i=1;i<all.length;i++){
    const prev = String(all[i-1].date_assessment)
    const cur  = String(all[i].date_assessment)
    prevAvgMap.set(cur, avgMap.get(prev))
  }

  const year = selectedYear.value
  const start = new Date(`${year}-01-01T00:00:00Z`)
  const end   = new Date(`${year}-12-31T00:00:00Z`)
  const result = []
  const vals = []
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate()+1)) {
    const dstr = d.toISOString().slice(0,10)
    const a = avgMap.get(dstr)
    const mi = minMap.get(dstr)
    const ma = maxMap.get(dstr)
    let value = null
    if (metric.value === 'daily_amp') {
      if (Number.isFinite(mi) && Number.isFinite(ma)) value = ma - mi
    } else {
      const prevA = prevAvgMap.get(dstr)
      if (Number.isFinite(a) && Number.isFinite(prevA)) value = a - prevA
    }
    result.push([dstr, value])
    if (Number.isFinite(value)) vals.push(value)
  }
  return { data: result, values: vals }
}

// Charts
function ensureCharts() {
  if (heatRef.value && !heatChart) heatChart = echarts.init(heatRef.value)
  if (rainRef.value && !rainChart) rainChart = echarts.init(rainRef.value)
}
function disposeCharts() {
  if (heatChart) { heatChart.dispose(); heatChart = null }
  if (rainChart) { rainChart.dispose(); rainChart = null }
}

// Titel-Helper (mit " - " statt " — ")
function plotLabel() {
  const p = plotsData[selectedPlot.value]
  return p ? `${selectedPlot.value} - ${p.name || ''}` : selectedPlot.value
}
const metricLabel = computed(() => metric.value === 'daily_inc' ? 'Zuwachs' : 'Schwankung')

// Render Heatmap
function renderHeat() {
  if (!heatChart) return
  const year = selectedYear.value
  if (!year) {
    heatChart.clear()
    heatChart.setOption({ title: { text: 'Kalender-Heatmap', left: 'left' } }, true)
    return
  }
  const { data, values } = buildMetricDataForYear()
  const range = robustRange(values, metric.value)
  const isInc = metric.value === 'daily_inc'
  const colors = isInc ? DIV_RG : SEQ_BLUE

  // visuelle Skala (visualMap) in der Länge an die Kalenderfläche anpassen:
  // Länge = Höhe des Charts - (Kalender top + bottom)
  const vmItemHeight = Math.max(140, chartHeightHeat.value - (CAL_TOP + CAL_BOTTOM))
  const vmItemWidth = 16

  heatChart.setOption({
    backgroundColor: 'transparent',
    title: { text: `Wachstum: ${plotLabel()} · Baum ${selectedTree.value} · ${metricLabel.value}`, left: 'left' },
    tooltip: {
      trigger: 'item',
      confine: true,
      formatter: (p) => {
        const d = p.value?.[0]
        const v = p.value?.[1]
        const rain = rainMapForYear.value.get(String(d))
        const vStr = (v==null || !Number.isFinite(v)) ? '–' : `${Number(v).toFixed(3)} mm`
        const rStr = (rain==null || !Number.isFinite(rain)) ? '–' : `${Number(rain).toFixed(2)} mm`
        return `${d}<br/>${metricLabel.value}: ${vStr}<br/>Regen: ${rStr}`
      }
    },
    visualMap: {
      min: range.min,
      max: range.max,
      orient: 'vertical',
      right: 0,
      top: 50,          
      bottom: CAL_BOTTOM,      // (wir setzen zusätzlich itemHeight, da continuous visualMap sonst fix 140px ist)
      itemHeight: vmItemHeight,
      itemWidth: vmItemWidth,
      calculable: true,
      inRange: { color: colors },
      formatter: v => `${Number(v).toFixed(2)}`
    },
    calendar: {
      top: CAL_TOP,
      left: CAL_LEFT,          // mehr Platz links → Wochentage nicht abgeschnitten
      right: CAL_RIGHT,        // Platz für visualMap rechts
      bottom: CAL_BOTTOM,
      range: String(year),
      cellSize: [CELL_W, CELL_H],
      splitLine: { show: false },
      itemStyle: { borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.12)' },
      dayLabel: { firstDay: 1, nameMap: dayNameMap, margin: 10 }, // zusätzlicher Abstand
      monthLabel: { nameMap: monthNameMap }
    },
    series: [{
      type: 'heatmap',
      coordinateSystem: 'calendar',
      data
    }]
  }, true)
}

// Render Regen (kompakt, volle 10er Schritte, ohne y-Achsenname)
function renderRain() {
  if (!rainChart) return
  const year = selectedYear.value
  if (!year) {
    rainChart.clear()
    rainChart.setOption({ title: { text: 'Niederschlag (mm)', left: 'left' } }, true)
    return
  }
  const start = new Date(`${year}-01-01T00:00:00Z`)
  const end   = new Date(`${year}-12-31T00:00:00Z`)
  const dates = []
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate()+1)) dates.push(d.toISOString().slice(0,10))
  const vals = dates.map(d => {
    const v = rainMapForYear.value.get(d)
    return Number.isFinite(v) ? v : 0
  })
  // Monatsmitte für x-Achsenlabels
  const monthMidSet = (() => {
    const map = new Map() // key -> { firstIdx, lastIdx }
    for (let i = 0; i < dates.length; i++) {
      const d = new Date(dates[i])
      const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`
      if (!map.has(key)) map.set(key, { first: i, last: i })
      else map.get(key).last = i
    }
    const s = new Set()
    for (const rng of map.values()) {
      const mid = Math.floor((rng.first + rng.last) / 2)
      s.add(mid)
    }
    return s
  })() 

  const maxRain = Math.max(0, ...vals)
  const yMaxRounded = Math.max(10, Math.ceil(maxRain / 10) * 10) // volle 10er Schritte

  const isMobile = (rainRef.value?.clientWidth || 800) < 600

  rainChart.setOption({
    backgroundColor: 'transparent',
    title: { text: `Niederschlag (mm) - ${year}`, left: 'left' },
    tooltip: { trigger: 'axis' },
    grid: { left: 60, right: 76, top: 28, bottom: 40 }, // mehr Platz unten für Labels
    xAxis: [
      { // Achse 0: Ticks bleiben am Monatsanfang
        type: 'category',
        data: dates,
        axisLabel: { show: false },
        axisTick: {
          alignWithLabel: true,
          interval: (idx) => new Date(dates[idx]).getUTCDate() === 1
        },
        axisLine: { show: true },
        position: 'bottom'
      },
      { // Achse 1: Labels in Monatsmitte, ebenfalls unten platzieren
        type: 'category',
        data: dates,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          interval: (idx) => monthMidSet.has(idx),
          formatter: (val) => {
            const d = new Date(val)
            return d.toLocaleString('de-DE', { month: 'short' })
          },
          fontSize: isMobile ? 9 : 10,
          align: 'center',
          margin: 6
        },
        position: 'bottom',
        offset: 0 // ggf. z.B. 8 oder 12 setzen, um Labels weiter nach außen zu schieben
      }
    ],
    yAxis: {
      type: 'value',
      min: 0,
      max: yMaxRounded,
      interval: 10,                          // volle 10er Schritte
      axisLabel: { formatter: (v)=> Number(v).toFixed(0), fontSize: isMobile?9:10 },
      splitLine: { show: true }
      // kein name: für mehr Platz
    },
    series: [{
      type: 'bar',
      name: 'Regen',
      data: vals,
      barWidth: '65%',
      itemStyle: { color: '#4aa2f0' }
    }]
  }, true)
}

// Export: PNG (Heatmap), CSV kombiniert (Heatmap-Metrik + Regen)
function downloadName(base, ext) {
  const ts = new Date().toISOString().substring(0,19).replace(/[:]/g,'-')
  return `${base}_${ts}.${ext}`
}
function downloadHeatPNG() {
  if (!heatChart) return
  try {
    const dataURL = heatChart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' })
    const a = document.createElement('a')
    a.href = dataURL
    a.download = downloadName(`heatmap_${selectedPlot.value}_baum${selectedTree.value}_${metric.value}_${selectedYear.value}`, 'png')
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  } catch (e) { console.error('PNG Export fehlgeschlagen', e) }
}
function generateCombinedCSV() {
  if (!selectedYear.value) return ''
  const { data } = buildMetricDataForYear() // [dateStr, metricVal]
  const rows = []
  rows.push(`# Dendrometer Heatmap + Regen`)
  rows.push(`# Plot:\t\t${plotLabel()}`)
  rows.push(`# Baum:\t\t${selectedTree.value}`)
  rows.push(`# Kennwert:\t${metricLabel.value}`)
  rows.push(`# Jahr:\t\t${selectedYear.value}`)
  rows.push(`# Erstellt:\t${new Date().toISOString().replace('T',' ').substring(0,19)} UTC`)
  rows.push('# Quelle:\tICP Forest Data des Landesbetrieb Forst Brandenburg')
  rows.push('# Link:\t\thttps://forstliche-umweltkontrolle.de/dauerbeobachtung/level-ii/')
  rows.push('')
  rows.push('Date,Metric_mm,Rain_mm')
  for (const [dateStr, val] of data) {
    const rain = rainMapForYear.value.get(dateStr)
    const vStr = (val==null||!Number.isFinite(val)) ? '' : Number(val).toFixed(3)
    const rStr = (rain==null||!Number.isFinite(rain)) ? '' : Number(rain).toFixed(2)
    rows.push(`${dateStr},${vStr},${rStr}`)
  }
  return rows.join('\n')
}
function downloadCombinedCSV() {
  const csv = generateCombinedCSV()
  if (!csv) return
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = downloadName(`heatmap_rain_${selectedPlot.value}_tree${selectedTree.value}_${metric.value}_${selectedYear.value}`, 'csv')
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(a.href)
}

// Watchers
watch(selectedPlot, async () => {
  isLoading.value = true; errorMessage.value = ''
  await fetchTrees()
  await fetchDendro()
  await fetchRainForYear()
  await nextTick(); ensureCharts(); renderHeat(); renderRain()
  isLoading.value = false
})
watch(selectedTree, async () => {
  if (selectedTree.value == null) return
  isLoading.value = true; errorMessage.value = ''
  await fetchDendro()
  await fetchRainForYear()
  await nextTick(); ensureCharts(); renderHeat(); renderRain()
  isLoading.value = false
})
watch(selectedYear, async () => {
  await fetchRainForYear()
  await nextTick(); ensureCharts(); renderHeat(); renderRain()
})
watch(metric, () => { renderHeat() })

// Lifecycle
onMounted(async () => {
  window.addEventListener('resize', onResize, { passive: true })
  await nextTick(); ensureCharts()
  isLoading.value = true
  await fetchTrees()
  await fetchDendro()
  await fetchRainForYear()
  await nextTick(); renderHeat(); renderRain()
  isLoading.value = false
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  disposeCharts()
})
</script>

<template>
  <div class="page">
    <!-- Card 1: Plot (kein Card-in-Card) -->
    <PlotSelect
      v-model="selectedPlot"
      :plots="plotsForSelect"
      :columns="5"
      color="green-darken-2"
      class="mb-3"
    />

    <!-- Card 2: Baum + Kennwert (Checkboxen als Single-Choice) -->
    <v-card elevation="1" class="mb-3 soft-card">
      <v-card-title class="pb-2 title-row soft-green">Dendrometerbaum und Kennwert</v-card-title>
      <v-card-text>
        <div class="controls">
          <!-- Baum: Checkboxen, aber nur eine Auswahl; begrenzte Breite + Umbruch -->
          <div class="tree-select">
            <div class="label block">Baum</div>
            <div class="tree-checkboxes">
              <v-checkbox
                v-for="t in availableTrees"
                :key="t"
                :label="String(t)"
                color="green-darken-2"
                density="compact"
                hide-details
                :model-value="selectedTree === t"
                @update:modelValue="val => {
                  if (val) selectedTree = t
                  else if (selectedTree === t) selectedTree = null
                }"
              />
            </div>
            <div v-if="!availableTrees.length" class="muted">Keine Logger-Bäume gefunden.</div>
          </div>

          <!-- Kennwert: Checkboxen als Single-Choice + Icon mit Ultrakurz-Erklärung (Klick) -->
          <div class="metric-select">
            <div class="label-row">
              <div class="label">Kennwert</div>
              <v-tooltip open-on-click location="top" max-width="420">
                <template #activator="{ props }">
                  <v-btn
                    v-bind="props"
                    icon
                    variant="text"
                    density="comfortable"
                    class="metric-help-btn"
                    aria-label="Kennwert-Erklärung"
                  >
                    <v-icon icon="mdi-help-circle-outline" />
                  </v-btn>
                </template>
                <div class="tooltip-metrics">
                  <div><strong>Zuwachs</strong>: Δ zum Vortag, d_avg(heute) − d_avg(gestern) [mm]</div>
                  <div><strong>Schwankung</strong>: Tagesamplitude, d_max − d_min [mm]</div>
                </div>
              </v-tooltip>
            </div>

            <div class="metric-checkboxes">
              <v-checkbox
                label="Zuwachs"
                color="green-darken-2"
                density="compact"
                hide-details
                :model-value="metric === 'daily_inc'"
                @update:modelValue="val => { if (val) metric = 'daily_inc' }"
              />
              <v-checkbox
                label="Schwankung"
                color="green-darken-2"
                density="compact"
                hide-details
                :model-value="metric === 'daily_amp'"
                @update:modelValue="val => { if (val) metric = 'daily_amp' }"
              />
            </div>
          </div>
        </div>
      </v-card-text>
    </v-card>

    <!-- Card 3: Heatmap + Regen mit Toolbar oben rechts -->
    <v-card elevation="1" class="mb-3 soft-card">
      <v-toolbar density="comfortable" color="transparent" flat>
        <div class="toolbar-actions">
          <v-btn size="small" variant="elevated tonal" color="primary"
                 @click="downloadHeatPNG" :disabled="!selectedYear" title="Heatmap als PNG speichern">PNG</v-btn>
          <v-btn size="small" variant="elevated tonal" color="primary"
                 @click="downloadCombinedCSV" :disabled="!selectedYear" class="ml-2"
                 title="Heatmap + Regen als CSV exportieren">CSV</v-btn>
        </div>
      </v-toolbar>

      <v-card-text>
        <!-- Jahresauswahl -->
        <div class="years-row" v-if="years.length">
          <div class="label">Jahr</div>
          <v-chip-group v-model="selectedYear" column mandatory>
            <v-chip
              v-for="y in years"
              :key="y"
              :value="y"
              size="small"
              variant="elevated"
              color="primary"
              :class="{'mr-2': true}"
            >{{ y }}</v-chip>
          </v-chip-group>
        </div>

        <!-- Heatmap -->
        <div :style="{ width: '100%', height: chartHeightHeat + 'px' }" ref="heatRef" class="chart-surface" />

        <!-- Regenpanel (ohne Header-Text über dem Chart) -->
        <div :style="{ width: '100%', height: chartHeightRain + 'px' }" ref="rainRef" class="chart-surface mt-2" />

        <v-overlay v-model="isLoading" contained class="align-center justify-center">
          <v-progress-circular color="primary" indeterminate size="52" />
        </v-overlay>

        <v-alert v-if="errorMessage" type="error" variant="tonal" class="mt-3" dismissible @click:close="errorMessage = ''">
          {{ errorMessage }}
        </v-alert>
      </v-card-text>
    </v-card>
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; }

/* Cards */
.soft-card { border: 1px solid rgba(var(--v-theme-primary), 0.22); border-radius: 6px; }
.toolbar-actions { width: 100%; display: flex; justify-content: flex-end; align-items: center; margin-right: 10px;}
.soft-green {
  background: linear-gradient(180deg, rgba(var(--v-theme-primary), 0.06) 0%, rgba(var(--v-theme-primary), 0.03) 100%);
}

/* Controls */
.controls {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.tree-select {
  max-width: 450px; /* gewünschte Begrenzung, sorgt für Umbruch nach "Baum" */
}
.tree-select, .metric-select {
  display: flex; align-items: flex-start; gap: 10px; flex-wrap: wrap;
}
.tree-checkboxes, .metric-checkboxes { display: flex; gap: 10px 16px; flex-wrap: wrap; }
.label { font-weight: 600; color: #555; }
.label.block { flex-basis: 100%; } /* Überschrift in eigener Zeile */
.label-row { display: flex; align-items: center; gap: 6px; flex-basis: 100%; }
.metric-help-btn { min-width: 28px; height: 28px; padding: 0; }
.tooltip-metrics { font-size: 12px; line-height: 1.35; max-width: 380px; }

.muted { color: #777; }

/* Years */
.years-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }

/* Charts */
.chart-surface { background: transparent; }

@media (max-width: 959px) {
  .controls { grid-template-columns: 1fr; }
}
</style>