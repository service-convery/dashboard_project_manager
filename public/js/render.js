// === Rendering del DOM: salute fonti, diagnostica, KPI/grafici e tabella ===
import { EXCLUDED_STATUSES } from "./config.js";
import { state, health, retryStats } from "./state.js";
import { escapeHtml, fmtDay, fmtHM, initials, statusClass, isClosedStatus } from "./format.js";
import { renderHoursChart, renderStatusChart } from "./charts.js";
import { resolveView, combinedViews, viewFilter } from "./tag-views.mjs";
import { tasksById, containerIds } from "./packages.mjs";

export function renderHealth(){
  const row = document.getElementById("healthRow");
  if (!row) return;
  const items = [health.tasks, health.closed, health.entries, health.estimates];
  let html = '<span class="health-label">Origine dati</span>';
  items.forEach(h => {
    const stateClass = "health-" + (h.state || "pending");
    let stateText;
    if (h.state === "ok") {
      stateText = '<span class="health-count">' + h.count + '</span>' + (h.unit ? ' ' + h.unit : '');
    } else if (h.state === "warn") {
      stateText = '<span class="health-count">' + h.count + '</span>' + (h.unit ? ' ' + h.unit : '') + ' · parziale';
    } else if (h.state === "error") {
      stateText = 'errore';
    } else {
      stateText = 'caricamento…';
    }
    let title;
    if (h.error) title = "Stato: " + h.state + " · " + h.error;
    else if (h.attempts > 1) title = "Riuscito al tentativo " + h.attempts + " (retry automatico)";
    else if (h.state === "ok") title = "Caricato al primo tentativo";
    else title = "Stato: " + h.state;
    if (h.pages) title += " · " + h.pages + " pagine";
    if (h.subtaskFiltered) title += " · " + h.subtaskFiltered + " subtask escluse";
    html += '<span class="health-item ' + stateClass + '" title="' + escapeHtml(title) + '">' +
            '<span class="health-dot"></span>' + escapeHtml(h.label) + ': ' + stateText + '</span>';
  });
  if (retryStats.retried > 0) {
    const retryClass = retryStats.failed > 0 ? "health-warn" : "health-ok";
    const retryTitle = "Retry attivati: " + retryStats.retried +
                       " · recuperati: " + retryStats.recovered +
                       " · falliti definitivamente: " + retryStats.failed;
    html += '<span class="health-item ' + retryClass + '" title="' + escapeHtml(retryTitle) + '">' +
            '<span class="health-dot"></span>Retry: ' +
            '<span class="health-count">' + retryStats.recovered + '/' + retryStats.retried + '</span></span>';
  }
  row.innerHTML = html;
}

export function renderDiag(){
  // Popola sempre il contenuto, ma NON forza visibilità: il toggle in fondo controlla
  // se mostrarlo. La diagnostica resta utile in caso di problemi futuri.
  const box = document.getElementById("diagBox");
  if (!box) return;

  // === Sezione retry / fonti dati ===
  let html = '<div class="diag-title">Retry &amp; salute fonti dati</div>';
  html += '<div>Chiamate MCP totali: <strong>' + retryStats.calls + '</strong>' +
          ' &middot; tentativi: <strong>' + retryStats.attempts + '</strong>' +
          ' &middot; retry attivati: <strong>' + retryStats.retried + '</strong>' +
          ' &middot; recuperati: <strong>' + retryStats.recovered + '</strong>' +
          ' &middot; falliti definitivamente: <strong>' + retryStats.failed + '</strong></div>';
  html += '<div style="margin-top:6px;">';
  Object.values(health).forEach(h => {
    html += '<div>&bull; ' + escapeHtml(h.label) + ': <code>' + escapeHtml(h.state) +
            '</code>' + (h.count ? ' (' + h.count + (h.unit ? ' ' + h.unit : '') + ')' : '') +
            (h.pages ? ' &middot; pagine: ' + h.pages : '') +
            (h.raw && h.raw !== h.count ? ' &middot; raw: ' + h.raw : '') +
            (h.subtaskFiltered ? ' &middot; subtask escluse: ' + h.subtaskFiltered : '') +
            (h.fellBack ? ' &middot; <span style="color:var(--warning);">fallback attivato</span>' : '') +
            (h.attempts ? ' &middot; tentativi medi: ' + h.attempts : '') +
            (h.error ? ' &middot; <span style="color:var(--error);">' + escapeHtml(h.error) + '</span>' : '') +
            '</div>';
    if (h.sample) {
      html += '<details style="margin: 2px 0 6px 14px;"><summary style="cursor:pointer;font-size:11px;color:var(--text-muted);">Sample risposta</summary>' +
              '<pre style="margin:4px 0 0;max-height:140px;overflow:auto;background:rgba(0,0,0,0.04);padding:6px;border-radius:4px;font-size:10.5px;">' +
              escapeHtml(h.sample) + '</pre></details>';
    }
  });
  html += '</div>';

  // === Sezione stime (legacy) ===
  const d = state.estimatesDiag;
  html += '<div class="diag-title" style="margin-top:14px;">Diagnostica caricamento stime</div>';
  if (!d || d.requested === 0) {
    html += '<div>Nessuna chiamata <code>get_task</code> registrata in questa sessione (cache stime gi&agrave; popolata).</div>';
  } else {
    const hasErrors = d.errors.length > 0;
    const noEstimates = d.withEstimate === 0;
    html += '<div>Chiamate <code>get_task</code>: ' + d.succeeded + ' riuscite su ' + d.requested +
            ' &middot; task con <code>time_estimate</code> &gt; 0: <strong>' + d.withEstimate + '</strong></div>';
    if (hasErrors) {
      const shown = d.errors.slice(0,3).map(e => escapeHtml(e)).join("<br>");
      html += '<div style="margin-top:6px;color:var(--error);">Errori: ' + shown + (d.errors.length > 3 ? "<br>… e altri " + (d.errors.length-3) : "") + '</div>';
    }
    if (d.parsedSample) {
      html += '<details style="margin-top:8px;"><summary style="cursor:pointer;font-weight:600;">Sample risposta task ' + escapeHtml(d.sampleTaskId || "?") + ' (parsed)</summary>' +
              '<pre style="margin:6px 0 0;max-height:180px;overflow:auto;background:rgba(0,0,0,0.04);padding:8px;border-radius:4px;font-size:11px;">' +
              escapeHtml(d.parsedSample) + '</pre></details>';
    }
    if (d.rawSample) {
      html += '<details style="margin-top:6px;"><summary style="cursor:pointer;font-weight:600;">Sample risposta cruda (primi caratteri)</summary>' +
              '<pre style="margin:6px 0 0;max-height:180px;overflow:auto;background:rgba(0,0,0,0.04);padding:8px;border-radius:4px;font-size:11px;">' +
              escapeHtml(d.rawSample) + '</pre></details>';
    }
    if (noEstimates && !hasErrors && d.succeeded > 0) {
      html += '<div style="margin-top:8px;">Le chiamate sono andate a buon fine ma il campo <code>time_estimate</code> risulta vuoto o non leggibile. Apri uno dei sample qui sopra per vedere come arriva la risposta.</div>';
    }
  }

  box.innerHTML = html;
}

// Vista attiva risolta (kind + tags) da config + state.activeView.
function activeView(){
  const cfg = state.clientConfig || {};
  return resolveView(combinedViews(cfg), state.activeView);
}

export function render(allTasks, entries, estimates, closedThisWeek, mon, sun){
  // Salva gli input NON filtrati: il cambio vista re-renderizza ri-filtrando questi.
  state.lastRenderInputs = { allTasks, entries, estimates, closedThisWeek, mon, sun };

  // Sub-task: i padri-contenitore non compaiono come righe (diventano gruppi), MA il
  // tempo loggato direttamente su di essi è tempo reale della lista e va contato nei
  // totali ore. Tengo quindi due insiemi: le foglie (per tabella/lista task) e tutti i
  // task della lista (per il calcolo ore), entrambi filtrati per la vista tag attiva.
  const byId = tasksById(allTasks);
  const containers = containerIds(allTasks);

  // Filtro "alla sorgente" secondo il tipo di vista attiva (vedi viewFilter):
  // "all" nessun filtro · "task" tag effettivi del task · "entry" task con ore taggate,
  // con le entry (per le ore) ristrette alle sole taggate.
  const view = activeView();
  const { taskMatches: matches, scopedEntries } = viewFilter(view, entries, byId);
  const allMatched = allTasks.filter(matches);
  const closedMatched = (Array.isArray(closedThisWeek) ? closedThisWeek : []).filter(matches);

  // Per tabella / lista task aperti: solo le foglie (i padri restano contenitori).
  allTasks = allMatched.filter(t => !containers.has(t.id));
  closedThisWeek = closedMatched.filter(t => !containers.has(t.id));

  // Id-set per il CALCOLO ORE: TUTTI i task della lista (foglie + padri, aperti + chiusi).
  // Così le time-entry loggate su un task-padre vengono conteggiate (prima erano perse).
  const taskIdSet = new Set([...allMatched, ...closedMatched].map(t => t.id));

  // task aperti: escludi status "da fare", "completato" e altri stati di chiusura
  const openTasks = allTasks.filter(t => {
    const s = t && t.status;
    const v = (s && typeof s === "object" && s.status) ? s.status : s;
    return !EXCLUDED_STATUSES.has(String(v || "").toLowerCase().trim());
  });

  // task completati nella settimana selezionata (query dedicata, dedup per id)
  const closedTasks = Array.isArray(closedThisWeek) ? closedThisWeek : [];
  const openIds = new Set(openTasks.map(t => t.id));
  const closedUnique = closedTasks.filter(t => t && t.id && !openIds.has(t.id));

  const monMs = mon.getTime();
  const sunMs = sun.getTime();
  const nowMs = Date.now();

  let thisWeekCount = 0;
  let estimatedWeekMs = 0;
  let weekTasksWithEstimate = 0;
  let weekTasksTotal = 0;

  // Stime dei task aperti con scadenza nella settimana
  openTasks.forEach(t => {
    if (!t.due_date) return;
    const d = parseInt(t.due_date, 10);
    if (isNaN(d)) return;
    if (d >= monMs && d <= sunMs) {
      thisWeekCount++;
      weekTasksTotal++;
      const est = estimates && estimates.get ? estimates.get(t.id) : null;
      if (est != null && !isNaN(est) && est > 0) {
        estimatedWeekMs += est;
        weekTasksWithEstimate++;
      }
    }
  });

  // Stime dei task completati nella settimana (lun–dom): vanno comunque conteggiate
  closedUnique.forEach(t => {
    weekTasksTotal++;
    const est = estimates && estimates.get ? estimates.get(t.id) : null;
    if (est != null && !isNaN(est) && est > 0) {
      estimatedWeekMs += est;
      weekTasksWithEstimate++;
    }
  });

  // time entries della settimana relative ai task della lista (in vista "entry"
  // sono già ristrette alle sole entry taggate, così le ore riflettono l'extra).
  const ourEntries = scopedEntries.filter(e => e && e.task && taskIdSet.has(e.task.id));
  const hoursByDay = [0,0,0,0,0,0,0]; // lun..dom
  const hoursByTask = new Map();
  let totalMs = 0;
  ourEntries.forEach(e => {
    const ms = Number(e.duration_ms) || 0;
    totalMs += ms;
    const startMs = Number(e.start);
    if (!isNaN(startMs)) {
      const ed = new Date(startMs);
      const dow = ed.getDay();
      const idx = (dow === 0) ? 6 : dow - 1; // dom→6, lun→0 … sab→5
      if (idx >= 0 && idx <= 6) hoursByDay[idx] += ms;
    }
    if (e.task && e.task.id) hoursByTask.set(e.task.id, (hoursByTask.get(e.task.id) || 0) + ms);
  });

  // KPI
  document.getElementById("kpiOpen").textContent = openTasks.length;
  document.getElementById("kpiThisWeek").textContent = thisWeekCount;
  document.getElementById("kpiCompleted").textContent = closedUnique.length;
  document.getElementById("kpiHours").textContent = fmtHM(totalMs);
  document.getElementById("kpiEstimated").textContent = fmtHM(estimatedWeekMs);
  // Sub-label diagnostico: dice quanti task della settimana hanno una stima impostata.
  // weekTasksTotal include sia gli aperti in scadenza sia i completati della settimana.
  const subEst = document.getElementById("kpiEstimatedSub");
  if (subEst) {
    if (weekTasksTotal === 0) subEst.textContent = "nessun task nella settimana";
    else if (weekTasksWithEstimate === 0) subEst.textContent = "nessun task con stima impostata";
    else subEst.textContent = weekTasksWithEstimate + " di " + weekTasksTotal + " task con stima";
  }

  // Status breakdown sui task aperti
  const statusCounts = new Map();
  openTasks.forEach(t => {
    const s = t && t.status;
    const v = (s && typeof s === "object" && s.status) ? s.status : s;
    const label = (v || "—").toString();
    statusCounts.set(label, (statusCounts.get(label) || 0) + 1);
  });
  document.getElementById("statusMeta").textContent = openTasks.length + " task";

  renderHoursChart(hoursByDay);
  renderStatusChart(statusCounts);

  // Salvo i dati per poter rifiltrare la tabella senza ricaricare
  state.lastRender = { openTasks, closedUnique, hoursByTask, estimates, monMs, sunMs, nowMs };
  renderTable();
}

export function renderTable(){
  if (!state.lastRender) return;
  const { openTasks, closedUnique, hoursByTask, estimates, monMs, sunMs, nowMs } = state.lastRender;

  // Applica il filtro corrente. I task completati nella settimana sono sempre inclusi
  // (per definizione appartengono alla settimana selezionata).
  let filtered;
  if (state.tableFilter === "week") {
    const openInWeek = openTasks.filter(t => {
      if (!t.due_date) return false;
      const d = parseInt(t.due_date, 10);
      return !isNaN(d) && d >= monMs && d <= sunMs;
    });
    filtered = openInWeek.concat(closedUnique);
  } else {
    filtered = openTasks.concat(closedUnique);
  }

  // Ordina per scadenza (no due in fondo)
  filtered.sort((a,b) => {
    const da = a.due_date ? parseInt(a.due_date,10) : Infinity;
    const db = b.due_date ? parseInt(b.due_date,10) : Infinity;
    return da - db;
  });

  // Aggiorno UI del toggle e meta
  document.getElementById("filterWeek").classList.toggle("active", state.tableFilter === "week");
  document.getElementById("filterAll").classList.toggle("active", state.tableFilter === "all");
  document.getElementById("filterWeek").setAttribute("aria-selected", state.tableFilter === "week");
  document.getElementById("filterAll").setAttribute("aria-selected", state.tableFilter === "all");

  const closedN = closedUnique.length;
  const countLabel = "· " + filtered.length +
    (closedN > 0 ? " (di cui " + closedN + " completati)" : "");
  document.getElementById("taskCount").textContent = countLabel;

  document.getElementById("tableMeta").textContent =
    (state.tableFilter === "week")
      ? "Task con scadenza nella settimana + task completati nella settimana · ordinati per scadenza"
      : "Tutti i task aperti + i completati di questa settimana · ordinati per scadenza";

  const body = document.getElementById("tasksBody");
  body.innerHTML = "";

  if (filtered.length === 0) {
    const msg = (state.tableFilter === "week")
      ? 'Nessun task con scadenza o completato in questa settimana.'
      : 'Nessun task da mostrare in questa lista.';
    body.innerHTML = '<tr><td colspan="7" class="empty">' + msg + '</td></tr>';
    return;
  }

  filtered.forEach(t => {
    const tr = document.createElement("tr");
    const closed = isClosedStatus(t);
    let dueClass = "due";
    let dueText = "—";
    let inThisWeek = false;
    if (t.due_date) {
      const d = parseInt(t.due_date,10);
      const dd = new Date(d);
      dueText = fmtDay(dd);
      // I task completati non vanno mai marcati come "in ritardo".
      if (d >= monMs && d <= sunMs) { dueClass += " in-week"; inThisWeek = true; }
      else if (d < nowMs && !closed) dueClass += " overdue";
    }
    if (inThisWeek && !closed) tr.classList.add("this-week");
    if (closed) tr.classList.add("task-closed");

    const assignees = Array.isArray(t.assignees) ? t.assignees : [];
    const assigneesHtml = assignees.length
      ? '<div class="assignees">' + assignees.map(a =>
          '<span class="avatar" title="' + escapeHtml(a.username || "") + '">' + escapeHtml(initials(a.username)) + '</span>'
        ).join("") + '</div>'
      : '<span style="color:var(--text-muted);font-size:12px;">non assegnato</span>';

    const prioRaw = t.priority && typeof t.priority === "object" ? (t.priority.priority || "") : (t.priority || "");
    const prio = prioRaw ? String(prioRaw).toLowerCase() : "";
    const prioHtml = prio
      ? '<span class="prio ' + escapeHtml(prio) + '"><span class="dot"></span>' + escapeHtml(prio) + '</span>'
      : '<span class="prio"><span class="dot"></span>—</span>';

    const statusRaw = t.status && typeof t.status === "object" ? t.status.status : t.status;
    const stClass = statusClass(statusRaw);
    const stHtml = '<span class="badge ' + stClass + '">' + escapeHtml(statusRaw || "—") + '</span>';

    const ms = hoursByTask.get(t.id) || 0;
    const hoursHtml = '<span class="hours' + (ms === 0 ? ' zero' : '') + '">' + fmtHM(ms) + '</span>';

    const estMs = (estimates && estimates.get) ? estimates.get(t.id) : null;
    const estHtml = (estMs == null || isNaN(estMs))
      ? '<span class="hours zero">—</span>'
      : '<span class="hours">' + fmtHM(estMs) + '</span>';

    tr.innerHTML =
      '<td><div class="task-name"><a href="' + escapeHtml(t.url || "#") + '" target="_blank" rel="noopener">' + escapeHtml(t.name || "(senza titolo)") + '</a></div>' +
      (t.custom_id ? '<span class="task-id">' + escapeHtml(t.custom_id) + '</span>' : "") + '</td>' +
      '<td>' + stHtml + '</td>' +
      '<td>' + prioHtml + '</td>' +
      '<td>' + assigneesHtml + '</td>' +
      '<td><span class="' + dueClass + '">' + dueText + '</span></td>' +
      '<td style="text-align:right;">' + estHtml + '</td>' +
      '<td style="text-align:right;">' + hoursHtml + '</td>';
    body.appendChild(tr);
  });
}

// Ri-renderizza il tab Settimanale ri-filtrando gli ultimi input (cambio vista, niente fetch).
export function rerender(){
  const i = state.lastRenderInputs;
  if (!i) return;
  render(i.allTasks, i.entries, i.estimates, i.closedThisWeek, i.mon, i.sun);
}
