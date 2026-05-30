// === Vista "Consumo ore": consumo del pacchetto ore per cliente ===
// Modello a saldo cumulativo: ogni periodo (mensile/annuale) accredita `ore`,
// le time-entry sui task della lista scalano il saldo, il residuo si accumula.
// Se il cliente non ha pacchetto configurato, mostra solo il consumo per mese.
import { MONTHS } from "./config.js";
import { state } from "./state.js";
import { fetchTasks, fetchEntriesRange } from "./api.js";
import { escapeHtml } from "./format.js";

const HOUR_MS = 3600000;
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
      pkg, startDate, hasPkg, rows,
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

function render(container, m){
  const { pkg, startDate, hasPkg, rows, consumedTotalMs, accruedTotalMs, saldoMs, partial } = m;
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

  html += '<div class="card"><div class="section-header"><h3>Dettaglio mensile</h3></div><div class="table-wrap">' +
    '<table class="tasks"><thead><tr><th>Mese</th>';
  if (hasPkg) html += '<th style="text-align:right;">Maturate</th>';
  html += '<th style="text-align:right;">Consumate</th>';
  if (hasPkg) html += '<th style="text-align:right;">Saldo mese</th><th style="text-align:right;">Saldo cumul.</th>';
  html += '</tr></thead><tbody>';
  if (!rows.length) {
    html += '<tr><td colspan="' + (hasPkg ? 5 : 2) + '" class="empty">Nessun dato nel periodo.</td></tr>';
  } else {
    rows.slice().reverse().forEach(r => {   // più recente in alto
      html += '<tr><td>' + fmtMonthYear(r.month, r.year) + '</td>';
      if (hasPkg) html += '<td style="text-align:right;">' + (r.accruedMs ? fmtSignedMs(r.accruedMs) : "—") + '</td>';
      html += '<td style="text-align:right;">' + fmtHoursMs(r.consumedMs) + '</td>';
      if (hasPkg) {
        html += '<td style="text-align:right;" class="' + (r.saldoMese < 0 ? "saldo-neg" : "") + '">' + fmtSignedMs(r.saldoMese) + '</td>' +
                '<td style="text-align:right;" class="' + (r.cumulMs < 0 ? "saldo-neg" : "saldo-pos") + '">' + fmtSignedMs(r.cumulMs) + '</td>';
      }
      html += '</tr>';
    });
  }
  html += '</tbody></table></div></div>';

  if (partial) {
    html += '<div class="hours-note">Dati parziali: alcune chiamate a ClickUp non hanno risposto. Ricarica per riprovare.</div>';
  }
  html += '<div class="hours-note">Conteggio basato sulle time-entry dei task di questa lista, per gli assegnatari presenti sui task.</div>';

  container.innerHTML = html;
  renderChart(rows, (hasPkg && pkg.periodo === "mensile") ? pkg.ore : null);
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
