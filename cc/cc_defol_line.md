---
layout: page
---
<script setup>
    // Hier soll das Thema Kronenverlichtung erörtert werden.
    import { ref, onMounted } from 'vue'
    import ccDefolline from '../../../components/cc_Defol_line.vue'
</script>

<div class="mx-4 my-4 mb-9">
  <p class="text-h4 my-11">Mittlerer Nadel-/Blattverlust (%)</p>
  <ClientOnly>
    <ccDefolline />
  </ClientOnly>
</div>
