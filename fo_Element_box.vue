<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, getCurrentInstance, nextTick } from 'vue'
import * as echarts from 'echarts'
import TreeSpeciesSelect from './TreeSpeciesSelect.vue'
import ElementsMultiSelect from './ElementsMultiSelect.vue'
import { defaultTreeSpecies, plotsData, getSpeciesNameByCode } from './data/treeSpeciesData.js'
import { chemElements, getElementMeta } from './data/chemElements.js'
import { computeBoxForValues } from './data/boxplot.js'

/* Props */
const props = defineProps({
  code_plot: { type: String, default: null },
  viewName:  { type: String, default: 'v_fo_elements' },
  showFullYearRange: { type: Boolean, default: true },
  showEmptyPlots:    { type: Boolean, default: false }
})

/* Base State */
const instance = getCurrentInstance()
const supabase = instance.appContext.config.globalProperties.$supabase

const chartContainer = ref(null)
let myChart = null
const chartReady = ref(false)
const chartHeight = ref(640)

const isLoading = ref(false)
const errorMessage = ref('')
const rawData = ref([])

const selectedSpecies = ref([])
const selectedElementCodes  = ref(['C'])

const didTrimInitials = ref(false)

const seriesData = ref([])
const outlierSeries = ref([])
const categories = ref([])          // {year, elementCode, label}
const statsMap = ref({})            // statsMap[plotCode][catKey] = { stats, outliers, count, smallN, values }
const globalYears = ref([])

const plots = plotsData
const treeSpecies = defaultTreeSpecies

/* Responsive helpers */
const screenWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1024)
function onWindowResize() {
  screenWidth.value = window.innerWidth
  if (myChart) {
    myChart.resize()
    setTimeout(() => { recalcOutlierOffsets(); renderChart() }, 0)
  }
}
const xLabelRotate = computed(() => screenWidth.value < 420 ? 0 : (screenWidth.value < 960 ? 30 : 45))

/* Auswahl-Status */
const hasSpeciesSelection   = computed(() => selectedSpecies.value.length > 0)
const hasElementSelection   = computed(() => selectedElementCodes.value.length > 0)
const hasSelection          = computed(() => hasSpeciesSelection.value && hasElementSelection.value)

/* Species-Codes */
const selectedSpeciesCodes = computed(() => {
  if (!selectedSpecies.value.length) return []
  if (selectedSpecies.value.length === treeSpecies.length) return treeSpecies.map(s => s.code)
  return selectedSpecies.value.map(v => treeSpecies.find(s => s.value === v)?.code).filter(Boolean)
})

/* Elementspalten-Mapping */
const elColMap = {
  C:'c', N:'n', S:'s', P:'p', Ca:'ca', Mg:'mg', K:'k',
  Zn:'zn', Mn:'mn', Fe:'fe', Cu:'cu', Pb:'pb', B:'b', Cd:'cd',
  As:'arsenic', Cr:'cr', Co:'co', Hg:'hg', Ni:'ni', Na:'na', Al:'al'
}
function getElValWide(row, code) {
  const col = elColMap[code]
  if (!col) return null
  const v = row[col]
  return v == null ? null : (Number(v) >= 0 ? Number(v) : null)
}

/* Elemente dynamisch (ohne Fraktionen) */
const relevantElements = computed(() => {
  if (!rawData.value.length) return []
  let rows = rawData.value

  if (selectedSpeciesCodes.value.length) {
    const activePlotCodes = Object.entries(plots)
      .filter(([,p]) => selectedSpeciesCodes.value.includes(p.species[0]))
      .map(([code]) => Number(code))
    rows = rows.filter(r => activePlotCodes.includes(Number(r.code_plot)))
  }

  const present = new Set()
  for (const el of chemElements) {
    const col = elColMap[el.code]
    if (!col) continue
    if (rows.some(r => r[col] != null)) present.add(el.code)
  }
  return chemElements.filter(e => present.has(e.code))
})

/* Helpers */
const fmt = v => (v == null || isNaN(v) ? '-' : Number(v).toFixed(2))
function hexToRgba(hex, alpha) {
  if (!hex) return `rgba(120,120,120,${alpha})`
  let h = hex.replace('#','')
  if (h.length === 3) h = h.split('').map(c=>c+c).join('')
  if (h.length !== 6) return `rgba(120,120,120,${alpha})`
  const r=parseInt(h.slice(0,2),16), g=parseInt(h.slice(2,4),16), b=parseInt(h.slice(4,6),16)
  return `rgba(${r},${g},${b},${alpha})`
}

/* DataZoom persistieren */
const userZoom = ref(null)
const ZOOM_LS_KEY = computed(() => `fo_Element_box.zoom.${props.viewName || 'default'}`)
function clamp(val, min, max){ return Math.max(min, Math.min(max, val)) }
function tryLoadUserZoom() {
  try {
    const raw = localStorage.getItem(ZOOM_LS_KEY.value)
    if (!raw) return null
    const z = JSON.parse(raw)
    if (z && Number.isFinite(z.start) && Number.isFinite(z.end)) {
      return { start: clamp(z.start, 0, 100), end: clamp(z.end, 0, 100) }
    }
  } catch (_) {}
  return null
}
function saveUserZoom(z) {
  try {
    if (!z) return
    const start = clamp(Number(z.start ?? 0), 0, 100)
    const end = clamp(Number(z.end ?? 100), 0, 100)
    const norm = { start, end }
    userZoom.value = norm
    localStorage.setItem(ZOOM_LS_KEY.value, JSON.stringify(norm))
  } catch (_) {}
}

/* y-Achse: Einheit aus Element-Auswahl ableiten */
const yAxisName = computed(() => {
  const codes = selectedElementCodes.value.map(String).filter(Boolean)
  const selectedMeta = chemElements.filter(e => codes.includes(String(e.code)))
  const units = new Set(selectedMeta.map(e => e.unit).filter(Boolean))
  const codeStr = codes.join(', ')
  if (units.size === 1) return `${codeStr} (${[...units][0]})`
  return codeStr
})

/* Y-Achsen-Bounds berechnen */
function getVisiblePlotCodes() {
  try {
    const sel = myChart?.getOption()?.legend?.[0]?.selected
    if (sel && typeof sel === 'object') {
      return Object.keys(sel).filter(name => sel[name] !== false)
    }
  } catch (_) {}
  return seriesData.value.map(s => s.name)
}
function niceNum(x, round) {
  const exp = Math.floor(Math.log10(x || 1))
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
  const visible = new Set(getVisiblePlotCodes().map(String))
  if (!visible.size || !categories.value.length) return { min: null, max: null, interval: null }

  let baseMin = Number.POSITIVE_INFINITY
  let baseMax = Number.NEGATIVE_INFINITY
  let outMin  = Number.POSITIVE_INFINITY
  let outMax  = Number.NEGATIVE_INFINITY

  for (const plotCode of Object.keys(statsMap.value)) {
    if (!visible.has(String(plotCode))) continue
    const catMap = statsMap.value[plotCode] || {}
    for (const cat of categories.value) {
      const key = `${cat.year}|${cat.elementCode}`
      const node = catMap[key]
      if (!node) continue

      if (node.smallN && node.values?.length) {
        for (const v of node.values) {
          if (Number.isFinite(v)) {
            baseMin = Math.min(baseMin, v)
            baseMax = Math.max(baseMax, v)
          }
        }
      }
      if (Array.isArray(node.stats)) {
        const wLow  = Number(node.stats[0])
        const wHigh = Number(node.stats[4])
        if (Number.isFinite(wLow))  baseMin = Math.min(baseMin, wLow)
        if (Number.isFinite(wHigh)) baseMax = Math.max(baseMax, wHigh)
      }
      if (node.outliers?.length) {
        for (const v of node.outliers) {
          if (Number.isFinite(v)) {
            outMin = Math.min(outMin, v)
            outMax = Math.max(outMax, v)
          }
        }
      }
    }
  }

  if (!Number.isFinite(baseMin) || !Number.isFinite(baseMax)) {
    return { min: null, max: null, interval: null }
  }

  let range = baseMax - baseMin
  if (range <= 0) {
    const pad = Math.max(1e-6, Math.abs(baseMax || 1) * 0.05)
    baseMin -= pad
    baseMax += pad
    range = baseMax - baseMin
  }
  const basePad = Math.max(range * 0.06, 1e-6)

  let yMin = baseMin - basePad
  let yMax = baseMax + basePad
  if (baseMin >= 0) yMin = Math.max(0, yMin)

  const maxExpand = range * 0.35
  if (Number.isFinite(outMin) && outMin < yMin) {
    const need = (baseMin - outMin) + basePad
    yMin = Math.min(yMin, baseMin - Math.min(need, maxExpand))
    if (baseMin >= 0) yMin = Math.max(0, yMin)
  }
  if (Number.isFinite(outMax) && outMax > yMax) {
    const need = (outMax - baseMax) + basePad
    yMax = Math.max(yMax, baseMax + Math.min(need, maxExpand))
  }

  const targetTicks = 5
  const step = niceNum((yMax - yMin) / (targetTicks - 1), true)
  const niceMin = Math.floor(yMin / step) * step
  const niceMax = Math.ceil(yMax / step) * step

  return { min: niceMin, max: niceMax, interval: step }
}
const yBounds = computed(() => computeYAxisBounds())

/* Build series & categories (ohne Fraktionen) */
function recompute() {
  // userZoom NICHT zurücksetzen – soll gemerkt bleiben
  seriesData.value = []
  outlierSeries.value = []
  statsMap.value = {}
  categories.value = []

  if (!rawData.value.length || !selectedElementCodes.value.length) return

  const activePlots = Object.entries(plots)
    .filter(([,p]) => selectedSpeciesCodes.value.includes(p.species[0]))
    .map(([code]) => Number(code))
  if (!activePlots.length) return

  let filtered = rawData.value.filter(r => activePlots.includes(Number(r.code_plot)))
  if (props.code_plot) filtered = filtered.filter(r => String(r.code_plot) === props.code_plot)

  const elementMetaList  = relevantElements.value
    .filter(e => selectedElementCodes.value.map(String).includes(String(e.code)))
  if (!elementMetaList.length) return

  const yearArray = (props.showFullYearRange && globalYears.value.length)
    ? globalYears.value
    : [...new Set(filtered.map(r => r.survey_year))].sort((a,b)=>a-b)

  categories.value = yearArray.flatMap(y =>
    elementMetaList.map(el => {
      const em=getElementMeta(el.code)
      const elbl = em?.short || el.code
      return { year:y, elementCode:el.code, label:`${y}\n${elbl}` }
    })
  )
  if (!categories.value.length) return

  const byPlot={}
  for (const r of filtered) {
    for (const el of elementMetaList) {
      const val = getElValWide(r, el.code)
      if (val == null) continue
      const pk=String(r.code_plot)
      const ck=`${r.survey_year}|${el.code}`
      if (!byPlot[pk]) byPlot[pk]={}
      if (!byPlot[pk][ck]) byPlot[pk][ck]=[]
      byPlot[pk][ck].push(val)
    }
  }

  const BOX_ALPHA=0.35, BOX_ALPHA_EMPH=0.25

  const plotCodes = (props.showEmptyPlots ? activePlots : Object.keys(byPlot).map(Number))
    .map(c=>String(c)).sort()

  for (const plotCode of plotCodes) {
    statsMap.value[plotCode]={}

    const boxData = categories.value.map(cat => {
      const ck=`${cat.year}|${cat.elementCode}`
      const arr=byPlot[plotCode]?.[ck]
      if (!arr?.length) {
        statsMap.value[plotCode][ck]={ year:cat.year, elementCode:cat.elementCode, count:0, stats:null, outliers:[], smallN:false, values:[] }
        return { value:null, name:cat.label, year:cat.year, elementCode:cat.elementCode }
      }
      if (arr.length < 3) {
        const vals=[...arr].sort((a,b)=>a-b)
        statsMap.value[plotCode][ck]={ year:cat.year, elementCode:cat.elementCode, count:vals.length, stats:null, outliers:[], smallN:true, values:vals }
        return { value:null, name:cat.label, year:cat.year, elementCode:cat.elementCode }
      }
      const box = computeBoxForValues(arr)
      statsMap.value[plotCode][ck]={ year:cat.year, elementCode:cat.elementCode, count:box.n, stats:box.stats, outliers:box.outliers, smallN:false, values:null }
      return { value:box.stats, name:cat.label, year:cat.year, elementCode:cat.elementCode }
    })

    const color=plots[plotCode]?.color || '#4CAF50'
    seriesData.value.push({
      name: plotCode,
      type: 'boxplot',
      data: boxData,
      itemStyle:{ color: hexToRgba(color, BOX_ALPHA), borderColor: color, borderWidth: 2 },
      emphasis:{ focus:'series', blurScope:'global', itemStyle:{ color: hexToRgba(color, BOX_ALPHA_EMPH), borderWidth:3 } },
      z: 5
    })

    const scatterData=[]
    categories.value.forEach(cat=>{
      const ck=`${cat.year}|${cat.elementCode}`
      const s = statsMap.value[plotCode][ck]
      if (s?.outliers?.length) {
        s.outliers.forEach(v=>{
          scatterData.push({ value: [cat.label, v], year: cat.year, elementCode: cat.elementCode, originalValue: v, kind: 'outlier' })
        })
      }
      if (s?.smallN && s.values?.length) {
        s.values.forEach(v=>{
          scatterData.push({ value: [cat.label, v], year: cat.year, elementCode: cat.elementCode, originalValue: v, kind: 'smallN' })
        })
      }
    })
    if (scatterData.length){
      outlierSeries.value.push({ id: 'out_' + plotCode, name: plotCode, type: 'scatter', data: scatterData, symbol: 'circle', symbolSize: 4, itemStyle:{ color, borderColor: color, opacity: 0.95 }, encode: { x: 0, y: 1 }, z: 10 })
    }
  }
}

/* DataZoom Range (gespeichert oder letzte 3 Jahre) */
function computeDataZoomRange() {
  if (!categories.value.length) return { start:0, end:100 }
  if (userZoom.value && Number.isFinite(userZoom.value.start) && Number.isFinite(userZoom.value.end)) {
    return { start: userZoom.value.start, end: userZoom.value.end }
  }
  const years=[...new Set(categories.value.map(c=>c.year))].sort((a,b)=>a-b)
  if (years.length<=3) return { start:0, end:100 }
  const last3=years.slice(-3)
  const idxs=categories.value.map((c,i)=>({year:c.year, idx:i})).filter(o=>last3.includes(o.year)).map(o=>o.idx)
  if(!idxs.length) return { start:0, end:100 }
  const minIdx=Math.min(...idxs), maxIdx=Math.max(...idxs), total=categories.value.length-1
  return { start:(minIdx/total)*100, end:(maxIdx/total)*100 }
}

/* Scatter-Offsets je Kategorie */
function recalcOutlierOffsets(){
  if(!myChart) return
  try{
    const opt=myChart.getOption()
    const legendSel=opt.legend?.[0]?.selected||{}
    const visibleBox=(opt.series||[]).filter(s=>s.type==='boxplot' && legendSel[s.name]!==false)
    if(!visibleBox.length) return

    const model=myChart.getModel()
    const xAxisModel=model.getComponent('xAxis',0)
    const axis=xAxisModel?.axis
    if(!axis||!axis.getBandWidth) return

    const bw=axis.getBandWidth()
    const n=visibleBox.length
    const usable=bw*0.82
    const step=usable/n
    const start=-usable/2+step/2
    const order={}
    visibleBox.forEach((s,i)=>order[s.name]=i)

    const updates=(opt.series||[])
      .filter(s=>s.type==='scatter' && s.id && s.id.startsWith('out_'))
      .map(s=>{
        const code=s.name
        if(order[code]==null) return null
        return { id:s.id, symbolOffset:[Math.round(start+order[code]*step),0] }
      }).filter(Boolean)
    if(updates.length) myChart.setOption({ series:updates }, false, false)
  }catch(e){ }
}

/* Render */
function renderChart() {
  if (!myChart) return
  try {
    if (!categories.value.length) {
      myChart.clear()
      myChart.setOption({ title:{ text:'Keine Daten für Auswahl', left:'center', top:'middle' }, xAxis:{ type:'category', data:[] }, yAxis:{ type:'value' }, series:[] }, true)
      return
    }

    const isMobile = screenWidth.value < 600
    const dz = computeDataZoomRange()
    const bounds = yBounds.value

    myChart.setOption({
      backgroundColor:'transparent',
      title:[
        { left:'left', text:'Nadel/Blatt - chemische Analyse' },
        { id:'src_left', left:'left', text:'ICP Forest Data des Landesbetrieb Forst Brandenburg', bottom:0, textStyle:{ fontSize:isMobile?10:12, color:'#999' } },
        { id:'src_right', left:'right', text:'forstliche-umweltkontrolle.de', bottom:0, textStyle:{ fontSize:isMobile?10:12, color:'#999' } }
      ],
      legend:{
        top:isMobile?60:70, type:'scroll', textStyle:{ fontSize:isMobile?10:12 },
        formatter: (name) => {
          const meta = plots[name]
          const species = meta ? getSpeciesNameByCode(meta.species[0]) : ''
          return species ? `${name}\n(${species})` : String(name)
        }
      },
      grid:{ left:isMobile?40:60, right:isMobile?30:60, top:isMobile?125:135, bottom: Math.max(80, xLabelRotate.value ? 110 : 80) },
      tooltip:{
        trigger:'item', axisPointer:{ type:'shadow' },
        formatter:p=>{
          if (p.seriesType === 'boxplot' && (Array.isArray(p.value) || p.data)) {
            const plotCode = p.seriesName
            const yr = p.data?.year
            const ec = p.data?.elementCode
            const plotMeta=plots[plotCode]
            const species=plotMeta?getSpeciesNameByCode(plotMeta.species[0]):'Unbekannt'
            const elMeta=getElementMeta(ec)
            const catKey=`${yr}|${ec}`
            const node=statsMap.value[plotCode]?.[catKey]
            const arr = Array.isArray(node?.stats) ? node.stats : (Array.isArray(p.value) ? p.value : [])
            const [wLow,q1,med,q3,wHigh] = arr
            const cnt=node?.count ?? 0
            const outs=node?.outliers || []
            const outBlock = outs.length ? ('<br/>Ausreißer:<br/>' + outs.map(v=>fmt(v)).join('<br/>')) : ''
            const smallNHint = node && node.smallN ? '<br/><em>n<3: nur Einzelwerte (kein Boxplot)</em>' : ''
            return `<div style="font-size:12px">
              <strong>Plot ${plotCode}</strong><br/>
              ${plotMeta?.name || ''} (${species})<br/>
              Jahr: ${yr}<br/>
              Element: ${elMeta?.text || ec} (${elMeta?.code || ''}) ${elMeta?.unit ? '['+elMeta.unit+']' : ''}<br/>
              n: ${cnt}${smallNHint}<br/>
              Whisker Low: ${fmt(wLow)}<br/>Q1: ${fmt(q1)}<br/>Median: ${fmt(med)}<br/>Q3: ${fmt(q3)}<br/>Whisker High: ${fmt(wHigh)}${outBlock}
            </div>`
          }
          if (p.seriesType === 'scatter') {
            const code=p.seriesName
            const info=plots[code]
            const sp=info?getSpeciesNameByCode(info.species[0]):'Unbekannt'
            const yr=p.data.year
            const elMeta=getElementMeta(p.data.elementCode)
            const label = p.data.kind === 'smallN' ? 'Einzelwert (n<3)' : 'Ausreißer'
            return `<div style="font-size:12px">
              <strong>Plot ${code}</strong><br/>
              ${info?.name||''} (${sp})<br/>
              Jahr: ${yr}<br/>
              Element: ${elMeta?.text || p.data.elementCode} (${elMeta?.code || ''}) ${elMeta?.unit ? '['+elMeta.unit+']' : ''}<br/>
              ${label}: ${fmt(p.data.originalValue)}
            </div>`
          }
          return 'Keine Daten'
        }
      },
      xAxis: { type: 'category', data: categories.value.map(c => c.label),
        axisLabel: { fontSize: isMobile ? 9 : 11, interval: 0, lineHeight: 14, rotate: xLabelRotate.value, margin: isMobile ? 10 : 14 },
        axisTick: { alignWithLabel: true }
      },
      yAxis:{ type:'value', name: yAxisName.value, nameTextStyle:{ fontSize:isMobile?10:12, padding: [0, 0, 0, 15] }, axisLabel:{ fontSize:isMobile?10:12 }, splitLine:{ show:true }, scale: true, min: bounds?.min ?? null, max: bounds?.max ?? null, interval: bounds?.interval ?? null },
      dataZoom:[ { type:'inside', start:dz.start, end:dz.end }, { type:'slider', bottom:30, height:isMobile?20:26, start:dz.start, end:dz.end, brushSelect:false } ],
      series: [...seriesData.value, ...outlierSeries.value]
    }, true)

    setTimeout(recalcOutlierOffsets, 0)
  } catch (e) {
    console.error('[LfElementBoxplot] renderChart error', e)
    errorMessage.value = 'Render-Fehler: ' + (e?.message || e)
  }
}

/* CSV */
function downloadName(dat_ext) {
  if (dat_ext === 'header') {
    return '# Nadel/Blatt chem. Analyse\n' +
          `# Element:\t${selectedElementCodes.value.join(';')}\n` +
          `# Erstellt:\t${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC\n` +
          '# Quelle:\tICP Forest Data des Landesbetrieb Forst Brandenburg\n' +
          '# Link:\t\thttps://forstliche-umweltkontrolle.de/dauerbeobachtung/level-ii/\n' +
          `# HBA:\t\t${selectedSpecies.value.join(', ')}\n`
  }
  const ts = new Date().toISOString().substring(0,19).replace(/[:]/g,'-')
  const filename = `streufall_analyse_${ts}.${dat_ext}`
  return filename
}

function generateCSV() {
  if (!seriesData.value.length) return ''
  const csv = []
  csv.push(downloadName('header'))
  csv.push('')
  csv.push('Plot,Plot_Name,HBA,Jahr,Element_Code,Element_Text,Einheit,Temperatur,Min,Q1,Median,Q3,Max,Ausreißer,n')
  for (const s of seriesData.value) {
    const plotCode = s.name
    const pm = plots[plotCode]
    const species = pm ? getSpeciesNameByCode(pm.species[0]) : 'Unbekannt'
    for (const d of s.data) {
      const elMeta=getElementMeta(d.elementCode)
      const catKey=`${d.year}|${d.elementCode}`
      const node=statsMap.value[plotCode]?.[catKey]
      if (!node) continue

      if (node.smallN) {
        const vals = (node.values || []).map(v=>fmt(v)).join('|')
        csv.push([
          plotCode,
          `"${pm?.name || ''}"`,
          `"${species}"`,
          d.year,
          elMeta?.code ?? '',
          `"${elMeta?.text || elMeta?.code || ''}"`,
          elMeta?.unit || '',
          elMeta?.temperature || '',
          '-', '-', '-', '-', '-',
          `"n<3: ${vals}"`,
          node.count || 0
        ].join(','))
        continue
      }

      if (!node.stats) continue
      const [min,q1,med,q3,max]=node.stats
      const cnt=node?.count || 0
      const outs=(node?.outliers || []).map(v=>fmt(v)).join('|')

      csv.push([
        plotCode,
        `"${pm?.name || ''}"`,
        `"${species}"`,
        d.year,
        elMeta?.code ?? '',
        `"${elMeta?.text || elMeta?.code || ''}"`,
        elMeta?.unit || '',
        elMeta?.temperature || '',
        fmt(min), fmt(q1), fmt(med), fmt(q3), fmt(max),
        `"${outs}"`,
        cnt
      ].join(','))
    }
  }
  return csv.join('\n')
}
function downloadCSV() {
  const csvContent=generateCSV()
  if(!csvContent){ errorMessage.value='Keine Daten für CSV'; return }
  const filename = downloadName('csv')
  const blob = new Blob([csvContent],{type:'text/csv;charset=utf-8;'})
  const a = document.createElement('a')
  const url = URL.createObjectURL(blob)
  a.href = url; a.download = filename; a.style.visibility = 'hidden'
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(a.href)
}

// PNG
function downloadChartPNG() {
  if (!myChart) return
  try {
    const dataURL = myChart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' })
    const a = document.createElement('a')
    a.href = dataURL
    a.download = downloadName('png')
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  } catch (e) { console.error('PNG Export fehlgeschlagen', e) }
}

/* Fetch */
async function fetchData() {
  if (isLoading.value) return
  isLoading.value = true; errorMessage.value=''
  try {
    let q = supabase.from(props.viewName)
      .select('*')
      .order('code_plot', { ascending: true })
      .order('survey_year', { ascending: true })
    if (props.code_plot) q = q.eq('code_plot', props.code_plot)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    rawData.value = data || []
    globalYears.value = rawData.value.length ? [...new Set(rawData.value.map(r=>r.survey_year))].sort((a,b)=>a-b) : []

    if (!didTrimInitials.value) {
      const validEl = new Set(relevantElements.value.map(e => String(e.code)))
      selectedElementCodes.value = (selectedElementCodes.value || []).filter(c => validEl.has(String(c)))
      if (!selectedElementCodes.value.length && validEl.has('C')) selectedElementCodes.value = ['C']
      didTrimInitials.value = true
    } else {
      const validEl = new Set(relevantElements.value.map(e => String(e.code)))
      selectedElementCodes.value = (selectedElementCodes.value || []).filter(c => validEl.has(String(c)))
    }

    if (hasSelection.value) { recompute(); ensureChart(); renderChart() } else { disposeChart() }
  } catch (e) {
    errorMessage.value='Fehler Datenabruf: '+e.message
    console.error('[LfElementBoxplot] fetchData error', e)
  } finally { isLoading.value=false }
}

/* Chart lifecycle */
function ensureChart() {
  if (!myChart && chartContainer.value) {
    myChart = echarts.init(chartContainer.value)
    chartReady.value = true
    myChart.on('dataZoom', ()=>{
      try {
        const opt = myChart.getOption()
        const dz = (opt.dataZoom || [])[0]
        if (dz) saveUserZoom({ start: dz.start ?? 0, end: dz.end ?? 100 })
      } catch (_) {}
      setTimeout(recalcOutlierOffsets,0)
    })
    myChart.on('legendselectchanged', ()=> setTimeout(recalcOutlierOffsets,0))
  }
}

function disposeChart() { if (myChart) { myChart.dispose(); myChart = null } chartReady.value = false }

/* Events/Watcher */
function onSpeciesSelectionChanged() {
  if (!chartReady.value && hasSelection.value) ensureChart()
  if (!hasSelection.value) { disposeChart(); seriesData.value=[]; outlierSeries.value=[]; categories.value=[]; return }
  recompute(); renderChart()
}
function onElementsChanged() {
  if (!chartReady.value || !hasSelection.value) return
  recompute(); renderChart()
}

let pendingUpdate = false
function requestUpdate() {
  if (pendingUpdate) return
  pendingUpdate = true
  Promise.resolve().then(()=>{
    pendingUpdate=false
    if (!chartReady.value || !hasSelection.value) return
    recompute(); renderChart()
  })
}

watch(relevantElements, () => {
  const validEl = new Set(relevantElements.value.map(e => String(e.code)))
  const pruned = (selectedElementCodes.value || []).filter(c => validEl.has(String(c)))
  if (JSON.stringify(pruned) !== JSON.stringify(selectedElementCodes.value)) selectedElementCodes.value = pruned
  requestUpdate()
})
watch(selectedElementCodes, requestUpdate, { deep:true })
watch(selectedSpeciesCodes, (n,o)=> { if (JSON.stringify(n)!==JSON.stringify(o)) requestUpdate() })
watch(()=>props.code_plot, (n,o)=>{ if (n!==o && chartReady.value && hasSelection.value) fetchData() })

watch(hasSelection, async (sel) => {
  if (sel) {
    await nextTick()
    ensureChart()
    if (!userZoom.value) {
      const saved = tryLoadUserZoom()
      if (saved) userZoom.value = saved
    }
    recompute()
    renderChart()
  } else {
    disposeChart()
  }
})

/* Lifecycle */
onMounted(async () => {
  window.addEventListener('resize', onWindowResize, { passive:true })
  const saved = tryLoadUserZoom()
  if (saved) userZoom.value = saved
  if (hasSelection.value) ensureChart()
  await fetchData()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  disposeChart()
})

/* Empty state message */
const emptyMessage = computed(() => {
  if (!hasSpeciesSelection.value) return 'Bitte wählen Sie mindestens eine Baumart.'
  if (!hasElementSelection.value)  return 'Bitte wählen Sie mindestens ein Element.'
  return 'Keine Daten für die getroffene Auswahl.'
})

/* Expose */
defineExpose({ refreshData: fetchData, downloadCSV, downloadChartPNG })
</script>

<template>
  <TreeSpeciesSelect
    v-model="selectedSpecies"
    :select-all-by-default="true"
    :show-debug="false"
    :min-selection="0"
    class="mb-4"
    @selection-changed="onSpeciesSelectionChanged"
  />

  <ElementsMultiSelect
    v-model="selectedElementCodes"
    :elements="relevantElements"
    class="mb-2"
    :checkbox-color="'green-darken-2'"
    :default-selection="['C']"
    @change="onElementsChanged"
  />

  <v-card class="chart-card" elevation="1">
    <v-toolbar density="comfortable" color="transparent" flat>
      <div class="toolbar-actions">
        <v-btn size="small" variant="elevated tonal" elevation="1" color="primary" 
        @click="downloadChartPNG" :disabled="isLoading || !hasSelection" 
        title="Chart als PNG speichern">PNG</v-btn>
        <v-btn size="small" variant="elevated tonal" elevation="1" color="primary"
         @click="downloadCSV" :disabled="!hasSelection || !rawData || !rawData.length" 
         class="ml-2" title="Chartdaten als CSV exportieren">CSV</v-btn>
      </div>
    </v-toolbar>
    <v-divider />
    <v-card-text>
      <div v-if="hasSelection" :style="{ position: 'relative', width: '100%', height: chartHeight + 'px' }">
        <div ref="chartContainer" :style="{ width: '100%', height: chartHeight + 'px' }" />
        <v-overlay v-model="isLoading" contained class="align-center justify-center">
          <v-progress-circular color="primary" indeterminate size="52" />
        </v-overlay>
      </div>
      <div v-else class="empty-state" :style="{ height: chartHeight + 'px' }">
        <v-alert variant="plain" color="primary" border="start" elevation="0">
          {{ emptyMessage }}
        </v-alert>
      </div>
    </v-card-text>
  </v-card>

  <v-alert v-if="errorMessage" type="error" variant="tonal" class="mt-3" dismissible @click:close="errorMessage = ''">
    {{ errorMessage }}
  </v-alert>
</template>

<style scoped>
.toolbar-actions { width: 100%; display: flex; justify-content: flex-end; align-items: center; }
.empty-state { display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: large; padding: 16px; background: linear-gradient(180deg, rgba(var(--v-theme-primary), 0.08) 0%, rgba(var(--v-theme-primary), 0.04) 100%); border: 1px solid rgba(var(--v-theme-primary), 0.22); border-radius: 8px; }
@media (max-width: 959px) { .chart-card { margin-bottom: 10px; } .toolbar-actions .v-btn { min-width: 56px; padding: 0 10px; } }
@media (max-width: 599px) { .toolbar-actions { gap: 6px; } .toolbar-actions .ml-2 { margin-left: 6px !important; } }
</style>
