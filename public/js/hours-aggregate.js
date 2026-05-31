// === Aggregazioni pure per la vista "Consumo ore" ===
// Nessun import, nessun accesso al DOM: funzioni pure, testabili in isolamento
// (anche da console: const m = await import('/js/hours-aggregate.js')).

// Raggruppa le time-entry per task. `taskById` è una Map(taskId -> task della board)
// usata per nome/url/status/assegnatari coerenti con la vista settimanale.
// Ritorna { rows, totalMs }; rows ordinate per ore decrescenti.
export function aggregateByTask(entries, taskById){
  const msById = new Map();    // taskId -> ms totali
  const nameById = new Map();  // taskId -> nome di fallback ricavato dall'entry
  let totalMs = 0;
  (entries || []).forEach(e => {
    const t = e && e.task;
    const id = t && t.id;
    if (!id) return;
    const ms = Number(e.duration_ms) || 0;
    msById.set(id, (msById.get(id) || 0) + ms);
    totalMs += ms;
    if (t.name && !nameById.has(id)) nameById.set(id, t.name);
  });
  const rows = [];
  msById.forEach((ms, id) => {
    const meta = (taskById && taskById.get(id)) || {};
    rows.push({
      id,
      name: meta.name || nameById.get(id) || "(senza titolo)",
      url: meta.url || null,
      status: meta.status != null ? meta.status : null,
      assignees: Array.isArray(meta.assignees) ? meta.assignees : [],
      ms,
      pct: totalMs > 0 ? (ms / totalMs) * 100 : 0
    });
  });
  rows.sort((a, b) => b.ms - a.ms);
  return { rows, totalMs };
}

// Raggruppa le time-entry per utente ClickUp che ha tracciato il tempo (e.user).
// Ritorna un array ordinato per ore decrescenti: [{ id, name, color, ms }].
// Entry senza utente confluiscono in un bucket "Sconosciuto".
export function aggregateByUser(entries){
  const byId = new Map();
  (entries || []).forEach(e => {
    const ms = Number(e && e.duration_ms) || 0;
    const u = e && e.user;
    const id = (u && u.id != null) ? u.id : "unknown";
    const cur = byId.get(id) || {
      id,
      name: (u && (u.username || u.email)) || "Sconosciuto",
      color: (u && u.color) || null,
      ms: 0
    };
    cur.ms += ms;
    byId.set(id, cur);
  });
  return [...byId.values()].sort((a, b) => b.ms - a.ms);
}
