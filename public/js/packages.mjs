// public/js/packages.mjs
// === Logica pura per i pacchetti ore (nessuna dipendenza DOM) ===
// Testabile con `node --test` e riusata da hours-package.js / render.js.

// effectiveTagNames vive ora in tag-views.mjs (è pura logica sui tag, non sui pacchetti);
// lo re-esporto qui perché i consumer storici lo importano da packages.
import { normalizeTag, effectiveTagNames } from "./tag-views.mjs";
export { effectiveTagNames };

const HOUR_MS = 3600000;

// Map(id -> task) per lookup del padre.
export function tasksById(tasks){
  const m = new Map();
  (Array.isArray(tasks) ? tasks : []).forEach(t => { if (t && t.id != null) m.set(t.id, t); });
  return m;
}

// Set degli id che sono `parent` di almeno un altro task (= contenitori).
export function containerIds(tasks){
  const ids = new Set();
  (Array.isArray(tasks) ? tasks : []).forEach(t => {
    if (t && t.parent != null) ids.add(t.parent);
  });
  return ids;
}

// Normalizza la config cliente in un array di pacchetti uniforme.
// Accetta `pacchettiOre` (array) oppure il legacy `pacchettoOre` (oggetto) +
// `dataInizio` a livello cliente. Restituisce [] se nessuno.
export function normalizePackages(cfg){
  const c = cfg || {};
  let raw = [];
  if (Array.isArray(c.pacchettiOre)) raw = c.pacchettiOre;
  else if (c.pacchettoOre && typeof c.pacchettoOre === "object") {
    raw = [Object.assign({ dataInizio: c.dataInizio }, c.pacchettoOre)];
  }
  return raw.map((p, i) => ({
    label: (p && p.label) || ("Pacchetto " + (i + 1)),
    ore: Number(p && p.ore) || 0,
    periodo: (p && p.periodo) || "mensile",
    dataInizio: (p && p.dataInizio) || null,
    dataFine: (p && p.dataFine) || null,
    tags: (p && Array.isArray(p.tags) ? p.tags : []).map(normalizeTag).filter(Boolean)
  }));
}
// Indice del primo pacchetto i cui tag matchano i tag effettivi del task.
// Un pacchetto con tags vuoto fa da catch-all (matcha qualsiasi task).
// Nessun match => null (bucket "Altro").
export function assignPackageIndex(task, packages, byId){
  const names = effectiveTagNames(task, byId);
  for (let i = 0; i < packages.length; i++) {
    const tags = packages[i].tags;
    if (tags.length === 0) return i;                 // catch-all
    for (const tag of tags) if (names.has(tag)) return i;
  }
  return null;
}
// Foglie della vista "Consumo ore" attiva: assegnate al pacchetto `wanted`
// (indice | null per "Altro") E che matchano il tag set attivo. Un tagSet vuoto
// non filtra (clienti senza viste per tag). I tag ereditati dal padre contano
// (effectiveTagNames), coerentemente con Settimanale/Mensile.
export function selectViewTasks(leaves, assignment, wanted, tagSet, byId){
  const noTagFilter = !tagSet || tagSet.size === 0;
  return (Array.isArray(leaves) ? leaves : []).filter(t => {
    if (assignment.get(t.id) !== wanted) return false;
    if (noTagFilter) return true;
    const names = effectiveTagNames(t, byId);
    for (const tag of tagSet) if (names.has(tag)) return true;
    return false;
  });
}

// Ms maturati nel mese (year, month 0-based) per il pacchetto, dato startDate (Date).
// - mensile:    `ore` ogni mese (da dataInizio in poi, gestito dal chiamante sui mesi mostrati)
// - annuale:    `ore` solo nel mese di dataInizio
// - stagionale: `ore` solo nel mese di dataInizio (finestra chiusa gestita da inSeasonWindow)
export function accruedMsForMonth(pkg, year, month, startDate){
  if (!pkg || !startDate) return 0;
  const oreMs = (Number(pkg.ore) || 0) * HOUR_MS;
  if (pkg.periodo === "annuale" || pkg.periodo === "stagionale") {
    return (year === startDate.getFullYear() && month === startDate.getMonth()) ? oreMs : 0;
  }
  return oreMs; // mensile
}

// Vero se `date` rientra nella finestra del pacchetto. Per i non-stagionali è
// sempre vero (nessuna finestra di chiusura).
export function inSeasonWindow(pkg, date){
  if (!pkg || pkg.periodo !== "stagionale") return true;
  if (!pkg.dataInizio || !pkg.dataFine) return true;
  const [ys, ms, ds] = pkg.dataInizio.split("-").map(Number);
  const [ye, me, de] = pkg.dataFine.split("-").map(Number);
  const start = new Date(ys, ms - 1, ds).getTime();
  const end = new Date(ye, me - 1, de, 23, 59, 59, 999).getTime();
  const t = date.getTime();
  return t >= start && t <= end;
}

// Chiave localStorage per il pacchetto attivo. Stesso namespace legacy delle altre chiavi.
export function packageStorageKey(slug){
  return "pirelli-weekly:active-package:" + (slug || "");
}
