---
layout: page
---
<script setup>
    // Hier soll das Thema Kronenverlichtung erörtert werden.
    import { ref, onMounted } from 'vue'
    import ccDefolOutlier from '../../../components/cc_Defol_outlier.vue'
</script>

<div class="mx-4 my-4 mb-9">
  <p class="text-h4 my-11">Nadel-/Blattverlust ( % )</p>
  <ClientOnly>
    <ccDefolOutlier />
  </ClientOnly>
</div>
