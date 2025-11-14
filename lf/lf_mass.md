---
layout: page
---
<script setup>
    // Hier soll das Thema Streufall Massen erörtert werden.
    import { ref, onMounted } from 'vue'
    import lfMassBox from '../../../components/lf_Mass_box.vue'
</script>

<div class="mx-4 my-4 mb-9">
    <p class="text-h4 my-11">Streufall: Trockengewicht  nach Fraktionen</p>
    <ClientOnly>
        <lfMassBox />
    </ClientOnly>
</div>
