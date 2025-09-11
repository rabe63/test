export const chemElements = [
  { code: 'N',  key: 'nitrogen',   text: 'Nitrogen',   text_de: 'Stickstoff',   short: 'N',  unit: 'mg/g',   temperature: '105°C', icon: 'mdi-atom',                 color: '#1E88E5' },
  { code: 'S',  key: 'sulphur',    text: 'Sulphur',    text_de: 'Schwefel',     short: 'S',  unit: 'mg/g',   temperature: '105°C', icon: 'mdi-test-tube',            color: '#8E24AA' },
  { code: 'P',  key: 'phosphorus', text: 'Phosphorus', text_de: 'Phosphor',     short: 'P',  unit: 'mg/g',   temperature: '105°C', icon: 'mdi-flask',                color: '#FB8C00' },
  { code: 'Ca', key: 'calcium',    text: 'Calcium',    text_de: 'Kalzium',      short: 'Ca', unit: 'mg/g',   temperature: '105°C', icon: 'mdi-flask-round-bottom',   color: '#6D4C41' },
  { code: 'Mg', key: 'magnesium',  text: 'Magnesium',  text_de: 'Magnesium',    short: 'Mg', unit: 'mg/g',   temperature: '105°C', icon: 'mdi-flask-outline',        color: '#43A047' },
  { code: 'K',  key: 'potassium',  text: 'Potassium',  text_de: 'Kalium',       short: 'K',  unit: 'mg/g',   temperature: '105°C', icon: 'mdi-test-tube-empty',      color: '#F4511E' },
  { code: 'C',  key: 'carbon',     text: 'Carbon',     text_de: 'Kohlenstoff',  short: 'C',  unit: 'g/100g', temperature: '105°C', icon: 'mdi-molecule-co2',         color: '#000000' },
  { code: 'Zn', key: 'zinc',       text: 'Zinc',       text_de: 'Zink',         short: 'Zn', unit: 'µg/g',   temperature: '105°C', icon: 'mdi-beaker',               color: '#00ACC1' },
  { code: 'Mn', key: 'manganese',  text: 'Manganese',  text_de: 'Mangan',       short: 'Mn', unit: 'µg/g',   temperature: '105°C', icon: 'mdi-beaker-outline',       color: '#00897B' },
  { code: 'Fe', key: 'iron',       text: 'Iron',       text_de: 'Eisen',        short: 'Fe', unit: 'µg/g',   temperature: '105°C', icon: 'mdi-magnet',               color: '#D32F2F' },
  { code: 'Cu', key: 'copper',     text: 'Copper',     text_de: 'Kupfer',       short: 'Cu', unit: 'µg/g',   temperature: '105°C', icon: 'mdi-beaker-outline',       color: '#8D6E63' },
  { code: 'Pb', key: 'lead',       text: 'Lead',       text_de: 'Blei',         short: 'Pb', unit: 'µg/g',   temperature: '105°C', icon: 'mdi-alert-circle-outline', color: '#607D8B' },
  { code: 'Cd', key: 'cadmium',    text: 'Cadmium',    text_de: 'Kadmium',      short: 'Cd', unit: 'ng/g',   temperature: '105°C', icon: 'mdi-biohazard',            color: '#AD1457' },
  { code: 'B',  key: 'boron',      text: 'Boron',      text_de: 'Bor',          short: 'B',  unit: 'µg/g',   temperature: '105°C', icon: 'mdi-beaker-plus',          color: '#C0CA33' },
  { code: 'As', key: 'arsenic',    text: 'Arsenic',    text_de: 'Arsen',        short: 'As', unit: 'ng/g',   temperature: '105°C', icon: 'mdi-alert',                color: '#7B1FA2' },
  { code: 'Cr', key: 'chromium',   text: 'Chromium',   text_de: 'Chrom',        short: 'Cr', unit: 'µg/g',   temperature: '105°C', icon: 'mdi-hexagon',              color: '#7CB342' },
  { code: 'Co', key: 'cobalt',     text: 'Cobalt',     text_de: 'Kobalt',       short: 'Co', unit: 'µg/g',   temperature: '105°C', icon: 'mdi-hexagon-multiple',     color: '#5E35B1' },
  { code: 'Hg', key: 'mercury',    text: 'Mercury',    text_de: 'Quecksilber',  short: 'Hg', unit: 'ng/g',   temperature: '105°C', icon: 'mdi-thermometer',          color: '#3949AB' },  
  { code: 'Ni', key: 'nickel',     text: 'Nickel',     text_de: 'Nickel',       short: 'Ni', unit: 'µg/g',   temperature: '105°C', icon: 'mdi-coin',                 color: '#558B2F' },
  { code: 'Al', key: 'aluminium',  text: 'Aluminium',  text_de: 'Aluminium',    short: 'Al', unit: 'ng/g',   temperature: '105°C', icon: 'mdi-flask-plus',                color: '#7f9b3fff' },
  { code: 'Na', key: 'sodium',     text: 'Sodium',     text_de: 'Natrium',      short: 'Na', unit: 'µg/g',   temperature: '105°C', icon: 'mdi-flask-empty-outline',                color: '#8f1b7fff' },
]

export function getElementMeta(codeOrKey) {
  if (codeOrKey === null || codeOrKey === undefined) return undefined
  const needle = String(codeOrKey).toLowerCase()
  return chemElements.find(
    e => String(e.code).toLowerCase() === needle || String(e.key).toLowerCase() === needle
  )
}

export function filterRelevantElements(rawRows, elementField = 'code_element', valueField = 'value') {
  const codes = new Set(
    (rawRows || [])
      .filter(r => r && r[valueField] !== null && r[valueField] !== undefined)
      .map(r => String(r[elementField]).toUpperCase())
  )
  return chemElements.filter(e => codes.has(String(e.code).toUpperCase()))
}