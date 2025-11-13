# Waldwachstum und Dendrometerüberwachung

**Inhalt**

- [Dendrolog: Heatmap](#dendrolog-heatmap)
- [Dendrolog: Stammelastik](#dendrolog-stammelastik)
- [Nach oben ↑](#top)

<a id="top"></a>

## Dendrolog: Heatmap {#dendrolog-heatmap}

Diese Ansicht zeigt Tagesmuster des Stammzuwachses eines ausgewählten Logger-Baumes je Bestandsfläche als Jahres-Heatmap, ergänzt um ein kompaktes Niederschlagspanel für dasselbe Jahr.

### Auswahl
- Plot (Bestandsfläche)
- Einzelner Logger-Baum (`tree_number`)
- Kennwert:
  - **Zuwachs** (`daily_inc`): Differenz des mittleren Durchmessers *d_avg* zum Vortag – irreversibler täglicher Zuwachs.
  - **Schwankung** (`daily_amp`): Tagesamplitude *d_max − d_min* – kurzfristige, reversible Elastik (Turgor / Wasserstatus).

### Darstellung
- Kalender-Heatmap: Farbe kodiert Zuwachs bzw. Schwankung (robuste Skala über 5–95 % Perzentile).
- Niederschlag: Tagesbalken unter der Heatmap als Kontext.
- Funktionen: Jahresauswahl (Chips), Export als PNG (Heatmap) und CSV (Heatmapwert + Regen).

### Nutzung
- Phänologie (Start/Ende, Impulse)
- Zusammenhang Regen ↔ Zuwachs / Rehydrierung
- Stressindikatoren (hohe Schwankung bei geringem Zuwachs)
- Qualitätskontrolle (Lücken, Ausreißer)
- Mehrjahresvergleich (Dürre, Extremereignisse)

**Kurz:** Die Heatmap macht tägliche Wachstumsdynamik und meteorologischen Kontext schnell erfassbar und unterstützt Diagnose, Monitoring und Berichtswesen.

---

## Dendrolog: Stammelastik {#dendrolog-stammelastik}

Diese Ansicht vergleicht je Bestandsfläche zwei Komponenten des Stammdurchmessers über den gesamten verfügbaren Zeitraum:

- **Irreversibles Wachstum (Baseline):** langfristiger Zuwachs (aus gleitendem Minimum, Fenster einstellbar, anschließend monotonisiert).
- **Elastische Komponente (Stammelastik / Turgor):** kurzfristige, reversible Schwankungen (Differenz *d_avg − Baseline*).

### Gezeigte Elemente
- Zwei Linien pro Plot (Baseline durchgezogen, Elastik gestrichelt; gleiche Farbe).
- Legende: Ein-/Ausblenden jeder Serie.
- Zeitfenster: Slider-DataZoom (x‑Achse bleibt auf globalem min/max).
- Export: PNG (Chart) und CSV (Zeitreihe inkl. Kohorte).

### Aggregation
- Pro Baum: Berechnung Baseline + Elastik, Entfernen von Endsprung-Artefakten.
- Pro Plot: tägliches getrimmtes Mittel (20 % je Seite) über dynamische Kohorte:
  - Coverage ≥ 90 % der Tage, ansonsten Auffüllen bis mindestens 2 Bäume.
  - Schnittmenge der Tage sichert konstante Zusammensetzung.

### Nutzung
- Wasserstatus / Turgor-Dynamik saisonal und inter-annuell beurteilen.
- Vergleich Wachstum vs. Hydrationsreaktion zwischen Plots (max. 2 gleichzeitig).
- Trockenstress erkennen (hohe Elastik bei niedriger Baseline, verzögerte Erholung).
- Monitoring, Diagnose, Berichtswesen, Qualitätskontrolle der Loggerdaten.

[Nach oben ↑](#top)