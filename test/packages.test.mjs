// test/packages.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tasksById, effectiveTagNames, containerIds,
  normalizePackages, assignPackageIndex,
  accruedMsForMonth, inSeasonWindow, packageStorageKey
} from "../public/js/packages.mjs";

const HOUR_MS = 3600000;
const task = (id, tags, parent) => ({ id, parent: parent || null, tags: (tags||[]).map(name => ({ name })) });

test("effectiveTagNames: leaf inherits parent tags (union, normalized)", () => {
  const parent = task("p", ["Estate"]);
  const child  = task("c", ["urgente"], "p");
  const byId = tasksById([parent, child]);
  const names = effectiveTagNames(child, byId);
  assert.ok(names.has("estate"));   // ereditato dal padre
  assert.ok(names.has("urgente"));  // proprio
});

test("effectiveTagNames: task without parent uses own tags only", () => {
  const t = task("a", ["Bug"]);
  const byId = tasksById([t]);
  assert.deepEqual([...effectiveTagNames(t, byId)], ["bug"]);
});

test("effectiveTagNames: missing parent in map does not crash", () => {
  const child = task("c", ["x"], "ghost");
  const byId = tasksById([child]);
  assert.deepEqual([...effectiveTagNames(child, byId)], ["x"]);
});

test("containerIds: returns ids that are parent of someone", () => {
  const parent = task("p", ["estate"]);
  const child  = task("c", [], "p");
  const solo   = task("s", ["bug"]);
  const ids = containerIds([parent, child, solo]);
  assert.ok(ids.has("p"));    // ha un figlio
  assert.ok(!ids.has("c"));   // è figlio, non contenitore
  assert.ok(!ids.has("s"));   // foglia indipendente
});

test("normalizePackages: array pass-through con default", () => {
  const cfg = { pacchettiOre: [
    { label: "Estate", periodo: "stagionale", ore: 60, dataInizio: "2026-06-01", dataFine: "2026-09-30", tags: ["estate"] }
  ]};
  const pkgs = normalizePackages(cfg);
  assert.equal(pkgs.length, 1);
  assert.equal(pkgs[0].label, "Estate");
  assert.equal(pkgs[0].periodo, "stagionale");
  assert.deepEqual(pkgs[0].tags, ["estate"]);  // normalizzati
});

test("normalizePackages: legacy pacchettoOre singolo => array di uno", () => {
  const cfg = { pacchettoOre: { ore: 20, periodo: "annuale" }, dataInizio: "2026-01-01" };
  const pkgs = normalizePackages(cfg);
  assert.equal(pkgs.length, 1);
  assert.equal(pkgs[0].ore, 20);
  assert.equal(pkgs[0].periodo, "annuale");
  assert.equal(pkgs[0].dataInizio, "2026-01-01");  // ripreso dal livello cliente
  assert.deepEqual(pkgs[0].tags, []);              // legacy = nessun tag (cattura tutto)
});

test("normalizePackages: assente => array vuoto", () => {
  assert.deepEqual(normalizePackages({}), []);
  assert.deepEqual(normalizePackages(null), []);
});

test("normalizePackages: tags mancanti => array vuoto, label di default", () => {
  const pkgs = normalizePackages({ pacchettiOre: [ { ore: 10, periodo: "mensile", dataInizio: "2026-01-01" } ] });
  assert.deepEqual(pkgs[0].tags, []);
  assert.equal(pkgs[0].label, "Pacchetto 1");
});
