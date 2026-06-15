// === Vista "Consumo ore": consumo del pacchetto ore per cliente ===
// Modello a saldo cumulativo: ogni periodo (mensile/annuale) accredita `ore`,
// le time-entry sui task della lista scalano il saldo, il residuo si accumula.
// Se il cliente non ha pacchetto configurato, mostra solo il consumo per mese.
import { MONTHS } from "./config.js";
import { state, isAdmin } from "./state.js";
import { fetchTasks, fetchEntriesRange } from "./api.js";
import { escapeHtml, statusClass, initials } from "./format.js";
import { aggregateByUser } from "./hours-aggregate.js";
import { snapshotCanvases } from "./charts.js";
import {
  tasksById, containerIds, normalizePackages, assignPackageIndex,
  accruedMsForMonth, inSeasonWindow, packageStorageKey
} from "./packages.mjs";

const HOUR_MS = 3600000;
const USERS_DISCLAIMER =
  "Le ore sono attribuite a chi ha materialmente tracciato il tempo. " +
  "In base all'ambito dell'attività, uno stesso task può essere lavorato da più persone: " +
  "la ripartizione per utente non indica quindi la titolarità dell'attività.";
let loaded = false; // lazy load: la vista si carica una sola volta

// --- formattazione ---
function fmtNum(h){
  const r = Math.round(h * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1).replace(".", ",");
}
// ms -> "Xh Ym" (ore:minuti). Minuti omessi se zero (es. "40h"); sotto l'ora
// solo i minuti (es. "46m"); zero -> "0h". Le ore NON sono decimali: 0,8h = 48m.
function fmtHM(ms){
  const totalMin = Math.round((Number(ms) || 0) / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h && m) return h + "h " + m + "m";
  if (h) return h + "h";
  if (m) return m + "m";
  return "0h";
}
function fmtHoursMs(ms){ return fmtHM(ms); }
function fmtSignedMs(ms){
  const sign = ms < 0 ? "−" : (ms > 0 ? "+" : "");
  return sign + fmtHM(Math.abs(ms));
}
// Etichetta e ordine dello status ClickUp (oggetto {status, orderindex} o stringa).
function statusLabel(status){
  return (status && typeof status === "object") ? (status.status || "") : (status || "");
}
function statusOrder(status){
  const oi = status && typeof status === "object" ? Number(status.orderindex) : NaN;
  return Number.isFinite(oi) ? oi : Number.MAX_SAFE_INTEGER;
}
function fmtMonthYear(month, year){ return MONTHS[month] + " " + year; }
function fmtDayMonthYear(d){
  if (!d) return "?";
  return d.getDate() + " " + MONTHS[d.getMonth()].slice(0,3).toLowerCase() + " " + d.getFullYear();
}

// YYYY-MM-DD → Date (inizio giornata, ora locale)
function parseDate(s){
  const m = s && String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setHours(0, 0, 0, 0);
  return d;
}

// elenco {year, month} da start (incluso) a end (incluso)
function monthList(start, end){
  const res = [];
  let y = start.getFullYear(), m = start.getMonth();
  const ey = end.getFullYear(), em = end.getMonth();
  let guard = 0;
  while ((y < ey || (y === ey && m <= em)) && guard < 600) {
    res.push({ year: y, month: m });
    m++; if (m > 11) { m = 0; y++; }
    guard++;
  }
  return res;
}

export async function loadHoursView(){
  if (loaded) return;
  loaded = true;
  const container = document.getElementById("viewHours");
  container.innerHTML = '<div class="hours-loading"><span class="spinner"></span> Caricamento consumo ore…</div>';

  try {
    const tasks = await fetchTasks();            // cache condivisa con la vista settimanale
    const now = new Date();
    const cfg = state.clientConfig || {};
    const pkgs = normalizePackages(cfg);
    const earliest = pkgs.reduce((acc, p) => {
      const d = parseDate(p.dataInizio);
      return (d && (!acc || d < acc)) ? d : acc;
    }, null);
    const rangeStart = earliest || new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const { entries, failed, total } = await fetchEntriesRange(tasks, rangeStart, now);

    // Cache per ri-renderizzare al cambio vista senza nuova fetch. Invariante: rerenderHoursView
    // è no-op finché `loaded` è false, quindi una cache stantia non viene mai mostrata.
    state.hoursData = { tasks, entries, rangeStart, now, partial: failed > 0 && failed < total };
    renderHoursFromCache();
  } catch (e) {
    container.innerHTML = '<div class="hours-note hours-error">Errore nel caricamento del consumo ore: ' +
      escapeHtml(e && e.message ? e.message : String(e)) + '</div>';
    loaded = false; // consenti un nuovo tentativo
  }
}

// Ri-renderizza il tab Consumo ore dai dati in cache (cambio vista). No-op se non ancora caricato.
export function rerenderHoursView(){
  if (!loaded || !state.hoursData) return;
  renderHoursFromCache();
}

// Aggrega le ore consumate per mese (chiave "year-month") da una lista di time-entry.
function aggregateByMonth(entries){
  const byMonth = new Map();
  let totalMs = 0;
  entries.forEach(e => {
    const startMs = Number(e.start);
    if (isNaN(startMs)) return;
    const ms = Number(e.duration_ms) || 0;
    const d = new Date(startMs);
    const key = d.getFullYear() + "-" + d.getMonth();
    byMonth.set(key, (byMonth.get(key) || 0) + ms);
    totalMs += ms;
  });
  return { byMonth, totalMs };
}

// Partizione task -> pacchetto: dipende solo da tasks+cfg (non dal pacchetto attivo),
// quindi la calcolo una volta e la riuso a ogni cambio pacchetto. Solo le foglie
// contano come item; ognuna va al primo pacchetto che matcha, o a "Altro" (indice null).
function partitionTasks(tasks, cfg){
  const packages = normalizePackages(cfg);
  const byId = tasksById(tasks);
  const containers = containerIds(tasks);
  const leaves = tasks.filter(t => !containers.has(t.id));
  const assignment = new Map(); // taskId -> indice pacchetto | null
  let hasUnassigned = false;
  leaves.forEach(t => {
    const idx = packages.length ? assignPackageIndex(t, packages, byId) : 0;
    assignment.set(t.id, idx);
    if (idx === null) hasUnassigned = true;
  });
  return { packages, byId, leaves, assignment, hasUnassigned };
}

// Calcola il modello del pacchetto selezionato e renderizza.
function renderHoursFromCache(){
  const container = document.getElementById("viewHours");
  const { tasks, entries, rangeStart, now, partial } = state.hoursData;
  const cfg = state.clientConfig || {};

  // Memoizzata su hoursData: invalidata naturalmente quando i task vengono rifetchati.
  const part = state.hoursData.partition ||
    (state.hoursData.partition = partitionTasks(tasks, cfg));
  const { packages, byId, leaves, assignment, hasUnassigned } = part;

  // Pacchetto attivo: indice valido | "__altro__". Il bucket "Altro" è solo-admin:
  // per i clienti la vista resta sui pacchetti configurati.
  const canAltro = isAdmin();
  const active = state.activePackage;
  const isAltro = active === "__altro__" && canAltro;
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
  const { byMonth: consumedByMonth } = aggregateByMonth(
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

  // Dettagli "Per task": TUTTI i task del pacchetto (anche 0h / pianificati),
  // raggruppati per padre. La colonna persone unisce assegnatari + chi ha loggato.
  const msByTask = new Map();          // taskId -> ms totali
  const workersByTask = new Map();     // taskId -> Map(userId -> {id, username})
  let taskTotalMs = 0;
  entriesView.forEach(e => {
    const id = e.task && e.task.id;
    if (!id) return;
    const ms = Number(e.duration_ms) || 0;
    msByTask.set(id, (msByTask.get(id) || 0) + ms);
    taskTotalMs += ms;
    const u = e.user;
    if (u && u.id != null) {
      if (!workersByTask.has(id)) workersByTask.set(id, new Map());
      workersByTask.get(id).set(u.id, { id: u.id, username: u.username || u.email });
    }
  });
  const taskRows = tasksView.map(t => {
    const ms = msByTask.get(t.id) || 0;
    // Persone: assegnatari ∪ chi ha tracciato tempo (dedup per id).
    const people = new Map();
    (Array.isArray(t.assignees) ? t.assignees : []).forEach(a => {
      if (a && a.id != null) people.set(a.id, { id: a.id, username: a.username || a.email });
    });
    (workersByTask.get(t.id) || new Map()).forEach((v, k) => people.set(k, v));
    const parent = t.parent != null ? byId.get(t.parent) : null;
    return {
      id: t.id,
      name: t.name || "(senza titolo)",
      url: t.url || null,
      status: t.status != null ? t.status : null,
      assignees: [...people.values()],
      ms,
      pct: taskTotalMs > 0 ? (ms / taskTotalMs) * 100 : 0,
      parentName: parent ? parent.name : null
    };
  }).sort((a, b) =>
    statusOrder(a.status) - statusOrder(b.status) ||
    statusLabel(a.status).localeCompare(statusLabel(b.status)) ||
    b.ms - a.ms ||
    a.name.localeCompare(b.name)
  );
  const userRows = aggregateByUser(entriesView);

  render(container, {
    pkg, startDate, hasPkg, isAltro, packages, activePackage: active,
    hasAltro: canAltro && packages.length > 0 && hasUnassigned,
    rows, chartRows, taskRows, userRows,
    consumedTotalMs, accruedTotalMs,
    saldoMs: accruedTotalMs - consumedTotalMs,
    partial
  });
}

function kpiCard(label, value, sub, extraClass){
  return '<div class="kpi' + (extraClass ? " " + extraClass : "") + '">' +
    '<div class="label">' + escapeHtml(label) + '</div>' +
    '<div class="value">' + escapeHtml(value) + '</div>' +
    '<div class="sub">' + escapeHtml(sub) + '</div></div>';
}

// Markup della tabella mensile (senza card/header: vive in un pannello tab).
function monthlyDetailTableHtml(rows, hasPkg){
  let h = '<div class="table-wrap"><table class="tasks"><thead><tr><th>Mese</th>';
  if (hasPkg) h += '<th style="text-align:right;">Maturate</th>';
  h += '<th style="text-align:right;">Consumate</th>';
  if (hasPkg) h += '<th style="text-align:right;">Saldo mese</th><th style="text-align:right;">Saldo cumul.</th>';
  h += '</tr></thead><tbody>';
  if (!rows.length) {
    h += '<tr><td colspan="' + (hasPkg ? 5 : 2) + '" class="empty">Nessun dato nel periodo.</td></tr>';
  } else {
    rows.slice().reverse().forEach(r => {   // più recente in alto
      h += '<tr><td>' + fmtMonthYear(r.month, r.year) + '</td>';
      if (hasPkg) h += '<td style="text-align:right;">' + (r.accruedMs ? fmtSignedMs(r.accruedMs) : "—") + '</td>';
      h += '<td style="text-align:right;">' + fmtHoursMs(r.consumedMs) + '</td>';
      if (hasPkg) {
        h += '<td style="text-align:right;" class="' + (r.saldoMese < 0 ? "saldo-neg" : "") + '">' + fmtSignedMs(r.saldoMese) + '</td>' +
             '<td style="text-align:right;" class="' + (r.cumulMs < 0 ? "saldo-neg" : "saldo-pos") + '">' + fmtSignedMs(r.cumulMs) + '</td>';
      }
      h += '</tr>';
    });
  }
  h += '</tbody></table></div>';
  return h;
}

// Markup della tabella "Per task": una riga per task con ore tracciate, ordinate desc.
function taskTableHtml(rows){
  let h = '<div class="table-wrap"><table class="tasks"><thead><tr>' +
    '<th>Task</th><th>Stato</th><th>Persone</th>' +
    '<th style="text-align:right;">Ore</th><th style="text-align:right;">%</th>' +
    '</tr></thead><tbody>';
  if (!rows.length) {
    h += '<tr><td colspan="5" class="empty">Nessun task in questo pacchetto.</td></tr>';
  } else {
    let lastStatus = " ";
    rows.forEach(r => {
      const statusRaw = statusLabel(r.status) || "—";
      if (statusRaw !== lastStatus) {
        lastStatus = statusRaw;
        h += '<tr class="task-group"><td colspan="5">' +
          '<span class="badge ' + statusClass(statusRaw) + '">' + escapeHtml(statusRaw) + '</span></td></tr>';
      }
      const stHtml = '<span class="badge ' + statusClass(statusRaw) + '">' + escapeHtml(statusRaw) + '</span>';
      const nameHtml = r.url
        ? '<a href="' + escapeHtml(r.url) + '" target="_blank" rel="noopener">' + escapeHtml(r.name) + '</a>'
        : escapeHtml(r.name);
      const parentHtml = r.parentName
        ? '<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">↳ ' + escapeHtml(r.parentName) + '</div>'
        : '';
      const assHtml = r.assignees.length
        ? '<div class="assignees">' + r.assignees.map(a =>
            '<span class="avatar" title="' + escapeHtml(a.username || "") + '">' + escapeHtml(initials(a.username)) + '</span>'
          ).join("") + '</div>'
        : '<span style="color:var(--text-muted);font-size:12px;">—</span>';
      h += '<tr><td><div class="task-name">' + nameHtml + '</div>' + parentHtml + '</td>' +
        '<td>' + stHtml + '</td>' +
        '<td>' + assHtml + '</td>' +
        '<td style="text-align:right;">' + fmtHoursMs(r.ms) + '</td>' +
        '<td style="text-align:right;">' + Math.round(r.pct) + '%</td></tr>';
    });
  }
  h += '</tbody></table></div>';
  return h;
}

// Gestisce lo switch tra i pannelli di dettaglio. Chiama onFirstUsers() la prima
// volta che si apre il pannello "Per utente" (render lazy del canvas).
function setupDetailTabs(container, onFirstUsers){
  const tabs = container.querySelectorAll(".detail-tab");
  const panels = {
    mese:   container.querySelector("#detailMese"),
    task:   container.querySelector("#detailTask"),
    utente: container.querySelector("#detailUtente")
  };
  let usersShown = false;
  tabs.forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.tab;
      tabs.forEach(b => {
        const on = b === btn;
        b.classList.toggle("active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      });
      Object.entries(panels).forEach(([k, el]) => { if (el) el.classList.toggle("hide", k !== key); });
      if (key === "utente" && !usersShown) { usersShown = true; onFirstUsers(); }
    });
  });
}

function render(container, m){
  const { pkg, startDate, hasPkg, rows, chartRows, taskRows, userRows, consumedTotalMs,
    accruedTotalMs, saldoMs, partial, isAltro, packages, activePackage, hasAltro } = m;
  let html = "";

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

  if (hasPkg) {
    const pct = accruedTotalMs > 0 ? Math.min(100, Math.round(consumedTotalMs / accruedTotalMs * 100)) : 0;
    const over = consumedTotalMs > accruedTotalMs;
    html += '<div class="kpi-grid hours-kpi">' +
      kpiCard("Ore maturate", fmtHoursMs(accruedTotalMs), "accreditate dall'inizio") +
      kpiCard("Ore consumate", fmtHoursMs(consumedTotalMs), "tracciate sui task") +
      kpiCard("Saldo residuo", fmtSignedMs(saldoMs), saldoMs < 0 ? "pacchetto sforato" : "ore disponibili",
              saldoMs < 0 ? "saldo-neg" : "saldo-pos") +
      '</div>';
    html += '<div class="card hours-progress-card">' +
      '<div class="hours-progress-label">Consumo dall\'inizio: <strong>' + pct + '%</strong> · ' +
      fmtHoursMs(consumedTotalMs) + ' / ' + fmtHoursMs(accruedTotalMs) + '</div>' +
      '<div class="progress-bar"><div class="progress-fill' + (over ? " over" : "") +
      '" style="width:' + pct + '%"></div></div></div>';
  } else {
    html += '<div class="kpi-grid hours-kpi">' +
      kpiCard("Ore consumate", fmtHoursMs(consumedTotalMs), "totale nel periodo") + '</div>';
  }

  html += '<div class="card"><div class="section-header"><h3>Ore consumate per mese</h3></div>';
  html += '<div class="chart-wrap"><canvas id="hoursPkgChart"></canvas><img id="hoursPkgChartPrint" class="chart-print" alt=""/></div>';
  if (hasPkg && pkg.periodo === "mensile") {
    html += '<div class="legend"><span><i class="marker"></i> Ore consumate</span>' +
      '<span>┄ monte mensile (' + fmtNum(pkg.ore) + 'h)</span></div>';
  }
  html += '</div>';

  html += '<div class="card hours-detail">' +
    '<div class="section-header"><h3>Dettaglio</h3>' +
      '<div class="filter-toggle detail-tabs" role="tablist" aria-label="Dettaglio consumo">' +
        '<button class="detail-tab active" data-tab="mese" role="tab" aria-selected="true" type="button">Per mese</button>' +
        '<button class="detail-tab" data-tab="task" role="tab" aria-selected="false" type="button">Per task</button>' +
        '<button class="detail-tab" data-tab="utente" role="tab" aria-selected="false" type="button">Per utente</button>' +
      '</div></div>' +
    '<div id="detailMese" class="detail-panel">' + monthlyDetailTableHtml(rows, hasPkg) + '</div>' +
    '<div id="detailTask" class="detail-panel hide">' + taskTableHtml(taskRows) + '</div>' +
    '<div id="detailUtente" class="detail-panel hide">' +
      '<div class="chart-wrap chart-wrap-users"><canvas id="hoursUsersChart"></canvas><img id="hoursUsersChartPrint" class="chart-print" alt=""/></div>' +
      '<p class="hours-note">' + escapeHtml(USERS_DISCLAIMER) + '</p>' +
      '<p class="hours-note">Include tutti gli utenti che hanno tracciato ore sui task di questa lista.</p>' +
    '</div></div>';

  if (partial) {
    html += '<div class="hours-note">Alcuni dati non sono disponibili al momento. Ricarica per riprovare.</div>';
  }
  html += '<div class="hours-note">Ore calcolate dal tempo registrato sui task (tutti gli utenti che hanno tracciato tempo).</div>';

  // Banner export PDF (nascosto in stampa via @media print .export-banner).
  html += '<section class="export-banner">' +
    '<div class="export-banner-text"><div>' +
      '<div class="export-banner-title">Esporta il pacchetto ore in PDF</div>' +
      '<div class="export-banner-sub">Layout A4 ottimizzato, pronto da inviare al cliente.</div>' +
    '</div></div>' +
    '<button type="button" id="exportHoursPdfBtn" class="btn btn-primary" title="Esporta in PDF A4" aria-label="Esporta in PDF">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin-right:2px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>' +
      'Esporta PDF</button>' +
    '</section>';

  container.innerHTML = html;
  renderChart(chartRows, (hasPkg && pkg.periodo === "mensile") ? pkg.ore : null);
  setupDetailTabs(container, () => {
    if (!userRows.length) {
      const w = container.querySelector("#detailUtente .chart-wrap-users");
      if (w) w.innerHTML = '<p class="empty" style="padding:24px;text-align:center;">Nessuna ora tracciata nel periodo.</p>';
      return;
    }
    renderUsersChart(userRows);
  });

  container.querySelectorAll(".package-selector .pkg-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      state.activePackage = btn.dataset.package;
      try { window.localStorage && window.localStorage.setItem(
        packageStorageKey(state.clientConfig && state.clientConfig.slug),
        state.activePackage); } catch (e) {}
      renderHoursFromCache();
    });
  });

  const exportBtn = container.querySelector("#exportHoursPdfBtn");
  if (exportBtn) exportBtn.addEventListener("click", () => {
    snapshotHoursCharts();
    // doppio rAF: assicura che le <img> snapshot siano nel DOM prima di stampare
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  });
}

// Snapshot dei grafici del tab ore nei rispettivi <img class="chart-print">, così la
// stampa (in @media print i canvas sono nascosti) li mostra. No-op se assenti.
function snapshotHoursCharts(){
  snapshotCanvases([
    ["hoursPkgChart", "hoursPkgChartPrint", state.hoursPkgChart],
    ["hoursUsersChart", "hoursUsersChartPrint", state.hoursUsersChart]
  ]);
}

// Anche con Ctrl/Cmd+P dal tab ore i grafici vengono snapshottati in tempo.
if (typeof window !== "undefined") {
  window.addEventListener("beforeprint", snapshotHoursCharts);
}

// Stile comune dei tooltip Chart.js del tab ore (solo la callback `label` cambia).
const TOOLTIP_STYLE = {
  backgroundColor: "#FFFFFF", titleColor: "#1A1A2E", bodyColor: "#5A6178",
  borderColor: "#D8DCE4", borderWidth: 1, padding: 10
};

function renderChart(rows, monthlyAllowanceH){
  const ctx = document.getElementById("hoursPkgChart");
  if (!ctx) return;
  const multiYear = new Set(rows.map(r => r.year)).size > 1;
  const labels = rows.map(r => MONTHS[r.month] + (multiYear ? " " + String(r.year).slice(2) : ""));
  const data = rows.map(r => +(r.consumedMs / HOUR_MS).toFixed(2));
  if (state.hoursPkgChart) state.hoursPkgChart.destroy();

  const datasets = [{
    type: "bar", label: "Ore consumate", data,
    backgroundColor: "#3333FF", borderRadius: 4, maxBarThickness: 40
  }];
  if (monthlyAllowanceH != null) {
    datasets.push({
      type: "line", label: "Monte mensile",
      data: rows.map(() => monthlyAllowanceH),
      borderColor: "#9098A8", borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, fill: false
    });
  }

  state.hoursPkgChart = new Chart(ctx, {
    type: "bar", // chart misto: bar (consumate) + line (monte mensile)
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: Object.assign({}, TOOLTIP_STYLE, {
          callbacks: { label: (c) => c.dataset.label + ": " + fmtHM(c.parsed.y * HOUR_MS) }
        })
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#5A6178", font: { size: 11 } } },
        y: { beginAtZero: true, ticks: { color: "#5A6178", font: { size: 11 }, callback: (v) => v + "h" }, grid: { color: "#E8ECF2" } }
      }
    }
  });
}

// Grafico a barre ORIZZONTALI delle ore per utente ClickUp (indexAxis: "y").
function renderUsersChart(users){
  const ctx = document.getElementById("hoursUsersChart");
  if (!ctx) return;
  if (state.hoursUsersChart) state.hoursUsersChart.destroy();
  // Altezza proporzionale al numero di utenti (le barre orizzontali crescono in verticale).
  const wrap = ctx.parentElement;
  if (wrap) wrap.style.height = Math.max(160, users.length * 38) + "px";

  const labels = users.map(u => u.name);
  const data = users.map(u => +(u.ms / HOUR_MS).toFixed(2));
  const colors = users.map(u => u.color || "#3333FF");

  state.hoursUsersChart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ label: "Ore", data, backgroundColor: colors, borderRadius: 4, maxBarThickness: 28 }] },
    options: {
      indexAxis: "y",
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: Object.assign({}, TOOLTIP_STYLE, {
          callbacks: { label: (c) => fmtHM(c.parsed.x * HOUR_MS) }
        })
      },
      scales: {
        x: { beginAtZero: true, ticks: { color: "#5A6178", font: { size: 11 }, callback: (v) => v + "h" }, grid: { color: "#E8ECF2" } },
        y: { grid: { display: false }, ticks: { color: "#5A6178", font: { size: 11 } } }
      }
    }
  });
}
