<script setup>
    import RestDocumentation from '../../../components/RestDocumentation.vue'

    const goTo = (href) => {
        window.open(href, '_blank');
    }
</script>

# Visual Assessment of Crown Condition and Damaging Agents - CC

<p>
    <v-btn rounded="xl" color="primary" @click="goTo('https://www.icp-forests.net/fileadmin/icp_forests/Dateien/Manual_Versions/2020-22/ICP_Manual_part04_2020_Crown_version_2020-3_update_06-2023.pdf')">
        ICP Forests Manual Part IV
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

<RestDocumentation type="icp_download" :showOnlyTables="['cc_trc', 'cc_trd']" />
