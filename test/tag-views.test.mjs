import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTag, taskTagNames, taskMatchesTags, resolveTagSet, viewStorageKey,
  entryTagNames, entryMatchesTags, entryTaskIds, combinedViews, resolveView, viewFilter
} from "../public/js/tag-views.mjs";

const task = (tags) => ({ tags: tags.map(name => ({ name })) });
const entry = (taskId, tags) => ({ task: { id: taskId }, tags: (tags || []).map(name => ({ name })) });

test("normalizeTag lowercases and trims", () => {
  assert.equal(normalizeTag("  Frontend  "), "frontend");
  assert.equal(normalizeTag(null), "");
});

test("taskTagNames returns normalized set", () => {
  const names = taskTagNames(task(["Bug", " UI "]));
  assert.ok(names.has("bug"));
  assert.ok(names.has("ui"));
});

test("taskMatchesTags: empty set matches everything", () => {
  assert.equal(taskMatchesTags(task([]), new Set()), true);
});

test("taskMatchesTags: OR match, case-insensitive", () => {
  const set = new Set(["api", "db"]);
  assert.equal(taskMatchesTags(task(["API"]), set), true);   // uno basta (OR)
  assert.equal(taskMatchesTags(task(["frontend"]), set), false);
});

test("taskMatchesTags: task without tags excluded when set non-empty", () => {
  assert.equal(taskMatchesTags({ tags: null }, new Set(["bug"])), false);
});

const VIEWS = [
  { label: "Frontend", tags: ["frontend", "ui"] },
  { label: "Bug", tags: ["Bug"] },
  { label: "Backend", tags: ["api", "db"] },
];

test("resolveTagSet: no views => empty set (no filter)", () => {
  assert.equal(resolveTagSet(null, "__all__").size, 0);
  assert.equal(resolveTagSet([], "0").size, 0);
});

test("resolveTagSet: __all__ => empty set (no filter, 'Tutti' shows every task)", () => {
  // "Tutti" non è l'unione delle viste: è l'intera lista senza filtro. Con una sola
  // vista configurata (es. cliente Inspire), l'unione avrebbe nascosto tutti i task
  // privi di quel tag; "Tutti" deve invece mostrarli.
  assert.equal(resolveTagSet(VIEWS, "__all__").size, 0);
});

test("resolveTagSet: index selects that view (normalized)", () => {
  assert.deepEqual([...resolveTagSet(VIEWS, "1")], ["bug"]);
  assert.deepEqual([...resolveTagSet(VIEWS, "2")].sort(), ["api", "db"]);
});

test("resolveTagSet: out-of-range index falls back to 'Tutti' (no filter)", () => {
  assert.equal(resolveTagSet(VIEWS, "9").size, 0);
  assert.equal(resolveTagSet(VIEWS, "x").size, 0);
});

// === Viste su tag delle time entry ===

test("entryTagNames / entryMatchesTags: normalizzati, OR", () => {
  assert.ok(entryTagNames(entry("a", ["Extras-Inspire25"])).has("extras-inspire25"));
  assert.equal(entryMatchesTags(entry("a", ["extras-inspire25"]), new Set(["extras-inspire25"])), true);
  assert.equal(entryMatchesTags(entry("a", ["altro"]), new Set(["extras-inspire25"])), false);
  assert.equal(entryMatchesTags(entry("a", []), new Set()), true); // set vuoto = nessun filtro
});

test("entryTaskIds: id dei task con almeno una entry taggata", () => {
  const entries = [
    entry("a", ["extras-inspire25"]),
    entry("a", []),               // stessa task, entry non taggata
    entry("b", ["altro"]),
    entry("c", ["extras-inspire25"]),
  ];
  const ids = entryTaskIds(entries, new Set(["extras-inspire25"]));
  assert.deepEqual([...ids].sort(), ["a", "c"]);
});

test("combinedViews: task views prima, poi entry views, con kind", () => {
  const cfg = {
    tagViews: [{ label: "T1", tags: ["x"] }],
    entryTagViews: [{ label: "Sviluppo Extra", tags: ["extras-inspire25"] }],
  };
  const v = combinedViews(cfg);
  assert.deepEqual(v.map(x => [x.label, x.kind]), [["T1", "task"], ["Sviluppo Extra", "entry"]]);
});

test("combinedViews: chiavi assenti => lista vuota", () => {
  assert.deepEqual(combinedViews({}), []);
  assert.deepEqual(combinedViews(null), []);
});

test("resolveView: __all__/non valido => kind all (nessun filtro)", () => {
  const views = combinedViews({ entryTagViews: [{ label: "Extra", tags: ["extras-inspire25"] }] });
  assert.equal(resolveView(views, "__all__").kind, "all");
  assert.equal(resolveView(views, "9").kind, "all");
  assert.equal(resolveView([], "0").kind, "all");
});

test("resolveView: indice entry-tag => kind entry + tags normalizzati", () => {
  const views = combinedViews({ entryTagViews: [{ label: "Extra", tags: ["Extras-Inspire25"] }] });
  const r = resolveView(views, "0");
  assert.equal(r.kind, "entry");
  assert.deepEqual([...r.tags], ["extras-inspire25"]);
});

test("resolveView: indice task-tag => kind task", () => {
  const views = combinedViews({ tagViews: [{ label: "T", tags: ["Bug"] }] });
  const r = resolveView(views, "0");
  assert.equal(r.kind, "task");
  assert.deepEqual([...r.tags], ["bug"]);
});

// === viewFilter (helper condiviso Settimanale/Mensile) ===

test("viewFilter: all => nessun filtro, entry invariate (stesso riferimento)", () => {
  const entries = [entry("a", ["x"]), entry("b", [])];
  const r = viewFilter({ kind: "all", tags: new Set() }, entries, new Map());
  assert.equal(r.taskMatches({ id: "z" }), true);
  assert.equal(r.scopedEntries, entries);
});

test("viewFilter: entry => task con entry taggata, entry ristrette alle taggate", () => {
  const entries = [entry("a", ["extras-inspire25"]), entry("a", []), entry("b", ["altro"])];
  const r = viewFilter({ kind: "entry", tags: new Set(["extras-inspire25"]) }, entries, new Map());
  assert.deepEqual(r.scopedEntries.map(e => e.task.id), ["a"]);
  assert.equal(r.taskMatches({ id: "a" }), true);
  assert.equal(r.taskMatches({ id: "b" }), false);
});

test("viewFilter: task => match sui tag effettivi (eredita dal padre), entry invariate", () => {
  const parent = { id: "p", tags: [{ name: "frontend" }] };
  const child = { id: "c", parent: "p", tags: [] };
  const byId = new Map([["p", parent], ["c", child]]);
  const entries = [entry("c", [])];
  const r = viewFilter({ kind: "task", tags: new Set(["frontend"]) }, entries, byId);
  assert.equal(r.taskMatches(child), true);                  // eredita "frontend" dal padre
  assert.equal(r.taskMatches({ id: "x", tags: [] }), false);
  assert.equal(r.scopedEntries, entries);
});

test("viewStorageKey is slug-scoped", () => {
  assert.equal(viewStorageKey("pirelli"), "pirelli-weekly:active-view:pirelli");
});

test("normalizeTag handles undefined", () => {
  assert.equal(normalizeTag(undefined), "");
});

test("taskTagNames dedupes case-insensitively", () => {
  const names = taskTagNames(task(["Bug", "BUG", "bug"]));
  assert.equal(names.size, 1);
  assert.ok(names.has("bug"));
});

test("taskMatchesTags: null/undefined tagSet matches everything (no view selected)", () => {
  assert.equal(taskMatchesTags(task(["bug"]), null), true);
  assert.equal(taskMatchesTags(task([]), undefined), true);
});

test("viewStorageKey handles empty/undefined slug", () => {
  assert.equal(viewStorageKey(""), "pirelli-weekly:active-view:");
  assert.equal(viewStorageKey(undefined), "pirelli-weekly:active-view:");
});
