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
