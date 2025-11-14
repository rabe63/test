<script setup>
import { computed } from 'vue'

const props = defineProps({
  modelValue: { type: [String, Number, Array], default: null },
  plots: { type: Object, required: true },
  title: { type: String, default: 'Beobachtungsflächen' },
  columns: { type: Number, default: 5 },
  color: { type: String, default: 'green-darken-2' },
  multiple: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue'])

// Aus props.plots (Map-Objekt) eine Liste bauen, die disabled unterstützt.
// code wird aus p.code oder, falls fehlend, aus dem Key k abgeleitet.
const plotList = computed(() => {
  return Object.entries(props.plots)
    .map(([k, p]) => {
      const code = String(p?.code ?? k ?? '')
      return {
        code,
        name: p?.name || code,
        disabled: Boolean(p?.disabled)
      }
    })
    .sort((a, b) => Number(a.code) - Number(b.code))
})

const isEmptySelection = computed(() => {
  if (props.multiple) return !Array.isArray(props.modelValue) || props.modelValue.length === 0
  return props.modelValue === null || props.modelValue === undefined || props.modelValue === ''
})

function isChecked(code) {
  if (props.multiple) return Array.isArray(props.modelValue) && props.modelValue.map(String).includes(String(code))
  return String(props.modelValue) === String(code)
}

function toggle(code) {
  // Bei disabled keine Änderung
  if (plotList.value.find(p => p.code === String(code))?.disabled) return

  if (props.multiple) {
    const cur = Array.isArray(props.modelValue) ? props.modelValue.map(String) : []
    const s = new Set(cur)
    const sc = String(code)
    if (s.has(sc)) s.delete(sc); else s.add(sc)
    emit('update:modelValue', Array.from(s))
  } else {
    emit('update:modelValue', String(code))
  }
}
</script>

<template>
  <v-card elevation="1" class="mb-3 soft-card">
    <v-card-title class="pb-2 title-row soft-green">
      <v-icon class="mr-2" color="green-darken-2">mdi-tree</v-icon>
      <span>{{ title }}</span>
      <span v-if="isEmptySelection" class="empty-hint">
        – bitte wählen Sie {{ multiple ? 'mindestens einen Plot' : 'einen Plot' }}
      </span>
    </v-card-title>
    <v-divider />
    <v-card-text class="no-bg">
      <div class="grid" :style="{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }">
        <div v-for="p in plotList" :key="p.code" class="cell">
          <v-checkbox
            :label="`${p.code} — ${p.name}`"
            :model-value="isChecked(p.code)"
            :disabled="p.disabled"
            :color="color"
            density="compact"
            hide-details
            @update:model-value="() => toggle(p.code)"
          />
        </div>
      </div>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.grid { display: grid; gap: 8px 12px; }
.cell { display: flex; align-items: center; }
.soft-card { border: 1px solid rgba(var(--v-theme-primary), 0.22); border-radius: 8px; }
.soft-green {
  background: linear-gradient(180deg, rgba(var(--v-theme-primary), 0.06) 0%, rgba(var(--v-theme-primary), 0.03) 100%);
}
.no-bg { background: none !important; }
.empty-hint { color: #777; font-weight: 400; font-size: 90%; margin-left: 8px; }
</style>
