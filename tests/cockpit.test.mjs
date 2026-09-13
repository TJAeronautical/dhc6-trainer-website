/*
  Aircraft State / cockpit logic tests.

  Every expectation here is pinned to the Android source behaviour recorded in the
  renderer spec (CanonicalVisualStatePolicy, CockpitHitboxIO, HitboxAssetLoader,
  buildCanonicalControlSpritePack, EngineSystemsModel, CasCatalog / CasSystem /
  FailureStateEvaluator, ScenarioPhaseSnapshotRenderer, DrillStepEvaluator,
  ScenarioProceduresScreen, ProcedureCockpitBindingsIndex), including the six
  documented Android quirks that the web port reproduces deliberately.
*/
import test from "node:test";
import assert from "node:assert/strict";

import { canonicalVisualKey, canonicalVisualAliases, visualKeysMatch, cockpitVisualKeys, resolveVisualHostRole, isInstrumentVisualHost, isAnnunciatorVisualHost, visualOverlayCandidateIds, humanizeKey, canonicalScenarioKey, ROLE } from "../app/js/logic/cockpit/keys.js";
import { REFERENCE_SIZES, displayVariant, snapshotVariantKey, clampNormRect, parseHitboxes, normalizeForVariantParity, hitboxById, rectPx, fitFrame, cockpitTransform } from "../app/js/logic/cockpit/hitboxes.js";
import { FLIGHT_IDLE_GATE_01, familySpecFor, familyDirs, pickDefaultState, calibrationFor, spriteScale, liveScaleOverride, sortForDraw, isLeverHitbox, isSwitchHitbox, remapPowerLeverLogical, leverTopLeft, visualStateKeysForSwitchState, instrumentDirs, annunciatorDirs } from "../app/js/logic/cockpit/sprites.js";
import { warmUp, createEngineModel, createSimRunner, C } from "../app/js/logic/cockpit/engine.js";
import { normalizeCas, casSpecFor, annunciatorCatalog, createCasSystem, createCasController, evaluateFailures, resolveG950Cas, resolveLegacyAnnunciators, LEGACY_STARTUP_PANEL_ANNUNCIATORS, G950_STARTUP_CAS_MESSAGES } from "../app/js/logic/cockpit/cas.js";
import { SCENARIO_ANNUNCIATOR_OVERRIDE_KEY, PHASES, ProcedureKeyNormalizer, parseSnapshot, createSnapshotRegistry, toPhaseState, annunciatorOverrideEnabled, visibleControls, parseSnapshotPowerLever, parseSnapshotPropLever, parseSnapshotFuelLever, parseSnapshotFlap, snapshotLeverPositions, parseSnapshotSwitchState, snapshotSwitchStates, instrumentNormalized, instrumentOverlayKeys, parseInstrumentOverride, inferWow, snapshotVisualState, summaryLines, deriveTextFocusTargets, mapHitboxIdToFocusTarget } from "../app/js/logic/cockpit/snapshot.js";
import { defaultOffStateForSwitch, seedSwitchStates, seedLeverPositions, switchModeFor, nextSwitchState, createInteractionController } from "../app/js/logic/cockpit/interaction.js";
import { CONTEXTS, contextByRouteKey, cleanScenarioProcedureTitle, inferNormalBucket, inferScenarioPhase, inferProcedureGroup, scenarioMetaFor, matchesContext, matchesSearch, allowedContextsFor, scenarioTileArt, scenarioItems } from "../app/js/logic/cockpit/scenarios.js";
import { normalizeControlId, switchStateSatisfiesAction, flapLeverPositionSatisfiesAction, powerLeverPositionSatisfiesAction, requiredPositionLabelForAction, drillTargetLabel, isChecklistDisplayCue, isMandatoryCockpitActionCue, isQuestionOrChallengeAction, GRADING, formatDuration, inferredPhaseForProgress, createDrillRun } from "../app/js/logic/cockpit/drillrun.js";
import { createHitboxIndex, createBindingsIndex } from "../app/js/logic/cockpit/bindings.js";
import { SECTIONS, STYLE, canonicalKey, stripAnnunciatorStateSuffix, canonicalAnnunciatorKey, humanLabel, isAnnunciatorOverrideControl, extractNumber, formatNumber, buildAnnunciatorOptions, buildInstrumentOptions, buildControlOptions, buildToggleOptions, initialEnabledKeys, initialValues, coerceValue, stepOrdered, stepNumeric, withToggleSelection, phaseOverridePayload } from "../app/js/logic/cockpit/stateeditor.js";

/* ------------------------------------------------------------- fixtures */
function hb(id, extra) {
  return Object.assign({ id: id, type: "action", rect: { x: 0.1, y: 0.1, w: 0.05, h: 0.04 }, axis: null, binding: null, sprite: null }, extra || {});
}
function switchHb(id, binding) {
  return hb(id, { type: "switch", binding: Object.assign({ kind: "switch", switchId: id }, binding || {}) });
}

/* =========================================================== keys.js */
test("canonical visual keys and the annunciator alias table match CanonicalVisualStatePolicy", () => {
  assert.equal(canonicalVisualKey(" l-gen fail.png "), "L_GEN_FAIL");
  assert.equal(canonicalVisualKey("MASTER__CAUTION__"), "MASTER_CAUTION");
  assert.equal(canonicalVisualKey(null), "");
  assert.deepEqual(canonicalVisualAliases("L_GEN_FAIL"), ["L_GEN_FAIL", "L_GENERATOR", "LEFT_GENERATOR", "LEFT_GENERATOR_FAIL"], "insertion order is LinkedHashSet order");
  assert.deepEqual(canonicalVisualAliases("L_GENERATOR"), ["L_GENERATOR", "L_GEN_FAIL", "LEFT_GENERATOR", "LEFT_GENERATOR_FAIL"], "aliases resolve back to the canonical id");
  assert.deepEqual(canonicalVisualAliases("MFD_CENTRE"), ["MFD_CENTRE", "MFD_CENTER"]);
  assert.ok(canonicalVisualAliases("STBY_INST").includes("STANDBY_INSTR"));
  assert.equal(visualKeysMatch("TORQUE_GAUGE_L", "TORQUE_GAUGE"), true, "substring both ways");
  assert.equal(visualKeysMatch("TORQUE_GAUGE_L", "NG_GAUGE_L"), false);
  assert.equal(visualKeysMatch("", "ANYTHING"), false);
  assert.equal(humanizeKey("L_GEN_FAIL"), "L Gen Fail");
  assert.equal(canonicalScenarioKey("Ng L"), "NG_L");
});

test("visual host roles separate controls, instruments and annunciators", () => {
  const gauge = hb("TORQUE_GAUGE_L", { type: "instrument", binding: { kind: "instrument", instrumentId: "TORQUE_L" } });
  assert.equal(resolveVisualHostRole(gauge), ROLE.INSTRUMENT);
  assert.equal(isInstrumentVisualHost(gauge), true);
  assert.deepEqual(visualOverlayCandidateIds(gauge), ["TORQUE_L", "TORQUE_GAUGE_L"], "instrument id wins over the hitbox id");

  const lamp = hb("L_GENERATOR", { type: "annunciator", binding: { kind: "annunciator" } });
  assert.equal(isAnnunciatorVisualHost(lamp), true);

  // FIRE controls are never treated as annunciator hosts even though the key contains FIRE.
  const fire = switchHb("FIRE_HANDLE_L");
  assert.equal(resolveVisualHostRole(fire), ROLE.CONTROL);
  assert.equal(resolveVisualHostRole(switchHb("BATTERY_MASTER")), ROLE.CONTROL);
  assert.equal(resolveVisualHostRole(hb("CIRCUIT_BREAKER_PANEL_L", { binding: { kind: "region", regionId: "CIRCUIT_BREAKER_PANEL_L" } })), ROLE.REGION);
  assert.ok(cockpitVisualKeys(switchHb("PITOT_HEAT_SWITCH", { action: "PITOT_HEAT" })).includes("PITOT_HEAT"));
});

/* ====================================================== hitboxes.js */
test("plate reference sizes and the variant split follow CanonicalCockpitContract", () => {
  assert.deepEqual([REFERENCE_SIZES.LEGACY.width, REFERENCE_SIZES.LEGACY.height], [3748, 5276]);
  assert.deepEqual([REFERENCE_SIZES.G950.width, REFERENCE_SIZES.G950.height], [3744, 5276]);
  assert.equal(displayVariant("BOTH"), "LEGACY", "canonicalCockpitDisplayVariant: BOTH renders the legacy plate");
  assert.equal(displayVariant("G950"), "G950");
  assert.equal(snapshotVariantKey("BOTH"), "G950", "cockpitVariantKey: BOTH picks the G950 snapshot baseline");
  assert.equal(snapshotVariantKey("LEGACY"), "LEGACY");
});

test("hitbox parsing accepts every published shape and clamps rects into the plate", () => {
  const row = { id: "A", type: "switch", rect: { x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, binding: { kind: "switch", switchId: "A", switchPositions: ["on", "off"], momentaryReturnMs: 0 } };
  const clamped = parseHitboxes([row])[0].rect;
  assert.deepEqual([clamped.x, clamped.y], [0.9, 0.9]);
  assert.ok(Math.abs(clamped.w - 0.1) < 1e-9 && Math.abs(clamped.h - 0.1) < 1e-9, "w/h clamp to the remaining plate");
  assert.deepEqual(clampNormRect({ x: -1, y: 2, w: "0.2", h: null }), { x: 0, y: 1, w: 0.2, h: 0 });
  assert.equal(parseHitboxes({ hitboxes: [row] }).length, 1);
  assert.equal(parseHitboxes({ data: { hitboxes: [row] } }).length, 1);
  assert.equal(parseHitboxes({ items: [row] }).length, 1);
  assert.equal(parseHitboxes({ overrides: [{ hitboxId: "B", replace: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } }] })[0].id, "B");
  assert.deepEqual(parseHitboxes(null), []);
  assert.deepEqual(parseHitboxes([{ type: "switch" }]), [], "an entry with no id is dropped");
  const parsed = parseHitboxes([row])[0];
  assert.equal(parsed.binding.momentaryReturnMs, null, "0 ms means no momentary return");
  assert.deepEqual(parsed.binding.switchPositions, ["ON", "OFF"]);
});

test("G950 parity renaming keeps the non-alias entry", () => {
  const list = parseHitboxes([{ id: "LANDING_LIGHTS_L", type: "switch", rect: { x: 0, y: 0, w: 0.1, h: 0.1 }, binding: { kind: "switch", switchId: "LANDING_LIGHTS_L" } }]);
  const renamed = normalizeForVariantParity(list, "G950");
  assert.equal(renamed[0].id, "LANDING_LIGHT_L");
  assert.equal(renamed[0].binding.switchId, "LANDING_LIGHT_L");
  assert.equal(normalizeForVariantParity(list, "LEGACY")[0].id, "LANDING_LIGHTS_L", "legacy is never renamed");

  const both = list.concat(parseHitboxes([{ id: "LANDING_LIGHT_L", type: "switch", rect: { x: 0.2, y: 0, w: 0.1, h: 0.1 } }]));
  const collapsed = normalizeForVariantParity(both, "G950");
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].rect.x, 0.2, "the real entry survives, the alias is dropped");
  assert.equal(hitboxById(collapsed, "LANDING_LIGHT_L").id, "LANDING_LIGHT_L");
  assert.equal(hitboxById(collapsed, "NOPE"), null);
});

test("the canonical contain-fit transform centres the plate and composes with the user zoom", () => {
  const fit = fitFrame(1000, 1000, 3748, 5276);
  assert.ok(Math.abs(fit.scale - 1000 / 5276) < 1e-9);
  assert.ok(Math.abs(fit.top) < 1e-9, "the tall plate fills the height");
  assert.ok(fit.left > 0, "and is centred horizontally");
  assert.deepEqual(fitFrame(0, 100, 10, 10), { width: 0, height: 100, left: 0, top: 0, scale: 1 });
  const t = cockpitTransform(1000, 1000, 3748, 5276, 2, { x: 10, y: -5 });
  assert.ok(Math.abs(t.scale - fit.scale * 2) < 1e-9);
  assert.ok(Math.abs(t.offsetX - (fit.left + 10)) < 1e-9);
  assert.ok(Math.abs(t.offsetY - (fit.top - 5)) < 1e-9);
  assert.deepEqual(rectPx({ rect: { x: 0.5, y: 0.25, w: 0.1, h: 0.2 } }, 200, 400), { left: 100, top: 100, width: 20, height: 80 });
});

/* ======================================================== sprites.js */
test("sprite families, directories and calibration come from the Android family table", () => {
  assert.equal(FLIGHT_IDLE_GATE_01, 0.26);
  assert.equal(familySpecFor(switchHb("BATTERY_MASTER")).family, "battery_master");
  assert.equal(familySpecFor(switchHb("AFT_BOOST_PUMP")).family, "boost_pumps");
  assert.equal(familySpecFor(switchHb("INVERTER_1_CB")).family, "20amp_state_of_cb");
  assert.equal(familySpecFor(switchHb("HYD_OIL_PUMP_CB")).family, "35amp_state_of_cb");
  assert.equal(familySpecFor(switchHb("PITOT_HEAT_SWITCH")).family, "two_toggle_large");
  assert.equal(familySpecFor(switchHb("L_DC_GEN")).family, "three_toggle_large");
  assert.equal(familySpecFor(hb("POWER_LEVER_L", { type: "lever", binding: { kind: "lever", leverId: "POWER_LEVER_L" } })).family, "power_lever_l");
  // G1: WINDSHIELD_WASHER maps to a family folder the Android bundle does not ship.
  assert.equal(familySpecFor(switchHb("WINDSHIELD_WASHER")).family, "switch_button");
  // instruments, displays and lamp hosts never get a control sprite
  assert.equal(familySpecFor(hb("TORQUE_GAUGE_L", { type: "instrument", binding: { kind: "instrument", instrumentId: "TORQUE_L" } })), null);
  assert.equal(familySpecFor(hb("L_GENERATOR", { type: "annunciator", binding: { kind: "annunciator" } })), null);

  assert.deepEqual(familyDirs("legacy", "boost_pumps"), ["cockpit/source_exact/legacy/boost_pumps", "cockpit/source_exact/shared/boost_pumps", "cockpit/source_exact/boost_pumps"]);
  assert.equal(pickDefaultState(["default", "off", "on"], ["ON", "OFF"]), "OFF", "case-insensitive preferred-state pick");
  assert.equal(pickDefaultState(["default"], []), null);
  assert.equal(calibrationFor(switchHb("BATTERY_MASTER")).mul, 0.8);
  assert.equal(calibrationFor(hb("FUEL_LEVER_L", { type: "lever", binding: { kind: "lever", leverId: "FUEL_LEVER_L" } })).w, 1.15);
  assert.equal(calibrationFor(hb("UNKNOWN_THING")), null);
  assert.equal(liveScaleOverride("POWER_LEVER_L"), 1.2);
  assert.equal(liveScaleOverride("IGNITION_ARM"), 0.82);
  assert.equal(liveScaleOverride("BATTERY_MASTER"), 1);
  assert.deepEqual(instrumentDirs("g950")[0], "cockpit/source_exact/g950/instruments");
  assert.deepEqual(annunciatorDirs("legacy")[0], "cockpit/source_exact/legacy/annunciators");
});

test("sprite scale is the calibrated contain fit, uncalibrated sprites keep the 0.92 inset", () => {
  const box = hb("X", { rect: { x: 0, y: 0, w: 0.1, h: 0.1 } });
  // reference 1000x1000 -> a 100x100 slot; a 200x100 sprite fits on the wider axis
  assert.equal(spriteScale(box, 1000, 1000, 200, 100, null), Math.min(100 / 200, 100 / 100) * 0.92);
  assert.equal(spriteScale(box, 1000, 1000, 200, 100, { w: 1, h: 1, mul: 1 }), 0.5, "calibrated scale drops the 0.92 inset");
  assert.equal(spriteScale(box, 1000, 1000, 200, 100, { w: 0.8, h: 0.8, mul: 0.8 }), 0.5 * 0.8 * 0.8);
  assert.ok(spriteScale(box, 1000, 1000, 0, 0, null) > 0, "a zero-size sprite never divides by zero");
});

test("levers use the Android travel profiles (QUIRK-1: flap raw 0 sits at the bottom of its slot)", () => {
  assert.deepEqual([0, 0.13, 0.26, 0.63, 1].map(remapPowerLeverLogical), [0.04, 0.27, 0.5, 0.73, 0.96], "the power lever is segmented around the flight-idle gate");
  const rect = { left: 0, top: 0, width: 100, height: 400 };
  const flap = hb("FLAP_SELECTOR", { type: "lever", binding: { kind: "lever", leverId: "FLAP_SELECTOR" } });
  const up = leverTopLeft(flap, "FLAP_SELECTOR", rect, 40, 60, 0, 0, 0);
  const down = leverTopLeft(flap, "FLAP_SELECTOR", rect, 40, 60, 0, 0, 1);
  assert.ok(up.y > down.y, "raw 0 renders lower in the slot than raw 1 — the Android inversion");
  assert.ok(up.y + 60 <= rect.height + 1, "keepInside clamps the sprite into the slot");
  assert.equal(up.x, 30, "the sprite is centred horizontally on the slot");

  const power = hb("POWER_LEVER_L", { type: "lever", binding: { kind: "lever", leverId: "POWER_LEVER_L" } });
  const idle = leverTopLeft(power, "POWER_LEVER_L", rect, 40, 60, 0, 0, FLIGHT_IDLE_GATE_01);
  const full = leverTopLeft(power, "POWER_LEVER_L", rect, 40, 60, 0, 0, 0);
  assert.ok(full.y > idle.y, "full forward (raw 0) is below the flight-idle gate position");
});

test("QUIRK-2: a two-position switch maps LEFT/RIGHT onto the declared position names", () => {
  const two = switchHb("AFT_BOOST_PUMP", { switchPositions: ["ON", "OFF"] });
  assert.equal(visualStateKeysForSwitchState("LEFT", two)[0], "on");
  assert.equal(visualStateKeysForSwitchState("RIGHT", two)[0], "off");
  const three = switchHb("L_DC_GEN", { switchPositions: ["ON", "CENTER", "RESET"] });
  assert.equal(visualStateKeysForSwitchState("LEFT", three)[0], "on");
  assert.equal(visualStateKeysForSwitchState("CENTER", three)[0], "center");
  assert.equal(visualStateKeysForSwitchState("RIGHT", three)[0], "reset");
  assert.ok(visualStateKeysForSwitchState("RIGHT", hb("NO_POSITIONS")).includes("default"), "the fallback chain always ends at default");
});

test("draw ordering puts bound controls above plain regions and is otherwise stable", () => {
  const region = hb("PANEL", { type: "region" });
  const lever = hb("POWER_LEVER_L", { type: "lever", binding: { kind: "lever", leverId: "POWER_LEVER_L" } });
  const sw = switchHb("BATTERY_MASTER");
  assert.deepEqual(sortForDraw([region, lever, sw]).map((h) => h.id), ["POWER_LEVER_L", "BATTERY_MASTER", "PANEL"]);
  assert.deepEqual(sortForDraw([region, sw, lever]).map((h) => h.id), ["BATTERY_MASTER", "POWER_LEVER_L", "PANEL"], "equal scores keep the source order");
  assert.equal(isLeverHitbox(lever), true);
  assert.equal(isLeverHitbox(sw), false);
  assert.equal(isSwitchHitbox(sw), true);
});

/* ========================================================= engine.js */
test("EngineSystemsModel reproduces the Android 180-tick warm-up reference set", () => {
  const round = (o) => [o.left.ngPercent, o.left.npPercent, o.left.torquePercent, o.left.t5Celsius, o.left.fuelFlowPph, o.left.oilPressurePsi, o.left.oilTemperatureC]
    .map((v) => Math.round(v * 100) / 100).concat(Math.round(o.hydraulicPressurePsi));
  // levers are the snapshot-renderer convention: power raw, prop already inverted (QUIRK-6), fuel raw
  assert.deepEqual(round(warmUp({ powerL: 0.26, powerR: 0.26, propL: 0, propR: 0, fuelL: 1, fuelR: 1 }, true, 180)), [0, 0, 0, 20, 0, 0, 20, 0], "cold and dark");
  assert.deepEqual(round(warmUp({ powerL: 0.26, powerR: 0.26, propL: 1, propR: 1, fuelL: 0, fuelR: 0 }, true, 180)), [52, 55.67, 0, 350, 105.48, 57.52, 46, 0], "ground running");
  assert.deepEqual(round(warmUp({ powerL: 0.0572, powerR: 0.0572, propL: 1, propR: 1, fuelL: 0, fuelR: 0 }, false, 180)), [85.93, 75, 44.17, 350, 392.54, 80.92, 62, 1600], "cruise");
  assert.deepEqual(round(warmUp({ powerL: 0.026, powerR: 0.026, propL: 1, propR: 1, fuelL: 0, fuelR: 0 }, false, 180)), [94.18, 75, 53.3, 350, 411.13, 86.6, 62, 1600], "climb");
  assert.deepEqual(round(warmUp({ powerL: 0, powerR: 0, propL: 1, propR: 1, fuelL: 0, fuelR: 0 }, false, 180)), [101.65, 75, 53.3, 350, 417.11, 91.76, 62, 1600], "takeoff");
});

test("the engine model clamps dt, burns fuel and gates hydraulic pressure on NG", () => {
  const model = createEngineModel();
  let out;
  for (let i = 0; i < 300; i += 1) out = model.tick(0, 0, 1, 1, 0, 0, false, 5, false); // dt clamped to MAX_DT_SEC
  assert.ok(out.hydraulicPressurePsi === C.HYDRAULIC_NOMINAL_PSI, "NG above 60 % gives nominal hydraulic pressure");
  assert.ok(out.fuelQuantityLeftLb < C.INITIAL_FUEL_QTY_LB, "fuel burns down");
  model.reset();
  const cold = model.tick(0.26, 0.26, 0, 0, 1, 1, true, 1 / 30, false);
  assert.equal(cold.left.ngPercent, 0);
  assert.equal(cold.hydraulicPressurePsi, 0);
  assert.equal(cold.left.bladeAngleDeg, 87, "a stopped, unfuelled engine shows the feather blade angle");
});

test("the autofeather arm lamp needs both engines above the Android gates", () => {
  const runner = createSimRunner();
  const good = { left: { ngPercent: 95, torquePercent: 70, npPercent: 96, groundOperation: false }, right: { ngPercent: 95, torquePercent: 70, npPercent: 96, groundOperation: false } };
  assert.equal(runner.tick(0.7, 0.7, 0.85, 0.85, 0, 0, good, true, false).armLamp, true);
  assert.equal(runner.tick(0.7, 0.7, 0.85, 0.85, 0, 0, good, true, true).armLamp, false, "weight on wheels disarms");
  assert.equal(runner.tick(0.7, 0.7, 0.85, 0.85, 0, 0, good, false, false).armLamp, false, "not selected");
  assert.equal(runner.tick(0.5, 0.7, 0.85, 0.85, 0, 0, good, true, false).armLamp, false, "a lever below the power gate disarms");
  const weak = { left: good.left, right: { ngPercent: 95, torquePercent: 40, npPercent: 96, groundOperation: false } };
  assert.equal(runner.tick(0.7, 0.7, 0.85, 0.85, 0, 0, weak, true, false).armLamp, false, "one side below the torque gate");
});

/* ============================================================ cas.js */
test("CasCatalog normalises sides, ground/air pneumatics and the operator alias profile", () => {
  assert.equal(normalizeCas("GEN_FAIL", "L").stableId, "L_GEN_FAIL");
  assert.equal(normalizeCas("ENGINE_FIRE", "R").stableId, "R_ENG_FIRE");
  assert.equal(normalizeCas("PNU_LOW_PRESS", null, "GROUND").stableId, "PNU_LOW_PRESS_GND");
  assert.equal(normalizeCas("PNU_LOW_PRESS", null, "AIR").stableId, "PNU_LOW_PRESS_AIR");
  assert.equal(normalizeCas("L_GENERATOR").stableId, "L_GEN_FAIL", "legacy lamp id maps to the CAS id");
  assert.equal(normalizeCas("400_CYCLE_LIGHT").stableId, "AC_400_CYCLE");
  assert.equal(normalizeCas("SOMETHING_UNKNOWN").priority, "ADVISORY");
  assert.equal(normalizeCas("SOMETHING_UNKNOWN").text, "SOMETHING UNKNOWN");
  assert.equal(casSpecFor("L_ENG_FIRE").latched, true);
  assert.equal(casSpecFor("L_ENG_FIRE").ackAllowed, false);
  assert.equal(casSpecFor("L_GEN_FAIL").latched, false);
  const catalog = annunciatorCatalog();
  assert.ok(catalog.length >= 54);
  assert.equal(catalog[0].priority, "WARNING", "the picker sorts by priority rank then text");
  assert.equal(new Set(catalog.map((e) => e.stableId)).size, catalog.length, "distinctBy stableId");
});

test("CasSystem latches, acknowledges and inhibits by phase; the controller drives the masters", () => {
  let clock = 1000;
  const sys = createCasSystem({ now: () => (clock += 10), context: { phase: "CRUISE" } });
  sys.onEvent({ id: "L_ENG_FIRE", active: true });
  sys.onEvent({ id: "L_GEN_FAIL", active: true });
  assert.deepEqual(sys.messages().map((m) => m.key.id), ["L_ENG_FIRE", "L_GEN_FAIL"], "warnings sort above cautions");
  sys.onEvent({ id: "L_ENG_FIRE", active: false });
  assert.ok(sys.messages().some((m) => m.key.id === "L_ENG_FIRE"), "a latched warning survives going inactive");
  sys.acknowledgeAll();
  assert.equal(sys.messages().find((m) => m.key.id === "L_ENG_FIRE").acknowledged, false, "the fire warning cannot be acknowledged");
  assert.equal(sys.messages().find((m) => m.key.id === "L_GEN_FAIL").acknowledged, true);
  sys.clearLatched("L_ENG_FIRE");
  assert.equal(sys.messages().some((m) => m.key.id === "L_ENG_FIRE"), false);
  sys.clearAll();
  assert.deepEqual(sys.messages(), []);

  const takeoff = createCasSystem({ context: { phase: "TAKEOFF" } });
  takeoff.onEvent({ id: "L_PROP_BETA", active: true });
  assert.deepEqual(takeoff.messages(), [], "STATUS messages are inhibited during takeoff");

  const controller = createCasController();
  assert.deepEqual(controller.masters(), { warning: false, caution: false });
  let set = controller.applySet(new Set(), new Set(["L_GEN_FAIL"]));
  assert.deepEqual(controller.masters(), { warning: false, caution: true });
  controller.applySet(set, new Set(["L_GEN_FAIL", "R_ENG_FIRE"]));
  assert.deepEqual(controller.masters(), { warning: true, caution: false }, "a warning supersedes the caution master");
  controller.onCasEvent({ id: "MASTER_CAUTION", active: true });
  assert.equal(controller.system.messages().some((m) => m.key.id === "MASTER_CAUTION"), false, "the masters are never CAS messages themselves");
});

test("FailureStateEvaluator reproduces the ground-idle and cruise reference outcomes", () => {
  const groundIdle = evaluateFailures({
    wow: true, leftGenOn: true, rightGenOn: true, fuelOnLeft: true, fuelOnRight: true,
    leftNgPercent: 52, rightNgPercent: 52, leftNpPercent: 55.67, rightNpPercent: 55.67, leftTorquePsi: 0, rightTorquePsi: 0,
    leftOilPressurePsi: 57.52, rightOilPressurePsi: 57.52, hydraulicPressurePsi: 0, powerLeverL01: 0.26, powerLeverR01: 0.26,
    leftT5Celsius: 350, rightT5Celsius: 350, leftFuelFlowPph: 105, rightFuelFlowPph: 105, fuelQtyFwdLb: 1000, fuelQtyAftLb: 1000
  });
  assert.deepEqual(groundIdle.activeProfiles, ["L_GEN_FAIL", "R_GEN_FAIL", "PNU_LOW_PRESS_GND"]);
  assert.deepEqual(resolveLegacyAnnunciators(groundIdle), ["L_GENERATOR", "R_GENERATOR", "PNEUMATIC_LOW_PRESSURE"]);
  assert.deepEqual(resolveG950Cas(groundIdle), ["L_GEN_FAIL", "R_GEN_FAIL", "PNU_LOW_PRESS_GND"]);

  const cruise = evaluateFailures({
    wow: false, leftGenOn: true, rightGenOn: true, fuelOnLeft: true, fuelOnRight: true,
    leftNgPercent: 85.93, rightNgPercent: 85.93, leftNpPercent: 75, rightNpPercent: 75, leftTorquePsi: 41.4, rightTorquePsi: 41.4,
    leftOilPressurePsi: 80.92, rightOilPressurePsi: 80.92, hydraulicPressurePsi: 1600, powerLeverL01: 0.0572, powerLeverR01: 0.0572,
    propLeverL01: 1, propLeverR01: 1, leftT5Celsius: 350, rightT5Celsius: 350, leftFuelFlowPph: 392, rightFuelFlowPph: 392, fuelQtyFwdLb: 1000, fuelQtyAftLb: 1000
  });
  assert.deepEqual(cruise.activeProfiles, [], "a healthy cruise raises nothing");

  const overtemp = evaluateFailures({ wow: false, leftGenOn: true, rightGenOn: true, leftNgPercent: 99, rightNgPercent: 99, leftNpPercent: 96, rightNpPercent: 96,
    leftOilPressurePsi: 80, rightOilPressurePsi: 80, hydraulicPressurePsi: 1600, leftT5Celsius: 760, rightT5Celsius: 350, fuelQtyFwdLb: 1000, fuelQtyAftLb: 1000, propLeverL01: 1, propLeverR01: 1 });
  assert.ok(overtemp.activeProfiles.includes("L_T5_OVERTEMP"));
  assert.equal(overtemp.activeProfiles.includes("R_T5_OVERTEMP"), false);
  assert.equal(resolveLegacyAnnunciators({ activeProfiles: ["L_PROP_BETA"] }).length, 0, "beta has no legacy lamp");
});

test("the documented startup self-test sets are published verbatim", () => {
  assert.ok(LEGACY_STARTUP_PANEL_ANNUNCIATORS.includes("BLANK"));
  assert.equal(LEGACY_STARTUP_PANEL_ANNUNCIATORS.length, 18);
  assert.ok(G950_STARTUP_CAS_MESSAGES[0] === "MSTR_WARN_TEST");
  assert.ok(G950_STARTUP_CAS_MESSAGES.includes("MSTR_CAUT_TEST"));
});

/* ======================================================= snapshot.js */
test("QUIRK-4: bare-string annunciator entries are dropped by the snapshot parser", () => {
  const parsed = parseSnapshot({
    notes: " on the ground ",
    controls: { "Power Lever L": "IDLE", "Empty Value": "" },
    instruments: { "Ng L": "52" },
    annunciators: ["L_GENERATOR", { id: "R_GENERATOR", level: "caution" }, { id: "DOORS_UNLOCKED", level: "OFF" }, { level: "WARNING" }]
  });
  assert.deepEqual(parsed.annunciators, [{ id: "R_GENERATOR", level: "CAUTION" }], "bare strings, OFF levels and id-less rows all vanish");
  assert.deepEqual(Object.keys(parsed.controls), ["Power Lever L"], "empty values are dropped");
  assert.equal(parsed.notes, " on the ground ", "notes keep their raw text");
  const mapForm = parseSnapshot({ annunciators: { MASTER_CAUTION_LEFT: true, DOORS_UNLOCKED: false } });
  assert.deepEqual(mapForm.annunciators, [{ id: "MASTER_CAUTION_LEFT", level: "CAUTION" }]);
});

test("snapshot lever parsing follows the flight-idle gate convention", () => {
  assert.equal(parseSnapshotPowerLever("MAX"), 0);
  assert.equal(parseSnapshotPowerLever("TAKE-OFF"), 0);
  assert.ok(Math.abs(parseSnapshotPowerLever("CRUISE") - 0.26 * (1 - 0.78)) < 1e-9);
  assert.equal(parseSnapshotPowerLever("IDLE"), 0.26);
  assert.ok(parseSnapshotPowerLever("REV 100") > 0.26, "reverse sits beyond the gate");
  assert.equal(parseSnapshotPowerLever("nonsense"), null);
  assert.equal(parseSnapshotPropLever("MAX"), 0);
  assert.equal(parseSnapshotPropLever("FEATHER"), 1);
  assert.equal(parseSnapshotPropLever("75%"), 0.25);
  assert.equal(parseSnapshotFuelLever("RUN"), 0);
  assert.equal(parseSnapshotFuelLever("CUTOFF"), 1);
  assert.equal(parseSnapshotFlap("FULL"), 1);
  assert.equal(parseSnapshotFlap("20"), 20 / 37.5);
  assert.equal(parseSnapshotFlap("UP"), 0);

  const levers = snapshotLeverPositions({ "Power Lever L": "MAX", "Power Lever R": "IDLE", "Prop Lever L": "FEATHER", "Fuel Lever L": "CUTOFF", "Flaps": "20" });
  assert.deepEqual(levers, { POWER_LEVER_L: 0, POWER_LEVER_R: 0.26, PROP_LEVER_L: 1, FUEL_LEVER_L: 1, FLAP_SELECTOR: 20 / 37.5 });
});

test("snapshot switch states seed both generators ON and only map the known labels", () => {
  assert.equal(parseSnapshotSwitchState("ON"), "LEFT");
  assert.equal(parseSnapshotSwitchState("OFF"), "RIGHT");
  assert.equal(parseSnapshotSwitchState("MID"), "CENTER");
  assert.equal(parseSnapshotSwitchState("???"), null);
  const states = snapshotSwitchStates({ "Generator L": "OFF", "Autofeather Arm": "OFF", "Battery Master": "ON", "Fwd Boost Pump": "ON" });
  assert.equal(states.L_DC_GEN, "RIGHT");
  assert.equal(states.R_DC_GEN, "LEFT", "the right generator keeps its seeded ON state");
  assert.equal(states.AUTOFEATHER_SELECT, "RIGHT");
  assert.equal(states.FWD_BOOST_PUMP, "LEFT");
  assert.equal(states.BATTERY_MASTER, undefined, "unmapped labels produce no switch state");
});

test("instrument normalisation uses the per-gauge full-scale ranges", () => {
  assert.equal(instrumentNormalized("NG_L", 51, "LEGACY"), 0.5);
  assert.equal(instrumentNormalized("TORQUE_GAUGE_L", 30, "LEGACY"), 0.5, "the legacy torque gauge is 60 PSI full scale");
  assert.equal(instrumentNormalized("TORQUE_GAUGE_L", 25, "G950"), 0.5, "the G950 gauge is 50 PSI");
  assert.equal(instrumentNormalized("OIL_TEMP_L", 60, "LEGACY"), 0.5);
  assert.equal(instrumentNormalized("NP_L", 0.4, "LEGACY"), 0.4, "values already in 0..1 pass through");
  assert.equal(instrumentNormalized("NG_L", "nope", "LEGACY"), 0);
  assert.deepEqual(instrumentOverlayKeys("Ng L"), ["NG_GAUGE_L", "NG_L"]);
  assert.deepEqual(instrumentOverlayKeys("MYSTERY"), ["MYSTERY"]);
  assert.deepEqual(parseInstrumentOverride("NG_L", "51", "LEGACY"), { normalized: 0.5, actual: 51 });
  assert.deepEqual(parseInstrumentOverride("ANY", "40%", "LEGACY"), { normalized: 0.4, actual: 40 });
  assert.deepEqual(parseInstrumentOverride("ANY", "true", "LEGACY"), { normalized: 1, actual: 1 });
  assert.equal(parseInstrumentOverride("ANY", "", "LEGACY"), null);
});

test("weight-on-wheels is inferred from the instruments then the notes", () => {
  assert.equal(inferWow({ instruments: { WOW: "TRUE" }, notes: null }), true);
  assert.equal(inferWow({ instruments: { "On Ground": "0" }, notes: null }), false);
  assert.equal(inferWow({ instruments: { AIRBORNE: "TRUE" }, notes: null }), false, "AIRBORNE inverts the sense");
  assert.equal(inferWow({ instruments: {}, notes: "Aircraft on the ground, parked" }), true);
  assert.equal(inferWow({ instruments: {}, notes: "In the cruise" }), false);
});

test("the snapshot registry resolves procedure keys, merges the baseline and honours overrides", () => {
  const pack = { data: {
    baselines: { g950: { controls: { "Power Lever L": "IDLE" }, instruments: { "Ng L": "52" }, annunciators: [{ id: "DOORS_UNLOCKED" }], notes: "baseline" },
      legacy: { controls: {}, instruments: {}, annunciators: [] } },
    procedures: {
      "EMERGENCY/Engine Fire in Flight": { variant: "BOTH", title: "Engine Fire in Flight", phases: {
        before: { controls: { "Power Lever R": "CRUISE" }, instruments: {}, annunciators: [] },
        during: { controls: {}, instruments: { "Ng L": "20" }, annunciators: [{ id: "L_GENERATOR", level: "CAUTION" }], notes: "fire drill" }
      } },
      "LEGACY ONLY": { variant: "LEGACY", phases: { before: { controls: { "Flaps": "FULL" } } } }
    }
  } };
  const registry = createSnapshotRegistry(pack);
  assert.equal(registry.has("EMERGENCY/Engine Fire in Flight"), true);
  assert.equal(registry.has("emergency/engine fire in flight"), true, "the key normaliser folds case and punctuation");
  assert.equal(registry.has("EMERGENCY / Engine  Fire  in  Flight"), true);
  assert.equal(registry.has("No Such Procedure"), false);
  assert.equal(registry.entryTitle("emergency/engine fire in flight"), "Engine Fire in Flight");
  assert.deepEqual(registry.procedureKeys().sort(), ["EMERGENCY/Engine Fire in Flight", "LEGACY ONLY"]);
  assert.deepEqual(PHASES, ["BEFORE", "DURING", "AFTER"]);

  const before = registry.resolve("EMERGENCY/Engine Fire in Flight", "BOTH", "BEFORE");
  assert.equal(before.controls["Power Lever L"], "IDLE", "the baseline control survives");
  assert.equal(before.controls["Power Lever R"], "CRUISE");
  assert.deepEqual(before.annunciators.map((a) => a.id), ["DOORS_UNLOCKED"], "an empty phase list falls back to the baseline");
  const during = registry.resolve("EMERGENCY/Engine Fire in Flight", "BOTH", "DURING");
  assert.deepEqual(during.annunciators.map((a) => a.id), ["L_GENERATOR"], "a non-empty phase list replaces the baseline");
  assert.equal(during.instruments["Ng L"], "20");
  assert.equal(during.notes, "fire drill");

  const mismatched = registry.resolve("LEGACY ONLY", "G950", "BEFORE");
  assert.equal(mismatched.controls["Flaps"], undefined, "a LEGACY-only entry is not used for a G950 request");

  const overridden = createSnapshotRegistry(pack, { "EMERGENCY/Engine Fire in Flight": { phases: { DURING: { annunciators: [{ id: "R_GENERATOR" }] } } } });
  assert.deepEqual(overridden.resolve("EMERGENCY/Engine Fire in Flight", "BOTH", "DURING").annunciators.map((a) => a.id), ["R_GENERATOR"]);
  assert.equal(overridden.resolve("EMERGENCY/Engine Fire in Flight", "BOTH", "DURING").instruments["Ng L"], "20", "an override only replaces the fields it sets");
});

test("the annunciator override control is honoured and hidden from the control list", () => {
  assert.equal(annunciatorOverrideEnabled({ "Snapshot Annunciators Override": "ON" }), true);
  assert.equal(annunciatorOverrideEnabled({ "snapshot_annunciator_override": "OFF" }), false);
  assert.equal(annunciatorOverrideEnabled({ "Power Lever L": "IDLE" }), false);
  assert.deepEqual(Object.keys(visibleControls({ "Snapshot Annunciators Override": "ON", "Power Lever L": "IDLE" })), ["Power Lever L"]);
  assert.equal(ProcedureKeyNormalizer.normalize("Engine  Fire — in Flight!"), "engine fire in flight");
  assert.ok(ProcedureKeyNormalizer.equivalentKeys("Both boost pump failure CAS message same tank").length >= 2);
});

test("QUIRK-6: the frozen snapshot inverts the prop lever before the engine model", () => {
  const state = { notes: "cruise", controls: { "Power Lever L": "CRUISE", "Power Lever R": "CRUISE", "Prop Lever L": "MAX", "Prop Lever R": "MAX", "Fuel Lever L": "RUN", "Fuel Lever R": "RUN" }, instruments: {}, annunciators: [] };
  const visual = snapshotVisualState(state, "LEGACY");
  assert.equal(visual.leverPositions.PROP_LEVER_L, 0, "the displayed lever stays at MAX (raw 0)");
  const np = visual.analogValues.NP_GAUGE_L != null ? visual.rawAnalogValues.NP_GAUGE_L : null;
  assert.ok(np != null, "the NP gauge is derived from the engine model");
  assert.ok(Math.abs(np - 75) < 0.5, "the inversion governs NP to 75 % rather than 101.5 %");
  assert.ok(summaryLines(toPhaseState(state, []), true).length > 0, "the humanized phase state renders summary lines");
});

test("focus targets are derived from step text and hitbox ids", () => {
  assert.ok(deriveTextFocusTargets("POWER LEVERS — IDLE").length > 0);
  assert.equal(typeof mapHitboxIdToFocusTarget("POWER_LEVER_L"), "string");
});

/* ==================================================== interaction.js */
test("the live cockpit seeds the Android default switch states", () => {
  const seeded = seedSwitchStates();
  assert.equal(seeded.BATTERY_MASTER, "LEFT", "the battery master seeds ON");
  assert.equal(seeded.STBY_BATTERY, "LEFT");
  assert.equal(seeded.L_DC_GEN, "CENTER");
  assert.equal(seeded.FWD_BOOST_PUMP, "RIGHT");
  assert.equal(seeded.AUTOFEATHER_ARM, "LEFT");
  assert.equal(defaultOffStateForSwitch("SOMETHING_NEW"), "RIGHT", "the default off state is RIGHT");
  const levers = seedLeverPositions();
  assert.equal(levers.POWER_LEVER_L, FLIGHT_IDLE_GATE_01);
  assert.equal(levers.PROP_LEVER_L, 1);
  assert.equal(levers.FUEL_LEVER_L, 1);
  assert.equal(levers.FLAP_SELECTOR, 0);
});

test("tap semantics follow the interaction layer: toggle, three-position fraction and momentary", () => {
  assert.equal(switchModeFor(switchHb("BATTERY_MASTER")), "TOGGLE");
  assert.equal(switchModeFor(switchHb("CAUT_LT_TEST")), "MOMENTARY", "TEST/PUSH/START ids are momentary");
  assert.equal(switchModeFor(switchHb("L_DC_GEN", { switchMode: "three-position switch" })), "THREE_POS");

  const three = switchHb("L_DC_GEN", { switchMode: "3pos", switchAxis: "VERTICAL" });
  assert.equal(nextSwitchState(three, "CENTER", 0.5, 0.1).state, "LEFT");
  assert.equal(nextSwitchState(three, "CENTER", 0.5, 0.5).state, "CENTER");
  assert.equal(nextSwitchState(three, "CENTER", 0.5, 0.9).state, "RIGHT");
  const horizontal = switchHb("AILERON_TRIM", { switchMode: "3pos", switchAxis: "HORIZONTAL" });
  assert.equal(nextSwitchState(horizontal, "CENTER", 0.1, 0.5).state, "LEFT");

  const toggle = switchHb("FWD_BOOST_PUMP");
  assert.equal(nextSwitchState(toggle, "RIGHT", 0.5, 0.5).state, "LEFT");
  assert.equal(nextSwitchState(toggle, "LEFT", 0.5, 0.5).state, "RIGHT");
  const momentary = switchHb("CAUT_LT_TEST", { momentaryReturnMs: 500 });
  assert.deepEqual(nextSwitchState(momentary, "CENTER", 0.5, 0.5), { state: "MOMENTARY", releaseTo: "CENTER", releaseMs: 500 });
});

test("the interaction controller emits control events and clamps lever positions", () => {
  const ctl = createInteractionController();
  const events = [];
  ctl.onControlEvent((e) => events.push(e));
  ctl.tapHitbox(switchHb("FWD_BOOST_PUMP"), 0.5, 0.5);
  assert.equal(ctl.getSwitchState("FWD_BOOST_PUMP"), "LEFT");
  assert.equal(events[0].kind, "switch");
  assert.equal(events[0].priorState, "RIGHT");
  assert.equal(ctl.setLever("POWER_LEVER_L", 5), 1, "lever positions clamp to 0..1");
  assert.equal(ctl.setLever("POWER_LEVER_L", -5), 0);
  ctl.applySnapshot({ switchStates: { FWD_BOOST_PUMP: "RIGHT" }, leverPositions: { POWER_LEVER_L: 0.5 } });
  assert.equal(ctl.getSwitchState("FWD_BOOST_PUMP"), "RIGHT");
  assert.equal(ctl.leverPositions.POWER_LEVER_L, 0.5);
  ctl.reset();
  assert.equal(ctl.leverPositions.POWER_LEVER_L, FLIGHT_IDLE_GATE_01);
  ctl.dispose();
});

/* ====================================================== scenarios.js */
test("scenario contexts, titles and phases follow ScenarioProceduresScreen", () => {
  assert.equal(CONTEXTS.length, 6);
  assert.equal(contextByRouteKey("ground_start").key, "GROUND_START");
  assert.equal(contextByRouteKey("nonsense").key, "CRUISE", "the fallback context is cruise");
  assert.equal(cleanScenarioProcedureTitle("Engine Fire in Flight [Airborne]"), "Engine Fire in Flight");
  assert.equal(cleanScenarioProcedureTitle("Something [Series 300]"), "Something [Series 300]", "an unknown bracket tag is kept");
  assert.equal(inferNormalBucket("Caution Light Test"), "System Tests");
  assert.equal(inferNormalBucket("Crosswind Take-off"), "Weather / Special Conditions");
  assert.equal(inferNormalBucket("Before Start"), "Everyday Actions");
  assert.equal(inferScenarioPhase("Engine Failure During Start", "EMERGENCY"), "Ground");
  assert.equal(inferScenarioPhase("Engine Fire in Flight", "EMERGENCY"), "Airborne");
  assert.equal(inferScenarioPhase("Cockpit or Cabin Smoke", "EMERGENCY"), "Ground/Airborne");
  assert.equal(inferProcedureGroup("Engine Fire in Flight", "EMERGENCY"), "Fire / Smoke");
  assert.equal(inferProcedureGroup("Generator Failure", "ABNORMAL"), "Electrical");
  assert.equal(inferProcedureGroup("Something Else", "NORMAL"), "Normal Operations");
  assert.equal(scenarioTileArt("Taxi"), "procedure_tile_taxi");
  assert.equal(scenarioTileArt("Cockpit Preparation"), "dhc6_tile_apron_departure");
  assert.equal(scenarioTileArt("Whatever"), "procedure_tile_scenarios");
});

test("the Day-to-Day list filters by context, category and search, and sorts by the published order", () => {
  const items = [
    { id: "a", category: "NORMAL", displayTitle: "Before Starting Engines", phaseTag: "Ground", sortOrder: 20, procedureGroup: "Engine Start / Restart" },
    { id: "b", category: "EMERGENCY", displayTitle: "Engine Fire in Flight [Airborne]", phaseTag: "Airborne", sortOrder: 10, procedureGroup: "Fire / Smoke" },
    { id: "c", category: "NORMAL", displayTitle: "Taxi", phaseTag: "Ground", sortOrder: 5, procedureGroup: "Normal Operations" }
  ];
  const ground = scenarioItems(items, "GROUND_START", "ALL", "");
  assert.deepEqual(ground.map((m) => m.id), ["c", "a"], "sorted by sortOrder, ground-phase rows only");
  assert.deepEqual(scenarioItems(items, "CRUISE", "ALL", "").map((m) => m.id), ["b"]);
  assert.deepEqual(scenarioItems(items, "GROUND_START", "EMERGENCY", "").map((m) => m.id), []);
  assert.deepEqual(scenarioItems(items, "TAXI", "ALL", "").map((m) => m.id), ["c"]);
  const meta = scenarioMetaFor(items[1]);
  assert.equal(meta.title, "Engine Fire in Flight", "the bracket suffix is stripped for display");
  assert.equal(meta.displayLabel, "Engine Fire in Flight [Airborne]");
  assert.equal(meta.bucket, "Emergency");
  assert.equal(meta.sourceSection, "POH / AFM Section 3");
  assert.equal(matchesContext(meta, "CRUISE"), true);
  assert.equal(matchesSearch(meta, "fire"), true);
  assert.equal(matchesSearch(meta, "hydraulic"), false);
  assert.deepEqual(allowedContextsFor("Engine Fire in Flight").map((c) => c.key), ["CLIMB", "CRUISE", "APPROACH_LANDING"]);
  assert.deepEqual(allowedContextsFor("Engine Fire on Ground").map((c) => c.key), ["GROUND_START"]);
  assert.equal(allowedContextsFor("").length, 6);
});

/* ======================================================= drillrun.js */
test("the drill step evaluator matches controls, states and lever positions like DrillStepEvaluator", () => {
  assert.equal(normalizeControlId(" power-lever_L "), "POWERLEVERL");
  assert.equal(switchStateSatisfiesAction("FWD_BOOST_PUMP", "RIGHT", "ON"), true);
  assert.equal(switchStateSatisfiesAction("FWD_BOOST_PUMP", "LEFT", "ON"), false);
  assert.equal(switchStateSatisfiesAction("FWD_BOOST_PUMP", "LEFT", "OFF"), true);
  assert.equal(switchStateSatisfiesAction("CAUT_LT_TEST", "MOMENTARY", "TEST"), true);
  assert.equal(switchStateSatisfiesAction("CAUT_LT_TEST", "CENTER", "OFF"), true);
  assert.equal(switchStateSatisfiesAction("SOME_LEVER", "ANY", "ON"), true, "non-binary controls are never failed on state");

  assert.equal(flapLeverPositionSatisfiesAction(0.2, "FLAPS FULL"), true);
  assert.equal(flapLeverPositionSatisfiesAction(0.9, "FLAPS FULL"), false);
  assert.equal(flapLeverPositionSatisfiesAction(0.9, "FLAPS UP"), true);
  assert.equal(powerLeverPositionSatisfiesAction(0.05, "TAKE-OFF POWER"), true, "raw 0.05 is nearly full forward");
  assert.equal(powerLeverPositionSatisfiesAction(0.5, "TAKE-OFF POWER"), false);
  assert.equal(powerLeverPositionSatisfiesAction(0.9, "IDLE"), true);
  assert.equal(requiredPositionLabelForAction("FLAPS 20"), "20°");
  assert.equal(requiredPositionLabelForAction("SWITCH OFF"), "OFF");
  assert.equal(requiredPositionLabelForAction("SOMETHING VAGUE"), "the required position");
  assert.equal(drillTargetLabel("CHECKLIST_CLOSE"), "Checklist OFF");
  assert.equal(drillTargetLabel("POWER_LEVER_L"), "Left Power Lever");
});

test("action cues separate checklist display text from mandatory cockpit actions", () => {
  assert.equal(isChecklistDisplayCue("BEFORE START CHECKLIST"), true);
  assert.equal(isChecklistDisplayCue("CHECKS COMPLETE"), false);
  assert.equal(isMandatoryCockpitActionCue("BOOST PUMPS — ON"), true);
  assert.equal(isMandatoryCockpitActionCue("BEFORE START CHECKLIST"), false);
  assert.equal(isMandatoryCockpitActionCue("AS REQUIRED"), false);
  assert.equal(isMandatoryCockpitActionCue("PITOT HEAT — ON"), true);
  assert.equal(isMandatoryCockpitActionCue("CHECKED"), false, "a callout-only response is not a cockpit action");
  assert.equal(isQuestionOrChallengeAction("Gear down?"), true);
  assert.equal(isQuestionOrChallengeAction("GEAR DOWN"), false);
});

test("drill grading matches the Android penalty table", () => {
  const clean = { wrongRoleCount: 0, wrongCalloutCount: 0, rushedCount: 0, toleranceUsedCount: 0 };
  assert.equal(GRADING.scorePercent(clean), 100);
  assert.equal(GRADING.scoreBand(clean), "EXCELLENT");
  assert.match(GRADING.remarks(clean), /Clean run/);
  const mixed = { wrongRoleCount: 1, wrongCalloutCount: 1, rushedCount: 1, toleranceUsedCount: 2 };
  assert.equal(GRADING.scorePercent(mixed), 100 - 20 - 15 - 10 - 6);
  assert.equal(GRADING.scoreBand(mixed), "FAIL", "49 % is below the unsatisfactory band");
  assert.equal(GRADING.totalErrors(mixed), 3, "tolerance use costs score but is not an error");
  assert.equal(GRADING.scoreBand({ wrongRoleCount: 0, wrongCalloutCount: 2, rushedCount: 0, toleranceUsedCount: 0 }), "MARGINAL");
  assert.equal(GRADING.scoreBand({ wrongRoleCount: 0, wrongCalloutCount: 0, rushedCount: 0, toleranceUsedCount: 2 }), "GOOD");
  assert.equal(GRADING.scoreBand({ wrongRoleCount: 5, wrongCalloutCount: 0, rushedCount: 0, toleranceUsedCount: 0 }), "FAIL");
  assert.equal(GRADING.scoreBand({ wrongRoleCount: 0, wrongCalloutCount: 0, rushedCount: 1, toleranceUsedCount: 0 }), "GOOD");
  assert.match(GRADING.instructorFeedback(clean), /Line standard/);
  assert.equal(formatDuration(45000), "45s");
  assert.equal(formatDuration(125000), "2m 05s");
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => inferredPhaseForProgress(6, i)), ["BEFORE", "BEFORE", "DURING", "DURING", "AFTER", "AFTER"]);
  assert.equal(inferredPhaseForProgress(1, 0), "BEFORE");
});

test("a drill run locks Next on a cockpit target, scores latency and writes a logbook entry", () => {
  let clock = 0;
  const steps = [
    { crewRole: "PF", callout: "Battery master", action: "BATTERY MASTER — ON", targets: ["BATTERY_MASTER"] },
    { crewRole: "PM", callout: "Boost pumps", action: "FWD BOOST PUMP — ON", targets: ["FWD_BOOST_PUMP"] },
    { crewRole: "PF", callout: "Checklist", action: "BEFORE START CHECKLIST" }
  ];
  const actionable = ["BATTERY_MASTER", "FWD_BOOST_PUMP"];
  const entries = [];
  const run = createDrillRun({
    procedureId: "NORMAL/Before Start", procedureName: "Before Start", category: "NORMAL", variant: "LEGACY", traineeRole: "PF",
    steps: steps, now: () => clock,
    resolveHitboxes: (ids) => ids,
    resolveActionableHitboxes: (ids) => ids.filter((id) => actionable.includes(id)),
    onComplete: (entry) => entries.push(entry)
  });
  run.start();
  assert.equal(run.state.stepIndex, 0);
  assert.deepEqual(run.state.expectedIds, ["BATTERY_MASTER"]);
  assert.equal(run.nextLocked(), true, "the trainee must operate the control before Next unlocks");
  assert.equal(run.advanceManually(), false);
  assert.match(run.state.status, /Locked until/);

  // wrong control, then the right one in the wrong position, then correct
  run.handleControlEvent({ kind: "switch", controlId: "STBY_BATTERY", newState: "LEFT" }, {}, {});
  assert.match(run.state.feedback, /Not that one/);
  run.handleControlEvent({ kind: "switch", controlId: "BATTERY_MASTER", newState: "LEFT" }, {}, {});
  assert.match(run.state.status, /Move Battery Master to ON/);
  assert.equal(run.state.stepIndex, 0, "a wrong position does not advance");
  clock = 2000;
  run.handleControlEvent({ kind: "switch", controlId: "BATTERY_MASTER", newState: "RIGHT" }, {}, {});
  assert.equal(run.state.stepIndex, 1);

  // step 2 belongs to the PM, so it is a callout line for a PF trainee — Next is free
  assert.equal(run.isOppositeRoleLine(run.current()), true);
  assert.equal(run.nextLocked(), false);
  clock = 12000;
  assert.equal(run.advanceManually(), true);
  assert.equal(run.state.stepIndex, 2);
  assert.equal(run.state.rushedCount, 0, "manual advances do not count as timing deviations");

  // the last step is a checklist display cue, resolved to the CHECKLIST pseudo-target
  assert.deepEqual(run.state.focusIds, ["CHECKLIST"]);
  assert.equal(run.advanceManually(), true);
  assert.equal(run.state.completed, true);
  assert.equal(run.state.finalScorePercent, 100);
  assert.equal(run.state.finalScoreBand, "EXCELLENT");
  assert.equal(entries.length, 1);
  const entry = entries[0];
  assert.equal(entry.procedureName, "Before Start");
  assert.equal(entry.totalSteps, 3);
  assert.equal(entry.aircraftVariant, "LEGACY");
  assert.equal(entry.kind, "scenario-drill");
  assert.equal(entry.scorePercent, 100);
  assert.equal(run.phase(), "AFTER");

  run.restart();
  assert.equal(run.state.stepIndex, 0);
  assert.equal(run.state.completed, false);
  assert.deepEqual(run.state.stepLatencies, []);
});

test("a control that is already in the required position asks for a confirm instead of a toggle", () => {
  const run = createDrillRun({
    procedureId: "NORMAL/Before Start", procedureName: "Before Start", traineeRole: "PF",
    steps: [{ crewRole: "PF", action: "FWD BOOST PUMP — ON", targets: ["FWD_BOOST_PUMP"] }],
    resolveActionableHitboxes: (ids) => ids
  });
  run.start();
  run.checkAlreadyCorrect({ FWD_BOOST_PUMP: "RIGHT" });
  assert.ok(run.state.alreadyCorrect);
  assert.match(run.state.status, /already ON/);
  run.confirmAlreadyCorrect();
  assert.equal(run.state.completed, true);
});

/* ======================================================= bindings.js */
test("the hitbox index resolves aliases and filters to actionable controls", () => {
  const hitboxes = [
    switchHb("FWD_BOOST_PUMP", { action: "BOOST_PUMP_FWD" }),
    hb("TORQUE_GAUGE_L", { type: "instrument", binding: { kind: "instrument", instrumentId: "TORQUE_L" } })
  ];
  const index = createHitboxIndex(hitboxes);
  assert.deepEqual(index.resolve(["FWD_BOOST_PUMP"]), ["FWD_BOOST_PUMP"]);
  assert.deepEqual(index.resolve(["boost pump fwd"]), ["FWD_BOOST_PUMP"], "the action alias resolves to the hitbox");
  assert.deepEqual(index.resolve(["TORQUE_L"]), ["TORQUE_GAUGE_L"]);
  assert.deepEqual(index.resolve(["NOPE", ""]), []);
  assert.deepEqual(index.resolveActionable(["FWD_BOOST_PUMP", "TORQUE_L"]), ["FWD_BOOST_PUMP"], "gauges are not actionable");
});

test("procedure bindings load in the Android file order and fall back through step text", () => {
  const hitboxes = [switchHb("FWD_BOOST_PUMP"), switchHb("BATTERY_MASTER"), switchHb("STARTER_SWITCH")];
  const pack = { files: [
    { file: "procedure_cockpit_bindings", data: { bindings: [{ procedureId: "BEFORE_START", title: "Before Start", stepBindings: [
      { rawText: "BATTERY MASTER — ON", hitboxIds: ["BATTERY_MASTER"] },
      { rawText: "FWD BOOST PUMP — ON", hitboxIds: ["FWD_BOOST_PUMP"] }
    ] }] } },
    { file: "procedure_cockpit_bindings_legacy", data: { procedure: { procedureId: "STARTING", title: "Starting Engines", steps: [
      { rawText: "STARTER — PRESS", controls: [{ refType: "HITBOX", refId: "STARTER_SWITCH" }, { refType: "TEXT", refId: "ignore me" }] }
    ] } } },
    { file: "qrh_cockpit_bindings", data: { bindings: [{ qrhId: "QRH_FIRE", targets: [{ type: "HITBOX", id: "BATTERY_MASTER" }] }] } }
  ] };
  const index = createBindingsIndex(pack, "LEGACY", hitboxes);
  assert.deepEqual(index.lookup("Before Start", "BATTERY MASTER — ON"), ["BATTERY_MASTER"], "exact step match");
  assert.deepEqual(index.lookup("BEFORE_START", "FWD BOOST PUMP - ON"), ["FWD_BOOST_PUMP"], "punctuation is normalised away");
  assert.deepEqual(index.lookup("Starting Engines", "STARTER — PRESS"), ["STARTER_SWITCH"], "the legacy procedure schema is parsed");
  assert.deepEqual(index.lookup("QRH_FIRE", "QRH_FIRE"), ["BATTERY_MASTER"], "the QRH target schema is parsed");
  assert.deepEqual(index.lookup("Unknown Procedure", "BATTERY MASTER — ON"), ["BATTERY_MASTER"], "unknown procedures fall back to the step-text index");
  assert.deepEqual(index.lookup("", "anything"), []);
  assert.deepEqual(index.lookup("Before Start", "SOMETHING ENTIRELY DIFFERENT"), []);
  assert.deepEqual(createBindingsIndex({ files: [] }, "G950", hitboxes).lookup("Before Start", "BATTERY MASTER — ON"), []);
});

/* ===================================================== stateeditor.js */
test("Edit State canonical keys and the annunciator alias table match the Android editor", () => {
  assert.equal(canonicalKey(" l dc gen "), "L_DC_GEN");
  assert.equal(canonicalKey("Ng L"), "NG_L");
  assert.equal(canonicalKey("---"), "");
  assert.equal(stripAnnunciatorStateSuffix("L Gen Fail (caution)"), "L Gen Fail");
  assert.equal(stripAnnunciatorStateSuffix("Doors Unlocked"), "Doors Unlocked");
  assert.equal(canonicalAnnunciatorKey("L Gen Fail (caution)"), "L_GEN_FAIL");
  assert.equal(canonicalAnnunciatorKey("L_GENERATOR"), "L_GEN_FAIL", "legacy lamp ids fold onto the CAS id");
  assert.equal(canonicalAnnunciatorKey("400_CYCLE_LIGHT"), "AC_400_CYCLE");
  assert.equal(canonicalAnnunciatorKey("Boost Pump 1 Fwd Press"), "FWD_BOOST1_PR");
  assert.equal(humanLabel("L_GEN_FAIL"), "L Gen Fail");
  assert.equal(isAnnunciatorOverrideControl("Snapshot Annunciators Override"), true);
  assert.equal(isAnnunciatorOverrideControl("Power Lever L"), false);
});

test("Edit State option tables reproduce the Android gauge ranges and lever choices", () => {
  const empty = { annunciators: [], instruments: {}, controls: {} };
  const instruments = buildInstrumentOptions(empty);
  const ng = instruments.find((o) => o.key === "NG_L");
  assert.deepEqual([ng.defaultValue, ng.step, ng.minimum, ng.maximum, ng.style], ["52", 1, 0, 105, STYLE.NUMERIC_STEPPER]);
  const np = instruments.find((o) => o.key === "NP_R");
  assert.deepEqual([np.step, np.maximum], [0.5, 101.5]);
  assert.equal(instruments.find((o) => o.key === "WOW").style, STYLE.VALUE_ON_OFF);
  assert.equal(instruments.find((o) => o.key === "HYDRAULIC_PRESS_GAUGE").maximum, 2500);

  const controls = buildControlOptions(empty);
  const power = controls.find((o) => o.key === "POWER_LEVER_L");
  assert.deepEqual(power.choices, ["REVERSE", "IDLE", "DESCENT", "CRUISE", "CLIMB", "MAX"]);
  assert.equal(power.defaultValue, "IDLE");
  assert.deepEqual(controls.find((o) => o.key === "PROP_LEVER_L").choices, ["FEATHER", "COARSE", "FINE"]);
  assert.deepEqual(controls.find((o) => o.key === "FLAPS").choices, ["0", "10", "20", "30", "37.5"]);
  assert.deepEqual(controls.find((o) => o.key === "CROSSFEED").choices, ["FWRD", "NEUTRAL", "AFT"]);
  assert.equal(controls.find((o) => o.key === "L_DC_GEN").style, STYLE.VALUE_ON_OFF);

  const annunciators = buildAnnunciatorOptions({ annunciators: ["L Gen Fail (caution)"], instruments: {}, controls: {} });
  assert.ok(annunciators.length >= 54);
  assert.equal(annunciators[0].category, "Warnings", "sorted by CAS priority rank");
  assert.ok(annunciators.some((o) => o.key === "L_GEN_FAIL"));

  // an unknown current value becomes a "Current custom …" row rather than being lost
  const withCustom = buildControlOptions({ annunciators: [], instruments: {}, controls: { "Nose Wheel Steering": "ON" } });
  const custom = withCustom.find((o) => o.key === "NOSE_WHEEL_STEERING");
  assert.equal(custom.category, "Current custom controls");
  assert.equal(custom.label, "Nose Wheel Steering");
  const customAnn = buildAnnunciatorOptions({ annunciators: ["SOME_OPERATOR_LAMP"], instruments: {}, controls: {} });
  assert.ok(customAnn.some((o) => o.key === "SOME_OPERATOR_LAMP" && o.category === "Current custom items"));
});

test("Edit State loads the existing phase values and coerces junk back to the default", () => {
  const phaseState = { annunciators: ["L Gen Fail (caution)"], instruments: { "Ng L": "61", "Torque L": "12 PSI" }, controls: { "Power Lever L": "CRUISE", "Flaps": "10" } };
  const instruments = buildInstrumentOptions(phaseState);
  const values = initialValues("INSTRUMENTS", phaseState, instruments);
  assert.equal(values.NG_L, "61", "an existing value wins over the default");
  assert.equal(values.TORQUE_L, "12", "the number is extracted from a unit string");
  assert.equal(values.NG_R, "52", "untouched gauges keep the Android default");

  const controls = buildControlOptions(phaseState);
  const controlValues = initialValues("CONTROLS", phaseState, controls);
  assert.equal(controlValues.POWER_LEVER_L, "CRUISE");
  assert.equal(controlValues.FLAPS, "10");
  assert.equal(controlValues.PROP_LEVER_L, "FEATHER");

  assert.deepEqual([...initialEnabledKeys("ANNUNCIATORS", phaseState, buildAnnunciatorOptions(phaseState))], ["L_GEN_FAIL"]);
  assert.equal(initialEnabledKeys("CONTROLS", phaseState, controls).size, controls.length, "instrument/control rows are all live; only annunciators toggle");

  const numeric = { key: "NG_L", defaultValue: "52", style: STYLE.NUMERIC_STEPPER, step: 1, minimum: 0, maximum: 105, choices: [] };
  assert.equal(coerceValue(numeric, "nonsense"), "52");
  assert.equal(coerceValue(numeric, "88.5"), "88.5");
  const choice = { key: "FLAPS", defaultValue: "0", style: STYLE.ORDERED_STEPPER, choices: ["0", "10", "20"], step: 1 };
  assert.equal(coerceValue(choice, "10"), "10");
  assert.equal(coerceValue(choice, "45"), "0", "a value outside the choice list falls back");
  const onOff = { key: "PITOT_HEAT", defaultValue: "OFF", style: STYLE.VALUE_ON_OFF, choices: [] };
  assert.equal(coerceValue(onOff, "on"), "ON");
  assert.equal(coerceValue(onOff, "maybe"), "OFF");
});

test("Edit State steppers clamp at the Android bounds", () => {
  const ng = { key: "NG_L", defaultValue: "52", style: STYLE.NUMERIC_STEPPER, step: 1, minimum: 0, maximum: 105, choices: [] };
  assert.equal(stepNumeric(ng, "52", 1), "53");
  assert.equal(stepNumeric(ng, "105", 1), "105", "clamped at the maximum");
  assert.equal(stepNumeric(ng, "0", -1), "0", "clamped at the minimum");
  const np = { key: "NP_L", defaultValue: "82", style: STYLE.NUMERIC_STEPPER, step: 0.5, minimum: 0, maximum: 101.5, choices: [] };
  assert.equal(stepNumeric(np, "82", 1), "82.5");
  assert.equal(stepNumeric(np, "101.5", 1), "101.5");
  const flaps = { key: "FLAPS", defaultValue: "0", style: STYLE.ORDERED_STEPPER, choices: ["0", "10", "20", "30", "37.5"], step: 1 };
  assert.equal(stepOrdered(flaps, "0", -1), "0");
  assert.equal(stepOrdered(flaps, "20", 1), "30");
  assert.equal(stepOrdered(flaps, "37.5", 1), "37.5");
  assert.equal(stepOrdered(flaps, "not a flap setting", 1), "10", "an unknown value steps from the first choice");
  assert.equal(formatNumber(53), "53");
  assert.equal(formatNumber(82.5), "82.5");
  assert.equal(extractNumber("1600 PSI"), 1600);
  assert.equal(extractNumber("none"), null);
});

test("saving a section rewrites only that section and sets the annunciator override flag", () => {
  const phaseState = { annunciators: ["L Gen Fail (caution)"], instruments: { "Ng L": "61" }, controls: { "Power Lever L": "CRUISE" }, notes: "keep me" };

  const annOptions = buildAnnunciatorOptions(phaseState);
  const ann = withToggleSelection(phaseState, "ANNUNCIATORS", annOptions, new Set(["L_GEN_FAIL", "R_GEN_FAIL"]), {});
  assert.deepEqual(ann.annunciators, ["L_GEN_FAIL", "R_GEN_FAIL"]);
  assert.equal(ann.controls[SCENARIO_ANNUNCIATOR_OVERRIDE_KEY], "ON", "an explicit annunciator edit wins over the baseline");
  assert.equal(ann.instruments["Ng L"], "61", "the other sections are untouched");
  assert.equal(ann.notes, "keep me");

  const ctlOptions = buildControlOptions(phaseState);
  const ctlValues = initialValues("CONTROLS", phaseState, ctlOptions);
  ctlValues.POWER_LEVER_L = "MAX";
  const ctl = withToggleSelection(ann, "CONTROLS", ctlOptions, new Set(), ctlValues);
  assert.equal(ctl.controls.POWER_LEVER_L, "MAX");
  assert.equal(ctl.controls[SCENARIO_ANNUNCIATOR_OVERRIDE_KEY], "ON", "the override flag survives a control edit");
  assert.equal(ctl.controls["Power Lever L"], undefined, "the humanized duplicate is replaced by the canonical key");
  assert.deepEqual(ctl.annunciators, ["L_GEN_FAIL", "R_GEN_FAIL"]);
});

test("the saved override payload is in the shape the snapshot registry reads back", () => {
  const phaseState = { annunciators: ["L_GEN_FAIL", "L Gen Fail (caution)"], instruments: { NG_L: "61", EMPTY: "  " }, controls: { POWER_LEVER_L: "MAX" }, notes: " brief the crew " };
  const payload = phaseOverridePayload(phaseState);
  assert.deepEqual(payload.annunciators, [{ id: "L_GEN_FAIL", level: "ON" }], "duplicates collapse and bare strings never reach the registry (QUIRK-4)");
  assert.deepEqual(payload.instruments, { NG_L: "61" }, "blank values are dropped");
  assert.deepEqual(payload.controls, { POWER_LEVER_L: "MAX" });
  assert.equal(payload.notes, " brief the crew ");

  // round-trip: the registry must resolve the override back into a usable phase
  const registry = createSnapshotRegistry(
    { data: { baselines: { g950: { controls: {}, instruments: {}, annunciators: [] } }, procedures: { "NORMAL/Before Start": { variant: "BOTH", phases: { before: { controls: {} } } } } } },
    { "NORMAL/Before Start": { phases: { BEFORE: payload } } }
  );
  const resolved = registry.resolve("NORMAL/Before Start", "BOTH", "BEFORE");
  assert.deepEqual(resolved.annunciators.map((a) => a.id), ["L_GEN_FAIL"]);
  assert.equal(resolved.controls.POWER_LEVER_L, "MAX");
  assert.equal(resolved.instruments.NG_L, "61");
  // and the cockpit reads the canonical control keys the editor writes
  assert.equal(snapshotLeverPositions(resolved.controls).POWER_LEVER_L, 0);
  assert.equal(snapshotSwitchStates({ L_DC_GEN: "OFF" }).L_DC_GEN, "RIGHT", "canonical switch ids resolve as well as spaced labels");
  assert.equal(snapshotSwitchStates({ "Generator L": "OFF" }).L_DC_GEN, "RIGHT");
});

test("explicit snapshot annunciators light the right lamp (parsed entries are objects, not ids)", () => {
  function lamps(annunciators, variant) {
    const snapshot = parseSnapshot({ controls: { "Snapshot Annunciators Override": "ON" }, instruments: {}, annunciators: annunciators });
    const visual = snapshotVisualState(snapshot, variant || "LEGACY");
    return { lit: Object.keys(visual.annunciators).filter((k) => visual.annunciators[k]), cas: visual.casMessages };
  }
  // Regression: parseSnapshot yields { id, level } objects. Reading the object as an
  // id produced the lamp "OBJECT_OBJECT", so nothing ever lit on the plate.
  const genFail = lamps([{ id: "L_GEN_FAIL", level: "ON" }]);
  assert.deepEqual(genFail.lit, ["MASTER_CAUTION", "L_GENERATOR"], "the CAS id maps onto the legacy lamp host");
  assert.deepEqual(genFail.cas, ["L GEN FAIL"]);
  assert.equal(genFail.lit.some((k) => /OBJECT/.test(k)), false);

  assert.deepEqual(lamps([{ id: "L_GENERATOR", level: "CAUTION" }]).lit, ["MASTER_CAUTION", "L_GENERATOR"], "the legacy lamp id resolves too");
  assert.deepEqual(lamps([{ id: "L_ENG_FIRE", level: "WARNING" }]).lit, ["MASTER_WARNING", "L_ENG_FIRE"]);
  assert.deepEqual(lamps([{ id: "L_GEN_FAIL", level: "ON" }], "G950").lit, ["MASTER_CAUTION", "L_GEN_FAIL"], "the G950 plate uses the CAS id directly");

  // an operator-specific lamp the CAS catalogue does not know keeps the snapshot's level
  assert.deepEqual(lamps([{ id: "OPERATOR_SPECIFIC", level: "WARNING" }]).lit, ["MASTER_WARNING", "OPERATOR_SPECIFIC"]);
  // …but the catalogue wins for an id it does know
  assert.deepEqual(lamps([{ id: "L_GEN_FAIL", level: "WARNING" }]).lit, ["MASTER_CAUTION", "L_GENERATOR"], "L GEN FAIL is a CAUTION in the catalogue");

  // turning every annunciator off leaves the panel dark
  const none = lamps([]);
  assert.deepEqual(none.lit, [], "an explicit empty list means no lamps, not the derived set");
});
