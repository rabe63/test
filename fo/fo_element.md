---
layout: page
---
<script setup>
  import { ref } from 'vue'
  import foElementBox from '../../../components/fo_Element_box.vue'
</script>

<div class="mx-4 my-4 mb-9">
  <p class="text-h4 my-11">Probenahme Nadeln/Blätter: chem. Analyse
        <span class="subtitle" style="font-size: 0.6em; font-weight: normal;">
            (1000 Nadeln / 100 Blätter)
        </span>
  </p>
  <ClientOnly>
    <foElementBox />
  </ClientOnly>
</div>
