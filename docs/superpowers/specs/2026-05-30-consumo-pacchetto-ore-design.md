# Vista "Consumo pacchetto ore" — Design

Data: 2026-05-30
Stato: approvato (design), in attesa di piano di implementazione

## Obiettivo

Aggiungere alla dashboard una seconda vista che mostri, per cliente, quante ore
sono state consumate rispetto a un "pacchetto ore" (monte ore a saldo cumulativo).
Serve anche per mostrare ai clienti il consumo del loro pacchetto.

## Decisioni prese (brainstorming)

- **Collocazione**: tab nella dashboard esistente (`/d/:slug`), niente route nuova.
  Due viste: **"Settimanale"** (attuale) e **"Consumo ore"** (nuova).
- **Pacchetto ore**: definito **una volta** per cliente in `config/clients.json`.
  Può essere **mensile** o **annuale**. Le ore non usate **si accumulano** (rollover).
- **Inizio accumulo**: `dataInizio` configurata per cliente.
- **Dettaglio**: sempre **per mese**, anche per il pacchetto annuale.
- **Granularità accredito**: mensile → `+ore` ogni mese; annuale → `+ore` nel mese
  dell'anniversario di `dataInizio`, poi `+0` negli altri mesi.

## Configurazione (`config/clients.json`)

Campi nuovi, entrambi **opzionali**:

```json
"kiboko": {
  "name": "Kiboko",
  "listId": "901216775998",
  "pacchettoOre": { "ore": 20, "periodo": "mensile" },
  "dataInizio": "2026-01-01"
}
```

- `periodo`: `"mensile"` | `"annuale"`.
- `dataInizio`: `YYYY-MM-DD`.
- Se `pacchettoOre`/`dataInizio` **mancano**: il tab mostra solo l'andamento
  mensile delle ore consumate, senza KPI di saldo né barra di budget.

`pacchettoOre` e `dataInizio` **vengono esposti al browser** via `/api/me` (servono
al calcolo lato client e non sono segreti). Il `listId` continua invece a restare
server-side, come oggi. Il proxy `/api/clickup` resta invariato (accetta già
`start_date`/`end_date`, quindi nessuna modifica backend per il fetch del range).

## Calcolo (modello a saldo cumulativo)

- **Ore maturate** = (n. periodi accreditati da `dataInizio` a oggi) × `pacchettoOre.ore`
  - mensile: numero di mesi-calendario da `dataInizio` (incluso) a oggi (incluso).
  - annuale: numero di anniversari di `dataInizio` raggiunti (incluso quello iniziale).
- **Ore consumate** = somma `duration` delle time-entry su task della lista del
  cliente, da `dataInizio` 00:00 a adesso.
- **Saldo residuo** = maturate − consumate (può essere negativo = sforamento).
- **Per ogni mese** (da `dataInizio` a oggi): maturate del mese, consumate del mese,
  saldo del mese (maturate−consumate), saldo cumulato progressivo.

## Dati ClickUp

- Una `time-entries` per assegnatario sul range `dataInizio → adesso`, deduplicate
  per id, filtrate ai task della lista del cliente, raggruppate per mese lato client.
- Assegnatari ricavati dai task della lista (`include_closed: true`), come la vista
  settimanale.
- **Limite noto** (già presente oggi): copre solo gli assegnatari presenti sui task
  della lista; un utente senza task ma con ore tracciate non è coperto. Va documentato
  in UI con una nota discreta.

## UI — vista "Consumo ore"

Mockup approvato:

```
Consumo pacchetto ore · <Cliente>
[ Ore maturate ]   [ Ore consumate ]   [ Saldo residuo ]
     100h               62,5h              +37,5h

Consumo dall'inizio: [▓▓▓▓▓▓░░░░] 62%  (62,5h / 100h)

Ore consumate per mese  (linea tratteggiata = monte mensile)
  20h ┤ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
  10h ┤   ▆        ▆     ▆
   0h └── Gen Feb Mar Apr Mag

Dettaglio mensile
 Mese │ Maturate │ Consumate │ Saldo mese │ Saldo cumul.
 Gen  │   +20h   │   18,0h   │   +2,0h    │    +2,0h
 Feb  │   +20h   │   12,5h   │   +7,5h    │    +9,5h
```

- Saldo residuo: verde se ≥ 0, rosso se negativo (sforamento).
- Barra di consumo e linea di riferimento del grafico mostrate solo se il pacchetto
  è configurato. Senza pacchetto: solo grafico + tabella consumi (niente colonne
  "Maturate/Saldo").
- Riusa Chart.js (già caricato) e i pattern KPI/card/tabella esistenti.

## Tab / navigazione

- Selettore in cima a `main` (sopra la week-nav): `Settimanale` | `Consumo ore`.
- La vista "Consumo ore" viene caricata **lazy** al primo accesso al tab (i dati
  multi-mese sono più pesanti), poi cachata in `state`.
- La preferenza di tab non è persistita (default: Settimanale).

## Stampa / PDF

Il banner export resta. `window.print()` esporta la **vista attiva**: le sezioni della
vista non attiva sono nascoste anche in stampa.

## Componenti / file

- `config/clients.json` — aggiunti `pacchettoOre` + `dataInizio` (per i clienti che li hanno).
- `api/me.js` — espone al client `pacchettoOre`/`dataInizio` per gli slug accessibili
  (servono al calcolo lato browser). `listId` resta escluso.
- `public/dashboard.html` — markup dei tab + contenitore vuoto della vista consumo.
- `public/css/dashboard.css` — stile tab + vista consumo (riusa variabili esistenti).
- `public/js/config.js` — eventuali costanti (etichette mesi).
- `public/js/hours-package.js` — **nuovo**: fetch range, calcolo saldo/mensile, render.
- `public/js/api.js` — funzione `fetchEntriesRange(mon→now)` riusabile (o estensione).
- `public/js/dashboard.js` — gestione switch tab + bootstrap del client config.

## Edge cases

- Cliente senza pacchetto → vista trend-only.
- `dataInizio` nel futuro o assente → nessun accumulo; mostra avviso o trend-only.
- Saldo negativo → evidenziazione sforamento.
- Mese corrente parziale → consumate = ore fino ad adesso; maturate = pieno del periodo.
- Nessuna time-entry nel range → tabella/grafico vuoti con messaggio.

## Non incluso (YAGNI)

- Editing del pacchetto da UI (si fa in `clients.json`).
- Export CSV/Excel del dettaglio.
- Allerta/notifiche di superamento soglia.
- Persistenza della preferenza di tab.
