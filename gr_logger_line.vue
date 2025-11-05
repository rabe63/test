<script setup>
// Wachstum (Dendrometer) – Linechart mit Min/Mean/Max-Band
// Neu/Fix:
// - Dendrometer-Auswahl (Single-Choice) steuert Baumliste und Daten (dendro_kind in public.mv_dendro)
// - Baumliste wird korrekt angezeigt und numerisch sortiert
// - Dynamischer Chart-Titel je nach Dendrometer-Auswahl

import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, getCurrentInstance } from 'vue'
import * as echarts from 'echarts'
import PlotSelect from './PlotSelect.vue'
import { plotsData } from './data/treeSpeciesData.js'

const instance = getCurrentInstance()
const supabase = instance.appContext.config.globalProperties.$supabase

const props = defineProps({
  seriesSchema: { type: String, default: 'public' },
  seriesView:   { type: String, default: 'mv_dendro' }, // MV mit Spalte dendro_kind
  defaultPlot:  { type: [String, Number], default: '1203' },
  themeMode:    { type: String, default: 'auto' }
})

// Auswahl
const selectedPlot = ref(String(props.defaultPlot || '1203'))
const selectedKind = ref('dendro_log') // 'dendro_log' | 'dendro_14' | 'dendro_30'
const availableTrees = ref([])   // number[]
const selectedTrees = ref([])    // number[]

// Chart/Daten
let myChart = null
const chartContainer = ref(null)
const chartHeight = ref(600)
const screenWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1024)
const xAxisData = ref([])
const seriesData = ref([])
const rawRows = ref([])
const isLoading = ref(false)
const errorMessage = ref('')

// Legende
const legendGroupNames = ref([]) // number[]
const groupHasMinMax = ref(new Map()) // tree -> {hasMin, hasMax}

// X-Achse Labelsets
const yearStartIndexSet = ref(new Set())
const monthStartIndexSet = ref(new Set())

// Zoom-Persistenz (pro Plot+Kind)
const ZOOM_KEY = computed(() => `gr_logger_line.zoom.${selectedPlot.value}.${selectedKind.value}`)
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
  if (myChart && chartContainer.value) myChart.resize({ height: chartHeight.value, width: chartContainer.value.clientWidth })
}

// Farben
const BASE_PALETTE = ['#0072B2','#E69F00','#009E73','#D55E00','#CC79A7','#56B4E9','#F0E442','#2C3E50','#1ABC9C','#3D5B2D','#E91E63']
function hexToHsl(hex) {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  const r = parseInt(h.slice(0,2),16)/255, g = parseInt(h.slice(2,4),16)/255, b = parseInt(h.slice(4,6),16)/255
  const max = Math.max(r,g,b), min = Math.min(r,g,b)
  let hh, s, l = (max + min) / 2
  if (max === min) { hh = s = 0 }
  else {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) { case r: hh = (g - b) / d + (g < b ? 6 : 0); break
                   case g: hh = (b - r) / d + 2; break
                   case b: hh = (r - g) / d + 4; break }
    hh /= 6
  }
  return { h: hh*360, s: s*100, l: l*100 }
}
function hslToHex(h,s,l) {
  h/=360; s/=100; l/=100
  const hue2rgb=(p,q,t)=>{ if(t<0)t+=1; if(t>1)t-=1; if(t<1/6)return p+(q-p)*6*t; if(t<1/2)return q; if(t<2/3)return p+(q-p)*(2/3-t)*6; return p }
  const q = l < 0.5 ? l*(1+s) : l + s - l*s
  const p = 2*l - q
  const r = Math.round(hue2rgb(p,q,h+1/3)*255)
  const g = Math.round(hue2rgb(p,q,h)*255)
  const b = Math.round(hue2rgb(p,q,h-1/3)*255)
  const toHex = (x)=>x.toString(16).toUpperCase().padStart(2,'0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}
function withAlpha(hex, a=1){ const c=hex.replace('#',''); const r=parseInt(c.slice(0,2),16), g=parseInt(c.slice(2,4),16), b=parseInt(c.slice(4,6),16); return `rgba(${r},${g},${b},${a})` }
function soften(hex, ratio=0.78){ const {h,s,l}=hexToHsl(hex); const base=hslToHex(h, Math.max(20,s*0.9), l); return withAlpha(base, ratio) }

const treeColorMap = ref(new Map()) // number -> hex
function recomputeTreeColors() {
  const map = new Map()
  availableTrees.value.forEach((t, i) => map.set(t, BASE_PALETTE[i % BASE_PALETTE.length]))
  treeColorMap.value = map
}

// Y-Achse
function niceNum(x, round) {
  const exp = Math.floor(Math.log10(x))
  const f = x / Math.pow(10, exp)
  let nf
  if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10
  else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10
  return nf * Math.pow(10, exp)
}
function computeYAxisBounds() {
  if (!myChart) return {min:null, max:null}
  const opt = myChart.getOption(), legendSel = opt?.legend?.[0]?.selected || {}
  let minV = Infinity, maxV = -Infinity
  for (const s of (opt?.series || [])) {
    if (s.type!=='line') continue
    const sid = s.id || ''
    if (sid.startsWith('bandbase-') || sid.startsWith('bandfill-')) continue
    const visible = legendSel[s.name] !== false
    if (!visible) continue
    for (const v of (s.data||[])) {
      if (v==null) continue
      const num = Number(v); if (!Number.isFinite(num)) continue
      minV = Math.min(minV, num); maxV = Math.max(maxV, num)
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
function adjustYAxisNow() { if (!myChart) return; const yb = computeYAxisBounds(); if (yb.min!=null || yb.max!=null) myChart.setOption({ yAxis: { min: yb.min ?? null, max: yb.max ?? null } }, false, true) }

// X-Achse Labelmodus
function buildYearMonthIndexSets() {
  const dates = xAxisData.value || []
  const ySet = new Set(), mSet = new Set()
  let prevYear = null, prevMonth = null
  dates.forEach((dstr, idx) => {
    const d = new Date(dstr), y = d.getFullYear(), m = d.getMonth()
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
  const startIdx = Math.round(clamp01(dz?.start ?? 0)/100 * n)
  const endIdx   = Math.round(clamp01(dz?.end ?? 100)/100 * n)
  return { startIdx, endIdx }
}
function labelModeFromZoom() {
  const { startIdx, endIdx } = currentZoomIndexSpan()
  const dates = xAxisData.value
  if (!dates.length) return 'years'
  const d0 = new Date(dates[Math.max(0, startIdx)])
  const d1 = new Date(dates[Math.min(dates.length-1, endIdx)])
  const years = (d1 - d0) / (365.25*24*3600*1000)
  return years <= 3 ? 'months' : 'years'
}
function applyAxisLabelMode() {
  if (!myChart) return
  const mode = labelModeFromZoom()
  const ySet = yearStartIndexSet.value, mSet = monthStartIndexSet.value
  const interval = (idx) => (mode==='months' ? mSet.has(idx) : ySet.has(idx))
  const formatter = (val) => {
    const d = new Date(val)
    return mode === 'months'
      ? `${d.toLocaleString('de-DE', { month: 'short' })} ${String(d.getFullYear())}`
      : String(d.getFullYear())
  }
  myChart.setOption({ xAxis: { axisLabel: { interval, formatter } } }, false, true)
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

// Labels
const kindLabel = computed(() => ({
  'dendro_log': 'Logger (täglich)',
  'dendro_14':  'Dendro 14 (14-tägig)',
  'dendro_30':  'Dendro 30 (jährlich)'
}[selectedKind.value] || selectedKind.value))
const chartTitle = computed(() => `Wachstum: ${plotLabel()} - ${kindLabel.value}`)

// Download
function plotLabel() {
  const p = plotsData[selectedPlot.value]
  return p ? `${selectedPlot.value} - ${p.name || ''}` : selectedPlot.value
}
function downloadName(dat_ext) {
  if (dat_ext==='header') {
    return '# Dendrometerdaten\n' +
      `# Plot:\t\t${plotLabel()}\n` +
      `# Dendrometer:\t${kindLabel.value}\n` +
      `# Bäume:\t${selectedTrees.value.join(', ')}\n` +
      `# Erstellt:\t${new Date().toISOString().replace('T',' ').substring(0,19)} UTC\n` +
      '# Quelle:\tICP Forest Data des Landesbetrieb Forst Brandenburg\n' +
      '# Link:\t\thttps://forstliche-umweltkontrolle.de/dauerbeobachtung/level-ii/\n'
  }
  const ts = new Date().toISOString().substring(0,19).replace(/[:]/g,'-')
  return `dendrometer_${selectedKind.value}_${selectedPlot.value}_${ts}.${dat_ext}`
}
function generateCSV() {
  if (!seriesData.value.length || !xAxisData.value.length) return ''
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
      const sMax  = seriesData.value.find(s => s.id === `series-${String(t)}-max`)
      const sMean = seriesData.value.find(s => s.id === `series-${String(t)}-mean`)
      const sMin  = seriesData.value.find(s => s.id === `series-${String(t)}-min`)
      const vMax  = sMax?.data?.[idx], vMean = sMean?.data?.[idx], vMin  = sMin?.data?.[idx]
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

// Bäume laden (distinct tree_number) für Plot + Dendrometer-Art
async function fetchTreesForPlot() {
  availableTrees.value = []
  try {
    const { data, error } = await supabase
      .schema(props.seriesSchema)
      .from(props.seriesView)
      .select('tree_number')
      .eq('code_plot', Number(selectedPlot.value))
      .eq('dendro_kind', selectedKind.value)
      .order('tree_number', { ascending: true })
      .limit(20000) // Sicherheitslimit
    if (error) throw error

    const set = new Set()
    for (const r of (data||[])) if (r?.tree_number != null) set.add(Number(r.tree_number))
    const list = Array.from(set).sort((a,b)=>a-b)
    availableTrees.value = list
    recomputeTreeColors()

    // Default-Auswahl: erster Baum, wenn nötig
    if (!list.length) {
      selectedTrees.value = []
    } else {
      // Falls aktuell keine Auswahl vorhanden oder die bestehende Auswahl ungültig ist,
      // alle verfügbaren Bäume als Default auswählen.
      const cur = (selectedTrees.value || []).filter(t => list.includes(t))
      selectedTrees.value = cur.length ? cur : list.slice()
    }
  } catch (e) {
    console.error('[fetchTreesForPlot] error', e)
    availableTrees.value = []
    selectedTrees.value = []
  }
}

// Daten laden
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
      .eq('dendro_kind', selectedKind.value)
      .in('tree_number', selectedTrees.value)
      .order('tree_number', { ascending: true })
      .order('date_assessment', { ascending: true })
    if (error) throw error

    rawRows.value = data || []

    // X-Achse
    const dates = Array.from(new Set((rawRows.value||[]).map(r => String(r.date_assessment)))).sort((a,b)=> new Date(a)-new Date(b))
    xAxisData.value = dates
    buildYearMonthIndexSets()

    // Gruppen
    const groups = Array.from(new Set(selectedTrees.value))
    const sList = []
    const groupMeta = new Map()

    for (const t of groups) {
      const baseHex = treeColorMap.value.get(t) || BASE_PALETTE[0]
      const colorMean = withAlpha(baseHex, 1.0)
      const colorMin  = soften(baseHex, 0.78)
      const colorMax  = soften(baseHex, 0.78)

      const rows = (rawRows.value || []).filter(r => Number(r.tree_number) === Number(t))
      const byDateMean = new Map(rows.map(p => [String(p.date_assessment), Number(p.d_avg)]))
      const byDateMin  = new Map(rows.map(p => [String(p.date_assessment), Number(p.d_min)]))
      const byDateMax  = new Map(rows.map(p => [String(p.date_assessment), Number(p.d_max)]))

      const dataMean = dates.map(d => { const v = byDateMean.get(d); return (v==null||Number.isNaN(v))?null:v })
      const dataMin  = dates.map(d => { const v = byDateMin .get(d); return (v==null||Number.isNaN(v))?null:v })
      const dataMax  = dates.map(d => { const v = byDateMax .get(d); return (v==null||Number.isNaN(v))?null:v })

      const hasAnyMin = dataMin.some(v => v!=null)
      const hasAnyMax = dataMax.some(v => v!=null)
      groupMeta.set(t, { hasMin: hasAnyMin, hasMax: hasAnyMax })

      // Band
      if (hasAnyMin && hasAnyMax) {
        const bandStack = `band-${String(t)}`
        sList.push({
          id: `bandbase-${String(t)}`, name: String(t), type: 'line', stack: bandStack, stackStrategy:'all',
          data: dataMin, color: colorMean, lineStyle:{width:0}, itemStyle:{color:colorMean,borderColor:colorMean},
          symbol:'none', showSymbol:false, connectNulls:false, areaStyle:undefined, tooltip:{show:false}, legendHoverLink:false, silent:true, z:1
        })
        const bandDiff = dates.map((d,i)=> {
          const vmin = dataMin[i]; const vmax = dataMax[i]
          if (vmin==null || vmax==null || !isFinite(vmin) || !isFinite(vmax)) return null
          return Math.max(0, vmax - vmin)
        })
        sList.push({
          id: `bandfill-${String(t)}`, name: String(t), type: 'line', stack: bandStack, stackStrategy:'all',
          data: bandDiff, color: colorMean, lineStyle:{width:0}, itemStyle:{color:colorMean,borderColor:colorMean},
          symbol:'none', showSymbol:false, connectNulls:false, areaStyle:{ color: withAlpha(baseHex, 1.0), opacity: 0.18 },
          tooltip:{show:false}, legendHoverLink:false, silent:true, z:1
        })
      }

      // Linien
      if (hasAnyMin) {
        sList.push({
          id:`series-${String(t)}-min`, name:String(t), type:'line', color: colorMin, data: dataMin,
          symbol:'circle', symbolSize:3, showSymbol:false, connectNulls:false,
          lineStyle:{ width:1, color: colorMin, opacity: 0.78 }, itemStyle:{ color: colorMin, borderColor: colorMin, opacity: 0.78 },
          emphasis:{ focus:'series', lineStyle:{ width:2 } }, blur:{ lineStyle:{ color:'#bbb', width:1 }, itemStyle:{ color:'#bbb', borderColor:'#bbb' } },
          legendHoverLink:true, z:2
        })
      }
      sList.push({
        id:`series-${String(t)}-mean`, name:String(t), type:'line', color: colorMean, data: dataMean,
        symbol:'circle', symbolSize:3, showSymbol:false, connectNulls:false,
        lineStyle:{ width:1.6, color: colorMean, opacity: 1.0 }, itemStyle:{ color: colorMean, borderColor: colorMean, opacity: 1.0 },
        emphasis:{ focus:'series', lineStyle:{ width:2.4 } }, blur:{ lineStyle:{ color:'#bbb', width:1 }, itemStyle:{ color:'#bbb', borderColor:'#bbb' } },
        legendHoverLink:true, z:3
      })
      if (hasAnyMax) {
        sList.push({
          id:`series-${String(t)}-max`, name:String(t), type:'line', color: colorMax, data: dataMax,
          symbol:'circle', symbolSize:3, showSymbol:false, connectNulls:false,
          lineStyle:{ width:1, color: colorMax, opacity: 0.78 }, itemStyle:{ color: colorMax, borderColor: colorMax, opacity: 0.78 },
          emphasis:{ focus:'series', lineStyle:{ width:2 } }, blur:{ lineStyle:{ color:'#bbb', width:1 }, itemStyle:{ color:'#bbb', borderColor:'#bbb' } },
          legendHoverLink:true, z:2
        })
      }
    }

    seriesData.value = sList
    legendGroupNames.value = groups
    groupHasMinMax.value = groupMeta

    await nextTick()
    await ensureChart()
    await renderChart(true)
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
    return { id: s.id || s.name, legendHoverLink: isBand ? false : (selectedMap[s.name] !== false) }
  })
  if (updates.length) myChart.setOption({ series: updates }, false, true)
}
function onLegendSelectChanged() { adjustYAxisNow(); syncLegendHoverLinks() }
function onDataZoom() {
  try { const dz=(myChart.getOption().dataZoom||[])[0]; if (dz) saveZoom({start:dz.start??0,end:dz.end??100}) } catch {}
  applyAxisLabelMode(); adjustYAxisNow()
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
      title: { text: chartTitle.value, left: 'left', top: 8 },
      xAxis: { type: 'category', data: [] },
      yAxis: { type: 'value' },
      series: []
    }, true)
    return
  }
  const dz = computeDataZoomRange()
  const yb = computeYAxisBounds()
  const isMobile = screenWidth.value < 600

  // Legenden-Selektion beibehalten; neue Bäume aktiv
  const prevSelected = (myChart.getOption()?.legend?.[0]?.selected) || {}
  const legendSelected = {}
  for (const name of legendGroupNames.value.map(String)) {
    legendSelected[name] = Object.prototype.hasOwnProperty.call(prevSelected, name) ? prevSelected[name] : true
  }

const tooltipFormatter = (params) => {
  if (!params || !params.length) return ''
  const date = params[0].axisValueLabel || params[0].axisValue
  const groups = new Map()
  params.forEach(p => {
    const sid = p.seriesId || ''
    if (sid.startsWith('bandbase-') || sid.startsWith('bandfill-')) return
    const num = Number(p.value); if (!Number.isFinite(num)) return
    const gn = p.seriesName || ''
    const arr = groups.get(gn) || []
    arr.push(p)
    groups.set(gn, arr)
  })
  if (!groups.size) return `<strong>${date}</strong><br/>`
  let out = `<strong>${date}</strong><br/>`
  for (const [gn, arr] of groups.entries()) {
    // nur den mean-Wert anzeigen (falls vorhanden)
    const meanItem = arr.find(p => (p.seriesId || '').endsWith('-mean')) || arr[0]
    if (!meanItem) continue
    const val = Number(meanItem.value)
    out += `<em>Baum ${gn}</em><br/>`
    out += `<span style="display:inline-block;margin-right:6px;border-radius:50%;width:8px;height:8px;background:${meanItem.color}"></span>`
    out += `mean: ${val.toFixed(3)} mm<br/>`
  }
  return out
}

  const axisLabel = {
    interval: (idx)=> yearStartIndexSet.value.has(idx),
    formatter: (val)=> String(new Date(val).getFullYear()),
    margin: isMobile?16:20,
    hideOverlap: true
  }

  myChart.setOption({
    backgroundColor: 'transparent',
    title: [
      { left: 'left', text: chartTitle.value, top: 8 },
      { left: 'left', bottom: 0, text: 'ICP Forest Data des Landesbetrieb Forst Brandenburg', textStyle: { fontSize: isMobile?10:12, color:'#999' } },
      { left: 'right', bottom: 0, text: 'forstliche-umweltkontrolle.de', textStyle: { fontSize: isMobile?10:12, color:'#999' } }
    ],
    legend: {
      top: isMobile?72:84, type:'scroll', icon:'circle', itemWidth:16, itemHeight:10,
      inactiveColor:'#bbb', textStyle:{ fontSize:isMobile?10:12 },
      data: legendGroupNames.value.map(String),
      selected: legendSelected,
      selectedMode:true
    },
    tooltip: { trigger:'axis', axisPointer:{ type:'cross' }, confine: true, formatter: tooltipFormatter },
    grid: { left:isMobile?40:64, right:isMobile?30:64, top:isMobile?140:160, bottom:84 },
    xAxis: { type:'category', data:xAxisData.value, axisLabel, axisTick: { alignWithLabel: true } },
    yAxis: { type:'value', name:`Durchmesser [mm]`, nameTextStyle:{ fontSize:isMobile?10:12, padding:[0,0,0,22] },
             min: yb.min ?? null, max: yb.max ?? null, splitLine:{ show:true }, axisLabel:{ margin: 12 }, scale:true },
    dataZoom: [
      { type:'inside', start:dz.start, end:dz.end },
      { type:'slider', bottom:22, height:isMobile?20:26, start:dz.start, end:dz.end, brushSelect:false,
        showDataShadow:true, backgroundColor:'transparent', showDetail:false }
    ],
    series: seriesData.value
  }, true)

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
watch([selectedPlot, selectedKind], async () => {
  savedZoom.value = tryLoadZoom()
  await fetchTreesForPlot()
  await nextTick(); await ensureChart()
  await fetchSeries()
  await nextTick(); adjustYAxisNow()
})

watch(selectedTrees, async (nv, ov) => {
  const prev = new Set(ov || [])
  const next = new Set(nv || [])
  const changed = [...prev].length !== [...next].length || [...prev].some(x=>!next.has(x)) || [...next].some(x=>!prev.has(x))
  if (changed) {
    await nextTick(); await ensureChart()
    await fetchSeries()
    await nextTick()
    applyAxisLabelMode()
    adjustYAxisNow()
  }
}, { deep:true })

watch([selectedPlot, selectedKind], async (nv, ov) => {
  savedZoom.value = tryLoadZoom()
  const [newPlot, newKind] = nv || []
  const [oldPlot, oldKind] = ov || []
  // Bäume neu laden für aktuelle Auswahl
  await fetchTreesForPlot()
  // Wenn die Dendrometer-Art gewechselt wurde: standardmäßig ALLE Bäume auswählen
  if (newKind !== oldKind) {
    selectedTrees.value = availableTrees.value.slice()
  } else {
    // sonst bestehende Auswahl bewahren (aber falls leer, alle setzen)
    if (!selectedTrees.value.length && availableTrees.value.length) {
      selectedTrees.value = availableTrees.value.slice()
    } else {
      // filtere ungültige Einträge heraus (falls nötig)
      selectedTrees.value = (selectedTrees.value || []).filter(t => availableTrees.value.includes(t))
    }
  }
  await nextTick(); await ensureChart()
  await fetchSeries()
  await nextTick(); adjustYAxisNow()
})

watch(selectedPlot, async (nv, ov) => {
  if (nv === ov) return
  await fetchTreesForPlot()            // lädt availableTrees.value
  // default: alle verfügbaren Bäume markieren
  selectedTrees.value = availableTrees.value.slice()
})

// Lifecycle
onMounted(async () => {
  window.addEventListener('resize', onWindowResize, { passive:true })
  screenWidth.value = window.innerWidth
  chartHeight.value = computeChartHeight(screenWidth.value)

  await nextTick(); await ensureChart(); await renderChart(true)

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

    <PlotSelect
      v-model="selectedPlot"
      :plots="plotsData"
      :columns="5"
      color="green-darken-2"
    />


    <!-- Card 2: Dendrometer + Bäume -->
    <v-card elevation="1" class="mb-3 soft-card">
      <v-card-title class="pb-2 title-row soft-green">
        Dendrometer
      </v-card-title>
      <v-card-text class="pb-0">
        <div class="kind-row">
          <v-checkbox
            label="Logger (täglich)"
            :model-value="selectedKind === 'dendro_log'"
            @update:modelValue="val => { if (val) selectedKind = 'dendro_log' }"
            color="green-darken-2"
            density="compact"
            hide-details
          />
          <v-checkbox
            label="Dendro 14 (14-tägig)"
            :model-value="selectedKind === 'dendro_14'"
            @update:modelValue="val => { if (val) selectedKind = 'dendro_14' }"
            color="green-darken-2"
            density="compact"
            hide-details
          />
          <v-checkbox
            label="Dendro 30 (jährlich)"
            :model-value="selectedKind === 'dendro_30'"
            @update:modelValue="val => { if (val) selectedKind = 'dendro_30' }"
            color="green-darken-2"
            density="compact"
            hide-details
          />
        </div>
      </v-card-text>

      <v-card-title class="pt-2 pb-2 title-row soft-green">
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
            :label="String(t)"
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
          Für Plot {{ selectedPlot }} und {{ kindLabel }} wurden keine Dendrometerbäume gefunden.
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
.kind-row { display: flex; gap: 8px 16px; flex-wrap: wrap; padding-left: 12px; }
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
