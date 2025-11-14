<script setup>
import { computed, ref, onMounted, onBeforeUnmount, nextTick } from 'vue'

const props = defineProps({
  modelValue: { type: [String, Number, Array], default: null },
  plots: { type: Object, required: true },
  title: { type: String, default: 'Beobachtungsflächen' },
  columns: { type: Number, default: 5 },
  color: { type: String, default: 'green-darken-2' },
  multiple: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue'])

// Responsive: mobil = ein Plot je Zeile
const rootEl = ref(null)
const isCompact = ref(false)      // z. B. Smartphone < 560px
let resizeObserver = null
function handleResize(width) {
  isCompact.value = width < 560
}
onMounted(async () => {
  await nextTick()
  if (rootEl.value) {
    resizeObserver = new ResizeObserver(entries => {
      for (const e of entries) handleResize(e.contentRect.width)
    })
    resizeObserver.observe(rootEl.value)
    handleResize(rootEl.value.clientWidth)
  } else {
    const fn = () => handleResize(rootEl.value?.clientWidth || window.innerWidth)
    window.addEventListener('resize', fn, { passive: true })
    handleResize(window.innerWidth)
  }
})
onBeforeUnmount(() => { if (resizeObserver) resizeObserver.disconnect() })

// Plotliste (mit disabled)
const plotList = computed(() => {
  return Object.entries(props.plots)
    .map(([k, p]) => {
      const code = String(p?.code ?? k ?? '')
      return { code, name: p?.name || code, disabled: Boolean(p?.disabled) }
    })
    .sort((a, b) => Number(a.code) - Number(b.code))
})

// Auswahl-Helper
const isEmptySelection = computed(() => {
  if (props.multiple) return !Array.isArray(props.modelValue) || props.modelValue.length === 0
  return props.modelValue === null || props.modelValue === undefined || props.modelValue === ''
})
function isChecked(code) {
  if (props.multiple) return Array.isArray(props.modelValue) && props.modelValue.map(String).includes(String(code))
  return String(props.modelValue) === String(code)
}
function toggle(code) {
  if (plotList.value.find(p => p.code === String(code))?.disabled) return
  if (props.multiple) {
    const cur = Array.isArray(props.modelValue) ? props.modelValue.map(String) : []
    const s = new Set(cur); const sc = String(code)
    if (s.has(sc)) s.delete(sc); else s.add(sc)
    emit('update:modelValue', Array.from(s))
  } else {
    emit('update:modelValue', String(code))
  }
}

// Grid-Style: mobil 1 Spalte, sonst props.columns
const gridStyle = computed(() => {
  if (isCompact.value) return { gridTemplateColumns: '1fr' }
  return { gridTemplateColumns: `repeat(${props.columns}, minmax(0, 1fr))` }
})
</script>

<template>
  <v-card ref="rootEl" elevation="1" class="mb-3 soft-card">
    <v-card-title class="pb-2 title-row soft-green card-header">
      <v-icon class="mr-2 icon" color="green-darken-2">mdi-tree</v-icon>
      <span class="title-text">{{ title }}</span>
      <span v-if="isEmptySelection" class="empty-hint">
        – bitte wählen Sie {{ multiple ? 'mindestens einen Plot' : 'einen Plot' }}
      </span>
    </v-card-title>
    <v-divider />
    <v-card-text class="no-bg">
      <div class="grid" :style="gridStyle">
        <div v-for="p in plotList" :key="p.code" class="cell" :class="{ disabled: p.disabled }">
          <v-checkbox
            :model-value="isChecked(p.code)"
            :disabled="p.disabled"
            :color="color"
            density="compact"
            hide-details
            class="plot-checkbox"
            @update:model-value="() => toggle(p.code)"
          >
            <template #label>
              <div class="label-inner">
                <div class="code">{{ p.code }}</div>
                <div class="name" :title="p.name">{{ p.name }}</div>
              </div>
            </template>
          </v-checkbox>
        </div>
      </div>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.grid { display: grid; gap: 10px 14px; }
.cell { display: flex; align-items: flex-start; }
.cell.disabled { opacity: 0.45; pointer-events: none; }

.soft-card { border: 1px solid rgba(var(--v-theme-primary), 0.22); border-radius: 6px; }
.soft-green {
  background: linear-gradient(180deg, rgba(var(--v-theme-primary), 0.06) 0%, rgba(var(--v-theme-primary), 0.03) 100%);
}
.no-bg { background: none !important; }
.card-header { display:flex; align-items:center; flex-wrap:wrap; }
.title-text { font-weight: 700; }
.icon { flex-shrink:0; }
.empty-hint { color: #777; font-weight: 400; font-size: 90%; margin-left: 8px; }

.plot-checkbox { margin: 0; padding: 0; width: 100%; }
.plot-checkbox :deep(.v-selection-control) { align-items: flex-start; }
.plot-checkbox :deep(.v-label) {
  width: 100%;
  white-space: normal;
  line-height: 1.2;
  padding-top: 1px;
}

.label-inner {
  display:flex;
  flex-direction:column;
  align-items:flex-start;
  gap:2px;
  max-width: 100%;
}
.label-inner .code { font-weight: 700; font-size: 0.95rem; line-height:1.1; }
.label-inner .name { font-weight: 400; font-size: 0.78rem; line-height:1.1; color:#555; word-break: break-word; }

/* Mobil: ein Plot je Zeile, etwas größere Zeilenhöhe */
@media (max-width: 560px) {
  .grid { grid-template-columns: 1fr !important; gap: 6px 10px; }
  .label-inner .code { font-size: 1rem; }
  .label-inner .name { font-size: 0.82rem; }
}
</style>