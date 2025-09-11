/**
 * Boxplot Utility Functions
 * Quantile-Methode: R Type 7 (Standard in R, auch in vielen Bibliotheken)
 * Formel: pos = (n - 1) * p
 * Linear Interpolation zwischen floor(pos) und ceil(pos)
 */

/**
 * Berechnet das p-Quantil (0..1) für ein SORTIERTES Array
 * R Type 7
 */
export function quantile(sorted, p) {
  if (!sorted.length) return null
  if (p <= 0) return sorted[0]
  if (p >= 1) return sorted[sorted.length - 1]
  const pos = (sorted.length - 1) * p
  const base = Math.floor(pos)
  const rest = pos - base
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base])
  }
  return sorted[base]
}

export function computeBoxForValues(values) {
  const arr = (values || []).filter(v => v !== null && v !== undefined && !Number.isNaN(v))
  if (!arr.length) return null
  const sorted = arr.slice().sort((a, b) => a - b)
  const q1 = quantile(sorted, 0.25)
  const q2 = quantile(sorted, 0.5)
  const q3 = quantile(sorted, 0.75)
  const iqr = q3 - q1
  const lowerFence = q1 - 1.5 * iqr
  const upperFence = q3 + 1.5 * iqr
  const inliers = sorted.filter(v => v >= lowerFence && v <= upperFence)
  const min = inliers.length ? inliers[0] : sorted[0]
  const max = inliers.length ? inliers[inliers.length - 1] : sorted[sorted.length - 1]
  const outliers = sorted.filter(v => v < lowerFence || v > upperFence)
  return {
    stats: [min, q1, q2, q3, max],
    outliers,
    n: arr.length,
    iqr,
    fences: { lowerFence, upperFence }
  }
}

export function buildBoxplotDataset(series) {
  const boxes = []
  const flatValues = []
  for (const item of (series || [])) {
    const box = computeBoxForValues(item.values)
    if (!box) continue
    boxes.push({ key: item.key, ...box, meta: item.meta || {} })
    for (const v of item.values) {
      const isOutlier = v < box.fences.lowerFence || v > box.fences.upperFence
      flatValues.push({ key: item.key, value: v, isOutlier, meta: item.meta || {} })
    }
  }
  return { boxes, flatValues }
}

export function exportBoxplotCSV({ boxes, flatValues }, options = {}) {
  const sep = options.separator || ';'
  const dec = options.decimal || ','
  const header = [
    'Gruppe','Anzahl','Min','Q1','Median','Q3','Max','IQR','LowerFence','UpperFence','Wert','Outlier'
  ]
  const lines = [header.join(sep)]
  flatValues.forEach(v => {
    const box = boxes.find(b => b.key === v.key)
    if (!box) return
    const format = num => (typeof num === 'number' ? String(num).replace('.', dec) : '')
    lines.push([
      v.key,
      box.n,
      format(box.stats[0]),
      format(box.stats[1]),
      format(box.stats[2]),
      format(box.stats[3]),
      format(box.stats[4]),
      format(box.iqr),
      format(box.fences.lowerFence),
      format(box.fences.upperFence),
      format(v.value),
      v.isOutlier ? 1 : 0
    ].join(sep))
  })
  return lines.join('\n')
}
