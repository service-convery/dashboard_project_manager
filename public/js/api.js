// === Layer dati: proxy ClickUp, retry, paginazione e fetch delle 4 fonti ===
import {
  SLUG, T_FILTER, T_TIME, T_GET,
  PAGE_SIZE, MAX_PAGES, FETCH_PAGE_DELAY_MS
} from "./config.js";
import { state, health, retryStats } from "./state.js";
import { isClosedStatus } from "./format.js";
import { showError } from "./ui.js";

// Esegue fn su ogni item con al massimo `limit` chiamate in volo contemporaneamente.
// Evita di sparare decine/centinaia di fetch a ClickUp tutte insieme (causa di
// "fetch failed" per saturazione connessioni e rischio rate-limit 100 req/min).
const MAX_CONCURRENCY = 6;
async function mapLimit(items, limit, fn){
  const results = new Array(items.length);
  let next = 0;
  async function worker(){
    while (next < items.length){
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

// === Wrapper fetch verso il proxy serverless ===
export async function cuFetch(endpoint, args){
  if (!SLUG) throw new Error("slug mancante nell'URL");
  const url = new URL("/api/clickup", window.location.origin);
  url.searchParams.set("endpoint", endpoint);
  url.searchParams.set("slug", SLUG);
  Object.entries(args || {}).forEach(([k, v]) => {
    if (v !== null && v !== undefined && v !== "") {
      url.searchParams.set(k, String(v));
    }
  });
  const r = await fetch(url.toString(), { credentials: "same-origin" });
  if (r.status === 401) {
    // Sessione scaduta: redirect al login
    const back = encodeURIComponent(window.location.pathname);
    const sParam = SLUG ? ("&slug=" + encodeURIComponent(SLUG)) : "";
    window.location.href = "/?redirect=" + back + sParam;
    throw new Error("Sessione scaduta — redirezionamento al login");
  }
  if (r.status === 403) throw new Error("Accesso non consentito a questo cliente");
  if (!r.ok) {
    let detail = "";
    try { detail = await r.text(); } catch {}
    throw new Error("API " + r.status + (detail ? ": " + detail.slice(0, 200) : ""));
  }
  return await r.json();
}

// === Retry wrapper per le chiamate MCP ===
export async function callMcpWithRetry(name, args, opts){
  opts = opts || {};
  const maxAttempts = opts.maxAttempts != null ? opts.maxAttempts : 3;
  const backoffs = opts.backoffs || [0, 400, 1200];
  retryStats.calls += 1;
  let lastErr = null;
  let attemptsUsed = 0;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (backoffs[attempt]) await new Promise(r => setTimeout(r, backoffs[attempt]));
    attemptsUsed += 1;
    retryStats.attempts += 1;
    try {
      const r = await cuFetch(name, args);
      if (attempt > 0) retryStats.recovered += 1;
      return { ok: true, value: r, attempts: attemptsUsed, error: null };
    } catch (e) {
      lastErr = e;
      if (attempt === 0) retryStats.retried += 1;
      console.warn("MCP call " + name + " attempt " + (attempt + 1) + " failed:", e);
    }
  }
  retryStats.failed += 1;
  return { ok: false, value: null, attempts: attemptsUsed, error: lastErr };
}

// --- Defensive MCP response unwrap ---
// callMcpTool can return: a parsed object, a JSON string, or an MCP-style { content: [{ type:"text", text:"..." }] }
export function unwrap(resp){
  if (resp == null) return null;
  if (typeof resp === "string") {
    try { return JSON.parse(resp); } catch { return resp; }
  }
  if (Array.isArray(resp.content) && resp.content[0] && typeof resp.content[0].text === "string") {
    try { return JSON.parse(resp.content[0].text); } catch { return resp.content[0].text; }
  }
  if (resp.result && typeof resp.result === "object") return resp.result;
  return resp;
}

// Read tasks from any plausible shape
export function extractTasks(resp){
  const d = unwrap(resp);
  if (!d) return [];
  if (Array.isArray(d)) return d;
  if (Array.isArray(d.tasks)) return d.tasks;
  if (d.data && Array.isArray(d.data.tasks)) return d.data.tasks;
  return [];
}
export function extractEntries(resp){
  const d = unwrap(resp);
  if (!d) return [];
  let arr;
  if (Array.isArray(d)) arr = d;
  else if (Array.isArray(d.entries)) arr = d.entries;
  else if (Array.isArray(d.data)) arr = d.data;  // ClickUp REST shape
  else if (d.data && Array.isArray(d.data.entries)) arr = d.data.entries;
  else return [];
  // Normalizza shape: ClickUp REST ritorna duration/start/end come stringhe ms.
  // Il resto del codice usa e.duration_ms e e.start come numeri.
  return arr.map(e => {
    if (!e || typeof e !== "object") return e;
    const n = Object.assign({}, e);
    if (n.duration_ms == null) {
      if (n.duration != null) n.duration_ms = Number(n.duration);
    }
    if (typeof n.start === "string") n.start = Number(n.start);
    if (typeof n.end === "string") n.end = Number(n.end);
    return n;
  });
}

// === Pagina filter_tasks finché non abbiamo tutto ===
// La filter_tasks di ClickUp è paginata (100 task/pagina). Senza loop si rischia
// di vedere solo i primi 100. Filtro inoltre le subtask in modo difensivo
// (parent != null) anche se la chiamata API è già impostata con subtasks: false.
export async function paginateFilterTasks(baseArgs, healthEntry, errorLabel){
  const allTasks = [];
  const seen = new Set();
  let totalAttempts = 0;
  let totalRaw = 0;
  let subtaskFiltered = 0;
  let pagesLoaded = 0;
  let lastError = null;
  let aborted = false;
  let fellBack = false;
  let lastRawSample = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0 && FETCH_PAGE_DELAY_MS > 0) {
      await new Promise(res => setTimeout(res, FETCH_PAGE_DELAY_MS));
    }
    // IMPORTANTE: mantengo subtasks: true (come la versione storica funzionante).
    // Le subtask vengono filtrate lato client tramite parent != null.
    const args = Object.assign({}, baseArgs, { subtasks: true, page: page });
    const r = await callMcpWithRetry(T_FILTER, args);
    totalAttempts += r.attempts;
    if (!r.ok) {
      lastError = r.error;
      if (page === 0) {
        // Page 0 fallita: provo fallback senza paginazione (la chiamata "storica")
        console.warn("paginateFilterTasks page 0 errored, trying fallback without page param");
        break;
      }
      // Errore su pagina successiva: continuo con quello che ho, warn
      console.warn("paginateFilterTasks: pagina " + page + " fallita, dati parziali (pagine OK: " + pagesLoaded + ")");
      aborted = true;
      break;
    }
    if (page === 0) lastRawSample = r.value;
    const pageTasks = extractTasks(r.value);
    pagesLoaded++;
    pageTasks.forEach(t => {
      if (!t || !t.id) return;
      totalRaw++;
      // filtro difensivo subtask: ClickUp imposta parent != null sulle sotto-task
      if (t.parent != null) { subtaskFiltered++; return; }
      if (seen.has(t.id)) return;
      seen.add(t.id);
      allTasks.push(t);
    });
    // Se la pagina ritorna meno di PAGE_SIZE elementi, è l'ultima
    if (pageTasks.length < PAGE_SIZE) break;
  }

  // === Fallback se la paginazione non ha portato risultati ===
  // Riproduco esattamente la chiamata storica funzionante (no page, no subtasks override),
  // così copriamo anche il caso in cui il wrapper MCP rigetti i parametri page/subtasks.
  if (allTasks.length === 0 && !aborted) {
    const fbArgs = Object.assign({}, baseArgs);
    const fb = await callMcpWithRetry(T_FILTER, fbArgs);
    totalAttempts += fb.attempts;
    if (fb.ok) {
      lastRawSample = lastRawSample || fb.value;
      const fbTasks = extractTasks(fb.value);
      fbTasks.forEach(t => {
        if (!t || !t.id) return;
        totalRaw++;
        if (t.parent != null) { subtaskFiltered++; return; }
        if (seen.has(t.id)) return;
        seen.add(t.id);
        allTasks.push(t);
      });
      if (fbTasks.length > 0) {
        fellBack = true;
        pagesLoaded = 1; // contiamo il fallback come "pagina singola"
      }
    } else {
      lastError = fb.error;
    }
  }

  healthEntry.attempts = pagesLoaded > 0
    ? Math.round(totalAttempts / pagesLoaded * 10) / 10
    : totalAttempts;
  healthEntry.pages = pagesLoaded;
  healthEntry.raw = totalRaw;
  healthEntry.subtaskFiltered = subtaskFiltered;
  healthEntry.count = allTasks.length;
  healthEntry.fellBack = fellBack;
  // Salvo un sample della risposta per la diagnostica (massimo 400 char)
  try {
    healthEntry.sample = lastRawSample != null
      ? (typeof lastRawSample === "string"
          ? lastRawSample.slice(0, 400)
          : JSON.stringify(lastRawSample).slice(0, 400))
      : null;
  } catch(e) { healthEntry.sample = "(unserializable)"; }

  if (allTasks.length > 0) {
    healthEntry.state = aborted ? "warn" : "ok";
    healthEntry.error = aborted
      ? ("Errore pagina " + (pagesLoaded + 1) + " · dati parziali (" + allTasks.length + " task caricati)")
      : (fellBack ? "Fallback attivato: page param non supportato" : null);
  } else if (aborted || lastError) {
    healthEntry.state = "error";
    healthEntry.error = (lastError && lastError.message) || String(lastError) || "errore sconosciuto";
    if (lastError) showError(errorLabel + " (3 tentativi falliti)", lastError);
  } else {
    healthEntry.state = "warn";
    healthEntry.error = "API ha restituito 0 task (lista vuota o filtri troppo restrittivi)";
  }
  return { tasks: allTasks, error: lastError, aborted, fellBack };
}

export async function fetchTasks(){
  // Cache cross-settimana: i task della lista cambiano poco.
  if (state.allTasksCache) {
    health.tasks.state = "ok";
    health.tasks.count = state.allTasksCache.length;
    health.tasks.attempts = 0;
    return state.allTasksCache;
  }
  // list_id viene risolto server-side dallo slug. Non lo passiamo al proxy.
  const res = await paginateFilterTasks(
    { include_closed: true },
    health.tasks,
    "Errore caricamento task ClickUp"
  );
  // Salviamo in cache solo se abbiamo dati (anche parziali sono utili da visualizzare,
  // ma li ricarichiamo al prossimo refresh della pagina).
  if (res.tasks.length > 0 && !res.aborted) {
    state.allTasksCache = res.tasks;
  }
  return res.tasks;
}

// Recupera i task completati (date_done) nella settimana selezionata. Dipende dalla
// settimana, quindi NON viene cachato come la lista principale.
// `weekEnd` è la FINE della finestra completati: passiamo la domenica (sun), non il
// venerdì, così i task chiusi nel weekend rientrano comunque nella settimana.
export async function fetchClosedThisWeek(mon, weekEnd){
  // ClickUp REST usa millisecondi UNIX per date_done_gt/lt (strict gt/lt).
  // Sottraiamo/aggiungiamo 1ms per inclusività della finestra [mon 00:00, weekEnd 23:59:59.999].
  const res = await paginateFilterTasks(
    {
      include_closed: true,
      date_done_gt: mon.getTime() - 1,
      date_done_lt: weekEnd.getTime() + 1
    },
    health.closed,
    "Errore caricamento task completati"
  );
  if (res.aborted && res.tasks.length === 0) return [];
  // Per sicurezza tengo solo quelli con status effettivamente di chiusura.
  const closed = res.tasks.filter(isClosedStatus);
  // Aggiorno il count dei completati post-filtro per coerenza (paginateFilterTasks
  // aveva impostato count = totale post-dedup, qui restringo agli status di chiusura).
  health.closed.count = closed.length;
  if (health.closed.state !== "warn") health.closed.state = "ok";
  return closed;
}

// Recupera time_estimate per una lista esplicita di task: filter_tasks non lo include,
// quindi faccio una get_task per ciascuno in parallelo. Cachato per ID.
export async function fetchEstimates(taskList){
  if (!state.estimatesCache) state.estimatesCache = new Map();

  // Dedup per id (la lista può contenere aperti + chiusi della settimana).
  const seen = new Set();
  const candidates = [];
  (taskList || []).forEach(t => {
    if (t && t.id && !seen.has(t.id)) { seen.add(t.id); candidates.push(t); }
  });

  const missing = candidates.filter(t => !state.estimatesCache.has(t.id));
  // Se tutto è già cachato, segno comunque la salute come OK con il count dei cache hit.
  if (missing.length === 0) {
    let withEst = 0;
    candidates.forEach(t => { const v = state.estimatesCache.get(t.id); if (v != null && v > 0) withEst++; });
    health.estimates.state = "ok";
    health.estimates.count = withEst;
    health.estimates.attempts = 0;
    return state.estimatesCache;
  }

  state.estimatesDiag = { requested: missing.length, succeeded: 0, withEstimate: 0, errors: [], rawSample: null, parsedSample: null, sampleTaskId: null };

  // Concorrenza limitata: una get_task per task, ma max MAX_CONCURRENCY in volo.
  const results = await mapLimit(missing, MAX_CONCURRENCY, async (t) => {
    const r = await callMcpWithRetry(T_GET, { task_id: t.id });
    return { id: t.id, rawResp: r.value, data: r.ok ? unwrap(r.value) : null, error: r.error, ok: r.ok, attempts: r.attempts };
  });
  let totalAttempts = 0;
  results.forEach((r, idx) => {
    totalAttempts += r.attempts || 0;
    // Catturo un sample della prima response cruda per debug shape
    if (idx === 0) {
      state.estimatesDiag.sampleTaskId = r.id;
      try {
        state.estimatesDiag.rawSample = (typeof r.rawResp === "string")
          ? r.rawResp.slice(0, 400)
          : JSON.stringify(r.rawResp, null, 2).slice(0, 600);
      } catch (e) { state.estimatesDiag.rawSample = String(r.rawResp).slice(0, 400); }
      try {
        state.estimatesDiag.parsedSample = (r.data && typeof r.data === "object")
          ? JSON.stringify({ keys: Object.keys(r.data).slice(0, 25), time_estimate: r.data.time_estimate, time_spent: r.data.time_spent, status: r.data.status }, null, 2)
          : String(r.data);
      } catch (e) { state.estimatesDiag.parsedSample = "parse error: " + e.message; }
    }
    let est = null;
    if (!r.ok) {
      state.estimatesDiag.errors.push((r.error && r.error.message) ? r.error.message : String(r.error));
    } else if (r.data && typeof r.data === "object") {
      state.estimatesDiag.succeeded++;
      const v = r.data.time_estimate;
      if (v != null && !isNaN(Number(v)) && Number(v) > 0) {
        est = Number(v);
        state.estimatesDiag.withEstimate++;
      }
    } else {
      // Risposta vuota o in formato non riconosciuto: lo segnalo come errore di shape.
      state.estimatesDiag.errors.push("response shape non riconosciuta per task " + r.id);
    }
    state.estimatesCache.set(r.id, est); // null se non disponibile / fallita
  });

  // Aggiorno salute stime: ok se tutte risuscite, warn se parziali, error se nessuna.
  health.estimates.attempts = missing.length > 0 ? Math.round(totalAttempts / missing.length * 10) / 10 : 0;
  // Conta totale dei task con stima nel set candidates (incluso cache prima)
  let withEstTotal = 0;
  candidates.forEach(t => { const v = state.estimatesCache.get(t.id); if (v != null && v > 0) withEstTotal++; });
  health.estimates.count = withEstTotal;
  if (state.estimatesDiag.errors.length === 0) {
    health.estimates.state = "ok";
  } else if (state.estimatesDiag.succeeded > 0) {
    health.estimates.state = "warn";
    health.estimates.error = state.estimatesDiag.errors.length + " su " + missing.length + " chiamate fallite";
  } else {
    health.estimates.state = "error";
    health.estimates.error = "tutte le " + missing.length + " chiamate get_task fallite";
  }
  return state.estimatesCache;
}

// IMPORTANTE: il PAT ClickUp senza filtro assignee ritorna SOLO le entries
// dell'utente del token. Per coprire tutto il team chiamo una volta per ciascun
// assegnatario unico dei task della board e dedup-o le entries per id.
// ClickUp REST usa start_date/end_date in millisecondi UNIX.
export async function fetchEntries(allTasks, mon, weekEnd){
  const userIds = new Set();
  allTasks.forEach(t => {
    if (Array.isArray(t.assignees)) {
      t.assignees.forEach(a => { if (a && a.id != null) userIds.add(a.id); });
    }
  });

  const startMs = mon.getTime();
  const endMs   = weekEnd.getTime();

  const argSets = userIds.size === 0
    ? [{ start_date: startMs, end_date: endMs }]
    : [...userIds].map(uid => ({ start_date: startMs, end_date: endMs, assignee: uid }));
  const settled = await mapLimit(argSets, MAX_CONCURRENCY, (args) => callMcpWithRetry(T_TIME, args));

  // Aggrega salute: se TUTTE le chiamate sono fallite -> error; se qualcuna -> warn; tutte ok -> ok.
  const failedCount = settled.filter(r => !r.ok).length;
  const totalAttempts = settled.reduce((s, r) => s + (r.attempts || 0), 0);
  health.entries.attempts = settled.length > 0 ? Math.round(totalAttempts / settled.length * 10) / 10 : 0;

  if (failedCount === settled.length && settled.length > 0) {
    health.entries.state = "error";
    health.entries.error = "tutte le " + settled.length + " chiamate get_time_entries fallite";
    showError("Errore caricamento ore tracciate (3 tentativi falliti)", settled[0] && settled[0].error);
    return [];
  }

  const seen = new Set();
  const merged = [];
  settled.forEach(r => {
    if (!r.ok) return;
    extractEntries(r.value).forEach(e => {
      if (!e) return;
      const key = e.id || (e.start + "|" + (e.task && e.task.id) + "|" + e.duration_ms);
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(e);
    });
  });

  health.entries.count = merged.length;
  if (failedCount > 0) {
    health.entries.state = "warn";
    health.entries.error = failedCount + " su " + settled.length + " chiamate fallite (dati parziali)";
  } else {
    health.entries.state = "ok";
  }
  return merged;
}

// Elenco dei membri del workspace (id + username), cachato. Serve a interrogare le
// time-entry di TUTTI gli utenti che hanno loggato ore, non solo degli assegnatari
// dei task. Se la chiamata fallisce ritorna [] (si ricade sugli assegnatari).
export async function fetchTeamMembers(){
  if (state.teamMembersCache) return state.teamMembersCache;
  try {
    const d = unwrap(await cuFetch("team-members", {}));
    const members = (d && Array.isArray(d.members)) ? d.members : [];
    state.teamMembersCache = members;
    return members;
  } catch (e) {
    console.warn("fetchTeamMembers fallita:", e);
    return [];
  }
}

// Variante di fetchEntries per un range arbitrario (es. dataInizio → oggi), usata
// dalla vista "Consumo ore". Non tocca lo stato `health` della vista settimanale.
// Ritorna { entries, failed, total } con le entries dedupate per id.
// L'universo di assignee interrogati è l'insieme di TUTTI i membri del workspace
// (così catturiamo chiunque abbia loggato ore sui task della lista, non solo gli
// assegnatari), unito agli assegnatari dei task come fallback (es. guest non in /team).
export async function fetchEntriesRange(allTasks, start, end){
  const userIds = new Set();
  const members = await fetchTeamMembers();
  members.forEach(m => { if (m && m.id != null) userIds.add(m.id); });
  allTasks.forEach(t => {
    if (Array.isArray(t.assignees)) {
      t.assignees.forEach(a => { if (a && a.id != null) userIds.add(a.id); });
    }
  });

  const startMs = start.getTime();
  const endMs   = end.getTime();

  const argSets = userIds.size === 0
    ? [{ start_date: startMs, end_date: endMs }]
    : [...userIds].map(uid => ({ start_date: startMs, end_date: endMs, assignee: uid }));
  const settled = await mapLimit(argSets, MAX_CONCURRENCY, (args) => callMcpWithRetry(T_TIME, args));
  const failed = settled.filter(r => !r.ok).length;
  const seen = new Set();
  const entries = [];
  settled.forEach(r => {
    if (!r.ok) return;
    extractEntries(r.value).forEach(e => {
      if (!e) return;
      const key = e.id || (e.start + "|" + (e.task && e.task.id) + "|" + e.duration_ms);
      if (seen.has(key)) return;
      seen.add(key);
      entries.push(e);
    });
  });

  return { entries, failed, total: settled.length };
}
