# Forest Growth and Dendrometer Monitoring

**Language:** [Deutsch](./index.de.md) | English

**Contents**

- [Dendrolog: Growth Heatmap](#dendrolog-heatmap)
- [Dendrolog: Stem Elasticity](#dendrolog-elasticity)

<a id="top"></a>

## Dendrolog: Growth Heatmap {#dendrolog-heatmap}

This view shows daily stem growth patterns of a selected logger tree (one tree per forest plot) as a year calendar heatmap, complemented by a compact daily precipitation panel for the same year.

### Selection
- Plot (forest observation area)
- Single logger tree (`tree_number`)
- Metric:
  - **Growth** (`daily_inc`): Difference of mean diameter *d_avg* to the previous day – irreversible daily increment.
  - **Amplitude** (`daily_amp`): Daily range *d_max − d_min* – short‑term reversible elastic change (turgor / hydration).

### Visualization
- Calendar heatmap: cell color encodes growth or amplitude (robust scale using 5–95% percentiles).
- Precipitation: daily bars below the heatmap for meteorological context.
- Functions: year chips for selection; export PNG (heatmap) and CSV (growth/amplitude + rain).

### Use Cases
- Phenology (start/end of growing season, growth pulses)
- Linking rainfall events to rehydration and growth
- Stress diagnostics (high amplitude with low growth may indicate water deficit)
- Data quality (missing days, outliers become visible)
- Multi‑year comparison (drought years, extremes)

**Summary:** The heatmap makes daily growth dynamics and weather context quickly interpretable for diagnostics, monitoring, and reporting.

---

## Dendrolog: Stem Elasticity {#dendrolog-elasticity}

This view compares, per plot, two components of stem diameter over the full available time span:

- **Irreversible Growth (Baseline):** long‑term increment (derived via sliding minimum window, then monotonized).
- **Elastic Component (Stem Elasticity / Turgor):** short‑term reversible fluctuations (difference *d_avg − baseline*).

### Shown Elements
- Two lines per plot (solid baseline, dashed elastic; same color).
- Legend: toggle each series (baseline / elastic per plot).
- Time window: slider dataZoom (x‑axis fixed to global min/max).
- Export: PNG (chart) and CSV (time series incl. tree cohort used).

### Aggregation
- Per tree: baseline + elasticity; terminal jump artefacts removed.
- Per plot: daily trimmed mean (20% each side) over a dynamic cohort:
  - Trees must cover ≥90% of days; if too few, best coverage trees added until min. 2.
  - Intersection of common days ensures constant cohort composition.

### Use Cases
- Assess seasonal / inter‑annual turgor and hydration dynamics.
- Compare growth vs. short‑term water reactions between plots (max. 2 simultaneously).
- Detect drought stress (high elasticity with low baseline; delayed recovery after rain).
- Monitoring, diagnostics, reporting, and quality assurance of logger data.

[Back to top ↑](#top)
