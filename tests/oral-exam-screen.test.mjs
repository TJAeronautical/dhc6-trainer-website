/*
  The Premium AI examiner.

  Most of these tests are really one test asked several ways: can this feature
  state a DHC-6 figure that nobody authored? A language model examining a pilot
  on the Twin Otter will produce torque limits and VREF speeds from whatever it
  absorbed, in the same confident voice as the authored ones, to somebody
  studying for a check ride. The grounding is what stops that, so the grounding
  is what gets the coverage.
*/

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_QUESTIONS, UNITS_PER_SESSION, EXAMINER_BRIEF, OPENING_TURN,
  systemsIn, systemLabel, pickUnits, unitBlock, groundingBlock, buildInstructions,
  toRequest, replyText, refusalFor, appendTurn, questionsAsked, atLimit
} from "../app/js/logic/oralexam.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function read(relative) { return fs.readFileSync(path.join(root, relative), "utf8"); }

function unit(overrides) {
  return Object.assign({
    id: "bundled_fuel_1",
    system: "FUEL",
    title: "What drives the standby fuel pump?",
    content: "The standby pump is electrically driven and is used for engine start and as a backup.",
    importance: "CORE",
    examRelevant: true,
    aircraftVariant: "BOTH",
    sourceTitle: "Fuel System deck",
    sectionRef: "AFM 2.4.1"
  }, overrides || {});
}

function pool(units) {
  return { id: "knowledge-pool", units: units };
}

/* A seeded generator so a shuffle is reproducible in a test. */
function seeded(seed) {
  let state = seed >>> 0;
  return function () {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/* ------------------------------------------------- the examiner is confined */

test("the examiner is told to examine only on the supplied material", () => {
  const brief = EXAMINER_BRIEF.toLowerCase();
  assert.ok(brief.includes("only on the study material"), "the confinement must be stated, not implied");
  assert.match(EXAMINER_BRIEF, /Never state a speed, weight, torque, temperature, time, quantity or limitation that does not appear in the study material/);
  assert.match(EXAMINER_BRIEF, /outside the bundled material/, "a question beyond the material has a defined answer");
  assert.match(EXAMINER_BRIEF, /approved answer/, "the authored content is what marking is against");
});

test("the approved answer and its source travel with every question", () => {
  const block = unitBlock(unit());
  assert.match(block, /^Topic: What drives the standby fuel pump\?$/m);
  assert.match(block, /^Answer: The standby pump is electrically driven/m);
  assert.match(block, /^Source: Fuel System deck — AFM 2\.4\.1$/m, "a correction must be able to cite rather than assert");
});

test("a unit with no source still works, without inventing one", () => {
  const block = unitBlock(unit({ sourceTitle: null, sectionRef: null }));
  assert.doesNotMatch(block, /Source:/);
  assert.match(block, /Topic:/);
});

test("the instructions carry the brief and the material, in that order", () => {
  const instructions = buildInstructions([unit()]);
  assert.ok(instructions.indexOf(EXAMINER_BRIEF) === 0, "the rules come before the material they govern");
  assert.ok(instructions.indexOf("STUDY MATERIAL") > 0);
  assert.ok(instructions.indexOf("standby fuel pump") > instructions.indexOf("STUDY MATERIAL"));
});

test("the answer key never appears in the visible transcript", () => {
  /*
    The whole exam is worthless if the candidate can scroll back and read the
    answers, and a grounding block pushed into `input` would do exactly that.
  */
  const units = [unit()];
  const request = toRequest(units, [{ role: "candidate", text: "I am ready" }]);
  const visible = JSON.stringify(request.input);
  assert.ok(!visible.includes("electrically driven"), "the approved answer leaked into the turns");
  assert.ok(request.instructions.includes("electrically driven"), "and it must still reach the examiner");
});

test("roles are mapped to the shape the endpoint forwards", () => {
  const request = toRequest([unit()], [
    { role: "candidate", text: "ready" },
    { role: "examiner", text: "Question one." },
    { role: "candidate", text: "my answer" }
  ]);
  assert.deepEqual(request.input.map((m) => m.role), ["user", "assistant", "user"]);
  assert.equal(request.input[1].content, "Question one.");
});

test("the opening turn is not empty, because an empty input is refused", () => {
  assert.ok(String(OPENING_TURN.text || "").trim().length > 0);
  const request = toRequest([unit()], [OPENING_TURN]);
  assert.equal(request.input.length, 1);
  assert.equal(request.input[0].role, "user");
});

/* --------------------------------------------------------- choosing material */

test("a unit with no question or no answer never reaches the examiner", () => {
  const picked = pickUnits(pool([
    unit({ id: "a", title: "  " }),
    unit({ id: "b", content: "" }),
    unit({ id: "c" })
  ]), { rng: seeded(1) });
  assert.deepEqual(picked.map((u) => u.id), ["c"]);
});

test("a unit marked not exam relevant is left out", () => {
  const picked = pickUnits(pool([unit({ id: "a", examRelevant: false }), unit({ id: "b" })]), { rng: seeded(1) });
  assert.deepEqual(picked.map((u) => u.id), ["b"]);
});

test("a Legacy airframe is never examined on G950 material", () => {
  const units = [
    unit({ id: "legacy", aircraftVariant: "LEGACY" }),
    unit({ id: "g950", aircraftVariant: "G950" }),
    unit({ id: "both", aircraftVariant: "BOTH" })
  ];
  const legacy = pickUnits(pool(units), { variant: "LEGACY", rng: seeded(3) }).map((u) => u.id).sort();
  assert.deepEqual(legacy, ["both", "legacy"]);
  const g950 = pickUnits(pool(units), { variant: "G950", rng: seeded(3) }).map((u) => u.id).sort();
  assert.deepEqual(g950, ["both", "g950"]);
  const both = pickUnits(pool(units), { variant: "BOTH", rng: seeded(3) }).map((u) => u.id).sort();
  assert.deepEqual(both, ["both", "g950", "legacy"], "BOTH is the whole pool, not the BOTH-tagged subset");
});

test("a chosen system narrows the material to that system", () => {
  const units = [unit({ id: "f", system: "FUEL" }), unit({ id: "e", system: "ELECTRICAL" })];
  assert.deepEqual(pickUnits(pool(units), { system: "FUEL", rng: seeded(2) }).map((u) => u.id), ["f"]);
});

test("a session is bounded and reproducible from its seed", () => {
  const many = [];
  for (let i = 0; i < 50; i++) many.push(unit({ id: "u" + i }));
  const first = pickUnits(pool(many), { rng: seeded(7) }).map((u) => u.id);
  const again = pickUnits(pool(many), { rng: seeded(7) }).map((u) => u.id);
  assert.equal(first.length, UNITS_PER_SESSION);
  assert.deepEqual(first, again, "the same seed must reproduce the session");
  const different = pickUnits(pool(many), { rng: seeded(8) }).map((u) => u.id);
  assert.notDeepEqual(first, different);
});

test("the topic list is read from the pack, never hardcoded", () => {
  const listed = systemsIn(pool([
    unit({ id: "1", system: "FUEL" }),
    unit({ id: "2", system: "FUEL" }),
    unit({ id: "3", system: "ELECTRICAL" }),
    unit({ id: "4", system: "HYDRAULICS", examRelevant: false })
  ]));
  assert.deepEqual(listed, [{ system: "FUEL", count: 2 }, { system: "ELECTRICAL", count: 1 }]);
  assert.equal(systemLabel("LANDING_GEAR_WHEELS"), "Landing Gear Wheels");
  assert.equal(systemLabel(""), "General");
});

test("an empty pool offers nothing rather than an empty exam", () => {
  assert.deepEqual(systemsIn(pool([])), []);
  assert.deepEqual(pickUnits(pool([]), { rng: seeded(1) }), []);
  assert.deepEqual(groundingBlock([]), "");
});

/* --------------------------------------------------------------- the reply */

test("the Responses output is read, and junk does not throw", () => {
  assert.equal(replyText({ output: [{ content: [{ text: "First question." }] }] }), "First question.");
  assert.equal(replyText({ output: [{ content: [{ text: "a" }, { text: "b" }] }] }), "ab");
  assert.equal(replyText({ output_text: "fallback" }), "fallback");
  [null, undefined, "", 7, {}, { output: null }, { output: [{}] }, { output: [{ content: [{}] }] }].forEach((body) => {
    assert.equal(replyText(body), "", "a shape change must read as nothing, not throw");
  });
});

/* ------------------------------------------------------------- refusals */

test("an outage never reads as 'you do not have this feature'", () => {
  /*
    The failure that costs a customer: a 503 from a missing binding rendered as
    an entitlement problem sends a paying subscriber to the billing page.
  */
  ["entitlement_check_unavailable", "openai_api_key_missing"].forEach((code) => {
    const refusal = refusalFor(503, code);
    assert.match(refusal.title, /unavailable/i);
    assert.ok(refusal.retry, "an outage is worth retrying");
    assert.ok(!/plan|premium|upgrade|subscri/i.test(refusal.title), code + ": the headline reads as a billing problem");
    assert.ok(!refusal.action, "and must not offer a route to the plan page");
  });
  /* The body may mention the subscription — but only to rule it out. That is
     the sentence that stops somebody going to the billing page over an outage,
     so it is asserted rather than merely permitted. */
  assert.match(refusalFor(503, "entitlement_check_unavailable").body, /not with your subscription/i);
  assert.match(refusalFor(503, "something_new").title, /unavailable/i, "an unknown 503 is still an outage");
});

test("a genuine entitlement refusal points at the plan, and does not invite a retry", () => {
  const refusal = refusalFor(403, "entitlement_required");
  assert.match(refusal.body, /Premium/);
  assert.ok(!refusal.retry, "retrying cannot grant an entitlement");
  assert.equal(refusal.action.href, "#/settings");
});

test("a lapsed session and a lapsed subscription are told apart", () => {
  const expired = refusalFor(401, "session_invalid");
  assert.match(expired.title, /sign in/i);
  assert.equal(expired.action.href, "/web-app.html");
  const inactive = refusalFor(403, "subscription_inactive");
  assert.match(inactive.title, /inactive/i);
  assert.equal(inactive.action.href, "/access.html");
  assert.notEqual(expired.title, inactive.title);
});

/* ------------------------------------------------------------ the session */

test("the cap counts questions asked, not turns taken", () => {
  let turns = [OPENING_TURN];
  assert.equal(questionsAsked(turns), 0, "the opening prompt is not a question");
  turns = appendTurn(turns, "examiner", "Q1");
  turns = appendTurn(turns, "candidate", "A1");
  assert.equal(questionsAsked(turns), 1, "and the candidate's answer is not one either");
  assert.equal(atLimit(turns), false);
  for (let i = 0; i < MAX_QUESTIONS; i++) turns = appendTurn(turns, "examiner", "Q");
  assert.equal(atLimit(turns), true);
});

test("appendTurn does not mutate the transcript it was given", () => {
  const before = [OPENING_TURN];
  const after = appendTurn(before, "examiner", "Q1");
  assert.equal(before.length, 1);
  assert.equal(after.length, 2);
});

test("each question is a paid call, so a session is bounded", () => {
  assert.ok(MAX_QUESTIONS >= 5 && MAX_QUESTIONS <= 30, "a cap nobody reaches is not a cap, and one nobody can use is not a feature");
});

/* --------------------------------------------------------------- the screen */

test("the oral exam route opens the real screen, not the Coming later stub", () => {
  const app = read("app/app.js");
  assert.match(app, /route\("\/training\/oral-exam", oralExam\)/);
  assert.doesNotMatch(app, /laterTraining\("oral-exam"\)/, "the stub must be gone");
  assert.match(app, /import \{ oralExam \} from "\.\/js\/screens\/oralexam\.js"/);
});

test("the registry no longer says the proxy it now has is missing", () => {
  const core = read("app/js/core.js");
  const row = core.slice(core.indexOf('id: "oral-exam"'));
  const line = row.slice(0, row.indexOf("\n"));
  assert.match(line, /status: "available"/);
  assert.match(line, /requires: "AI_TRAINER"/, "the gate is still declared");
  assert.doesNotMatch(line, /needs a web-session-gated proxy/, "phase 36 built it");
});

test("a Coming later explanation cannot outlive the feature it explains", () => {
  /*
    Twice now this map has held a sentence that stopped being true and had
    nothing to make it false again — the CRM drill "scheduled for the CRM
    phase", then the oral exam's three missing preconditions, all three of
    which phase 36 delivered. An entry for a feature that is no longer `later`
    is that failure, mechanically.
  */
  const training = read("app/js/screens/training.js");
  const block = training.slice(training.indexOf("const LATER_TRAINING_DETAIL"), training.indexOf("export function laterTraining"));
  const keys = block.match(/"([a-z0-9-]+)"\s*:/g) || [];
  const core = read("app/js/core.js");
  keys.map((k) => k.replace(/["\s:]/g, "")).forEach((id) => {
    const row = core.slice(core.indexOf('id: "' + id + '"'));
    const line = row.slice(0, row.indexOf("\n"));
    assert.match(line, /status: "later"/, id + " has an explanation for being unbuilt, and is not unbuilt");
  });
});

test("the transcript is never written to browser storage", () => {
  /*
    It would otherwise accumulate an answer key in localStorage that sign-out
    has to remember to clear. A practice conversation lives as long as the tab.
  */
  const src = read("app/js/screens/oralexam.js");
  /* Comments stripped: the header says in words that none of this is stored,
     and a test that reads the prose instead of the code would fail on the very
     sentence promising the behaviour. */
  const body = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(body, /localStorage|sessionStorage|indexedDB/i);
  assert.doesNotMatch(body, /Store\.(set|put|write)/, "and not through the app's own store either");
  assert.match(body, /cache: "no-store"/);
  assert.match(body, /credentials: "same-origin"/);
});

test("the screen keeps the training-support-only statement", () => {
  const src = read("app/js/screens/oralexam.js");
  assert.match(src, /does not replace the approved AFM, QRH, MEL/);
  assert.match(src, /not a check ride/i);
  /* And the examiner itself is told to say so if its assessment is mistaken
     for a qualification. */
  assert.match(EXAMINER_BRIEF, /do not replace the approved AFM, QRH, MEL/);
});

test("the entitlement gate is a courtesy, and unknown is not treated as absent", () => {
  const src = read("app/js/screens/oralexam.js");
  assert.match(src, /Entitlements\.known\(\) && !Entitlements\.has\("AI_TRAINER"\)/,
    "a subscriber must not see a lock flash while the first verify is in flight");
});

test("no aviation figure is authored in this feature", () => {
  /*
    The examiner's material comes from the pack. Nothing in the screen or the
    logic may carry a speed, weight, torque or temperature of its own - if a
    number appears here, somebody has started writing aviation data into the
    client.
  */
  [read("app/js/screens/oralexam.js"), read("app/js/logic/oralexam.js")].forEach((src) => {
    const body = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(body, /\b\d+\s*(kt|kts|knots|lb|lbs|kg|psi|°C|degC|ft\b|rpm|%\s*NG|%\s*NP)/i);
  });
});
