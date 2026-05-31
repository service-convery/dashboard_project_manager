// === Stato mutabile condiviso dell'applicazione ===
// I binding di un modulo ES sono read-only dall'esterno, quindi lo stato che viene
// riassegnato (weekOffset, le cache, i chart, il filtro tabella) vive dentro un
// singolo oggetto `state` di cui muto le proprietà. Gli oggetti `health` e
// `retryStats` sono invece mutati per proprietà e restano export const.

export const state = {
  weekOffset: 0,        // 0 = settimana corrente, -1 = prec, +1 = succ
  allTasksCache: null,  // i task della lista cambiano poco; li riusiamo tra settimane
  estimatesCache: null, // Map<task_id, time_estimate_ms> — non dipende dalla settimana
  teamMembersCache: null, // [{id, username}] membri del workspace: copre TUTTI i logger, non solo gli assegnatari
  estimatesDiag: { requested: 0, succeeded: 0, withEstimate: 0, errors: [], rawSample: null, parsedSample: null, sampleTaskId: null }, // diagnostica per fetchEstimates
  hoursChart: null,
  statusChart: null,
  hoursPkgChart: null,   // grafico della vista "Consumo ore"
  hoursUsersChart: null, // grafico "Per utente" nella vista "Consumo ore"
  clientConfig: null,    // config del cliente corrente (name, pacchettoOre, dataInizio)
  // Filtro tabella: "week" (solo task con scadenza nella settimana) | "all" (tutti i task aperti).
  // Salvato in localStorage per persistere tra le aperture dell'artefatto.
  tableFilter: "week",
  // Cache dei dati renderizzati: serve per rifiltrare la tabella senza richiamare l'API.
  lastRender: null,
};

try {
  const saved = window.localStorage && window.localStorage.getItem("pirelli-weekly:table-filter");
  if (saved === "week" || saved === "all") state.tableFilter = saved;
} catch (e) { /* localStorage non disponibile, ignoro */ }

// === Retry wrapper per le chiamate MCP ===
// Ogni chiamata MCP viene ritentata fino a 3 volte (1 originale + 2 retry)
// con backoff esponenziale (400ms, 1200ms). Le statistiche aggregate vengono
// raccolte in `retryStats` e mostrate nel pannello diagnostica.
export const retryStats = { calls: 0, retried: 0, recovered: 0, failed: 0, attempts: 0 };

// === Stato di salute delle 4 fonti dati ===
// state: "pending" | "ok" | "warn" (parziale / vuoto) | "error" (tutti i retry falliti)
export const health = {
  tasks:     { state: "pending", count: 0, attempts: 0, error: null, label: "Task lista",    unit: "task" },
  closed:    { state: "pending", count: 0, attempts: 0, error: null, label: "Completati sett.", unit: "task" },
  entries:   { state: "pending", count: 0, attempts: 0, error: null, label: "Ore tracciate", unit: "entries" },
  estimates: { state: "pending", count: 0, attempts: 0, error: null, label: "Stime",          unit: "" }
};

export function resetHealth(){
  Object.keys(health).forEach(k => {
    health[k].state = "pending";
    health[k].count = 0;
    health[k].attempts = 0;
    health[k].error = null;
    health[k].pages = 0;
    health[k].raw = 0;
    health[k].subtaskFiltered = 0;
    health[k].fellBack = false;
    health[k].sample = null;
  });
  retryStats.calls = 0;
  retryStats.retried = 0;
  retryStats.recovered = 0;
  retryStats.failed = 0;
  retryStats.attempts = 0;
}
