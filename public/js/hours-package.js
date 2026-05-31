// === Vista "Consumo ore": consumo del pacchetto ore per cliente ===
// Modello a saldo cumulativo: ogni periodo (mensile/annuale) accredita `ore`,
// le time-entry sui task della lista scalano il saldo, il residuo si accumula.
// Se il cliente non ha pacchetto configurato, mostra solo il consumo per mese.
import { MONTHS } from "./config.js";
import { state } from "./state.js";
import { fetchTasks, fetchEntriesRange } from "./api.js";
import { escapeHtml, statusClass, initials } from "./format.js";
import { aggregateByTask, aggregateByUser } from "./hours-aggregate.js";

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
function fmtHoursMs(ms){ return fmtNum(ms / HOUR_MS) + "h"; }
function fmtSignedMs(ms){
  const sign = ms < 0 ? "−" : (ms > 0 ? "+" : "");
  return sign + fmtNum(Math.abs(ms) / HOUR_MS) + "h";
}
function fmtMonthYear(month, year){ return MONTHS[month] + " " + year; }

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

  const cfg = state.clientConfig || {};
  const pkg = cfg.pacchettoOre || null;          // { ore, periodo } | null
  const startDate = parseDate(cfg.dataInizio);   // Date | null
  const hasPkg = !!pkg && !!startDate;

  try {
    const tasks = await fetchTasks();            // cache condivisa con la vista settimanale
    const taskIds = new Set(tasks.map(t => t.id));

    const now = new Date();
    // Senza pacchetto/data: mostro comunque gli ultimi 12 mesi.
    const rangeStart = startDate || new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const { entries, failed, total } = await fetchEntriesRange(tasks, rangeStart, now);

    const ourEntries = entries.filter(e => e && e.task && taskIds.has(e.task.id));
    const taskById = new Map(tasks.map(t => [t.id, t]));
    const taskRows = aggregateByTask(ourEntries, taskById).rows;
    const userRows = aggregateByUser(ourEntries);

    // consumo per mese (chiave "year-month")
    const consumedByMonth = new Map();
    let consumedTotalMs = 0;
    ourEntries.forEach(e => {
      const startMs = Number(e.start);
      if (isNaN(startMs)) return;
      const ms = Number(e.duration_ms) || 0;
      const d = new Date(startMs);
      const key = d.getFullYear() + "-" + d.getMonth();
      consumedByMonth.set(key, (consumedByMonth.get(key) || 0) + ms);
      consumedTotalMs += ms;
    });

    const months = monthList(rangeStart, now);
    const oreMs = pkg ? pkg.ore * HOUR_MS : 0;
    const annuale = pkg && pkg.periodo === "annuale";
    const startMonth = startDate ? startDate.getMonth() : 0;

    const rows = [];
    let cumulMs = 0, accruedTotalMs = 0;
    months.forEach(({ year, month }) => {
      const consumedMs = consumedByMonth.get(year + "-" + month) || 0;
      let accruedMs = 0;
      if (hasPkg) {
        // mensile: +ore ogni mese. annuale: +ore nel mese dell'anniversario.
        accruedMs = annuale ? (month === startMonth ? oreMs : 0) : oreMs;
      }
      accruedTotalMs += accruedMs;
      const saldoMese = accruedMs - consumedMs;
      cumulMs += saldoMese;
      rows.push({ year, month, accruedMs, consumedMs, saldoMese, cumulMs });
    });

    render(container, {
      pkg, startDate, hasPkg, rows, taskRows, userRows,
      consumedTotalMs, accruedTotalMs,
      saldoMs: accruedTotalMs - consumedTotalMs,
      partial: failed > 0 && failed < total
    });
  } catch (e) {
    container.innerHTML = '<div class="hours-note hours-error">Errore nel caricamento del consumo ore: ' +
      escapeHtml(e && e.message ? e.message : String(e)) + '</div>';
    loaded = false; // consenti un nuovo tentativo
  }
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
    '<th>Task</th><th>Stato</th><th>Assegnatari</th>' +
    '<th style="text-align:right;">Ore</th><th style="text-align:right;">%</th>' +
    '</tr></thead><tbody>';
  if (!rows.length) {
    h += '<tr><td colspan="5" class="empty">Nessuna ora tracciata nel periodo.</td></tr>';
  } else {
    rows.forEach(r => {
      const statusRaw = (r.status && typeof r.status === "object") ? r.status.status : r.status;
      const stHtml = '<span class="badge ' + statusClass(statusRaw) + '">' + escapeHtml(statusRaw || "—") + '</span>';
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
  const { pkg, startDate, hasPkg, rows, taskRows, userRows, consumedTotalMs, accruedTotalMs, saldoMs, partial } = m;
  let html = "";

  html += '<div class="hours-head"><h3>Consumo pacchetto ore</h3>';
  if (hasPkg) {
    html += '<span class="hours-sub">' + fmtNum(pkg.ore) + 'h ' +
      (pkg.periodo === "annuale" ? "annuali" : "mensili") +
      ' · dal ' + fmtMonthYear(startDate.getMonth(), startDate.getFullYear()) + '</span>';
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

  html += '<div class="card"><div class="section-header"><h3>Ore consumate per mese</h3></div>' +
    '<div class="chart-wrap"><canvas id="hoursPkgChart"></canvas></div>';
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
      '<div class="chart-wrap chart-wrap-users"><canvas id="hoursUsersChart"></canvas></div>' +
      '<p class="hours-note">' + escapeHtml(USERS_DISCLAIMER) + '</p>' +
      '<p class="hours-note">Include tutti gli utenti che hanno tracciato ore sui task di questa lista.</p>' +
    '</div></div>';

  if (partial) {
    html += '<div class="hours-note">Dati parziali: alcune chiamate a ClickUp non hanno risposto. Ricarica per riprovare.</div>';
  }
  html += '<div class="hours-note">Conteggio basato sulle time-entry dei task di questa lista (tutti gli utenti che hanno tracciato tempo).</div>';

  container.innerHTML = html;
  renderChart(rows, (hasPkg && pkg.periodo === "mensile") ? pkg.ore : null);
  setupDetailTabs(container, () => {
    if (!userRows.length) {
      const w = container.querySelector("#detailUtente .chart-wrap-users");
      if (w) w.innerHTML = '<p class="empty" style="padding:24px;text-align:center;">Nessuna ora tracciata nel periodo.</p>';
      return;
    }
    renderUsersChart(userRows);
  });
}

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
        tooltip: {
          backgroundColor: "#FFFFFF", titleColor: "#1A1A2E", bodyColor: "#5A6178",
          borderColor: "#D8DCE4", borderWidth: 1, padding: 10,
          callbacks: { label: (c) => c.dataset.label + ": " + c.parsed.y + " h" }
        }
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
        tooltip: {
          backgroundColor: "#FFFFFF", titleColor: "#1A1A2E", bodyColor: "#5A6178",
          borderColor: "#D8DCE4", borderWidth: 1, padding: 10,
          callbacks: { label: (c) => c.parsed.x + " h" }
        }
      },
      scales: {
        x: { beginAtZero: true, ticks: { color: "#5A6178", font: { size: 11 }, callback: (v) => v + "h" }, grid: { color: "#E8ECF2" } },
        y: { grid: { display: false }, ticks: { color: "#5A6178", font: { size: 11 } } }
      }
    }
  });
}
