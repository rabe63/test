<template>
  <v-card class="metric-card" :elevation="cardElevation">
    <v-card-title class="pb-2 title-row">
      <v-icon class="mr-2" color="green-darken-2">mdi-ruler</v-icon>
      <span>Darstellung</span>
    </v-card-title>

    <v-card-text class="pt-0">
      <v-row dense>
        <v-col cols="12" sm="6">
          <v-checkbox
            v-model="localMetric"
            :value="'mass'"
            label="Masse (g) – 100 Blätter / 1000 Nadeln"
            color="green-darken-2"
            hide-details
            density="comfortable"
            class="metric-checkbox"
            @change="onChange('mass')"
          >
            <template #prepend>
              <v-icon color="green-darken-2" size="small" class="metric-icon">mdi-scale</v-icon>
            </template>
          </v-checkbox>
        </v-col>
        <v-col cols="12" sm="6">
          <v-checkbox
            v-model="localMetric"
            :value="'area'"
            label="Fläche (m²) – 100 Blätter / 1000 Nadeln"
            color="green-darken-2"
            hide-details
            density="comfortable"
            class="metric-checkbox"
            @change="onChange('area')"
          >
            <template #prepend>
              <v-icon color="green-darken-2" size="small" class="metric-icon">mdi-vector-square</v-icon>
            </template>
          </v-checkbox>
        </v-col>
      </v-row>
    </v-card-text>
  </v-card>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: 'mass' }, // 'mass' | 'area'
  cardElevation: { type: [Number, String], default: 2 }
})
const emit = defineEmits(['update:modelValue', 'change'])

const localMetric = ref(props.modelValue)

watch(() => props.modelValue, (nv) => {
  if (nv !== localMetric.value) localMetric.value = nv
})

function onChange(next) {
  if (localMetric.value !== next) localMetric.value = next
  emit('update:modelValue', localMetric.value)
  emit('change', localMetric.value)
}

onMounted(() => {
  if (!localMetric.value) {
    localMetric.value = 'mass'
    emit('update:modelValue', 'mass')
  }
})
</script>

<style scoped>
.metric-card .v-card-title {
  background: linear-gradient(135deg, rgba(76,175,80,0.08) 0%, rgba(76,175,80,0.04) 100%);
  border-bottom: 1px solid rgba(76,175,80,0.2);
  font-weight: 600;
}
.title-row { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.empty-hint { font-weight:400; font-size:0.75em; color: rgb(var(--v-theme-primary)); opacity:.7; margin-left:4px; }

.metric-checkbox { transition: all .2s ease; }
.metric-checkbox:hover { background-color: rgba(var(--v-theme-primary), .04); border-radius:8px; }
.metric-icon { transition: transform .2s ease; }
.metric-checkbox:hover .metric-icon { transform: scale(1.06); }
</style>