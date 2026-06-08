// === Logica pura per le "viste per tag" (nessuna dipendenza DOM) ===
// Isolata qui per poter essere unit-testata con `node --test` e riusata sia dal
// tab Settimanale (render.js) sia dal tab Consumo ore (hours-package.js).

// Normalizza un nome tag per il confronto: stringa lowercase senza spazi ai bordi.
export function normalizeTag(name){
  return String(name == null ? "" : name).toLowerCase().trim();
}

// Set dei nomi tag (normalizzati) di un task ClickUp. Tollera tags assente/non-array.
export function taskTagNames(task){
  const tags = task && Array.isArray(task.tags) ? task.tags : [];
  return new Set(tags.map(t => normalizeTag(t && t.name)));
}

// Vero se il task ha ALMENO UNO dei tag richiesti (OR). Set vuoto = nessun vincolo.
export function taskMatchesTags(task, tagSet){
  if (!tagSet || tagSet.size === 0) return true;
  const names = taskTagNames(task);
  for (const tag of tagSet) if (names.has(tag)) return true;
  return false;
}

// Unione (normalizzata) dei tag di tutte le viste configurate.
function unionTags(views){
  const s = new Set();
  views.forEach(v => (v && Array.isArray(v.tags) ? v.tags : []).forEach(t => s.add(normalizeTag(t))));
  return s;
}

// Risolve il Set di tag effettivo data la config e la vista attiva.
// tagViews: array | null/undefined. activeView: "__all__" | indice numerico in stringa.
// - nessuna vista configurata  -> Set vuoto (nessun filtro, comportamento attuale)
// - "__all__" o valore non valido -> unione di tutte le viste
// - indice valido -> i tag di quella vista
export function resolveTagSet(tagViews, activeView){
  const views = Array.isArray(tagViews) ? tagViews : [];
  if (views.length === 0) return new Set();
  if (activeView == null || activeView === "__all__") return unionTags(views);
  const idx = Number(activeView);
  if (!Number.isInteger(idx) || idx < 0 || idx >= views.length) return unionTags(views);
  const v = views[idx];
  return new Set((v && Array.isArray(v.tags) ? v.tags : []).map(normalizeTag));
}

// Chiave localStorage per la vista attiva, scoping per cliente (stesso prefisso di table-filter).
export function viewStorageKey(slug){
  return "pirelli-weekly:active-view:" + (slug || "");
}
