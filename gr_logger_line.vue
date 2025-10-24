<script setup>
// Wachstum (Dendrometer tägliche Erfassung) – Linechart mit Min/Mean/Max-Band
// Fixes:
// - Neu ausgewählte Bäume werden sofort sichtbar (Legenden-Selektionszustand erhalten, neue = selected).
// - Y-Achse wird bei Baum-Auswahl/Abwahl, Legendenklick und DataZoom dynamisch neu gesetzt.

import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, getCurrentInstance } from 'vue'
import * as echarts from 'echarts'
import PlotSelect from './PlotSelect.vue'
import { plotsData } from './data/treeSpeciesData.js'

// Supabase
const instance = getCurrentInstance()
const supabase = instance.appContext.config.globalProperties.$supabase

// Props (Schema/Quelle anpassbar)
const props = defineProps({
  seriesSchema: { type: String, default: 'public' },
  seriesView:   { type: String, default: 'mv_dendro_daily' },
  defaultPlot:  { type: [String, Number], default: '1203' }, // Kienhorst 1203
  themeMode:    { type: String, default: 'auto' }
})

// Auswahl-State
const selectedPlot = ref(String(props.defaultPlot || '1203'))
const availableTrees = ref([])          // z. B. ['51', '72', '104', ...] für den Plot
const selectedTrees = ref([])           // Multi-Select; Default: erster Baum

// Chart-/Daten-Refs
let myChart = null
const chartContainer = ref(null)
const chartHeight = ref(600)
const screenWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1024)
const xAxisData = ref([])      // Datumsstrings (YYYY-MM-DD)
const seriesData = ref([])     // ECharts series
const rawRows = ref([])        // Raw aus MV
const isLoading = ref(false)
const errorMessage = ref('')
const DENDRO_TYPE = 1.2  // Dendrometer-Typ für Logger (1.2)

// Legende (ein Eintrag pro Baum)
const legendGroupNames = ref([]) // z. B. ['51', '72', ...]
const groupHasMinMax = ref(new Map()) // map: tree -> { hasMin:boolean, hasMax:boolean }

// X-Achsen-Labelsätze
const yearStartIndexSet = ref(new Set())
const monthStartIndexSet = ref(new Set())

// Zoom-Persistenz (pro Plot)
const ZOOM_KEY = computed(() => `gr_logger_line.zoom.${selectedPlot.value}`)
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

// Farben – farbenblindheitsfreundliche Palette (7+)
const BASE_PALETTE = [
  '#0072B2', // blau
  '#E69F00', // orange
  '#009E73', // grün
  '#D55E00', // vermillion
  '#CC79A7', // pink/purple
  '#56B4E9', // hellblau
  '#F0E442', // gelb
  '#2C3E50', // navy
  '#1ABC9C', // teal
  '#3D5B2D', // olive
  '#E91E63'  // pink
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
  const toHex = (x)=>x.toString(16).toUpperCase().padStart(2,'0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}
function withAlpha(hex, a=1) {
  const c = hex.replace('#','')
  const r = parseInt(c.slice(0,2),16)
  const g = parseInt(c.slice(2,4),16)
  const b = parseInt(c.slice(4,6),16)
  return `rgba(${r},${g},${b},${a})`
}
function soften(hex, ratio=0.78) {
  const { h, s, l } = hexToHsl(hex)
  const newS = Math.max(20, s * 0.9)
  const newL = l
  return withAlpha(hslToHex(h, newS, newL), ratio)
}
// Farbkarten stabil je Plot (alle Bäume des Plots, nicht nur Auswahl)
const treeColorMap = ref(new Map()) // tree_number -> baseHex
function recomputeTreeColors() {
  const trees = [...availableTrees.value]
  const map = new Map()
  trees.forEach((t, i) => {
    map.set(t, BASE_PALETTE[i % BASE_PALETTE.length])
  })
  treeColorMap.value = map
}

// Helpers: “schöne” Y-Achsen-Bounds (1-2-5)
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
  const rawRange = Math.max(1e-9, maxV - minV)
  const niceRange = niceNum(rawRange, true)
  const tick = niceNum(niceRange / (targetTicks - 1), true)
  let niceMin = Math.floor(minV / tick) * tick
  let niceMax = Math.ceil(maxV / tick) * tick
  if (niceMax === niceMin) niceMax = niceMin + tick
  return { min: niceMin, max: niceMax }
}
function adjustYAxisNow() {
  if (!myChart) return
  const yb = computeYAxisBounds()
  if (yb.min != null || yb.max != null) {
    myChart.setOption({ yAxis: { min: yb.min ?? null, max: yb.max ?? null } }, false, true)
  }
}

// X-Achse Labelmodus je Zoomfenster (<= 3 Jahre → Monate, sonst Jahre)
function buildYearMonthIndexSets() {
  const dates = xAxisData.value || []
  const ySet = new Set()
  const mSet = new Set()
  let prevYear = null, prevMonth = null
  dates.forEach((dstr, idx) => {
    const d = new Date(dstr)
    const y = d.getFullYear(), m = d.getMonth()
    if (y !== prevYear) { ySet.add(idx); prevYear = y }
    if (m !== prevMonth) { mSet.add(idx); prevMonth = m }
  })
  yearStartIndexSet.value = ySet
  monthStartIndexSet.value = mSet
}
function currentZoomIndexSpan() {
  if (!myChart) return {startIdx:0, endIdx:(xAxisData.value.length?xAxisData.value.length-1:0)}
  const dz = myChart.getOption()?.dataZoom?.[0]
  const n = Math.max(1, xAxisData.value.length-1)
  const start = clamp01(dz?.start ?? 0)/100
  const end   = clamp01(dz?.end ?? 100)/100
  const startIdx = Math.round(start * n)
  const endIdx   = Math.round(end   * n)
  return { startIdx, endIdx }
}
function labelModeFromZoom() {
  const { startIdx, endIdx } = currentZoomIndexSpan()
  const dates = xAxisData.value
  if (!dates.length) return 'years'
  const d0 = new Date(dates[Math.max(0, startIdx)])
  const d1 = new Date(dates[Math.min(dates.length-1, endIdx)])
  const ms = d1 - d0
  const years = ms / (365.25*24*3600*1000)
  return years <= 3 ? 'months' : 'years'
}
function applyAxisLabelMode() {
  if (!myChart) return
  const mode = labelModeFromZoom()
  const ySet = yearStartIndexSet.value
  const mSet = monthStartIndexSet.value
  const interval = (idx/*, val*/) => (mode==='months' ? mSet.has(idx) : ySet.has(idx))
  const formatter = (val) => {
    const d = new Date(val)
    if (mode === 'months') {
      const y = d.getFullYear()
      const m = d.toLocaleString('de-DE', { month: 'short' })
      return `${m} ${String(y)}`
    } else {
      return String(d.getFullYear())
    }
  }
  myChart.setOption({
    xAxis: {
      axisLabel: {
        interval,
        formatter
      }
    }
  }, false, true)
}

// DataZoom-Start: letzte 5 Jahre
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
function plotLabel() {
  const p = plotsData[selectedPlot.value]
  return p ? `${selectedPlot.value} — ${p.name || ''}` : selectedPlot.value
}
function downloadName(dat_ext) {
  if (dat_ext==='header') {
    return '# Dendrometerdaten\n' +
      `# Plot:\t\t${plotLabel()}\n` +
      `# Bäume:\t${selectedTrees.value.join(', ')}\n` +
      `# Erstellt:\t${new Date().toISOString().replace('T',' ').substring(0,19)} UTC\n` +
      '# Quelle:\tICP Forest Data des Landesbetrieb Forst Brandenburg\n' +
      '# Link:\t\thttps://forstliche-umweltkontrolle.de/dauerbeobachtung/level-ii/\n'
  }
  const ts = new Date().toISOString().substring(0,19).replace(/[:]/g,'-')
  return `dendrometer_logger_${selectedPlot.value}_${ts}.${dat_ext}`
}
function generateCSV() {
  if (!seriesData.value.length || !xAxisData.value.length) return ''
  // CSV mit Spalten: Date, <tree>_max, <tree>_mean, <tree>_min (pro Baum)
  const order = ['max','mean','min']
  const csv = []
  csv.push(downloadName('header')); csv.push('')
  const headers = ['Date']
  const trees = legendGroupNames.value
  trees.forEach(t => { order.forEach(sfx => headers.push(`${t}_${sfx}`)) })
  csv.push(headers.join(','))
  xAxisData.value.forEach((dateStr, idx) => {
    const row=[dateStr]
    trees.forEach(t => {
      const sMax  = seriesData.value.find(s => s.id === `series-${t}-max`)
      const sMean = seriesData.value.find(s => s.id === `series-${t}-mean`)
      const sMin  = seriesData.value.find(s => s.id === `series-${t}-min`)
      const vMax  = sMax?.data?.[idx]
      const vMean = sMean?.data?.[idx]
      const vMin  = sMin?.data?.[idx]
      row.push(vMax==null?'':Number(vMax).toFixed(3))
      row.push(vMean==null?'':Number(vMean).toFixed(3))
      row.push(vMin==null?'':Number(vMin).toFixed(3))
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

// Bäume eines Plots laden (distinct tree_number)
async function fetchTreesForPlot() {
  availableTrees.value = [] 
  try { 
    const { data, error } = await supabase 
    .schema(props.seriesSchema) 
    .from(props.seriesView)
    .select('tree_number')
    .eq('code_plot', Number(selectedPlot.value))
    .eq('code_dendrometer', DENDRO_TYPE) // nur Logger-Bäume
    .order('tree_number', { ascending: true })
    if (error) throw error
    const set = new Set()
    for (const r of (data||[])) if (r?.tree_number!=null) set.add(String(r.tree_number))
    availableTrees.value = Array.from(set)
    recomputeTreeColors()
    if (!availableTrees.value.length) {
      selectedTrees.value = []
    } else if (!selectedTrees.value.length || !availableTrees.value.includes(selectedTrees.value[0])) {
      selectedTrees.value = [availableTrees.value[0]]
    } else {
      selectedTrees.value = selectedTrees.value.filter(t => availableTrees.value.includes(t))
      if (!selectedTrees.value.length) selectedTrees.value = [availableTrees.value[0]]
    }
  } catch (e) {
    console.error('[fetchTreesForPlot] error', e)
    availableTrees.value = []
    // selectedTrees.value = []
  }
}

// Zeitreihen laden und Chartdaten bauen
async function fetchSeries() {
  rawRows.value = []; xAxisData.value = []; seriesData.value = []
  legendGroupNames.value = []; groupHasMinMax.value = new Map()
  yearStartIndexSet.value = new Set(); monthStartIndexSet.value = new Set()

  if (!selectedPlot.value || !selectedTrees.value.length) {
    await nextTick(); await ensureChart(); await renderChart(true)
    return
  }

  try {
    isLoading.value = true; errorMessage.value = ''

    const { data, error } = await supabase
      .schema(props.seriesSchema)
      .from(props.seriesView)
      .select('code_plot,tree_number,date_assessment,d_avg,d_min,d_max,n_obs')
      .eq('code_plot', Number(selectedPlot.value))
      .eq('code_dendrometer', Number(1.2)) // Logger
      .in('tree_number', selectedTrees.value)
      .order('tree_number', { ascending: true })
      .order('date_assessment', { ascending: true })
    if (error) throw error

    rawRows.value = data || []

    // X-Achse (alle distinct Tage)
    const dateSet = new Set()
    for (const r of rawRows.value) if (r?.date_assessment) dateSet.add(String(r.date_assessment))
    const dates = Array.from(dateSet).sort((a,b)=> new Date(a)-new Date(b))
    xAxisData.value = dates
    buildYearMonthIndexSets()

    // Gruppen (Bäume)
    const groups = Array.from(new Set(selectedTrees.value))
    const sList = []
    const groupMeta = new Map()

    for (const t of groups) {
      const baseHex = treeColorMap.value.get(t) || BASE_PALETTE[0]
      const colorMean = withAlpha(baseHex, 1.0)
      const colorMin  = soften(baseHex, 0.78)
      const colorMax  = soften(baseHex, 0.78)

      const rows = (rawRows.value || []).filter(r => String(r.tree_number) === String(t))
      const byDateMean = new Map(rows.map(p => [String(p.date_assessment), Number(p.d_avg)]))
      const byDateMin  = new Map(rows.map(p => [String(p.date_assessment), Number(p.d_min)]))
      const byDateMax  = new Map(rows.map(p => [String(p.date_assessment), Number(p.d_max)]))

      const dataMean = dates.map(d => {
        const v = byDateMean.get(d)
        return (v==null || Number.isNaN(v)) ? null : v
      })
      const dataMin = dates.map(d => {
        const v = byDateMin.get(d)
        return (v==null || Number.isNaN(v)) ? null : v
      })
      const dataMax = dates.map(d => {
        const v = byDateMax.get(d)
        return (v==null || Number.isNaN(v)) ? null : v
      })

      const hasAnyMin = dataMin.some(v => v!=null)
      const hasAnyMax = dataMax.some(v => v!=null)
      groupMeta.set(t, { hasMin: hasAnyMin, hasMax: hasAnyMax })

      // Band: Baseline (min) + Diff (max-min)
      if (hasAnyMin && hasAnyMax) {
        const bandStack = `band-${t}`

        sList.push({
          id: `bandbase-${t}`,
          name: t, // Gruppenname für Legende
          type: 'line',
          stack: bandStack,
          stackStrategy: 'all',
          data: dataMin,
          color: colorMean,
          lineStyle: { width: 0 },
          itemStyle: { color: colorMean, borderColor: colorMean },
          symbol: 'none',
          showSymbol: false,
          connectNulls: false,
          areaStyle: undefined,
          tooltip: { show: false },
          legendHoverLink: false,
          silent: true,
          z: 1
        })
        const bandDiff = dates.map((d, i) => {
          const vmin = dataMin[i]; const vmax = dataMax[i]
          if (vmin==null || vmax==null || !isFinite(vmin) || !isFinite(vmax)) return null
          return Math.max(0, vmax - vmin)
        })
        sList.push({
          id: `bandfill-${t}`,
          name: t,
          type: 'line',
          stack: bandStack,
          stackStrategy: 'all',
          data: bandDiff,
          color: colorMean,
          lineStyle: { width: 0 },
          itemStyle: { color: colorMean, borderColor: colorMean },
          symbol: 'none',
          showSymbol: false,
          connectNulls: false,
          areaStyle: { color: withAlpha(baseHex, 1.0), opacity: 0.18 },
          tooltip: { show: false },
          legendHoverLink: false,
          silent: true,
          z: 1
        })
      }

      // Linien: min / mean / max (Name = Gruppenname → ein Legendeneintrag pro Baum)
      if (hasAnyMin) {
        sList.push({
          id: `series-${t}-min`,
          name: t,
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
      sList.push({
        id: `series-${t}-mean`,
        name: t,
        type:'line',
        color: withAlpha(baseHex, 1.0),
        data: dataMean,
        symbol:'circle',
        symbolSize:3,
        showSymbol:false,
        connectNulls:false,
        lineStyle:{ width:1.6, color: withAlpha(baseHex, 1.0), opacity: 1.0 },
        itemStyle:{ color: withAlpha(baseHex, 1.0), borderColor: withAlpha(baseHex, 1.0), opacity: 1.0 },
        emphasis: { focus: 'series', lineStyle: { width: 2.4 } },
        blur: { lineStyle: { color: '#bbb', width: 1 }, itemStyle: { color: '#bbb', borderColor: '#bbb' } },
        legendHoverLink: true,
        z: 3
      })
      if (hasAnyMax) {
        sList.push({
          id: `series-${t}-max`,
          name: t,
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

    seriesData.value = sList
    legendGroupNames.value = groups
    groupHasMinMax.value = groupMeta

    await nextTick()
    await ensureChart()
    await renderChart(true) // setzt Option komplett und initialisiert Zoom
  } catch (e) {
    console.error('[fetchSeries] error', e)
    errorMessage.value = 'Fehler beim Laden der Dendrometer-Daten: ' + (e?.message || e)
    await nextTick(); await ensureChart(); await renderChart(true)
  } finally { isLoading.value = false }
}

// Chart helpers
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
function onLegendSelectChanged() {
  adjustYAxisNow()
  syncLegendHoverLinks()
}
function onDataZoom() {
  try {
    const dz=(myChart.getOption().dataZoom||[])[0]
    if (dz) saveZoom({start:dz.start??0,end:dz.end??100})
  } catch {}
  applyAxisLabelMode()
  adjustYAxisNow()
}

async function ensureChart() {
  if (!chartContainer.value) return
  if (!myChart) {
    myChart = echarts.init(chartContainer.value)
    myChart.resize({ height: chartHeight.value, width: chartContainer.value.clientWidth })
    myChart.on('dataZoom', onDataZoom)
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
      title: { text: 'Bitte wählen Sie mindestens einen Baum', left: 'center', top: 'middle', textStyle:{ color:'#999' } },
      xAxis: { type: 'category', data: [] },
      yAxis: { type: 'value' },
      series: []
    }, true)
    return
  }
  const dz = computeDataZoomRange()
  const yb = computeYAxisBounds()
  const isMobile = screenWidth.value < 600

  // Vorhandene Legenden-Selektion beibehalten; neue Bäume standardmäßig sichtbar machen
  const prevSelected = (myChart.getOption()?.legend?.[0]?.selected) || {}
  const legendSelected = {}
  for (const name of legendGroupNames.value) {
    legendSelected[name] = Object.prototype.hasOwnProperty.call(prevSelected, name) ? prevSelected[name] : true
  }

  // Tooltip gruppiert je Baum; Reihenfolge max, mean, min; nur echte Zahlenwerte
  const tooltipFormatter = (params) => {
    if(!params||!params.length) return ''
    const date=params[0].axisValueLabel||params[0].axisValue
    const groups = new Map()
    params.forEach(p=>{
      const sid = p.seriesId || ''
      if (sid.startsWith('bandbase-') || sid.startsWith('bandfill-')) return
      const num = Number(p.value); if (!Number.isFinite(num)) return
      const gn = p.seriesName || ''
      const arr = groups.get(gn) || []
      arr.push(p); groups.set(gn, arr)
    })
    if (!groups.size) return `<strong>${date}</strong><br/>`
    let out=`<strong>${date}</strong><br/>`
    for (const [gn, arrRaw] of groups.entries()) {
      const meta = groupHasMinMax.value.get(gn) || {}
      const arr = arrRaw.slice().sort((a,b)=>{
        const sKey = (sid)=> sid.endsWith('-max') ? 0 : (sid.endsWith('-mean') ? 1 : 2)
        return sKey(a.seriesId) - sKey(b.seriesId)
      }).filter(p=>{
        const sid = p.seriesId || ''
        if (sid.endsWith('-min') && !meta.hasMin) return false
        if (sid.endsWith('-max') && !meta.hasMax) return false
        return true
      })
      if (!arr.length) continue
      out += `<em>Baum ${gn}</em><br/>`
      arr.forEach(p=>{
        const sid = p.seriesId || ''
        const lab = sid.endsWith('-min') ? 'min' : (sid.endsWith('-max') ? 'max' : 'mean')
        const val=Number(p.value)
        out += `<span style="display:inline-block;margin-right:6px;border-radius:50%;width:8px;height:8px;background:${p.color}"></span>`
        out += `${lab}: ${val.toFixed(3)} mm<br/>`
      })
    }
    return out
  }

  // Achsenlabels (werden nach SetOption je nach Zoom aktualisiert)
  const axisLabel = {
    interval: (idx)=> yearStartIndexSet.value.has(idx),
    formatter: (val)=> String(new Date(val).getFullYear()),
    margin: isMobile?16:20,
    hideOverlap: true
  }

  myChart.setOption({
    backgroundColor: 'transparent',
    title: [
      { left: 'left', text: 'Wachstum (Dendrometer tägliche Erfassung)' },
      { left: 'left', bottom: 0, text: 'ICP Forest Data des Landesbetrieb Forst Brandenburg', textStyle: { fontSize: isMobile?10:12, color:'#999' } },
      { left: 'right', bottom: 0, text: 'forstliche-umweltkontrolle.de', textStyle: { fontSize: isMobile?10:12, color:'#999' } }
    ],
    legend: {
      top: isMobile?60:70, type:'scroll', icon:'circle', itemWidth:16, itemHeight:10,
      inactiveColor:'#bbb', textStyle:{ fontSize:isMobile?10:12 },
      data: legendGroupNames.value, // ein Eintrag pro Baum
      selected: legendSelected,     // neue Bäume aktivieren, vorhandene Selektion beibehalten
      selectedMode:true
    },
    tooltip: {
      trigger:'axis',
      axisPointer:{ type:'cross' },
      confine: true,
      formatter: tooltipFormatter
    },
    grid: { left:isMobile?40:64, right:isMobile?30:64, top:isMobile?120:140, bottom:84 },
    xAxis: { 
      type:'category',
      data:xAxisData.value,
      axisLabel,
      axisTick: { alignWithLabel: true }
    },
    yAxis: { 
      type:'value',
      name:`Durchmesser [mm]`,
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

  // Nach dem Setzen: Hover nur für ausgewählte Serien; Achsenlabels gemäß Zoomfenster; Y-Achse feinjustieren
  syncLegendHoverLinks()
  applyAxisLabelMode()
  adjustYAxisNow()

  if (resetZoomOnFirst) {
    setTimeout(()=> {
      const cur=myChart.getOption().dataZoom?.[0]
      const dz2 = computeDataZoomRange()
      if (cur) {
        myChart.setOption({ dataZoom: [
          { ...cur, start: dz2.start, end: dz2.end },
          { ...(myChart.getOption().dataZoom?.[1]||{}), start: dz2.start, end: dz2.end }
        ] }, false, true)
        applyAxisLabelMode()
        adjustYAxisNow()
      }
    },0)
  }
}

// Watches
watch(selectedPlot, async () => {
  savedZoom.value = tryLoadZoom()
  await fetchTreesForPlot()
  await nextTick(); await ensureChart()
  await fetchSeries()
  // Nach Neuaufbau sofort Achse prüfen
  await nextTick(); adjustYAxisNow()
})
watch(selectedTrees, async (nv, ov) => {
  const prev = new Set(ov || [])
  const next = new Set(nv || [])
  const added = [...next].filter(x => !prev.has(x))
  const removed = [...prev].filter(x => !next.has(x))
  if (added.length || removed.length) {
    await nextTick(); await ensureChart()
    await fetchSeries()
    // Direkt nach Datenwechsel: Achsen-Labels und Y-Achse aktualisieren
    await nextTick()
    applyAxisLabelMode()
    adjustYAxisNow()
  }
}, { deep:true })

// Lifecycle
onMounted(async () => {
  window.addEventListener('resize', onWindowResize, { passive:true })
  screenWidth.value = window.innerWidth
  chartHeight.value = computeChartHeight(screenWidth.value)

  await nextTick()
  await ensureChart()
  await renderChart(true)

  savedZoom.value = tryLoadZoom()

  await fetchTreesForPlot()
  await fetchSeries()
  await nextTick(); adjustYAxisNow()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  if (myChart) { myChart.dispose(); myChart=null }
})
</script>

<template>
  <div class="gr-page">
    <!-- Card 1: Bestandsflächen -->
    <v-card elevation="1" class="mb-3 soft-card">
      <v-card-title class="pb-2 title-row soft-green">Bestandsflächen</v-card-title>
      <v-card-text>
        <PlotSelect
          v-model="selectedPlot"
          :plots="plotsData"
          :columns="5"
          color="green-darken-2"
        />
      </v-card-text>
    </v-card>

    <!-- Card 2: Dendrometerbäume -->
    <v-card elevation="1" class="mb-3 soft-card">
      <v-card-title class="pb-2 title-row soft-green">
        Dendrometerbäume
        <span v-if="availableTrees.length" class="muted">Auswahl: mehrere möglich</span>
      </v-card-title>
      <v-card-text>
        <div v-if="availableTrees.length" class="trees-grid">
          <v-checkbox
            v-for="t in availableTrees"
            :key="t"
            v-model="selectedTrees"
            :value="t"
            :label="t"
            color="green-darken-2"
            density="compact"
            hide-details
          >
            <template #prepend>
              <span class="legend-dot" :style="{ background: treeColorMap.get(t) || '#666' }"></span>
            </template>
          </v-checkbox>
        </div>
        <v-alert v-else type="info" variant="tonal" density="comfortable" class="mt-2">
          Für Plot {{ selectedPlot }} wurden keine Dendrometerbäume gefunden.
        </v-alert>
      </v-card-text>
    </v-card>

    <!-- Card 3: Chart -->
    <v-card elevation="1" class="mb-3 soft-card">
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
          Bitte wählen Sie mindestens einen Baum.
        </v-alert>

        <v-alert v-if="errorMessage" type="error" variant="tonal" class="mt-3" dismissible @click:close="errorMessage = ''">
          {{ errorMessage }}
        </v-alert>
      </v-card-text>
    </v-card>
  </div>
</template>

<style scoped>
.gr-page { display: flex; flex-direction: column; }
.muted { color: #777; font-weight: 400; font-size: 90%; margin-left: 8px; }
.trees-grid { display: grid; grid-template-columns: repeat(6, minmax(120px, 1fr)); gap: 6px 12px; padding-left: 12px; }
.legend-dot { display:inline-block; width:12px; height:12px; border-radius:50%; margin-right:8px; }

.toolbar-actions { width: 100%; display: flex; justify-content: flex-end; align-items: center; }

/* Card-Farben (soft green) */
.soft-card {
  border: 1px solid rgba(var(--v-theme-primary), 0.22);
  border-radius: 8px;
}
.soft-green {
  background: linear-gradient(180deg, rgba(var(--v-theme-primary), 0.06) 0%, rgba(var(--v-theme-primary), 0.03) 100%);
}

@media (max-width: 1199px) { .trees-grid { grid-template-columns: repeat(4, minmax(120px, 1fr)); } }
@media (max-width: 959px)  { .trees-grid { grid-template-columns: repeat(3, minmax(120px, 1fr)); } }
@media (max-width: 599px)  { .trees-grid { grid-template-columns: repeat(2, minmax(120px, 1fr)); } }
</style>
