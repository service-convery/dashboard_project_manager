# Convery Dashboards

Hub multi-cliente di dashboard ClickUp, da deployare su Vercel. Ogni cliente ha la sua URL (`/d/pirelli`, `/d/cliente-x`, …) protetta da password. Tu come admin hai una password master che apre tutto.

Il codice è quello dell'artefatto Pirelli Weekly Tasks, riadattato per girare fuori da Cowork: invece di parlare con l'MCP, il browser chiama un proxy serverless (`/api/clickup`) che a sua volta interroga l'API REST di ClickUp con il tuo Personal Access Token (mai esposto al browser).

## Struttura

```
api/clickup.js          Proxy verso ClickUp REST. Verifica sessione + autorizzazione + whitelist parametri.
api/login.js            POST {slug, password} → cookie firmato HMAC
api/logout.js           Pulisce il cookie
api/me.js               Ritorna sessione + clienti accessibili
lib/session.js          Sign/verify cookie con crypto built-in (zero dipendenze)
config/clients.json     Elenco clienti {slug, name, listId} — versionato col repo
public/index.html       Landing con form di login
public/dashboard.html   La dashboard
vercel.json             Rewrite /d/:slug → /dashboard.html + security headers
package.json            Node 20
```

## Setup in 8 step

### 1. Personal Access Token ClickUp

1. Apri ClickUp → click sul tuo avatar in basso a sinistra → **Settings**
2. Sidebar → **Apps**
3. Sezione **API Token** → click su **Generate** (se non l'hai mai fatto) o copia il token esistente
4. Il token ha formato `pk_xxxxxxxx`. Tienilo a portata di mano: lo useremo come env var su Vercel.

Note:
- Il PAT eredita TUTTI i permessi del tuo account ClickUp. Vede ogni workspace, ogni lista a cui hai accesso. Trattalo come una password.
- Se lo revochi, le dashboard smettono di funzionare finché non aggiorni la env var su Vercel.

### 2. Trovare il Team ID (Workspace ID) ClickUp

Serve per chiamare l'endpoint delle ore tracciate (`/team/{teamId}/time_entries`).

1. Apri ClickUp nel browser. Guarda la URL: `https://app.clickup.com/<TEAMID>/v/li/<LISTID>`
2. `<TEAMID>` è un numero di 7-9 cifre (es. `90040187192`). Copialo.

### 3. Trovare i List ID dei clienti

1. Apri la lista in ClickUp.
2. Three dots (⋯) in alto → **Copy link**.
3. Il link sarà tipo `https://app.clickup.com/<TEAMID>/v/li/901202068602`. L'ultimo segmento è il `listId`.

### 4. Configura i clienti

Apri `config/clients.json` e aggiungi un'entry per cliente:

```json
{
  "pirelli": {
    "name": "Pirelli.com",
    "listId": "901202068602"
  },
  "cliente-x": {
    "name": "Cliente X",
    "listId": "901234567890"
  }
}
```

- `slug` (la chiave): lowercase, solo lettere/numeri/trattini. Diventa parte dell'URL (`/d/<slug>`).
- `name`: nome visualizzato nell'header della dashboard.
- `listId`: l'ID della lista ClickUp.

### 5. Genera SESSION_SECRET

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copia la stringa (64 caratteri hex). Sarà la chiave per firmare i cookie di sessione.

### 6. Push del repo

```bash
cd vercel-dashboards
git init
git add .
git commit -m "Initial commit"
# Crea un repo privato su GitHub (es. github.com/convery/dashboards) poi:
git remote add origin git@github.com:convery/dashboards.git
git push -u origin main
```

⚠️ Il repo dovrebbe essere **privato**: `config/clients.json` contiene i listId dei clienti (non sono secret ma sono dati interni).

### 7. Deploy su Vercel

1. Vai su [vercel.com](https://vercel.com) → **Add New Project** → **Import Git Repository**
2. Seleziona il repo `dashboards`.
3. Framework Preset: lascia **Other** (è solo HTML statico + serverless functions, niente framework).
4. **Environment Variables** → aggiungi:

| Nome | Valore | Note |
|---|---|---|
| `CLICKUP_PAT` | `pk_xxxxxxxx` | PAT dello step 1 |
| `CLICKUP_TEAM_ID` | `90040187192` | Team ID dello step 2 |
| `SESSION_SECRET` | `(64 char hex)` | Stringa dello step 5 |
| `DASHBOARD_PASSWORD_ADMIN` | `(tua master password)` | Quella che apre TUTTE le dashboard |
| `DASHBOARD_PASSWORD_PIRELLI` | `(password Pirelli)` | Una per ogni slug in `clients.json` |
| `DASHBOARD_PASSWORD_CLIENTE_X` | `(password cliente X)` | Slug uppercase, trattini → underscore |

⚠️ Convenzione nome variabile: `DASHBOARD_PASSWORD_<SLUG>` dove `<SLUG>` è lo slug in maiuscolo con i trattini sostituiti da underscore. Es: slug `cliente-x` → env `DASHBOARD_PASSWORD_CLIENTE_X`.

5. Click **Deploy**. In 30-60 secondi sei online su `<project>.vercel.app`.

### 8. Test

1. Apri `https://<project>.vercel.app/d/pirelli`
2. Vieni rediretto al login con slug `pirelli` pre-compilato. Inserisci la password `DASHBOARD_PASSWORD_PIRELLI` e accedi.
3. Vedi la dashboard con i dati ClickUp reali.

Per testare l'admin: vai su `https://<project>.vercel.app/`, click su "Sei admin?", inserisci `DASHBOARD_PASSWORD_ADMIN`. Vedi la lista di tutti i clienti.

## Aggiungere un nuovo cliente

Tre step:

1. Aggiungi una riga in `config/clients.json`:
   ```json
   "nuovo-cliente": { "name": "Nuovo Cliente Srl", "listId": "9012..." }
   ```
2. Su Vercel → Project Settings → Environment Variables → aggiungi `DASHBOARD_PASSWORD_NUOVO_CLIENTE` con la sua password.
3. `git push`. Vercel redeploy automatico (~30 sec). L'URL `<project>.vercel.app/d/nuovo-cliente` è subito attivo.

## Cambiare la password di un cliente

- Vai su Vercel → Project Settings → Environment Variables → modifica `DASHBOARD_PASSWORD_<SLUG>`.
- **Importante**: dopo aver modificato una env var, devi fare un **redeploy** perché Vercel usi il nuovo valore. Click sulla dashboard del progetto → tab Deployments → ultimo deploy → ⋯ → **Redeploy**. (Le sessioni già emesse restano valide fino a scadenza naturale: vedi sotto.)

## Custom domain (es. `dashboards.convery.io`)

1. Su Vercel → Project Settings → **Domains** → **Add**.
2. Inserisci `dashboards.convery.io` (o il sotto-dominio che vuoi).
3. Vercel ti dice quale record DNS aggiungere — di solito un CNAME `dashboards` → `cname.vercel-dns.com`.
4. Apri il pannello DNS del tuo registrar (es. Cloudflare, Aruba, Register) e aggiungi quel record CNAME.
5. Vercel rileva il puntamento entro qualche minuto e attiva HTTPS automatico.

## Sicurezza

- Cookie `cvy_session` firmato HMAC-SHA256, `HttpOnly` + `Secure` + `SameSite=Lax`, scadenza 7 giorni.
- Il PAT ClickUp non viene mai esposto al browser: solo il server (la serverless function) lo usa.
- Il `listId` resta server-side: il browser passa solo lo slug, il proxy risolve `slug → listId` e verifica che l'utente abbia accesso (admin o stesso slug). Non si possono sniffare liste random cambiando l'URL.
- I parametri inoltrati a ClickUp sono in whitelist: tutto il resto della query string viene scartato.
- Comparazione password con `timingSafeEqual` per evitare timing attack.
- Per **revocare immediatamente tutte le sessioni** in caso di leak: cambia `SESSION_SECRET` e redeploy → tutti i cookie esistenti diventano invalidi.

## Come riusare per un altro dominio

Il codice non ha nulla di hardcoded che sia legato a Pirelli o Convery. Per pubblicare lo stesso sistema sotto un altro brand: cambia il logo SVG in `public/index.html` e `public/dashboard.html`, cambia i titoli, deploy.

## Limiti noti / cose da sapere

- L'export PDF (pulsante "Esporta PDF" in alto a destra) usa `window.print()` lato client. Il browser apre la finestra di stampa standard, scegli "Salva come PDF". A4 verticale, layout già ottimizzato.
- La cache della lista task è in-memory nel browser (resetta a ogni reload). Niente cache persistente — la pagina è sempre "fresh".
- Il proxy mette un `Cache-Control: private, max-age=30` sulle risposte di `/api/clickup`. Se due persone aprono nello stesso minuto, la seconda hit risparmia una chiamata a ClickUp. Aumenta o togli se preferisci sempre dati live.
- ClickUp rate-limit: 100 richieste/minuto per workspace. Con un team da 5-10 persone non lo tocchi mai. Se ci arrivi vicino, il dashboard ha già retry automatici con backoff.

## Troubleshooting

| Sintomo | Causa probabile | Fix |
|---|---|---|
| Login dà "Credenziali non valide" | Slug sbagliato o env var non settata su Vercel | Controlla `clients.json` e che `DASHBOARD_PASSWORD_<SLUG>` esista nelle env vars |
| Dashboard mostra "Errore caricamento task" | `CLICKUP_PAT` mancante o scaduto | Controlla env var, eventualmente rigenera il PAT |
| KPI "Ore tracciate" sempre 0 | `CLICKUP_TEAM_ID` mancante | Setta env var e redeploy |
| 500 sulla chiamata `/api/clickup` | Errore lato proxy | Vercel dashboard → Functions → Logs |
| Tutti i KPI a 0 ma niente errore | Il PAT non vede questa lista | Verifica che l'account del PAT abbia accesso al workspace della lista |
| Cookie non vengono salvati | Stai testando su `http://` non `https://` | `Secure` cookie richiede HTTPS. In locale con `vercel dev` funziona perché localhost è whitelistato. |

## Sviluppo locale

```bash
npm install -g vercel
vercel dev
```

Vercel CLI ti chiede di linkare il progetto, poi gira tutto su `http://localhost:3000`. Le env vars vengono lette da `.env.local` (crealo a partire da `.env.example`).
