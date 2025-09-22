<script setup>
import { computed } from 'vue'

const props = defineProps({
  modelValue: { type: [String, Number], default: null },
  plots: { type: Object, required: true },
  title: { type: String, default: 'Beobachtungsflächen' },
  columns: { type: Number, default: 5 },
  color: { type: String, default: 'green-darken-2' }
})
const emit = defineEmits(['update:modelValue'])

const plotList = computed(() => {
  // plots: { 1101:{code,name,...}, 1203:{...}, ... }
  return Object.values(props.plots)
    .map(p => ({ code: String(p.code || ''), name: p.name || String(p.code || '') }))
    .sort((a,b) => Number(a.code) - Number(b.code))
})

function onPick(val) {
  // Radio-like behavior with checkboxes: always set the clicked plot
  emit('update:modelValue', val)
}
</script>

<template>
<v-card elevation="1" class="mb-3 soft-card">
  <v-card-title class="pb-2 title-row soft-green">
    <v-icon class="mr-2" color="green-darken-2">mdi-tree</v-icon>
    <span>{{ title }}</span>
    <span v-if="isEmptySelection" class="empty-hint">
      – bitte wählen Sie mindestens einen Plot
    </span>
  </v-card-title>
  <v-divider /> <!-- Trennstrich nach dem Titel -->
  <v-card-text class="no-bg">
    <div class="grid" :style="{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }">
      <div v-for="p in plotList" :key="p.code" class="cell">
        <v-checkbox
          :label="`${p.code} — ${p.name}`"
          :model-value="modelValue === p.code"
          color="green-darken-2"
          density="compact"
          hide-details
          @update:model-value="() => onPick(p.code)"
        />
      </div>
    </div>
  </v-card-text>
</v-card>
</template>

<style scoped>
.grid { display: grid; gap: 8px 12px; }
.cell { display: flex; align-items: center; }
.soft-green {
  background: linear-gradient(
    180deg,
    rgba(var(--v-theme-primary), 0.06) 0%,
    rgba(var(--v-theme-primary), 0.03) 100%
  );
}
.no-bg {
  background: none !important;
}
/* Soft green card look */
.soft-card {
  border: 1px solid rgba(var(--v-theme-primary), 0.22);
  border-radius: 8px;
}
.soft-green {
  background: linear-gradient(
    180deg,
    rgba(var(--v-theme-primary), 0.06) 0%,
    rgba(var(--v-theme-primary), 0.03) 100%
  );
}
</style>
