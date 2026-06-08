# Viste per tag — filtro dei task da configurazione

**Data:** 2026-06-08
**Stato:** Design approvato

## Obiettivo

Permettere di filtrare i task del dashboard per **viste con nome** definite in
configurazione (per cliente). Ogni vista raggruppa una o più tipologie di task
tramite i tag ClickUp, così da poter consultare solo alcune categorie di task
(es. "Frontend", "Bug", "Backend") invece dell'intera board.

Il filtro agisce sia sul tab **"Settimanale"** sia sul tab **"Consumo ore"**.

## Decisioni di design (sintesi)

| Tema | Decisione |
|------|-----------|
| Dove si configura | `config/clients.json`, campo opzionale `tagViews` per cliente |
| Forma | Viste con nome, ognuna con uno o più tag |
| Logica multi-tag | **OR**: un task entra nella vista se ha almeno uno dei suoi tag |
| Selezione nel dashboard | Una vista alla volta + pulsante "Tutti" (default) |
| Ambito (tab Settimanale) | Filtra **tutto**: KPI + grafici + tabella |
| Semantica con `tagViews` presente | Si vedono **solo** i task con i tag configurati; gli altri sono sempre nascosti. "Tutti" = unione di tutte le viste configurate |
| Retrocompatibilità | `tagViews` assente/vuoto → dashboard identico a oggi, nessun selettore |
| Tab "Consumo ore" | Pacchetto/saldo **sempre globale**; consumo (grafico, per task, per utente) **filtrato** |

## Contesto tecnico rilevante

- I task ClickUp arrivano **già** con il loro array `tags` dentro
  `state.allTasksCache` (ogni tag ha `name`, `tag_fg`, `tag_bg`). **Nessuna
  modifica** al proxy `api/clickup.js` o a `public/js/api.js` è necessaria per
  ottenere i tag.
- `render()` in `public/js/render.js` ricalcola tutto (KPI, grafico ore,
  grafico stati, tabella) a partire da `allTasks` + `closedThisWeek`. Filtrare
  in cima a `render()` propaga il filtro a tutti i consumatori.
- La vista "Consumo ore" (`public/js/hours-package.js`) è lazy-loaded una volta;
  fa `fetchTasks()`, costruisce `taskIds`, filtra le entries e aggrega per
  mese/task/utente. Il pacchetto ore (maturate/saldo) deriva dalla config, non
  dai task.
- Stato condiviso via oggetto mutabile `state` in `public/js/state.js`. Il
  filtro temporale esistente (`state.tableFilter` "week"/"all") è il pattern di
  riferimento: muta lo stato + persiste su `localStorage` + re-render senza
  rifetch.

## Configurazione (`config/clients.json`)

Campo `tagViews` opzionale per cliente:

```json
"acme": {
  "listId": "...",
  "name": "ACME",
  "tagViews": [
    { "label": "Frontend", "tags": ["frontend", "ui"] },
    { "label": "Bug",      "tags": ["bug"] },
    { "label": "Backend",  "tags": ["api", "db"] }
  ]
}
```

- `tags` = nomi dei tag ClickUp, confronto **case-insensitive** sul nome.
- `tagViews` va **esposto al frontend** insieme agli altri dati di config già
  serviti (`name`, `pacchettoOre`, `dataInizio`), così arriva in
  `state.clientConfig.tagViews`.
- Se assente o array vuoto → nessun selettore renderizzato, comportamento
  attuale invariato.

## Architettura: filtro alla sorgente

Approccio scelto: **un solo punto di filtro** in cima a `render()`, più una
cache degli input per ri-renderizzare al cambio vista senza richiamare l'API.

Scartati:
- *Filtro separato per ogni consumatore* (tabella, KPI, ogni grafico): logica
  duplicata in più punti, facile divergenza.
- *Filtro a livello di cache dati* (`allTasksCache`): "Tutti" richiederebbe
  rifetch o doppia cache; perde la separazione dati/vista.

### Funzioni di match (`public/js/render.js`)

```js
// Normalizza i nomi tag di un task ClickUp (case-insensitive)
function taskTagNames(t){
  return new Set((Array.isArray(t.tags) ? t.tags : [])
    .map(tag => String(tag && tag.name || "").toLowerCase().trim()));
}
// Vero se il task ha almeno uno dei tag richiesti (OR). Set vuoto = nessun vincolo.
function taskMatchesTags(t, tagSet){
  if (!tagSet || tagSet.size === 0) return true;
  const names = taskTagNames(t);
  for (const tag of tagSet) if (names.has(tag)) return true;
  return false;
}
```

### Vista attiva e set di tag effettivo

- `state.activeView` = label della vista attiva, oppure `"__all__"` per "Tutti".
- Helper `activeTagSet()` che, dato `state.clientConfig.tagViews` e
  `state.activeView`, restituisce il `Set<string>` di tag (lowercase) da
  applicare:
  - `tagViews` assente/vuoto → set vuoto (nessun filtro, comportamento attuale).
  - `tagViews` presente, vista "Tutti" → **unione** dei tag di tutte le viste.
  - `tagViews` presente, vista singola → i tag di quella vista.
- I nomi dei tag vengono normalizzati a lowercase una sola volta nella
  costruzione del set.

### Aggancio in `render()`

In cima a `render()`, prima di ogni calcolo:

```js
const tagSet = activeTagSet();
allTasks       = allTasks.filter(t => taskMatchesTags(t, tagSet));
closedThisWeek = closedThisWeek.filter(t => taskMatchesTags(t, tagSet));
```

Tutto il resto (openTasks, KPI, status chart, hours chart via `taskIdSet`,
tabella) si ricalcola sul sottoinsieme senza altre modifiche. Le entries (ore)
seguono perché già filtrate sul `taskIdSet`.

### Re-render al cambio vista senza rifetch

Oggi `render()` è chiamata da `load()` con dati appena fetchati. Per cambiare
vista senza richiamare l'API:

- Salvare gli input in `state.lastRenderInputs = { tasks, entries, estimates,
  closedThisWeek, mon, sun }`.
- Il click su una vista imposta `state.activeView` e richiama
  `render(...state.lastRenderInputs)`.

## UI del selettore di vista

Nel tab "Settimanale", sopra la tabella, una fila dedicata sopra il toggle
temporale esistente:

```
[ Tutti ] [ Frontend ] [ Bug ] [ Backend ]    ← viste tag (da config)
[ Solo settimana ] [ Tutti ]                   ← toggle temporale esistente
```

- **"Tutti"** è il default e lo stato di partenza.
- Una vista alla volta: click su una vista la attiva e disattiva le altre,
  stesso pattern `active` / `aria-selected` dei pulsanti filtro esistenti.
- I due filtri sono **ortogonali e combinabili**: vista "Bug" + "Solo settimana"
  = task con tag bug in scadenza/completati questa settimana. Il filtro tag
  agisce su KPI+grafici+tabella; il toggle temporale resta sulla tabella.
- I pulsanti sono generati dinamicamente da `state.clientConfig.tagViews`.
- Se `tagViews` è vuoto/assente, l'intera fila non viene renderizzata.
- Lo **stesso gruppo di pulsanti** compare anche in cima al tab "Consumo ore",
  sincronizzato sullo stesso `state.activeView` (cambio vista in un tab → vale
  anche nell'altro).

## Tab "Consumo ore" sotto vista tag

Il tab è diviso in due zone.

**Zona "pacchetto" → sempre globale (intero progetto), mai filtrata:**
- KPI **Ore maturate**, **Ore consumate**, **Saldo residuo** + progress bar.
- Tab dettaglio **"Per mese"** (contiene le colonne *Maturate / Saldo mese /
  Saldo cumulato*, che hanno senso solo sull'intero pacchetto).

Rispondono a "com'è messo il pacchetto ore del cliente" → devono restare veri.

**Zona "dove sono andate le ore" → filtrata sulla vista attiva:**
- Grafico **"Ore consumate per mese"** (puro consumo).
- Tab dettaglio **"Per task"**.
- Tab dettaglio **"Per utente"**.

Rispondono a "dentro questa categoria di task, dove sono finite le ore".

**Implementazione:** in `loadHoursView()`, dopo `fetchTasks()`, calcolare due
collezioni:
- `tasksGlobal` = tutti i task (per i KPI pacchetto e la tab "Per mese").
- `tasksView` = `tasksGlobal.filter(t => taskMatchesTags(t, activeTagSet()))`
  (per grafico mensile, "Per task", "Per utente").

Le aggregazioni di consumo (per task, per utente, grafico mensile) usano
`tasksView` e le entries filtrate sui suoi id. Il calcolo del saldo cumulato e
la tab "Per mese" usano la collezione globale.

**Re-render al cambio vista:** poiché la vista è lazy/una-tantum, il cambio di
`state.activeView` mentre il tab "Consumo ore" è attivo deve poter
ri-renderizzare le sole parti filtrate. Le entries del range sono già scaricate;
si ricalcolano le aggregazioni della zona filtrata dai dati in memoria senza
nuova fetch. (Dettaglio realizzativo da definire nel piano: o memorizzare gli
input dell'ultimo render in `state`, o rieseguire l'aggregazione delle parti
filtrate.)

**Nota di trasparenza:** il grafico mensile (filtrato) e la tab "Per mese"
(globale) possono mostrare ore consumate diverse — è voluto, rispondono a
domande diverse. Va segnalato con una nota testuale vicino alle relative parti.

## Persistenza

- La vista attiva si salva in `localStorage` per-cliente, stesso pattern del
  toggle temporale (chiave tipo `pirelli-weekly:active-view:<slug>`), così un
  reload mantiene la vista.
- Al load: se la vista salvata non esiste più in config → fallback a "Tutti".

## Edge case

- **Task senza tag** → invisibili quando `tagViews` è presente (rientrano solo
  se avranno un tag configurato). Coerente con la semantica richiesta.
- **Vista che non matcha nulla** → KPI a 0, grafici vuoti, tabella/dettagli con
  messaggio "Nessun task in questa vista". Nessun errore.
- **Tag in config inesistente sui task** → non matcha, nessun crash.
- **`tagViews` assente/vuoto** → selettore non renderizzato, dashboard identico
  a oggi.
- **Label duplicate in config** → usare l'indice come chiave interna così due
  viste con stessa label restano distinte.
- **Interazione col toggle temporale** → ortogonali, si combinano.

## Verifica

- Config senza `tagViews` → nessun selettore, comportamento invariato.
- Config con `tagViews` → appaiono i pulsanti in entrambi i tab; "Tutti" mostra
  l'unione; una vista restringe; KPI/grafici/tabella coerenti (tab Settimanale).
- Task senza tag configurati → nascosti quando `tagViews` presente.
- Combinazione vista + toggle settimana/tutti.
- Tab "Consumo ore": pacchetto e "Per mese" globali; grafico mensile, "Per task"
  e "Per utente" filtrati; sincronizzazione `activeView` tra i due tab.
- Persistenza su reload; fallback se la vista salvata sparisce.
- Verifica locale con `vercel dev` + screenshot prima del deploy.

## Fuori scope

- Viste salvate/gestite dall'utente da UI (qui sono solo da config).
- Modifiche al proxy o al data layer (i tag arrivano già).
- Combinazione di più viste contemporaneamente (una vista alla volta).
