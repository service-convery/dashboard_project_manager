// === Entry point: orchestrazione, event listener e bootstrap ===
import { SLUG, CLIENT_NAME_FALLBACK, EXCLUDED_STATUSES } from "./config.js";
import { state, resetHealth } from "./state.js";
import { fmtDay, fmtDayYear, getWeekRange } from "./format.js";
import { clearError, setLoading } from "./ui.js";
import { fetchTasks, fetchEntries, fetchClosedThisWeek, fetchEstimates } from "./api.js";
import { renderHealth, renderDiag, render, renderTable } from "./render.js";
import { snapshotChartsForPrint } from "./charts.js";
import { loadHoursView } from "./hours-package.js";

async function load(){
  clearError();
  setLoading(true);
  resetHealth();
  renderHealth();

  const { mon, sun } = getWeekRange(state.weekOffset);
  document.getElementById("weekRange").textContent = fmtDay(mon) + " — " + fmtDayYear(sun);
  document.getElementById("hoursMeta").textContent = fmtDay(mon) + " – " + fmtDay(sun);
  const tag = document.getElementById("weekTag");
  if (state.weekOffset === 0) { tag.textContent = "questa settimana"; tag.classList.add("visible"); }
  else if (state.weekOffset === -1) { tag.textContent = "settimana scorsa"; tag.classList.add("visible"); }
  else if (state.weekOffset === 1) { tag.textContent = "settimana prossima"; tag.classList.add("visible"); }
  else if (state.weekOffset > 1) { tag.textContent = "+" + state.weekOffset + " settimane"; tag.classList.add("visible"); }
  else { tag.textContent = (state.weekOffset) + " settimane"; tag.classList.add("visible"); }

  // Prima carico i task aperti (cache) — necessari per derivare gli assegnatari per le entries.
  const tasks = await fetchTasks();
  renderHealth();

  // Le restanti due fonti (entries + closed) sono indipendenti tra loro: uso Promise.allSettled
  // così se una fallisce l'altra continua a renderizzarsi.
  const [entriesResult, closedResult] = await Promise.allSettled([
    fetchEntries(tasks, mon, sun),
    fetchClosedThisWeek(mon, sun)
  ]);
  const entries = entriesResult.status === "fulfilled" ? entriesResult.value : [];
  const closedThisWeek = closedResult.status === "fulfilled" ? closedResult.value : [];
  renderHealth();

  // Le stime servono sia per i task aperti che per quelli chiusi questa settimana.
  const openTasks = tasks.filter(t => {
    const s = t && t.status;
    const v = (s && typeof s === "object" && s.status) ? s.status : s;
    return !EXCLUDED_STATUSES.has(String(v || "").toLowerCase().trim());
  });
  const estimates = await fetchEstimates(openTasks.concat(closedThisWeek));
  renderHealth();

  document.getElementById("lastUpdated").textContent =
    "Aggiornato " + new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });

  renderDiag();
  render(tasks, entries, estimates, closedThisWeek, mon, sun);
  setLoading(false);
}

// Navigation
document.getElementById("prevBtn").addEventListener("click", () => { state.weekOffset -= 1; load(); });
document.getElementById("nextBtn").addEventListener("click", () => { state.weekOffset += 1; load(); });
document.getElementById("todayBtn").addEventListener("click", () => { state.weekOffset = 0; load(); });

// Filtro tabella (Solo settimana / Tutti) — non ricarica i dati, ri-renderizza solo la tabella.
function setTableFilter(f){
  state.tableFilter = f;
  try { window.localStorage && window.localStorage.setItem("pirelli-weekly:table-filter", f); }
  catch (e) { /* ignoro */ }
  renderTable();
}
document.getElementById("filterWeek").addEventListener("click", () => setTableFilter("week"));
document.getElementById("filterAll").addEventListener("click", () => setTableFilter("all"));

// === Tab: Settimanale / Consumo ore ===
function switchView(view){
  const weekly = view === "weekly";
  document.getElementById("viewWeekly").classList.toggle("hide", !weekly);
  document.getElementById("viewHours").classList.toggle("hide", weekly);
  document.getElementById("tabWeekly").classList.toggle("active", weekly);
  document.getElementById("tabHours").classList.toggle("active", !weekly);
  document.getElementById("tabWeekly").setAttribute("aria-selected", String(weekly));
  document.getElementById("tabHours").setAttribute("aria-selected", String(!weekly));
  if (!weekly) loadHoursView(); // lazy: carica i dati al primo accesso
}
document.getElementById("tabWeekly").addEventListener("click", () => switchView("weekly"));
document.getElementById("tabHours").addEventListener("click", () => switchView("hours"));

// Export PDF: snapshot dei chart, poi window.print() (lo stylesheet @media print
// gestisce A4 verticale, layout compatto e visualizza le img invece dei canvas).
document.getElementById("exportPdfBtn").addEventListener("click", () => {
  snapshotChartsForPrint();
  // Doppio rAF per assicurarsi che le img siano già rendered nel DOM prima di printare
  requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
});

// Anche se l'utente lancia Ctrl/Cmd+P dal browser, intercettiamo l'evento e
// preparoiamo gli snapshot in tempo. Funziona in Chrome/Edge/Safari.
window.addEventListener("beforeprint", () => {
  snapshotChartsForPrint();
});

// Toggle diagnostica in fondo: di default nascosta.
document.getElementById("diagToggle").addEventListener("click", () => {
  const box = document.getElementById("diagBox");
  const btn = document.getElementById("diagToggle");
  const isHidden = box.classList.contains("hide");
  if (isHidden) {
    box.classList.remove("hide");
    btn.textContent = "Nascondi diagnostica";
    btn.setAttribute("aria-expanded", "true");
  } else {
    box.classList.add("hide");
    btn.textContent = "Mostra diagnostica";
    btn.setAttribute("aria-expanded", "false");
  }
});

// Logout button
document.getElementById("logoutBtn").addEventListener("click", async () => {
  try {
    await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
  } catch {}
  window.location.href = "/";
});

// === Bootstrap ===
// 1. Verifica che lo slug sia valido nell'URL
// 2. Chiama /api/me per assicurarsi che la sessione sia valida e che l'utente
//    abbia accesso a questo cliente; se no, redirect al login
// 3. Imposta il titolo nell'header con il nome del cliente
// 4. Avvia load()
async function bootstrap(){
  if (!SLUG) {
    // URL malformato: torna alla landing
    window.location.href = "/";
    return;
  }
  document.getElementById("clientTitle").textContent = CLIENT_NAME_FALLBACK + " · Task Settimanali";
  try {
    const r = await fetch("/api/me", { credentials: "same-origin" });
    if (r.status === 401 || !r.ok) {
      const back = encodeURIComponent(window.location.pathname);
      window.location.href = "/?redirect=" + back + "&slug=" + encodeURIComponent(SLUG);
      return;
    }
    const me = await r.json();
    const allowed = (me.clients || []).find(c => c.slug === SLUG);
    if (!allowed) {
      // Loggato ma non autorizzato a vedere questo cliente
      document.getElementById("errorBox").classList.remove("hide");
      document.getElementById("errorBox").textContent =
        "La tua sessione non ha accesso al cliente \"" + SLUG + "\". Esci e accedi con le credenziali corrette.";
      return;
    }
    document.getElementById("clientTitle").textContent = allowed.name + " · Task Settimanali";
    document.title = allowed.name + " — Task Settimanali";
    state.clientConfig = allowed; // name + pacchettoOre + dataInizio (per la vista "Consumo ore")

    // Switcher cliente: lo mostro solo se la sessione ha accesso a 2+ clienti (tipicamente admin).
    const clients = me.clients || [];
    if (clients.length > 1) {
      const switcher = document.getElementById("clientSwitcher");
      clients.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c.slug;
        opt.textContent = c.name;
        if (c.slug === SLUG) opt.selected = true;
        switcher.appendChild(opt);
      });
      switcher.addEventListener("change", () => {
        if (switcher.value && switcher.value !== SLUG) {
          window.location.href = "/d/" + encodeURIComponent(switcher.value);
        }
      });
      document.getElementById("clientSwitch").classList.remove("hide");
    }

    load();
  } catch (e) {
    document.getElementById("errorBox").classList.remove("hide");
    document.getElementById("errorBox").textContent = "Errore di rete durante il login: " + (e.message || e);
  }
}

bootstrap();
