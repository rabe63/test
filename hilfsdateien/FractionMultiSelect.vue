<template>
  <!-- Optionaler Wrapper: standardmäßig v-card, sonst div -->
  <component
    :is="wrapInCard ? 'v-card' : 'div'"
    :class="['fractions-card', { 'is-card': wrapInCard }]"
    :elevation="wrapInCard ? cardElevation : undefined"
  >
    <v-card-title class="pb-2 title-row">
      <v-icon class="mr-2" color="green-darken-2">mdi-tree</v-icon>
      <span>Fraktionen</span>
      <span v-if="isEmptySelection" class="empty-hint">
        – bitte wählen Sie mindestens eine Fraktion
      </span>
    </v-card-title>

    <v-card-text class="pt-0 card-body">
      <v-alert
        v-if="validationMessage && validationType === 'error'"
        :type="validationType"
        variant="tonal"
        class="mb-3"
        density="compact"
      >
        {{ validationMessage }}
      </v-alert>

      <!-- Ab xl (>=1920px) 5 Spalten via CSS-Override -->
      <v-row dense class="five-cols-row">
        <v-col
          v-for="fr in fractionList"
          :key="fr.code"
          cols="12"
          sm="6"
          md="4"
          lg="3"
          class="five-cols-item"
        >
          <v-checkbox
            v-model="localSelectedFractions"
            :value="fr.code"
            :label="fr.short || fr.text || String(fr.code)"
            :color="checkboxColor"
            :disabled="isDisabled(fr.code)"
            hide-details
            density="comfortable"
            class="fraction-checkbox"
          >
            <template #prepend>
              <v-icon
                :color="checkboxColor"
                size="small"
                class="fraction-icon"
              >
                {{ fr.icon || 'mdi-sigma' }}
              </v-icon>
            </template>
          </v-checkbox>
        </v-col>
      </v-row>

      <!-- Hinweis unten rechts (optional) -->
      <div v-if="cornerHint" class="corner-hint">
        {{ cornerHint }}
      </div>
    </v-card-text>
  </component>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'

const props = defineProps({
  // v-model (Array von Codes, z.B. [11.1, 13.2])
  modelValue: { type: Array, default: () => [] },
  // Liste verfügbarer Fraktionen: [{ code, text, short, icon, color }]
  fractions: { type: Array, default: () => [] },

  // Verhalten/Optik
  selectAllByDefault: { type: Boolean, default: false },
  showDebug: { type: Boolean, default: false },
  minSelection: { type: Number, default: 0, validator: (v) => v >= 0 },
  maxSelection: { type: Number, default: null, validator: (v) => v === null || v > 0 },
  disabled: { type: Boolean, default: false },
  wrapInCard: { type: Boolean, default: true },
  cardElevation: { type: [Number, String], default: 2 },

  // Vereinheitlichte Checkbox-Farbe (wie Baumarten)
  checkboxColor: { type: String, default: 'green-darken-2' },

  // Hinweis unten rechts
  cornerHint: { type: String, default: 'M (main tree species) · S (secondary tree species)' }
})

const emit = defineEmits(['update:modelValue','change','validation-error'])

const localSelectedFractions = ref([])
const lastChanged = ref('')
const isInitialized = ref(false)
let debounceTimer = null

const fractionList = computed(() => props.fractions || [])
const selectedCount = computed(() => (localSelectedFractions.value || []).length)
const isAllSelected = computed(() => selectedCount.value === fractionList.value.length)
const isEmptySelection = computed(() => selectedCount.value === 0)

const validationMessage = computed(() => {
  if (props.maxSelection && selectedCount.value > props.maxSelection) {
    return `Maximal ${props.maxSelection} Fraktion${props.maxSelection > 1 ? 'en' : ''} erlaubt`
  }
  if (selectedCount.value < props.minSelection) {
    return `Mindestens ${props.minSelection} Fraktion${props.minSelection > 1 ? 'en' : ''} erforderlich`
  }
  return ''
})
const validationType = computed(() => validationMessage.value ? 'error' : 'success')
const isValid = computed(() => !validationMessage.value)

function emitChanges() {
  if (!isInitialized.value) return
  lastChanged.value = new Date().toLocaleTimeString('de-DE')
  const selected = [...(localSelectedFractions.value || [])]
  emit('update:modelValue', selected)
  emit('change', selected)
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
  localSelectedFractions.value = fractionList.value.map(f => f.code)
}
function clearAll() {
  if (props.disabled) return
  localSelectedFractions.value = []
}
function isDisabled(code) {
  if (props.disabled) return true
  if (props.maxSelection &&
      selectedCount.value >= props.maxSelection &&
      !localSelectedFractions.value.includes(code)) {
    return true
  }
  return false
}

// v-model von außen -> innen
watch(() => props.modelValue, (nv) => {
  if (Array.isArray(nv)) {
    const a = new Set(localSelectedFractions.value || [])
    const b = new Set(nv)
    if (a.size !== b.size || ![...a].every(v => b.has(v))) {
      localSelectedFractions.value = [...nv]
    }
  }
}, { immediate: true })

// Fraktionsliste validieren
watch(fractionList, (nv) => {
  const valid = new Set((nv || []).map(f => Number(f.code)))
  const next = (localSelectedFractions.value || []).filter(c => valid.has(Number(c)))
  if (JSON.stringify(next) !== JSON.stringify(localSelectedFractions.value)) {
    localSelectedFractions.value = next
  }
}, { immediate: true })

// Änderungen debounced emitten
watch(localSelectedFractions, () => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => { emitChanges(); debounceTimer = null }, 50)
}, { deep: true })

onMounted(async () => {
  await nextTick()
  // Optionales Auto-Select-All (standardmäßig aus)
  if (props.selectAllByDefault &&
      (localSelectedFractions.value || []).length === 0 &&
      fractionList.value.length) {
    const allValues = fractionList.value.map(f => f.code)
    if (!props.maxSelection || allValues.length <= props.maxSelection) {
      localSelectedFractions.value = allValues
    } else {
      localSelectedFractions.value = allValues.slice(0, props.maxSelection)
    }
  }
  await nextTick()
  isInitialized.value = true
})
onBeforeUnmount(() => {
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null }
})

defineExpose({
  selectedFractions: localSelectedFractions,
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
.fractions-card { margin-bottom: 20px; }

/* Header-Optik identisch zur Baumarten-Box */
.fractions-card .v-card-title {
  background: linear-gradient(135deg, rgba(76,175,80,0.08) 0%, rgba(76,175,80,0.04) 100%);
  border-bottom: 1px solid rgba(76,175,80,0.2);
  font-weight: 600;
}

.title-row { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.empty-hint { font-weight:400; font-size:0.75em; color: rgb(var(--v-theme-error)); opacity:.9; margin-left:4px; }

/* Checkbox-Optik analog */
.fraction-checkbox { transition: all .2s ease; }
.fraction-checkbox:hover { background-color: rgba(var(--v-theme-primary), .04); border-radius:8px; }
.fraction-icon { transition: transform .2s ease; }
.fraction-checkbox:hover .fraction-icon { transform: scale(1.1); }

.v-checkbox :deep(.v-label){ font-weight:500; font-size:.875rem; }
.v-checkbox :deep(.v-selection-control__wrapper){ margin-right:8px; }
.v-col { padding:4px 8px; }
.v-checkbox :deep(.v-selection-control__input):focus-visible{
  outline:2px solid rgba(var(--v-theme-primary), .4); outline-offset:2px; border-radius:4px;
}

/* Corner hint unten rechts */
.card-body { position: relative; padding-bottom: 28px !important; }
.corner-hint {
  position: absolute;
  right: 10px;
  bottom: 6px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.75rem;
  font-weight: 500;
}

@media (min-width: 1920px) {
  /* Überschreibt Vuetify's Grid-Breite, damit genau 5 Spalten dargestellt werden */
  .five-cols-row > .five-cols-item {
    flex: 0 0 20% !important;
    max-width: 20% !important;
  }
}

/* Optionale Feinanpassung der Abstände für XL, falls gewünscht */
@media (min-width: 1920px) {
  .v-col.five-cols-item { padding: 4px 8px; }
}

@media (max-width:600px){
  .fractions-card { margin-bottom:16px; }
  .v-checkbox :deep(.v-label){ font-size:.8rem; }
  .v-col { padding:2px 4px; }
}

.fractions-card:has(.v-checkbox--disabled){ opacity:.8; }
.v-checkbox--disabled{ opacity:.6; }
.fractions-card.loading{ pointer-events:none; opacity:.7; }

@keyframes fadeIn { from{opacity:0; transform:translateY(-10px);} to{opacity:1; transform:translateY(0);} }
</style>