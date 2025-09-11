// Default tree species data with codes
export const defaultTreeSpecies = [
    { 
        label: 'Kiefern', 
        value: 'Kiefern', 
        color: 'green-darken-2',
        icon: 'mdi-pine-tree',
        code: 134
    },
    { 
        label: 'Buchen', 
        value: 'Buchen', 
        color: 'green-darken-2',
        icon: 'mdi-tree',
        code: 20
    },
    { 
        label: 'Eichen', 
        value: 'Eichen', 
        color: 'green-darken-2',
        icon: 'mdi-tree-outline',
        code: 48
    }
];

// Plots data with all locations, their species and colors for boxplots
export const plotsData = {
    1101: { code: '1101', name: 'Grunewald', species: [134], color: '#66BB6A' }, // Kiefern - soft green
    1201: { code: '1201', name: 'Natteheide', species: [134], color: '#64B5F6' }, // Kiefern - soft blue
    1202: { code: '1202', name: 'Beerenbusch', species: [134], color: '#EF5350' }, // Kiefern - soft red
    1203: { code: '1203', name: 'Kienhorst', species: [134], color: '#AB47BC' }, // Kiefern - soft purple
    1204: { code: '1204', name: 'Weitzgrund', species: [134], color: '#FFCA28' }, // Kiefern - soft yellow
    1205: { code: '1205', name: 'Neusorgefeld', species: [134], color: '#FFA726' }, // Kiefern - soft orange
    1206: { code: '1206', name: 'Schwenow', species: [134], color: '#26C6DA' }, // Kiefern - soft cyan
    1207: { code: '1207', name: 'Beerenbusch Buchen', species: [20], color: '#9CCC65' }, // Buchen - soft lime
    1208: { code: '1208', name: 'Fünfeichen', species: [48], color: '#8D6E63' }, // Eichen - soft brown
    1209: { code: '1209', name: 'Kienhorst Eichen', species: [48], color: '#EC407A' } // Eichen - soft pink
};

// Helper function to get species name by code
export const getSpeciesNameByCode = (code) => {
    const speciesMap = {
        134: 'Kiefer',
        20: 'Buche',
        48: 'Eiche'
    };
    return speciesMap[code] || 'Unbekannt';
};

