/*
  Check Ride Readiness — app/js/logic/competency.js against the behaviour
  documented in domain/analytics/CompetencyAnalyzer.kt.

  The point of these is the arithmetic, not the rendering: Kotlin truncates
  where JavaScript would round, and the Kotlin's own KDoc calls out the one
  edge case people get wrong ("If no entries exist for a category, the category
  score is 0 (not 100%)").
*/
import test from "node:test";
import assert from "node:assert/strict";
import * as CMP from "../app/js/logic/competency.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 13, 12, 0, 0);

function entry(opts) {
  return {
    timestampUtc: NOW - (opts.daysAgo || 0) * DAY,
    procedureName: opts.name,
    category: opts.category,
    aircraftVariant: opts.variant || "BOTH",
    totalSteps: 10,
    wrongRoleCount: 0,
    wrongCalloutCount: 0,
    rushedCount: 0,
    toleranceUsedCount: 0,
    totalTimeMs: 60000,
    scoreBand: "GOOD",
    scorePercent: opts.score === undefined ? 85 : opts.score,
    remarks: "",
    instructorFeedback: null,
    examinerOverride: false,
    examinerMode: "OFF",
    attemptId: opts.name + "-" + (opts.daysAgo || 0),
    stepLatencies: []
  };
}

test("the authored thresholds and weights are the Kotlin's", () => {
  assert.deepEqual(CMP.THRESHOLD_DAYS, { EMERGENCY: 14, ABNORMAL: 21, NORMAL: 30 });
  assert.deepEqual(CMP.WEIGHTS, { EMERGENCY: 0.40, ABNORMAL: 0.35, NORMAL: 0.25 });
  assert.equal(CMP.WEIGHTS.EMERGENCY + CMP.WEIGHTS.ABNORMAL + CMP.WEIGHTS.NORMAL, 1);
});

test("an empty logbook scores 0, not 100, and every category reads overdue", () => {
  const r = CMP.analyze([], NOW);
  assert.equal(r.overallPercent, 0);
  assert.equal(r.totalDrillCount, 0);
  assert.equal(r.readinessLabel, "No Training Data");
  assert.equal(r.isReadyForCheckRide, false);
  for (const cat of CMP.categoriesOf(r)) {
    assert.equal(cat.scorePercent, 0, cat.category + " must not be credited as current");
    assert.equal(cat.isOverdue, true);
    assert.equal(cat.statusLabel, "No records");
    assert.equal(cat.daysSinceLastDrill, null);
    assert.deepEqual(cat.overdueProcedureNames, []);
  }
});

test("a procedure inside its category threshold is current, outside it is overdue", () => {
  /* Emergency threshold is 14 days: 13 days ago is current, 15 is not. */
  const r = CMP.analyze([
    entry({ name: "Engine Fire in Flight", category: "EMERGENCY", daysAgo: 13 }),
    entry({ name: "Engine Failure After Take-off", category: "EMERGENCY", daysAgo: 15 })
  ], NOW);
  const em = r.emergency;
  assert.equal(em.distinctProceduresDrilled, 2);
  assert.equal(em.distinctProceduresCurrent, 1);
  assert.equal(em.scorePercent, 50);
  assert.deepEqual(em.overdueProcedureNames, ["Engine Failure After Take-off"]);
});

test("exactly on the threshold still counts as current", () => {
  // Kotlin: `if (ageMs <= thresholdMs)` — inclusive.
  const r = CMP.analyze([entry({ name: "Battery Overheat", category: "ABNORMAL", daysAgo: 21 })], NOW);
  assert.equal(r.abnormal.distinctProceduresCurrent, 1);
  assert.equal(r.abnormal.scorePercent, 100);
  // isOverdue compares whole days: 21 > 21 is false.
  assert.equal(r.abnormal.isOverdue, false);
  assert.equal(r.abnormal.statusLabel, "Current");
});

test("the most recent attempt of a procedure is the one that counts", () => {
  const r = CMP.analyze([
    entry({ name: "Engine Fire in Flight", category: "EMERGENCY", daysAgo: 40 }),
    entry({ name: "Engine Fire in Flight", category: "EMERGENCY", daysAgo: 2 })
  ], NOW);
  assert.equal(r.emergency.distinctProceduresDrilled, 1, "same name is one distinct procedure");
  assert.equal(r.emergency.distinctProceduresCurrent, 1, "the recent attempt makes it current");
  assert.deepEqual(r.emergency.overdueProcedureNames, []);
  assert.equal(r.emergency.daysSinceLastDrill, 2);
});

test("scorePercent truncates like Kotlin's toInt(), it does not round", () => {
  // 2 of 3 is 66.67 -> 66, not 67.
  const r = CMP.analyze([
    entry({ name: "A", category: "NORMAL", daysAgo: 1 }),
    entry({ name: "B", category: "NORMAL", daysAgo: 1 }),
    entry({ name: "C", category: "NORMAL", daysAgo: 45 })
  ], NOW);
  assert.equal(r.normal.scorePercent, 66);
});

test("the overall score is the weighted sum, truncated", () => {
  /* Emergency 100, Abnormal 0 (never drilled), Normal 100:
     100*0.40 + 0*0.35 + 100*0.25 = 65. */
  const r = CMP.analyze([
    entry({ name: "Engine Fire in Flight", category: "EMERGENCY", daysAgo: 1 }),
    entry({ name: "Before Start", category: "NORMAL", daysAgo: 1 })
  ], NOW);
  assert.equal(r.emergency.scorePercent, 100);
  assert.equal(r.abnormal.scorePercent, 0);
  assert.equal(r.normal.scorePercent, 100);
  assert.equal(r.overallPercent, 65);
  assert.equal(r.readinessLabel, "Building Currency");
  assert.equal(r.isReadyForCheckRide, false);
});

test("readiness labels follow the Kotlin bands", () => {
  const cases = [
    { em: 100, ab: 100, nm: 100, label: "Check Ride Ready", ready: true },
    { em: 100, ab: 100, nm: 0, label: "Approaching Standard", ready: false },
    { em: 100, ab: 0, nm: 100, label: "Building Currency", ready: false },
    { em: 0, ab: 100, nm: 0, label: "Needs Drilling", ready: false }
  ];
  for (const c of cases) {
    const entries = [];
    // Each category is "all current" or "all overdue" by drilling one procedure
    // recently or long ago.
    for (const [cat, pct] of [["EMERGENCY", c.em], ["ABNORMAL", c.ab], ["NORMAL", c.nm]]) {
      entries.push(entry({ name: cat + "-proc", category: cat, daysAgo: pct === 100 ? 1 : 400 }));
    }
    const r = CMP.analyze(entries, NOW);
    assert.equal(r.readinessLabel, c.label, JSON.stringify(c));
    assert.equal(r.isReadyForCheckRide, c.ready, JSON.stringify(c));
  }
});

test("75 is Approaching Standard and 90 is Check Ride Ready (boundaries)", () => {
  // Boundaries are >=, so build them exactly: 100/100/0 -> 75; 100/100/60 -> 90.
  const at75 = CMP.analyze([
    entry({ name: "E", category: "EMERGENCY", daysAgo: 1 }),
    entry({ name: "A", category: "ABNORMAL", daysAgo: 1 }),
    entry({ name: "N", category: "NORMAL", daysAgo: 400 })
  ], NOW);
  assert.equal(at75.overallPercent, 75);
  assert.equal(at75.readinessLabel, "Approaching Standard");

  /* Emergency 100 (40) + Abnormal 100 (35) + Normal 60 (15) = exactly 90.
     Normal at 60% is 3 of 5 distinct procedures still inside the 30-day window. */
  const at90 = CMP.analyze([
    entry({ name: "E", category: "EMERGENCY", daysAgo: 1 }),
    entry({ name: "A", category: "ABNORMAL", daysAgo: 1 }),
    entry({ name: "N1", category: "NORMAL", daysAgo: 1 }),
    entry({ name: "N2", category: "NORMAL", daysAgo: 1 }),
    entry({ name: "N3", category: "NORMAL", daysAgo: 1 }),
    entry({ name: "N4", category: "NORMAL", daysAgo: 400 }),
    entry({ name: "N5", category: "NORMAL", daysAgo: 400 })
  ], NOW);
  assert.equal(at90.normal.scorePercent, 60);
  assert.equal(at90.overallPercent, 90);
  assert.equal(at90.readinessLabel, "Check Ride Ready");
  assert.equal(at90.isReadyForCheckRide, true);
});

test("the weighted sum stays IEEE754 double arithmetic, as Kotlin's does", () => {
  /*
    Kotlin computes the overall score as Doubles and then calls toInt(), which
    truncates. For 591 of the ~1.03M possible (emergency, abnormal, normal)
    triples the double sum lands a hair BELOW the exact decimal value, so the
    truncation gives one point less — e.g. 0/85/1 sums to 29.999999999999996
    and scores 29, not 30.

    That is Android's answer, so it has to be the web's answer too. This test
    exists to stop a well-meaning Math.round() or a toFixed() "cleanup" being
    added to competency.js: either would silently disagree with the app the
    subscriber is revising against.
  */
  const w = CMP.WEIGHTS;
  const drifted = 0 * w.EMERGENCY + 85 * w.ABNORMAL + 1 * w.NORMAL;
  assert.equal(drifted, 29.999999999999996, "the double sum must not be pre-rounded");
  assert.equal(Math.trunc(drifted), 29, "and truncation must keep Kotlin's answer");

  /* The same weights on a case the screen can actually reach. */
  const r = CMP.analyze([
    entry({ name: "E", category: "EMERGENCY", daysAgo: 1 }),
    entry({ name: "A", category: "ABNORMAL", daysAgo: 1 })
  ], NOW);
  assert.equal(r.overallPercent, 75);
});

test("the trend label needs two scores and compares halves", () => {
  function trendOf(scores) {
    const entries = scores.map(function (s, i) {
      return entry({ name: "P" + i, category: "EMERGENCY", daysAgo: i, score: s });
    });
    return CMP.analyze(entries, NOW).emergency.trendLabel;
  }
  assert.equal(trendOf([]), "Insufficient data");
  assert.equal(trendOf([80]), "Insufficient data");
  // recentScores are newest-first; daysAgo 0 is newest.
  assert.equal(trendOf([95, 60]), "Improving");
  assert.equal(trendOf([50, 95]), "Declining");
  assert.equal(trendOf([80, 80, 80]), "Stable");
});

test("only the five most recent scores drive the trend, ten are kept", () => {
  const entries = [];
  for (let i = 0; i < 12; i += 1) entries.push(entry({ name: "P" + i, category: "NORMAL", daysAgo: i, score: 50 + i }));
  const cat = CMP.analyze(entries, NOW).normal;
  assert.equal(cat.recentScores.length, 10, "Kotlin takes the 10 newest");
  assert.deepEqual(cat.recentScores.slice(0, 3), [50, 51, 52], "newest first");
});

test("entries with no score are dropped from the trend but still count as drills", () => {
  const r = CMP.analyze([
    entry({ name: "A", category: "NORMAL", daysAgo: 1, score: null }),
    entry({ name: "B", category: "NORMAL", daysAgo: 1, score: 90 })
  ], NOW);
  assert.deepEqual(r.normal.recentScores, [90]);
  assert.equal(r.normal.distinctProceduresDrilled, 2);
  assert.equal(r.totalDrillCount, 2);
});

test("at most six overdue procedure names are surfaced per category", () => {
  const entries = [];
  for (let i = 0; i < 9; i += 1) entries.push(entry({ name: "Old " + i, category: "EMERGENCY", daysAgo: 90 }));
  const r = CMP.analyze(entries, NOW);
  assert.equal(r.emergency.distinctProceduresDrilled, 9);
  assert.equal(r.emergency.overdueProcedureNames.length, 6);
  assert.equal(CMP.allOverdue(r).length, 6);
  assert.equal(CMP.allOverdue(r)[0].category, "EMERGENCY");
});

test("overdue items are listed Emergency, then Abnormal, then Normal", () => {
  const r = CMP.analyze([
    entry({ name: "N-old", category: "NORMAL", daysAgo: 90 }),
    entry({ name: "E-old", category: "EMERGENCY", daysAgo: 90 }),
    entry({ name: "A-old", category: "ABNORMAL", daysAgo: 90 })
  ], NOW);
  assert.deepEqual(CMP.allOverdue(r).map(function (o) { return o.category; }), ["EMERGENCY", "ABNORMAL", "NORMAL"]);
});

test("a category with entries outside the three known categories is ignored but still counted", () => {
  // Quiz entries land in NORMAL; anything unexpected must not crash or inflate.
  const r = CMP.analyze([
    entry({ name: "Mystery", category: "CHECKLIST", daysAgo: 1 }),
    entry({ name: "Before Start", category: "NORMAL", daysAgo: 1 })
  ], NOW);
  assert.equal(r.totalDrillCount, 2);
  assert.equal(r.normal.distinctProceduresDrilled, 1);
  assert.equal(r.emergency.distinctProceduresDrilled, 0);
});

test("days since last drill truncates whole days", () => {
  const r = CMP.analyze([{
    timestampUtc: NOW - (2 * DAY + 23 * 60 * 60 * 1000),
    procedureName: "Taxi", category: "NORMAL", scorePercent: 80
  }], NOW);
  assert.equal(r.normal.daysSinceLastDrill, 2, "2 days 23 hours is 2, not 3");
});

test("status bands match the Kotlin's colour rules", () => {
  assert.equal(CMP.readinessBand(80), "ready");
  assert.equal(CMP.readinessBand(79), "caution");
  assert.equal(CMP.readinessBand(60), "caution");
  assert.equal(CMP.readinessBand(59), "overdue");

  const never = CMP.analyze([], NOW).emergency;
  assert.equal(CMP.statusBand(never), "muted", "no records is grey, not red");

  const overdue = CMP.analyze([entry({ name: "X", category: "EMERGENCY", daysAgo: 90 })], NOW).emergency;
  assert.equal(CMP.statusBand(overdue), "overdue");

  const current = CMP.analyze([entry({ name: "X", category: "EMERGENCY", daysAgo: 1 })], NOW).emergency;
  assert.equal(CMP.statusBand(current), "ready");
});

test("score chips show the tens digit, and a bang at 100", () => {
  assert.equal(CMP.scoreChipText(0), "0");
  assert.equal(CMP.scoreChipText(55), "5");
  assert.equal(CMP.scoreChipText(99), "9");
  assert.equal(CMP.scoreChipText(100), "!");
});

test("presentation helpers render the Kotlin's strings", () => {
  const r = CMP.analyze([entry({ name: "Engine Fire in Flight", category: "EMERGENCY", daysAgo: 3 })], NOW);
  assert.equal(CMP.displayLabel("EMERGENCY"), "Emergency");
  assert.equal(CMP.displayLabel("ABNORMAL"), "Abnormal");
  assert.equal(CMP.displayLabel("NORMAL"), "Normal");
  assert.equal(CMP.thresholdLabel(r.emergency), "14 days");
  assert.equal(CMP.lastDrillLabel(r.emergency.daysSinceLastDrill), "3d ago");
  assert.equal(CMP.lastDrillLabel(null), "Never");
  assert.equal(CMP.currentLabel(r.emergency), "1/1");
  assert.deepEqual(CMP.footerLines(r), [
    "Thresholds: Emergency 14 days / Abnormal 21 days / Normal 30 days",
    "Weights: Emergency 40% / Abnormal 35% / Normal 25%",
    "Drill count: 1 total entries"
  ]);
});

test("category cards link to the library filtered by that category", () => {
  assert.equal(CMP.drillHref("EMERGENCY"), "#/systems?category=EMERGENCY");
  assert.equal(CMP.drillHref("ABNORMAL"), "#/systems?category=ABNORMAL");
  assert.equal(CMP.drillHref("NORMAL"), "#/systems?category=NORMAL");
});

test("analyze tolerates a missing or malformed logbook", () => {
  for (const input of [undefined, null, []]) {
    const r = CMP.analyze(input, NOW);
    assert.equal(r.overallPercent, 0);
    assert.equal(r.totalDrillCount, 0);
  }
  const withJunk = CMP.analyze([null, undefined, entry({ name: "A", category: "NORMAL", daysAgo: 1 })], NOW);
  assert.equal(withJunk.normal.distinctProceduresDrilled, 1);
});

/* ------------------------------------------------- wiring and safety copy */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the Check Ride Readiness route opens the real screen, not a stub", () => {
  const appJs = fs.readFileSync(path.join(root, "app", "app.js"), "utf8");
  const registered = new Map(Array.from(appJs.matchAll(/route\("([^"]+)",\s*([A-Za-z0-9_]+)\)/g), (m) => [m[1], m[2]]));
  assert.equal(registered.get("/training/competency-dashboard"), "competencyDashboard");
  assert.doesNotMatch(appJs, /laterTraining\("readiness"\)/, "the COMING LATER stub must be gone");
  assert.match(appJs, /competencyDashboard/, "the screen must be imported");

  const core = fs.readFileSync(path.join(root, "app", "js", "core.js"), "utf8");
  assert.match(core, /id: "readiness"[^}]*status: "available"/, "the tile must no longer say COMING LATER");

  const screen = fs.readFileSync(path.join(root, "app", "js", "screens", "training.js"), "utf8");
  assert.doesNotMatch(screen, /once cloud sync lands/, "the old 'needs cloud sync' explanation is wrong and must not survive");
});

test("the readiness screen says its windows are not a regulatory currency requirement", () => {
  /* "Check Ride Ready" and "Overdue" read like a currency statement. The
     screen has to say plainly that they are not one. */
  const screen = fs.readFileSync(path.join(root, "app", "js", "screens", "training.js"), "utf8");
  assert.match(screen, /not a regulatory, operator or training-organisation recency requirement/);
  assert.match(screen, /not a record of your currency/);

  /* And the app-wide training-support-only disclaimer still frames every screen. */
  const shell = fs.readFileSync(path.join(root, "app", "index.html"), "utf8");
  assert.match(shell, /Training support only/);
  assert.match(shell, /AFM, QRH, MEL/);
});

test("no aviation figure is invented: thresholds and weights come from the Kotlin", () => {
  /* Everything numeric this screen shows is either counted from the user's own
     logbook or one of these six authored constants. */
  const logic = fs.readFileSync(path.join(root, "app", "js", "logic", "competency.js"), "utf8");
  assert.match(logic, /EMERGENCY: 14, ABNORMAL: 21, NORMAL: 30/);
  assert.match(logic, /EMERGENCY: 0\.40, ABNORMAL: 0\.35, NORMAL: 0\.25/);
  assert.match(logic, /CompetencyAnalyzer\.kt/, "the port must name its source");
});
