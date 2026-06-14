// public/js/packages.mjs
// === Logica pura per i pacchetti ore (nessuna dipendenza DOM) ===
// Testabile con `node --test` e riusata da hours-package.js / render.js.

const HOUR_MS = 3600000;

// Normalizza un nome tag: stringa lowercase senza spazi ai bordi.
export function normalizeTag(name){
  return String(name == null ? "" : name).toLowerCase().trim();
}

// Map(id -> task) per lookup del padre.
export function tasksById(tasks){
  const m = new Map();
  (Array.isArray(tasks) ? tasks : []).forEach(t => { if (t && t.id != null) m.set(t.id, t); });
  return m;
}

// Nomi tag propri (normalizzati) di un task.
function ownTagNames(task){
  const tags = task && Array.isArray(task.tags) ? task.tags : [];
  return tags.map(t => normalizeTag(t && t.name)).filter(Boolean);
}

// Tag effettivi: propri ∪ tag del padre (i sub-task ereditano dal genitore).
export function effectiveTagNames(task, byId){
  const set = new Set(ownTagNames(task));
  const parentId = task && task.parent;
  if (parentId != null && byId && byId.has(parentId)) {
    ownTagNames(byId.get(parentId)).forEach(n => set.add(n));
  }
  return set;
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
export function assignPackageIndex(){ throw new Error("not yet implemented"); }
export function accruedMsForMonth(){ throw new Error("not yet implemented"); }
export function inSeasonWindow(){ throw new Error("not yet implemented"); }
export function packageStorageKey(){ throw new Error("not yet implemented"); }
