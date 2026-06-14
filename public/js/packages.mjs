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

// Stubs — implemented in subsequent tasks (required for ESM named-import resolution).
export function containerIds(){ throw new Error("not yet implemented"); }
export function normalizePackages(){ throw new Error("not yet implemented"); }
export function assignPackageIndex(){ throw new Error("not yet implemented"); }
export function accruedMsForMonth(){ throw new Error("not yet implemented"); }
export function inSeasonWindow(){ throw new Error("not yet implemented"); }
export function packageStorageKey(){ throw new Error("not yet implemented"); }
