/*
  App Tutorial — the quick guide Android replays from Settings › Help.

  The failure this file is mostly about: a tutorial drifts. It is written once,
  the app moves, and it ends up teaching a screen that has been renamed, gated
  or never built. So every step is checked against the router and the feature
  registry rather than against itself.
*/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { STEPS, visibleSteps, TUTORIAL_VERSION } from "../app/js/screens/tutorial.js";
import { FEATURES, feature } from "../app/js/core.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

/* Every path the router registers, read from app.js rather than hand-listed. */
function registeredRoutes() {
  const app = read("app/app.js");
  const out = [];
  const pattern = /route\("([^"]+)"/g;
  let match;
  while ((match = pattern.exec(app))) out.push(match[1]);
  return out;
}

function routeMatches(routes, href) {
  const path = String(href || "").replace(/^#/, "");
  return routes.some(function (registered) {
    if (registered === path) return true;
    /* ":id" style segments */
    const re = new RegExp("^" + registered.replace(/:[^/]+/g, "[^/]+") + "$");
    return re.test(path);
  });
}

/* ------------------------------------------------------ the steps themselves */

test("the tour covers the five areas Android names", () => {
  /* "Replay the quick guide for procedures, QRH, drill, cockpit and settings." */
  const ids = STEPS.map(function (s) { return s.id; });
  ["procedures", "qrh", "drill", "cockpit", "settings"].forEach(function (id) {
    assert.ok(ids.indexOf(id) >= 0, "the tour must cover " + id);
  });
  assert.equal(ids[0], "welcome");
  assert.equal(ids[ids.length - 1], "finish");
});

test("every step that offers a door has one that opens", () => {
  /* The drift this catches: a renamed route leaves a button that navigates
     nowhere, and nothing else in the app would notice. */
  const routes = registeredRoutes();
  assert.ok(routes.length > 10, "the route list should have been read, not empty");
  STEPS.filter(function (s) { return s.route; }).forEach(function (step) {
    assert.ok(routeMatches(routes, step.route),
      "step " + step.id + " points at " + step.route + ", which the router does not have");
    assert.ok(step.action && step.action.length > 2, "a door needs a label saying where it goes");
  });
});

test("every step names a feature the registry actually has", () => {
  STEPS.filter(function (s) { return s.feature; }).forEach(function (step) {
    const f = feature(step.feature);
    assert.ok(f, "step " + step.id + " describes unknown feature " + step.feature);
    assert.ok(["available", "partial"].indexOf(f.status) >= 0,
      "the tour must not teach " + step.feature + ", which is " + f.status);
  });
});

test("a feature that stops being available drops out of the tour", () => {
  /* Rather than sending somebody at a door that will not open. */
  const all = visibleSteps(function () { return "available"; }).map(function (s) { return s.id; });
  assert.deepEqual(all, STEPS.map(function (s) { return s.id; }));

  const without = visibleSteps(function (id) { return id === "qrh" ? "later" : "available"; })
    .map(function (s) { return s.id; });
  assert.equal(without.indexOf("qrh"), -1);
  assert.ok(without.indexOf("welcome") >= 0, "steps that describe no feature always stay");
  assert.ok(without.indexOf("finish") >= 0);
});

test("a partial feature is still worth teaching", () => {
  const steps = visibleSteps(function () { return "partial"; });
  assert.equal(steps.length, STEPS.length);
});

test("no step states an aviation fact", () => {
  /*
    The tutorial describes the app. A speed, a weight, a temperature or a
    limitation appearing here would be aviation data with no approved source
    behind it, and nobody would think to check a tutorial for it.
  */
  const NUMBERS = /\b\d+\s*(kt|kts|knots|ft|feet|lb|lbs|kg|nm|°|deg|degrees|psi|rpm|%)\b/i;
  STEPS.forEach(function (step) {
    const prose = [step.title, step.body, step.hint].filter(Boolean).join(" ");
    assert.doesNotMatch(prose, NUMBERS, "step " + step.id + " states a figure");
  });
});

test("the tour ends on the training-support-only statement", () => {
  const last = STEPS[STEPS.length - 1];
  const prose = [last.body, last.hint].filter(Boolean).join(" ");
  assert.match(prose, /does not replace the approved AFM, QRH, MEL/);
});

test("each step says something, and says it once", () => {
  const bodies = STEPS.map(function (s) { return s.body; });
  bodies.forEach(function (body, i) {
    assert.ok(body && body.length > 40, "step " + STEPS[i].id + " needs a real explanation");
  });
  assert.equal(new Set(bodies).size, bodies.length, "no step repeats another");
  assert.equal(new Set(STEPS.map(function (s) { return s.id; })).size, STEPS.length);
});

/* ------------------------------------------------------------ what ships */

test("the tutorial is a real screen, routed, and no longer says Coming later", () => {
  const app = read("app/app.js");
  assert.match(app, /route\("\/tutorial", tutorial\)/);

  const misc = read("app/js/screens/misc.js");
  assert.match(misc, /navCard\("App Tutorial",[^)]*href: "#\/tutorial"/);
  assert.doesNotMatch(misc, /navCard\("App Tutorial",[^)]*statusPill\("later"\)/,
    "the Coming Later pill must go with the placeholder");

  const core = read("app/js/core.js");
  assert.match(core, /id: "tutorial"[^}]*status: "available"/);
  assert.ok(FEATURES.some(function (f) { return f.id === "tutorial"; }), "the registry must know about it");
});

test("it is offered once on first run, and is dismissible", () => {
  /* A forced modal is the thing people close without reading, which is also
     how they never find the tour again. */
  const tutorial = read("app/js/screens/tutorial.js");
  assert.match(tutorial, /export function firstRunCard/);
  assert.match(tutorial, /if \(tutorialSeen\(\)\) return null;/);
  assert.match(tutorial, /"Not now"/, "there must be a way out that is not taking the tour");
  assert.doesNotMatch(tutorial, /showModal|window\.alert|window\.confirm/,
    "the first run must not block the app");

  const dashboard = read("app/js/screens/dashboard.js");
  assert.match(dashboard, /firstRunCard\(ctx\)/, "and it has to actually be rendered");
});

test("dismissing it and finishing it both count as seen", () => {
  const tutorial = read("app/js/screens/tutorial.js");
  /* Otherwise the card comes back every launch for anyone who took the tour,
     which reads as the app forgetting them. */
  assert.match(tutorial, /function finish\(\) \{\s*\n\s*markTutorialSeen\(\);/);
  assert.match(tutorial, /outlinedButton\("Not now", function \(\) \{ markTutorialSeen\(\)/);
  assert.ok(Number.isInteger(TUTORIAL_VERSION) && TUTORIAL_VERSION >= 1);
});

test("stepping through it is keyboard and screen-reader navigable", () => {
  const tutorial = read("app/js/screens/tutorial.js");
  assert.match(tutorial, /role: "tablist"/);
  assert.match(tutorial, /role: "tab"/);
  assert.match(tutorial, /"aria-selected"/);
  assert.match(tutorial, /"aria-label": "Step "/, "a bare dot tells a screen reader nothing");
  assert.match(tutorial, /data-tutorial-heading/,
    "focus must move to the new step, not stay on a button that has been replaced");
});

test("opening a step from the tour does not make it come back later", () => {
  /* Following a link out is engaging with the tour, so it counts as seen -
     otherwise the first-run card reappears on the dashboard they just
     navigated to. */
  const tutorial = read("app/js/screens/tutorial.js");
  const button = tutorial.slice(tutorial.indexOf("step.action || \"Open\""));
  assert.match(button.slice(0, 200), /markTutorialSeen\(\)/);
});
