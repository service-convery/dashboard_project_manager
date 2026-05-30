// === Configurazione e costanti condivise ===

// Slug del cliente dall'URL: /d/:slug
// Il listId vero resta server-side (in config/clients.json). Il browser passa solo
// lo slug; il proxy /api/clickup risolve slug→listId e verifica autorizzazione.
export const SLUG = (function(){
  const m = window.location.pathname.match(/\/d\/([^\/]+)/);
  return m ? decodeURIComponent(m[1]).toLowerCase().replace(/[^a-z0-9-]/g, "") : null;
})();
export const CLIENT_NAME_FALLBACK = SLUG ? SLUG.charAt(0).toUpperCase() + SLUG.slice(1) : "—";

// Endpoint logici esposti dal proxy /api/clickup?endpoint=...
export const T_FILTER = "tasks";
export const T_TIME   = "time-entries";
export const T_GET    = "task";

// Status considerati "non aperti" e quindi esclusi dalla lista dei task aperti (case-insensitive)
export const EXCLUDED_STATUSES = new Set(["da fare", "completato", "complete", "closed", "chiuso", "done"]);
// Sottoinsieme: status di chiusura/completamento (i task chiusi nella settimana vengono comunque mostrati)
export const CLOSED_STATUSES = new Set(["completato", "complete", "closed", "chiuso", "done"]);

export const DAY_LABELS = ["Lun","Mar","Mer","Gio","Ven","Sab","Dom"];
export const MONTHS = ["gen","feb","mar","apr","mag","giu","lug","ago","set","ott","nov","dic"];

// === Paginazione filter_tasks ===
// La filter_tasks di ClickUp è paginata (100 task/pagina). Senza loop si rischia
// di vedere solo i primi 100.
export const PAGE_SIZE = 100;
export const MAX_PAGES = 25;          // safety cap: 2500 task massimi
export const FETCH_PAGE_DELAY_MS = 80; // piccolo respiro tra le pagine
