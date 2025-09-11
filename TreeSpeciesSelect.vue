<template>
  <!-- Optionaler Wrapper: standardmäßig v-card, sonst div -->
  <component
    :is="wrapInCard ? 'v-card' : 'div'"
    :class="['tree-species-card', { 'is-card': wrapInCard }]"
    :elevation="wrapInCard ? cardElevation : undefined"
  >
    <v-card-title class="pb-2 title-row">
      <v-icon class="mr-2" color="green-darken-2">mdi-tree</v-icon>
      <span>Hauptbaumarten</span>
      <span v-if="isEmptySelection" class="empty-hint">
        – bitte wählen Sie mindestens eine Baumart
      </span>
    </v-card-title>

    <v-card-text class="pt-0">
      <v-alert
        v-if="validationMessage && validationType === 'error'"
        :type="validationType"
        variant="tonal"
        class="mb-3"
        density="compact"
      >
        {{ validationMessage }}
      </v-alert>

      <v-row dense>
        <v-col
          v-for="species in treeSpeciesList"
          :key="species.value"
          cols="12"
          sm="6"
          md="4"
          lg="3"
        >
          <v-checkbox
            v-model="localSelectedSpecies"
            :value="species.value"
            :label="species.label"
            :color="species.color || 'primary'"
            :disabled="isDisabled(species.value)"
            hide-details
            density="comfortable"
            class="species-checkbox"
          >
            <template #prepend>
              <v-icon
                :color="species.color || 'primary'"
                size="small"
                class="species-icon"
              >
                {{ species.icon || 'mdi-tree' }}
              </v-icon>
            </template>
          </v-checkbox>
        </v-col>
      </v-row>

      <v-expand-transition>
        <v-alert
          v-if="showDebug"
          type="info"
          variant="tonal"
          class="mt-3"
          density="compact"
        >
          <template #title>Debug Info</template>
          <div class="text-caption">
            <strong>Ausgewählt:</strong> {{ localSelectedSpecies.join(', ') || 'Keine' }}<br>
            <strong>Anzahl:</strong> {{ selectedCount }}<br>
            <strong>Letzte Änderung:</strong> {{ lastChanged || 'Keine' }}<br>
            <strong>Validierung:</strong> {{ validationMessage || 'OK' }}<br>
            <strong>Alle verfügbar:</strong> {{ treeSpeciesList.map(s => s.value).join(', ') }}<br>
            <strong>Component Status:</strong> {{ isValid ? 'Valid' : 'Invalid' }}<br>
            <strong>Plots:</strong> {{ Object.keys(plotsData).join(', ') }}<br>
            <strong>Species codes:</strong> {{ treeSpeciesList.map(s => s.code).join(', ') }}
          </div>
        </v-alert>
      </v-expand-transition>
    </v-card-text>
  </component>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { defaultTreeSpecies, plotsData, getSpeciesNameByCode } from './data/treeSpeciesData.js'

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  treeSpecies: { type: Array, default: () => defaultTreeSpecies },
  selectAllByDefault: { type: Boolean, default: true },
  showDebug: { type: Boolean, default: false },
  minSelection: { type: Number, default: 0, validator: (v) => v >= 0 },
  maxSelection: { type: Number, default: null, validator: (v) => v === null || v > 0 },
  disabled: { type: Boolean, default: false },
  // Neu
  wrapInCard: { type: Boolean, default: true },
  cardElevation: { type: [Number, String], default: 2 }
})

const emit = defineEmits(['update:modelValue','selection-changed','validation-error'])

const localSelectedSpecies = ref([])
const lastChanged = ref('')
const isInitialized = ref(false)
let debounceTimer = null

const treeSpeciesList = computed(() => props.treeSpecies)
const selectedCount = computed(() => localSelectedSpecies.value.length)
const isAllSelected = computed(() => selectedCount.value === treeSpeciesList.value.length)
const isEmptySelection = computed(() => selectedCount.value === 0)

const validationMessage = computed(() => {
  if (props.maxSelection && selectedCount.value > props.maxSelection) {
    return `Maximal ${props.maxSelection} Baumart${props.maxSelection > 1 ? 'en' : ''} erlaubt`
  }
  return ''
})
const validationType = computed(() => validationMessage.value ? 'error' : 'success')
const isValid = computed(() => !validationMessage.value)

function emitChanges() {
  if (!isInitialized.value) return
  lastChanged.value = new Date().toLocaleTimeString('de-DE')
  const selected = [...localSelectedSpecies.value]
  emit('update:modelValue', selected)
  emit('selection-changed', {
    selected,
    count: selected.length,
    timestamp: lastChanged.value,
    isValid: isValid.value,
    validationMessage: validationMessage.value
  })
  if (!isValid.value && validationMessage.value) {
    emit('validation-error', {
      message: validationMessage.value,
      selected,
      count: selected.length
    })
  }
}

function selectAll() {
  if (props.disabled) return
  localSelectedSpecies.value = treeSpeciesList.value.map(s => s.value)
}
function clearAll() {
  if (props.disabled) return
  localSelectedSpecies.value = []
}
function isDisabled(speciesValue) {
  if (props.disabled) return true
  if (props.maxSelection &&
      selectedCount.value >= props.maxSelection &&
      !localSelectedSpecies.value.includes(speciesValue)) {
    return true
  }
  return false
}

watch(() => props.modelValue, (nv) => {
  if (Array.isArray(nv)) {
    const a = new Set(localSelectedSpecies.value)
    const b = new Set(nv)
    if (a.size !== b.size || ![...a].every(v => b.has(v))) {
      localSelectedSpecies.value = [...nv]
    }
  }
}, { immediate: true })

watch(localSelectedSpecies, () => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => { emitChanges(); debounceTimer = null }, 50)
}, { deep: true })

onMounted(async () => {
  await nextTick()
  if (props.selectAllByDefault && localSelectedSpecies.value.length === 0) {
    const allValues = treeSpeciesList.value.map(s => s.value)
    if (!props.maxSelection || allValues.length <= props.maxSelection) {
      localSelectedSpecies.value = allValues
    } else {
      localSelectedSpecies.value = allValues.slice(0, props.maxSelection)
    }
  }
  await nextTick()
  isInitialized.value = true
})
onBeforeUnmount(() => {
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null }
})

defineExpose({
  selectedSpecies: localSelectedSpecies,
  selectedCount,
  isValid,
  isEmptySelection,
  selectAll,
  clearAll,
  validationMessage,
  isAllSelected
})
</script>

<style scoped>
.tree-species-card { margin-bottom: 20px; }

/* Header-Optik */
.tree-species-card .v-card-title {
  background: linear-gradient(135deg, rgba(76,175,80,0.08) 0%, rgba(76,175,80,0.04) 100%);
  border-bottom: 1px solid rgba(76,175,80,0.2);
  font-weight: 600;
}
.title-row { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.empty-hint { font-weight:400; font-size:0.75em; color: rgb(var(--v-theme-error)); opacity:.9; margin-left:4px; }

.species-checkbox { transition: all .2s ease; }
.species-checkbox:hover { background-color: rgba(var(--v-theme-primary), .04); border-radius:8px; }
.species-icon { transition: transform .2s ease; }
.species-checkbox:hover .species-icon { transform: scale(1.1); }

.v-checkbox :deep(.v-label){ font-weight:500; font-size:.875rem; }
.v-checkbox :deep(.v-selection-control__wrapper){ margin-right:8px; }
.v-col { padding:4px 8px; }
.v-checkbox :deep(.v-selection-control__input):focus-visible{
  outline:2px solid rgba(var(--v-theme-primary), .4); outline-offset:2px; border-radius:4px;
}

@media (max-width:600px){
  .tree-species-card { margin-bottom:16px; }
  .v-checkbox :deep(.v-label){ font-size:.8rem; }
  .v-col { padding:2px 4px; }
}

.tree-species-card:has(.v-checkbox--disabled){ opacity:.8; }
.v-checkbox--disabled{ opacity:.6; }
.tree-species-card.loading{ pointer-events:none; opacity:.7; }

@keyframes fadeIn { from{opacity:0; transform:translateY(-10px);} to{opacity:1; transform:translateY(0);} }
</style>