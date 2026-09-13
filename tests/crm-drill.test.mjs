/*
  CRM / MCC Callout Drill — app/js/logic/crm.js against CrmDrillScreen.kt.

  The placeholder this replaces described a feature the Kotlin does not have
  ("challenge-response flow with role timing"). These tests pin what it
  actually does, so the next person does not re-import that description.
*/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as CRM from "../app/js/logic/crm.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function step(crewRole, action, extra) {
  return Object.assign({ crewRole: crewRole, action: action, intent: "ANNOUNCE", requiresConfirmation: false }, extra || {});
}

/* Four procedures, one of which has no PF/PM content at all. */
function procedures() {
  return [
    { slug: "before_take_off", flow: [step("PF", "FLAPS 10"), step("PM", "FLAPS 10 SET")] },
    { slug: "engine_fire_in_flight", flow: [
      step("PF", "CONFIRM L/R ENGINE FIRE"),
      step("PM", "CONFIRMED L/R ENGINE FIRE — T5 [check]"),
      step("PF", "SET MAX POWER L/R ENGINE")
    ] },
    { slug: "engine_failure_prior_to_rotation", flow: [step("PM", "ENGINE FAILURE"), step("PF", "STOP")] },
    { slug: "one_engine_inoperative_landing", flow: [step("PF", "GEAR DOWN"), step("PM", "GEAR DOWN THREE GREEN")] }
  ];
}

test("the four source procedures are the Kotlin's, by asset slug", () => {
  assert.deepEqual(CRM.CRM_SOURCE_SPECS.map((s) => s.slug), [
    "before_take_off",
    "engine_fire_in_flight",
    "engine_failure_prior_to_rotation",
    "one_engine_inoperative_landing"
  ]);
  assert.deepEqual(CRM.CRM_SOURCE_SPECS.map((s) => s.category), ["NORMAL", "EMERGENCY", "EMERGENCY", "EMERGENCY"]);
  /* Android labels this one by its own spec title, not the published procedure
     title ("Rejected Take-Off [Ground]"). Kept so both apps read the same. */
  assert.equal(CRM.CRM_SOURCE_SPECS[2].title, "Engine Failure Prior to Rotation");
});

test("each source yields two drills, one per seat, and nothing else", () => {
  const drills = CRM.buildCrmDrills(procedures(), "LEGACY");
  assert.equal(drills.length, 8, "four procedures x PF/PM");
  assert.deepEqual(drills.map((d) => d.traineeRole), ["PF", "PM", "PF", "PM", "PF", "PM", "PF", "PM"]);
  assert.equal(drills[0].title, "Before Take-off — PF");
  assert.equal(drills[1].id, "before_takeoff_legacy_pm");
  assert.equal(drills[2].title, "Engine Fire in Flight — PF");
});

test("both seats see the same callouts; only which one is yours changes", () => {
  const drills = CRM.buildCrmDrills(procedures(), "LEGACY");
  const asPf = drills.find((d) => d.id === "engine_fire_legacy_pf");
  const asPm = drills.find((d) => d.id === "engine_fire_legacy_pm");

  assert.deepEqual(asPf.steps.map((s) => s.callout), asPm.steps.map((s) => s.callout));
  assert.deepEqual(asPf.steps.map((s) => s.isTrainee), [true, false, true]);
  assert.deepEqual(asPm.steps.map((s) => s.isTrainee), [false, true, false]);
  /* isTts is always the inverse of isTrainee: the app speaks the other seat. */
  for (const drill of [asPf, asPm]) {
    for (const s of drill.steps) assert.equal(s.isTts, !s.isTrainee, drill.id);
  }
});

test("callout text is the authored action, verbatim", () => {
  const drills = CRM.buildCrmDrills(procedures(), "LEGACY");
  const fire = drills.find((d) => d.id === "engine_fire_legacy_pf");
  assert.equal(fire.steps[1].callout, "CONFIRMED L/R ENGINE FIRE — T5 [check]",
    "authored aviation wording must not be cleaned, shortened or re-cased");
});

test("steps that are not PF or PM, or have no action, are skipped", () => {
  const flow = [
    step("PF", "FLAPS 10"),
    step("CREW", "everyone look outside"),
    step("PM", "   "),
    step("", "orphan"),
    step("pm", "FLAPS 10 SET")       // lower case crew role still counts
  ];
  assert.deepEqual(CRM.calloutsFrom(flow), [
    { crew: "PF", callout: "FLAPS 10" },
    { crew: "PM", callout: "FLAPS 10 SET" }
  ]);
  assert.deepEqual(CRM.calloutsFrom(null), []);
});

test("a source procedure that is missing produces no drill and is reported", () => {
  const partial = procedures().filter((p) => p.slug !== "one_engine_inoperative_landing");
  const drills = CRM.buildCrmDrills(partial, "LEGACY");
  assert.equal(drills.length, 6, "the missing source contributes nothing");
  assert.ok(!drills.some((d) => d.id.startsWith("oei_landing")));
  assert.deepEqual(CRM.missingSources(partial), ["One Engine Inoperative Landing"],
    "the gap must be named, never filled with substituted content");
});

test("a source with no PF/PM callouts is dropped rather than shown empty", () => {
  const empty = procedures().map((p) => (p.slug === "before_take_off" ? { slug: p.slug, flow: [step("CREW", "chat")] } : p));
  const drills = CRM.buildCrmDrills(empty, "LEGACY");
  assert.equal(drills.length, 6);
  assert.ok(!drills.some((d) => d.id.startsWith("before_takeoff")));
});

test("the variant falls back the way AppSettings.resolveVariantForContent does", () => {
  assert.equal(CRM.resolveVariantForContent("LEGACY"), "LEGACY");
  assert.equal(CRM.resolveVariantForContent("G950"), "G950");
  assert.equal(CRM.resolveVariantForContent("BOTH"), "LEGACY", "BOTH resolves to LEGACY, as on Android");
  assert.equal(CRM.resolveVariantForContent(null), "LEGACY");
  assert.equal(CRM.resolveVariantForContent("nonsense"), "LEGACY");
  assert.equal(CRM.buildCrmDrills(procedures(), "G950")[0].id, "before_takeoff_g950_pf");
});

test("the state machine walks every step once and finishes on the last", () => {
  const drill = CRM.buildCrmDrills(procedures(), "LEGACY").find((d) => d.id === "engine_fire_legacy_pf");
  let s = CRM.selectState();
  assert.equal(s.mode, "select");

  s = CRM.startDrill(drill);
  assert.equal(s.mode, "running");
  assert.equal(s.currentStep, 0);
  assert.deepEqual(s.completedSteps, []);
  assert.equal(s.isComplete, false);

  s = CRM.confirmStep(s);
  assert.equal(s.currentStep, 1);
  assert.deepEqual(s.completedSteps, [0]);

  s = CRM.confirmStep(s);
  assert.equal(s.currentStep, 2);

  s = CRM.confirmStep(s);
  assert.equal(s.isComplete, true);
  assert.deepEqual(s.completedSteps, [0, 1, 2], "every step is marked done, including the last");
  assert.equal(s.currentStep, 2, "the last step stays current when the drill completes");

  // Confirming past the end is a no-op rather than an error.
  assert.equal(CRM.confirmStep(s), s);
  assert.equal(CRM.reset().mode, "select");
});

test("only the other seat's callouts are spoken, prefixed by the role", () => {
  const drill = CRM.buildCrmDrills(procedures(), "LEGACY").find((d) => d.id === "engine_fire_legacy_pf");
  assert.equal(CRM.speechFor(drill.steps[0]), null, "your own callout is never read to you");
  assert.equal(CRM.speechFor(drill.steps[1]), "PM. CONFIRMED L/R ENGINE FIRE — T5 [check]");
  assert.equal(CRM.speechFor(null), null);
  assert.equal(CRM.COMPLETE_SPEECH, "Drill complete. Well done.");
});

test("progress counts from one but the bar fills from zero", () => {
  const drill = CRM.buildCrmDrills(procedures(), "LEGACY").find((d) => d.id === "engine_fire_legacy_pf");
  let s = CRM.startDrill(drill);
  assert.equal(CRM.progressLabel(s), "1/3");
  assert.equal(CRM.progressFraction(s), 0, "LinearProgressIndicator uses currentStep/size");
  s = CRM.confirmStep(s);
  assert.equal(CRM.progressLabel(s), "2/3");
  assert.ok(Math.abs(CRM.progressFraction(s) - 1 / 3) < 1e-9);
  s = CRM.confirmStep(s);
  s = CRM.confirmStep(s);
  assert.equal(CRM.progressFraction(s), 1);
});

test("row tone and prompts follow whose callout is current", () => {
  const drill = CRM.buildCrmDrills(procedures(), "LEGACY").find((d) => d.id === "engine_fire_legacy_pf");
  let s = CRM.startDrill(drill);
  assert.equal(CRM.stepTone(s, 0), "current-you");
  assert.equal(CRM.stepTone(s, 1), "idle");
  assert.equal(CRM.promptFor(s), "Say the callout above, then tap Confirm");
  assert.equal(CRM.confirmLabel(s), "Confirm Callout");

  s = CRM.confirmStep(s);
  assert.equal(CRM.stepTone(s, 0), "done");
  assert.equal(CRM.stepTone(s, 1), "current", "the other seat's line is current but not yours");
  assert.equal(CRM.promptFor(s), "Listen to TTS callout, then tap Continue");
  assert.equal(CRM.confirmLabel(s), "Continue");

  s = CRM.confirmStep(s);
  s = CRM.confirmStep(s);
  assert.equal(CRM.stepTone(s, 2), "done", "nothing stays current once the drill is complete");
});

test("category colours and badges match the Kotlin", () => {
  assert.equal(CRM.categoryBand("EMERGENCY"), "overdue");
  assert.equal(CRM.categoryBand("ABNORMAL"), "caution");
  assert.equal(CRM.categoryBand("NORMAL"), "ready");
  assert.equal(CRM.categoryBadge("EMERGENCY"), "EMER");
  assert.equal(CRM.categoryBadge("NORMAL"), "NORM");
  assert.equal(CRM.categoryBadge("ABNORMAL"), "ABNO");
  const drill = CRM.buildCrmDrills(procedures(), "LEGACY")[0];
  assert.equal(CRM.drillSubtitle(drill), "Your role: PF  ·  2 callouts");
});

/* ------------------------------------------------------- wiring and safety */

test("the CRM route opens the real screen and the tile drops COMING LATER", () => {
  const appJs = fs.readFileSync(path.join(root, "app", "app.js"), "utf8");
  const registered = new Map(Array.from(appJs.matchAll(/route\("([^"]+)",\s*([A-Za-z0-9_]+)\)/g), (m) => [m[1], m[2]]));
  assert.equal(registered.get("/training/crm-drill"), "crmDrill");
  assert.doesNotMatch(appJs, /laterTraining\("crm"\)/);

  const core = fs.readFileSync(path.join(root, "app", "js", "core.js"), "utf8");
  assert.match(core, /id: "crm"[^}]*status: "available"/);
  assert.doesNotMatch(core, /id: "crm"[^}]*role timing/i,
    "the placeholder claimed timing the Kotlin does not implement");
});

test("the drill never invents aviation wording and degrades without speech", () => {
  const logic = fs.readFileSync(path.join(root, "app", "js", "logic", "crm.js"), "utf8");
  /* Check the CODE, not the comments — the module's own comment names
     cleanQrhLine() precisely to record that it is deliberately not used. */
  const code = logic.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.doesNotMatch(code, /cleanQrhLine\s*\(/, "callout text must be used verbatim");
  assert.doesNotMatch(code, /callout\s*[.=]\s*[\w.]*\.(toUpperCase|toLowerCase|replace|slice)\s*\(/,
    "nothing may rewrite a callout's authored wording");
  assert.match(logic, /CrmDrillScreen\.kt/, "the port must name its source");

  const screen = fs.readFileSync(path.join(root, "app", "js", "screens", "crmdrill.js"), "utf8");
  assert.match(screen, /speechSynthesis/);
  assert.match(screen, /Speech\.supported\(\)/, "speech must be feature-detected, not assumed");
  assert.match(screen, /has no speech synthesis/, "a browser without speech must say so, not fail silently");
  assert.doesNotMatch(screen, /api\/ai|fetch\(/, "speech is local to the browser; no server call");

  /* The app-wide training-support-only disclaimer frames this screen too. */
  const shell = fs.readFileSync(path.join(root, "app", "index.html"), "utf8");
  assert.match(shell, /Training support only/);
});
