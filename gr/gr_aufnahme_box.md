---
layout: page
title: 5-jährige Totalaufnahme der Bestandsflächen
---

<script setup>
// Hier soll das Thema Wachstum erörtert werden.
import { ref, onMounted } from 'vue'
import GrAufnahmeBox from '../../../components/gr_aufnahme_box.vue'
</script>

<div class="mx-4 my-4 mb-9">
  <p class="text-h4 my-11">5-jährige Vollaufnahme der Bestandsflächen</p>
  <ClientOnly>
    <GrAufnahmeBox />
  </ClientOnly>
</div>
