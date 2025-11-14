---
layout: page
---
<script setup>
  import { ref } from 'vue'
  import lfElementBox from '../../../components/lf_Element_box.vue'
</script>

<div class="mx-4 my-4 mb-9">
  <p class="text-h4 my-11">Streufall: chem. Analyse der Fraktionen</p>
    <ClientOnly>
        <lfElementBox />
    </ClientOnly>
</div>
