/*
  Unit tests for the browser ports of the Android domain logic
  (app/js/logic/*). Values below are computed by hand from the Kotlin
  sources; they are not aviation data.
*/
import test from "node:test";
import assert from "node:assert/strict";
import * as P from "../app/js/logic/procedures.js";
import { createDrill, drillResultToLogbookEntry, hashCode } from "../app/js/logic/drill.js";
import * as Q from "../app/js/logic/quiz.js";
import * as PERF from "../app/js/logic/performance.js";
import { FuelPlanCalculator, WeightBalanceCalculator, OCCUPANT_TYPES, nextOccupant } from "../app/js/logic/calculators.js";
import * as SRS from "../app/js/logic/srs.js";
import { computeInsights } from "../app/js/logic/insights.js";

/* ------------------------------------------------------------ procedures */
test("formatProcedureDisplayTitle matches ProcedureTitleFormatter", () => {
  assert.equal(P.formatProcedureDisplayTitle("engine_fire-in_flight [Airborne]"), "Engine Fire In Flight");
  assert.equal(P.formatProcedureDisplayTitle("high t5 temperature [ground]"), "High T5 Temperature");
  assert.equal(P.formatProcedureDisplayTitle("one engine inoperative landing [Ground/Airborne]"), "One Engine Inoperative Landing");
  assert.equal(P.formatProcedureDisplayTitle("qrh vref check"), "QRH VREF Check");
  assert.equal(P.formatProcedureDisplayTitle("   "), "Procedure");
});

test("crewRole / actionIntent / compiledProcedureId follow the Kotlin enums", () => {
  assert.equal(P.crewRole("pilot monitoring"), "PM");
  assert.equal(P.crewRole("Captain"), "PF");
  assert.equal(P.crewRole("crew"), "BOTH");
  assert.equal(P.crewRole("??"), "PF");
  assert.equal(P.actionIntent("call-out"), "ANNOUNCE");
  assert.equal(P.actionIntent("immediate action"), "MEMORY");
  assert.equal(P.actionIntent("perform"), "DO");
  assert.equal(P.actionIntent("nonsense"), "DO");
  assert.equal(P.toProcedureStep({ action: " X ", crewRole: "PM" }).intent, "ANNOUNCE", "missing intent defaults to ANNOUNCE like the Moshi model");
  assert.equal(P.compiledProcedureId("emergency", "  Engine   Fire  "), "EMERGENCY/Engine Fire");
  assert.equal(P.compiledProcedureId("NORMAL", ""), "NORMAL/UNTITLED PROCEDURE");
});

const packProcs = [
  { id: "emergency/a", category: "EMERGENCY", rawName: "Alpha", drillName: "Alpha [Airborne]", procedureName: "Alpha [Airborne]", displayTitle: "Alpha", compiledId: "EMERGENCY/Alpha [Airborne]", qrhRank: 2, variants: { LEGACY: { memory: [{ action: "L1", crewRole: "PF", requiresConfirmation: true }], flow: [{ action: "F1" }] }, G950: { memory: [{ action: "G1" }], flow: [] } } },
  { id: "emergency/b", category: "EMERGENCY", rawName: "Bravo", drillName: "", procedureName: "Bravo", displayTitle: "Bravo", compiledId: "EMERGENCY/Bravo", qrhRank: 0, variants: { BOTH: { memory: [], flow: [{ action: "B1" }] } } },
  { id: "emergency/c", category: "EMERGENCY", rawName: "Charlie", procedureName: "Charlie", displayTitle: "Charlie", compiledId: "EMERGENCY/Charlie", qrhRank: 9999, variants: { G950: { memory: [{ action: "C1" }], flow: [] } } },
  { id: "emergency/d", category: "EMERGENCY", rawName: "Delta", procedureName: "Delta", displayTitle: "Delta", compiledId: "EMERGENCY/Delta", qrhRank: 1, variants: { BOTH: { memory: [], flow: [] } } },
  { id: "normal/n", category: "NORMAL", rawName: "November", procedureName: "November", displayTitle: "November", compiledId: "NORMAL/November", qrhRank: 5, normalBucket: "SYSTEM_TESTS", variants: { BOTH: { memory: [], flow: [{ action: "N1", reference: "POH 4" }] } } }
];

test("materializeProcedures applies ProcedureAssetStore variant rules", () => {
  const legacy = P.materializeProcedures(packProcs, "LEGACY");
  assert.deepEqual(legacy.map((p) => p.id + ":" + p.aircraftVariant), ["emergency/a:LEGACY", "emergency/b:LEGACY", "emergency/d:LEGACY", "normal/n:LEGACY"], "G950-only Charlie is rejected; BOTH bodies are relabelled LEGACY");
  const g950 = P.materializeProcedures(packProcs, "G950");
  assert.equal(g950.find((p) => p.id === "emergency/a").memory[0].action, "G1");
  assert.ok(g950.some((p) => p.id === "emergency/c"));
  const both = P.materializeProcedures(packProcs, "BOTH");
  assert.equal(both.filter((p) => p.id === "emergency/a").length, 2, "BOTH lists LEGACY and G950 entries of a split procedure");
  assert.equal(both.find((p) => p.id === "emergency/b").aircraftVariant, "BOTH");
  assert.equal(both.find((p) => p.id === "emergency/a" && p.aircraftVariant === "LEGACY").memory[0].requiresConfirmation, true);
});

test("qrhListItems orders by ProcedureSortOrder rank, title, variant and hides empty procedures", () => {
  const items = P.qrhListItems(P.materializeProcedures(packProcs, "BOTH"), "EMERGENCY", "");
  assert.deepEqual(items.map((p) => p.displayTitle + "/" + p.aircraftVariant), ["Bravo/BOTH", "Alpha/G950", "Alpha/LEGACY", "Charlie/G950"], "Delta (no memory, no flow) is filtered out; unranked Charlie sorts last");
  assert.deepEqual(P.qrhListItems(P.materializeProcedures(packProcs, "BOTH"), "EMERGENCY", "alp").map((p) => p.displayTitle), ["Alpha", "Alpha"]);
});

test("toQrhDetail / cleanQrhLine / qrhLineToProcedureStep reproduce QrhProcedureMapper + QrhDetailScreen", () => {
  const proc = P.materializeProcedures(packProcs, "LEGACY").find((p) => p.id === "emergency/a");
  const detail = P.toQrhDetail(proc);
  assert.equal(detail.trigger, "Immediate action: L1");
  assert.deepEqual(detail.memoryItems, ["PF — L1 • ANNOUNCE • CONFIRM"]);
  assert.deepEqual(detail.steps, ["1. PF — F1 • ANNOUNCE"]);
  assert.equal(P.cleanQrhLine("12. PM - Fuel lever   OFF"), "Fuel lever OFF");
  const lines = P.qrhDrillSteps(detail);
  assert.deepEqual(lines.memoryItems, ["— L1 • ANNOUNCE • CONFIRM"], "cleanQrhLine strips only the leading role token, exactly like the Kotlin regex");
  assert.equal(lines.memorySteps[0].intent, "MEMORY");
  assert.equal(lines.memorySteps[0].requiresConfirmation, true);
  assert.equal(lines.flowSteps[0].intent, "ANNOUNCE", "flow lines containing 'announce' become callouts");
  const nov = P.materializeProcedures(packProcs, "BOTH").find((p) => p.id === "normal/n");
  const novDetail = P.toQrhDetail(nov);
  assert.equal(novDetail.trigger, "Use when applicable: N1");
  assert.deepEqual(novDetail.steps, ["1. PF — N1 • ANNOUNCE • POH 4"]);
  const bravo = P.qrhDrillSteps(P.toQrhDetail(P.materializeProcedures(packProcs, "BOTH").find((p) => p.id === "emergency/b")));
  assert.equal(bravo.memoryItems.length, 0);
  assert.equal(bravo.checklistItems.length, 1);
});

test("procedureTileImage and qrhCategoryTile follow the Kotlin keyword table", () => {
  assert.equal(P.procedureTileImage("Engine Fire", "EMERGENCY"), "procedure_tile_emergency_red");
  assert.equal(P.procedureTileImage("Anything", "ABNORMAL"), "procedure_tile_abnormal_caution");
  assert.equal(P.procedureTileImage("Propeller and Autofeather Test", "NORMAL"), "procedure_tile_propeller");
  assert.equal(P.procedureTileImage("Battery Power Start", "NORMAL"), "procedure_tile_electrical", "'battery' wins before 'start'");
  assert.equal(P.procedureTileImage("Take Off", "NORMAL"), "procedure_tile_takeoff_custom");
  assert.equal(P.procedureTileImage("Crosswind Take-Offs", "NORMAL"), "procedure_tile_weather_custom", "hyphenated 'take-offs' does not match 'take off' — Kotlin falls through to the crosswind/weather branch");
  assert.equal(P.procedureTileImage("Cruise", "NORMAL"), "procedure_tile_cruise_custom");
  assert.equal(P.procedureTileImage("Shutdown", "NORMAL"), "procedure_tile_shutdown");
  assert.equal(P.procedureTileImage("Something Else", "NORMAL"), "procedure_tile_qrh_custom");
  assert.equal(P.qrhCategoryTile("NORMAL"), "procedure_tile_qrh");
});

test("libraryVisible filters, sorts and sections like ProcedureLibraryScreen", () => {
  const all = P.materializeProcedures(packProcs, "BOTH");
  const r = P.libraryVisible(all, { categoryFilter: "ALL", priorityIds: ["EMERGENCY/Charlie"] });
  assert.equal(r.visible[0].compiledId, "EMERGENCY/Charlie", "pinned procedures sort first");
  assert.equal(r.visible[1].category, "NORMAL", "then category ordinal NORMAL < ABNORMAL < EMERGENCY");
  assert.deepEqual(r.sections, []);
  const normal = P.libraryVisible(all, { categoryFilter: "NORMAL" });
  assert.equal(normal.sections.length, 1);
  assert.equal(normal.sections[0].bucket, "SYSTEM_TESTS");
  assert.equal(P.libraryVisible(all, { categoryFilter: "NORMAL", bucket: "EVERYDAY_ACTIONS" }).visible.length, 0);
  assert.equal(P.libraryVisible(all, { query: "poh 4" }).visible.length, 1, "search covers step references");
  assert.equal(P.libraryVisible(all, { priorityOnly: true, priorityIds: [] }).visible.length, 0);
  assert.deepEqual(P.normalBucketCounts(all), { ALL: 1, SYSTEM_TESTS: 1, EVERYDAY_ACTIONS: 0, WEATHER_SPECIAL_CONDITIONS: 0 });
  assert.equal(P.readinessBadge(all.find((p) => p.id === "emergency/a")), "DRILL READY");
  assert.equal(P.readinessBadge(all.find((p) => p.id === "emergency/c")), "View Drill");
  assert.equal(P.readinessBadge(all.find((p) => p.id === "normal/n")), "CHECKLIST");
  assert.equal(P.sourceBasisFor({ category: "NORMAL" }), "POH / AFM Section 4");
});

/* ----------------------------------------------------------------- drill */
test("drill state machine scores like ProcedureDrillPane and maps to a logbook entry", () => {
  let now = 1000;
  const results = [];
  const d = createDrill({ procedureId: "EMERGENCY/X", procedureName: "X", category: "EMERGENCY", memorySteps: [{ action: "m1", crewRole: "PF" }, { action: "m2", crewRole: "PM" }], flowSteps: [{ action: "f1" }, { action: "f2" }, { action: "f3" }], now: () => now, onComplete: (r) => results.push(r) });
  assert.equal(d.state.phase, "MEMORY");
  d.reveal(); d.score(true);
  assert.equal(d.state.memoryIndex, 1);
  d.reveal(); d.score(false);
  assert.equal(d.state.phase, "FLOW");
  d.toggleFlow(0); d.toggleFlow(1); d.toggleFlow(1);
  now = 61000;
  d.finishFlow();
  assert.equal(d.state.phase, "SUMMARY");
  assert.equal(results.length, 1);
  assert.deepEqual({ ...results[0], elapsedMs: undefined, completedAtUtcMs: undefined }, { procedureId: "EMERGENCY/X", procedureName: "X", memoryTotal: 2, memoryCorrect: 1, memoryMissed: 1, flowTotal: 3, flowCompleted: 1, scorePercent: 40, elapsedMs: undefined, completedAtUtcMs: undefined });
  assert.equal(results[0].elapsedMs, 60000);
  const entry = drillResultToLogbookEntry(results[0], "EMERGENCY", "LEGACY");
  assert.equal(entry.scoreBand, "UNSATISFACTORY");
  assert.equal(entry.wrongCalloutCount, 3, "missed memory + remaining flow");
  assert.equal(entry.remarks, "Procedure drill completed. Memory 1/2, flow 1/3.");
  assert.equal(entry.attemptId, "procedure-drill-61000-" + hashCode("EMERGENCY/X"));
  d.restart();
  assert.equal(d.state.phase, "MEMORY");
  assert.equal(d.state.completionReported, false);
  const flowOnly = createDrill({ procedureId: "N", procedureName: "N", category: "NORMAL", memorySteps: [], flowSteps: [{ action: "a" }] });
  assert.equal(flowOnly.state.phase, "FLOW");
  flowOnly.toggleFlow(0); flowOnly.finishFlow();
  assert.equal(flowOnly.state.result.scorePercent, 100);
  assert.equal(hashCode("abc"), 96354, "java.lang.String.hashCode parity");
});

/* ------------------------------------------------------------------ quiz */
const pool = [
  { id: "u1", system: "FUEL", title: "Fuel tank capacity?", content: "Total usable fuel is 2576 lb across forward and aft tanks.", aircraftVariant: "BOTH", tags: ["STATUS:CANDIDATE", "BUNDLED", "FUEL"] },
  { id: "u2", system: "FUEL", title: "Fuel low light?", content: "FUEL LOW LEVEL illuminates at approximately 300 lb remaining in a tank.", aircraftVariant: "BOTH", tags: ["STATUS:CANDIDATE", "BUNDLED", "FUEL"] },
  { id: "u3", system: "FUEL", title: "Boost pumps?", content: "STATUS:CANDIDATE\n- Two boost pumps per tank; one is sufficient for engine operation.", aircraftVariant: "LEGACY", tags: ["STATUS:CANDIDATE", "FUEL"] },
  { id: "u4", system: "ELECTRICAL", title: "Bus voltage?", content: "Answer: The main DC bus voltage is nominally 28 volts DC.", aircraftVariant: "G950", tags: ["STATUS:CANDIDATE", "ELECTRICAL"] },
  { id: "u5", system: "ELECTRICAL", title: "Generator rating?", content: "Q: Each starter generator - rated 200 amps continuous at sea level.", aircraftVariant: "BOTH", tags: ["STATUS:CANDIDATE"] },
  { id: "u6", system: "FUEL", title: "Not a candidate", content: "excluded", aircraftVariant: "BOTH", tags: ["BUNDLED"] }
];

test("quiz snippets, pool and distractors follow QuizRunScreen", () => {
  assert.equal(Q.quizOptionSnippet(pool[2]), "Two boost pumps per tank; one is sufficient for engine operation.", "STATUS lines and bullets are stripped");
  assert.equal(Q.quizOptionSnippet(pool[3]), "The main DC bus voltage is nominally 28 volts DC.", "Answer: prefix removed");
  assert.equal(Q.quizOptionSnippet(pool[4]), "Each starter generator - rated 200 amps continuous at sea level.", "structured 'left - right' answer kept");
  assert.equal(Q.quizOptionSnippet({ title: "Only title", content: "" }), "Only title");
  assert.equal(Q.conciseQuizFact("STATUS:CANDIDATE"), "");
  const long = "A".repeat(80) + " " + "B".repeat(100);
  assert.ok(Q.conciseQuizFact(long).endsWith("…"));
  assert.equal(Q.loadCandidatePool(pool, "BOTH").length, 5, "BOTH = LEGACY + G950 + BOTH candidates");
  assert.equal(Q.loadCandidatePool(pool, "LEGACY").length, 1);
  assert.equal(Q.loadCandidatePool(pool, "BOTH", "ELECTRICAL").length, 2);
  assert.equal(Q.candidateCount(pool, "BOTH"), 5);
  assert.equal(Q.candidateCount(pool, "G950"), 1);
  const distractors = Q.chooseQuizDistractors(pool[0], Q.loadCandidatePool(pool, "BOTH"));
  assert.equal(distractors.length, 3);
  assert.equal(distractors[0].system, "FUEL", "same-system candidates are preferred");
  assert.ok(!distractors.some((d) => d.id === "u1"));
});

test("buildQuiz is deterministic with a seeded rng and keeps the correct option", () => {
  let seed = 7;
  const rng = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const quiz = Q.buildQuiz(Q.loadCandidatePool(pool, "BOTH"), 3, rng);
  assert.equal(quiz.length, 3);
  for (const q of quiz) {
    assert.equal(q.options[q.correctIndex].itemId, q.item.id);
    assert.equal(new Set(q.options.map((o) => o.itemId)).size, q.options.length);
    assert.ok(q.options.length >= 2 && q.options.length <= 4);
  }
  assert.equal(Q.buildQuiz([], 5).length, 0);
  assert.equal(Q.answerLabel(2), "C");
  assert.equal(Q.answerLabel(null), "No answer");
  assert.equal(Q.formatQuizDuration(65000), "1m 5s");
  const entry = Q.quizResultToLogbookEntry({ variantStr: "both", length: 2, systemNameOrNull: "FUEL_SYSTEM", startedAtEpochMs: 10, finishedAtEpochMs: 5010, questions: [{ prompt: "p1", correctOptionIndex: 0, chosenOptionIndex: 1, isCorrect: false, timeMs: 3000 }, { prompt: "p2", correctOptionIndex: 2, chosenOptionIndex: 2, isCorrect: true, timeMs: 2000 }] });
  assert.equal(entry.procedureName, "Knowledge Quiz: Fuel system");
  assert.equal(entry.scorePercent, 50);
  assert.equal(entry.scoreBand, "UNSATISFACTORY");
  assert.match(entry.remarks, /Review: p1 \(chosen B, correct A\)/);
  assert.equal(entry.attemptId, "quiz-10-5010-both-FUEL_SYSTEM-2");
  assert.deepEqual(entry.stepLatencies, [3000, 2000]);
});

/* ----------------------------------------------------------- performance */
const tables = PERF.parseTables({
  version: "t", source_takeoff: "st", source_landing: "sl", source_vref: "sv", notes: ["n1"],
  takeoff: { temps_c: [28, 30, 32], weights_lb: [9500, 12500], water_run_ft: [[1000, 1100, 1200], [2000, 2200, 2400]], dist_to_50ft: [[1500, 1600, 1700], [3000, 3200, 3400]] },
  landing: { temps_c: [28, 30, 32], weights_lb: [9500, 12500], water_run_ft: [[500, 550, 600], [900, 950, 1000]], dist_to_50ft: [[1400, 1450, 1500], [2000, 2050, 2100]] },
  vref: { weights_lb: [9500, 12300], rows: [{ flaps: "0", kias: [82, 94] }, { flaps: "37.5", kias: [60, 74] }] },
  reference_speeds: { v1_kias: 0, v1_note: "cfg", vyse_kias: 76, vyse_kcas: 78 }, performance_summary: { oei_rate_of_climb_fpm: 340 }
});

test("PerformanceCalculator bilinear / linear interpolation and clamping", () => {
  const t = PERF.PerformanceCalculator.takeoff(tables.takeoff, 11000, 29);
  assert.equal(t.waterRunFt, 1575, "midpoint weight (fraction .5) and temp 29 (fraction .5): lerp(lerp(1000,1100,.5)=1050, lerp(2000,2200,.5)=2100, .5)");
  assert.equal(t.distanceTo50Ft, 2325);
  assert.match(t.correctionSummary, /flaps 20/);
  assert.equal(PERF.PerformanceCalculator.landing(tables.landing, 9500, 28).waterRunFt, 500, "exact grid point");
  assert.equal(PERF.PerformanceCalculator.takeoff(tables.takeoff, 20000, 99).waterRunFt, 2400, "out-of-range inputs clamp to the table edge");
  assert.equal(PERF.PerformanceCalculator.vref(tables.vref, 12300, "0"), 94);
  assert.equal(PERF.PerformanceCalculator.vref(tables.vref, 9500, "37.5"), 60);
  assert.equal(Math.round(PERF.PerformanceCalculator.vref(tables.vref, 10900, "99") * 100) / 100, 88, "unknown flaps fall back to the first row (Kotlin firstOrNull); 10900 is the midpoint → 88");
  assert.equal(PERF.PerformanceCalculator.clampWeight(tables, 5000), 9500);
  assert.equal(PERF.PerformanceCalculator.clampTemperature(tables.takeoff, 40), 32);
  const s0 = PERF.initialPerformanceState(tables);
  assert.equal(s0.weightLb, 12500); assert.equal(s0.temperatureC, 30); assert.equal(s0.selectedFlaps, "37.5");
  assert.deepEqual(s0.availableFlaps, ["0", "37.5"]);
  assert.equal(s0.takeoffResult.waterRunFt, 2200);
  const s1 = PERF.setWeight(s0, tables, 0);
  assert.equal(s1.weightLb, 9500);
  assert.equal(PERF.setVrefFlaps(s1, tables, "0").vrefKias, 82);
  assert.equal(PERF.setTemperature(s1, tables, 100).temperatureC, 32);
});

/* ------------------------------------------------------------ calculators */
test("FuelPlanCalculator.plan reproduces the Kotlin arithmetic and warnings", () => {
  const r = FuelPlanCalculator.plan({ flightTimeMins: 60, alternateMins: 30, contingencyPct: 5, departFuelLb: 1000 });
  assert.equal(r.tripFuelLb, 600);
  assert.equal(r.alternateFuelLb, 300);
  assert.equal(r.contingencyLb, 30);
  assert.equal(r.reserveFuelLb, 450);
  assert.equal(r.totalRequiredLb, 600 + 300 + 30 + 450 + 50);
  assert.equal(r.totalBoardLb, 1000);
  assert.equal(r.marginLb, 1000 - 1430);
  assert.equal(r.isAdequate, false);
  assert.ok(r.warnings.includes("INSUFFICIENT FUEL: 430 lb short"));
  assert.ok(r.warnings.includes("Estimated landing fuel below 45-min reserve"));
  assert.equal(r.fwdTankLb, 500); assert.equal(r.aftTankLb, 500);
  const big = FuelPlanCalculator.plan({ flightTimeMins: 30, departFuelLb: 3000 });
  assert.equal(big.totalBoardLb, 2576);
  assert.ok(big.warnings.includes("Fuel entered exceeds max usable (2576 lb)"));
  assert.equal(big.fwdTankLb, 1235); assert.equal(big.aftTankLb, 1341);
  assert.ok(big.isAdequate);
  assert.equal(Math.round(FuelPlanCalculator.usgToLb(100)), 674);
  assert.equal(FuelPlanCalculator.lbToUsg(674), 100);
});

test("WeightBalanceCalculator.calculate / defaultLoadItems reproduce the Kotlin limits", () => {
  const items = WeightBalanceCalculator.defaultLoadItems({ basicWeightLb: 8450, crewLb: 380, paxRow2Lb: 300, fuelLb: 500 });
  assert.deepEqual(items.map((i) => i.label), ["Basic Weight (incl. oil + trapped fuel)", "Flight Crew", "Pax Row 2", "Fuel (FWD+AFT)"]);
  const r = WeightBalanceCalculator.calculate(items);
  assert.equal(r.totalWeightLb, 9630);
  assert.equal(r.totalMomentLbIn, 8450 * 209 + 380 * 100 + 300 * 195 + 500 * 210);
  assert.equal(Math.round(r.cgArmIn * 100) / 100, Math.round((r.totalMomentLbIn / 9630) * 100) / 100);
  assert.equal(r.isWithinWeightLimits, true);
  assert.equal(r.isWithinCgLimits, r.cgArmIn >= 207.74 && r.cgArmIn <= 213.2);
  const heavy = WeightBalanceCalculator.calculate([{ label: "x", weightLb: 13000, armIn: 220 }]);
  assert.ok(heavy.warnings.includes("EXCEEDS MTOW by 500 lb"));
  assert.ok(heavy.warnings.includes("CG AFT of limit (213.2 in / 32% MAC)"));
  assert.ok(heavy.notes.includes("Exceeds MLW — fuel burn required before landing"));
  const fwd = WeightBalanceCalculator.calculate([{ label: "x", weightLb: 9000, armIn: 200 }]);
  assert.ok(fwd.warnings.includes("CG FORWARD of limit (207.74 in / 25% MAC)"));
  assert.equal(Math.round(fwd.cgMacPct * 10) / 10, Math.round(((200 - 188.24) / 78) * 1000) / 10);
  assert.deepEqual(OCCUPANT_TYPES.map((o) => o.code), ["—", "M", "F", "C", "FI"]);
  assert.equal(OCCUPANT_TYPES[4].paxCount, 2);
  assert.equal(nextOccupant(4), 0);
});

/* -------------------------------------------------------------------- SRS */
test("SpacedRepetitionEngine.review follows SM-2 and the session builder caps due/new cards", () => {
  const fresh = SRS.newRecord("c1");
  const good = SRS.review(fresh, 4, 100);
  assert.equal(good.repetitions, 1); assert.equal(good.intervalDays, 1); assert.equal(good.nextReviewEpochDay, 101);
  assert.equal(Math.round(good.easeFactor * 100) / 100, 2.5);
  const second = SRS.review(good, 5, 101);
  assert.equal(second.intervalDays, 6); assert.equal(second.nextReviewEpochDay, 107);
  assert.equal(Math.round(second.easeFactor * 100) / 100, 2.6);
  const third = SRS.review(second, 3, 107);
  assert.equal(third.intervalDays, Math.round(6 * (2.6 - 0.14)));
  const again = SRS.review(third, 1, 120);
  assert.equal(again.repetitions, 0); assert.equal(again.intervalDays, 1); assert.equal(again.nextReviewEpochDay, 121);
  assert.equal(SRS.review({ ...fresh, easeFactor: 1.3 }, 0, 1).easeFactor, 1.3, "ease never drops below 1.3");
  const units = Array.from({ length: 30 }, (_, i) => ({ id: "u" + i, aircraftVariant: i % 3 === 0 ? "LEGACY" : "BOTH", tags: ["STATUS:CANDIDATE"] }));
  units.push({ id: "nc", aircraftVariant: "BOTH", tags: [] });
  const records = { u1: { flashcardId: "u1", nextReviewEpochDay: 50 }, u2: { flashcardId: "u2", nextReviewEpochDay: 40 }, u4: { flashcardId: "u4", nextReviewEpochDay: 999 } };
  const session = SRS.buildSession(units, records, "BOTH", 100);
  assert.deepEqual(session.slice(0, 2).map((c) => c.unit.id), ["u2", "u1"], "most overdue first");
  assert.equal(session.length, 2 + SRS.MAX_NEW_CARDS_PER_SESSION);
  assert.ok(!session.some((c) => c.unit.id === "u4" || c.unit.id === "nc"));
  assert.equal(SRS.nextDueDays(records, 100), 899);
  assert.equal(SRS.dueCount(units, records, "BOTH", 100), 2);
  assert.equal(SRS.buildSession(units, {}, "G950", 1).every((c) => c.unit.aircraftVariant === "BOTH"), true, "a specific variant sees its own and shared BOTH rows");
});

/* --------------------------------------------------------------- insights */
test("computeInsights mirrors DashboardViewModel severity/trend rules", () => {
  const e = (name, ts, score, errors) => ({ procedureName: name, timestampUtc: ts, scorePercent: score, wrongCalloutCount: errors, wrongRoleCount: 0, rushedCount: 0, toleranceUsedCount: 0 });
  const insights = computeInsights([e("A", 1, 60, 5), e("A", 2, 90, 0), e("B", 1, 95, 0), e("C", 1, 80, 1), e("C", 2, 70, 1)]);
  assert.deepEqual(insights.map((i) => i.procedureName), ["A", "C", "B"]);
  assert.deepEqual(insights[0], { procedureName: "A", statusLabel: "Needs review", trendLabel: "Improving", severity: "MEDIUM" }, "latest 90 but avg errors 2.5 ≥ 2 → MEDIUM; 60 → 90 improving");
  assert.deepEqual(insights[1], { procedureName: "C", statusLabel: "Needs review", trendLabel: "Declining", severity: "MEDIUM" });
  assert.deepEqual(insights[2], { procedureName: "B", statusLabel: "Strong", trendLabel: "New", severity: "LOW" });
  assert.deepEqual(computeInsights([]), []);
  const high = computeInsights([e("D", 1, 50, 0)]);
  assert.equal(high[0].severity, "HIGH");
});
