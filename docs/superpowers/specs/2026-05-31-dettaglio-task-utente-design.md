# Vista "Consumo ore" — Dettaglio per task e per utente — Design

Data: 2026-05-31
Stato: approvato (design), in attesa di piano di implementazione

## Obiettivo

Estendere la vista "Consumo ore" (`docs/.../2026-05-30-consumo-pacchetto-ore-design.md`)
con due nuove letture dei consumi, accanto al "Dettaglio mensile" già esistente:

1. **Per task** — su quali task della lista è stato speso il tempo.
2. **Per utente** — quale utente ClickUp ha tracciato ore sul progetto (grafico).

Serve a mostrare al cliente non solo *quanto* del pacchetto è stato consumato, ma
*dove* (quali attività) e *da chi*.

## Decisioni prese (brainstorming)

- **Navigazione**: l'area di dettaglio in fondo alla vista diventa un blocco a
  **3 tab** che si alternano (se ne vede una sola per volta):
  `[ Per mese ] [ Per task ] [ Per utente ]`. Default: **Per mese** (la tabella
  attuale, invariata).
- **Collocazione del grafico utenti**: in una **tab dedicata** ("Per utente"),
  non impilato sotto la tabella task.
- **Tipo grafico utenti**: **barre orizzontali**, ordinate per ore decrescenti.
- **Colonne tabella task**: Nome task, Stato + assegnatari, Ore consumate, % del totale.
- **Disclaimer utenti**: nota che le ore riflettono chi ha tracciato il tempo e che
  uno stesso task può essere lavorato da più persone.

## Dati — nessuna nuova chiamata

Tutto si appoggia ai dati **già scaricati** da `loadHoursView`:

- `ourEntries` = time-entry del range (`dataInizio → oggi`, oppure ultimi 12 mesi se
  non c'è pacchetto) filtrate ai task della lista. Ogni entry contiene già `task`
  (`id`, e tipicamente `name`/`url`), `user` (`id`, `username`, `color`) e `duration_ms`.
- `tasks` = lista task della board (cache condivisa con la vista settimanale), con
  `id`, `name`, `url`, `status`, `assignees`.

Quindi **nessuna modifica** a `api/*`, `lib/session.js`, `config/clients.json`,
`api.js`, `dashboard.html`. Solo aggregazione e rendering lato client.

## Layout della vista (dopo le modifiche)

```
Consumo pacchetto ore · <Cliente>
[ Ore maturate ] [ Ore consumate ] [ Saldo residuo ]      ← invariato
Consumo dall'inizio: [▓▓▓▓▓▓░░░] 62%                       ← invariato (se pacchetto)
Ore consumate per mese  (grafico a barre + monte mensile)  ← invariato

Dettaglio
[ Per mese ] [ Per task ] [ Per utente ]
─────────────────────────────────────────
( contenuto della tab attiva )

(note esistenti: dati parziali / conteggio assegnatari)    ← invariato
```

I KPI, la barra di consumo e il grafico "Ore consumate per mese" restano **sopra**,
sempre visibili: sono il riassunto del pacchetto. Le tab riguardano solo il blocco
di dettaglio.

## Tab "Per mese"

La tabella "Dettaglio mensile" attuale, **invariata** (Mese / Maturate / Consumate /
Saldo mese / Saldo cumulato; le colonne Maturate/Saldo solo se c'è il pacchetto).
È la tab di default.

## Tab "Per task"

Tabella ordinata per **ore decrescenti**, una riga per ogni task con ore > 0 nel periodo.

```
Task                  │ Stato       │ Assegnatari   │   Ore   │  %
Restyling homepage    │ Completato  │ Mario, Lucia  │  12,5h  │ 28%
Setup tracking GA4    │ In corso    │ Paolo         │   9,0h  │ 20%
…
```

- **Nome task**: link a `task.url` (ClickUp) se disponibile, altrimenti testo semplice.
  Nome ricavato dal join `entry.task.id → tasks` (cache board); fallback `entry.task.name`.
- **Stato** + **Assegnatari**: dalla cache board (`tasks`), join per `task.id`, per
  coerenza con la vista settimanale. Status renderizzato con i pattern/colori esistenti.
- **Ore**: somma `duration_ms` delle entry di quel task.
- **%**: ore del task / totale consumato del periodo (`consumedTotalMs`), arrotondata.
- Nessun cap: tutti i task con ore, tabella scrollabile (riuso `.table-wrap`/`.tasks`).
- Vuoto → riga unica "Nessuna ora tracciata nel periodo."

## Tab "Per utente"

Grafico a **barre orizzontali** (Chart.js `type: "bar"`, `indexAxis: "y"`),
una barra per utente, ordinate per ore decrescenti.

```
Mario Rossi    ▆▆▆▆▆▆▆▆ 24h
Lucia Bianchi  ▆▆▆▆▆ 15h
Paolo Verdi    ▆▆▆ 9h
```

- Aggregazione delle entry per `e.user.id`; etichetta = `user.username`.
- Colore barra = `user.color` di ClickUp quando presente; altrimenti il blu di brand
  (`#3333FF`) come il grafico mensile.
- Entry senza `user` → raggruppate sotto "Sconosciuto" (difensivo, raro).
- Istanza Chart.js dedicata `state.hoursUsersChart`, distrutta/ricreata come
  l'esistente `hoursPkgChart`. Tooltip in stile coerente ("Nome: X h").
- Render **lazy** alla prima apertura della tab (il canvas non esiste finché la tab
  è nascosta).
- Vuoto → messaggio "Nessuna ora tracciata nel periodo."
- **Disclaimer** sotto il grafico:
  > Le ore sono attribuite a chi ha materialmente tracciato il tempo. In base
  > all'ambito dell'attività, uno stesso task può essere lavorato da più persone:
  > la ripartizione per utente non indica quindi la titolarità dell'attività.
- **Nota limite** (già esistente, ripetuta in piccolo): copre solo gli utenti
  assegnatari sui task della lista.

## Comportamento delle tab

- Switch puro lato client: cambiare tab mostra/nasconde i pannelli; nessun refetch.
- I dati di tutte e tre le tab sono calcolati al `load`; i due nuovi grafici fanno il
  `render` del canvas in modo **lazy** alla prima apertura della rispettiva tab
  (un canvas in un contenitore `display:none` non si dimensiona bene in Chart.js).
- La preferenza di tab **non** è persistita (default: Per mese), coerente col tab
  Settimanale/Consumo ore di livello superiore.

## File toccati

- `public/js/hours-package.js` — **modificato**: aggrega `ourEntries` per task e per
  utente; renderizza il selettore a 3 tab + la tabella task + il grafico utenti;
  gestisce lo switch e il render lazy dei canvas.
- `public/css/dashboard.css` — **modificato**: stile del selettore di tab di dettaglio
  (riuso variabili e pattern esistenti). Eventuale stile barra utenti.

Nessun altro file.

## Stampa / PDF

`window.print()` esporta la **tab di dettaglio attiva** (le altre sono `display:none`,
quindi escluse anche in stampa), coerente col comportamento attuale della dashboard.

## Edge case

- Nessuna time-entry nel periodo → tabella task e grafico utenti vuoti con messaggio.
- Dati parziali (qualche chiamata ClickUp fallita) → resta la nota esistente.
- Entry su task non presenti nella lista → già escluse dal filtro `taskIds` attuale.
- Task senza `url` → nome non cliccabile.
- Entry senza `user` → bucket "Sconosciuto".
- Molti task / molti utenti → nessun cap; tabella scrolla, grafico cresce in altezza.

## Non incluso (YAGNI)

- Export CSV/Excel del dettaglio task o utenti.
- Filtri / ricerca / ordinamento interattivo nella tabella task.
- Drill-down task → singole time-entry.
- Persistenza della tab di dettaglio attiva.
- Modifiche al backend o al proxy ClickUp.
