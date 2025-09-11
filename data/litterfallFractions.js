// Unverändert bis auf optionales short Feld für Achsen-Labels.
// Falls du bereits eine Version übernommen hast, nur short ergänzen.

export const litterfallFractions = [
  { code: 10.0,  key: 'total',        text: 'Total litter',                 short: 'Total',     icon: 'mdi-sigma',          color: '#1E88E5' },
  { code: 11.0,  key: 'foliar_total', text: 'Foliar total',                 short: 'Foliar',    icon: 'mdi-leaf',           color: '#43A047' },
  { code: 11.1,  key: 'foliar_main',  text: 'Foliar main',                  short: 'Foliar M',  icon: 'mdi-leaf-maple',     color: '#2E7D32' },
  { code: 11.2,  key: 'foliar_sec',   text: 'Foliar secondary',             short: 'Foliar S',  icon: 'mdi-leaf-circle',    color: '#66BB6A' },
  { code: 12.0,  key: 'non_foliar',   text: 'Non foliar',                   short: 'Non fol.',  icon: 'mdi-leaf-off',       color: '#8E24AA' },
  { code: 13.0,  key: 'flower_total', text: 'Flowering total',              short: 'Flower',    icon: 'mdi-flower',         color: '#F4511E' },
  { code: 13.1,  key: 'flower_main',  text: 'Flowering main',               short: 'Flower M',  icon: 'mdi-flower-outline', color: '#FB8C00' },
  { code: 13.2,  key: 'flower_sec',   text: 'Flowering secondary',          short: 'Flower S',  icon: 'mdi-flower-tulip',   color: '#FFB300' },
  { code: 15.0,  key: 'buds_scales',  text: 'Buds scales',                  short: 'Buds',      icon: 'mdi-eyedropper',     color: '#5E35B1' },
  { code: 16.0,  key: 'wood',         text: 'Wood fraction',                short: 'Wood',      icon: 'mdi-tree-outline',   color: '#6D4C41' },
  { code: 17.0,  key: 'fines',        text: 'Fines + frass + insects',      short: 'Fines',     icon: 'mdi-bug',            color: '#00897B' },
  { code: 18.0,  key: 'rest',         text: 'Rest',                         short: 'Rest',      icon: 'mdi-dots-horizontal',color: '#546E7A' },
  { code: 19.0,  key: 'leftover',     text: 'Leftover biomass',             short: 'Leftov.',   icon: 'mdi-alert-circle',   color: '#90A4AE' },
  { code: 114.0, key: 'fruit_total',  text: 'Fruits & seeds total',         short: 'Fruit',     icon: 'mdi-seed',           color: '#C0CA33' },
  { code: 114.1, key: 'fruit_main',   text: 'Fruits & seeds main',          short: 'Fruit M',   icon: 'mdi-seed-outline',   color: '#9E9D24' },
  { code: 114.11,key: 'seeds_main',   text: 'Seeds only main',              short: 'Seeds M',   icon: 'mdi-seed-plus',      color: '#827717' },
  { code: 114.12,key: 'cones_main',   text: 'Capsules & cones main',        short: 'Cones M',   icon: 'mdi-pine-tree',      color: '#388E3C' },
  { code: 114.2, key: 'fruit_sec',    text: 'Fruits & seeds secondary',     short: 'Fruit S',   icon: 'mdi-seed',           color: '#7CB342' },
  { code: 114.21,key: 'seeds_sec',    text: 'Seeds only secondary',         short: 'Seeds S',   icon: 'mdi-seed-plus',      color: '#558B2F' },
  { code: 114.22,key: 'cones_sec',    text: 'Capsules & cones secondary',   short: 'Cones S',   icon: 'mdi-pine-tree',      color: '#2E7D32' }
]

export function getFractionMeta(code) {
  return litterfallFractions.find(f => Number(f.code) === Number(code))
}

export function filterRelevantFractions(rawRows, fractionField = 'code_sample') {
  const codes = new Set(
    rawRows.filter(r => r.mass !== null && r.mass !== undefined)
           .map(r => Number(r[fractionField]))
  )
  return litterfallFractions.filter(f => codes.has(Number(f.code)))
}