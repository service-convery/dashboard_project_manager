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

// Nomi tag propri (normalizzati, senza vuoti) di un task.
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

// Risolve il Set di tag effettivo data la config e la vista attiva.
// tagViews: array | null/undefined. activeView: "__all__" | indice numerico in stringa.
// - nessuna vista configurata  -> Set vuoto (nessun filtro)
// - "__all__" o valore non valido -> Set vuoto: "Tutti" mostra l'intera lista, non
//   l'unione delle viste (con una sola vista l'unione avrebbe nascosto tutto il resto)
// - indice valido -> i tag di quella vista (filtro attivo)
export function resolveTagSet(tagViews, activeView){
  const views = Array.isArray(tagViews) ? tagViews : [];
  if (views.length === 0) return new Set();
  if (activeView == null || activeView === "__all__") return new Set();
  const idx = Number(activeView);
  if (!Number.isInteger(idx) || idx < 0 || idx >= views.length) return new Set();
  const v = views[idx];
  return new Set((v && Array.isArray(v.tags) ? v.tags : []).map(normalizeTag));
}

// === Viste per tag delle TIME ENTRY ===
// Alcune categorie (es. "Sviluppo Extra" del cliente Inspire) sono marcate come tag
// sulla singola time entry, NON sul task: uno stesso task può avere sia ore "extra"
// sia normali, quindi il conteggio corretto va fatto per entry, non per task.

// Una time entry ha la stessa shape { tags: [{ name }] } di un task: l'estrazione dei
// nomi e il match OR sono la stessa operazione, quindi riuso i predicati dei task
// (nessuna logica duplicata da tenere allineata).
export const entryTagNames = taskTagNames;
export const entryMatchesTags = taskMatchesTags;

// Set degli id-task che hanno ALMENO UNA entry che matcha il tag set (viste entry).
// Serve a Settimanale/Mensile per mostrare i task che hanno ricevuto ore "extra".
export function entryTaskIds(entries, tagSet){
  const ids = new Set();
  (Array.isArray(entries) ? entries : []).forEach(e => {
    if (e && e.task && e.task.id != null && entryMatchesTags(e, tagSet)) ids.add(e.task.id);
  });
  return ids;
}

// === Viste combinate (tag-task + tag-entry) ===
// Il selettore mostra un'unica lista ordinata: prima le viste su tag del task
// (cfg.tagViews), poi quelle su tag della entry (cfg.entryTagViews). Ogni vista porta
// il proprio `kind` così i consumer sanno come filtrare. L'indice di state.activeView
// referenzia questa lista combinata.
export function combinedViews(cfg){
  const c = cfg || {};
  const task = Array.isArray(c.tagViews) ? c.tagViews : [];
  const entry = Array.isArray(c.entryTagViews) ? c.entryTagViews : [];
  const out = [];
  task.forEach(v => out.push({ label: (v && v.label) || "", tags: (v && Array.isArray(v.tags) ? v.tags : []), kind: "task" }));
  entry.forEach(v => out.push({ label: (v && v.label) || "", tags: (v && Array.isArray(v.tags) ? v.tags : []), kind: "entry" }));
  return out;
}

// Risolve la vista attiva sulla lista combinata in un descrittore { kind, tags }.
// - nessuna vista / "__all__" / indice non valido -> { kind: "all" } (nessun filtro)
// - vista task-tag  -> { kind: "task",  tags: Set }
// - vista entry-tag -> { kind: "entry", tags: Set }
export function resolveView(views, activeView){
  const list = Array.isArray(views) ? views : [];
  const all = { kind: "all", tags: new Set() };
  if (list.length === 0) return all;
  if (activeView == null || activeView === "__all__") return all;
  const idx = Number(activeView);
  if (!Number.isInteger(idx) || idx < 0 || idx >= list.length) return all;
  const v = list[idx];
  return {
    kind: v.kind === "entry" ? "entry" : "task",
    tags: new Set((Array.isArray(v.tags) ? v.tags : []).map(normalizeTag))
  };
}

// Data una vista risolta + le entry disponibili + byId (per i tag ereditati), calcola
// il predicato di match sui task e le entry "in scope" per il conteggio ore. Usato dai
// tab Settimanale e Mensile (Consumo ore ha una logica propria intrecciata coi pacchetti).
// - "all":   nessun filtro; entry invariate
// - "task":  match sui tag EFFETTIVI del task (foglia eredita dal padre); entry invariate
// - "entry": match sui task con ≥1 entry taggata; entry ristrette alle taggate (le ore
//            riflettono così solo la parte "extra"). Gli id sono derivati in un'unica
//            passata dalle entry già filtrate.
export function viewFilter(view, entries, byId){
  if (!view || view.kind === "all" || !view.tags || view.tags.size === 0) {
    return { taskMatches: () => true, scopedEntries: entries };
  }
  if (view.kind === "entry") {
    const scopedEntries = (Array.isArray(entries) ? entries : []).filter(e => entryMatchesTags(e, view.tags));
    const ids = new Set();
    scopedEntries.forEach(e => { if (e && e.task && e.task.id != null) ids.add(e.task.id); });
    return { taskMatches: (t) => ids.has(t.id), scopedEntries };
  }
  // task
  const taskMatches = (t) => {
    const names = effectiveTagNames(t, byId);
    for (const tag of view.tags) if (names.has(tag)) return true;
    return false;
  };
  return { taskMatches, scopedEntries: entries };
}

// Chiave localStorage per la vista attiva. Il prefisso "pirelli-weekly:" è il namespace
// globale legacy dell'app (coerente con la chiave "pirelli-weekly:table-filter"); lo
// scoping per-cliente avviene col suffisso slug, quindi clienti diversi non collidono.
export function viewStorageKey(slug){
  return "pirelli-weekly:active-view:" + (slug || "");
}
