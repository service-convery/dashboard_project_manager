# Viste per tag — filtro task da configurazione · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Filtrare i task del dashboard per "viste con nome" definite in `config/clients.json`, applicando il filtro a KPI+grafici+tabella nel tab Settimanale e al consumo (grafico/per task/per utente) nel tab Consumo ore, lasciando pacchetto/saldo sempre globali.

**Architecture:** La logica di matching tag è isolata in un modulo puro senza dipendenze DOM (`public/js/tag-views.mjs`), unit-testato con il test runner integrato di Node. Il filtro si applica "alla sorgente" in cima a `render()` (tab Settimanale), così tutti i consumatori a valle seguono. Un singolo selettore di vista condiviso, montato una volta sotto la barra dei tab, controlla `state.activeView` per entrambi i tab. Il tab Consumo ore separa il calcolo globale (pacchetto/saldo) da quello filtrato (consumo).

**Tech Stack:** Vanilla JS (ES modules, browser), Vercel serverless functions (Node 20 CommonJS), Chart.js, Node built-in test runner (`node --test`).

**Spec di riferimento:** `docs/superpowers/specs/2026-06-08-viste-tag-filtro-design.md`

---

## File Structure

| File | Responsabilità | Azione |
|------|----------------|--------|
| `public/js/tag-views.mjs` | Logica pura: normalizzazione tag, match task↔tag, risoluzione del set di tag dalla vista attiva, chiave localStorage | **Create** |
| `test/tag-views.test.mjs` | Unit test del modulo puro (`node --test`) | **Create** |
| `api/me.js` | Aggiungere `tagViews` ai campi pubblici esposti al client | **Modify** |
| `public/js/state.js` | Aggiungere `activeView` allo stato | **Modify** |
| `public/js/render.js` | Filtro alla sorgente in `render()`, cache input, export `rerender()` | **Modify** |
| `public/dashboard.html` | Markup del selettore vista condiviso | **Modify** |
| `public/css/dashboard.css` | Stile del selettore vista | **Modify** |
| `public/js/dashboard.js` | Build selettore, handler, persistenza, tracking tab, wiring re-render | **Modify** |
| `public/js/hours-package.js` | Split fetch/render, calcolo globale vs filtrato, export `rerenderHoursView()` | **Modify** |
| `config/clients.json` | Esempio `tagViews` su un cliente | **Modify** |

**Nota di refinement sull'UI (rispetto allo spec):** lo spec parlava di "due istanze sincronizzate" del selettore (una per tab). In implementazione si usa **un unico selettore condiviso** montato una sola volta sotto la barra dei tab, visibile in entrambe le viste. Questo soddisfa l'intento approvato (stessa selezione tra i tab) con meno DOM e senza logica di sincronizzazione. Il tab Consumo ore viene ricostruito via `innerHTML`, quindi un selettore al suo interno verrebbe distrutto ad ogni render: ragione ulteriore per tenerlo fuori dai container delle viste.

---

## Task 1: Modulo puro `tag-views.mjs` + unit test

**Files:**
- Create: `public/js/tag-views.mjs`
- Test: `test/tag-views.test.mjs`

> Perché `.mjs`: la repo non ha `"type":"module"` (le function in `api/` sono CommonJS). Estensione `.mjs` fa sì che Node interpreti il file come ESM senza toccare `package.json`, e i browser lo importano come qualsiasi modulo.

- [ ] **Step 1: Scrivi il test che fallisce**

Create `test/tag-views.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTag, taskTagNames, taskMatchesTags, resolveTagSet, viewStorageKey
} from "../public/js/tag-views.mjs";

const task = (tags) => ({ tags: tags.map(name => ({ name })) });

test("normalizeTag lowercases and trims", () => {
  assert.equal(normalizeTag("  Frontend  "), "frontend");
  assert.equal(normalizeTag(null), "");
});

test("taskTagNames returns normalized set", () => {
  const names = taskTagNames(task(["Bug", " UI "]));
  assert.ok(names.has("bug"));
  assert.ok(names.has("ui"));
});

test("taskMatchesTags: empty set matches everything", () => {
  assert.equal(taskMatchesTags(task([]), new Set()), true);
});

test("taskMatchesTags: OR match, case-insensitive", () => {
  const set = new Set(["api", "db"]);
  assert.equal(taskMatchesTags(task(["API"]), set), true);   // uno basta (OR)
  assert.equal(taskMatchesTags(task(["frontend"]), set), false);
});

test("taskMatchesTags: task without tags excluded when set non-empty", () => {
  assert.equal(taskMatchesTags({ tags: null }, new Set(["bug"])), false);
});

const VIEWS = [
  { label: "Frontend", tags: ["frontend", "ui"] },
  { label: "Bug", tags: ["Bug"] },
  { label: "Backend", tags: ["api", "db"] },
];

test("resolveTagSet: no views => empty set (no filter)", () => {
  assert.equal(resolveTagSet(null, "__all__").size, 0);
  assert.equal(resolveTagSet([], "0").size, 0);
});

test("resolveTagSet: __all__ => union of all view tags", () => {
  const s = resolveTagSet(VIEWS, "__all__");
  assert.deepEqual([...s].sort(), ["api", "bug", "db", "frontend", "ui"]);
});

test("resolveTagSet: index selects that view (normalized)", () => {
  assert.deepEqual([...resolveTagSet(VIEWS, "1")], ["bug"]);
  assert.deepEqual([...resolveTagSet(VIEWS, "2")].sort(), ["api", "db"]);
});

test("resolveTagSet: out-of-range index falls back to union", () => {
  assert.equal(resolveTagSet(VIEWS, "9").size, 5);
  assert.equal(resolveTagSet(VIEWS, "x").size, 5);
});

test("viewStorageKey is slug-scoped", () => {
  assert.equal(viewStorageKey("pirelli"), "pirelli-weekly:active-view:pirelli");
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `node --test test/tag-views.test.mjs`
Expected: FAIL — `Cannot find module .../public/js/tag-views.mjs`

- [ ] **Step 3: Implementa il modulo puro**

Create `public/js/tag-views.mjs`:

```js
// === Logica pura per le "viste per tag" (nessuna dipendenza DOM) ===
// Isolata qui per poter essere unit-testata con `node --test` e riusata sia dal
// tab Settimanale (render.js) sia dal tab Consumo ore (hours-package.js).

// Normalizza un nome tag per il confronto: stringa lowercase senza spazi ai bordi.
export function normalizeTag(name){
  return String(name == null ? "" : name).toLowerCase().trim();
}

// Set dei nomi tag (normalizzati) di un task ClickUp. Tollera tags assente/non-array.
export function taskTagNames(task){
  const tags = task && Array.isArray(task.tags) ? task.tags : [];
  return new Set(tags.map(t => normalizeTag(t && t.name)));
}

// Vero se il task ha ALMENO UNO dei tag richiesti (OR). Set vuoto = nessun vincolo.
export function taskMatchesTags(task, tagSet){
  if (!tagSet || tagSet.size === 0) return true;
  const names = taskTagNames(task);
  for (const tag of tagSet) if (names.has(tag)) return true;
  return false;
}

// Unione (normalizzata) dei tag di tutte le viste configurate.
function unionTags(views){
  const s = new Set();
  views.forEach(v => (v && Array.isArray(v.tags) ? v.tags : []).forEach(t => s.add(normalizeTag(t))));
  return s;
}

// Risolve il Set di tag effettivo data la config e la vista attiva.
// tagViews: array | null/undefined. activeView: "__all__" | indice numerico in stringa.
// - nessuna vista configurata  -> Set vuoto (nessun filtro, comportamento attuale)
// - "__all__" o valore non valido -> unione di tutte le viste
// - indice valido -> i tag di quella vista
export function resolveTagSet(tagViews, activeView){
  const views = Array.isArray(tagViews) ? tagViews : [];
  if (views.length === 0) return new Set();
  if (activeView == null || activeView === "__all__") return unionTags(views);
  const idx = Number(activeView);
  if (!Number.isInteger(idx) || idx < 0 || idx >= views.length) return unionTags(views);
  const v = views[idx];
  return new Set((v && Array.isArray(v.tags) ? v.tags : []).map(normalizeTag));
}

// Chiave localStorage per la vista attiva, scoping per cliente (stesso prefisso di table-filter).
export function viewStorageKey(slug){
  return "pirelli-weekly:active-view:" + (slug || "");
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `node --test test/tag-views.test.mjs`
Expected: PASS — tutti i test verdi (11 test).

- [ ] **Step 5: Commit**

```bash
git add public/js/tag-views.mjs test/tag-views.test.mjs
git commit -m "feat(tag-views): pure tag-matching module with unit tests"
```

---

## Task 2: Esporre `tagViews` al client (`api/me.js`)

**Files:**
- Modify: `api/me.js:15-20` (funzione `pub`)

- [ ] **Step 1: Aggiungi `tagViews` ai campi pubblici**

In `api/me.js`, nella funzione `pub`, aggiungi il campo `tagViews` (default `null`):

```js
  // Campi pubblici per il client: name + config pacchetto ore + viste tag. Il listId resta server-side.
  const pub = (slug, c) => ({
    slug,
    name: c.name,
    pacchettoOre: c.pacchettoOre || null,
    dataInizio: c.dataInizio || null,
    tagViews: Array.isArray(c.tagViews) ? c.tagViews : null
  });
```

- [ ] **Step 2: Verifica sintassi**

Run: `node --check api/me.js`
Expected: nessun output (sintassi valida).

- [ ] **Step 3: Commit**

```bash
git add api/me.js
git commit -m "feat(api): expose tagViews in /api/me client payload"
```

---

## Task 3: Stato `activeView` (`public/js/state.js`)

**Files:**
- Modify: `public/js/state.js:24-27`

- [ ] **Step 1: Aggiungi `activeView` e `lastRenderInputs` allo stato**

In `public/js/state.js`, dentro l'oggetto `state`, subito dopo la riga `tableFilter: "week",` e il commento sopra `lastRender`, aggiungi:

```js
  // Vista tag attiva: "__all__" (default) | indice numerico (in stringa) di state.clientConfig.tagViews.
  // Validata/ripristinata da localStorage in dashboard.js (buildViewSelector), dopo che clientConfig è noto.
  activeView: "__all__",
  // Cache dei dati renderizzati: serve per rifiltrare la tabella senza richiamare l'API.
  lastRender: null,
  // Input grezzi (non filtrati) dell'ultimo render del tab Settimanale: per ri-renderizzare al cambio vista.
  lastRenderInputs: null,
```

(La riga `lastRender: null,` esiste già: sostituisci il blocco esistente in modo che `activeView` la preceda e `lastRenderInputs` la segua, senza duplicare `lastRender`.)

- [ ] **Step 2: Verifica sintassi**

Run: `node --check public/js/state.js`
Expected: errore atteso? No — `state.js` usa `export`, quindi `node --check` fallisce su ESM senza `.mjs`. Salta `node --check` per i file ESM `.js`; verifica invece con: `node --input-type=module -e "$(cat public/js/state.js | sed 's/window/globalThis/g')" ` **non necessario**. Verifica visiva che non ci siano duplicati di `lastRender`.

> I file frontend `.js` sono ESM ma girano solo nel browser; `node --check` non li valida. La verifica reale è nel browser (Task 9).

- [ ] **Step 3: Commit**

```bash
git add public/js/state.js
git commit -m "feat(state): add activeView and lastRenderInputs for tag views"
```

---

## Task 4: Filtro alla sorgente in `render()` (`public/js/render.js`)

**Files:**
- Modify: `public/js/render.js` (import in testa; funzione `render()` a `:110`; nuova export `rerender()`)

- [ ] **Step 1: Aggiungi gli import del modulo puro e dello stato**

In cima a `public/js/render.js`, tra gli import esistenti, aggiungi (e assicurati che `state` sia importato — lo è già, dato che `render()` usa `state.lastRender`):

```js
import { resolveTagSet, taskMatchesTags } from "./tag-views.mjs";
```

- [ ] **Step 2: Aggiungi helper `activeTagSet()` sopra `render()`**

Subito prima di `export function render(...)` (riga ~110), aggiungi:

```js
// Set di tag della vista attiva, derivato da config + state.activeView.
function activeTagSet(){
  const cfg = state.clientConfig || {};
  return resolveTagSet(cfg.tagViews, state.activeView);
}
```

- [ ] **Step 3: Filtra alla sorgente e salva gli input grezzi**

In `render()`, sostituisci la prima riga del corpo. Attualmente:

```js
export function render(allTasks, entries, estimates, closedThisWeek, mon, sun){
  const taskIdSet = new Set(allTasks.map(t => t.id));
```

diventa:

```js
export function render(allTasks, entries, estimates, closedThisWeek, mon, sun){
  // Salva gli input NON filtrati: il cambio vista re-renderizza ri-filtrando questi.
  state.lastRenderInputs = { allTasks, entries, estimates, closedThisWeek, mon, sun };

  // Filtro "alla sorgente": applico la vista tag a task aperti e completati.
  // Tutto a valle (KPI, grafici, tabella, ore via taskIdSet) segue automaticamente.
  const tagSet = activeTagSet();
  allTasks = allTasks.filter(t => taskMatchesTags(t, tagSet));
  closedThisWeek = (Array.isArray(closedThisWeek) ? closedThisWeek : []).filter(t => taskMatchesTags(t, tagSet));

  const taskIdSet = new Set(allTasks.map(t => t.id));
```

(Il resto della funzione resta invariato: usa già `allTasks` e `closedThisWeek`, ora riassegnati ai sottoinsiemi filtrati.)

- [ ] **Step 4: Aggiungi la export `rerender()` in fondo al file**

In fondo a `public/js/render.js`, aggiungi:

```js
// Ri-renderizza il tab Settimanale ri-filtrando gli ultimi input (cambio vista, niente fetch).
export function rerender(){
  const i = state.lastRenderInputs;
  if (!i) return;
  render(i.allTasks, i.entries, i.estimates, i.closedThisWeek, i.mon, i.sun);
}
```

- [ ] **Step 5: Verifica visiva**

Non c'è test runner per i moduli DOM. Verifica che: (a) `state.lastRenderInputs` sia assegnato **prima** del filtro (così conserva i dati grezzi), (b) `taskIdSet` sia costruito **dopo** il filtro. La verifica funzionale è nel Task 9.

- [ ] **Step 6: Commit**

```bash
git add public/js/render.js
git commit -m "feat(render): filter weekly view by active tag view at source"
```

---

## Task 5: Markup + CSS del selettore vista condiviso

**Files:**
- Modify: `public/dashboard.html:39-41`
- Modify: `public/css/dashboard.css` (dopo il blocco `.filter-toggle`, riga ~366)

- [ ] **Step 1: Aggiungi il contenitore del selettore sotto la barra dei tab**

In `public/dashboard.html`, tra la chiusura di `.view-tabs` (riga 39 `</div>`) e `<div id="viewWeekly">` (riga 41), inserisci:

```html
  <div id="viewSelectorBar" class="view-selector hide" role="tablist" aria-label="Vista per tag">
    <span class="view-selector-label">Vista:</span>
    <div class="view-selector-group filter-toggle"></div>
  </div>
```

- [ ] **Step 2: Aggiungi lo stile**

In `public/css/dashboard.css`, subito dopo la riga `.filter-toggle button + button { border-left: 1px solid var(--border); }` (riga ~365), aggiungi:

```css
.view-selector {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 16px;
  flex-wrap: wrap;
}
.view-selector-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
}
.view-selector-group { flex-wrap: wrap; }
```

(La classe `filter-toggle` sui pulsanti riusa lo stile già esistente per i bottoni attivi/hover.)

- [ ] **Step 3: Verifica**

Run: `node --check` non applicabile (HTML/CSS). Verifica visiva nel Task 9 che la barra resti nascosta finché non c'è config `tagViews`.

- [ ] **Step 4: Commit**

```bash
git add public/dashboard.html public/css/dashboard.css
git commit -m "feat(ui): shared tag-view selector bar markup and styles"
```

---

## Task 6: Build selettore, handler e wiring re-render (`public/js/dashboard.js`)

**Files:**
- Modify: `public/js/dashboard.js` (import; nuove funzioni; tracking tab in `switchView`; chiamata in bootstrap)

- [ ] **Step 1: Aggiorna gli import**

In cima a `public/js/dashboard.js`:
- aggiungi `rerender` all'import da `./render.js`:

```js
import { renderHealth, renderDiag, render, renderTable, rerender } from "./render.js";
```

- aggiungi `rerenderHoursView` all'import da `./hours-package.js`:

```js
import { loadHoursView, rerenderHoursView } from "./hours-package.js";
```

- aggiungi un import del key builder:

```js
import { viewStorageKey } from "./tag-views.mjs";
```

- [ ] **Step 2: Traccia il tab corrente in `switchView`**

In `public/js/dashboard.js`, modifica `switchView` (riga ~74) per ricordare il tab attivo. Aggiungi una variabile di modulo sopra la funzione e settala dentro:

```js
let currentTab = "weekly";
function switchView(view){
  currentTab = (view === "weekly") ? "weekly" : "hours";
  const weekly = view === "weekly";
  document.getElementById("viewWeekly").classList.toggle("hide", !weekly);
  document.getElementById("viewHours").classList.toggle("hide", weekly);
  document.getElementById("tabWeekly").classList.toggle("active", weekly);
  document.getElementById("tabHours").classList.toggle("active", !weekly);
  document.getElementById("tabWeekly").setAttribute("aria-selected", String(weekly));
  document.getElementById("tabHours").setAttribute("aria-selected", String(!weekly));
  if (!weekly) loadHoursView(); // lazy: carica i dati al primo accesso
}
```

- [ ] **Step 3: Aggiungi `buildViewSelector` e `setActiveView`**

Subito dopo `switchView` e i suoi listener (dopo riga ~85), aggiungi:

```js
// === Selettore "Vista per tag" (condiviso tra i due tab) ===
// Costruito dopo che state.clientConfig è noto. Se non ci sono tagViews resta nascosto.
function buildViewSelector(){
  const bar = document.getElementById("viewSelectorBar");
  if (!bar) return;
  const cfg = state.clientConfig || {};
  const views = Array.isArray(cfg.tagViews) ? cfg.tagViews : [];
  if (views.length === 0) { bar.classList.add("hide"); return; }

  // Ripristina la vista salvata (validata contro la config), fallback a "Tutti".
  let saved = "__all__";
  try {
    const v = window.localStorage && window.localStorage.getItem(viewStorageKey(SLUG));
    if (v === "__all__") saved = "__all__";
    else { const idx = Number(v); if (Number.isInteger(idx) && idx >= 0 && idx < views.length) saved = String(idx); }
  } catch (e) { /* localStorage non disponibile */ }
  state.activeView = saved;

  const group = bar.querySelector(".view-selector-group");
  group.innerHTML = "";
  const makeBtn = (label, value) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "tab");
    b.dataset.view = value;
    b.textContent = label;
    const on = state.activeView === value;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", String(on));
    b.addEventListener("click", () => setActiveView(value));
    return b;
  };
  group.appendChild(makeBtn("Tutti", "__all__"));
  views.forEach((v, i) => group.appendChild(makeBtn(v.label || ("Vista " + (i + 1)), String(i))));
  bar.classList.remove("hide");
}

function setActiveView(value){
  state.activeView = value;
  try { window.localStorage && window.localStorage.setItem(viewStorageKey(SLUG), value); }
  catch (e) { /* ignoro */ }
  const group = document.querySelector("#viewSelectorBar .view-selector-group");
  if (group) group.querySelectorAll("button").forEach(b => {
    const on = b.dataset.view === value;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", String(on));
  });
  // Ri-renderizza solo il tab visibile (nessuna nuova fetch).
  if (currentTab === "hours") rerenderHoursView();
  else rerender();
}
```

- [ ] **Step 4: Chiama `buildViewSelector()` nel bootstrap, prima di `load()`**

In `public/js/dashboard.js`, nel `bootstrap()`, subito prima della riga `load();` (riga ~177), aggiungi:

```js
    buildViewSelector();
    load();
```

(È dopo `state.clientConfig = allowed;` quindi la config è disponibile e `state.activeView` viene impostato prima del primo render.)

- [ ] **Step 5: Verifica**

Verifica visiva nel Task 9. Controlla che `setActiveView` e `buildViewSelector` siano definiti prima di essere usati (le function declaration sono hoisted, quindi l'ordine va bene anche se `buildViewSelector` è definita dopo il listener che la userà).

- [ ] **Step 6: Commit**

```bash
git add public/js/dashboard.js
git commit -m "feat(dashboard): wire shared tag-view selector with persistence and re-render"
```

---

## Task 7: Consumo ore — globale vs filtrato (`public/js/hours-package.js`)

**Files:**
- Modify: `public/js/hours-package.js` (import; split di `loadHoursView`; nuova `renderHoursFromCache`; export `rerenderHoursView`; firma di `renderChart`)

**Obiettivo:** pacchetto/saldo + tab "Per mese" = **globali**; grafico mensile + "Per task" + "Per utente" = **filtrati** sulla vista attiva. Cambio vista = re-render dalla cache, niente nuova fetch.

- [ ] **Step 1: Aggiungi gli import del modulo puro e dello stato**

In cima a `public/js/hours-package.js`, aggiungi:

```js
import { resolveTagSet, taskMatchesTags } from "./tag-views.mjs";
```

(`state` è già importato.)

- [ ] **Step 2: Split di `loadHoursView` in fetch + render-da-cache**

Sostituisci il corpo di `loadHoursView()` in modo che faccia solo fetch + cache, poi deleghi il rendering. Sostituisci l'intera funzione `export async function loadHoursView(){ ... }` con:

```js
export async function loadHoursView(){
  if (loaded) return;
  loaded = true;
  const container = document.getElementById("viewHours");
  container.innerHTML = '<div class="hours-loading"><span class="spinner"></span> Caricamento consumo ore…</div>';

  try {
    const tasks = await fetchTasks();            // cache condivisa con la vista settimanale
    const now = new Date();
    const cfg = state.clientConfig || {};
    const startDate = parseDate(cfg.dataInizio);
    const rangeStart = startDate || new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const { entries, failed, total } = await fetchEntriesRange(tasks, rangeStart, now);

    // Cache per ri-renderizzare al cambio vista senza nuova fetch.
    state.hoursData = { tasks, entries, rangeStart, now, partial: failed > 0 && failed < total };
    renderHoursFromCache();
  } catch (e) {
    container.innerHTML = '<div class="hours-note hours-error">Errore nel caricamento del consumo ore: ' +
      escapeHtml(e && e.message ? e.message : String(e)) + '</div>';
    loaded = false; // consenti un nuovo tentativo
  }
}

// Ri-renderizza il tab Consumo ore dai dati in cache (cambio vista). No-op se non ancora caricato.
export function rerenderHoursView(){
  if (!loaded || !state.hoursData) return;
  renderHoursFromCache();
}

// Calcola il modello (globale per pacchetto/saldo, filtrato per il consumo) e renderizza.
function renderHoursFromCache(){
  const container = document.getElementById("viewHours");
  const { tasks, entries, rangeStart, now, partial } = state.hoursData;
  const cfg = state.clientConfig || {};
  const pkg = cfg.pacchettoOre || null;
  const startDate = parseDate(cfg.dataInizio);
  const hasPkg = !!pkg && !!startDate;

  // --- Entries GLOBALI (tutti i task della lista): pacchetto, saldo, tab "Per mese" ---
  const idsAll = new Set(tasks.map(t => t.id));
  const entriesAll = entries.filter(e => e && e.task && idsAll.has(e.task.id));

  // --- Entries FILTRATE (solo task della vista attiva): grafico mensile, per task, per utente ---
  const tagSet = resolveTagSet(cfg.tagViews, state.activeView);
  const tasksView = tasks.filter(t => taskMatchesTags(t, tagSet));
  const idsView = new Set(tasksView.map(t => t.id));
  const entriesView = entriesAll.filter(e => idsView.has(e.task.id));

  // consumo mensile globale (chiave "year-month")
  const consumedByMonthAll = new Map();
  let consumedTotalMs = 0;
  entriesAll.forEach(e => {
    const startMs = Number(e.start); if (isNaN(startMs)) return;
    const ms = Number(e.duration_ms) || 0;
    const d = new Date(startMs); const key = d.getFullYear() + "-" + d.getMonth();
    consumedByMonthAll.set(key, (consumedByMonthAll.get(key) || 0) + ms);
    consumedTotalMs += ms;
  });

  // consumo mensile FILTRATO (per il grafico)
  const consumedByMonthView = new Map();
  entriesView.forEach(e => {
    const startMs = Number(e.start); if (isNaN(startMs)) return;
    const ms = Number(e.duration_ms) || 0;
    const d = new Date(startMs); const key = d.getFullYear() + "-" + d.getMonth();
    consumedByMonthView.set(key, (consumedByMonthView.get(key) || 0) + ms);
  });

  const months = monthList(rangeStart, now);
  const oreMs = pkg ? pkg.ore * HOUR_MS : 0;
  const annuale = pkg && pkg.periodo === "annuale";
  const startMonth = startDate ? startDate.getMonth() : 0;

  // Tabella "Per mese" (GLOBALE): maturato/consumato/saldo per mese
  const rows = [];
  let cumulMs = 0, accruedTotalMs = 0;
  months.forEach(({ year, month }) => {
    const consumedMs = consumedByMonthAll.get(year + "-" + month) || 0;
    let accruedMs = 0;
    if (hasPkg) accruedMs = annuale ? (month === startMonth ? oreMs : 0) : oreMs;
    accruedTotalMs += accruedMs;
    const saldoMese = accruedMs - consumedMs;
    cumulMs += saldoMese;
    rows.push({ year, month, accruedMs, consumedMs, saldoMese, cumulMs });
  });

  // Serie mensile per il GRAFICO (FILTRATA), allineata agli stessi mesi
  const chartRows = months.map(({ year, month }) => ({
    year, month, consumedMs: consumedByMonthView.get(year + "-" + month) || 0
  }));

  // Dettagli FILTRATI
  const taskById = new Map(tasksView.map(t => [t.id, t]));
  const taskRows = aggregateByTask(entriesView, taskById).rows;
  const userRows = aggregateByUser(entriesView);

  render(container, {
    pkg, startDate, hasPkg, rows, chartRows, taskRows, userRows,
    consumedTotalMs, accruedTotalMs,
    saldoMs: accruedTotalMs - consumedTotalMs,
    partial
  });
}
```

> Nota: rimuovi dal vecchio `loadHoursView` il blocco di calcolo (consumedByMonth, months, rows, aggregateByTask/User, render) — ora vive in `renderHoursFromCache`. Le variabili `loaded`, gli helper `parseDate`, `monthList`, `HOUR_MS`, e gli import restano.

- [ ] **Step 3: Aggiorna `render(container, m)` per usare `chartRows` nel grafico**

Nella funzione `render(container, m)`, estrai `chartRows` dal modello e passalo a `renderChart`. Cambia la destrutturazione iniziale:

```js
function render(container, m){
  const { pkg, startDate, hasPkg, rows, chartRows, taskRows, userRows, consumedTotalMs, accruedTotalMs, saldoMs, partial } = m;
```

e la chiamata al grafico (cerca `renderChart(rows, ...)`):

```js
  renderChart(chartRows, (hasPkg && pkg.periodo === "mensile") ? pkg.ore : null);
```

- [ ] **Step 4: Aggiungi una nota di trasparenza sul grafico filtrato**

Nel markup del grafico mensile dentro `render(container, m)`, dopo la riga del titolo `<h3>Ore consumate per mese</h3>`, la nota va mostrata solo quando una vista è attiva. Subito dopo la `</div>` che chiude la `.section-header` del grafico, aggiungi:

```js
  if (cfg_hasActiveView()) {
    html += '<p class="hours-note" style="margin:8px 16px 0;">Il grafico riflette la vista tag selezionata; il blocco pacchetto e la tab “Per mese” restano sull’intero progetto.</p>';
  }
```

e aggiungi in cima al file (sotto gli import) l'helper:

```js
// Vero se è attiva una vista tag diversa da "Tutti" (per le note di trasparenza).
function cfg_hasActiveView(){
  const cfg = state.clientConfig || {};
  return Array.isArray(cfg.tagViews) && cfg.tagViews.length > 0 && state.activeView !== "__all__";
}
```

- [ ] **Step 5: Aggiungi `hoursData` allo stato**

In `public/js/state.js`, dentro `state`, dopo `lastRenderInputs: null,` aggiungi:

```js
  // Cache dati del tab Consumo ore (tasks + entries del range): re-render al cambio vista senza fetch.
  hoursData: null,
```

- [ ] **Step 6: Verifica**

Verifica visiva nel Task 9. Controlla che `renderChart` riceva `chartRows` (filtrato) e che `rows` (globale) alimenti solo la tab "Per mese" e i totali pacchetto.

- [ ] **Step 7: Commit**

```bash
git add public/js/hours-package.js public/js/state.js
git commit -m "feat(hours): global package vs filtered consumption under tag views"
```

---

## Task 8: Esempio `tagViews` in configurazione (`config/clients.json`)

**Files:**
- Modify: `config/clients.json`

> I `tags` devono corrispondere a nomi reali di tag ClickUp del cliente, altrimenti la vista risulta vuota. Per la verifica (Task 9) usa nomi di tag che esistono davvero sulla lista del cliente di test.

- [ ] **Step 1: Aggiungi `tagViews` a un cliente**

In `config/clients.json`, aggiungi il campo `tagViews` al cliente di test (esempio su `pirelli` — **sostituisci i nomi tag con quelli reali della lista**):

```json
  "pirelli": {
    "name": "Pirelli.com",
    "listId": "901202068602",
    "tagViews": [
      { "label": "Frontend", "tags": ["frontend", "ui"] },
      { "label": "Bug", "tags": ["bug"] },
      { "label": "Backend", "tags": ["api", "db"] }
    ]
  },
```

- [ ] **Step 2: Verifica JSON valido**

Run: `node -e "JSON.parse(require('fs').readFileSync('config/clients.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add config/clients.json
git commit -m "chore(config): add example tagViews for a client"
```

---

## Task 9: Verifica end-to-end (locale, prima del deploy)

**Files:** nessuna modifica — verifica funzionale.

> Preferenza utente: anteprima locale con `vercel dev` + screenshot e approvazione **prima** di qualsiasi deploy. `vercel dev` ignora `.env.local`: assicurati che le variabili (`CLICKUP_PAT`, `CLICKUP_TEAM_ID`, segreti sessione) siano disponibili nell'ambiente come da prassi del progetto.

- [ ] **Step 1: Avvia l'app in locale**

Run: `vercel dev` (porta di default). Apri `/d/pirelli`, effettua il login.

- [ ] **Step 2: Tab Settimanale — selettore presente**

Verifica: la barra "Vista:" mostra `[Tutti] [Frontend] [Bug] [Backend]`. Screenshot.

- [ ] **Step 3: Tab Settimanale — filtro applicato a KPI+grafici+tabella**

Clicca "Bug". Verifica che KPI (Task aperti, ecc.), grafico stati, grafico ore e tabella riflettano **solo** i task con tag bug. Torna su "Tutti": compare l'unione di tutte le viste (i task senza tag configurati restano nascosti). Screenshot prima/dopo.

- [ ] **Step 4: Combinazione con toggle temporale**

Con "Bug" attivo, alterna "Solo settimana" / "Tutti" (toggle tabella): la tabella si restringe nel tempo mantenendo il filtro tag. Screenshot.

- [ ] **Step 5: Tab Consumo ore — globale vs filtrato**

Vai su "Consumo ore". Con una vista attiva (es. "Backend"): i KPI **Ore maturate/Saldo residuo** e la tab **"Per mese"** restano sui valori dell'intero progetto; il grafico mensile, "Per task" e "Per utente" mostrano solo i task della vista. Compare la nota di trasparenza. Su "Tutti" la nota sparisce. Screenshot.

- [ ] **Step 6: Sincronizzazione tra tab**

Imposta "Frontend" nel tab Settimanale, passa a "Consumo ore": la vista resta "Frontend". Cambiala in "Bug" qui, torna a "Settimanale": è "Bug". Screenshot.

- [ ] **Step 7: Persistenza**

Ricarica la pagina: la vista attiva è quella salvata. Screenshot.

- [ ] **Step 8: Retrocompatibilità**

Apri un cliente **senza** `tagViews` (es. `kiboko`): la barra "Vista:" non compare e il dashboard si comporta come prima. Screenshot.

- [ ] **Step 9: Presenta gli screenshot e chiedi approvazione per il deploy**

Mostra gli screenshot all'utente. Solo dopo l'OK procedi al deploy in produzione (`vercel --prod`, prod = pm.convery.io) — l'assistente non può fare push su GitHub.

---

## Self-Review

**Spec coverage:**
- Config `tagViews` per cliente → Task 2 (esposizione) + Task 8 (config) ✓
- Logica OR, viste con nome, "Tutti" = unione → Task 1 (`resolveTagSet`) ✓
- Una vista alla volta + "Tutti" → Task 6 (`buildViewSelector`/`setActiveView`) ✓
- Tab Settimanale: filtro a KPI+grafici+tabella → Task 4 (filtro alla sorgente) ✓
- Semantica "solo task taggati visibili" → `taskMatchesTags` con set non vuoto (Task 1) applicato in render (Task 4) ✓
- Retrocompatibilità (no `tagViews` → invariato) → `resolveTagSet([], ...) = Set vuoto` + barra nascosta (Task 1/5/6) ✓
- Re-render senza fetch → `state.lastRenderInputs` + `rerender()` (Task 4); `state.hoursData` + `rerenderHoursView()` (Task 7) ✓
- Consumo ore: pacchetto/saldo+"Per mese" globali, grafico+per task+per utente filtrati → Task 7 ✓
- Selettore condiviso/sincronizzato tra i tab → singolo `state.activeView` + barra unica (Task 5/6) ✓
- Persistenza per-cliente + fallback se vista assente → `viewStorageKey` + validazione in `buildViewSelector` (Task 1/6) ✓
- Edge case (task senza tag, vista vuota, label duplicate via indice) → Task 1 (indice come chiave) + messaggi vuoti esistenti ✓

**Placeholder scan:** nessun "TBD"/"TODO"; ogni step ha codice o comando concreto.

**Type/nome consistency:** `resolveTagSet(tagViews, activeView)`, `taskMatchesTags(task, tagSet)`, `viewStorageKey(slug)`, `rerender()`, `rerenderHoursView()`, `state.activeView`, `state.lastRenderInputs`, `state.hoursData`, modello hours con `chartRows` (filtrato) vs `rows` (globale) — usati coerentemente tra i task.

---

## Execution Handoff

(Vedi messaggio successivo per la scelta della modalità di esecuzione.)
