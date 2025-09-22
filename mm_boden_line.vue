<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, getCurrentInstance } from 'vue'
import * as echarts from 'echarts'
import PlotSelect from './PlotSelect.vue'
import { plotsData } from './data/treeSpeciesData.js'

// Supabase
const instance = getCurrentInstance()
const supabase = instance.appContext.config.globalProperties.$supabase

// Backend-Props (Schema explizit)
const props = defineProps({
  sensorSchema: { type: String, default: 'public' },
  sensorView:   { type: String, default: 'v_sensor_code' },
  seriesSchema: { type: String, default: 'icp_download' },
  seriesView:   { type: String, default: 'mm_mem' },
  // daily_mean wird zu 'value' aliasiert, daher 'value' als Default-Ausgabespalte
  seriesValueColumn: { type: String, default: 'value' },
  defaultPlot: { type: [String, Number], default: '1203' },
  // Farben: auto/light/dark
  themeMode: { type: String, default: 'auto' }
})

// Auswahl-State
const selectedPlot = ref(String(props.defaultPlot || '1203'))
const selectedVariable = ref('WC') // 'WC' | 'ST' | 'MP'
const selectedSensorCodes = ref([]) // z. B. ['BF_010']

// Sensorliste für aktuellen Plot+Variable
const sensorRows = ref([])
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

// X-Achse: nur Jahreslabels
const yearLabelIndexSet = ref(new Set()) // Indizes in xAxisData, an denen ein neues Jahr beginnt

// Zoom-Persistenz
const ZOOM_KEY = computed(() => `mm_boden_line.zoom.${selectedPlot.value}.${selectedVariable.value}`)
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

// Theme-Erkennung (hell/dunkel)
const isDark = computed(() => {
  if (props.themeMode === 'dark') return true
  if (props.themeMode === 'light') return false
  try {
    if (document?.documentElement?.classList?.contains('v-theme--dark')) return true
  } catch {}
  try {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {}
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

// Variable-Checkboxen (Single-Select Verhalten) – Labels ohne Kürzel
const variableOptions = [
  { code: 'WC', label: 'Bodenfeuchte', icon: 'mdi-water-percent' },      // Feuchte
  { code: 'ST', label: 'Bodentemperatur', icon: 'mdi-thermometer' },     // Temperatur
  { code: 'MP', label: 'Bodensaugspannung', icon: 'mdi-gauge' }          // Druck/Saugspannung
]
const variableLabel = computed(() =>
  variableOptions.find(o => o.code === selectedVariable.value)?.label || selectedVariable.value
)
function onToggleVariable(code, checked) {
  if (!checked && selectedVariable.value === code) return
  selectedVariable.value = code
}

// Farbpaletten (kontraststark)
const BASE_COLORS_LIGHT = [
  '#e3f2fd', // sehr hell
  '#bbdefb',
  '#90caf9',
  '#64b5f6',
  '#42a5f5',
  '#2196f3',
  '#1e88e5',
  '#1976d2',
  '#1565c0',
  '#0d47a1', // sehr dunkel
  '#82b1ff'  // Reserve
]
const BASE_COLORS_DARK = [
  '#b3cfff', // sehr hell
  '#82b1ff',
  '#448aff',
  '#2979ff',
  '#2962ff',
  '#1565c0',
  '#0d47a1',
  '#174ea6',
  '#1a237e',
  '#283593',
  '#304ffe'  // Reserve
]
function hashCode(str){ let h=0; for (let i=0;i<str.length;i++){ h=((h<<5)-h)+str.charCodeAt(i); h|=0 } return Math.abs(h) }
function hexToHsl(hex) {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  const r = parseInt(h.slice(0,2),16)/255
  const g = parseInt(h.slice(2,4),16)/255
  const b = parseInt(h.slice(4,6),16)/255
  const max = Math.max(r,g,b), min = Math.min(r,g,b)
  let h2, s, l = (max + min) / 2
  if (max === min) { h2 = s = 0 }
  else {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h2 = (g - b) / d + (g < b ? 6 : 0); break
      case g: h2 = (b - r) / d + 2; break
      case b: h2 = (r - g) / d + 4; break
    }
    h2 /= 6
  }
  return { h: h2*360, s: s*100, l: l*100 }
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
function varyColor(hex, idx, darkMode) {
  // Varianten: im Light-Theme dunkler, im Dark-Theme heller
  const { h, s, l } = hexToHsl(hex)
  const delta = Math.min(18, 10 + 6*idx)
  const newL = Math.max(8, Math.min(92, darkMode ? (l + delta) : (l - delta)))
  return hslToHex(h, s, newL)
}
function baseColorFor(sensorCode, variantIndex=0) {
  const palette = isDark.value ? BASE_COLORS_DARK : BASE_COLORS_LIGHT
  const idx = hashCode(sensorCode) % palette.length
  const base = palette[idx]
  if (variantIndex <= 0) return base
  return varyColor(base, variantIndex, isDark.value)
}

// Hilfsfunktionen
function buildInstrumentDisplayIndex(rowsForCode) {
  const sorted = [...rowsForCode].sort((a,b)=>Number(a.instrument_seq_nr)-Number(b.instrument_seq_nr))
  const map = new Map(); sorted.forEach((row, idx)=> map.set(row.instrument_seq_nr, idx+1))
  return map
}

// Y-Achsen-Bounds mit “schönen” Rundungen (1-2-5)
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
  niceMin = Math.max(0, niceMin)
  if (niceMax === niceMin) niceMax = niceMin + tick
  return { min: niceMin, max: niceMax }
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

// CSV/PNG
function downloadName(dat_ext) {
  if (dat_ext==='header') {
    return '# Bestandsdaten – Bodendaten (Linie)\n' +
      `# Plot:\t\t${selectedPlot.value} — ${plotsData[selectedPlot.value]?.name || ''}\n` +
      `# Variable:\t${variableLabel.value}\n` +
      `# Sensoren:\t${selectedSensorCodes.value.join(', ')}\n` +
      `# Erstellt:\t${new Date().toISOString().replace('T',' ').substring(0,19)} UTC\n` +
      '# Quelle:\tICP Forest Data des Landesbetrieb Forst Brandenburg\n' +
      '# Link:\t\thttps://forstliche-umweltkontrolle.de/dauerbeobachtung/level-ii/\n'
  }
  const ts = new Date().toISOString().substring(0,19).replace(/[:]/g,'-')
  return `mm_boden_line_${selectedPlot.value}_${selectedVariable.value}_${ts}.${dat_ext}`
}
function generateCSV() {
  if (!seriesData.value.length || !xAxisData.value.length) return ''
  const csv = []
  csv.push(downloadName('header')); csv.push('')
  const headers=['Date']; seriesData.value.forEach(s=>headers.push(s.name)); csv.push(headers.join(','))
  xAxisData.value.forEach((dateStr, idx) => {
    const row=[dateStr]
    seriesData.value.forEach(s => { const v=s.data[idx]; row.push(v==null?'':Number(v).toFixed(2)) })
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

// 1) Sensorliste laden und Default: erster verfügbarer Code
async function fetchSensors() {
  sensorRows.value = []; selectedSensorCodes.value = []
  if (!selectedPlot.value || !selectedVariable.value) return
  try {
    const { data, error } = await supabase
      .schema(props.sensorSchema)
      .from(props.sensorView)
      .select('code_plot,instrument_seq_nr,code_location,code_variable,vertikal,unit,sensor_code')
      .eq('code_plot', Number(selectedPlot.value))
      .eq('code_variable', selectedVariable.value)
      .order('sensor_code', { ascending: true })
      .order('instrument_seq_nr', { ascending: true })
    if (error) throw error
    sensorRows.value = data || []
    const codes = availableSensorCodes.value
    if (codes.length) selectedSensorCodes.value = [codes[0]]
    else selectedSensorCodes.value = []
  } catch (e) {
    console.error('[fetchSensors] error', e)
    sensorRows.value = []; selectedSensorCodes.value = []
  }
}

// 2) Zeitreihe laden, X-Achse/Serien bauen, Chart rendern
async function fetchSeries() {
  rawSeries.value = []; xAxisData.value = []; seriesData.value = []; yearLabelIndexSet.value = new Set()

  if (!selectedPlot.value || !selectedVariable.value || !selectedSensorCodes.value.length) {
    await nextTick(); await ensureChart(); await renderChart(true)
    return
  }

  // Instrumente zu den gewählten sensor_code
  const instruments = sensorRows.value
    .filter(r => selectedSensorCodes.value.includes(String(r.sensor_code)))
    .map(r => Number(r.instrument_seq_nr))
  const instSet = Array.from(new Set(instruments)).sort((a,b)=>a-b)
  if (!instSet.length) { await nextTick(); await ensureChart(); await renderChart(true); return }

  try {
    isLoading.value = true; errorMessage.value = ''

    // daily_mean -> value aliasieren, damit seriesValueColumn='value' funktioniert
    const valueSelect = (props.seriesSchema==='icp_download' && props.seriesView==='mm_mem' && props.seriesValueColumn==='value')
      ? 'value:daily_mean'
      : props.seriesValueColumn

    const { data, error } = await supabase
      .schema(props.seriesSchema)
      .from(props.seriesView)
      .select(`code_plot,instrument_seq_nr,code_variable,date_observation,${valueSelect}`)
      .eq('code_plot', Number(selectedPlot.value))
      .eq('code_variable', selectedVariable.value)
      .in('instrument_seq_nr', instSet)
      .order('instrument_seq_nr', { ascending: true })
      .order('date_observation', { ascending: true })
    if (error) throw error

    rawSeries.value = data || []

    // X-Achse
    const dateSet = new Set()
    for (const r of rawSeries.value) if (r?.date_observation) dateSet.add(String(r.date_observation))
    const dates = Array.from(dateSet).sort((a,b)=> new Date(a)-new Date(b))
    xAxisData.value = dates

    // Indizes für Jahreslabels (erster Tag jedes Jahres)
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

    // Serien je Instrument
    const seriesList = []
    for (const inst of instSet) {
      const sensorRow = sensorRows.value.find(r => Number(r.instrument_seq_nr) === Number(inst))
      const sensorCode = sensorRow?.sensor_code ? String(sensorRow.sensor_code) : String(inst)
      const displayIdx = labelIndexMap.get(`${sensorCode}-${inst}`) || 1
      const name = `${sensorCode} (${displayIdx})`
      const color = baseColorFor(sensorCode, displayIdx-1)

      const points = rawSeries.value.filter(r => Number(r.instrument_seq_nr) === Number(inst))
      const byDate = new Map(points.map(p => [String(p.date_observation), Number(p[props.seriesValueColumn])]))
      const dataArr = dates.map(d => {
        const v = byDate.get(d)
        return (v==null || Number.isNaN(v)) ? null : v
      })

      seriesList.push({
        name,
        type:'line',
        data: dataArr,
        symbol:'circle',
        symbolSize:3,
        showSymbol:false,
        connectNulls:false,
        lineStyle:{ width:1, color },
        itemStyle:{ color, borderColor: color },
        // Hover über Legende: diese Serie betonen, andere dimmen
        emphasis: { focus: 'series', lineStyle: { width: 2 } },
        blur: { lineStyle: { color: '#bbb', width: 1 }, itemStyle: { color: '#bbb', borderColor: '#bbb' } }
      })
    }

    seriesData.value = seriesList

    await nextTick()
    await ensureChart()
    await renderChart(true)
  } catch (e) {
    console.error('[fetchSeries] error', e)
    errorMessage.value = 'Fehler beim Laden der Zeitreihen: ' + (e?.message || e)
    await nextTick(); await ensureChart(); await renderChart(true)
  } finally { isLoading.value = false }
}

// Chart
function onLegendSelectChanged() {
  // Nach Ein-/Ausblenden Y-Achse dynamisch justieren
  const yb = computeYAxisBounds()
  if (myChart && (yb.min != null || yb.max != null)) {
    myChart.setOption({ yAxis: { min: yb.min ?? null, max: yb.max ?? null } }, false, true)
  }
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

  // Formatter/Interval nur Jahreslabels
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
      { left: 'left', text: 'Bodendaten der Bestandsflächen' },
      { left: 'left', bottom: 0, text: 'ICP Forest Data des Landesbetrieb Forst Brandenburg', textStyle: { fontSize: isMobile?10:12, color:'#999' } },
      { left: 'right', bottom: 0, text: 'forstliche-umweltkontrolle.de', textStyle: { fontSize: isMobile?10:12, color:'#999' } }
    ],
    legend: {
      top: isMobile?60:70, type:'scroll', icon:'circle', itemWidth:16, itemHeight:10,
      inactiveColor:'#bbb', textStyle:{ fontSize:isMobile?10:12 },
      data: seriesData.value.map(s=>s.name),
      selectedMode:true,
      // Hover-Link aktiv lassen: ECharts triggert emphasis/blur automatisch
      // hoverLink ist standardmäßig true
    },
    tooltip: {
      trigger:'axis', axisPointer:{ type:'cross' },
      formatter:(params)=>{
        if(!params||!params.length) return ''
        const date=params[0].axisValueLabel||params[0].axisValue
        let out=`<strong>${date}</strong><br/>`
        params.forEach(p=>{
          if(p.value==null) return
          const val=Number(p.value); const u=currentUnit.value?` ${currentUnit.value}`:''
          out += `<span style="display:inline-block;margin-right:6px;border-radius:50%;width:8px;height:8px;background:${p.color}"></span>`
          out += `${p.seriesName}: ${isFinite(val)?val.toFixed(2):'-'}${u}<br/>`
        })
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
    // Serien mit emphasis/blur (Hover auf Legende dimmt andere automatisch)
    series: seriesData.value
  }, true)

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

// Watches
watch([selectedPlot, selectedVariable], async () => {
  savedZoom.value = tryLoadZoom()
  selectedSensorCodes.value = [] // wird in fetchSensors auf den ersten Code gesetzt
  await fetchSensors()
  await nextTick(); await ensureChart()
  await fetchSeries()
})
watch(selectedSensorCodes, async (nv, ov) => {
  // Hinzufügen => reload; Abwählen => nur Serien herausfiltern
  const prev = new Set(ov || [])
  const next = new Set(nv || [])
  const added = [...next].filter(c => !prev.has(c))
  const removed = [...prev].filter(c => !next.has(c))

  if (added.length) {
    await nextTick(); await ensureChart()
    await fetchSeries()
  } else if (removed.length) {
    if (seriesData.value.length) {
      const keep = new Set([...next])
      seriesData.value = seriesData.value.filter(s => keep.has(s.name.split(' (')[0]))
      await nextTick(); await ensureChart(); await renderChart(false)
    } else {
      await nextTick(); await ensureChart(); await renderChart(false)
    }
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
  await fetchSensors()
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
    <!-- Card 1: Plot-Auswahl (Checkboxen, Single-Select in PlotSelect.vue) -->
    <PlotSelect
      v-model="selectedPlot"
      :plots="plotsData"
      title="Bestandsflächen"
      :columns="5"
      color="green-darken-2"
    />

    <!-- Card 2: Variablen + Sensoren -->
    <v-card elevation="1" class="mb-3">
      <v-card-title class="pb-2 title-row soft-green">Sensorengruppe</v-card-title>
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
            Für Plot {{ selectedPlot }} und Variable {{ selectedVariable }} wurden keine Sensoren gefunden.
          </v-alert>
        </div>
      </v-card-text>
    </v-card>

    <!-- Card 3: Chart (Container immer rendern) -->
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
          Bitte wählen Sie einen Sensor.
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
.vars-row { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.vars-grid { display: grid; grid-template-columns: repeat(3, minmax(180px, 1fr)); gap: 6px 12px; }
.sensors-block { margin: 5px 0px 0px 15px; }
.sensors-grid {
  display: grid; grid-template-columns: repeat(6, minmax(120px, 1fr)); gap: 6px 12px; padding-left: 20px;
}
.muted { color: #777; font-weight: 400; font-size: 90%; padding-left: 20px; }
.toolbar-actions { width: 100%; display: flex; justify-content: flex-end; align-items: center; }
/* Card-Farben (soft green) */
.soft-card {
  border: 1px solid rgba(var(--v-theme-primary), 0.22);
  border-radius: 8px;
}
.soft-green {
  background: linear-gradient(180deg, rgba(var(--v-theme-primary), 0.06) 0%, rgba(var(--v-theme-primary), 0.03) 100%);
}
@media (max-width: 1199px) { .sensors-grid { grid-template-columns: repeat(4, minmax(120px, 1fr)); } }
@media (max-width: 959px)  { .vars-grid { grid-template-columns: repeat(3, minmax(140px, 1fr)); }
                             .sensors-grid { grid-template-columns: repeat(3, minmax(120px, 1fr)); } }
@media (max-width: 599px)  { .vars-grid { grid-template-columns: repeat(2, minmax(140px, 1fr)); }
                             .sensors-grid { grid-template-columns: repeat(2, minmax(120px, 1fr)); } }
</style>
