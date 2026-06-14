# Pacchetti ore multipli, stagionali e sub-task — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supportare più pacchetti ore per cliente (partizionati per tag), un nuovo periodo `stagionale` con finestra inizio→fine, e l'inclusione dei sub-task nei conteggi senza duplicazioni.

**Architecture:** Un unico modulo puro `public/js/packages.mjs` (testato con `node --test`) normalizza la config, risolve i tag effettivi (ereditati dal padre), marca i contenitori, assegna ogni task-foglia al primo pacchetto che matcha e calcola la maturazione per periodo. `hours-package.js`, `render.js`, `api/me.js`, `api.js` e `dashboard.js` consumano quel modulo.

**Tech Stack:** Vanilla JS (ES modules), Node.js test runner (`node --test`), Vercel serverless (CommonJS in `api/`), nessuna dipendenza esterna.

**Comando test:** `node --test test/*.test.mjs`

---

## File Structure

- **Create** `public/js/packages.mjs` — logica pura: normalizzazione config, tag effettivi, contenitori, assegnazione pacchetto, maturazione per periodo, storage key. Nessun DOM.
- **Create** `test/packages.test.mjs` — unit test del modulo sopra.
- **Modify** `config/clients.json` — migrazione `pacchettoOre`/`dataInizio` → `pacchettiOre` (array).
- **Modify** `config/clients.example.json` — esempi aggiornati (multi-pacchetto + stagionale).
- **Modify** `api/me.js` — esporre `pacchettiOre` normalizzato.
- **Modify** `public/js/api.js` — non scartare più i sub-task in `fetchTasks`.
- **Modify** `public/js/state.js` — nuovo campo `activePackage`.
- **Modify** `public/js/hours-package.js` — selettore pacchetto, rendering per pacchetto, header stagionale, bucket "Altro", "Per task" raggruppato per padre.
- **Modify** `public/js/render.js` — tab Settimanale: tag effettivi + foglie/contenitori.
- **Modify** `public/js/dashboard.js` — wiring selettore pacchetto + persistenza.

---

## Phase A — Modulo puro `packages.mjs` (TDD)

### Task A1: Normalizzazione tag e tag effettivi (ereditarietà dal padre)

**Files:**
- Create: `public/js/packages.mjs`
- Test: `test/packages.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// test/packages.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tasksById, effectiveTagNames, containerIds,
  normalizePackages, assignPackageIndex,
  accruedMsForMonth, inSeasonWindow, packageStorageKey
} from "../public/js/packages.mjs";

const HOUR_MS = 3600000;
const task = (id, tags, parent) => ({ id, parent: parent || null, tags: (tags||[]).map(name => ({ name })) });

test("effectiveTagNames: leaf inherits parent tags (union, normalized)", () => {
  const parent = task("p", ["Estate"]);
  const child  = task("c", ["urgente"], "p");
  const byId = tasksById([parent, child]);
  const names = effectiveTagNames(child, byId);
  assert.ok(names.has("estate"));   // ereditato dal padre
  assert.ok(names.has("urgente"));  // proprio
});

test("effectiveTagNames: task without parent uses own tags only", () => {
  const t = task("a", ["Bug"]);
  const byId = tasksById([t]);
  assert.deepEqual([...effectiveTagNames(t, byId)], ["bug"]);
});

test("effectiveTagNames: missing parent in map does not crash", () => {
  const child = task("c", ["x"], "ghost");
  const byId = tasksById([child]);
  assert.deepEqual([...effectiveTagNames(child, byId)], ["x"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/packages.test.mjs`
Expected: FAIL — `Cannot find module '../public/js/packages.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
// public/js/packages.mjs
// === Logica pura per i pacchetti ore (nessuna dipendenza DOM) ===
// Testabile con `node --test` e riusata da hours-package.js / render.js.

const HOUR_MS = 3600000;

// Normalizza un nome tag: stringa lowercase senza spazi ai bordi.
export function normalizeTag(name){
  return String(name == null ? "" : name).toLowerCase().trim();
}

// Map(id -> task) per lookup del padre.
export function tasksById(tasks){
  const m = new Map();
  (Array.isArray(tasks) ? tasks : []).forEach(t => { if (t && t.id != null) m.set(t.id, t); });
  return m;
}

// Nomi tag propri (normalizzati) di un task.
function ownTagNames(task){
  const tags = task && Array.isArray(task.tags) ? task.tags : [];
  return tags.map(t => normalizeTag(t && t.name)).filter(Boolean);
}

// Tag effettivi: propri ∪ tag del padre (i sub-task ereditano dal genitore).
export function effectiveTagNames(task, byId){
  const set = new Set(ownTagNames(task));
  const parentId = task && task.parent;
  if (parentId != null && byId && byId.has(parentId)) {
    ownTagNames(byId.get(parentId)).forEach(n => set.add(n));
  }
  return set;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/packages.test.mjs`
Expected: PASS (3 test).

- [ ] **Step 5: Commit**

```bash
git add public/js/packages.mjs test/packages.test.mjs
git commit -m "feat(packages): effectiveTagNames con ereditarietà dal padre"
```

---

### Task A2: Contenitori (padri con figli)

**Files:**
- Modify: `public/js/packages.mjs`
- Test: `test/packages.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
test("containerIds: returns ids that are parent of someone", () => {
  const parent = task("p", ["estate"]);
  const child  = task("c", [], "p");
  const solo   = task("s", ["bug"]);
  const ids = containerIds([parent, child, solo]);
  assert.ok(ids.has("p"));    // ha un figlio
  assert.ok(!ids.has("c"));   // è figlio, non contenitore
  assert.ok(!ids.has("s"));   // foglia indipendente
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/packages.test.mjs`
Expected: FAIL — `containerIds is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `public/js/packages.mjs`:

```js
// Set degli id che sono `parent` di almeno un altro task (= contenitori).
export function containerIds(tasks){
  const ids = new Set();
  (Array.isArray(tasks) ? tasks : []).forEach(t => {
    if (t && t.parent != null) ids.add(t.parent);
  });
  return ids;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/packages.test.mjs`
Expected: PASS (4 test).

- [ ] **Step 5: Commit**

```bash
git add public/js/packages.mjs test/packages.test.mjs
git commit -m "feat(packages): containerIds"
```

---

### Task A3: Normalizzazione pacchetti (array + legacy singolo)

**Files:**
- Modify: `public/js/packages.mjs`
- Test: `test/packages.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
test("normalizePackages: array pass-through con default", () => {
  const cfg = { pacchettiOre: [
    { label: "Estate", periodo: "stagionale", ore: 60, dataInizio: "2026-06-01", dataFine: "2026-09-30", tags: ["estate"] }
  ]};
  const pkgs = normalizePackages(cfg);
  assert.equal(pkgs.length, 1);
  assert.equal(pkgs[0].label, "Estate");
  assert.equal(pkgs[0].periodo, "stagionale");
  assert.deepEqual(pkgs[0].tags, ["estate"]);  // normalizzati
});

test("normalizePackages: legacy pacchettoOre singolo => array di uno", () => {
  const cfg = { pacchettoOre: { ore: 20, periodo: "annuale" }, dataInizio: "2026-01-01" };
  const pkgs = normalizePackages(cfg);
  assert.equal(pkgs.length, 1);
  assert.equal(pkgs[0].ore, 20);
  assert.equal(pkgs[0].periodo, "annuale");
  assert.equal(pkgs[0].dataInizio, "2026-01-01");  // ripreso dal livello cliente
  assert.deepEqual(pkgs[0].tags, []);              // legacy = nessun tag (cattura tutto)
});

test("normalizePackages: assente => array vuoto", () => {
  assert.deepEqual(normalizePackages({}), []);
  assert.deepEqual(normalizePackages(null), []);
});

test("normalizePackages: tags mancanti => array vuoto, label di default", () => {
  const pkgs = normalizePackages({ pacchettiOre: [ { ore: 10, periodo: "mensile", dataInizio: "2026-01-01" } ] });
  assert.deepEqual(pkgs[0].tags, []);
  assert.equal(pkgs[0].label, "Pacchetto 1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/packages.test.mjs`
Expected: FAIL — `normalizePackages is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `public/js/packages.mjs`:

```js
// Normalizza la config cliente in un array di pacchetti uniforme.
// Accetta `pacchettiOre` (array) oppure il legacy `pacchettoOre` (oggetto) +
// `dataInizio` a livello cliente. Restituisce [] se nessuno.
export function normalizePackages(cfg){
  const c = cfg || {};
  let raw = [];
  if (Array.isArray(c.pacchettiOre)) raw = c.pacchettiOre;
  else if (c.pacchettoOre && typeof c.pacchettoOre === "object") {
    raw = [Object.assign({ dataInizio: c.dataInizio }, c.pacchettoOre)];
  }
  return raw.map((p, i) => ({
    label: (p && p.label) || ("Pacchetto " + (i + 1)),
    ore: Number(p && p.ore) || 0,
    periodo: (p && p.periodo) || "mensile",
    dataInizio: (p && p.dataInizio) || null,
    dataFine: (p && p.dataFine) || null,
    tags: (p && Array.isArray(p.tags) ? p.tags : []).map(normalizeTag).filter(Boolean)
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/packages.test.mjs`
Expected: PASS (8 test).

- [ ] **Step 5: Commit**

```bash
git add public/js/packages.mjs test/packages.test.mjs
git commit -m "feat(packages): normalizePackages (array + legacy singolo)"
```

---

### Task A4: Assegnazione task → pacchetto (primo match, null = Altro)

**Files:**
- Modify: `public/js/packages.mjs`
- Test: `test/packages.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
const PKGS = normalizePackages({ pacchettiOre: [
  { label: "Estate",  periodo: "stagionale", ore: 60, dataInizio: "2026-06-01", dataFine: "2026-09-30", tags: ["estate"] },
  { label: "Inverno", periodo: "stagionale", ore: 80, dataInizio: "2026-12-01", dataFine: "2027-03-31", tags: ["inverno"] }
]});

test("assignPackageIndex: primo pacchetto che matcha vince", () => {
  const t = task("a", ["estate"]);
  const byId = tasksById([t]);
  assert.equal(assignPackageIndex(t, PKGS, byId), 0);
});

test("assignPackageIndex: match multiplo => primo in ordine config", () => {
  const t = task("a", ["inverno", "estate"]);
  const byId = tasksById([t]);
  assert.equal(assignPackageIndex(t, PKGS, byId), 0); // Estate è prima
});

test("assignPackageIndex: nessun match => null (Altro)", () => {
  const t = task("a", ["altro"]);
  assert.equal(assignPackageIndex(t, PKGS, tasksById([t])), null);
});

test("assignPackageIndex: sub-task eredita tag del padre", () => {
  const parent = task("p", ["inverno"]);
  const child  = task("c", [], "p");
  const byId = tasksById([parent, child]);
  assert.equal(assignPackageIndex(child, PKGS, byId), 1); // Inverno via padre
});

test("assignPackageIndex: pacchetto con tags vuoto cattura i non assegnati", () => {
  const pkgs = normalizePackages({ pacchettiOre: [
    { label: "Assistenza", periodo: "mensile", ore: 20, dataInizio: "2026-01-01", tags: ["assistenza"] },
    { label: "Generico",   periodo: "mensile", ore: 10, dataInizio: "2026-01-01", tags: [] }
  ]});
  const t = task("a", ["qualsiasi"]);
  assert.equal(assignPackageIndex(t, pkgs, tasksById([t])), 1); // catch-all
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/packages.test.mjs`
Expected: FAIL — `assignPackageIndex is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `public/js/packages.mjs`:

```js
// Indice del primo pacchetto i cui tag matchano i tag effettivi del task.
// Un pacchetto con tags vuoto fa da catch-all (matcha qualsiasi task).
// Nessun match => null (bucket "Altro").
export function assignPackageIndex(task, packages, byId){
  const names = effectiveTagNames(task, byId);
  for (let i = 0; i < packages.length; i++) {
    const tags = packages[i].tags;
    if (tags.length === 0) return i;                 // catch-all
    for (const tag of tags) if (names.has(tag)) return i;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/packages.test.mjs`
Expected: PASS (13 test).

- [ ] **Step 5: Commit**

```bash
git add public/js/packages.mjs test/packages.test.mjs
git commit -m "feat(packages): assignPackageIndex (primo match, catch-all, Altro)"
```

---

### Task A5: Maturazione per periodo + finestra stagionale + storage key

**Files:**
- Modify: `public/js/packages.mjs`
- Test: `test/packages.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
const parseDate = (s) => { const [y,m,d] = s.split("-").map(Number); return new Date(y, m-1, d); };

test("accruedMsForMonth: mensile accredita ogni mese", () => {
  const p = normalizePackages({ pacchettiOre:[{ periodo:"mensile", ore:20, dataInizio:"2026-01-01", tags:[] }] })[0];
  const sd = parseDate(p.dataInizio);
  assert.equal(accruedMsForMonth(p, 2026, 0, sd), 20*HOUR_MS); // gennaio
  assert.equal(accruedMsForMonth(p, 2026, 5, sd), 20*HOUR_MS); // giugno
});

test("accruedMsForMonth: annuale accredita solo nel mese di inizio", () => {
  const p = normalizePackages({ pacchettiOre:[{ periodo:"annuale", ore:120, dataInizio:"2026-03-01", tags:[] }] })[0];
  const sd = parseDate(p.dataInizio);
  assert.equal(accruedMsForMonth(p, 2026, 2, sd), 120*HOUR_MS); // marzo (mese inizio)
  assert.equal(accruedMsForMonth(p, 2026, 4, sd), 0);           // maggio
});

test("accruedMsForMonth: stagionale accredita solo nel mese di inizio", () => {
  const p = normalizePackages({ pacchettiOre:[{ periodo:"stagionale", ore:60, dataInizio:"2026-06-01", dataFine:"2026-09-30", tags:[] }] })[0];
  const sd = parseDate(p.dataInizio);
  assert.equal(accruedMsForMonth(p, 2026, 5, sd), 60*HOUR_MS); // giugno
  assert.equal(accruedMsForMonth(p, 2026, 7, sd), 0);          // agosto
});

test("inSeasonWindow: vero solo dentro inizio→fine per stagionale", () => {
  const p = normalizePackages({ pacchettiOre:[{ periodo:"stagionale", ore:60, dataInizio:"2026-06-01", dataFine:"2026-09-30", tags:[] }] })[0];
  assert.equal(inSeasonWindow(p, parseDate("2026-07-15")), true);
  assert.equal(inSeasonWindow(p, parseDate("2026-10-01")), false);
  assert.equal(inSeasonWindow(p, parseDate("2026-05-31")), false);
});

test("inSeasonWindow: non stagionale => sempre vero", () => {
  const p = normalizePackages({ pacchettiOre:[{ periodo:"mensile", ore:20, dataInizio:"2026-01-01", tags:[] }] })[0];
  assert.equal(inSeasonWindow(p, parseDate("2030-01-01")), true);
});

test("packageStorageKey is slug-scoped", () => {
  assert.equal(packageStorageKey("acme"), "pirelli-weekly:active-package:acme");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/packages.test.mjs`
Expected: FAIL — `accruedMsForMonth is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `public/js/packages.mjs`:

```js
// Ms maturati nel mese (year, month 0-based) per il pacchetto, dato startDate (Date).
// - mensile:    `ore` ogni mese (da dataInizio in poi, gestito dal chiamante sui mesi mostrati)
// - annuale:    `ore` solo nel mese di dataInizio
// - stagionale: `ore` solo nel mese di dataInizio (finestra chiusa gestita da inSeasonWindow)
export function accruedMsForMonth(pkg, year, month, startDate){
  if (!pkg || !startDate) return 0;
  const oreMs = (Number(pkg.ore) || 0) * HOUR_MS;
  if (pkg.periodo === "annuale" || pkg.periodo === "stagionale") {
    return (year === startDate.getFullYear() && month === startDate.getMonth()) ? oreMs : 0;
  }
  return oreMs; // mensile
}

// Vero se `date` rientra nella finestra del pacchetto. Per i non-stagionali è
// sempre vero (nessuna finestra di chiusura).
export function inSeasonWindow(pkg, date){
  if (!pkg || pkg.periodo !== "stagionale") return true;
  if (!pkg.dataInizio || !pkg.dataFine) return true;
  const [ys, ms, ds] = pkg.dataInizio.split("-").map(Number);
  const [ye, me, de] = pkg.dataFine.split("-").map(Number);
  const start = new Date(ys, ms - 1, ds).getTime();
  const end = new Date(ye, me - 1, de, 23, 59, 59, 999).getTime();
  const t = date.getTime();
  return t >= start && t <= end;
}

// Chiave localStorage per il pacchetto attivo. Stesso namespace legacy delle altre chiavi.
export function packageStorageKey(slug){
  return "pirelli-weekly:active-package:" + (slug || "");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/packages.test.mjs`
Expected: PASS (19 test).

- [ ] **Step 5: Commit**

```bash
git add public/js/packages.mjs test/packages.test.mjs
git commit -m "feat(packages): maturazione per periodo, finestra stagionale, storage key"
```

---

## Phase B — Config + API

### Task B1: Migrare `config/clients.json` a `pacchettiOre`

**Files:**
- Modify: `config/clients.json`

- [ ] **Step 1: Riscrivere il file**

Trasforma `pacchettoOre` + `dataInizio` in `pacchettiOre` (array di uno) per `kiboko` e `dss`. `dss` mantiene anche `tagViews`. Risultato:

```json
{
  "pirelli": {
    "name": "Pirelli.com",
    "listId": "901202068602"
  },
  "kiboko": {
    "name": "Kiboko",
    "listId": "901216775998",
    "pacchettiOre": [
      { "label": "Pacchetto ore", "periodo": "annuale", "ore": 20, "dataInizio": "2026-01-01", "tags": [] }
    ]
  },
  "dss": {
    "name": "dss",
    "listId": "901216775998",
    "pacchettiOre": [
      { "label": "Pacchetto ore", "periodo": "annuale", "ore": 20, "dataInizio": "2026-01-01", "tags": [] }
    ],
    "tagViews": [
      { "label": "Assistenza", "tags": ["frontend", "ui"] }
    ]
  }
}
```

- [ ] **Step 2: Validare il JSON**

Run: `node -e "require('./config/clients.json'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add config/clients.json
git commit -m "chore(config): migra pacchettoOre -> pacchettiOre array"
```

---

### Task B2: Aggiornare `config/clients.example.json`

**Files:**
- Modify: `config/clients.example.json`

- [ ] **Step 1: Riscrivere con esempi multi-pacchetto e stagionale**

```json
{
  "_comment": "File di esempio. Copia in clients.json e personalizza. Ogni chiave e' lo slug del cliente. 'periodo' ammette: mensile | annuale | stagionale (stagionale richiede dataInizio e dataFine).",

  "clienteMinimo": {
    "name": "Nome Cliente",
    "listId": "901200000000"
  },

  "clienteConPacchetto": {
    "name": "Nome Cliente",
    "listId": "901200000000",
    "pacchettiOre": [
      { "label": "Pacchetto ore", "periodo": "annuale", "ore": 20, "dataInizio": "2026-01-01", "tags": [] }
    ]
  },

  "clienteTurismo": {
    "name": "Hotel Mare",
    "listId": "901200000000",
    "pacchettiOre": [
      { "label": "Estate",  "periodo": "stagionale", "ore": 60, "dataInizio": "2026-06-01", "dataFine": "2026-09-30", "tags": ["estate"] },
      { "label": "Inverno", "periodo": "stagionale", "ore": 80, "dataInizio": "2026-12-01", "dataFine": "2027-03-31", "tags": ["inverno"] },
      { "label": "Continuativo", "periodo": "mensile", "ore": 20, "dataInizio": "2026-01-01", "tags": ["assistenza"] }
    ],
    "tagViews": [
      { "label": "Sviluppo", "tags": ["backend", "api"] }
    ]
  }
}
```

- [ ] **Step 2: Validare il JSON**

Run: `node -e "require('./config/clients.example.json'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add config/clients.example.json
git commit -m "docs(config): esempio multi-pacchetto e stagionale"
```

---

### Task B3: Esporre `pacchettiOre` da `api/me.js`

**Files:**
- Modify: `api/me.js:16-22`

- [ ] **Step 1: Aggiornare la funzione `pub`**

`api/me.js` è CommonJS e non può importare l'ES module `packages.mjs`; la normalizzazione qui è inline e semplice (la logica ricca resta client-side). Sostituire il blocco `pub` con:

```js
  // Campi pubblici per il client. Normalizza pacchettoOre legacy in pacchettiOre array.
  const normPkgs = (c) => {
    if (Array.isArray(c.pacchettiOre)) return c.pacchettiOre;
    if (c.pacchettoOre && typeof c.pacchettoOre === 'object') {
      return [Object.assign({ dataInizio: c.dataInizio || null }, c.pacchettoOre)];
    }
    return null;
  };
  const pub = (slug, c) => ({
    slug,
    name: c.name,
    pacchettiOre: normPkgs(c),
    tagViews: Array.isArray(c.tagViews) ? c.tagViews : null
  });
```

- [ ] **Step 2: Smoke test del modulo**

Run: `node -e "const m=require('./api/me.js'); console.log(typeof m)"`
Expected: `function` (nessun errore di sintassi).

- [ ] **Step 3: Commit**

```bash
git add api/me.js
git commit -m "feat(api): me.js espone pacchettiOre normalizzato"
```

---

## Phase C — Sub-task nel data layer

### Task C1: Non scartare più i sub-task in `fetchTasks`

**Files:**
- Modify: `public/js/api.js` (~righe 168-200, i due punti con `if (t.parent != null) { subtaskFiltered++; return; }`)

- [ ] **Step 1: Rimuovere il filtro subtask in entrambi i rami (paginato + fallback)**

In `public/js/api.js`, nel loop di pagina principale, sostituire:

```js
      // filtro difensivo subtask: ClickUp imposta parent != null sulle sotto-task
      if (t.parent != null) { subtaskFiltered++; return; }
```

con:

```js
      // I sub-task vengono ora inclusi (pattern padre+sotto-attività). La
      // distinzione foglia/contenitore è gestita a valle in packages.mjs.
```

E identicamente nel ramo di fallback (la riga `if (t.parent != null) { subtaskFiltered++; return; }` dentro il blocco fallback). Lasciare invariato `healthEntry.subtaskFiltered = subtaskFiltered;` (ora resterà 0).

- [ ] **Step 2: Verifica sintattica**

Run: `node --check public/js/api.js`
Expected: nessun output (OK).

- [ ] **Step 3: Commit**

```bash
git add public/js/api.js
git commit -m "feat(api): includi i sub-task in fetchTasks"
```

---

## Phase D — Tab "Consumo ore" multi-pacchetto

### Task D1: Stato `activePackage`

**Files:**
- Modify: `public/js/state.js:30` (vicino a `activeView`)

- [ ] **Step 1: Aggiungere il campo allo `state`**

Dopo la riga `activeView: "__all__",` aggiungere:

```js
  // Pacchetto attivo nel tab "Consumo ore": indice (in stringa) di pacchettiOre,
  // oppure "__altro__" per il bucket non assegnato. Validato in dashboard.js.
  activePackage: "0",
```

- [ ] **Step 2: Verifica sintattica**

Run: `node --check public/js/state.js`
Expected: OK.

- [ ] **Step 3: Commit**

```bash
git add public/js/state.js
git commit -m "feat(state): activePackage per il tab Consumo ore"
```

---

### Task D2: Calcolo per-pacchetto in `renderHoursFromCache`

**Files:**
- Modify: `public/js/hours-package.js:107-164` (funzione `renderHoursFromCache`) e import in cima.

**Contesto:** oggi la funzione filtra per `tagViews`. La riscriviamo per: (a) costruire `byId`, contenitori e assegnazione pacchetto una volta; (b) selezionare il pacchetto attivo; (c) calcolare KPI/righe/grafico/dettagli solo per i task di quel pacchetto (foglie). I padri-contenitore non entrano nei conteggi.

- [ ] **Step 1: Aggiornare gli import in cima al file**

Sostituire la riga:

```js
import { resolveTagSet, taskMatchesTags } from "./tag-views.mjs";
```

con:

```js
import {
  tasksById, containerIds, normalizePackages, assignPackageIndex,
  accruedMsForMonth, inSeasonWindow, packageStorageKey
} from "./packages.mjs";
```

- [ ] **Step 2: Riscrivere `renderHoursFromCache`**

Sostituire l'intera funzione `renderHoursFromCache` (righe 108-164) con:

```js
// Calcola il modello del pacchetto selezionato e renderizza.
function renderHoursFromCache(){
  const container = document.getElementById("viewHours");
  const { tasks, entries, rangeStart, now, partial } = state.hoursData;
  const cfg = state.clientConfig || {};

  const packages = normalizePackages(cfg);
  const byId = tasksById(tasks);
  const containers = containerIds(tasks);

  // Solo le foglie contano come item; assegna ciascuna a un pacchetto (o "Altro").
  const leaves = tasks.filter(t => !containers.has(t.id));
  const assignment = new Map(); // taskId -> indice pacchetto | null
  leaves.forEach(t => assignment.set(t.id, packages.length ? assignPackageIndex(t, packages, byId) : 0));

  // Pacchetto attivo: indice valido | "__altro__".
  const active = state.activePackage;
  const isAltro = active === "__altro__";
  const activeIdx = isAltro ? null : Math.max(0, Math.min(packages.length - 1, Number(active) || 0));
  const pkg = (!isAltro && packages.length) ? packages[activeIdx] : null;
  const startDate = pkg ? parseDate(pkg.dataInizio) : null;
  const hasPkg = !!pkg && !!startDate;

  // Task del pacchetto attivo (foglie assegnate a questo indice, o non assegnate se "Altro").
  const wanted = isAltro ? null : activeIdx;
  const tasksView = leaves.filter(t => assignment.get(t.id) === wanted);
  const idsView = new Set(tasksView.map(t => t.id));
  const entriesView = entries.filter(e => e && e.task && idsView.has(e.task.id));

  // Mesi: per stagionale limitati alla finestra; altrimenti dal range dati.
  let months = monthList(hasPkg ? startDate : rangeStart, now);
  if (hasPkg && pkg.periodo === "stagionale") {
    months = months.filter(({ year, month }) => inSeasonWindow(pkg, new Date(year, month, 15)));
  }

  // Consumo per mese del pacchetto attivo (entro la finestra per lo stagionale).
  const { byMonth: consumedByMonth, totalMs: consumedRawMs } = aggregateByMonth(
    (hasPkg && pkg.periodo === "stagionale")
      ? entriesView.filter(e => inSeasonWindow(pkg, new Date(Number(e.start))))
      : entriesView
  );

  const rows = [];
  let cumulMs = 0, accruedTotalMs = 0, consumedTotalMs = 0;
  months.forEach(({ year, month }) => {
    const consumedMs = consumedByMonth.get(year + "-" + month) || 0;
    const accruedMs = hasPkg ? accruedMsForMonth(pkg, year, month, startDate) : 0;
    accruedTotalMs += accruedMs;
    consumedTotalMs += consumedMs;
    const saldoMese = accruedMs - consumedMs;
    cumulMs += saldoMese;
    rows.push({ year, month, accruedMs, consumedMs, saldoMese, cumulMs });
  });

  const chartRows = months.map(({ year, month }) => ({
    year, month, consumedMs: consumedByMonth.get(year + "-" + month) || 0
  }));

  // Dettagli "Per task": raggruppati per padre (il padre fa da intestazione, non somma).
  const taskById = new Map(tasksView.map(t => [t.id, t]));
  const taskRows = aggregateByTask(entriesView, taskById).rows.map(r => {
    const t = taskById.get(r.id);
    const parent = t && t.parent != null ? byId.get(t.parent) : null;
    return Object.assign({}, r, { parentName: parent ? parent.name : null });
  });
  const userRows = aggregateByUser(entriesView);

  render(container, {
    pkg, startDate, hasPkg, isAltro, packages, activePackage: active,
    hasAltro: [...assignment.values()].some(v => v === null) && packages.length > 0,
    rows, chartRows, taskRows, userRows,
    consumedTotalMs, accruedTotalMs,
    saldoMs: accruedTotalMs - consumedTotalMs,
    partial
  });
}
```

- [ ] **Step 3: Verifica sintattica**

Run: `node --check public/js/hours-package.js`
Expected: OK (il `render` userà i nuovi campi nel Task D3; per ora basta che non ci siano errori di sintassi).

- [ ] **Step 4: Commit**

```bash
git add public/js/hours-package.js
git commit -m "feat(hours): calcolo per-pacchetto (partizione, stagionale, Altro)"
```

---

### Task D3: Selettore pacchetto + header stagionale nel `render`

**Files:**
- Modify: `public/js/hours-package.js` — funzione `render` (righe 253-327) e `hasActiveView` (righe 20-23, ora obsoleta).

- [ ] **Step 1: Rimuovere `hasActiveView` e la nota vista-tag**

Eliminare la funzione `hasActiveView` (righe 20-23). Nella `render`, eliminare il blocco:

```js
  if (hasActiveView()) {
    html += '<p class="hours-note" style="margin:8px 16px 0;">Il grafico riflette la vista tag selezionata; il blocco pacchetto e la tab "Per mese" restano sull\'intero progetto.</p>';
  }
```

- [ ] **Step 2: Aggiungere il selettore pacchetto e l'header**

In `render`, sostituire il blocco header (righe 257-265, da `html += '<div class="hours-head">` fino a `html += '</div>';`) con:

```js
  const { isAltro, packages, activePackage, hasAltro } = m;

  // Selettore pacchetto: mostrato se >1 pacchetto o se esiste il bucket "Altro".
  if ((packages && packages.length > 1) || hasAltro) {
    html += '<div class="filter-toggle package-selector" role="tablist" aria-label="Pacchetto ore">';
    packages.forEach((p, i) => {
      const on = !isAltro && String(i) === String(activePackage);
      html += '<button class="pkg-tab' + (on ? ' active' : '') + '" data-package="' + i +
        '" role="tab" aria-selected="' + on + '" type="button">' + escapeHtml(p.label) + '</button>';
    });
    if (hasAltro) {
      const on = isAltro;
      html += '<button class="pkg-tab' + (on ? ' active' : '') + '" data-package="__altro__" role="tab" aria-selected="' + on + '" type="button">Altro</button>';
    }
    html += '</div>';
  }

  html += '<div class="hours-head"><h3>Consumo pacchetto ore</h3>';
  if (hasPkg) {
    let sub = fmtNum(pkg.ore) + 'h ';
    if (pkg.periodo === "stagionale") {
      const ds = startDate, de = parseDate(pkg.dataFine);
      sub += 'stagionali · ' + fmtDayMonthYear(ds) + ' – ' + (de ? fmtDayMonthYear(de) : '?');
    } else {
      sub += (pkg.periodo === "annuale" ? "annuali" : "mensili") +
        ' · dal ' + fmtMonthYear(startDate.getMonth(), startDate.getFullYear());
    }
    html += '<span class="hours-sub">' + escapeHtml(sub) + '</span>';
  } else if (isAltro) {
    html += '<span class="hours-sub">Task non assegnati a un pacchetto — solo consumo</span>';
  } else {
    html += '<span class="hours-sub">Nessun pacchetto configurato — mostro solo le ore consumate per mese</span>';
  }
  html += '</div>';
```

- [ ] **Step 3: Aggiungere il formatter `fmtDayMonthYear`**

Dopo `fmtMonthYear` (riga 35), aggiungere:

```js
function fmtDayMonthYear(d){
  if (!d) return "?";
  return d.getDate() + " " + MONTHS[d.getMonth()].slice(0,3).toLowerCase() + " " + d.getFullYear();
}
```

- [ ] **Step 4: Collegare i click del selettore**

In `render`, in fondo (dopo `setupDetailTabs(...)`, prima della chiusura della funzione), aggiungere:

```js
  container.querySelectorAll(".package-selector .pkg-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      state.activePackage = btn.dataset.package;
      try { window.localStorage && window.localStorage.setItem(
        packageStorageKey(state.clientConfig && state.clientConfig.slug),
        state.activePackage); } catch (e) {}
      renderHoursFromCache();
    });
  });
```

- [ ] **Step 5: Verifica sintattica**

Run: `node --check public/js/hours-package.js`
Expected: OK.

- [ ] **Step 6: Commit**

```bash
git add public/js/hours-package.js
git commit -m "feat(hours): selettore pacchetto, header stagionale, bucket Altro"
```

---

### Task D4: "Per task" raggruppato per padre

**Files:**
- Modify: `public/js/hours-package.js` — `taskTableHtml` (righe 199-227).

- [ ] **Step 1: Mostrare il nome del padre come riga-gruppo**

In `taskTableHtml`, dentro `rows.forEach(r => { ... })`, prima di costruire la riga del task, inserire un'intestazione quando cambia il padre. Sostituire l'inizio del forEach:

```js
    rows.forEach(r => {
```

con:

```js
    let lastParent = " ";
    rows.forEach(r => {
      if ((r.parentName || "") !== lastParent) {
        lastParent = r.parentName || "";
        if (r.parentName) {
          h += '<tr class="task-group"><td colspan="5"><strong>' + escapeHtml(r.parentName) + '</strong></td></tr>';
        }
      }
```

(Il resto della riga task resta invariato; le ore del padre non vengono sommate perché il padre-contenitore non è tra le `rows`.)

- [ ] **Step 2: Verifica sintattica**

Run: `node --check public/js/hours-package.js`
Expected: OK.

- [ ] **Step 3: Commit**

```bash
git add public/js/hours-package.js
git commit -m "feat(hours): Per task raggruppato per task padre"
```

---

## Phase E — Tab "Settimanale": tag effettivi + foglie

### Task E1: Foglie e tag effettivi in `render()`

**Files:**
- Modify: `public/js/render.js:6` (import), `:111-126` (filtro).

- [ ] **Step 1: Aggiornare gli import**

Sostituire la riga 6:

```js
import { resolveTagSet, taskMatchesTags } from "./tag-views.mjs";
```

con:

```js
import { resolveTagSet, taskMatchesTags } from "./tag-views.mjs";
import { tasksById, containerIds, effectiveTagNames } from "./packages.mjs";
```

- [ ] **Step 2: Filtrare contenitori + usare tag effettivi**

Sostituire il blocco filtro (righe 117-127, da `export function render(` fino a `const taskIdSet = new Set(allTasks.map(t => t.id));`) con:

```js
export function render(allTasks, entries, estimates, closedThisWeek, mon, sun){
  // Salva gli input NON filtrati: il cambio vista re-renderizza ri-filtrando questi.
  state.lastRenderInputs = { allTasks, entries, estimates, closedThisWeek, mon, sun };

  // Sub-task: escludo i padri-contenitore (diventano gruppi), conto le foglie.
  const byId = tasksById(allTasks);
  const containers = containerIds(allTasks);
  allTasks = allTasks.filter(t => !containers.has(t.id));
  closedThisWeek = (Array.isArray(closedThisWeek) ? closedThisWeek : []).filter(t => !containers.has(t.id));

  // Filtro "alla sorgente": vista tag su tag EFFETTIVI (foglia eredita dal padre).
  const tagSet = activeTagSet();
  const matches = (t) => {
    if (!tagSet || tagSet.size === 0) return true;
    const names = effectiveTagNames(t, byId);
    for (const tag of tagSet) if (names.has(tag)) return true;
    return false;
  };
  allTasks = allTasks.filter(matches);
  closedThisWeek = closedThisWeek.filter(matches);

  const taskIdSet = new Set(allTasks.map(t => t.id));
```

(Nota: `taskMatchesTags` resta importato perché potrebbe essere usato altrove nel file; se non lo è, lasciare comunque l'import non causa errori.)

- [ ] **Step 3: Verifica sintattica**

Run: `node --check public/js/render.js`
Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add public/js/render.js
git commit -m "feat(weekly): conta le foglie, tag effettivi ereditati dal padre"
```

---

## Phase F — Wiring del selettore pacchetto

### Task F1: Inizializzare `activePackage` da config + localStorage

**Files:**
- Modify: `public/js/dashboard.js` — import (riga 10) e `bootstrap` (dopo riga 214, `state.clientConfig = allowed;`).

- [ ] **Step 1: Importare `normalizePackages` e `packageStorageKey`**

Sostituire la riga 10:

```js
import { viewStorageKey } from "./tag-views.mjs";
```

con:

```js
import { viewStorageKey } from "./tag-views.mjs";
import { normalizePackages, packageStorageKey } from "./packages.mjs";
```

- [ ] **Step 2: Validare/ripristinare il pacchetto attivo**

Dopo la riga `state.clientConfig = allowed;` (riga 214) aggiungere:

```js
    // Pacchetto attivo: ripristina da localStorage, valida contro la config.
    const pkgs = normalizePackages(allowed);
    let savedPkg = "0";
    try {
      const v = window.localStorage && window.localStorage.getItem(packageStorageKey(SLUG));
      if (v === "__altro__") savedPkg = "__altro__";
      else { const idx = Number(v); if (Number.isInteger(idx) && idx >= 0 && idx < pkgs.length) savedPkg = String(idx); }
    } catch (e) { /* ignoro */ }
    state.activePackage = savedPkg;
```

- [ ] **Step 3: Verifica sintattica**

Run: `node --check public/js/dashboard.js`
Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add public/js/dashboard.js
git commit -m "feat(dashboard): ripristina activePackage da config/localStorage"
```

---

## Phase G — Stili e verifica finale

### Task G1: Stili minimi per selettore pacchetto e gruppo task

**Files:**
- Modify: `public/css/dashboard.css` (in coda).

- [ ] **Step 1: Aggiungere regole CSS**

Riusa lo stile dei toggle esistenti. Aggiungere in coda a `public/css/dashboard.css`:

```css
/* Selettore pacchetto ore (riusa il look dei filter-toggle) */
.package-selector { margin: 0 0 12px; flex-wrap: wrap; }
.package-selector .pkg-tab { cursor: pointer; }
/* Riga-gruppo "Per task" (nome del task padre) */
tr.task-group td { background: rgba(0,0,0,0.03); font-size: 12px; color: var(--text-muted); padding-top: 10px; }
```

- [ ] **Step 2: Commit**

```bash
git add public/css/dashboard.css
git commit -m "style(hours): selettore pacchetto e riga-gruppo per task"
```

---

### Task G2: Suite test completa

- [ ] **Step 1: Eseguire tutti i test**

Run: `node --test test/*.test.mjs`
Expected: tutti PASS (`tag-views` 14 + `packages` 19 = 33), `fail 0`.

- [ ] **Step 2: Verifica sintattica di tutti i moduli toccati**

Run: `for f in public/js/packages.mjs public/js/hours-package.js public/js/render.js public/js/dashboard.js public/js/api.js public/js/state.js; do node --check "$f" && echo "OK $f"; done`
Expected: `OK` per ciascuno.

---

### Task G3: Verifica locale con `vercel dev` + screenshot

- [ ] **Step 1: Avviare il dev server**

Run: `vercel dev` (porta locale). Login come admin.

- [ ] **Step 2: Verificare i casi** (screenshot per ciascuno, mostrare all'utente prima del deploy):
  - Cliente con `pacchettiOre` multipli → selettore pacchetto, switch tra pacchetti coerente (KPI/grafico/dettagli del pacchetto attivo).
  - Pacchetto `stagionale` → header con `inizio – fine`, mesi limitati alla finestra, accredito unico a inizio.
  - Bucket "Altro" presente se ci sono task non assegnati; mostra solo consumo.
  - Pattern padre+sub-task → "Per task" raggruppa i figli sotto il padre; numeri non duplicati.
  - Tab Settimanale: foglie contate, padri come gruppi; vista tag funziona con tag ereditati.
  - Cliente legacy (`kiboko`) → pacchetto unico, comportamento invariato.
  - Persistenza pacchetto attivo su reload; fallback se sparisce dalla config.

- [ ] **Step 3:** Ottenere approvazione utente, poi deploy con `vercel --prod` (NON prima dell'ok).

---

## Note di esecuzione

- Ordine consigliato: A → B → C → D → E → F → G. Le fasi A/B/C sono indipendenti e non cambiano l'UI visibile finché D non aggancia il rendering.
- `api/me.js` è CommonJS: non importa `packages.mjs` (ES module). La normalizzazione lì è una copia inline volutamente semplice.
- Le `tagViews` continuano a vivere e a filtrare il tab Settimanale; nel tab Consumo ore il selettore pacchetto le sostituisce (non si renderizza più la nota vista-tag lì).
