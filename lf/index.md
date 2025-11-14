<script setup>
    import RestDocumentation from '../../../components/RestDocumentation.vue'

    const goTo = (href) => {
        window.open(href, '_blank');
    }
</script>

# Sampling and Analysis of Litterfall - LF

<p>
    <v-btn rounded="xl" color="primary" @click="goTo('https://www.icp-forests.net/fileadmin/icp_forests/Dateien/Manual_Versions/ICP_Manual_part13_2020_Litterfall_version_2020-2.pdf')">
        ICP Forests Manual Part XIII
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

<RestDocumentation type="icp_download" :showOnlyTables="['lf_lfa', 'lf_lfc', 'lf_lfm', 'lf_lfd', 'lf_lfp', 'lf_lqa']" />
