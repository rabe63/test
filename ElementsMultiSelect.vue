<template>
  <!-- Optionaler Wrapper: standardmäßig v-card, sonst div -->
  <component
    :is="wrapInCard ? 'v-card' : 'div'"
    :class="['elements-card', { 'is-card': wrapInCard }]"
    :elevation="wrapInCard ? cardElevation : undefined"
  >
    <v-card-title class="pb-2 title-row">
      <v-icon class="mr-2" color="green-darken-2">mdi-flask</v-icon>
      <span>Elemente</span>
      <span v-if="isEmptySelection" class="empty-hint">
        – bitte wählen Sie mindestens ein Element
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
          v-for="el in elementList"
          :key="String(el.code)"
          cols="12"
          sm="6"
          md="4"
          lg="3"
          class="five-cols-item"
        >
          <!-- Exklusives Verhalten: genau eine Auswahl -->
          <v-checkbox
            :model-value="localSelectedElements.includes(el.code)"
            @update:modelValue="(checked) => onToggle(el.code, checked)"
            :label="el.short || el.text || String(el.code)"
            :color="checkboxColor"
            :disabled="isDisabled(el.code)"
            hide-details
            density="comfortable"
            class="element-checkbox"
          >
            <template #prepend>
              <v-icon
                :color="checkboxColor"
                size="small"
                class="element-icon"
              >
                {{ el.icon || 'mdi-atom' }}
              </v-icon>
            </template>
          </v-checkbox>
        </v-col>
      </v-row>

      <!-- Hinweis unten rechts (optional) -->
      <div v-if="cornerHint" class="corner-hint">
        {{ cornerHint }}
      </div>

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
            <strong>Ausgewählt:</strong> {{ (localSelectedElements || []).join(', ') || 'Keine' }}<br>
            <strong>Anzahl:</strong> {{ selectedCount }}<br>
            <strong>Letzte Änderung:</strong> {{ lastChanged || 'Keine' }}<br>
            <strong>Validierung:</strong> {{ validationMessage || 'OK' }}<br>
            <strong>Alle verfügbar:</strong> {{ elementList.map(e => e.code).join(', ') }}<br>
            <strong>Component Status:</strong> {{ isValid ? 'Valid' : 'Invalid' }}
          </div>
        </v-alert>
      </v-expand-transition>
    </v-card-text>
  </component>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'

const props = defineProps({
  // v-model (Array, aber es wird intern auf genau 1 Eintrag beschränkt, z. B. ['C'])
  modelValue: { type: Array, default: () => [] },
  // Liste verfügbarer Elemente: [{ code, text, short, unit, icon, color }]
  elements:   { type: Array, default: () => [] },

  // Verhalten/Optik
  showDebug: { type: Boolean, default: false },

  // Immer genau 1 Auswahl
  minSelection: { type: Number, default: 1, validator: (v) => v >= 1 },
  maxSelection: { type: Number, default: 1, validator: (v) => v === 1 },

  disabled: { type: Boolean, default: false },
  wrapInCard: { type: Boolean, default: true },
  cardElevation: { type: [Number, String], default: 2 },

  // Vereinheitlichte Checkbox-Farbe (wie Hauptbaumarten/Fraktionen)
  checkboxColor: { type: String, default: 'green-darken-2' },

  // Hinweis unten rechts
  cornerHint: { type: String, default: '' },

  // Initial-Default (C, falls vorhanden)
  defaultSelection: { type: Array, default: () => ['C'] }
})

const emit = defineEmits(['update:modelValue','change','validation-error'])

const localSelectedElements = ref([])
const lastChanged = ref('')
const isInitialized = ref(false)
const didSetInitialDefault = ref(false)
let debounceTimer = null

const elementList = computed(() => props.elements || [])
const selectedCount = computed(() => (localSelectedElements.value || []).length)
const isEmptySelection = computed(() => selectedCount.value === 0)

const validationMessage = computed(() => {
  if (selectedCount.value < props.minSelection) {
    return `Mindestens ${props.minSelection} Element${props.minSelection > 1 ? 'e' : ''} erforderlich`
  }
  if (selectedCount.value > props.maxSelection) {
    return `Maximal ${props.maxSelection} Element${props.maxSelection > 1 ? 'e' : ''} erlaubt`
  }
  return ''
})
const validationType = computed(() => validationMessage.value ? 'error' : 'success')
const isValid = computed(() => !validationMessage.value)

function normalizeSelection(inputArr) {
  const list = elementList.value || []
  const valid = new Set(list.map(e => String(e.code)))
  const arr = Array.isArray(inputArr) ? inputArr : []
  // 1) erste gültige Auswahl aus input
  const firstValid = arr.find(c => valid.has(String(c)))
  if (firstValid != null) return [firstValid]
  // 2) defaultSelection, falls im Angebot
  const defaults = (props.defaultSelection || []).map(c => String(c))
  const def = list.find(e => defaults.includes(String(e.code)))
  if (def) return [def.code]
  // 3) erstes verfügbares Element
  if (list.length) return [list[0].code]
  // 4) keine Elemente verfügbar
  return []
}

function ensureOneSelected() {
  const normalized = normalizeSelection(localSelectedElements.value)
  if (JSON.stringify(normalized) !== JSON.stringify(localSelectedElements.value)) {
    localSelectedElements.value = normalized
  }
}

function emitChanges() {
  if (!isInitialized.value) return
  lastChanged.value = new Date().toLocaleTimeString('de-DE')
  const selected = [...(localSelectedElements.value || [])]
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

// Exklusives Umschalten: genau eine Checkbox kann aktiv sein, leeres Set wird verhindert
function onToggle(code, checked) {
  if (props.disabled) return
  const current = localSelectedElements.value || []
  const isActive = current.includes(code)

  if (checked) {
    // wähle ausschließlich diesen Code
    localSelectedElements.value = [code]
  } else {
    // Deaktivieren verhindern, wenn es die einzige aktive Auswahl ist
    if (current.length <= 1 && isActive) {
      localSelectedElements.value = [code] // revert
    } else {
      // Falls mehrere (sollte nicht vorkommen), entferne nur diesen
      localSelectedElements.value = current.filter(c => c !== code).slice(0, 1)
      ensureOneSelected()
    }
  }
}

function isDisabled() {
  // Nur globale Disabled-Logik; keine Sperre wegen maxSelection,
  // damit Umschalten jederzeit möglich bleibt
  return props.disabled
}

// v-model von außen -> innen (immer auf 1 Eintrag normalisieren)
watch(() => props.modelValue, (nv) => {
  const normalized = normalizeSelection(nv)
  if (JSON.stringify(normalized) !== JSON.stringify(localSelectedElements.value)) {
    localSelectedElements.value = normalized
  }
}, { immediate: true })

// Elementliste -> ungültige entfernen; immer sicherstellen, dass genau 1 gesetzt ist
watch(elementList, (nv, ov) => {
  const normalized = normalizeSelection(localSelectedElements.value)
  if (JSON.stringify(normalized) !== JSON.stringify(localSelectedElements.value)) {
    localSelectedElements.value = normalized
  }

  // Ersteinrichtung: Default (z. B. 'C'), falls vorhanden
  const becameAvailable = (!ov || ov.length === 0) && (nv && nv.length > 0)
  if (!didSetInitialDefault.value && becameAvailable) {
    if ((localSelectedElements.value || []).length === 0) {
      localSelectedElements.value = normalizeSelection([])
    }
    didSetInitialDefault.value = true
  }
}, { immediate: true })

// Änderungen debounced emitten
watch(localSelectedElements, () => {
  ensureOneSelected()
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => { emitChanges(); debounceTimer = null }, 50)
}, { deep: true })

onMounted(async () => {
  await nextTick()
  ensureOneSelected()
  isInitialized.value = true
})
onBeforeUnmount(() => {
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null }
})

defineExpose({
  selectedElements: localSelectedElements,
  selectedCount,
  isValid,
  isEmptySelection,
  validationMessage
})
</script>

<style scoped>
.elements-card { margin-bottom: 20px; }

/* Header-Optik identisch wie Baumarten/Fraktionen */
.elements-card .v-card-title {
  background: linear-gradient(135deg, rgba(76,175,80,0.08) 0%, rgba(76,175,80,0.04) 100%);
  border-bottom: 1px solid rgba(76,175,80,0.2);
  font-weight: 600;
}

.title-row { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.empty-hint { font-weight:400; font-size:0.75em; color: rgb(var(--v-theme-error)); opacity:.9; margin-left:4px; }

/* Checkbox-Optik analog */
.element-checkbox { transition: all .2s ease; }
.element-checkbox:hover { background-color: rgba(var(--v-theme-primary), .04); border-radius:8px; }
.element-icon { transition: transform .2s ease; }
.element-checkbox:hover .element-icon { transform: scale(1.1); }

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

@media (max-width:600px){
  .elements-card { margin-bottom:16px; }
  .v-checkbox :deep(.v-label){ font-size:.8rem; }
  .v-col { padding:2px 4px; }
}

.elements-card:has(.v-checkbox--disabled){ opacity:.8; }
.v-checkbox--disabled{ opacity:.6; }
.elements-card.loading{ pointer-events:none; opacity:.7; }

@keyframes fadeIn { from{opacity:0; transform:translateY(-10px);} to{opacity:1; transform:translateY(0);} }
</style>