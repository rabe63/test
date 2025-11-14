---
layout: page
---
<script setup>
  import { ref } from 'vue'
  import mmBodenLine from '../../../components/mm_boden_line.vue'
</script>

<div class="mx-4 my-4 mb-9">
  <p class="text-h4 my-11">Bodendaten der Bestandsflächen</p>
    <ClientOnly>
        <mmBodenLine />
    </ClientOnly>
</div>
