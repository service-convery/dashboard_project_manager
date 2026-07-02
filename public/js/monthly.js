// === Vista "Mensile": andamento del mese ===
// Mostra i task con SCADENZA nel mese OPPURE COMPLETATI nel mese (status ≠ "da fare"),
// con KPI riassuntivi, distribuzione per status e tabella con le ore tracciate nel mese.
// Lazy-load al primo accesso del tab; la navigazione ◀▶ ricarica completati+ore del mese.
import { MONTHS } from "./config.js";
import { state } from "./state.js";
import { fetchTasks, fetchClosedThisWeek, fetchEntriesRange } from "./api.js";
import { escapeHtml, statusClass, statusText, initials, isClosedStatus, fmtDayYear, fmtHM, getMonthRange } from "./format.js";
import { renderStatusChart, snapshotChartsForPrint } from "./charts.js";
import { resolveView, combinedViews, viewFilter } from "./tag-views.mjs";
import { tasksById, containerIds } from "./packages.mjs";

let loaded = false; // lazy-load: la vista si carica una sola volta

// Vista attiva risolta (kind + tags), coerente con gli altri tab.
function activeView(){
  const cfg = state.clientConfig || {};
  return resolveView(combinedViews(cfg), state.activeView);
}

export async function loadMonthlyView(){
  if (loaded) return;
  loaded = true;
  await refreshMonthlyData();
}

// (Ri)carica i task completati e le ore del mese selezionato, poi renderizza.
async function refreshMonthlyData(){
  const container = document.getElementById("viewMonthly");
  container.innerHTML = '<div class="hours-loading"><span class="spinner"></span> Caricamento andamento del mese…</div>';
  try {
    const { start, end } = getMonthRange(state.monthOffset);
    const tasks = await fetchTasks(); // cache condivisa
    const [closed, entriesRes] = await Promise.all([
      fetchClosedThisWeek(start, end),     // task completati nel mese (range date_done)
      fetchEntriesRange(tasks, start, end) // time-entry del mese
    ]);
    state.monthlyData = { tasks, closed, entries: entriesRes.entries || [], start, end };
    renderMonthlyFromCache();
  } catch (e) {
    container.innerHTML = '<div class="hours-note hours-error">Errore nel caricamento dell\'andamento mensile: ' +
      escapeHtml(e && e.message ? e.message : String(e)) + '</div>';
    loaded = false; // consenti un nuovo tentativo
  }
}

// Ri-renderizza dai dati in cache (cambio vista tag). No-op se non ancora caricato.
export function rerenderMonthlyView(){
  if (!loaded || !state.monthlyData) return;
  renderMonthlyFromCache();
}

function isDaFare(t){
  return statusText(t.status).toLowerCase().trim() === "da fare";
}

function renderMonthlyFromCache(){
  const container = document.getElementById("viewMonthly");
  const { tasks, closed, entries, start, end } = state.monthlyData;
  const startMs = start.getTime(), endMs = end.getTime();

  // Universo: cache task + completati nel mese, deduplicati per id.
  const byIdAll = new Map();
  [...tasks, ...closed].forEach(t => { if (t && t.id != null && !byIdAll.has(t.id)) byIdAll.set(t.id, t); });
  const all = [...byIdAll.values()];
  const byId = tasksById(all);
  const containers = containerIds(all);
  const view = activeView();

  // Le entry arrivano per-utente (tutto ciò che hanno tracciato): le restringo
  // ai task DI QUESTA lista, altrimenti conterei ore di altri clienti.
  const listIds = new Set(all.map(t => t.id));
  const listEntries = entries.filter(e => e && e.task && listIds.has(e.task.id));
  // Filtro per tipo di vista (vedi viewFilter): in vista "entry" le ore contano solo
  // le entry taggate (scopedListEntries).
  const { taskMatches: matchesView, scopedEntries: scopedListEntries } = viewFilter(view, listEntries, byId);

  const inMonth = (t) => {
    const due = t.due_date ? parseInt(t.due_date, 10) : null;
    const done = t.date_done ? parseInt(t.date_done, 10) : null;
    return (due != null && due >= startMs && due <= endMs) ||
           (done != null && done >= startMs && done <= endMs);
  };

  // Task del mese: foglie, vista match, status ≠ "da fare", nel mese.
  const monthTasks = all.filter(t =>
    !containers.has(t.id) && matchesView(t) && !isDaFare(t) && inMonth(t)
  );

  // Ore tracciate nel mese per task (solo task della lista; in vista "entry" solo extra).
  const msByTask = new Map();
  scopedListEntries.forEach(e => {
    const id = e.task.id;
    msByTask.set(id, (msByTask.get(id) || 0) + (Number(e.duration_ms) || 0));
  });

  // KPI.
  const total = monthTasks.length;
  const done = monthTasks.filter(isClosedStatus).length;
  const inProgress = total - done;
  const totalWorkedMs = scopedListEntries.reduce((s, e) => s + (Number(e.duration_ms) || 0), 0);

  // Distribuzione per status.
  const statusCounts = new Map();
  monthTasks.forEach(t => {
    const label = statusText(t.status) || "—";
    statusCounts.set(label, (statusCounts.get(label) || 0) + 1);
  });

  // Righe tabella, ordinate per scadenza (senza scadenza in fondo), poi nome.
  const rows = monthTasks.map(t => ({
    name: t.name || "(senza titolo)",
    url: t.url || null,
    status: t.status,
    due: t.due_date ? parseInt(t.due_date, 10) : null,
    closedAt: t.date_done ? parseInt(t.date_done, 10) : null,
    assignees: Array.isArray(t.assignees) ? t.assignees : [],
    ms: msByTask.get(t.id) || 0
  })).sort((a, b) =>
    (a.due == null ? Infinity : a.due) - (b.due == null ? Infinity : b.due) ||
    a.name.localeCompare(b.name)
  );

  renderMonthly(container, { start, total, done, inProgress, totalWorkedMs, statusCounts, rows });
}

function kpiCard(label, value, sub, extraClass){
  return '<div class="kpi' + (extraClass ? " " + extraClass : "") + '">' +
    '<div class="label">' + escapeHtml(label) + '</div>' +
    '<div class="value">' + escapeHtml(String(value)) + '</div>' +
    '<div class="sub">' + escapeHtml(sub) + '</div></div>';
}

function monthTag(offset){
  if (offset === 0) return "questo mese";
  if (offset === -1) return "mese scorso";
  if (offset === 1) return "mese prossimo";
  return (offset > 0 ? "+" + offset : String(offset)) + " mesi";
}

function tableHtml(rows){
  let h = '<div class="table-wrap"><table class="tasks"><thead><tr>' +
    '<th>Task</th><th>Stato</th><th>Scadenza</th><th>Completato il</th><th>Persone</th>' +
    '<th style="text-align:right;">Ore (mese)</th></tr></thead><tbody>';
  if (!rows.length) {
    h += '<tr><td colspan="6" class="empty">Nessun task in questo mese.</td></tr>';
  } else {
    rows.forEach(r => {
      const st = statusText(r.status) || "—";
      const stHtml = '<span class="badge ' + statusClass(st) + '">' + escapeHtml(st) + '</span>';
      const nameHtml = r.url
        ? '<a href="' + escapeHtml(r.url) + '" target="_blank" rel="noopener">' + escapeHtml(r.name) + '</a>'
        : escapeHtml(r.name);
      const assHtml = r.assignees.length
        ? '<div class="assignees">' + r.assignees.map(a =>
            '<span class="avatar" title="' + escapeHtml(a.username || "") + '">' + escapeHtml(initials(a.username)) + '</span>'
          ).join("") + '</div>'
        : '<span style="color:var(--text-muted);font-size:12px;">—</span>';
      h += '<tr><td><div class="task-name">' + nameHtml + '</div></td>' +
        '<td>' + stHtml + '</td>' +
        '<td>' + (r.due != null ? fmtDayYear(new Date(r.due)) : "—") + '</td>' +
        '<td>' + (r.closedAt != null ? fmtDayYear(new Date(r.closedAt)) : "—") + '</td>' +
        '<td>' + assHtml + '</td>' +
        '<td style="text-align:right;">' + fmtHM(r.ms) + '</td></tr>';
    });
  }
  h += '</tbody></table></div>';
  return h;
}

function renderMonthly(container, m){
  const { start, total, done, inProgress, totalWorkedMs, statusCounts, rows } = m;
  const monthLabel = MONTHS[start.getMonth()] + " " + start.getFullYear();

  let html = '<nav class="week-nav" aria-label="Navigazione mese">' +
    '<div class="nav-left">' +
      '<button class="btn btn-icon" id="monthPrevBtn" title="Mese precedente" aria-label="Mese precedente">&larr;</button>' +
      '<button class="btn btn-ghost" id="monthTodayBtn" title="Torna al mese corrente">Oggi</button>' +
    '</div>' +
    '<div class="label-wrap">' +
      '<span class="week-title">Mese selezionato</span>' +
      '<span class="week-range">' + escapeHtml(monthLabel) + '</span>' +
      '<span class="week-tag visible">' + escapeHtml(monthTag(state.monthOffset)) + '</span>' +
    '</div>' +
    '<div class="nav-right">' +
      '<button class="btn btn-icon" id="monthNextBtn" title="Mese successivo" aria-label="Mese successivo">&rarr;</button>' +
    '</div></nav>';

  html += '<div class="kpi-grid month-kpi">' +
    kpiCard("Task del mese", total, "scadenza o completati nel mese") +
    kpiCard("Completati", done, "chiusi nel mese") +
    kpiCard("In corso", inProgress, "non ancora completati") +
    kpiCard("Ore lavorate", fmtHM(totalWorkedMs), "tracciate nel mese") +
    '</div>';

  html += '<div class="card"><div class="section-header"><h3>Task per status</h3></div>' +
    '<div class="chart-wrap"><canvas id="monthlyStatusChart"></canvas><img id="monthlyStatusChartPrint" class="chart-print" alt=""/></div></div>';

  html += '<div class="card"><div class="section-header"><h3>Task del mese</h3></div>' +
    tableHtml(rows) + '</div>';

  // Banner export PDF (stesso look della vista settimanale).
  html += '<section class="export-banner" aria-label="Esporta report">' +
    '<div class="export-banner-text">' +
      '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><polyline points="9 15 12 18 15 15"></polyline></svg>' +
      '<div>' +
        '<div class="export-banner-title">Esporta questo report in PDF</div>' +
        '<div class="export-banner-sub">Layout A4 ottimizzato, pronto da stampare o inviare al cliente.</div>' +
      '</div>' +
    '</div>' +
    '<button type="button" id="monthExportPdfBtn" class="btn btn-primary" title="Esporta in PDF A4" aria-label="Esporta in PDF">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin-right:2px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>' +
      'Esporta PDF' +
    '</button></section>';

  container.innerHTML = html;
  renderStatusChart(statusCounts, "monthlyStatusChart", "monthlyStatusChart");

  const go = (delta) => { state.monthOffset += delta; refreshMonthlyData(); };
  container.querySelector("#monthPrevBtn").addEventListener("click", () => go(-1));
  container.querySelector("#monthNextBtn").addEventListener("click", () => go(1));
  container.querySelector("#monthTodayBtn").addEventListener("click", () => {
    if (state.monthOffset !== 0) { state.monthOffset = 0; refreshMonthlyData(); }
  });

  // Export PDF: snapshot dei chart, poi window.print() (@media print gestisce l'A4).
  container.querySelector("#monthExportPdfBtn").addEventListener("click", () => {
    snapshotChartsForPrint();
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  });
}
