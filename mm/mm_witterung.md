---
layout: page
---
<script setup>
  import { ref } from 'vue'
  import mmWitterungLine from '../../../components/mm_witterung_line.vue'
</script>

<div class="mx-4 my-4 mb-9">
  <p class="text-h4 my-11">Witterungsdaten der Beobachtungsflächen</p>
    <ClientOnly>
        <mmWitterungLine />
    </ClientOnly>
</div>
