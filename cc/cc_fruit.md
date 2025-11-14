---
layout: page
---
<script setup>
    // Hier soll das Thema Phänologie und die Entwicklung der Vegetationszeit erörtert werden.
    import { ref, onMounted } from 'vue'
    import ccFruit from '../../../components/cc_fruit.vue'
</script>

<div class="mx-4 my-4 mb-9">
  <p class="text-h4 my-11">Anteil an Fruktifikationsstufen (%)</p>
  <ClientOnly>
    <ccFruit />
  </ClientOnly>
</div>
