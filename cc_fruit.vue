<script setup>
import { ref, onMounted, onBeforeUnmount, watch, getCurrentInstance, computed, nextTick } from 'vue'
import * as echarts from 'echarts'
import { createClient } from '@supabase/supabase-js'
import TreeSpeciesSelect from './TreeSpeciesSelect.vue'
import { defaultTreeSpecies, plotsData, getSpeciesNameByCode } from './data/treeSpeciesData.js'

const instance = getCurrentInstance()
const apikey = instance.appContext.config.globalProperties.$apikey
const url = instance.appContext.config.globalProperties.$url
const supabase = createClient(url, apikey)

// Chart setup
const chartHeight = ref(600)
let myChart = null
const chartContainer = ref(null)
const isLoading = ref(false)
const screenWidth = ref(window.innerWidth)

// Data
const xAxisData = ref([])
const seriesData = ref([])
const rawData = ref([])
const plotYearData = ref({})

// Species selection
const selectedSpecies = ref(['Kiefern', 'Buchen', 'Eichen'])
const availableSpecies = ref(defaultTreeSpecies)
const hasSelection = computed(() => selectedSpecies.value.length > 0)

// Fruit categories with colors
const fruitCategories = [
  { key: 'fruit_1_percent', name: 'wenig Frucht (0-1)', color: '#ff9999', shortName: 'wenig (0-1)' },
  { key: 'fruit_2_percent', name: 'mittlere Frucht (2)', color: '#ffcc99', shortName: 'mittel (2)' },
  { key: 'fruit_3_percent', name: 'viel Frucht (3)', color: '#99ff99', shortName: 'viel (3)' }
]

// Helper: safe number
function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// Largest-remainder rounding to a fixed sum with given decimals
function roundToFixedSum(values, decimals = 1, targetSum = 100, priorityOrder = [0, 1, 2]) {
  // values assumed >= 0
  const factor = Math.pow(10, decimals)
  // Work in integer "tenths"
  const scaled = values.map(v => Math.max(0, v) * factor)
  const floors = scaled.map(x => Math.floor(x + 1e-12))
  const remainders = scaled.map((x, i) => ({ i, rem: x - floors[i], val: values[i] }))
  let diff = Math.round(targetSum * factor) - floors.reduce((a, b) => a + b, 0)
  const result = floors.slice()

  // Tie-break: by remainder desc, then by original value desc, then by priority order
  const tiePriority = (i) => priorityOrder.indexOf(i)
  if (diff > 0) {
    remainders
      .sort((a, b) => (b.rem - a.rem) || (b.val - a.val) || (tiePriority(a.i) - tiePriority(b.i)))
      .slice(0, diff)
      .forEach(({ i }) => { result[i] += 1 })
  } else if (diff < 0) {
    // Need to subtract |diff| units from the smallest remainders
    remainders
      .sort((a, b) => (a.rem - b.rem) || (a.val - b.val) || (tiePriority(a.i) - tiePriority(b.i)))
      .slice(0, Math.min(-diff, remainders.length))
      .forEach(({ i }) => { if (result[i] > 0) result[i] -= 1 })
  }
  return result.map(x => x / factor)
}

// Normalize three parts to 100 and round so the sum is exactly 100.0
function normalizeAndRoundTo100(a, b, c, decimals = 1) {
  const parts = [Math.max(0, toNum(a)), Math.max(0, toNum(b)), Math.max(0, toNum(c))]
  const total = parts[0] + parts[1] + parts[2]
  if (total <= 0) return [0, 0, 0]
  const normalized = parts.map(v => (v * 100) / total)
  // Priority: allocate ties to the largest category first (fruit_3, then fruit_2, then fruit_1)
  const priority = [2, 1, 0] // indices in [fruit_1, fruit_2, fruit_3]
  const rounded = roundToFixedSum(normalized, decimals, 100, priority)
  // Guard against tiny negatives due to FP
  return rounded.map(v => Math.max(0, Number(v.toFixed(decimals))))
}

const selectedSpeciesCodes = computed(() =>
  selectedSpecies.value
    .map(speciesName => availableSpecies.value.find(s => s.label === speciesName)?.code ?? null)
    .filter(code => code !== null)
)

const filteredPlots = computed(() =>
  Object.keys(plotsData).filter(plotCode => {
    const plot = plotsData[plotCode]
    return plot.species.some(speciesCode => selectedSpeciesCodes.value.includes(speciesCode))
  })
)

const xLabelRotate = computed(() => {
  const w = screenWidth.value
  if (w < 420) return 0
  if (w < 960) return 30
  return 45
})

// Methods
function _parseData(icpData) {
  if (!icpData || icpData.length === 0) {
    console.warn('No data to parse')
    return
  }

  const filteredData = icpData.filter(item => filteredPlots.value.includes(item.code_plot.toString()))

  const years = [...new Set(filteredData.map(item => item.survey_year))].sort((a, b) => a - b)
  xAxisData.value = years

  plotYearData.value = {}
  filteredData.forEach(item => {
    const plotCode = item.code_plot.toString()
    const year = item.survey_year
    const key = `${plotCode}_${year}`

    // raw percents (can be any non-negative numbers)
    const f1 = Math.max(0, toNum(item.fruit_1_percent))
    const f2 = Math.max(0, toNum(item.fruit_2_percent))
    const f3 = Math.max(0, toNum(item.fruit_3_percent))

    // Normalize to 100 and round to 0.1 so that sum is EXACTLY 100.0
    const [p1, p2, p3] = normalizeAndRoundTo100(f1, f2, f3, 1)

    plotYearData.value[key] = {
      plotCode,
      plotName: plotsData[plotCode]?.name || plotCode,
      species: getSpeciesNameByCode(plotsData[plotCode]?.species[0]),
      year,
      fruit_1_percent: p1,
      fruit_2_percent: p2,
      fruit_3_percent: p3
    }
  })

  // Build series
  const plotData = {}
  Object.keys(plotYearData.value).forEach(key => {
    const data = plotYearData.value[key]
    const plotCode = data.plotCode
    const year = data.year
    if (!plotData[plotCode]) plotData[plotCode] = {}
    plotData[plotCode][year] = {
      fruit_1_percent: data.fruit_1_percent,
      fruit_2_percent: data.fruit_2_percent,
      fruit_3_percent: data.fruit_3_percent
    }
  })

  seriesData.value = []

  filteredPlots.value.forEach(plotCode => {
    const plot = plotsData[plotCode]
    const legendName = `${plotCode}\n(${getSpeciesNameByCode(plot.species[0])})`

    fruitCategories.forEach(category => {
      const data = years.map(year => {
        const yearData = plotData[plotCode]?.[year]
        const value = yearData ? (yearData[category.key] ?? 0) : 0
        return {
          value: value, // already rounded to 0.1 and normalized
          plotCode,
          year,
          categoryKey: category.key,
          plotName: plot.name,
          species: getSpeciesNameByCode(plot.species[0]),
          fruit_1_percent: yearData ? yearData.fruit_1_percent : 0,
          fruit_2_percent: yearData ? yearData.fruit_2_percent : 0,
          fruit_3_percent: yearData ? yearData.fruit_3_percent : 0,
          hasData: !!yearData && (yearData.fruit_1_percent > 0 || yearData.fruit_2_percent > 0 || yearData.fruit_3_percent > 0)
        }
      })

      seriesData.value.push({
        name: legendName,
        type: 'bar',
        stack: `stack_${plotCode}`,
        data,
        itemStyle: { color: category.color },
        emphasis: { focus: 'series', blurScope: 'coordinateSystem' },
        categoryKey: category.key,
        categoryName: category.name,
        categoryColor: category.color
      })
    })
  })
}

async function _requestData() {
  try {
    isLoading.value = true

    const { data, error } = await supabase
      .schema('public')
      .from('v_cc_fruit_bar')
      .select('*')
      .order('code_plot')
      .order('survey_year')

    if (error) {
      console.error('Error fetching data:', error)
      return
    }
    if (!data || data.length === 0) {
      console.warn('No data found')
      return
    }

    rawData.value = data
    if (hasSelection.value) {
      _parseData(data)
      _updateChart()
    }
  } catch (error) {
    console.error('Error in requestData:', error)
  } finally {
    isLoading.value = false
  }
}

function _updateChart() {
  if (!myChart || seriesData.value.length === 0) return

  const legendData = filteredPlots.value.map(plotCode => {
    const plot = plotsData[plotCode]
    return `${plotCode}\n(${getSpeciesNameByCode(plot.species[0])})`
  })

  const option = {
    title: [
      { left: '25px', text: 'Fruchtbildung nach Jahren' },
      {
        left: '20px',
        top: 30,
        text: ['{low|■} Wenig Frucht (0-1)  ', '{medium|■} Mittlere Frucht (2)  ', '{high|■} Viel Frucht (3)'].join(''),
        textStyle: {
          fontSize: 14,
          rich: {
            low: { color: '#ff9999', fontSize: 16 },
            medium: { color: '#ffcc99', fontSize: 16 },
            high: { color: '#99ff99', fontSize: 16 }
          }
        }
      },
      {
        left: 'left',
        text: 'ICP Forest Data des Landesbetrieb Forst Brandenburg',
        bottom: '20',
        textStyle: { fontSize: 12, fontWeight: 'normal', color: '#999' }
      },
      {
        left: 'right',
        text: 'forstliche-umweltkontrolle.de',
        bottom: '20',
        textStyle: { fontSize: 12, fontWeight: 'normal', color: '#999' }
      }
    ],
    tooltip: {
      trigger: 'item',
      formatter: function (params) {
        const data = params.data
        if (!data || !data.hasData) return ''
        const key = `${data.plotCode}_${data.year}`
        const p = plotYearData.value[key]
        let tooltipContent = `<strong>Plot ${data.plotCode} (${data.plotName})</strong><br/>`
        tooltipContent += `<strong>Jahr: ${data.year}</strong><br/>`
        tooltipContent += `<strong>Baumart: ${data.species}</strong><br/><br/>`
        fruitCategories.forEach(category => {
          const val = p ? (p[category.key] ?? 0) : 0
          tooltipContent += `<span style="display:inline-block;margin-right:8px;border-radius:2px;width:12px;height:12px;background-color:${category.color};"></span>`
          tooltipContent += `${category.name}: <strong>${val.toFixed(1)}%</strong><br/>`
        })
        // Optional: Summe anzeigen (sollte exakt 100.0 sein)
        const sum = (p.fruit_1_percent + p.fruit_2_percent + p.fruit_3_percent).toFixed(1)
        tooltipContent += `<br/><em>Summe: ${sum}%</em>`
        return tooltipContent
      }
    },
    legend: {
      top: 70,
      data: legendData,
      type: 'scroll',
      orient: 'horizontal',
      formatter: name => name.replace('\\n', '\n'),
      textStyle: { lineHeight: 20, padding: [5, 0] },
      itemGap: 15
    },
    grid: { left: 60, top: 140, right: 40, bottom: 120 },
    xAxis: {
      type: 'category',
      name: 'Jahr',
      nameLocation: 'middle',
      nameGap: 30,
      data: xAxisData.value,
      axisLabel: { interval: 0, rotate: xLabelRotate.value, margin: 14 }
    },
    yAxis: {
      type: 'value',
      name: 'Prozent (%)',
      nameLocation: 'middle',
      nameGap: 40,
      max: 100,
      axisLabel: { formatter: '{value}%' }
    },
    series: seriesData.value,
    dataZoom: [
      { type: 'slider', start: 65, end: 100, bottom: 60, height: 20 },
      { type: 'inside', start: 65, end: 100 }
    ],
    animation: true,
    animationDuration: 1000
  }

  myChart.setOption(option, true)

  myChart.off('mouseover')
  myChart.off('mouseout')

  myChart.on('mouseover', function (params) {
    const plotCode = params.data.plotCode
    const action = {
      type: 'highlight',
      seriesName: seriesData.value.filter(series => series.stack === `stack_${plotCode}`).map(s => s.name),
      dataIndex: params.dataIndex
    }
    myChart.dispatchAction(action)
  })

  myChart.on('mouseout', function (params) {
    const plotCode = params.data.plotCode
    const action = {
      type: 'downplay',
      seriesName: seriesData.value.filter(series => series.stack === `stack_${plotCode}`).map(s => s.name),
      dataIndex: params.dataIndex
    }
    myChart.dispatchAction(action)
  })
}

// CSV Download

function downloadName(dat_ext) {
  if (dat_ext === 'header') {
  return '# Fruchtbildung nach Jahren\n' +
        `# Plots:\t${filteredPlots.value.join(', ')}\n` +
        `# Erstellt:\t${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC\n` +
        '# Quelle:\tICP Forest Data des Landesbetrieb Forst Brandenburg\n' +
        '# Link:\t\thttps://forstliche-umweltkontrolle.de/dauerbeobachtung/level-ii/\n' +
        `# HBA:\t\t${selectedSpecies.value.join(', ')}\n`
  } 
  const ts = new Date().toISOString().substring(0,19).replace(/[:]/g,'-')
  const filename = `fruchtbildung_${ts}.${dat_ext}`
  return filename
}

function generateCSV() {
  if (!plotYearData.value || Object.keys(plotYearData.value).length === 0 || !xAxisData.value.length) {
    console.error('Keine Daten für CSV-Generierung vorhanden')
    return ''
  }
  const csv = []
  csv.push(downloadName('header'))
  csv.push(``)
  const headers = ['Plot', 'Plot_Name', 'Species', 'Year', 'wenig_Frucht_0_1_Percent', 'mittlere_Frucht_2_Percent', 'viel_Frucht_3_Percent', 'Summe_Percent']
  csv.push(headers.join(','))

  const sortedKeys = Object.keys(plotYearData.value).sort((a, b) => {
    const [plotA, yearA] = a.split('_')
    const [plotB, yearB] = b.split('_')
    if (plotA !== plotB) return plotA.localeCompare(plotB)
    return parseInt(yearA) - parseInt(yearB)
  })

  sortedKeys.forEach(key => {
    const d = plotYearData.value[key]
    const sum = (d.fruit_1_percent + d.fruit_2_percent + d.fruit_3_percent)
    const row = [
      d.plotCode,
      `"${d.plotName}"`,
      `"${d.species}"`,
      d.year,
      d.fruit_1_percent.toFixed(1),
      d.fruit_2_percent.toFixed(1),
      d.fruit_3_percent.toFixed(1),
      sum.toFixed(1)
    ]
    csv.push(row.join(','))
  })

  return csv.join('\n')
}

function downloadCSV() {
  const csvContent = generateCSV()
  if (!csvContent) { errorMessage.value = 'Keine Daten zum Download verfügbar'; return }
  const filename = downloadName('csv')
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  const url = URL.createObjectURL(blob)
  a.href = url; 
  a.download = filename; 
  a.style.visibility = 'hidden'
  document.body.appendChild(a); 
  a.click(); 
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/* PNG Export */
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

// Event handlers
function onSpeciesSelectionChanged() {
  if (!hasSelection.value) {
    // Auswahl leer => Chart entsorgen
    if (myChart) {
      myChart.dispose()
      myChart = null
    }
    seriesData.value = []
    return
  }
  if (rawData.value.length > 0) {
    _parseData(rawData.value)
    _updateChart()
  }
}

const handleResize = () => {
  if (myChart) myChart.resize()
}

// Watchers
watch(selectedSpecies, () => {
  onSpeciesSelectionChanged()
}, { deep: true })

watch(hasSelection, async (selected) => {
  if (selected) {
    await nextTick() // warte, bis der Container gerendert ist
    if (!myChart && chartContainer.value) {
      myChart = echarts.init(chartContainer.value)
      myChart.resize({ height: chartHeight.value, width: chartContainer.value.clientWidth })
    }
    if (rawData.value.length > 0) {
      _parseData(rawData.value)
      _updateChart()
    }
  } else {
    if (myChart) {
      myChart.dispose()
      myChart = null
    }
  }
})

// Lifecycle
onMounted(async () => {
  if (chartContainer.value) {
    myChart = echarts.init(chartContainer.value)
    myChart.resize({ height: chartHeight.value, width: chartContainer.value.clientWidth })
  }
  window.addEventListener('resize', handleResize)
  await _requestData()
})

onBeforeUnmount(() => {
  if (myChart) {
    myChart.dispose()
    myChart = null
  }
  window.removeEventListener('resize', handleResize)
})

// Expose for parent
defineExpose({
  refreshData: _requestData,
  selectedSpecies,
  isLoading,
  downloadCSV,
  downloadChartPNG
})
</script>

<template>
  
      <!-- Auswahlbereich -->
      <TreeSpeciesSelect
        v-model="selectedSpecies"
        :select-all-by-default="true"
        :show-debug="false"
        :min-selection="0"
        class="mb-4"
        @selection-changed="onSpeciesSelectionChanged"
      />

      <!-- Chartbereich -->
        <v-toolbar density="comfortable" color="transparent" flat>
          <div class="toolbar-actions">
            <v-btn
              size="small"
              variant="elevated tonal"
              color="primary"
              @click="downloadChartPNG"
              :disabled="isLoading || !hasSelection"
              title="Chart als PNG speichern"
            >
              PNG
            </v-btn>
            <v-btn
              size="small"
              variant="elevated tonal"
              color="primary"
              @click="downloadCSV"
              :disabled="!hasSelection || !rawData || !rawData.length"
              class="ml-2"
              title="Chartdaten als CSV exportieren"
            >
              CSV
            </v-btn>
          </div>
        </v-toolbar>
        

          <!-- Wenn Auswahl vorhanden: Chart zeigen -->
          <div
            v-if="hasSelection"
            :style="{ position: 'relative', width: '100%', height: chartHeight + 'px' }"
          >
            <div ref="chartContainer" :style="{ width: '100%', height: chartHeight + 'px' }" />
            <v-overlay v-model="isLoading" contained class="align-center justify-center">
              <v-progress-circular color="primary" indeterminate size="52" />
            </v-overlay>
          </div>

          <!-- Wenn keine Auswahl: Hinweis im Chartbereich -->
          <div
            v-else
            class="empty-state"
            :style="{ height: chartHeight + 'px' }"
          >
            <v-alert variant="plain" color="primary" border="start" elevation="0">
              Bitte wählen Sie mindestens eine Baumart.
            </v-alert>
          </div>
</template>

<style scoped>
.v-card.chart-card { box-shadow: var(--v-shadow-1) !important; }
.toolbar-actions {
  width: 100%;
  display: flex;
  justify-content: flex-end; 
  align-items: center;
}
.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: large;
  padding: 16px;
  background: linear-gradient(
    180deg,
    rgba(var(--v-theme-primary), 0.08) 0%,
    rgba(var(--v-theme-primary), 0.04) 100%
  );
  border: 1px solid rgba(var(--v-theme-primary), 0.22);
  border-radius: 8px;
}

/* Mobile/Tablet Feinheiten */
@media (max-width: 959px) {
  .page-card { margin: 6px; }
  .chart-card { margin-bottom: 10px; }
  .toolbar-actions .v-btn { min-width: 56px; padding: 0 10px; }
}
@media (max-width: 599px) {
  .toolbar-actions { gap: 6px; }
  .toolbar-actions .ml-2 { margin-left: 6px !important; }
}
</style>