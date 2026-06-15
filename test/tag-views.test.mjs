import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTag, taskTagNames, taskMatchesTags, resolveTagSet, viewStorageKey
} from "../public/js/tag-views.mjs";

const task = (tags) => ({ tags: tags.map(name => ({ name })) });

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

test("resolveTagSet: __all__ => union of all view tags", () => {
  const s = resolveTagSet(VIEWS, "__all__");
  assert.deepEqual([...s].sort(), ["api", "bug", "db", "frontend", "ui"]);
});

test("resolveTagSet: index selects that view (normalized)", () => {
  assert.deepEqual([...resolveTagSet(VIEWS, "1")], ["bug"]);
  assert.deepEqual([...resolveTagSet(VIEWS, "2")].sort(), ["api", "db"]);
});

test("resolveTagSet: out-of-range index falls back to union", () => {
  assert.equal(resolveTagSet(VIEWS, "9").size, 5);
  assert.equal(resolveTagSet(VIEWS, "x").size, 5);
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
