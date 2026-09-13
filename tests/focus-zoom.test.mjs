/*
  Focus Snapshot zoom — app/js/cockpit.js focusScaleFor and the screen's controls.

  Trevor: "when reviewing snapshot the zoom in and out was not working."
  Two independent faults, both of which made a button do nothing at all:

    1. `Zoom -` was `zoom = Math.max(1, zoom - 0.35)` with zoom starting at 1, so
       the first press could never change anything, on any target, ever.
    2. focusRegion clamped `base * multiplier` together at 10. `base` is
       0.72 / the smaller side of the region, so any region tight enough to frame
       at 10 or more — a lever slot, a single switch, which is most focus targets
       — saturated at zoom 1 and swallowed every Zoom + press after it.

  These tests sweep region sizes rather than asserting one magic number, because
  the failure only showed up for small regions.
*/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { focusScaleFor, FOCUS_SCALE_LIMITS } from "../app/js/cockpit.js";
import { ZOOM_STEP, ZOOM_MIN, ZOOM_MAX } from "../app/js/screens/aircraftstate.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/* Strip comments before scanning. Both files explain the old bug in a comment
   that quotes the very expression these tests ban, and a naive scan reads the
   explanation as the defect. */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const screenSrc = stripComments(fs.readFileSync(path.join(root, "app/js/screens/aircraftstate.js"), "utf8"));

const region = (w, h) => ({ left: 0.1, top: 0.1, width: w, height: h });
/* Region sizes from a single switch up to most of the plate. The old code broke
   below roughly 0.09 on the smaller side. */
const SIZES = [0.02, 0.03, 0.05, 0.07, 0.09, 0.12, 0.2, 0.35, 0.5, 0.8];

test("zooming in increases the scale for every region size", () => {
  SIZES.forEach((size) => {
    const r = region(size, size * 2);
    const at1 = focusScaleFor(r, 1);
    const at140 = focusScaleFor(r, ZOOM_STEP);
    assert.ok(at140 > at1,
      `region ${size}: Zoom + did nothing (${at1} -> ${at140}). This is the original bug.`);
  });
});

test("zooming out decreases the scale for every region size", () => {
  SIZES.forEach((size) => {
    const r = region(size, size * 2);
    const at1 = focusScaleFor(r, 1);
    const out = focusScaleFor(r, 1 / ZOOM_STEP);
    assert.ok(out < at1, `region ${size}: Zoom - did nothing (${at1} -> ${out})`);
  });
});

test("a tight lever-sized region no longer saturates at zoom 1", () => {
  // The condition-lever slot on the frozen snapshot Trevor was looking at is a
  // tall narrow box. Framed at the old cap it had nowhere left to go.
  const lever = region(0.035, 0.26);
  const framed = focusScaleFor(lever, 1);
  assert.ok(framed < FOCUS_SCALE_LIMITS.max,
    "a tight region must frame below the absolute maximum, or Zoom + has no headroom");
  assert.ok(framed <= FOCUS_SCALE_LIMITS.baseMax + 1e-9);
  assert.ok(focusScaleFor(lever, ZOOM_STEP) > framed);
  assert.ok(focusScaleFor(lever, 1 / ZOOM_STEP) < framed);
});

test("the whole usable zoom range moves monotonically, with no dead steps", () => {
  const r = region(0.04, 0.22);
  let z = ZOOM_MIN;
  const steps = [];
  while (z <= ZOOM_MAX + 1e-9) { steps.push(focusScaleFor(r, z)); z *= ZOOM_STEP; }
  assert.ok(steps.length >= 5);
  for (let i = 1; i < steps.length; i += 1) {
    assert.ok(steps[i] >= steps[i - 1], "scale went backwards while zooming in");
  }
  assert.ok(steps[steps.length - 1] > steps[0], "the full range produced no change at all");
});

test("scale never escapes the renderer's own limits", () => {
  [0.001, 0.02, 0.5, 1].forEach((size) => {
    [0.01, ZOOM_MIN, 1, ZOOM_MAX, 50].forEach((z) => {
      const s = focusScaleFor(region(size, size), z);
      assert.ok(s >= FOCUS_SCALE_LIMITS.min && s <= FOCUS_SCALE_LIMITS.max, `${size} @ ${z} -> ${s}`);
    });
  });
});

test("a missing or degenerate region does not throw", () => {
  assert.equal(focusScaleFor(null, 2), FOCUS_SCALE_LIMITS.min);
  assert.ok(Number.isFinite(focusScaleFor(region(0, 0), 1)));
  assert.ok(Number.isFinite(focusScaleFor(region(0.2, 0.2), 0)));
  assert.ok(Number.isFinite(focusScaleFor(region(0.2, 0.2), -3)));
});

/* --------------------------------------------------------------- the controls */

test("the zoom controls are multiplicative and reach below 1", () => {
  assert.ok(ZOOM_MIN < 1, "Zoom - must be able to go below the default framing");
  assert.ok(ZOOM_MAX > 1);
  assert.ok(ZOOM_STEP > 1);
  assert.match(screenSrc, /zoom = Math\.max\(ZOOM_MIN, zoom \/ ZOOM_STEP\)/);
  assert.match(screenSrc, /zoom = Math\.min\(ZOOM_MAX, zoom \* ZOOM_STEP\)/);
  assert.doesNotMatch(screenSrc, /Math\.max\(1, zoom - 0\.35\)/,
    "the additive Zoom - that could never leave 1 is back");
});

test("a saturated zoom button is disabled rather than silently inert", () => {
  assert.match(screenSrc, /disabled: zoomAt\.atMin/);
  assert.match(screenSrc, /disabled: zoomAt\.atMax/);
  // The limits come from what the renderer actually applied, not a guess.
  assert.match(screenSrc, /applied\.scale <= applied\.min/);
  assert.match(screenSrc, /applied\.scale >= applied\.max/);
});

test("every zoom control re-renders so the disabled state can update", () => {
  const controls = screenSrc.match(/(Zoom -|Zoom \+|"Reset")[\s\S]{0,160}?applyFocus\(([a-z]*)\)/g) || [];
  assert.equal(controls.length, 3, "expected Zoom -, Reset and Zoom + to each call applyFocus");
  controls.forEach((c) => assert.match(c, /applyFocus\(render\)/, "a zoom control does not re-render: " + c));
});

test("focusRegion reports what it applied instead of returning nothing", () => {
  const cockpitSrc = stripComments(fs.readFileSync(path.join(root, "app/js/cockpit.js"), "utf8"));
  assert.match(cockpitSrc, /return \{ scale: state\.userScale, min: USER_SCALE_MIN, max: USER_SCALE_MAX \};/);
  assert.match(cockpitSrc, /state\.userScale = focusScaleFor\(region, zoomMultiplier\);/,
    "focusRegion must use the shared, tested scale function");
  assert.doesNotMatch(cockpitSrc, /clamp\(base \* \(zoomMultiplier \|\| 1\), 1\.35, 10\)/,
    "the clamp that swallowed the multiplier is back");
});
