<script setup>
    import RestDocumentation from '../../../components/RestDocumentation.vue'

    const goTo = (href) => {
        window.open(href, '_blank');
    }
</script>

# Sampling and Analysis of Needles and Leaves - FO

<p>
    <v-btn rounded="xl" color="primary" @click="goTo('https://www.icp-forests.net/fileadmin/icp_forests/Dateien/Manual_Versions/2020-22/ICP_Manual_part12_2020_Foliage_version_2020-3.pdf')">
        ICP Forests Manual Part XII
        <template v-slot:append>
            <v-icon>mdi-file-pdf-box</v-icon>
        </template>
    </v-btn>
</p>
<div class="text-caption">
MANUAL
on
methods and criteria for harmonized sampling, assessment,
monitoring and analysis of the effects of air pollution on forests
</div>

## Database Structure

<RestDocumentation type="icp_download" :showOnlyTables="['fo_fom', 'fo_fot', 'fo_lqa', 'fo_plf']" />
