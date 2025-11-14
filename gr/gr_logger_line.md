---
layout: page
---
<script setup>
    // Hier soll das Thema Wachstum erörtert werden.
    import { ref, onMounted } from 'vue'
    import grLoggerLine from '../../../components/gr_logger_line.vue'
</script>

<div class="mx-4 my-4 mb-9">
    <p class="text-h4 my-11">Baumdurchmesser ( mm )</p>
    <ClientOnly>
        <grLoggerLine />
    </ClientOnly>
</div>
