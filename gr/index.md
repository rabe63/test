<script setup>
    import RestDocumentation from '../../../components/RestDocumentation.vue'

    const goTo = (href) => {
        window.open(href, '_blank');
    }
</script>

# Estimation of Growth and Yield - GR

<p>
    <v-btn rounded="xl" color="primary" @click="goTo('https://www.icp-forests.net/fileadmin/icp_forests/Dateien/Manual_Versions/2020-22/ICP_Manual_part05_2020_Growth_version_2020-1.pdf')">
        ICP Forests Manual Part V
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

<RestDocumentation type="icp_download" :showOnlyTables="['gr_iev', 'gr_inv', 'gr_ipm', 'gr_ira', 'gr_irh', 'gr_irm', 'gr_irp', 'gr_pli']" />
