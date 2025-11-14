<script setup>
// v13 – Witterungsdaten (Line-/Area-Chart mit Min/Mean/Max-Band)
// Update:
// - Luftdruck entfernt.
// - RH: Y-Achse auf 0..100 begrenzt.
// - WD/ET/PR/TF: Min/Max (Band/Serien) unterdrückt, auch in Tooltip & CSV.
// - Tooltip: Reihenfolge max/mean/min, nur reale Werte anzeigen.

import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, getCurrentInstance } from 'vue'
import * as echarts from 'echarts'
import PlotSelect from './PlotSelect.vue'
import { plotsData } from './data/treeSpeciesData.js'

// Supabase
const instance = getCurrentInstance()
const supabase = instance.appContext.config.globalProperties.$supabase

// Props
const props = defineProps({
  sensorSchema: { type: String, default: 'public' },
  sensorView:   { type: String, default: 'v_sensor_code' },
  seriesSchema: { type: String, default: 'icp_download' },
  seriesView:   { type: String, default: 'mm_mem' },
  seriesValueColumn: { type: String, default: 'value' }, // Alias für daily_mean
  defaultPlot: { type: [String, Number], default: '1203' },
  themeMode: { type: String, default: 'auto' }
})

// Auswahl-State
const selectedPlot = ref(String(props.defaultPlot || '1203'))
const selectedLocation = ref('F') // 'S' Bestand, 'F' Freifläche (Default: Freifläche)
const selectedVariable = ref('AT') // Standardvariable
const selectedSensorCodes = ref([]) // Multi-Select

// FF: Plots ohne Freifläche (ausblenden)
const FF_EXCLUDED_PLOTS = new Set(['1207', '1209'])
const displayedPlots = computed(() => {
  if (selectedLocation.value !== 'F') return plotsData
  const out = {}
  for (const [k, v] of Object.entries(plotsData)) {
    if (!FF_EXCLUDED_PLOTS.has(String(k))) out[k] = v
  }
  return out
})
function ensurePlotAllowedForLocation() {
  if (selectedLocation.value === 'F' && FF_EXCLUDED_PLOTS.has(String(selectedPlot.value))) {
    const keys = Object.keys(displayedPlots.value)
    if (keys.length) selectedPlot.value = keys[0]
  }
}

// Sensor-Metadaten (einmalig)
const allSensors = ref([])

// Sensorliste für aktuellen Plot/Variable/Location
const sensorRows = computed(() => {
  if (!allSensors.value.length || !selectedPlot.value || !selectedVariable.value || !selectedLocation.value) return []
  const plotNum = Number(selectedPlot.value)
  return allSensors.value.filter(r =>
    Number(r.code_plot) === plotNum &&
    String(r.code_variable) === String(selectedVariable.value) &&
    String(r.code_location) === String(selectedLocation.value)
  )
})
const availableSensorCodes = computed(() => {
  const set = new Set()
  for (const r of sensorRows.value) if (r?.sensor_code) set.add(String(r.sensor_code))
  return Array.from(set).sort()
})
const currentUnit = computed(() => sensorRows.value.find(Boolean)?.unit || '')

// Chart-/Daten-Refs
let myChart = null
const chartContainer = ref(null)
const chartHeight = ref(600)
const screenWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1024)
const xAxisData = ref([])      // Datumsstrings (YYYY-MM-DD)
const seriesData = ref([])     // ECharts series
const rawSeries = ref([])      // Raw aus Backend
const isLoading = ref(false)
const errorMessage = ref('')

// Legendengruppen (ein Eintrag pro Sensor)
const legendGroupNames = ref([]) // in Reihenfolge (Code -> Instrument)
const groupMeta = ref(new Map()) // groupName -> {hasMin:boolean, hasMax:boolean}

// X-Achse: Jahreslabels
const yearLabelIndexSet = ref(new Set()) // Indizes in xAxisData, an denen ein neues Jahr beginnt

// Zoom-Persistenz
const ZOOM_KEY = computed(() =>
  `mm_witterung_line.zoom.${selectedPlot.value}.${selectedLocation.value}.${selectedVariable.value}`
)
const savedZoom = ref(null)
function clamp01(x){ return Math.max(0, Math.min(100, x)) }
function tryLoadZoom() {
  try {
    const raw = localStorage.getItem(ZOOM_KEY.value)
    if (!raw) return null
    const z = JSON.parse(raw)
    if (z && Number.isFinite(z.start) && Number.isFinite(z.end)) {
      return { start: clamp01(Number(z.start)), end: clamp01(Number(z.end)) }
    }
  } catch {}
  return null
}
function saveZoom(z) {
  try {
    if (!z) return
    const payload = { start: clamp01(Number(z.start ?? 0)), end: clamp01(Number(z.end ?? 100)) }
    savedZoom.value = payload
    localStorage.setItem(ZOOM_KEY.value, JSON.stringify(payload))
  } catch {}
}

// Theme-Erkennung
const isDark = computed(() => {
  if (props.themeMode === 'dark') return true
  if (props.themeMode === 'light') return false
  try { if (document?.documentElement?.classList?.contains('v-theme--dark')) return true } catch {}
  try { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches } catch {}
  return false
})

// Responsive
function computeChartHeight(w){ if (w<600) return 360; if (w<960) return 480; return 600 }
function onWindowResize(){
  screenWidth.value = window.innerWidth
  chartHeight.value = computeChartHeight(screenWidth.value)
  if (myChart && chartContainer.value) {
    myChart.resize({ height: chartHeight.value, width: chartContainer.value.clientWidth })
  }
}

// Variablen-Optionen (ohne Luftdruck)
const VARS_BESTAND = [
  { code: 'AT', label: 'Lufttemperatur', icon: 'mdi-thermometer' },
  { code: 'RH', label: 'Relative Luftfeuchtigkeit', icon: 'mdi-water-percent' },
  { code: 'TF', label: 'Bestandsniederschlag', icon: 'mdi-weather-rainy' }
]
const VARS_FREIFL = [
  { code: 'AT', label: 'Lufttemperatur', icon: 'mdi-thermometer' },
  { code: 'RH', label: 'Relative Luftfeuchtigkeit', icon: 'mdi-water-percent' },
  { code: 'AP', label: 'Luftdruck', icon: 'mdi-gauge' },
  { code: 'PR', label: 'Niederschlag', icon: 'mdi-weather-rainy' },
  { code: 'WS', label: 'Windgeschwindigkeit', icon: 'mdi-weather-windy' },
  { code: 'WD', label: 'Windrichtung', icon: 'mdi-compass' },
  { code: 'SR', label: 'Globalstrahlung', icon: 'mdi-weather-sunny' },
  { code: 'ET', label: 'Potenzielle Verdunstung', icon: 'mdi-water-outline' }
]
const variableOptions = computed(() => selectedLocation.value === 'S' ? VARS_BESTAND : VARS_FREIFL)
const variableLabel = computed(() =>
  variableOptions.value.find(o => o.code === selectedVariable.value)?.label || selectedVariable.value
)
function onToggleVariable(code, checked) {
  if (!checked && selectedVariable.value === code) return
  selectedVariable.value = code
}

// Für diese Variablen KEINE Min/Max verwenden (auch wenn vorhanden)
const NO_EXTREMES = new Set(['WD', 'ET', 'PR', 'TF'])

// Farben – Palette + HSL-Abschwächung (stabil je Sensorcode)
const DEPTH_PALETTE = [
  '#0072B2', '#E69F00', '#009E73', '#D55E00', '#CC79A7',
  '#56B4E9', '#F0E442', '#2C3E50', '#1ABC9C', '#3D5B2D', '#E91E63'
]
function hexToHsl(hex) {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  const r = parseInt(h.slice(0,2),16)/255
  const g = parseInt(h.slice(2,4),16)/255
  const b = parseInt(h.slice(4,6),16)/255
  const max = Math.max(r,g,b), min = Math.min(r,g,b)
  let hh, s, l = (max + min) / 2
  if (max === min) { hh = s = 0 }
  else {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: hh = (g - b) / d + (g < b ? 6 : 0); break
      case g: hh = (b - r) / d + 2; break
      case b: hh = (r - g) / d + 4; break
    }
    hh /= 6
  }
  return { h: hh*360, s: s*100, l: l*100 }
}
function hslToHex(h,s,l) {
  h /= 360; s /= 100; l /= 100
  const hue2rgb = (p,q,t)=>{ if(t<0)t+=1; if(t>1)t-=1; if(t<1/6)return p+(q-p)*6*t; if(t<1/2)return q; if(t<2/3)return p+(q-p)*(2/3-t)*6; return p }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const r = Math.round(hue2rgb(p,q,h+1/3)*255)
  const g = Math.round(hue2rgb(p,q,h)*255)
  const b = Math.round(hue2rgb(p,q,h-1/3)*255)
  const toHex = (x)=>x.toString(16).padStart(2,'0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}
function varyWithinDepth(hex, variantIdx, isDarkTheme) {
  const { h, s, l } = hexToHsl(hex)
  const step = 3 // feinere Abstufung
  const satFactor = Math.pow(0.92, Math.max(0, variantIdx))
  const newL = isDarkTheme ? Math.min(90, l + step * variantIdx)
                           : Math.max(10, l - step * variantIdx)
  const newS = Math.max(20, s * satFactor)
  return hslToHex(h, newS, newL)
}
function withAlpha(hex, alpha=1) {
  const h = hex.replace('#','')
  const r = parseInt(h.slice(0,2),16)
  const g = parseInt(h.slice(2,4),16)
  const b = parseInt(h.slice(4,6),16)
  return `rgba(${r},${g},${b},${alpha})`
}

// Stabile Farbreferenz je Plot/Variable/Location (per sensor_code)
const codeOrder = ref([])                 // sortierte Liste der Codes
const codeToInstOrder = ref(new Map())    // Code -> sortierte Liste der Instrumente
const codeBaseColorMap = ref(new Map())   // Code -> Basisfarbe aus Palette

function recomputeCodeMaps() {
  const rows = sensorRows.value || []
  const presentCodes = Array.from(new Set(rows.map(r => String(r.sensor_code)))).filter(Boolean).sort()
  codeOrder.value = presentCodes

  const instMap = new Map()
  for (const code of presentCodes) {
    const insts = rows.filter(r => String(r.sensor_code) === code).map(r => Number(r.instrument_seq_nr))
    instMap.set(code, Array.from(new Set(insts)).sort((a,b)=>a-b))
  }
  codeToInstOrder.value = instMap

  const colorMap = new Map()
  presentCodes.forEach((code, i) => {
    colorMap.set(code, DEPTH_PALETTE[i % DEPTH_PALETTE.length])
  })
  codeBaseColorMap.value = colorMap
}

// Hilfsfunktionen
function buildInstrumentDisplayIndex(rowsForCode) {
  const sorted = [...rowsForCode].sort((a,b)=>Number(a.instrument_seq_nr)-Number(b.instrument_seq_nr))
  const map = new Map(); sorted.forEach((row, idx)=> map.set(row.instrument_seq_nr, idx+1))
  return map
}
function niceNum(x, round) {
  const exp = Math.floor(Math.log10(x))
  const f = x / Math.pow(10, exp)
  let nf
  if (round) {
    if (f < 1.5) nf = 1
    else if (f < 3) nf = 2
    else if (f < 7) nf = 5
    else nf = 10
  } else {
    if (f <= 1) nf = 1
    else if (f <= 2) nf = 2
    else if (f <= 5) nf = 5
    else nf = 10
  }
  return nf * Math.pow(10, exp)
}
function computeYAxisBounds() {
  if (!myChart) return {min:null, max:null}
  const opt = myChart.getOption()
  const legendSel = opt?.legend?.[0]?.selected || {}
  let minV = Infinity, maxV = -Infinity
  const series = opt?.series || []
  for (const s of series) {
    if (s.type!=='line') continue
    // Band-/Helper-Serien überspringen: identifizierbar an id-Präfix
    const sid = s.id || ''
    if (sid.startsWith('bandbase-') || sid.startsWith('bandfill-')) continue
    const visible = legendSel[s.name] !== false
    if (!visible) continue
    for (const v of (s.data||[])) {
      if (v==null) continue
      const num = Number(v); if (!Number.isFinite(num)) continue
      minV=Math.min(minV,num); maxV=Math.max(maxV,num)
    }
  }
  if (!Number.isFinite(minV)||!Number.isFinite(maxV)) return {min:null,max:null}
  const targetTicks = 6
  const rawRange = Math.max(1e-6, maxV - minV)
  const niceRange = niceNum(rawRange, true)
  const tick = niceNum(niceRange / (targetTicks - 1), true)
  let niceMin = Math.floor(minV / tick) * tick
  let niceMax = Math.ceil(maxV / tick) * tick

  // Y-Achsenregeln:
  if (selectedVariable.value === 'AT') {
    // AT: negative Werte erlaubt → nicht bei 0 kappen
    if (niceMax === niceMin) niceMax = niceMin + tick
    return { min: niceMin, max: niceMax }
  }
  if (selectedVariable.value === 'RH') {
    // RH: 0..100 %
    return { min: 0, max: 100 }
  }

  // Sonst: Minimum nicht unter 0
  niceMin = Math.max(0, niceMin)
  if (niceMax === niceMin) niceMax = niceMin + tick
  return { min: niceMin, max: niceMax }
}
function computeDataZoomRange() {
  if (!xAxisData.value.length) return {start:0, end:100}
  if (savedZoom.value) return savedZoom.value
  const dates = xAxisData.value
  const lastDate = new Date(dates[dates.length-1]); if (isNaN(lastDate)) return {start:0,end:100}
  const minWanted = new Date(lastDate); minWanted.setFullYear(minWanted.getFullYear()-5)
  let startIdx=0; for(let i=0;i<dates.length;i++){ const d=new Date(dates[i]); if (d>=minWanted){ startIdx=i; break } }
  const total = Math.max(1, dates.length-1)
  return { start: (startIdx/total)*100, end: 100 }
}

// Download (CSV/PNG)
function downloadName(dat_ext) {
  if (dat_ext==='header') {
    const typ = selectedLocation.value === 'S' ? 'Bestand' : 'Freifläche'
    return '# Witterungsdaten – ' + typ + '\n' +
      `# Plot:\t\t${selectedPlot.value} — ${plotsData[selectedPlot.value]?.name || ''}\n` +
      `# Variable:\t${variableLabel.value}\n` +
      `# Sensoren:\t${selectedSensorCodes.value.join(', ')}\n` +
      `# Erstellt:\t${new Date().toISOString().replace('T',' ').substring(0,19)} UTC\n` +
      '# Quelle:\tICP Forest Data des Landesbetrieb Forst Brandenburg\n' +
      '# Link:\t\thttps://forstliche-umweltkontrolle.de/dauerbeobachtung/level-ii/\n'
  }
  const ts = new Date().toISOString().substring(0,19).replace(/[:]/g,'-')
  return `mm_witterung_line_${selectedPlot.value}_${selectedLocation.value}_${selectedVariable.value}_${ts}.${dat_ext}`
}
function headerForSeries(s) {
  const id = s.id || ''
  let suffix = ''
  if (id.endsWith('-min')) suffix = ' min'
  else if (id.endsWith('-max')) suffix = ' max'
  else if (id.endsWith('-mean')) suffix = ' mean'
  return (s.name || '') + suffix
}
function generateCSV() {
  if (!seriesData.value.length || !xAxisData.value.length) return ''
  const csv = []
  csv.push(downloadName('header')); csv.push('')
  // Nur sichtbare, nicht-Band-Serien in die CSV
  const headers=['Date']
  seriesData.value.forEach(s => {
    const sid = s.id || ''
    if (sid.startsWith('bandbase-') || sid.startsWith('bandfill-')) return
    headers.push(headerForSeries(s))
  })
  csv.push(headers.join(','))
  xAxisData.value.forEach((dateStr, idx) => {
    const row=[dateStr]
    seriesData.value.forEach(s => {
      const sid = s.id || ''
      if (sid.startsWith('bandbase-') || sid.startsWith('bandfill-')) return
      const v=s.data[idx]; row.push(v==null?'':Number(v).toFixed(2))
    })
    csv.push(row.join(','))
  })
  return csv.join('\n')
}
function downloadCSV(){ const csv=generateCSV(); if(!csv){ errorMessage.value='Keine Daten zum Download verfügbar'; return }
  const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'}); const a=document.createElement('a'); const url=URL.createObjectURL(blob)
  a.href=url; a.download=downloadName('csv'); a.style.visibility='hidden'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
}
function downloadChartPNG(){
  if(!myChart) return
  try{ const dataURL=myChart.getDataURL({type:'png',pixelRatio:2,backgroundColor:'#fff'})
    const a=document.createElement('a'); a.href=dataURL; a.download=downloadName('png'); document.body.appendChild(a); a.click(); document.body.removeChild(a)
  } catch(e){ console.error('PNG Export fehlgeschlagen', e) }
}

// Sensoren einmalig laden
async function fetchAllSensorsOnce() {
  if (allSensors.value.length) return
  try {
    const { data, error } = await supabase
      .schema(props.sensorSchema)
      .from(props.sensorView)
      .select('code_plot,instrument_seq_nr,code_location,code_variable,vertikal,unit,sensor_code')
      .order('sensor_code', { ascending: true })
      .order('instrument_seq_nr', { ascending: true })
    if (error) throw error
    allSensors.value = data || []
  } catch (e) {
    console.error('[fetchAllSensorsOnce] error', e)
    allSensors.value = []
  }
}

// Default Sensor-Auswahl
function ensureDefaultSensorSelection() {
  const codes = availableSensorCodes.value
  if (!codes.length) {
    selectedSensorCodes.value = []
    return
  }
  if (!selectedSensorCodes.value.length || !codes.includes(selectedSensorCodes.value[0])) {
    selectedSensorCodes.value = [codes[0]]
  }
}

// Zeitreihen laden (mit Min/Mean/Max + Band)
async function fetchSeries() {
  rawSeries.value = []; xAxisData.value = []; seriesData.value = []
  yearLabelIndexSet.value = new Set(); legendGroupNames.value = []; groupMeta.value = new Map()

  if (!selectedPlot.value || !selectedVariable.value || !selectedSensorCodes.value.length) {
    await nextTick(); await ensureChart(); await renderChart(true)
    return
  }

  // Aktuelle Auswahl → Instrumente
  const selectedRows = sensorRows.value.filter(r => selectedSensorCodes.value.includes(String(r.sensor_code)))
  const instSet = new Set(selectedRows.map(r => Number(r.instrument_seq_nr)))
  if (!instSet.size) { await nextTick(); await ensureChart(); await renderChart(true); return }

  try {
    isLoading.value = true; errorMessage.value = ''

    // Aliase: daily_mean, daily_max, daily_min
    const valueSelect =
      (props.seriesSchema==='icp_download' && props.seriesView==='mm_mem' && props.seriesValueColumn==='value')
        ? 'value:daily_mean,value_max:daily_max,value_min:daily_min'
        : `${props.seriesValueColumn},value_max:daily_max,value_min:daily_min`

    const { data, error } = await supabase
      .schema(props.seriesSchema)
      .from(props.seriesView)
      .select(`code_plot,instrument_seq_nr,code_variable,date_observation,${valueSelect}`)
      .eq('code_plot', Number(selectedPlot.value))
      .eq('code_variable', selectedVariable.value)
      .in('instrument_seq_nr', Array.from(instSet))
      .order('instrument_seq_nr', { ascending: true })
      .order('date_observation', { ascending: true })
    if (error) throw error

    rawSeries.value = data || []

    // X-Achse
    const dateSet = new Set()
    for (const r of rawSeries.value) if (r?.date_observation) dateSet.add(String(r.date_observation))
    const dates = Array.from(dateSet).sort((a,b)=> new Date(a)-new Date(b))
    xAxisData.value = dates

    // Jahreslabels (erster Punkt jedes Jahres)
    const yearsSeen = new Set()
    const yearIdxSet = new Set()
    dates.forEach((d, idx) => {
      const y = new Date(d).getFullYear()
      if (!yearsSeen.has(y)) { yearsSeen.add(y); yearIdxSet.add(idx) }
    })
    yearLabelIndexSet.value = yearIdxSet

    // Label-Index je sensor_code: "(1),(2),..."
    const rowsByCode = new Map()
    for (const code of selectedSensorCodes.value) {
      rowsByCode.set(code, sensorRows.value.filter(r => String(r.sensor_code) === String(code)))
    }
    const labelIndexMap = new Map()
    for (const [code, rows] of rowsByCode.entries()) {
      const idxMap = buildInstrumentDisplayIndex(rows)
      for (const [instrument, idx] of idxMap.entries()) labelIndexMap.set(`${code}-${instrument}`, idx)
    }

    // Serien (stabil sortiert: Code -> Instrument)
    const seriesList = []
    const groupNames = []
    for (const code of codeOrder.value) {
      const instsInCode = codeToInstOrder.value.get(code) || []
      for (const inst of instsInCode) {
        if (!instSet.has(inst)) continue

        // passender Row sicher nach code + inst
        const sensorRow = selectedRows.find(r => String(r.sensor_code) === code && Number(r.instrument_seq_nr) === Number(inst))
        if (!sensorRow) continue

        const sensorCode = String(sensorRow.sensor_code)
        const groupName = `${sensorCode} (${inst})`
        groupNames.push(groupName)

        const baseColor = codeBaseColorMap.value.get(code) || DEPTH_PALETTE[0]
        // Mean: kräftigster Ton; Min/Max: leicht abgeschwächt (Opacity)
        const colorMeanHex = varyWithinDepth(baseColor, 0, isDark.value)
        const colorMinHex  = varyWithinDepth(baseColor, 1, isDark.value)
        const colorMaxHex  = varyWithinDepth(baseColor, 2, isDark.value)

        const colorMean = withAlpha(colorMeanHex, 1.0)
        const colorMin  = withAlpha(colorMinHex, 0.78)
        const colorMax  = withAlpha(colorMaxHex, 0.78)

        // Punkte
        const points = rawSeries.value.filter(r => Number(r.instrument_seq_nr) === Number(inst))
        const byDateMean = new Map(points.map(p => [String(p.date_observation), Number(p.value)]))
        const byDateMax  = new Map(points.map(p => [String(p.date_observation), Number(p.value_max)]))
        const byDateMin  = new Map(points.map(p => [String(p.date_observation), Number(p.value_min)]))
        const dataMean = dates.map(d => { const v = byDateMean.get(d); return (v==null || Number.isNaN(v)) ? null : v })
        const dataMax  = dates.map(d => { const v = byDateMax.get(d);  return (v==null || Number.isNaN(v)) ? null : v })
        const dataMin  = dates.map(d => { const v = byDateMin.get(d);  return (v==null || Number.isNaN(v)) ? null : v })

        let hasAnyMin = dataMin.some(v => v!=null)
        let hasAnyMax = dataMax.some(v => v!=null)

        // Für Variablen ohne Extremwerte global deaktivieren
        if (NO_EXTREMES.has(selectedVariable.value)) {
          hasAnyMin = false
          hasAnyMax = false
        }
        groupMeta.value.set(groupName, { hasMin: hasAnyMin, hasMax: hasAnyMax })

        // Band (unsichtbare Baseline + Diff-Fläche)
        if (hasAnyMin && hasAnyMax) {
          const bandStack = `band-${sensorCode}-${inst}`
          const bandColor = withAlpha(colorMeanHex, 1.0)

          // Baseline (min)
          seriesList.push({
            id: `bandbase-${sensorCode}-${inst}`,
            name: groupName,
            type: 'line',
            stack: bandStack,
            stackStrategy: 'all', // auch bei negativen Werten
            data: dataMin,
            color: bandColor,
            lineStyle: { width: 0 },
            itemStyle: { color: bandColor, borderColor: bandColor },
            symbol: 'none',
            showSymbol: false,
            connectNulls: false,
            areaStyle: undefined,
            tooltip: { show: false },
            legendHoverLink: false,
            silent: true,
            z: 1
          })
          // Band (max-min)
          const bandDiff = dates.map((d, i) => {
            const vmin = dataMin[i]; const vmax = dataMax[i]
            if (vmin==null || vmax==null || !isFinite(vmin) || !isFinite(vmax)) return null
            return Math.max(0, vmax - vmin)
          })
          seriesList.push({
            id: `bandfill-${sensorCode}-${inst}`,
            name: groupName,
            type: 'line',
            stack: bandStack,
            stackStrategy: 'all',
            data: bandDiff,
            color: bandColor,
            lineStyle: { width: 0 },
            itemStyle: { color: bandColor, borderColor: bandColor },
            symbol: 'none',
            showSymbol: false,
            connectNulls: false,
            areaStyle: { color: withAlpha(colorMeanHex, 1.0), opacity: 0.18 },
            tooltip: { show: false },
            legendHoverLink: false,
            silent: true,
            z: 1
          })
        }

        // Sichtbare Linien: Min / Mean / Max (Serie-Name = Gruppe!)
        if (hasAnyMin) {
          seriesList.push({
            id: `series-${sensorCode}-${inst}-min`,
            name: groupName,
            type:'line',
            color: colorMin,
            data: dataMin,
            symbol:'circle',
            symbolSize:3,
            showSymbol:false,
            connectNulls:false,
            lineStyle:{ width:1, color: colorMin, opacity: 0.78 },
            itemStyle:{ color: colorMin, borderColor: colorMin, opacity: 0.78 },
            emphasis: { focus: 'series', lineStyle: { width: 2 } },
            blur: { lineStyle: { color: '#bbb', width: 1 }, itemStyle: { color: '#bbb', borderColor: '#bbb' } },
            legendHoverLink: true,
            z: 2
          })
        }
        // Mean (immer)
        seriesList.push({
          id: `series-${sensorCode}-${inst}-mean`,
          name: groupName,
          type:'line',
          color: colorMean,
          data: dataMean,
          symbol:'circle',
          symbolSize:3,
          showSymbol:false,
          connectNulls:false,
          lineStyle:{ width:1.4, color: colorMean, opacity: 1.0 },
          itemStyle:{ color: colorMean, borderColor: colorMean, opacity: 1.0 },
          emphasis: { focus: 'series', lineStyle: { width: 2.2 } },
          blur: { lineStyle: { color: '#bbb', width: 1 }, itemStyle: { color: '#bbb', borderColor: '#bbb' } },
          legendHoverLink: true,
          z: 3
        })
        if (hasAnyMax) {
          seriesList.push({
            id: `series-${sensorCode}-${inst}-max`,
            name: groupName,
            type:'line',
            color: colorMax,
            data: dataMax,
            symbol:'circle',
            symbolSize:3,
            showSymbol:false,
            connectNulls:false,
            lineStyle:{ width:1, color: colorMax, opacity: 0.78 },
            itemStyle:{ color: colorMax, borderColor: colorMax, opacity: 0.78 },
            emphasis: { focus: 'series', lineStyle: { width: 2 } },
            blur: { lineStyle: { color: '#bbb', width: 1 }, itemStyle: { color: '#bbb', borderColor: '#bbb' } },
            legendHoverLink: true,
            z: 2
          })
        }
      }
    }

    seriesData.value = seriesList
    legendGroupNames.value = Array.from(new Set(groupNames))

    await nextTick()
    await ensureChart()
    await renderChart(true)
  } catch (e) {
    console.error('[fetchSeries] error', e)
    errorMessage.value = 'Fehler beim Laden der Zeitreihen: ' + (e?.message || e)
    await nextTick(); await ensureChart(); await renderChart(true)
  } finally { isLoading.value = false }
}

// Legend-Hover nur für Serien (Band bleibt aus)
function syncLegendHoverLinks() {
  if (!myChart) return
  const opt = myChart.getOption()
  const selectedMap = opt?.legend?.[0]?.selected || {}
  const seriesOpt = opt?.series || []
  const updates = seriesOpt.map(s => {
    const sid = s.id || ''
    const isBand = sid.startsWith('bandbase-') || sid.startsWith('bandfill-')
    return {
      id: s.id || s.name,
      legendHoverLink: isBand ? false : (selectedMap[s.name] !== false)
    }
  })
  if (updates.length) {
    myChart.setOption({ series: updates }, false, true)
  }
}

// Chart
function onLegendSelectChanged() {
  const yb = computeYAxisBounds()
  if (myChart && (yb.min != null || yb.max != null)) {
    myChart.setOption({ yAxis: { min: yb.min ?? null, max: yb.max ?? null } }, false, true)
  }
  syncLegendHoverLinks()
}
async function ensureChart() {
  if (!chartContainer.value) return
  if (!myChart) {
    myChart = echarts.init(chartContainer.value)
    myChart.resize({ height: chartHeight.value, width: chartContainer.value.clientWidth })
    myChart.on('dataZoom', () => {
      try { const dz=(myChart.getOption().dataZoom||[])[0]; if(dz) saveZoom({start:dz.start??0,end:dz.end??100}) } catch {}
    })
    myChart.on('legendselectchanged', onLegendSelectChanged)
  } else {
    myChart.resize({ height: chartHeight.value, width: chartContainer.value.clientWidth })
  }
}
async function renderChart(resetZoomOnFirst=false) {
  if (!myChart) return
  if (!xAxisData.value.length || !seriesData.value.length) {
    myChart.clear()
    myChart.setOption({
      backgroundColor: 'transparent',
      title: { text: 'Bitte wählen Sie einen Sensor', left: 'center', top: 'middle', textStyle:{ color:'#999' } },
      xAxis: { type: 'category', data: [] },
      yAxis: { type: 'value' },
      series: []
    }, true)
    return
  }
  const dz = computeDataZoomRange()
  const yb = computeYAxisBounds()
  const isMobile = screenWidth.value < 600

  // Jahreslabel nur am Jahresanfang
  const yearIndexSet = yearLabelIndexSet.value
  const axisLabelInterval = (index/*, value*/) => yearIndexSet.has(index)
  const axisLabelFormatter = (val) => {
    const d = new Date(val)
    const y = d.getFullYear()
    return isFinite(y) ? String(y) : val
  }

  myChart.setOption({
    backgroundColor: 'transparent',
    title: [
      { left: 'left', text: 'Witterungsdaten der Beobachtungsflächen' },
      { left: 'left', bottom: 0, text: 'ICP Forest Data des Landesbetrieb Forst Brandenburg', textStyle: { fontSize: isMobile?10:12, color:'#999' } },
      { left: 'right', bottom: 0, text: 'forstliche-umweltkontrolle.de', textStyle: { fontSize: isMobile?10:12, color:'#999' } }
    ],
    legend: {
      top: isMobile?60:70, type:'scroll', icon:'circle', itemWidth:16, itemHeight:10,
      inactiveColor:'#bbb', textStyle:{ fontSize:isMobile?10:12 },
      // nur ein Eintrag je Sensor (Gruppenname)
      data: legendGroupNames.value,
      selectedMode:true
    },
    tooltip: {
      trigger:'axis', axisPointer:{ type:'cross' },
      formatter:(params)=>{
        if(!params||!params.length) return ''
        const date=params[0].axisValueLabel||params[0].axisValue
        // Gruppiert nach Gruppenname (seriesName), nur Einträge mit Zahlenwerten behalten
        const groups = new Map()
        params.forEach(p=>{
          const sid = p.seriesId || ''
          if (sid.startsWith('bandbase-') || sid.startsWith('bandfill-')) return
          const num = Number(p.value)
          if (!Number.isFinite(num)) return // "empty" entfernen
          const gn = p.seriesName || ''
          const arr = groups.get(gn) || []
          arr.push(p)
          groups.set(gn, arr)
        })
        if (groups.size === 0) return `<strong>${date}</strong><br/>`
        let out=`<strong>${date}</strong><br/>`
        for (const [gn, arrRaw] of groups.entries()) {
          // Reihenfolge max, mean, min
          const arr = arrRaw.slice().sort((a,b)=>{
            const sKey = (sid)=> sid.endsWith('-max') ? 0 : (sid.endsWith('-mean') ? 1 : 2)
            return sKey(a.seriesId) - sKey(b.seriesId)
          })
          // Serien, die global nicht existieren (kein min/max), ausblenden
          const meta = groupMeta.value.get(gn) || {}
          const filtered = arr.filter(p=>{
            const sid = p.seriesId || ''
            if (sid.endsWith('-min') && !meta.hasMin) return false
            if (sid.endsWith('-max') && !meta.hasMax) return false
            return true
          })
          if (!filtered.length) continue
          out += `<em>${gn}</em><br/>`
          filtered.forEach(p=>{
            const sid = p.seriesId || ''
            const lab = sid.endsWith('-min') ? 'min' : (sid.endsWith('-max') ? 'max' : 'mean')
            const val=Number(p.value); const u=currentUnit.value?` ${currentUnit.value}`:''
            out += `<span style="display:inline-block;margin-right:6px;border-radius:50%;width:8px;height:8px;background:${p.color}"></span>`
            out += `${lab}: ${val.toFixed(2)}${u}<br/>`
          })
        }
        return out
      }
    },
    grid: { left:isMobile?40:64, right:isMobile?30:64, top:isMobile?120:140, bottom:84 },
    xAxis: { 
      type:'category',
      data:xAxisData.value,
      axisLabel:{ 
        rotate: 0,
        align: 'center',
        interval: axisLabelInterval,
        formatter: axisLabelFormatter,
        margin: isMobile?16:20,
        hideOverlap: true
      },
      axisTick: { alignWithLabel: true }
    },
    yAxis: { 
      type:'value',
      name:`${variableLabel.value}${currentUnit.value?` [${currentUnit.value}]`:''}`,
      nameTextStyle:{ fontSize:isMobile?10:12, padding:[0,0,0,22] },
      min: yb.min ?? null,
      max: yb.max ?? null,
      splitLine:{ show:true },
      axisLabel:{ margin: 12 },
      scale:true 
    },
    dataZoom: [
      { type:'inside', start:dz.start, end:dz.end },
      { 
        type:'slider', bottom:22, height:isMobile?20:26, start:dz.start, end:dz.end, brushSelect:false,
        showDataShadow: true,                 
        backgroundColor: 'transparent',
        showDetail: false
      }
    ],
    series: seriesData.value
  }, true)

  syncLegendHoverLinks()

  if (resetZoomOnFirst) {
    setTimeout(()=> {
      const cur=myChart.getOption().dataZoom?.[0]
      if (cur) {
        myChart.setOption({ dataZoom: [
          { ...cur, start: dz.start, end: dz.end },
          { ...(myChart.getOption().dataZoom?.[1]||{}), start: dz.start, end: dz.end }
        ] })
      }
    },0)
  }
}

function hasHoehenstufe() {
  // Prüft, ob mindestens ein Sensorcode einen Unterstrich enthält (z. B. WS_025)
  return availableSensorCodes.value.some(code => String(code).includes('_'))
}

// Watches
watch(selectedLocation, () => {
  ensurePlotAllowedForLocation()
})
watch([selectedPlot, selectedVariable, selectedLocation], async () => {
  savedZoom.value = tryLoadZoom()
  recomputeCodeMaps()        // stabile Farbreferenz je Plot/Variable/Location
  ensureDefaultSensorSelection()
  await nextTick(); await ensureChart()
  await fetchSeries()
})
watch(selectedSensorCodes, async (nv, ov) => {
  const prev = new Set(ov || [])
  const next = new Set(nv || [])
  const added = [...next].filter(c => !prev.has(c))
  const removed = [...prev].filter(c => !next.has(c))

  if (added.length || removed.length) {
    await nextTick(); await ensureChart()
    await fetchSeries()
  } else {
    await nextTick(); await ensureChart(); await renderChart(false)
  }
}, { deep:true })

// Lifecycle
onMounted(async () => {
  window.addEventListener('resize', onWindowResize, { passive:true })
  screenWidth.value = window.innerWidth
  chartHeight.value = computeChartHeight(screenWidth.value)

  // FF-Start: falls defaultPlot ausgeschlossen ist, auf erstes verfügbares wechseln
  ensurePlotAllowedForLocation()

  await nextTick()
  await ensureChart()
  await renderChart(true)

  savedZoom.value = tryLoadZoom()

  await fetchAllSensorsOnce()
  recomputeCodeMaps()
  ensureDefaultSensorSelection()
  await fetchSeries()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  if (myChart) { myChart.dispose(); myChart=null }
})

// Expose
defineExpose({ downloadCSV, downloadChartPNG })
</script>

<template>
  <div class="mm-page">
    <!-- Card 1: Nur Plotauswahl (bei F werden 1207/1209 ausgeblendet) -->
    <PlotSelect
      v-model="selectedPlot"
      :plots="displayedPlots"
      :columns="5"
      color="green-darken-2"
    />

    <!-- Card 2: Variablen + B/F-Schalter + Sensoren -->
    <v-card elevation="1" class="mb-3">
      <v-card-title class="pb-2 title-row soft-green">
        Sensorengruppe
        <div class="type-row ml-4">
          <v-checkbox
            :model-value="selectedLocation === 'S'"
            density="compact" hide-details color="green-darken-2"
            label="Bestandsflächen"
            @update:model-value="val => selectedLocation = val ? 'S' : (selectedLocation === 'S' ? 'F' : selectedLocation)"
          >
            <template #prepend>
              <v-icon class="mr-2" :color="selectedLocation === 'S' ? 'green-darken-2' : 'grey'">mdi-forest</v-icon>
            </template>
          </v-checkbox>

          <v-checkbox
            :model-value="selectedLocation === 'F'"
            density="compact" hide-details color="green-darken-2"
            label="Freiflächen"
            @update:model-value="val => selectedLocation = val ? 'F' : (selectedLocation === 'F' ? 'S' : selectedLocation)"
          >
            <template #prepend>
              <v-icon class="mr-2" :color="selectedLocation === 'F' ? 'green-darken-2' : 'grey'">mdi-white-balance-sunny</v-icon>
            </template>
          </v-checkbox>
        </div>
      </v-card-title>

      <v-card-text>
        <div class="vars-row">
          <div class="vars-grid">
            <v-checkbox
              v-for="opt in variableOptions"
              :key="opt.code"
              :label="opt.label"
              :model-value="selectedVariable === opt.code"
              color="green-darken-2"
              density="compact"
              hide-details
              @update:model-value="(val) => onToggleVariable(opt.code, val)"
            >
              <template #prepend>
                <v-icon class="mr-2" :color="selectedVariable === opt.code ? 'green-darken-2' : 'grey'">
                  {{ opt.icon }}
                </v-icon>
              </template>
            </v-checkbox>
          </div>
        </div>

        <div class="sensors-block">
          <v-card-title class="pb-2 title-row soft-green">
            Sensoren <span style="font-size:0.8em; font-weight:normal;">(Mehrfachauswahl)</span>
            <span v-if="currentUnit" class="muted">Einheit: {{ currentUnit }}</span>
            <span class="muted" style="font-size: 0.8em; float: right;">
                Aufbau: {{ hasHoehenstufe() ? 'Sensor_Höhenstufe' : 'Sensor' }} (InstrumentNummer)
              </span>
          </v-card-title>

          <div v-if="availableSensorCodes.length" class="sensors-grid">
            <v-checkbox
              v-for="code in availableSensorCodes"
              :key="code"
              v-model="selectedSensorCodes"
              :value="code"
              :label="code"
              color="green-darken-2"
              density="compact"
              hide-details
            />
          </div>

          <v-alert v-else type="info" variant="tonal" density="comfortable" class="mt-2">
            Keine Sensoren für Plot {{ selectedPlot }}, {{ selectedLocation === 'S' ? 'Bestand' : 'Freifläche' }}, Variable {{ selectedVariable }}.
          </v-alert>
        </div>
      </v-card-text>
    </v-card>

    <!-- Card 3: Chart -->
    <v-card elevation="1" class="mb-3 soft-card ">
      <v-toolbar density="comfortable" color="transparent" flat>
        <div class="toolbar-actions">
          <v-btn size="small" variant="elevated tonal" color="primary"
                 @click="downloadChartPNG" :disabled="isLoading || !seriesData.length" title="Chart als PNG speichern">PNG</v-btn>
          <v-btn size="small" variant="elevated tonal" color="primary"
                 @click="downloadCSV" :disabled="!seriesData.length || !xAxisData.length"
                 class="ml-2" title="Chartdaten als CSV exportieren">CSV</v-btn>
        </div>
      </v-toolbar>
      <v-card-text>
        <div :style="{ position: 'relative', width: '100%', height: chartHeight + 'px' }">
          <div ref="chartContainer" :style="{ width: '100%', height: chartHeight + 'px' }" />
          <v-overlay v-model="isLoading" contained class="align-center justify-center">
            <v-progress-circular color="primary" indeterminate size="52" />
          </v-overlay>
        </div>

        <v-alert v-if="!seriesData.length" variant="plain" color="primary" border="start" elevation="0" class="mt-3">
          Bitte wählen Sie Sensor(en).
        </v-alert>

        <v-alert v-if="errorMessage" type="error" variant="tonal" class="mt-3" dismissible @click:close="errorMessage = ''">
          {{ errorMessage }}
        </v-alert>
      </v-card-text>
    </v-card>
  </div>
</template>

<style scoped>
.mm-page { display: flex; flex-direction: column; }
.type-row { display: inline-flex; align-items: center; gap: 18px; }
.vars-row { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.vars-grid { display: grid; grid-template-columns: repeat(4, minmax(200px, 1fr)); gap: 8px 12px; }
.sensors-block { margin: 5px 0px 0px 15px; }
.sensors-grid {
  display: grid; grid-template-columns: repeat(6, minmax(120px, 1fr)); gap: 6px 12px; padding-left: 20px;
}
.muted { color: #777; font-weight: 400; font-size: 90%; padding-left: 20px; }
.soft-card { border: 1px solid rgba(var(--v-theme-primary), 0.22); border-radius: 6px; }
.toolbar-actions { width: 100%; display: flex; justify-content: flex-end; align-items: center; margin-right: 10px;}
.soft-green {
  background: linear-gradient(180deg, rgba(var(--v-theme-primary), 0.06) 0%, rgba(var(--v-theme-primary), 0.03) 100%);
}
@media (max-width: 1199px) { .sensors-grid { grid-template-columns: repeat(4, minmax(120px, 1fr)); } }
@media (max-width: 959px)  { .vars-grid { grid-template-columns: repeat(2, minmax(200px, 1fr)); }
                             .sensors-grid { grid-template-columns: repeat(3, minmax(120px, 1fr)); } }
@media (max-width: 599px)  { .vars-grid { grid-template-columns: repeat(1, minmax(200px, 1fr)); }
                             .sensors-grid { grid-template-columns: repeat(2, minmax(120px, 1fr)); } }
</style>