<a id="top"></a>

# Waldwachstum und Dendrometerüberwachung

<nav style="font-size:1.6rem; font-weight:800; margin-bottom:0.5rem;">
  <ul style="margin:80px 0px 100px 0px; padding-left:1.25rem;">
    <li style="margin:0px 0px 30px 0px;"><a href="#dendrolog-headmap"><strong>Dendrolog: Headmap</strong></a></li>
    <li><a href="#dendrolog-stammelastik"><strong>Dendrolog: Stammelastik</strong></a></li>
  </ul>
</nav>

<section id="dendrolog-headmap">
  <h1>Dendrolog: Headmap</h1>

  <p>Diese Ansicht zeigt Tagesmuster des Stammzuwachses eines ausgewählten Logger-Baumes je Bestandsfläche als Jahres-Heatmap, ergänzt um ein kompaktes Niederschlagspanel für dasselbe Jahr.</p>

  <h3>Auswahl</h3>
  <ul>
    <li>Plot (Bestandsfläche)</li>
    <li>Einzelner Logger-Baum (tree_number)</li>
    <li>Kennwert:
      <ul>
        <li>Zuwachs (daily_inc): Differenz des mittleren Durchmessers d_avg zum Vortag. Misst den irreversiblen täglichen Zuwachs.</li>
        <li>Schwankung (daily_amp): Tagesamplitude d_max − d_min. Misst die kurzfristige, reversible Elastik (Turgor-/Wasserstatus).</li>
      </ul>
    </li>
  </ul>

  <h3>Darstellung</h3>
  <ul>
    <li>Heatmap (Kalenderlayout): Jeder Tag ist eine Zelle; Farbe kodiert Zuwachs bzw. Schwankung. Die Farbskala wird robust über Perzentile (5–95 %) bestimmt.</li>
    <li>Niederschlag: Balken (Tageswerte) unter der Heatmap als Kontext zur Interpretation von Wachstums- und Elastikmustern.</li>
    <li>Funktionen:
      <ul>
        <li>Jahresauswahl per Chip</li>
        <li>Export als PNG (Heatmap) und CSV (Heatmapwert + Regen)</li>
      </ul>
    </li>
  </ul>

  <h3>Wofür nutzen?</h3>
  <ul>
    <li>Phänologie: Start/Ende der Wachstumsperiode, Wachstumsimpulse.</li>
    <li>Wetter-/Standortsensitivität: Zusammenhang von Regenereignissen mit Zuwachs (Rehydrierung, Turgor).</li>
    <li>Stressdiagnose: Hohe Schwankung bei gleichzeitig geringen Zuwächsen kann Wassermangel anzeigen.</li>
    <li>Qualitätscheck: Fehlende/ausreißende Tage fallen visuell auf.</li>
    <li>Vergleich über Jahre: Dürrejahre, Trockenphasen, Extremereignisse.</li>
  </ul>

  <p><strong>Kurz:</strong> Dendrolog: Headmap macht tägliche Wachstumsdynamik und deren meteorologischen Kontext über das Jahr hinweg schnell erfassbar und unterstützt Diagnose, Monitoring und Berichtswesen.</p>
</section>

<div class="section-sep" role="separator" aria-hidden="true">
  <hr/>
</div>

<section id="dendrolog-stammelastik">
  <h1>Dendrolog: Stammelastik</h1>

  <p>Diese Ansicht vergleicht je Bestandsfläche zwei Komponenten des Stammdurchmessers über die Zeit:</p>

  <ul>
    <li>Irreversibles Wachstum (Baseline): langfristiger Zuwachs.</li>
    <li>Elastische Komponente (Stammelastik/Turgor): kurzfristige, reversible Schwankungen.</li>
  </ul>

  <h3>Was wird gezeigt?</h3>
  <ul>
    <li>Zwei Linien pro Plot:
      <ul>
        <li>Baseline (voll durchgezogen): aus gleitendem Minimum (Fenster einstellbar) und monotone Anhebung berechnet.</li>
        <li>Elastik (gestrichelt, gleiche Plotfarbe): Differenz d_avg – Baseline.</li>
      </ul>
    </li>
    <li>Legende mit je zwei Einträgen pro Plot (Baseline/Elastik); Klick blendet Serien ein/aus.</li>
    <li>Zeitsteuerung über einen Slider-DataZoom; die x-Achse bleibt auf dem vollen Datenzeitraum.</li>
    <li>Export: PNG (Chart) und CSV (Zeitreihe inkl. verwendeter Baumkohorte).</li>
  </ul>

  <h3>Wie werden die Daten aggregiert?</h3>
  <ul>
    <li>Pro Baum: Baseline via gleitendem Minimum; elastische Komponente als Abweichung vom Baseline-Trend.</li>
    <li>Pro Plot: tägliche Aggregation als getrimmtes Mittel (Trim 20 %) über eine dynamische Kohorte:
      <ul>
        <li>Bäume müssen ≥90 % Tagesabdeckung im Zeitraum haben; bei zu wenigen werden die bestabgedeckten ergänzt (mind. 2).</li>
        <li>Sprünge am Reihenende werden erkannt und abgeschnitten (Robustheit).</li>
      </ul>
    </li>
  </ul>

  <h3>Wofür nutzen?</h3>
  <ul>
    <li>Wasserstatus/Turgor-Dynamik im Tages- bis Saisonverlauf sichtbar machen.</li>
    <li>Wachstum vs. kurzfristige Hydrationsreaktionen je Bestandsfläche vergleichen (max. 2 Plots gleichzeitig).</li>
    <li>Trockenstress-Indikatoren: hohe Elastik bei geringer Baseline, verzögerte Erholung nach Niederschlag.</li>
    <li>Monitoring, Diagnose, Berichtswesen und Qualitätssicherung von Loggerdaten.</li>
  </ul>
</section>

<p style="text-align:right; margin-top:1rem;"><a href="#top">Nach oben ↑</a></p>

<style scoped>
    .section-sep { margin: 60px 0; }
    .section-sep hr { border: none; border-top: 2px solid #ddd; margin: 0; }
</style>