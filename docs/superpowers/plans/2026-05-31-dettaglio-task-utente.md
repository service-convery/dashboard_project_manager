# Dettaglio per task e per utente (vista Consumo ore) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere alla vista "Consumo ore" un blocco di dettaglio a 3 tab — `Per mese` (esistente), `Per task` (nuova tabella) e `Per utente` (grafico a barre orizzontali) — riusando i dati già scaricati.

**Architecture:** La logica di aggregazione (per task / per utente) vive in un nuovo modulo puro `public/js/hours-aggregate.js` (zero dipendenze, zero DOM). `public/js/hours-package.js` consuma quelle funzioni, costruisce il markup a tab, renderizza la tabella task e il grafico utenti (lazy alla prima apertura del tab). Nessuna modifica al backend: le time-entry contengono già `task` e `user`.

**Tech Stack:** Vanilla ES modules nel browser (caricati come `<script type="module">`), Chart.js (già incluso), CSS custom-properties esistenti. Node lato server è CommonJS — **non** aggiungere `"type":"module"` a package.json. Nessun framework di test: verifica via `vercel dev` + console DevTools.

**Riferimento spec:** `docs/superpowers/specs/2026-05-31-dettaglio-task-utente-design.md`

---

## File Structure

- **Create** `public/js/hours-aggregate.js` — funzioni pure `aggregateByTask(entries, taskById)` e `aggregateByUser(entries)`. Nessun import. Unica responsabilità: trasformare un array di time-entry in righe ordinate per task / per utente.
- **Modify** `public/js/state.js` — aggiungere il campo `hoursUsersChart: null` (istanza Chart.js del grafico utenti).
- **Modify** `public/js/hours-package.js` — importare le aggregazioni + `statusClass`/`initials`; calcolare le aggregazioni in `loadHoursView`; sostituire la card "Dettaglio mensile" con il blocco a tab; aggiungere gli helper `monthlyDetailTableHtml`, `taskTableHtml`, `renderUsersChart`, `setupDetailTabs` e la costante `USERS_DISCLAIMER`.
- **Modify** `public/css/dashboard.css` — poche regole per spaziatura pannelli e contenitore del grafico utenti. I bottoni tab riusano `.filter-toggle`.

---

## Task 1: Modulo puro di aggregazione

**Files:**
- Create: `public/js/hours-aggregate.js`

- [ ] **Step 1: Scrivere il test (console DevTools) e prepararlo**

Questo è il test che eseguirai nella console del browser su `vercel dev`. Salvalo a portata di mano (anche solo in un commento temporaneo). NON implementare ancora il modulo.

```js
// Incolla nella console DevTools mentre gira `vercel dev`, su una pagina /d/<slug>
const { aggregateByTask, aggregateByUser } = await import('/js/hours-aggregate.js');
const entries = [
  { task:{id:'a',name:'Task A'}, user:{id:1,username:'Mario',color:'#ff0000'}, duration_ms: 3600000 },
  { task:{id:'a',name:'Task A'}, user:{id:2,username:'Lucia'},               duration_ms: 1800000 },
  { task:{id:'b',name:'Task B'}, user:{id:1,username:'Mario'},               duration_ms: 1800000 },
  { task:{id:'c'},               user:null,                                  duration_ms: 600000  },
];
const taskById = new Map([['a', {id:'a', name:'Task A', url:'http://x', status:'completato', assignees:[{username:'Mario Rossi'}]}]]);
const { rows, totalMs } = aggregateByTask(entries, taskById);
console.assert(totalMs === 7800000, 'totalMs');
console.assert(rows[0].id === 'a' && rows[0].ms === 5400000, 'A primo, 1.5h');
console.assert(Math.round(rows[0].pct) === 69, 'pct A ~69');
console.assert(rows[0].url === 'http://x' && rows[0].assignees.length === 1, 'meta join da taskById');
console.assert(rows.find(r => r.id === 'b').name === 'Task B', 'B: nome di fallback dall entry');
console.assert(rows.find(r => r.id === 'c').name === '(senza titolo)', 'C: nessun nome');
const users = aggregateByUser(entries);
console.assert(users[0].name === 'Mario' && users[0].ms === 5400000, 'Mario top');
console.assert(users[1].name === 'Lucia' && users[1].ms === 1800000, 'Lucia seconda');
console.assert(users.find(u => u.id === 'unknown').name === 'Sconosciuto', 'utente mancante -> Sconosciuto');
console.log('AGGREGATE OK');
```

- [ ] **Step 2: Eseguire il test → deve fallire**

Avvia `vercel dev`, apri `http://localhost:3000/d/<slug>`, fai login, apri la console e incolla lo snippet.
Expected: errore `Failed to fetch dynamically imported module` / 404 su `/js/hours-aggregate.js` (il file non esiste ancora).

- [ ] **Step 3: Implementare il modulo**

Crea `public/js/hours-aggregate.js`:

```js
// === Aggregazioni pure per la vista "Consumo ore" ===
// Nessun import, nessun accesso al DOM: funzioni pure, testabili in isolamento
// (anche da console: const m = await import('/js/hours-aggregate.js')).

// Raggruppa le time-entry per task. `taskById` è una Map(taskId -> task della board)
// usata per nome/url/status/assegnatari coerenti con la vista settimanale.
// Ritorna { rows, totalMs }; rows ordinate per ore decrescenti.
export function aggregateByTask(entries, taskById){
  const msById = new Map();    // taskId -> ms totali
  const nameById = new Map();  // taskId -> nome di fallback ricavato dall'entry
  let totalMs = 0;
  (entries || []).forEach(e => {
    const t = e && e.task;
    const id = t && t.id;
    if (!id) return;
    const ms = Number(e.duration_ms) || 0;
    msById.set(id, (msById.get(id) || 0) + ms);
    totalMs += ms;
    if (t.name && !nameById.has(id)) nameById.set(id, t.name);
  });
  const rows = [];
  msById.forEach((ms, id) => {
    const meta = (taskById && taskById.get(id)) || {};
    rows.push({
      id,
      name: meta.name || nameById.get(id) || "(senza titolo)",
      url: meta.url || null,
      status: meta.status != null ? meta.status : null,
      assignees: Array.isArray(meta.assignees) ? meta.assignees : [],
      ms,
      pct: totalMs > 0 ? (ms / totalMs) * 100 : 0
    });
  });
  rows.sort((a, b) => b.ms - a.ms);
  return { rows, totalMs };
}

// Raggruppa le time-entry per utente ClickUp che ha tracciato il tempo (e.user).
// Ritorna un array ordinato per ore decrescenti: [{ id, name, color, ms }].
// Entry senza utente confluiscono in un bucket "Sconosciuto".
export function aggregateByUser(entries){
  const byId = new Map();
  (entries || []).forEach(e => {
    const ms = Number(e && e.duration_ms) || 0;
    const u = e && e.user;
    const id = (u && u.id != null) ? u.id : "unknown";
    const cur = byId.get(id) || {
      id,
      name: (u && (u.username || u.email)) || "Sconosciuto",
      color: (u && u.color) || null,
      ms: 0
    };
    cur.ms += ms;
    byId.set(id, cur);
  });
  return [...byId.values()].sort((a, b) => b.ms - a.ms);
}
```

- [ ] **Step 4: Eseguire il test → deve passare**

Ricarica la pagina, riapri la console, reincolla lo snippet dello Step 1.
Expected: nessun `console.assert` rosso e in fondo stampa `AGGREGATE OK`.

- [ ] **Step 5: Commit**

```bash
git add public/js/hours-aggregate.js
git commit -m "feat(hours): pure aggregation by task and by user"
```

---

## Task 2: Campo state per il grafico utenti

**Files:**
- Modify: `public/js/state.js:14`

- [ ] **Step 1: Aggiungere il campo `hoursUsersChart`**

In `public/js/state.js`, subito dopo la riga `hoursPkgChart: null,   // grafico della vista "Consumo ore"`, aggiungi:

```js
  hoursUsersChart: null, // grafico "Per utente" nella vista "Consumo ore"
```

- [ ] **Step 2: Verifica**

Run: `node -e "const s=require('fs').readFileSync('public/js/state.js','utf8'); if(!s.includes('hoursUsersChart')) throw new Error('campo mancante'); console.log('OK')"`
Expected: stampa `OK`.

- [ ] **Step 3: Commit**

```bash
git add public/js/state.js
git commit -m "feat(hours): add hoursUsersChart slot to shared state"
```

---

## Task 3: Blocco a tab + tabella "Per task" + switching

Trasforma la card "Dettaglio mensile" in un blocco a 3 tab. Il grafico utenti viene aggiunto nel Task 4; qui il pannello "Per utente" mostra solo un canvas vuoto, ma lo switch tra tab deve già funzionare e la tabella "Per task" deve popolarsi.

**Files:**
- Modify: `public/js/hours-package.js`

- [ ] **Step 1: Aggiornare gli import**

In testa a `public/js/hours-package.js`, sostituisci le due righe di import esistenti:

```js
import { fetchTasks, fetchEntriesRange } from "./api.js";
import { escapeHtml } from "./format.js";
```

con:

```js
import { fetchTasks, fetchEntriesRange } from "./api.js";
import { escapeHtml, statusClass, initials } from "./format.js";
import { aggregateByTask, aggregateByUser } from "./hours-aggregate.js";
```

- [ ] **Step 2: Aggiungere la costante disclaimer**

Subito dopo la riga `const HOUR_MS = 3600000;`, aggiungi:

```js
const USERS_DISCLAIMER =
  "Le ore sono attribuite a chi ha materialmente tracciato il tempo. " +
  "In base all'ambito dell'attività, uno stesso task può essere lavorato da più persone: " +
  "la ripartizione per utente non indica quindi la titolarità dell'attività.";
```

- [ ] **Step 3: Calcolare le aggregazioni in `loadHoursView`**

In `loadHoursView`, subito dopo la riga `const ourEntries = entries.filter(e => e && e.task && taskIds.has(e.task.id));`, aggiungi:

```js
    const taskById = new Map(tasks.map(t => [t.id, t]));
    const taskRows = aggregateByTask(ourEntries, taskById).rows;
    const userRows = aggregateByUser(ourEntries);
```

Poi, nella chiamata `render(container, { ... })`, aggiungi i due campi nell'oggetto passato (subito dopo `rows,`):

```js
      pkg, startDate, hasPkg, rows, taskRows, userRows,
```

(La riga diventa: `pkg, startDate, hasPkg, rows, taskRows, userRows,` al posto di `pkg, startDate, hasPkg, rows,`.)

- [ ] **Step 4: Estrarre l'helper della tabella mensile**

Aggiungi questa funzione (es. subito sopra `function render(`). Contiene **lo stesso markup** della tabella "Dettaglio mensile" attuale, ma senza la card/section-header (che ora le fa il blocco tab):

```js
// Markup della tabella mensile (senza card/header: vive in un pannello tab).
function monthlyDetailTableHtml(rows, hasPkg){
  let h = '<div class="table-wrap"><table class="tasks"><thead><tr><th>Mese</th>';
  if (hasPkg) h += '<th style="text-align:right;">Maturate</th>';
  h += '<th style="text-align:right;">Consumate</th>';
  if (hasPkg) h += '<th style="text-align:right;">Saldo mese</th><th style="text-align:right;">Saldo cumul.</th>';
  h += '</tr></thead><tbody>';
  if (!rows.length) {
    h += '<tr><td colspan="' + (hasPkg ? 5 : 2) + '" class="empty">Nessun dato nel periodo.</td></tr>';
  } else {
    rows.slice().reverse().forEach(r => {   // più recente in alto
      h += '<tr><td>' + fmtMonthYear(r.month, r.year) + '</td>';
      if (hasPkg) h += '<td style="text-align:right;">' + (r.accruedMs ? fmtSignedMs(r.accruedMs) : "—") + '</td>';
      h += '<td style="text-align:right;">' + fmtHoursMs(r.consumedMs) + '</td>';
      if (hasPkg) {
        h += '<td style="text-align:right;" class="' + (r.saldoMese < 0 ? "saldo-neg" : "") + '">' + fmtSignedMs(r.saldoMese) + '</td>' +
             '<td style="text-align:right;" class="' + (r.cumulMs < 0 ? "saldo-neg" : "saldo-pos") + '">' + fmtSignedMs(r.cumulMs) + '</td>';
      }
      h += '</tr>';
    });
  }
  h += '</tbody></table></div>';
  return h;
}
```

- [ ] **Step 5: Aggiungere l'helper della tabella "Per task"**

Aggiungi questa funzione subito sotto `monthlyDetailTableHtml`:

```js
// Markup della tabella "Per task": una riga per task con ore tracciate, ordinate desc.
function taskTableHtml(rows){
  let h = '<div class="table-wrap"><table class="tasks"><thead><tr>' +
    '<th>Task</th><th>Stato</th><th>Assegnatari</th>' +
    '<th style="text-align:right;">Ore</th><th style="text-align:right;">%</th>' +
    '</tr></thead><tbody>';
  if (!rows.length) {
    h += '<tr><td colspan="5" class="empty">Nessuna ora tracciata nel periodo.</td></tr>';
  } else {
    rows.forEach(r => {
      const statusRaw = (r.status && typeof r.status === "object") ? r.status.status : r.status;
      const stHtml = '<span class="badge ' + statusClass(statusRaw) + '">' + escapeHtml(statusRaw || "—") + '</span>';
      const nameHtml = r.url
        ? '<a href="' + escapeHtml(r.url) + '" target="_blank" rel="noopener">' + escapeHtml(r.name) + '</a>'
        : escapeHtml(r.name);
      const assHtml = r.assignees.length
        ? '<div class="assignees">' + r.assignees.map(a =>
            '<span class="avatar" title="' + escapeHtml(a.username || "") + '">' + escapeHtml(initials(a.username)) + '</span>'
          ).join("") + '</div>'
        : '<span style="color:var(--text-muted);font-size:12px;">—</span>';
      h += '<tr><td><div class="task-name">' + nameHtml + '</div></td>' +
        '<td>' + stHtml + '</td>' +
        '<td>' + assHtml + '</td>' +
        '<td style="text-align:right;">' + fmtHoursMs(r.ms) + '</td>' +
        '<td style="text-align:right;">' + Math.round(r.pct) + '%</td></tr>';
    });
  }
  h += '</tbody></table></div>';
  return h;
}
```

- [ ] **Step 6: Aggiungere lo switching tra tab**

Aggiungi questa funzione (sotto `taskTableHtml`). Per ora `onFirstUsers` non fa nulla di visibile (il chart arriva nel Task 4); definiscila comunque per non duplicare codice dopo:

```js
// Gestisce lo switch tra i pannelli di dettaglio. Chiama onFirstUsers() la prima
// volta che si apre il pannello "Per utente" (render lazy del canvas).
function setupDetailTabs(container, onFirstUsers){
  const tabs = container.querySelectorAll(".detail-tab");
  const panels = {
    mese:   container.querySelector("#detailMese"),
    task:   container.querySelector("#detailTask"),
    utente: container.querySelector("#detailUtente")
  };
  let usersShown = false;
  tabs.forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.tab;
      tabs.forEach(b => {
        const on = b === btn;
        b.classList.toggle("active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      });
      Object.entries(panels).forEach(([k, el]) => { if (el) el.classList.toggle("hide", k !== key); });
      if (key === "utente" && !usersShown) { usersShown = true; onFirstUsers(); }
    });
  });
}
```

- [ ] **Step 7: Sostituire la card "Dettaglio mensile" con il blocco a tab in `render`**

Nella funzione `render`, individua il blocco che costruisce la card "Dettaglio mensile" — va dalla riga `html += '<div class="card"><div class="section-header"><h3>Dettaglio mensile</h3>...` fino alla riga `html += '</tbody></table></div></div>';` inclusa (l'intero `<div class="card">` della tabella mensile). **Sostituiscilo** con:

```js
  html += '<div class="card hours-detail">' +
    '<div class="section-header"><h3>Dettaglio</h3>' +
      '<div class="filter-toggle detail-tabs" role="tablist" aria-label="Dettaglio consumo">' +
        '<button class="detail-tab active" data-tab="mese" role="tab" aria-selected="true" type="button">Per mese</button>' +
        '<button class="detail-tab" data-tab="task" role="tab" aria-selected="false" type="button">Per task</button>' +
        '<button class="detail-tab" data-tab="utente" role="tab" aria-selected="false" type="button">Per utente</button>' +
      '</div></div>' +
    '<div id="detailMese" class="detail-panel">' + monthlyDetailTableHtml(rows, hasPkg) + '</div>' +
    '<div id="detailTask" class="detail-panel hide">' + taskTableHtml(taskRows) + '</div>' +
    '<div id="detailUtente" class="detail-panel hide">' +
      '<div class="chart-wrap chart-wrap-users"><canvas id="hoursUsersChart"></canvas></div>' +
      '<p class="hours-note">' + escapeHtml(USERS_DISCLAIMER) + '</p>' +
      '<p class="hours-note">Copre gli utenti assegnatari sui task di questa lista.</p>' +
    '</div></div>';
```

Aggiorna anche la firma/destructuring in cima a `render`: la riga
`const { pkg, startDate, hasPkg, rows, consumedTotalMs, accruedTotalMs, saldoMs, partial } = m;`
diventa
`const { pkg, startDate, hasPkg, rows, taskRows, userRows, consumedTotalMs, accruedTotalMs, saldoMs, partial } = m;`

- [ ] **Step 8: Agganciare lo switching dopo l'innerHTML**

In fondo a `render`, dopo `container.innerHTML = html;` e dopo la chiamata esistente `renderChart(rows, ...)`, aggiungi:

```js
  setupDetailTabs(container, () => { /* grafico utenti: implementato nel Task 4 */ });
```

- [ ] **Step 9: Verifica visiva**

Con `vercel dev` attivo, apri `/d/<slug>`, login, vai sul tab **Consumo ore**.
Expected:
- In fondo c'è una card "Dettaglio" con il selettore `[ Per mese | Per task | Per utente ]`.
- "Per mese" è attivo di default e mostra la tabella mensile come prima.
- Cliccando "Per task" appare la tabella Task / Stato / Assegnatari / Ore / % ordinata per ore decrescenti; i nomi task sono link.
- Cliccando "Per utente" appare il pannello (canvas ancora vuoto, niente errori in console).
- Tornando su "Per mese" la tabella mensile riappare.

- [ ] **Step 10: Commit**

```bash
git add public/js/hours-package.js
git commit -m "feat(hours): tabbed detail with per-task table"
```

---

## Task 4: Grafico "Per utente" (barre orizzontali, lazy)

**Files:**
- Modify: `public/js/hours-package.js`

- [ ] **Step 1: Aggiungere `renderUsersChart`**

Aggiungi questa funzione in fondo a `public/js/hours-package.js` (accanto a `renderChart`):

```js
// Grafico a barre ORIZZONTALI delle ore per utente ClickUp (indexAxis: "y").
function renderUsersChart(users){
  const ctx = document.getElementById("hoursUsersChart");
  if (!ctx) return;
  if (state.hoursUsersChart) state.hoursUsersChart.destroy();
  // Altezza proporzionale al numero di utenti (le barre orizzontali crescono in verticale).
  const wrap = ctx.parentElement;
  if (wrap) wrap.style.height = Math.max(160, users.length * 38) + "px";

  const labels = users.map(u => u.name);
  const data = users.map(u => +(u.ms / HOUR_MS).toFixed(2));
  const colors = users.map(u => u.color || "#3333FF");

  state.hoursUsersChart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ label: "Ore", data, backgroundColor: colors, borderRadius: 4, maxBarThickness: 28 }] },
    options: {
      indexAxis: "y",
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#FFFFFF", titleColor: "#1A1A2E", bodyColor: "#5A6178",
          borderColor: "#D8DCE4", borderWidth: 1, padding: 10,
          callbacks: { label: (c) => c.parsed.x + " h" }
        }
      },
      scales: {
        x: { beginAtZero: true, ticks: { color: "#5A6178", font: { size: 11 }, callback: (v) => v + "h" }, grid: { color: "#E8ECF2" } },
        y: { grid: { display: false }, ticks: { color: "#5A6178", font: { size: 11 } } }
      }
    }
  });
}
```

- [ ] **Step 2: Collegare il render lazy nello switching**

In `render`, sostituisci la riga aggiunta nel Task 3 Step 8:

```js
  setupDetailTabs(container, () => { /* grafico utenti: implementato nel Task 4 */ });
```

con:

```js
  setupDetailTabs(container, () => {
    if (!userRows.length) {
      const w = container.querySelector("#detailUtente .chart-wrap-users");
      if (w) w.innerHTML = '<p class="empty" style="padding:24px;text-align:center;">Nessuna ora tracciata nel periodo.</p>';
      return;
    }
    renderUsersChart(userRows);
  });
```

- [ ] **Step 3: Verifica visiva**

Con `vercel dev`, vai su Consumo ore → tab **Per utente**.
Expected:
- Appare un grafico a barre orizzontali, una barra per utente, ordinate dalla più lunga (più ore) alla più corta; tooltip "N h".
- Sotto il grafico: il disclaimer ("Le ore sono attribuite a chi ha materialmente tracciato il tempo…") e la nota sugli assegnatari.
- Riapri la scheda DevTools "Network": la richiesta `/js/...` non scarica nuovi dati ClickUp al cambio tab (nessun refetch).

- [ ] **Step 4: Commit**

```bash
git add public/js/hours-package.js
git commit -m "feat(hours): per-user horizontal bar chart with disclaimer"
```

---

## Task 5: CSS del blocco dettaglio

I bottoni tab riusano già `.filter-toggle`. Servono solo poche regole per spaziatura del selettore, pannelli e contenitore del grafico utenti.

**Files:**
- Modify: `public/css/dashboard.css`

- [ ] **Step 1: Aggiungere le regole**

In fondo a `public/css/dashboard.css` aggiungi:

```css
/* === Vista Consumo ore: blocco dettaglio a tab === */
.hours-detail .section-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.hours-detail .detail-tabs { margin-left: auto; }
.hours-detail .detail-panel { margin-top: 4px; }
.chart-wrap-users { position: relative; min-height: 160px; }
```

- [ ] **Step 2: Verifica visiva**

Ricarica `/d/<slug>` → Consumo ore.
Expected: il selettore `[ Per mese | Per task | Per utente ]` è allineato a destra nell'header "Dettaglio", il tab attivo è evidenziato in colore pieno (stile identico al toggle "Solo settimana / Tutti" della vista settimanale), il grafico utenti ha un'altezza adeguata.

- [ ] **Step 3: Commit**

```bash
git add public/css/dashboard.css
git commit -m "style(hours): detail tabs layout and users chart container"
```

---

## Task 6: Verifica end-to-end e casi limite

**Files:** nessuna modifica prevista (solo verifica; correggi inline se emergono difetti).

- [ ] **Step 1: Cliente CON pacchetto**

Su un cliente con `pacchettoOre`+`dataInizio` configurati: KPI, barra e grafico mensile restano in alto invariati; i 3 tab funzionano; "Per task" mostra le % che sommano ~100%; "Per utente" mostra le barre.

- [ ] **Step 2: Cliente SENZA pacchetto**

Su un cliente senza `pacchettoOre`: la vista mostra solo "Ore consumate" + grafico mensile; i 3 tab di dettaglio funzionano comunque ("Per mese" ha solo Mese/Consumate).

- [ ] **Step 3: Periodo senza ore tracciate**

Se non ci sono time-entry nel periodo: "Per task" mostra "Nessuna ora tracciata nel periodo."; "Per utente" mostra il messaggio vuoto al posto del grafico (nessun errore Chart.js in console).

- [ ] **Step 4: Stampa / PDF**

Seleziona un tab di dettaglio (es. "Per task"), premi "Esporta PDF" (`window.print()`).
Expected: nell'anteprima di stampa compare solo il pannello del tab attivo (i pannelli `.hide` non vengono stampati); KPI e grafico mensile sopra sono presenti.

- [ ] **Step 5: Console pulita**

Naviga tra Settimanale ↔ Consumo ore e tra i 3 tab di dettaglio più volte.
Expected: nessun errore in console; il grafico utenti si ridisegna correttamente (nessun "Canvas is already in use") grazie al `destroy()` su `state.hoursUsersChart`.

- [ ] **Step 6: Commit finale (se sono serviti fix)**

```bash
git add -A
git commit -m "fix(hours): edge cases for per-task/per-user detail"
```

---

## Self-Review (eseguito in fase di scrittura)

- **Copertura spec:** 3 tab (Task 3) ✓ · default "Per mese" (Task 3 Step 7) ✓ · tabella task 4 colonne Nome/Stato+assegnatari/Ore/% (Task 3 Step 5) ✓ · ordinamento ore desc (Task 1 `rows.sort`) ✓ · grafico barre orizzontali per utente (Task 4) ✓ · colore utente ClickUp (Task 4 `colors`) ✓ · disclaimer + nota limite (Task 3 Step 7) ✓ · nessuna nuova chiamata API (riuso `ourEntries`, Task 3 Step 3) ✓ · lazy render canvas (Task 4 Step 2) ✓ · stampa tab attivo (Task 6 Step 4) ✓ · edge case vuoto/no-pacchetto (Task 6) ✓.
- **Placeholder:** nessun TODO/TBD residuo nel codice consegnato. Il commento "implementato nel Task 4" allo Step 8 di Task 3 viene esplicitamente sostituito allo Step 2 di Task 4.
- **Coerenza tipi/nomi:** `aggregateByTask` → `{rows,totalMs}` (uso `.rows` in Task 3); `aggregateByUser` → array `[{id,name,color,ms}]` (usato in `renderUsersChart`); `setupDetailTabs(container, onFirstUsers)`, id pannelli `detailMese/detailTask/detailUtente` e classi `detail-tab`/`detail-panel`/`chart-wrap-users` coerenti tra Task 3, 4 e 5; `state.hoursUsersChart` definito in Task 2 e usato in Task 4.
