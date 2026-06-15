# Export PDF — Vista Mensile

**Data:** 2026-06-15
**Branch:** feat/pacchetti-multipli-stagionali-subtask

## Obiettivo

Aggiungere alla vista "Mensile" la possibilità di scaricare il report in PDF,
con la stessa esperienza già presente nella vista "Settimanale".

## Decisioni

- **Meccanismo:** riuso del flusso esistente `window.print()` + stylesheet
  `@media print` (l'utente salva come PDF dalla finestra di stampa). Nessuna
  nuova dipendenza.
- **Contenuto:** tutto — intestazione mese, 4 KPI, grafico "Task per status",
  tabella completa dei task del mese con le ore.

## Contesto rilevante

- La vista mensile (`public/js/monthly.js`) usa già le stesse classi della
  settimanale: `.week-nav`, `.kpi-grid` (con `.month-kpi`), `.card`,
  `table.tasks`, `.badge`, `.avatar`. Quindi le regole `@media print`
  esistenti la coprono in gran parte.
- `.hide { display:none !important }`: stampando dal tab Mensile, il tab
  Settimanale (nascosto) non finisce nel PDF. La stampa rispetta già il tab
  attivo.
- I canvas Chart.js rendono male in stampa: il pattern esistente snapshotta il
  canvas in un `<img class="chart-print">` (vedi `snapshotCanvases` /
  `snapshotChartsForPrint` in `charts.js`). Il grafico mensile è registrato in
  `state.monthlyStatusChart`.

## Modifiche

### 1. `public/js/monthly.js` (`renderMonthly`)

- Aggiungere `<img id="monthlyStatusChartPrint" class="chart-print" alt="">`
  accanto al `<canvas id="monthlyStatusChart">` nella card del grafico.
- Aggiungere in fondo alla vista un banner export identico a quello settimanale,
  con bottone `id="monthExportPdfBtn"`.
- Wiring del bottone: `snapshotChartsForPrint()` → `requestAnimationFrame` ×2 →
  `window.print()` (stesso pattern del bottone settimanale).
- Importare `snapshotChartsForPrint` da `./charts.js`.

### 2. `public/js/charts.js` (`snapshotChartsForPrint`)

- Aggiungere la coppia del grafico mensile:
  `["monthlyStatusChart", "monthlyStatusChartPrint", state.monthlyStatusChart]`.
- `snapshotCanvases` ignora già canvas/img assenti → no-op quando il tab mensile
  non è renderizzato. Copre sia il bottone sia Cmd/Ctrl+P (listener
  `beforeprint` esistente).

### 3. `public/css/dashboard.css` (`@media print`)

- Regola nuova: `.month-kpi { grid-template-columns: repeat(4, 1fr) !important }`
  (la vista mensile ha 4 KPI; la regola generica ne forza 5 → colonna vuota).
- Resto già coperto. Il banner export è già nascosto in stampa via
  `.export-banner { display:none !important }`.

## Test / Verifica

Feature di stampa/CSS: nessun test automatico applicabile. Verifica manuale:
preview locale (`vercel dev`), tab Mensile → "Esporta PDF" → finestra di stampa
con layout A4 corretto (KPI su una riga, grafico come immagine, tabella
compatta). Screenshot di conferma all'utente prima del deploy.
