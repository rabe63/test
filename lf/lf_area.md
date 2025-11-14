---
layout: page
---
<script setup>
  import { ref } from 'vue'
  import lfAreaBox from '../../../components/lf_Area_box.vue'
</script>

<div class="mx-4 my-4 mb-9">
  <p class="text-h4 my-11">Massen und Flächen (100 Blätter / 1000 Nadeln)</p>
    <ClientOnly>
        <lfAreaBox />
    </ClientOnly>
</div>
