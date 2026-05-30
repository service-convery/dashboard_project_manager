// GET /api/clickup
// Proxy verso l'API REST di ClickUp. Verifica autenticazione, autorizzazione (admin o
// stesso slug), traduce i parametri in chiamate ClickUp e restituisce la risposta JSON
// così com'è (più piccoli wrapping per uniformare la shape al codice del dashboard).
//
// Parametri comuni:
//   slug=<client>            (obbligatorio: identifica quale dashboard sto consultando)
//   endpoint=<name>          (tasks | time-entries | task)
//
// endpoint=tasks → ClickUp GET /list/{listId}/task
//   include_closed, subtasks, page, date_done_gt, date_done_lt, due_date_gt, due_date_lt
//   (tutti opzionali; date in millisecondi UNIX)
//
// endpoint=time-entries → ClickUp GET /team/{teamId}/time_entries
//   start_date (ms), end_date (ms), assignee (user_id), include_task_tags?
//
// endpoint=task → ClickUp GET /task/{task_id}
//   task_id (obbligatorio)

const session = require('../lib/session');
const CLIENTS = require('../config/clients.json');

const CLICKUP_BASE = 'https://api.clickup.com/api/v2';

const ALLOWED_TASKS_PARAMS = new Set([
  'include_closed', 'subtasks', 'page',
  'date_done_gt', 'date_done_lt',
  'due_date_gt', 'due_date_lt',
  'order_by', 'reverse'
]);

const ALLOWED_TIME_PARAMS = new Set([
  'start_date', 'end_date', 'assignee', 'include_task_tags', 'include_location_names'
]);

async function callClickUp(url) {
  const pat = process.env.CLICKUP_PAT;
  if (!pat) {
    return { status: 500, body: { error: 'CLICKUP_PAT non configurato' } };
  }
  try {
    const r = await fetch(url, {
      headers: {
        'Authorization': pat,
        'Accept': 'application/json'
      }
    });
    let body;
    const text = await r.text();
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    return { status: r.status, body };
  } catch (e) {
    return { status: 502, body: { error: 'ClickUp fetch failed: ' + (e.message || String(e)) } };
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // === Auth ===
  const s = session.getSession(req);
  if (!s) return res.status(401).json({ error: 'Non autenticato' });

  const slug = req.query.slug ? String(req.query.slug).toLowerCase() : null;
  if (!slug) return res.status(400).json({ error: 'slug richiesto' });
  const client = CLIENTS[slug];
  if (!client) return res.status(404).json({ error: 'Cliente sconosciuto' });

  // Autorizzazione: admin OK ovunque, client solo sul proprio slug
  if (s.role !== 'admin' && s.slug !== slug) {
    return res.status(403).json({ error: 'Accesso non consentito a questo cliente' });
  }

  const endpoint = String(req.query.endpoint || '');
  let url;

  if (endpoint === 'tasks') {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query)) {
      if (ALLOWED_TASKS_PARAMS.has(k) && v != null && v !== '') {
        qs.append(k, String(v));
      }
    }
    url = CLICKUP_BASE + '/list/' + encodeURIComponent(client.listId) + '/task' +
          (qs.toString() ? '?' + qs.toString() : '');
  } else if (endpoint === 'time-entries') {
    const teamId = process.env.CLICKUP_TEAM_ID;
    if (!teamId) return res.status(500).json({ error: 'CLICKUP_TEAM_ID non configurato' });
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query)) {
      if (ALLOWED_TIME_PARAMS.has(k) && v != null && v !== '') {
        qs.append(k, String(v));
      }
    }
    url = CLICKUP_BASE + '/team/' + encodeURIComponent(teamId) + '/time_entries' +
          (qs.toString() ? '?' + qs.toString() : '');
  } else if (endpoint === 'task') {
    const taskId = req.query.task_id ? String(req.query.task_id) : null;
    if (!taskId) return res.status(400).json({ error: 'task_id richiesto' });
    // Niente check di appartenenza alla lista qui: chi ha credenziali admin/cliente
    // e conosce un task_id può chiederne il dettaglio. Il PAT è scoped al tuo account
    // ClickUp, quindi vede solo task a cui tu hai accesso.
    url = CLICKUP_BASE + '/task/' + encodeURIComponent(taskId);
  } else {
    return res.status(400).json({ error: 'Endpoint sconosciuto. Usa: tasks | time-entries | task' });
  }

  const r = await callClickUp(url);
  // Cache breve lato Vercel: 30 secondi è un buon compromesso (il dashboard ricarica
  // ogni volta che lo apri, ma se più persone aprono nello stesso minuto risparmiamo).
  res.setHeader('Cache-Control', 'private, max-age=30');
  res.status(r.status).json(r.body);
};
