---
layout: page
---
<script setup>
    // Hier soll das Thema Kronenverlichtung erörtert werden.
    import { ref, onMounted } from 'vue'
    import foMassOutlier from '../../../components/fo_Mass_outlier.vue'
</script>

<div class="mx-4 my-4 mb-9">
    <p class="text-h4 my-11">Probenahme Nadeln/Blätter: Masse 
        <span class="subtitle" style="font-size: 0.6em; font-weight: normal;">
            (1000 Nadeln / 100 Blätter)
        </span>
    </p>
    <ClientOnly>
        <foMassOutlier />
    </ClientOnly>
</div>
