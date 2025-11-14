<script>
// Konfiguration
const CHART_CONFIG = {
  Y_AXIS_PADDING: 0.1,
  MIN_PADDING: 5,
  LEGEND_TOP_DESKTOP: '60px',
  GRID_TOP_DESKTOP: '140px'
}
const CHART_STYLES = {
  symbolSize: 4,
  lineWidth: 2,
  fontSize: 12
}
export default { name: 'DefolLine' }
</script>

<script setup>
import { ref, onMounted, onBeforeUnmount, computed, getCurrentInstance, nextTick, watch } from 'vue'
import * as echarts from 'echarts'
import TreeSpeciesSelect from './TreeSpeciesSelect.vue'
import { plotsData, getSpeciesNameByCode, defaultTreeSpecies } from './data/treeSpeciesData.js'

// Supabase
const instance = getCurrentInstance()
const supabase = instance.appContext.config.globalProperties.$supabase

// Props
const props = defineProps({
  code_plot: { type: String, default: null }
})

// Chart Refs/State
let myChart
const chartContainer = ref(null)
const chartHeight = ref(600)
const screenWidth = ref(1024)

const xAxisData = ref([])
const seriesData = ref([])
const rawData = ref([])
const isLoading = ref(false)
const errorMessage = ref('')

// Datenbasis
const selectedSpecies = ref([])
const plots = plotsData
const treeSpecies = defaultTreeSpecies
const hasSelection = computed(() => selectedSpecies.value.length > 0)

// Responsive helpers
function computeChartHeight(w) {
  if (w < 600) return 360        // Phone
  if (w < 960) return 480        // Tablet
  return 600                     // Desktop
}
const legendTop = computed(() => {
  const w = screenWidth.value
  if (w < 600) return '44px'
  if (w < 960) return '52px'
  return CHART_CONFIG.LEGEND_TOP_DESKTOP
})
const gridTop = computed(() => {
  const w = screenWidth.value
  if (w < 600) return '96px'
  if (w < 960) return '120px'
  return CHART_CONFIG.GRID_TOP_DESKTOP
})
const xLabelRotate = computed(() => {
  const w = screenWidth.value
  if (w < 420) return 0
  if (w < 960) return 30
  return 45
})

// Auswahl als Codes
const selectedSpeciesCodes = computed(() => {
  if (selectedSpecies.value.length === 0) return []
  if (selectedSpecies.value.length === treeSpecies.length) {
    return treeSpecies.map(s => s.code)
  }
  return selectedSpecies.value
    .map(v => {
      const found = treeSpecies.find(s => s.value === v)
      return found ? found.code : null
    })
    .filter(Boolean)
})

// Y-Achse dynamisch
const yAxisRange = computed(() => calculateYAxisRange(seriesData.value))
function calculateYAxisRange(data) {
  if (!data || data.length === 0) return { min: 0, max: 100 }
  let minValue = Infinity
  let maxValue = -Infinity
  data.forEach(series => {
    if (Array.isArray(series.data)) {
      series.data.forEach(value => {
        if (typeof value === 'number' && !isNaN(value)) {
          minValue = Math.min(minValue, value)
          maxValue = Math.max(maxValue, value)
        }
      })
    }
  })
  if (minValue === Infinity || maxValue === -Infinity) return { min: 0, max: 100 }
  const range = maxValue - minValue
  const padding = Math.max(range * CHART_CONFIG.Y_AXIS_PADDING, CHART_CONFIG.MIN_PADDING)
  return {
    min: Math.max(0, Math.floor(minValue - padding)),
    max: Math.min(100, Math.ceil((maxValue + padding) / 10) * 10)
  }
}

/* CSV Export */
const filteredPlots = computed(() =>
  Object.keys(plotsData).filter(plotCode => {
    const plot = plotsData[plotCode]
    return plot.species.some(speciesCode => selectedSpeciesCodes.value.includes(speciesCode))
  })
)

function downloadName(dat_ext) {
  if (dat_ext === 'header') {
  return '# Kronenverlichtung (⌀) - Zeitreihe\n' +
        `# Plots:\t${filteredPlots.value.join(', ')}\n` +
        `# Erstellt:\t${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC\n` +
        '# Quelle:\tICP Forest Data des Landesbetrieb Forst Brandenburg\n' +
        '# Link:\t\thttps://forstliche-umweltkontrolle.de/dauerbeobachtung/level-ii/\n' +
        `# HBA:\t\t${selectedSpecies.value.join(', ')}\n`
  } 
  const ts = new Date().toISOString().substring(0,19).replace(/[:]/g,'-')
  const partname = computed(() => metric.value === 'area' ? 'flaeche' : 'masse')
  const filename = `kronenverlichtung_avg_${ts}.${dat_ext}`
  return filename
}

function generateCSV() {
  if (!seriesData.value.length || !xAxisData.value.length) return ''
  const csv = []
  csv.push(downloadName('header'))
  csv.push('')
  const headers = ['Year']
  seriesData.value.forEach(series => {
    const plotInfo = plots[series.name]
    const speciesName = plotInfo ? getSpeciesNameByCode(plotInfo.species[0]) : 'Unknown'
    headers.push(`Plot ${series.name} (${speciesName})`)
  })
  csv.push(headers.join(','))
  xAxisData.value.forEach(year => {
    const row = [year]
    seriesData.value.forEach(series => {
      const yearIndex = xAxisData.value.indexOf(year)
      const value = series.data[yearIndex]
      row.push(value !== null && value !== undefined ? Number(value).toFixed(2) : '')
    })
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
  } catch (e) { console.error('PNG Export fehlgeschlagen', e) }
}

// Datenaufbereitung
function _parseData(arr) {
  if (selectedSpeciesCodes.value.length === 0) { seriesData.value = []; xAxisData.value = []; return }
  if (!arr || !Array.isArray(arr)) { seriesData.value = []; xAxisData.value = []; return }

  // Nach Baumart (über Plot-Metadaten) filtern
  let filtered = arr.filter(item => {
    const plotCode = String(item.name)
    const info = plots[plotCode]
    const code = info && info.species && info.species.length ? info.species[0] : null
    return code ? selectedSpeciesCodes.value.includes(code) : false
  })

  // Optional: nach plot filtern
  if (props.code_plot) {
    filtered = filtered.filter(item => String(item.name) === String(props.code_plot))
  }

  // Jahre
  const yearSet = new Set()
  filtered.forEach(item => {
    if (Array.isArray(item.data)) item.data.forEach(point => yearSet.add(point.year))
  })
  const allYears = Array.from(yearSet).sort((a,b) => a - b)
  xAxisData.value = allYears

  // Serien
  seriesData.value = filtered.map(item => {
    const plotCode = String(item.name)
    const info = plots[plotCode]
    const color = info && info.color ? info.color : '#4CAF50'
    const data = allYears.map(year => {
      const found = item.data.find(d => d.year === year)
      return found ? found.value : null
    })
    return {
      name: plotCode,
      type: 'line',
      data,
      symbolSize: CHART_STYLES.symbolSize,
      lineStyle: { width: CHART_STYLES.lineWidth, color },
      connectNulls: false,
      itemStyle: { color, borderColor: color },
      emphasis: { focus: 'self', lineStyle: { width: CHART_STYLES.lineWidth + 1.5 } }
    }
  })
}

// Chart rendern
function _renderChart() {
  if (!myChart) return

  // Keine Auswahl
  if (selectedSpeciesCodes.value.length === 0) {
    myChart.clear()
    myChart.setOption({
      backgroundColor: 'transparent',
      title: {
        text: 'Bitte wählen Sie mindestens eine Baumart',
        left: 'center',
        top: 'middle',
        textStyle: { color: '#999', fontSize: 16 }
      },
      xAxis: { type: 'category', data: [] },
      yAxis: { type: 'value' },
      series: []
    }, true)
    return
  }

  // Keine Daten
  if (!seriesData.value.length) {
    myChart.clear()
    myChart.setOption({
      backgroundColor: 'transparent',
      title: {
        text: 'Keine Daten für die ausgewählten Baumarten verfügbar',
        left: 'center',
        top: 'middle',
        textStyle: { color: '#999', fontSize: 16 }
      },
      xAxis: { type: 'category', data: [] },
      yAxis: { type: 'value' },
      series: []
    }, true)
    return
  }

  // Normales Rendern
  myChart.setOption({
    backgroundColor: 'transparent',

    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      formatter: function (params) {
        if (!params || !params.length) return ''
        let result = '<strong>Jahr: ' + params[0].axisValue + '</strong><br/>'
        params.forEach(function (param) {
          if (param.value !== null && param.value !== undefined) {
            const plotCode = param.seriesName
            const plotInfo = plots[plotCode]
            const speciesName = plotInfo ? getSpeciesNameByCode(plotInfo.species[0]) : ''
            const name = plotInfo && plotInfo.name ? plotInfo.name : ''
            const val = (param.value == null ? '-' : Number(param.value).toFixed(2))
            result += 'Plot ' + plotCode + ' - ' + name + ' (' + speciesName + '): ' + val + '%<br/>'
          }
        })
        return result
      }
    },

    title: [
      {
          left: 'left',
          text: 'Kronenverlichtung (⌀) - Zeitreihe',
      },
      {
        left: 'left',
        text: 'ICP Forest Data des Landesbetrieb Forst Brandenburg',
        bottom: '0',
        textStyle: { fontSize: 12, fontWeight: 'normal', color: '#999' }
      },
      {
        left: 'right',
        text: 'forstliche-umweltkontrolle.de',
        bottom: '0',
        textStyle: { fontSize: 12, fontWeight: 'normal', color: '#999' }
      }
    ],

    grid: {
      left: '3%',
      top: gridTop.value,
      right: '4%',
      bottom: '15%',
      containLabel: true
    },

    xAxis: {
      data: xAxisData.value,
      type: 'category',
      axisLabel: { interval: 0, rotate: xLabelRotate.value, margin: 14 }
    },

    yAxis: {
      type: 'value',
      name:'Kronenverlichtung(%)',  
      nameTextStyle: {
        padding: [0, 0, 0, 25] 
      },
      min: yAxisRange.value.min,
      max: yAxisRange.value.max,
      axisLabel: { formatter: '{value}%' },
      splitArea: { show: false },
      scale: true,
      boundaryGap: [0.1, 0.1]
    },

    legend: {
      top: legendTop.value,
      left: 'center',
      icon: 'roundRect',
      data: seriesData.value.map(s => s.name),
      type: 'scroll',
      itemWidth: 24,
      itemHeight: 18,
      inactiveColor: '#ccc',
      textStyle: { fontSize: CHART_STYLES.fontSize },
      formatter: function(plotCode) {
        const plotInfo = plots[plotCode]
        if (plotInfo) {
          const speciesName = getSpeciesNameByCode(plotInfo.species[0])
          return plotCode + '\n(' + speciesName + ')'
        }
        return plotCode
      },
      selectedMode: true
    },

    series: seriesData.value.map(s => ({
      name: s.name,
      type: s.type,
      data: s.data,
      symbolSize: s.symbolSize,
      connectNulls: s.connectNulls,
      lineStyle: { width: CHART_STYLES.lineWidth, color: s.itemStyle.color },
      itemStyle: { color: s.itemStyle.color, borderColor: s.itemStyle.color, borderWidth: 2 },
      emphasis: {
        focus: 'self',
        lineStyle: { width: CHART_STYLES.lineWidth + 1.5 }
      }
    })),

    dataZoom: [
      { type: 'slider', start: 65, end: 100, bottom: 40, height: 20 },
      { type: 'inside', start: 65, end: 100 }
    ]
  }, true)
}

// Daten laden
async function _requestData() {
  if (isLoading.value) return
  try {
    isLoading.value = true
    errorMessage.value = ''
    const { data, error } = await supabase.from('v_cc_defol_avg').select('*')
    if (error) { errorMessage.value = 'Fehler beim Laden der Daten: ' + error.message; return }
    const resultArray = data && data[0] && Array.isArray(data[0].result) ? data[0].result : []
    rawData.value = resultArray
    if (hasSelection.value) {
      _parseData(resultArray)
      _renderChart()
    }
  } catch (err) {
    errorMessage.value = 'Fehler beim Laden der Daten: ' + err.message
  } finally {
    isLoading.value = false
  }
}

// Events
function onSpeciesSelectionChanged() {
  if (!hasSelection.value) {
    seriesData.value = []; xAxisData.value = []
    if (myChart) { myChart.dispose(); myChart = null }
    return
  }
  if (rawData.value && rawData.value.length) _parseData(rawData.value)
  else { seriesData.value = []; xAxisData.value = [] }
  _renderChart()
}

// Watches
watch(selectedSpeciesCodes, () => {
  if (!hasSelection.value) {
    seriesData.value = []; xAxisData.value = []
    if (myChart) { myChart.dispose(); myChart = null }
    return
  }
  if (rawData.value && rawData.value.length > 0) _parseData(rawData.value)
  else { seriesData.value = []; xAxisData.value = [] }
  _renderChart()
}, { deep: true })

watch(() => props.code_plot, (nv, ov) => {
  if (nv !== ov) {
    if (rawData.value && rawData.value.length > 0 && hasSelection.value) _parseData(rawData.value)
    _renderChart()
  }
})

watch(yAxisRange, () => { if (myChart && hasSelection.value) _renderChart() }, { deep: true })

watch(hasSelection, async (selected) => {
  if (selected) {
    await nextTick()
    if (!myChart && chartContainer.value) {
      myChart = echarts.init(chartContainer.value)
      myChart.resize({ height: chartHeight.value, width: chartContainer.value.clientWidth })
    }
    if (rawData.value.length) { _parseData(rawData.value); _renderChart() }
  } else {
    if (myChart) { myChart.dispose(); myChart = null }
  }
})

// Resize handling (responsive)
function handleResize() {
  const w = window.innerWidth
  screenWidth.value = w
  const newHeight = computeChartHeight(w)
  if (newHeight !== chartHeight.value) chartHeight.value = newHeight
  if (myChart && chartContainer.value) {
    myChart.resize({ height: chartHeight.value, width: chartContainer.value.clientWidth })
  }
}

onMounted(async () => {
  screenWidth.value = window.innerWidth
  chartHeight.value = computeChartHeight(screenWidth.value)
  await nextTick()
  if (hasSelection.value && chartContainer.value) {
    myChart = echarts.init(chartContainer.value)
    myChart.resize({ height: chartHeight.value, width: chartContainer.value.clientWidth })
  }
  window.addEventListener('resize', handleResize)
  await _requestData()
})

onBeforeUnmount(() => {
  if (myChart) myChart.dispose()
  window.removeEventListener('resize', handleResize)
})

// Expose (optional)
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
     <v-card elevation="1" class="mb-3 soft-card"> 
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
      </v-card>

      <v-alert
        v-if="errorMessage"
        type="error"
        variant="tonal"
        class="mt-3"
        dismissible
        @click:close="errorMessage = ''"
      >
        {{ errorMessage }}
      </v-alert>
</template>

<style scoped>
.soft-card { border: 1px solid rgba(var(--v-theme-primary), 0.22); border-radius: 6px; }
.toolbar-actions { width: 100%; display: flex; justify-content: flex-end; align-items: center; margin-right: 10px;}
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
</style>