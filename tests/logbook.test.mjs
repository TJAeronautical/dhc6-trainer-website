/*
  Debrief Logbook — app/js/logic/logbook.js against LogbookScreen.kt,
  LogbookDetailScreen.kt and LogbookPdfExporter.kt.

  The tile said the gap was cloud sync. The gap was ~1,270 lines of Android:
  search, three enum filters, an overrides-only toggle, five sort modes, the
  Scenario Debrief screen and the PDF export.
*/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as LB from "../app/js/logic/logbook.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DAY = 24 * 60 * 60 * 1000;
const T = Date.UTC(2026, 8, 13, 12, 0, 0);

function entry(o) {
  return Object.assign({
    timestampUtc: T, procedureName: "Engine Fire in Flight", category: "EMERGENCY",
    aircraftVariant: "LEGACY", totalSteps: 10, wrongRoleCount: 0, wrongCalloutCount: 0,
    rushedCount: 0, toleranceUsedCount: 0, totalTimeMs: 60000, scoreBand: "GOOD",
    scorePercent: 85, remarks: "", instructorFeedback: null, examinerOverride: false,
    examinerMode: "OFF", attemptId: "procedure-drill-1757764800000-abc12345", stepLatencies: []
  }, o);
}

/* ------------------------------------------------------------- filtering */

test("search matches the procedure name only", () => {
  const list = [
    entry({ procedureName: "Engine Fire in Flight", remarks: "taxi was slow" }),
    entry({ procedureName: "Taxi", remarks: "engine fine" })
  ];
  assert.deepEqual(LB.applyFilters(list, { query: "engine" }).map((e) => e.procedureName), ["Engine Fire in Flight"],
    "remarks must not be searched — the Kotlin searches procedureName alone");
  assert.deepEqual(LB.applyFilters(list, { query: "  TAXI " }).map((e) => e.procedureName), ["Taxi"],
    "the query is trimmed and case-insensitive");
  assert.equal(LB.applyFilters(list, { query: "" }).length, 2);
});

test("each enum filter narrows independently, and null means ALL", () => {
  const list = [
    entry({ aircraftVariant: "LEGACY", scoreBand: "GOOD", examinerMode: "OFF" }),
    entry({ aircraftVariant: "G950", scoreBand: "FAIL", examinerMode: "ON" })
  ];
  assert.equal(LB.applyFilters(list, { aircraftVariant: "G950" }).length, 1);
  assert.equal(LB.applyFilters(list, { scoreBand: "GOOD" }).length, 1);
  assert.equal(LB.applyFilters(list, { examinerMode: "ON" }).length, 1);
  assert.equal(LB.applyFilters(list, {}).length, 2, "no filter set means everything");
});

test("overrides-only keeps just the examiner overrides", () => {
  const list = [entry({ examinerOverride: true }), entry({ examinerOverride: false })];
  assert.equal(LB.applyFilters(list, { overridesOnly: true }).length, 1);
  assert.equal(LB.applyFilters(list, { overridesOnly: false }).length, 2);
});

/* ---------------------------------------------------------------- sorting */

test("misses are clamped so a malformed entry cannot sort to the top", () => {
  assert.equal(LB.missesCount(entry({ wrongRoleCount: 2, wrongCalloutCount: 3 })), 5);
  assert.equal(LB.missesCount(entry({ wrongRoleCount: -9, wrongCalloutCount: 3 })), 3);
  assert.equal(LB.missesCount({}), 0);
});

test("scoreRank folds the historical band names the Kotlin folds", () => {
  assert.equal(LB.scoreRank("FAIL"), 0);
  assert.equal(LB.scoreRank("UNSATISFACTORY"), 0);
  assert.equal(LB.scoreRank("MARGINAL"), 1);
  assert.equal(LB.scoreRank("CAUTION"), 1);
  assert.equal(LB.scoreRank("GOOD"), 2);
  assert.equal(LB.scoreRank("EXCELLENT"), 3);
  assert.equal(LB.scoreRank("PASS"), 3);
  assert.equal(LB.scoreRank("SATISFACTORY"), 3);
  assert.equal(LB.scoreRank("something else"), 2, "unknown bands land on GOOD's rank");
});

test("the five sort modes order the way the Kotlin does", () => {
  const a = entry({ procedureName: "A", timestampUtc: T, scoreBand: "EXCELLENT", wrongCalloutCount: 0, totalTimeMs: 10000 });
  const b = entry({ procedureName: "B", timestampUtc: T - DAY, scoreBand: "FAIL", wrongCalloutCount: 5, totalTimeMs: 90000 });
  const c = entry({ procedureName: "C", timestampUtc: T - 2 * DAY, scoreBand: "MARGINAL", wrongCalloutCount: 2, totalTimeMs: 50000 });
  const list = [c, a, b];
  const names = (sort) => LB.applySort(list, sort).map((e) => e.procedureName);

  assert.deepEqual(names("NEWEST"), ["A", "B", "C"]);
  assert.deepEqual(names("OLDEST"), ["C", "B", "A"]);
  assert.deepEqual(names("MOST_MISSES"), ["B", "C", "A"]);
  assert.deepEqual(names("LONGEST_TIME"), ["B", "C", "A"]);
  assert.deepEqual(names("WORST_SCORE"), ["B", "C", "A"]);
  assert.deepEqual(names("anything else"), ["A", "B", "C"], "an unknown sort falls back to newest");
});

test("sort tiebreakers run in the Kotlin's order", () => {
  /* Same miss count: the newer entry wins. */
  const older = entry({ procedureName: "older", timestampUtc: T - DAY, wrongCalloutCount: 3 });
  const newer = entry({ procedureName: "newer", timestampUtc: T, wrongCalloutCount: 3 });
  assert.deepEqual(LB.applySort([older, newer], "MOST_MISSES").map((e) => e.procedureName), ["newer", "older"]);

  /* Same band: more misses sorts worse first. */
  const few = entry({ procedureName: "few", scoreBand: "MARGINAL", wrongCalloutCount: 1, timestampUtc: T });
  const many = entry({ procedureName: "many", scoreBand: "MARGINAL", wrongCalloutCount: 6, timestampUtc: T });
  assert.deepEqual(LB.applySort([few, many], "WORST_SCORE").map((e) => e.procedureName), ["many", "few"]);
});

test("applySort does not mutate the list it was given", () => {
  const list = [entry({ procedureName: "A", timestampUtc: T - DAY }), entry({ procedureName: "B", timestampUtc: T })];
  const before = list.map((e) => e.procedureName);
  LB.applySort(list, "NEWEST");
  assert.deepEqual(list.map((e) => e.procedureName), before);
});

test("visibleEntries filters then sorts", () => {
  const list = [
    entry({ procedureName: "Engine Fire", timestampUtc: T - DAY, aircraftVariant: "LEGACY" }),
    entry({ procedureName: "Engine Failure", timestampUtc: T, aircraftVariant: "G950" }),
    entry({ procedureName: "Taxi", timestampUtc: T, aircraftVariant: "LEGACY" })
  ];
  const out = LB.visibleEntries(list, { query: "engine", sort: "OLDEST" });
  assert.deepEqual(out.map((e) => e.procedureName), ["Engine Fire", "Engine Failure"]);
});

/* ------------------------------------------------------------- entry keys */

test("the stable key separates entries taken in the same millisecond", () => {
  const a = entry({ attemptId: "one" });
  const b = entry({ attemptId: "two" });
  assert.notEqual(LB.stableKey(a), LB.stableKey(b));
  assert.equal(LB.stableKey(a), LB.stableKey(entry({ attemptId: "one" })), "same content, same key");
  assert.equal(LB.findByKey([a, b], LB.stableKey(b)).attemptId, "two");
  assert.equal(LB.findByKey([a, b], "nope"), null);
});

test("the attempt short id is the last eight characters, or an em dash", () => {
  assert.equal(LB.attemptShortId("procedure-drill-1757764800000-abc12345"), "abc12345");
  assert.equal(LB.attemptShortId("short"), "short");
  assert.equal(LB.attemptShortId(""), "—");
  assert.equal(LB.attemptShortId(null), "—");
});

/* ------------------------------------------------------------- formatting */

test("durations format the way LogbookDetailScreen does", () => {
  assert.equal(LB.formatDuration(0), "0s");
  assert.equal(LB.formatDuration(7400), "7s");
  assert.equal(LB.formatDuration(60000), "1m 00s");
  assert.equal(LB.formatDuration(187000), "3m 07s");
  assert.equal(LB.formatDuration(-5000), "0s", "a negative duration never renders as negative");
  /* The Kotlin has no hours branch — 90 minutes stays in minutes. */
  assert.equal(LB.formatDuration(5_400_000), "90m 00s");
});

test("the average score ignores entries with no percentage", () => {
  assert.equal(LB.averageScoreLabel([entry({ scorePercent: 80 }), entry({ scorePercent: 90 })]), "85%");
  assert.equal(LB.averageScoreLabel([entry({ scorePercent: 80 }), entry({ scorePercent: null })]), "80%",
    "an unscored entry must not drag the average toward zero");
  assert.equal(LB.averageScoreLabel([entry({ scorePercent: null })]), "—");
  assert.equal(LB.averageScoreLabel([]), "—");
});

test("ellipsize trims to the exporter's column widths", () => {
  assert.equal(LB.ellipsize("short", 10), "short");
  assert.equal(LB.ellipsize("abcdefghijk", 5), "abcd…");
});

/* ---------------------------------------------------------------- debrief */

test("instructor feedback is used when written, and substituted by band when not", () => {
  assert.equal(LB.instructorDebrief(entry({ instructorFeedback: "Watch the flap gate." })), "Watch the flap gate.");
  assert.equal(LB.instructorDebrief(entry({ instructorFeedback: "   ", scoreBand: "EXCELLENT" })),
    "Line standard maintained throughout the run.");
  assert.equal(LB.instructorDebrief(entry({ instructorFeedback: null, scoreBand: "FAIL" })),
    "Unsatisfactory performance. Rebrief and repeat under instruction.");
  assert.equal(LB.instructorDebrief(entry({ scoreBand: "UNSATISFACTORY" })),
    LB.instructorDebrief(entry({ scoreBand: "FAIL" })), "the Kotlin shares one line between these two bands");
});

test("remarks fall back to a plain statement rather than an empty card", () => {
  assert.equal(LB.remarksText(entry({ remarks: "Memory items clean." })), "Memory items clean.");
  assert.equal(LB.remarksText(entry({ remarks: "  " })), "No remarks recorded.");
});

test("the repeat recommendation needs a clean run, not just an EXCELLENT band", () => {
  assert.equal(LB.repeatRecommendation(entry({ scoreBand: "EXCELLENT", rushedCount: 0, wrongCalloutCount: 0 })),
    "Advance to a scenario variant with added ATC pressure and PM/PF swaps.");
  assert.equal(LB.repeatRecommendation(entry({ scoreBand: "EXCELLENT", rushedCount: 2, wrongCalloutCount: 0 })),
    "Return to QRH memory items, brief the flow aloud, then repeat the drill from the top.",
    "EXCELLENT with rushed steps drops to the remedial line, as in the Kotlin");
  assert.equal(LB.repeatRecommendation(entry({ scoreBand: "GOOD" })),
    "Repeat once in the same mode, then switch roles and run again.");
  assert.equal(LB.repeatRecommendation(entry({ scoreBand: "MARGINAL" })),
    "Return to QRH memory items, brief the flow aloud, then repeat the drill from the top.");
});

test("timing is averaged over step latencies, not the total", () => {
  const t = LB.timingSummary(entry({ totalTimeMs: 100000, stepLatencies: [1000, 3000, 2000] }));
  assert.equal(t.total, 100000);
  assert.equal(t.average, 2000);
  assert.equal(t.slowest, 3000);
  assert.equal(t.fastest, 1000);

  const none = LB.timingSummary(entry({ totalTimeMs: 100000, stepLatencies: [] }));
  assert.deepEqual([none.average, none.slowest, none.fastest], [0, 0, 0], "no latencies must not divide by zero");
});

test("only twelve step latencies are listed, and the rest are counted", () => {
  const many = LB.timingSummary(entry({ stepLatencies: Array.from({ length: 20 }, (_, i) => 1000 + i) }));
  assert.equal(many.shown.length, 12);
  assert.equal(many.moreCount, 8);
  const few = LB.timingSummary(entry({ stepLatencies: [1000, 2000] }));
  assert.equal(few.moreCount, 0);
});

test("the outcome rows are the Kotlin's, in order", () => {
  const rows = LB.outcomeRows(entry({ scorePercent: 85, totalSteps: 12, wrongRoleCount: 1, wrongCalloutCount: 2, rushedCount: 3, toleranceUsedCount: 4 }));
  assert.deepEqual(rows.map((r) => r[0]),
    ["Band", "Score", "Total steps", "Wrong role", "Wrong callout/action", "Rushed steps", "Tolerance used"]);
  assert.deepEqual(rows.map((r) => r[1]), ["GOOD", "85%", "12", "1", "2", "3", "4"]);
  assert.equal(LB.outcomeRows(entry({ scorePercent: null }))[1][1], "N/A");
});

test("the examiner line appears only when it has something to say", () => {
  assert.equal(LB.examinerLine(entry({ examinerMode: "OFF", examinerOverride: false })), null);
  assert.equal(LB.examinerLine(entry({ examinerMode: "ON", examinerOverride: false })), "Examiner mode: ON");
  assert.equal(LB.examinerLine(entry({ examinerMode: "OFF", examinerOverride: true })), "Examiner mode: OFF  -  Override used");
});

test("the score pill drops the percentage when none was recorded", () => {
  assert.equal(LB.scorePillText(entry({ scoreBand: "GOOD", scorePercent: 85 })), "GOOD  -  85%");
  assert.equal(LB.scorePillText(entry({ scoreBand: "GOOD", scorePercent: null })), "GOOD");
});

/* ----------------------------------------------------------------- export */

test("the export carries the Kotlin's training note verbatim", () => {
  assert.equal(LB.EXPORT_NOTE,
    "This PDF is a local study export from the DHC-6 Trainer app. It is intended for debrief review, instructor discussion, and personal proficiency tracking. It is not an aircraft technical log or certified training record.");
  assert.equal(LB.exportSummary([], T).note, LB.EXPORT_NOTE, "no export is produced without it");
});

test("the export summary totals the entries it was given", () => {
  const list = [entry({ totalTimeMs: 60000, scorePercent: 80 }), entry({ totalTimeMs: 120000, scorePercent: 90 })];
  const s = LB.exportSummary(list, T);
  assert.equal(s.totalEntries, 2);
  assert.equal(s.totalDrillTime, "3m 00s");
  assert.equal(s.averageScore, "85%");
});

test("the export file name follows the Kotlin's stamp", () => {
  assert.match(LB.exportFileName(T), /^dhc6_logbook_\d{8}_\d{6}\.pdf$/);
});

test("export rows are trimmed to the Kotlin's column widths", () => {
  const row = LB.exportRow(entry({
    procedureName: "A procedure name that is comfortably longer than thirty-four characters",
    remarks: "line one\nline two",
    category: "EMERGENCY"
  }));
  assert.equal(row.procedure.length, 34);
  assert.equal(row.category, "Emergency", "the category is title-cased for the table");
  assert.equal(row.remarks, "line one line two", "newlines are folded so the remarks stay on one line");
});

/* ------------------------------------------------------- wiring and safety */

test("the logbook routes are registered and the export is reachable", () => {
  const appJs = fs.readFileSync(path.join(root, "app", "app.js"), "utf8");
  const registered = new Map(Array.from(appJs.matchAll(/route\("([^"]+)",\s*([A-Za-z0-9_]+)\)/g), (m) => [m[1], m[2]]));
  assert.equal(registered.get("/training/logbook"), "logbook");
  assert.equal(registered.get("/training/logbook/entry/:key"), "logbookDetail");
  assert.equal(registered.get("/training/logbook/export"), "logbookExport");
});

test("the export is the browser's own print, with no bundled PDF library", () => {
  const screen = fs.readFileSync(path.join(root, "app", "js", "screens", "logbook.js"), "utf8");
  assert.match(screen, /window\.print\(\)/);
  assert.doesNotMatch(screen, /jspdf|pdfkit|pdf-lib|cdn\./i, "no third-party PDF dependency");
  assert.match(screen, /LB\.EXPORT_NOTE|summary\.note/, "the training note must be rendered");

  /* Print CSS must strip the app chrome, or the PDF carries a nav rail. */
  const css = fs.readFileSync(path.join(root, "app", "app.css"), "utf8");
  const print = css.slice(css.indexOf("@media print"));
  for (const hidden of [".app-rail", ".app-bottomnav", ".app-topbar", ".app-disclaimer", ".no-print"]) {
    assert.ok(print.includes(hidden), "print CSS must hide " + hidden);
  }
});

test("the logbook still says its entries are local to this browser", () => {
  const screen = fs.readFileSync(path.join(root, "app", "js", "screens", "logbook.js"), "utf8");
  assert.match(screen, /stored in this browser only/);
  const core = fs.readFileSync(path.join(root, "app", "js", "core.js"), "utf8");
  assert.match(core, /id: "logbook"[^}]*status: "partial"/,
    "cloud sync is still missing, so the tile stays Partial rather than claiming Available");
});
