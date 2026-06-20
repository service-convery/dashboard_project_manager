import { test } from "node:test";
import assert from "node:assert/strict";
import * as fmt from "../public/js/format.js";

const H = 3600000, M = 60000;

// Le ore in dashboard sono da 60 minuti: il formato deve essere "Xh Ym",
// MAI decimale. Il caso classico del bug: 10h 48m mostrato come "10,8" (decimale)
// faceva sembrare "10 ore e 8 minuti" pur valendo 10 ore e 48 minuti.
test("fmtHM: ore:minuti, non decimale (10h48m ≠ 10,8)", () => {
  assert.equal(fmt.fmtHM(10 * H + 48 * M), "10h 48m");
  assert.equal(fmt.fmtHM(10 * H + 8 * M), "10h 8m");
});

test("fmtHM: ore intere senza minuti", () => {
  assert.equal(fmt.fmtHM(40 * H), "40h");
});

test("fmtHM: sotto l'ora solo minuti", () => {
  assert.equal(fmt.fmtHM(48 * M), "48m");
});

test("fmtHM: zero e valori non validi", () => {
  assert.equal(fmt.fmtHM(0), "0h");
  assert.equal(fmt.fmtHM(null), "0h");
  assert.equal(fmt.fmtHM(NaN), "0h");
});

// Fix definitivo: niente formattatore decimale delle ore in giro. Tutte le viste
// (settimanale, mensile, consumo ore) devono usare un unico formato ore:minuti.
test("nessun formattatore decimale legacy esportato (fmtHours rimosso)", () => {
  assert.equal(fmt.fmtHours, undefined);
});
