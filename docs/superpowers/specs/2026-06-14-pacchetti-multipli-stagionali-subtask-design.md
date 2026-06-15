# Pacchetti ore multipli, periodo stagionale e sub-task

**Data:** 2026-06-14
**Stato:** Design approvato

## Obiettivo

Estendere il tab "Consumo ore" con tre capacità, pensate per clienti del turismo
e per chi organizza il lavoro a task padre + sotto-attività:

1. **Periodo stagionale** — un pacchetto ore valido in una finestra chiusa
   (`dataInizio` → `dataFine`), per differenziare es. estate e inverno.
2. **Pacchetti ore multipli in contemporanea** — più pacchetti per lo stesso
   cliente, con i task partizionati tra i pacchetti tramite i tag ClickUp.
3. **Sub-task** — includere le sotto-attività nei conteggi (oggi vengono
   scartate), senza duplicazioni logiche.

## Decisioni di design (sintesi)

| Tema | Decisione |
|------|-----------|
| Relazione pacchetti ↔ `tagViews` | Indipendenti: ogni pacchetto ha i propri `tags`; le `tagViews` restano filtro di visualizzazione separato |
| Task che matcha più pacchetti | Vince il **primo** pacchetto in ordine di config |
| Task che non matcha alcun pacchetto | Bucket **"Altro"**: solo consumo, nessun monte ore |
| Maturazione stagionale | Accredito **unico** nel mese di `dataInizio`, finestra **chiusa** fino a `dataFine` |
| Forma config | Migrazione a `pacchettiOre` (array); ogni elemento ha `dataInizio` propria |
| UI multi-pacchetto | **Selettore**, un pacchetto alla volta |
| `tagViews` nel tab Consumo ore | In modalità multi-pacchetto il selettore pacchetto **sostituisce** il selettore vista qui; le `tagViews` continuano a filtrare il tab Settimanale |
| Tag nel pattern padre+figli | Tag sul **padre**, ore sui **sub-task**; i figli ereditano il pacchetto del genitore |
| Ambito sub-task | **Ovunque** (Settimanale + Consumo ore), senza duplicare i conteggi |
| Padre-contenitore | È un **raggruppamento**, non conta come item; i conteggi usano le foglie |

## Contesto tecnico rilevante

- `fetchTasks()` (`public/js/api.js`) oggi **scarta** le sotto-attività
  (`if (t.parent != null) return`, ~riga 172). Vanno reincluse.
- Le ore si calcolano dalle **time-entry atomiche** (endpoint
  `time-entries`), ognuna legata a uno specifico task/sub-task: sommare le
  entry di padre e figli non duplica. Non si usa il campo "tempo totale" del
  task (che in ClickUp può essere un rollup dei figli).
- `api/me.js` espone al client `pacchettoOre`, `dataInizio`, `tagViews`. Il
  `listId` resta server-side.
- `hours-package.js` calcola un modello a saldo cumulativo (maturato per mese −
  consumato) e renderizza KPI + grafico + dettagli (Per mese / Per task / Per
  utente). Oggi tutto deriva da un singolo `pacchettoOre`.
- `tag-views.mjs` è la logica pura (testata in `test/tag-views.test.mjs`) per il
  match per tag: pattern di riferimento per il nuovo modulo pacchetti.

## Architettura: arricchimento unico dei task

Un solo **passaggio di arricchimento** al caricamento produce una lista di task
normalizzata; tutti i consumatori (KPI, grafici, tabelle, pacchetti) leggono da
lì. Evita di duplicare in ogni consumatore la logica di ereditarietà tag,
partizione pacchetti ed esclusione contenitori.

*Scartato:* calcolo ad-hoc in ogni consumatore → logica duplicata e divergente.

### Nuovo modulo `public/js/packages.mjs` (logica pura, testabile)

Funzioni previste (nomi indicativi):

- `effectiveTags(task, tasksById)` → `Set<string>` = tag propri ∪ tag del padre
  (normalizzati come in `tag-views.mjs`).
- `containerIds(tasks)` → `Set<string>` degli id che compaiono come `parent` di
  almeno un altro task.
- `normalizePackages(cfg)` → array normalizzato di pacchetti. Accetta sia
  `pacchettiOre` (array) sia il legacy `pacchettoOre` (oggetto singolo → array
  di uno). Restituisce `[]` se nessuno.
- `assignPackage(task, packages, tasksById)` → indice del primo pacchetto i cui
  `tags` matchano i tag effettivi del task, oppure `null` (→ "Altro").
- `accruedMsForMonth(pkg, year, month, startDate)` → ms maturati in quel mese
  secondo il `periodo` (mensile/annuale/stagionale).
- `seasonMonths(pkg)` / `inWindow(pkg, date)` → supporto per la finestra
  stagionale chiusa.

## Config (`config/clients.json`)

Migrazione a `pacchettiOre` (array). Ogni elemento:

```json
"hotelmare": {
  "name": "Hotel Mare",
  "listId": "…",
  "pacchettiOre": [
    { "label": "Estate",  "periodo": "stagionale", "ore": 60,
      "dataInizio": "2026-06-01", "dataFine": "2026-09-30", "tags": ["estate"] },
    { "label": "Inverno", "periodo": "stagionale", "ore": 80,
      "dataInizio": "2026-12-01", "dataFine": "2027-03-31", "tags": ["inverno"] },
    { "label": "Continuativo", "periodo": "mensile", "ore": 20,
      "dataInizio": "2026-01-01", "tags": ["assistenza"] }
  ]
}
```

- `periodo` ∈ `mensile` | `annuale` | `stagionale`.
- `dataFine` **solo** per `stagionale`.
- `dataInizio` ora vive **dentro** ogni pacchetto.
- `tags` = nomi tag ClickUp, confronto case-insensitive (riuso normalizzazione
  di `tag-views.mjs`). Tag assente/vuoto su un pacchetto = quel pacchetto cattura
  tutti i task non già assegnati ai precedenti (utile per il caso single-package
  legacy che copre l'intera lista).
- Migrare `kiboko` e `dss` ad array di un elemento (spostando `dataInizio`
  dentro). Normalizzatore difensivo: un vecchio `pacchettoOre` oggetto viene
  letto come array di uno, così nulla si rompe se un config non è migrato.
- `pacchettiOre` assente → tab Consumo ore mostra solo il consumo per mese
  (comportamento attuale).

### `api/me.js`

Esporre `pacchettiOre` (array normalizzato) al posto di `pacchettoOre` +
`dataInizio`. Mantenere la normalizzazione legacy lato server così che un config
non migrato continui a funzionare. `tagViews` invariato.

## Maturazione per periodo

| `periodo` | Maturazione | Finestra mostrata/conteggiata |
|---|---|---|
| `mensile` | `ore` ogni mese | da `dataInizio` a oggi |
| `annuale` | `ore` una volta nel mese di `dataInizio` | da `dataInizio` a oggi |
| `stagionale` | `ore` una volta nel mese di `dataInizio` | **chiusa**: `dataInizio` → `dataFine` |

- Per `stagionale`, i mesi della tabella "Per mese" e il consumo conteggiato
  sono limitati alla finestra.
- Il fetch delle time-entry parte dalla **`dataInizio` più vecchia** tra tutti i
  pacchetti (fallback: ultimi 12 mesi), così una stagione passata è coperta.

## Partizione task → pacchetto

1. Risolvere i **tag effettivi** di ogni task (propri ∪ padre).
2. Marcare i **contenitori** (id che sono `parent` di qualcun altro): esclusi
   dai conteggi come item, usati come intestazione-gruppo e come fonte tag.
3. Ogni **foglia** entra nel **primo** pacchetto (ordine config) i cui `tags`
   matchano i suoi tag effettivi; nessun match → **"Altro"**. Match multiplo →
   primo vince (niente duplicazione tra pacchetti).

## UI tab "Consumo ore"

- Con ≥2 pacchetti (o pacchetti con tag) → **selettore pacchetto** in alto
  (`[ Estate ][ Inverno ][ Continuativo ][ Altro ]`), un pacchetto alla volta.
  Stesso pattern dei toggle esistenti (`active` / `aria-selected`). In questa
  modalità **non** si mostra il selettore `tagViews` nel tab Consumo ore.
- Sotto il selettore: KPI (Maturate / Consumate / Saldo) + progress bar +
  grafico mensile + dettagli (Per mese / Per task / Per utente) del **solo**
  pacchetto selezionato.
- **Stagionale**: l'intestazione mostra **inizio → fine**
  (es. "Estate · 1 giu – 30 set 2026"). Mensile/annuale mostrano solo l'inizio,
  come oggi.
- **"Altro"**: solo consumo (niente KPI maturate/saldo, niente colonne
  maturato/saldo nella tabella "Per mese"), come un pacchetto senza monte ore.
- Caso single-package senza tag → nessun selettore, identico a oggi.
- Pacchetto attivo persistito in `localStorage` per-cliente (chiave analoga a
  `viewStorageKey`, es. `pirelli-weekly:active-package:<slug>`). Al load: se il
  pacchetto salvato non esiste più → fallback al primo.

## Sub-task: inclusione e niente duplicazione

- `fetchTasks()` **smette di scartare** i sub-task (rimuovere il filtro
  `parent != null`); l'arricchimento marca i contenitori.
- **Tab Settimanale** (`render.js`): KPI, grafico stati e tabella contano le
  **foglie**; i padri-contenitore diventano intestazioni di gruppo e non
  ri-sommano. La filtro `tagViews` esistente usa i **tag effettivi** (così un
  sub-task senza tag propri eredita quelli del padre).
- **"Per task"** (Consumo ore): righe = sub-task, raggruppate sotto il nome del
  padre; la riga padre non aggiunge ore.
- Ore sempre da time-entry atomiche → nessun rollup, nessun doppio conteggio.
- **Impatto da verificare:** per clienti che già usano sotto-attività, il tab
  Settimanale cambia aspetto (i padri diventano gruppi, le foglie diventano le
  righe). Da controllare con screenshot prima del deploy.

## Edge case

- Pacchetto con `tags` vuoto → cattura i task non assegnati ai precedenti.
- Nessun task in un pacchetto → KPI a 0, grafico/tabelle vuoti con messaggio.
- Stagione interamente nel passato → mostrata sulla sua finestra; consumo fuori
  finestra non conteggiato in quel pacchetto.
- Tag di pacchetto inesistente sui task → pacchetto vuoto, nessun crash.
- Task contenitore senza figli "veri" (tutti i figli filtrati) → trattato come
  foglia.
- `pacchettiOre` assente → comportamento attuale (solo consumo per mese).
- Bucket "Altro" mostrato solo se esistono task non assegnati.

## Verifica

- Config con `pacchettiOre` multipli → selettore pacchetto, switch tra pacchetti
  coerente (KPI/grafico/dettagli del pacchetto attivo).
- Periodo stagionale → maturazione unica a inizio, finestra chiusa, intestazione
  con inizio→fine.
- Partizione: task assegnati al primo pacchetto che matcha; non assegnati in
  "Altro".
- Sub-task: ore dei figli conteggiate; padre-contenitore non duplica nei numeri;
  "Per task" raggruppa i figli sotto il padre.
- Tab Settimanale con sub-task: foglie contate una volta, padri come gruppi.
- Config legacy non migrato (`pacchettoOre` singolo) → ancora funzionante.
- Persistenza pacchetto attivo su reload; fallback se sparisce.
- Test unitari del nuovo `packages.mjs` (partizione, ereditarietà tag,
  contenitori, maturazione per periodo) come per `tag-views.mjs`.
- Verifica locale con `vercel dev` + screenshot prima del deploy.

## Fuori scope

- Modifiche al proxy `api/clickup.js` (i parametri `subtasks`/tag arrivano già).
- Gestione pacchetti da UI (solo da config).
- Visualizzazione simultanea di più pacchetti (uno alla volta).
- Rollup automatico delle ore dal campo task (si usano le time-entry).
