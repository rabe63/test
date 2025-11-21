<script setup>
// Phänologie – Ereignis Timeline (Line/Points) für code_event Scores
// Datei: ph/ph_line.vue
// Verbesserungen gegenüber vorheriger Version:
//  - PlotSelect import aus './PlotSelect.vue'
//  - Entfernt zu strikten Filter (.gt auf date_observation) -> vollständige Jahresdaten
//  - Robust gegen leere year selection
//  - Korrekte Zuordnung von Datum (Date-Objekt) im Scatter (time axis) zur Vermeidung von Parsingproblemen
//  - Dynamische X-Achsen-Beschriftung (Intervall abhängig von sichtbarer Zeitspanne) zur Vermeidung überlappender Labels
//  - Optionaler Aggregationsmodus 'ALL' (gestapelte Anteile + kumulative Linien)
//  - Verbesserte Tooltip: zeigt Methode (code_method), Score-Label und Plot
//  - Jitter (±0.18 in Score) für Punkte im Einzelplotmodus, damit mehrere Beobachtungen mit identischem Score nicht exakt übereinander liegen
//  - CSV/PNG Export
//  - Farben analog gr_logger_line.vue; diskrete Score-Farbpalette für Austrieb (1..5) u. Blüte (7.x)
//  - Reaktives Neurendern bei Plot/Event/Jahr
//  - Automatische Baumliste (distinct tree_number) im Einzelplotmodus
//  - Leere Datenhinweise

import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, getCurrentInstance } from 'vue'
import * as echarts from 'echarts'
import PlotSelect from './PlotSelect.vue'
import { plotsData } from './data/treeSpeciesData.js'

const instance = getCurrentInstance()
const supabase = instance.appContext.config.globalProperties.$supabase

const props = defineProps({
  schema: { type: String, default: 'icp_download' },
  table:  { type: String, default: 'ph_phi' },
  defaultPlot: { type: [String, Number], default: '1203' },
  defaultEvent: { type: Number, default: 1 }, // 1 = Austrieb
  themeMode: { type: String, default: 'auto' }
})

// Auswahl
const EVENT_OPTIONS = [
  { code: 1, label: 'Austrieb (Flushing)' },
  { code: 7, label: 'Blüte (Flowering)' }
]
const selectedPlot = ref(String(props.defaultPlot || '1203'))
const selectedEvent = ref(Number(props.defaultEvent))
const availableYears = ref([])
const selectedYear = ref(null)

// Daten
const rawRows = ref([])
const treeNumbers = ref([])

// Status / Chart
let myChart = null
const chartEl = ref(null)
const chartHeight = ref(600)
const screenWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1280)
const isLoading = ref(false)
const errorMessage = ref('')

// Farben
const BASE_PALETTE = ['#0072B2','#E69F00','#009E73','#D55E00','#CC79A7','#56B4E9','#F0E442','#2C3E50','#1ABC9C','#3D5B2D','#E91E63']
function colorForIndex(i){ return BASE_PALETTE[i % BASE_PALETTE.length] }
const SCORE_COLOR_MAP = new Map([
  [1.0,'#c6dbef'], [2.0,'#9ecae1'], [3.0,'#6baed6'], [4.0,'#3182bd'], [5.0,'#08519c'],
  [7.0,'#fdd0a2'], [7.1,'#fdae6b'], [7.2,'#fd8d3c'], [7.3,'#e6550d']
])
const SCORE_LABEL = new Map([
  [1.0,'<1%'], [2.0,'1–33%'], [3.0,'>33–66%'], [4.0,'>66–99%'], [5.0,'100%'],
  [7.0,'present'], [7.1,'sparse'], [7.2,'moderate'], [7.3,'abundant']
])
const METHOD_LABEL = new Map([
  [1,'Field'], [2,'Camera'], [3,'Field+Camera'], [99,'Unknown']
])

// PlotSelect Daten mit 'ALL'
const plotsForSelect = computed(() => {
  const obj = {}
  for (const [k,v] of Object.entries(plotsData||{})) obj[k] = { ...(v||{}), code: v?.code ?? k }
  obj['ALL'] = { code: 'ALL', name: 'Alle Plots (Aggregation)' }
  return obj
})
const isAggregateAll = computed(() => selectedPlot.value === 'ALL')

// Responsive Höhe
function computeChartHeight(w){ if (w<600) return 420; if (w<960) return 520; return 600 }
function onResize(){ screenWidth.value = window.innerWidth; chartHeight.value = computeChartHeight(screenWidth.value); if(myChart && chartEl.value) myChart.resize({ height: chartHeight.value, width: chartEl.value.clientWidth }) }

// Jahre laden
async function fetchYears() {
  availableYears.value=[]; selectedYear.value=null
  try {
    const q = supabase
      .schema(props.schema)
      .from(props.table)
      .select('survey_year')
      .eq('code_event', selectedEvent.value)
      .not('survey_year','is','null')
      .limit(40000)
    if(!isAggregateAll.value) q.eq('code_plot', Number(selectedPlot.value))
    const { data, error } = await q
    if(error) throw error
    const set = new Set()
    for(const r of (data||[])) if(r?.survey_year!=null) set.add(Number(r.survey_year))
    const list = Array.from(set).sort((a,b)=>a-b)
    availableYears.value = list
    selectedYear.value = list.length ? list[list.length-1] : null
  } catch(e){ console.error('[fetchYears]', e) }
}

// Daten laden
async function fetchRows(){
  rawRows.value=[]; treeNumbers.value=[]
  if(selectedYear.value==null) return
  try {
    isLoading.value=true; errorMessage.value=''
    const q = supabase
      .schema(props.schema)
      .from(props.table)
      .select('code_plot,tree_number,date_observation,code_event,code_event_score,code_method')
      .eq('code_event', selectedEvent.value)
      .eq('survey_year', Number(selectedYear.value))
      .order('tree_number',{ascending:true})
      .order('date_observation',{ascending:true})
      .limit(50000)
    if(!isAggregateAll.value) q.eq('code_plot', Number(selectedPlot.value))
    const { data, error } = await q
    if(error) throw error
    rawRows.value = (data||[]).filter(r=> r?.date_observation && r?.tree_number!=null && r?.code_event_score!=null)
    if(!isAggregateAll.value){
      const set = new Set(); for(const r of rawRows.value) set.add(Number(r.tree_number))
      treeNumbers.value = Array.from(set).sort((a,b)=>a-b)
    }
  } catch(e){ console.error('[fetchRows]', e); errorMessage.value='Fehler beim Laden der Daten.' }
  finally { isLoading.value=false }
}

// Einzelplot Scatter-Daten (mit Jitter für Score Stapelung vermeiden?) wir wollen Score nicht auf Y sondern Baum -> Jitter auf X minimal
const scatterData = computed(()=>{
  if(isAggregateAll.value) return []
  const out=[]
  for(const r of rawRows.value){
    const tree = Number(r.tree_number)
    if(!treeNumbers.value.includes(tree)) continue
    // Value Format: [timestamp, tree]
    const dateObj = new Date(r.date_observation + 'T00:00:00Z')
    const jitterMillis = (Math.random()-0.5)*3600*1000 // ±0.5h jitter
    out.push({
      value: [dateObj.getTime()+jitterMillis, tree],
      score: Number(r.code_event_score),
      method: Number(r.code_method),
      plot: r.code_plot
    })
  }
  return out
})

// Aggregation für ALL
const aggregatedSeries = computed(()=>{
  if(!isAggregateAll.value) return { dates:[], sortedScores:[], byScore:new Map(), cumulative:[] }
  const byDate = new Map()
  for(const r of rawRows.value){
    const d = String(r.date_observation)
    const arr = byDate.get(d)||[]; arr.push(Number(r.code_event_score)); byDate.set(d,arr)
  }
  const dates = Array.from(byDate.keys()).sort((a,b)=>new Date(a)-new Date(b))
  const setScores = new Set(); for(const arr of byDate.values()) arr.forEach(s=>setScores.add(s))
  const sortedScores = Array.from(setScores).sort((a,b)=>a-b)
  const byScore = new Map()
  for(const s of sortedScores){
    byScore.set(s, dates.map(d=>{ const arr=byDate.get(d)||[]; const n=arr.length||1; return arr.filter(x=>x===s).length/n }))
  }
  const thresholds = [2,3,5]
  const cumulative = thresholds.map(th=>({ th, data: dates.map(d=>{ const arr=byDate.get(d)||[]; if(!arr.length) return 0; return arr.filter(x=>x>=th && x<=5).length/arr.length }) }))
  return { dates, sortedScores, byScore, cumulative }
})

// Tooltip
function formatTooltip(params){
  if(!params||!params.length) return ''
  if(isAggregateAll.value){
    const date = params[0].axisValueLabel || params[0].axisValue
    let out = `<strong>${date}</strong><br/>`
    for(const p of params.filter(p=>p.seriesType==='bar')) out += `Score ${p.seriesName}: ${(p.value*100).toFixed(1)}%<br/>`
    for(const p of params.filter(p=>p.seriesType==='line')) out += `≥${p.seriesName}: ${(p.value*100).toFixed(1)}%<br/>`
    return out
  }
  const date = new Date(params[0].value[0]).toLocaleDateString('de-DE',{ day:'2-digit', month:'2-digit', year:'numeric'})
  let out = `<strong>${date}</strong><br/>`
  for(const p of params){
    const sc = p.data?.score
    if(sc==null) continue
    const lab = SCORE_LABEL.get(sc) || sc
    const method = METHOD_LABEL.get(p.data?.method) || p.data?.method
    out += `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px"></span>` +
           `Baum ${p.data.value[1]}: Score ${sc} (${lab})` + (method?` · ${method}`:'') + '<br/>'
  }
  return out
}

// Achsen-Label Intervall (Zeit)
function buildDateAxisLabelFormatter(dates){
  return (val)=> new Date(val).toLocaleDateString('de-DE',{ day:'2-digit', month:'2-digit'})
}

function buildSinglePlotOption(){
  const trees = treeNumbers.value
  const points = scatterData.value
  const isMobile = screenWidth.value < 600
  // Symbolgröße
  const sizeBase = trees.length <= 40 ? 14 : trees.length <= 80 ? 10 : 7
  return {
    backgroundColor:'transparent',
    title:[
      { left:'left', top:8, text:`Phänologie: ${plotsData[selectedPlot.value]?.name ? `${selectedPlot.value} - ${plotsData[selectedPlot.value].name}`:selectedPlot.value} · ${EVENT_OPTIONS.find(e=>e.code===selectedEvent.value)?.label} · ${selectedYear.value}` },
      { left:'left', bottom:0, text:'ICP Forest Data des Landesbetrieb Forst Brandenburg', textStyle:{ fontSize:isMobile?10:12, color:'#999'} },
      { left:'right', bottom:0, text:'forstliche-umweltkontrolle.de', textStyle:{ fontSize:isMobile?10:12, color:'#999'} }
    ],
    tooltip:{ trigger:'axis', axisPointer:{ type:'cross' }, formatter: formatTooltip, confine:true },
    grid:{ left:isMobile?40:64, right:isMobile?30:64, top:isMobile?140:160, bottom:84 },
    xAxis:{ type:'time', axisLabel:{ formatter: buildDateAxisLabelFormatter() } },
    yAxis:{ type:'category', data: trees, name:'Baum', nameTextStyle:{ fontSize:isMobile?10:12, padding:[0,0,0,30] }, axisLabel:{ fontSize: trees.length>60?10:(isMobile?10:12) } },
    dataZoom:[ { type:'inside', start:0,end:100 }, { type:'slider', bottom:22, height:isMobile?20:26, start:0,end:100, brushSelect:false, showDataShadow:true, backgroundColor:'transparent', showDetail:false } ],
    series:[{
      name:'Events', type:'scatter', encode:{x:0,y:1},
      data: points.map(pt=>({ value: pt.value, score: pt.score, method: pt.method })),
      symbolSize:(val,p)=>{ const sc=p.data.score; const base=sizeBase; return sc>=4?base+4: sc>=3? base+2: base },
      itemStyle:{ color:(p)=> SCORE_COLOR_MAP.get(p.data.score) || '#666' }
    }]
  }
}

function buildAggregateOption(){
  const agg = aggregatedSeries.value
  const dates = agg.dates
  const isMobile = screenWidth.value < 600
  if(!dates.length) return { title:{ text:'Keine Daten' } }
  const scoreBars=[]; let idx=0
  for(const s of agg.sortedScores){
    scoreBars.push({ name:String(s), type:'bar', stack:'scores', data:agg.byScore.get(s), itemStyle:{ color: SCORE_COLOR_MAP.get(s) || colorForIndex(idx) }, emphasis:{ focus:'series' } })
    idx++
  }
  const lines = agg.cumulative.map(c=>({ name:String(c.th), type:'line', data:c.data, yAxisIndex:0, showSymbol:false, lineStyle:{ width:2, type:c.th===5?'solid':'dashed', color:'#000' } }))
  return {
    backgroundColor:'transparent',
    title:[
      { left:'left', top:8, text:`Phänologie Aggregation · ${EVENT_OPTIONS.find(e=>e.code===selectedEvent.value)?.label} · ${selectedYear.value}` },
      { left:'left', bottom:0, text:'ICP Forest Data des Landesbetrieb Forst Brandenburg', textStyle:{ fontSize:isMobile?10:12, color:'#999'} },
      { left:'right', bottom:0, text:'forstliche-umweltkontrolle.de', textStyle:{ fontSize:isMobile?10:12, color:'#999'} }
    ],
    tooltip:{ trigger:'axis', axisPointer:{ type:'shadow' }, formatter: formatTooltip, confine:true },
    legend:{ top:isMobile?72:84, type:'scroll', textStyle:{ fontSize:isMobile?10:12 }, data:[ ...agg.sortedScores.map(String), ...agg.cumulative.map(c=>`≥${c.th}`) ] },
    grid:{ left:isMobile?40:64, right:isMobile?30:64, top:isMobile?140:160, bottom:84 },
    xAxis:{ type:'category', data:dates, axisLabel:{ formatter:(val)=> new Date(val).toLocaleDateString('de-DE',{ day:'2-digit', month:'2-digit'}) } },
    yAxis:[{ type:'value', min:0, max:1, axisLabel:{ formatter:(v)=> (v*100).toFixed(0)+'%' }, name:'Anteil Bäume', nameTextStyle:{ fontSize:isMobile?10:12, padding:[0,0,0,40]} }],
    dataZoom:[ { type:'inside', start:0,end:100 }, { type:'slider', bottom:22, height:isMobile?20:26, start:0,end:100, brushSelect:false, showDataShadow:true, backgroundColor:'transparent', showDetail:false } ],
    series:[...scoreBars, ...lines]
  }
}

function ensureChart(){ if(!chartEl.value || myChart) return; myChart = echarts.init(chartEl.value) }
function renderChart(){ if(!myChart) return; const opt = isAggregateAll.value? buildAggregateOption(): buildSinglePlotOption(); myChart.setOption(opt, true) }

// Export
function downloadName(ext){ const ts=new Date().toISOString().substring(0,19).replace(/[:]/g,'-'); const plotPart=isAggregateAll.value?'ALL':selectedPlot.value; return `ph_line_${plotPart}_${selectedEvent.value}_${selectedYear.value}_${ts}.${ext}` }
function generateCSV(){ if(!rawRows.value.length) return ''; const header=[ '# Phänologie Ereignis-Timeline', `# Plot:\t${isAggregateAll.value?'ALL (Aggregation)':selectedPlot.value}`, `# Event:\t${selectedEvent.value}`, `# Jahr:\t${selectedYear.value}`, `# Erstellt:\t${new Date().toISOString().replace('T',' ').substring(0,19)} UTC`, '# Quelle:\tICP Forest Data des Landesbetrieb Forst Brandenburg', '# Link:\thttps://forstliche-umweltkontrolle.de/dauerbeobachtung/level-ii/' ].join('\n'); const rows=['date_observation,plot,tree_number,code_event,code_event_score,code_method']; for(const r of rawRows.value){ rows.push([r.date_observation,r.code_plot,r.tree_number,r.code_event,r.code_event_score,r.code_method].join(',')) } return header+'\n\n'+rows.join('\n') }
function downloadCSV(){ const csv=generateCSV(); if(!csv){ errorMessage.value='Keine Daten'; return } const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}); const a=document.createElement('a'); const url=URL.createObjectURL(blob); a.href=url; a.download=downloadName('csv'); document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url) }
function downloadPNG(){ if(!myChart) return; try{ const url=myChart.getDataURL({type:'png',pixelRatio:2,backgroundColor:'#fff'}); const a=document.createElement('a'); a.href=url; a.download=downloadName('png'); document.body.appendChild(a); a.click(); document.body.removeChild(a) } catch(e){ console.error('PNG export', e) } }

// Watches
watch([selectedPlot, selectedEvent], async ()=>{ await fetchYears(); await fetchRows(); await nextTick(); ensureChart(); renderChart() })
watch(selectedYear, async ()=>{ await fetchRows(); await nextTick(); ensureChart(); renderChart() })

// Lifecycle
onMounted(async ()=>{ window.addEventListener('resize', onResize, { passive:true }); screenWidth.value=window.innerWidth; chartHeight.value=computeChartHeight(screenWidth.value); await fetchYears(); await fetchRows(); await nextTick(); ensureChart(); renderChart() })
onBeforeUnmount(()=>{ window.removeEventListener('resize', onResize); if(myChart){ myChart.dispose(); myChart=null } })
</script>

<template>
  <div class="ph-line-page">
    <PlotSelect
      v-model="selectedPlot"
      :plots="plotsForSelect"
      :columns="6"
      color="green-darken-2"
      :multiple="false"
      title="Bestandsflächen / Aggregation"
    />

    <v-card elevation="1" class="mb-3 soft-card">
      <v-card-title class="pb-2 title-row soft-green">Ereignis & Jahr</v-card-title>
      <v-card-text>
        <div class="controls-row">
          <div class="event-select">
            <div class="label">Event</div>
            <div class="event-options">
              <v-checkbox
                v-for="ev in EVENT_OPTIONS"
                :key="ev.code"
                :label="ev.label"
                :model-value="selectedEvent===ev.code"
                color="green-darken-2" density="compact" hide-details
                @update:modelValue="val=>{ if(val) selectedEvent = ev.code }"
              />
            </div>
          </div>
          <div class="year-select" v-if="availableYears.length">
            <div class="label">Jahr</div>
            <v-chip-group v-model="selectedYear" column mandatory>
              <v-chip v-for="y in availableYears" :key="y" :value="y" size="small" variant="elevated" color="primary" class="mr-2">{{ y }}</v-chip>
            </v-chip-group>
          </div>
          <div v-else class="muted">Keine Jahresdaten.</div>
        </div>
      </v-card-text>
    </v-card>

    <v-card elevation="1" class="mb-3 soft-card">
      <v-toolbar density="comfortable" color="transparent" flat>
        <div class="toolbar-actions">
          <v-btn size="small" variant="elevated tonal" color="primary" :disabled="!rawRows.length" @click="downloadPNG">PNG</v-btn>
          <v-btn size="small" variant="elevated tonal" color="primary" :disabled="!rawRows.length" class="ml-2" @click="downloadCSV">CSV</v-btn>
        </div>
      </v-toolbar>
      <v-card-text>
        <div :style="{ position:'relative', width:'100%', height: chartHeight + 'px' }">
          <div ref="chartEl" :style="{ width:'100%', height: chartHeight + 'px' }" />
          <v-overlay v-model="isLoading" contained class="align-center justify-center">
            <v-progress-circular color="primary" indeterminate size="52" />
          </v-overlay>
        </div>
        <v-alert v-if="errorMessage" type="error" variant="tonal" class="mt-3" dismissible @click:close="errorMessage=''">{{ errorMessage }}</v-alert>
        <v-alert v-if="!isLoading && !rawRows.length" type="info" variant="tonal" class="mt-3">Keine Daten für Auswahl.</v-alert>
      </v-card-text>
    </v-card>
  </div>
</template>

<style scoped>
.ph-line-page { display:flex; flex-direction:column; }
.controls-row { display:flex; gap:24px; flex-wrap:wrap; align-items:flex-start; }
event-options { display:flex; gap:8px 16px; flex-wrap:wrap; }
.label { font-weight:600; margin-bottom:4px; }
.muted { color:#777; font-size:0.85rem; }
.soft-card { border:1px solid rgba(var(--v-theme-primary),0.22); border-radius:6px; }
.soft-green { background:linear-gradient(180deg, rgba(var(--v-theme-primary),0.06) 0%, rgba(var(--v-theme-primary),0.03) 100%); }
.toolbar-actions { width:100%; display:flex; justify-content:flex-end; }
@media (max-width:959px){ .controls-row { flex-direction:column; } }
</style>
