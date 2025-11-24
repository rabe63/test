<script setup>
// Neuaufsetzung Phänologie-Chart (Multi-Year Score Timeline)
// Anforderungen des Nutzers:
//  - PlotSelect aus './PlotSelect.vue'
//  - Plots 1201 und 1206 ausgrauen (keine Daten)
//  - Ereignis-Auswahl (Events 1,2,3,4,6,7,8 – ohne 5)
//  - Y-Achse = Score (1..5)
//  - X-Achse: alle Jahre concatenated, aber nur relevante Monate je Event (DataZoom über Gesamtheit)
//  - Zusätzlich pro Jahr ein aggregierter Onset-Punkt (Beginn des Ereignisses) verbunden als Linie über die Jahre
//  - Ziel: zeitliche Verschiebung des Phänologie-Beginns über Jahre sichtbar machen
//  - Start von Grund auf (alte Darstellung verworfen)
//
// Umsetzung:
//  - Scatter: einzelne Beobachtungen (ein Punkt pro Beobachtungstag pro Baum mit Score)
//  - Onset-Linie: frühestes Datum mit Score >= onsetThreshold (Standard >=2) pro Jahr
//  - Monate-Filter je Event (EVENT_MONTHS)
//  - Multi-Year Sequenz: Für jeden Jahrabschnitt nur ausgewählte Monate angefügt (chronologisch)
//  - DataZoom: horizontales Scrollen über gesamte concatenated timeline
//  - Tooltip: dd.mm.yy (Score + Baum + Jahr)
//  - Chips zur (De-)Aktivierung einzelner Jahre (optional) – alle aktiv per Default
//  - Performance: Datensätze gefiltert nach Monaten serverseitig NICHT (Supabase hat kein month-filter hier) – clientseitige Filterung
//  - Erweiterbar: Aggregierte Verteilung / Heatmap (TODO-Kommentar)
//
// Hinweise / TODO:
//  - Falls Onset-Definition je Event anders gewünscht (z.B. Blüte Score >=7.1) -> thresholdMap anpassen.
//  - Für Events mit seltenen Beobachtungen könnte zusätzliche Glättung sinnvoll sein.
//  - Optionale Darstellung: Anteil Bäume pro Score als gestapelte Fläche (später)
//
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, getCurrentInstance } from 'vue'
import * as echarts from 'echarts'
import PlotSelect from './PlotSelect.vue'
import { plotsData } from './data/treeSpeciesData.js'

const instance = getCurrentInstance()
const supabase = instance.appContext.config.globalProperties.$supabase

// Props
const props = defineProps({
  schema: { type: String, default: 'icp_download' },
  table:  { type: String, default: 'ph_phi' },
  defaultPlot: { type: [String, Number], default: '1203' },
  defaultEvent: { type: Number, default: 1 },
  themeMode: { type: String, default: 'auto' }
})

// Ereignisse (ohne 5)
const EVENT_OPTIONS = [
  { code: 1, label: 'Austrieb' },
  { code: 2, label: 'Blattverfärbung' },
  { code: 3, label: 'Blatt-/Nadelfall' },
  { code: 4, label: 'Blatt/Krone Schaden' },
  { code: 6, label: 'Johannistrieb' },
  { code: 7, label: 'Blüte' },
  { code: 8, label: 'Fruchtbildung' }
]

// Monate je Event (nur typische relevante Monate; kann angepasst werden)
const EVENT_MONTHS = {
  1: [3,4],          // Austrieb – Mär, Apr (ggf. Mai, hier anpassbar)
  2: [8,9,10],       // Verfärbung – Sep, Okt, Nov
  3: [9,10,11],      // Blattfall – Okt, Nov, Dez (Monatsindex+1) -> hier 9=Okt etc. (Achtung: getMonth() 0=Jan)
  4: [0,1,2,3,4,5,6,7,8,9,10,11], // Schäden – ganzjährig
  6: [5,6,7],        // Johannistrieb – Jun, Jul, Aug
  7: [3,4],          // Blüte – Apr, Mai (Index 3=April)
  8: [6,7,8,9],      // Fruchtbildung – Jul, Aug, Sep, Okt
}
// Onset-Threshold je Event (Standard Score >=2; für Blüte optional >=7.1)
const onsetThresholdMap = {
  1: 2.0,
  2: 2.0,
  3: 2.0,
  4: 2.0,
  6: 2.0,
  7: 7.0,  // Blüte: Score 7.0 = present (oder 7.1 falls differenziert)
  8: 2.0
}

// State
const selectedPlot = ref(String(props.defaultPlot || '1203'))
const selectedEvent = ref(Number(props.defaultEvent))
const availableYears = ref([])            // alle Jahre mit Beobachtungen
const activeYears = ref([])               // vom Nutzer aktivierte Jahre (Subset)
const rawRows = ref([])                   // alle Zeilen für ausgewählten Plot + Event + Jahre
const plotYearsMap = ref(new Map())       // year -> rows[] (gefiltert nach Monaten)
const onsetPerYear = ref([])              // { year, dateMs, dateStr } für Onset-Linie

// UI Status
let myChart = null
const chartEl = ref(null)
const chartHeight = ref(600)
const screenWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1280)
const isLoading = ref(false)
const errorMessage = ref('')

// Farben
const BASE_PALETTE = ['#006D2C','#31A354','#74C476','#A1D99B','#C7E9C0','#FF7F00','#FDB863','#FEE391','#FEC44F','#FE9929','#EC7014']
function colorForScore(sc){
  // Scores 1..5 für Haupttypen verwenden Grüntöne, >5 (Blüte optional) Orange
  if(sc<=5){ return BASE_PALETTE[Math.max(0, sc-1)] }
  return '#FF9800'
}

// Plots deaktivieren
const DISABLED_PLOTS = new Set(['1201','1206'])
const plotsForSelect = computed(() => {
  const obj = {}
  for (const [k,v] of Object.entries(plotsData||{})) {
    const code = v?.code ?? k
    obj[code] = { ...(v||{}), code, disabled: DISABLED_PLOTS.has(String(code)) }
  }
  return obj
})

const isDark = computed(() => {
  if (props.themeMode === 'dark') return true
  if (props.themeMode === 'light') return false
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches } catch { return false }
})

function computeChartHeight(w){ if (w<600) return 480; if (w<960) return 560; return 620 }
function onResize(){ screenWidth.value=window.innerWidth; chartHeight.value=computeChartHeight(screenWidth.value); if(myChart && chartEl.value) myChart.resize({ height: chartHeight.value }) }

// Jahre laden (distinct survey_year)
async function fetchYears(){
  availableYears.value=[]; activeYears.value=[]
  if(!selectedPlot.value) return
  try {
    const { data, error } = await supabase
      .schema(props.schema)
      .from(props.table)
      .select('survey_year')
      .eq('code_event', selectedEvent.value)
      .eq('code_plot', Number(selectedPlot.value))
      .not('survey_year','is','null')
      .order('survey_year',{ ascending:true })
      .limit(50000)
    if(error) throw error
    const set = new Set(); for(const r of (data||[])) if(r?.survey_year!=null) set.add(Number(r.survey_year))
    const yrs = Array.from(set).sort((a,b)=>a-b)
    availableYears.value = yrs
    activeYears.value = yrs.slice() // alle aktiv
  } catch(e){ console.error('[fetchYears]', e) }
}

// Daten laden für aktive Jahre (ein Request pro Jahr -> ggf. optimieren; hier zusammen)
async function fetchRows(){
  rawRows.value=[]; plotYearsMap.value = new Map(); onsetPerYear.value=[]; errorMessage.value=''
  if(!activeYears.value.length) return
  try {
    isLoading.value=true
    const { data, error } = await supabase
      .schema(props.schema)
      .from(props.table)
      .select('code_plot,tree_number,date_observation,code_event,code_event_score,code_method,survey_year')
      .eq('code_event', selectedEvent.value)
      .eq('code_plot', Number(selectedPlot.value))
      .in('survey_year', activeYears.value)
      .order('survey_year',{ ascending:true })
      .order('date_observation',{ ascending:true })
      .order('tree_number',{ ascending:true })
      .limit(100000)
    if(error) throw error
    rawRows.value = (data||[]).filter(r=> r?.date_observation && r?.code_event_score!=null && r?.survey_year!=null)
    if(!rawRows.value.length){ errorMessage.value='Keine Beobachtungen für Auswahl.' }
    // Gruppieren nach Jahr + Monatsfilter
    const monthsAllowed = EVENT_MONTHS[selectedEvent.value] || [0,1,2,3,4,5,6,7,8,9,10,11]
    const onsetThreshold = onsetThresholdMap[selectedEvent.value] ?? 2.0
    const onsetCandidates = []
    const byYear = new Map()
    for(const r of rawRows.value){
      const y = Number(r.survey_year)
      const dt = new Date(r.date_observation + 'T00:00:00Z')
      const m = dt.getMonth()
      if(!monthsAllowed.includes(m)) continue
      const arr = byYear.get(y)||[]
      arr.push({ ...r, dateObj: dt })
      byYear.set(y, arr)
    }
    // Sort innerhalb Jahr & Onset bestimmen
    for(const [year, rows] of byYear.entries()){ 
      rows.sort((a,b)=> a.dateObj - b.dateObj)
      // Onset: erster Tag Score >= threshold
      const onsetRow = rows.find(r => Number(r.code_event_score) >= onsetThreshold)
      if(onsetRow){
        onsetCandidates.push({ year, dateObj: onsetRow.dateObj, dateMs: onsetRow.dateObj.getTime(), dateStr: onsetRow.dateObj.toISOString().slice(0,10) })
      }
    }
    plotYearsMap.value = byYear
    onsetPerYear.value = onsetCandidates.sort((a,b)=> a.year - b.year)
  } catch(e){ console.error('[fetchRows]', e); errorMessage.value='Fehler beim Laden der Daten.' }
  finally { isLoading.value=false }
}

// Daten für Chart (scatter + onset line)
const concatenatedScatter = computed(()=> {
  // x-Werte = echte Zeitstempel; keine künstliche Umskalierung nötig – DataZoom deckt ab
  const out = []
  for(const [year, rows] of plotYearsMap.value.entries()){
    for(const r of rows){
      out.push({
        value: [r.dateObj.getTime(), Number(r.code_event_score)],
        tree: r.tree_number,
        year,
        method: r.code_method
      })
    }
  }
  return out.sort((a,b)=> a.value[0]-b.value[0])
})

const onsetLineSeries = computed(()=> onsetPerYear.value.map(o => ({ value: [o.dateMs, 1.05], year: o.year, date: o.dateStr })))
// y=1.05 (leicht unter Score 1) => Wir verschieben später Y-Achse range etwas (>0.8..5.2), Linie klar sichtbar. Alternativ auf eigener Achse möglich.

// Achsen & Formatting
function formatDateMs(ms){ return new Date(ms).toLocaleDateString('de-DE',{ day:'2-digit', month:'2-digit', year:'2-digit'}) }

function buildChartOption(){
  const isMobile = screenWidth.value < 640
  const scatter = concatenatedScatter.value
  const onset = onsetLineSeries.value
  const monthsAllowed = EVENT_MONTHS[selectedEvent.value] || []

  // Dynamische X-Achsen Labels: nur Monatswechsel anzeigen
  const labelFormatter = (val)=> {
    const d = new Date(val)
    return d.toLocaleDateString('de-DE',{ month:'short' }) + ' ' + String(d.getFullYear()).slice(-2)
  }
  const monthStartSet = new Set()
  scatter.forEach(pt=> { const d = new Date(pt.value[0]); const key = `${d.getFullYear()}-${d.getMonth()}`; if(!monthStartSet.has(key)){ monthStartSet.add(key) } })

  return {
    backgroundColor:'transparent',
    title:{ text:`Phänologie – ${EVENT_OPTIONS.find(e=>e.code===selectedEvent.value)?.label || selectedEvent.value} · Plot ${selectedPlot.value}`, left:'left', top:8 },
    tooltip:{
      trigger:'item',
      formatter: params => {
        if(!params?.data) return ''
        const dms = params.data.value[0]
        const dateStr = formatDateMs(dms)
        if(params.seriesType==='line'){
          return `<strong>${dateStr}</strong><br/>Onset (Jahr ${params.data.year})` 
        }
        const sc = params.data.value[1]
        return `<strong>${dateStr}</strong><br/>Score: ${sc.toFixed(1)}<br/>Baum: ${params.data.tree}<br/>Jahr: ${params.data.year}`
      }
    },
    grid:{ left:isMobile?50:70, right:isMobile?30:40, top:isMobile?120:140, bottom:80 },
    dataZoom:[
      { type:'inside', xAxisIndex:0, filterMode:'none' },
      { type:'slider', xAxisIndex:0, bottom:25, height:isMobile?22:26, filterMode:'none' }
    ],
    xAxis:{
      type:'time',
      axisLabel:{ formatter: labelFormatter },
      min: scatter.length? scatter[0].value[0] : null,
      max: scatter.length? scatter[scatter.length-1].value[0] : null,
      splitLine:{ show:false }
    },
    yAxis:{
      type:'value',
      min:0.8, max:5.2,
      interval:1,
      axisLabel:{ formatter:v=> [1,2,3,4,5].includes(Math.round(v))? Math.round(v): '' },
      name:'Score', nameTextStyle:{ padding:[0,0,0,40] },
      splitLine:{ show:true }
    },
    legend:{ top: isMobile?70:80, data:['Beobachtungen','Onset'], selected:{ 'Beobachtungen': true, 'Onset': true } },
    series:[
      {
        name:'Beobachtungen', type:'scatter', symbol:'circle',
        data: scatter.map(p => ({ ...p })),
        symbolSize:(val)=> {
          // Score höher -> größerer Punkt
          const sc = val[1]; return sc>=4? 14: sc>=3? 11: 9
        },
        itemStyle:{ color:(params)=> colorForScore(params.data.value[1]) },
        opacity:0.9
      },
      {
        name:'Onset', type:'line', showSymbol:true, symbol:'diamond', symbolSize:14,
        data: onset,
        lineStyle:{ width:2.5, color:'#000', type:'solid' },
        itemStyle:{ color:'#000' },
        tooltip:{ show:true }
      }
    ]
  }
}

function ensureChart(){ if(!chartEl.value) return; if(!myChart){ myChart = echarts.init(chartEl.value) } }
function renderChart(){ if(!myChart) return; myChart.setOption(buildChartOption(), true) }

// Downloads
function downloadName(ext){ const ts=new Date().toISOString().substring(0,19).replace(/[:]/g,'-'); return `ph_multi_${selectedPlot.value}_${selectedEvent.value}_${ts}.${ext}` }
function generateCSV(){
  const rows=['date,year,tree,score,plot,event']
  concatenatedScatter.value.forEach(r=>{
    rows.push(`${new Date(r.value[0]).toISOString().slice(0,10)},${r.year},${r.tree},${r.value[1]},${selectedPlot.value},${selectedEvent.value}`)
  })
  onsetPerYear.value.forEach(o=>{
    rows.push(`${o.dateStr},${o.year},ONSET,THRESHOLD>=${onsetThresholdMap[selectedEvent.value]},${selectedPlot.value},${selectedEvent.value}`)
  })
  return rows.join('\n')
}
function downloadCSV(){ const csv=generateCSV(); const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}); const a=document.createElement('a'); const url=URL.createObjectURL(blob); a.href=url; a.download=downloadName('csv'); document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url) }
function downloadPNG(){ if(!myChart) return; const url=myChart.getDataURL({type:'png',pixelRatio:2,backgroundColor:'#fff'}); const a=document.createElement('a'); a.href=url; a.download=downloadName('png'); document.body.appendChild(a); a.click(); document.body.removeChild(a) }

// Watches
watch([selectedPlot, selectedEvent], async () => {
  await fetchYears(); await fetchRows(); await nextTick(); ensureChart(); renderChart()
})
watch(activeYears, async () => { await fetchRows(); await nextTick(); ensureChart(); renderChart() }, { deep:true })

onMounted(async () => {
  window.addEventListener('resize', onResize, { passive:true })
  screenWidth.value = window.innerWidth
  chartHeight.value = computeChartHeight(screenWidth.value)
  await fetchYears(); await fetchRows(); await nextTick(); ensureChart(); renderChart()
})
onBeforeUnmount(()=>{ window.removeEventListener('resize', onResize); if(myChart){ myChart.dispose(); myChart=null } })
</script>

<template>
  <div class="ph-multi-page">
    <PlotSelect
      v-model="selectedPlot"
      :plots="plotsForSelect"
      :columns="6"
      color="green-darken-2"
      :multiple="false"
      title="Bestandsflächen"
    />

    <v-card elevation="1" class="mb-3 soft-card">
      <v-card-title class="pb-2 title-row soft-green">Ereignis</v-card-title>
      <v-card-text>
        <div class="events-row">
          <v-checkbox
            v-for="ev in EVENT_OPTIONS"
            :key="ev.code"
            :label="ev.label"
            :model-value="selectedEvent===ev.code"
            color="green-darken-2"
            density="compact"
            hide-details
            @update:modelValue="val=>{ if(val) selectedEvent=ev.code }"
          />
        </div>
      </v-card-text>
    </v-card>

    <v-card elevation="1" class="mb-3 soft-card" v-if="availableYears.length">
      <v-card-title class="pb-2 title-row soft-green">Jahre</v-card-title>
      <v-card-text>
        <div class="years-row">
          <v-chip-group v-model="activeYears" multiple>
            <v-chip
              v-for="y in availableYears"
              :key="y"
              :value="y"
              size="small"
              variant="elevated"
              color="primary"
              class="mr-2"
            >{{ y }}</v-chip>
          </v-chip-group>
        </div>
        <div class="muted" v-if="!activeYears.length">Keine Jahre aktiv – bitte mindestens eins wählen.</div>
      </v-card-text>
    </v-card>

    <v-card elevation="1" class="mb-3 soft-card">
      <v-toolbar density="comfortable" color="transparent" flat>
        <div class="toolbar-actions">
          <v-btn size="small" variant="elevated tonal" color="primary" :disabled="!concatenatedScatter.length" @click="downloadPNG">PNG</v-btn>
          <v-btn size="small" variant="elevated tonal" color="primary" :disabled="!concatenatedScatter.length" class="ml-2" @click="downloadCSV">CSV</v-btn>
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
        <v-alert v-if="!isLoading && !concatenatedScatter.length" type="info" variant="tonal" class="mt-3">Keine Daten für Auswahl / Monate.</v-alert>
      </v-card-text>
    </v-card>
  </div>
</template>

<style scoped>
.ph-multi-page { display:flex; flex-direction:column; }
.events-row { display:flex; gap:8px 16px; flex-wrap:wrap; }
.years-row { display:flex; flex-wrap:wrap; }
.muted { color:#777; font-size:0.85rem; margin-top:8px; }
.soft-card { border:1px solid rgba(var(--v-theme-primary),0.22); border-radius:6px; }
.soft-green { background:linear-gradient(180deg, rgba(var(--v-theme-primary),0.06) 0%, rgba(var(--v-theme-primary),0.03) 100%); }
.toolbar-actions { width:100%; display:flex; justify-content:flex-end; }
@media (max-width:959px){ .events-row { flex-direction:column; } }
</style>
