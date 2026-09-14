import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { selectorMatches, clipSelectorMatches, chainMatches, labSimulation, powerLeverLabel, propLeverLabel, qrhCategoryTargetFor, qrhTargetHref, pinsForModel, clipGroupsForModel, modelsForSystem, formatBytes } from "../app/js/logic/systemslab.js";
import { buildSystemsLabPack, readDefinitions, readSimulation, readHome, readDisplayTitles } from "../tools/lib/systems-lab.mjs";
import { parseValue, findCalls, whenCases, functionBody, valDeclaration, stripComments } from "../tools/lib/kotlin-lite.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = path.join(root, "tests", "fixtures", "android-kotlin");
const registry = JSON.parse(fs.readFileSync(path.join(root, "tools", "data", "systems-lab-models.json"), "utf8"));

function fixturePack() {
  return buildSystemsLabPack({
    sectionSource: fs.readFileSync(path.join(fixtures, "feature-knowledge", "SystemsLabSection.kt"), "utf8"),
    homeSource: fs.readFileSync(path.join(fixtures, "feature-knowledge", "SystemsLabHomeScreen.kt"), "utf8"),
    aircraftSystemSource: fs.readFileSync(path.join(fixtures, "domain", "AircraftSystem.kt"), "utf8"),
    registry: registry
  });
}

/* ------------------------------------------------------------ selectors */
test("node selectors follow the Android region-map semantics", () => {
  assert.equal(selectorMatches("PT6A27_AGB", "PT6A27_AGB_INPUT_GEARSHAFT"), true);
  assert.equal(selectorMatches("PT6A27_AGB", "PT6A27_AGB"), true);
  assert.equal(selectorMatches("PT6A27_AGB", "PT6A27_AGBX_FOO"), false, "prefix needs a separator");
  assert.equal(selectorMatches("AC_Compressor", "AC_Compressor_Motor"), true, "plain prefix matches sub-parts (Android rule)");
  assert.equal(selectorMatches("=AC_Compressor", "AC_Compressor_Motor"), false, "exact selector does not");
  assert.equal(selectorMatches("=AC_Compressor", "AC_Compressor.001"), true, "Blender .NNN suffix is ignored");
  assert.equal(selectorMatches("~^[LR]H_MAIN_BRAKE", "RH_MAIN_BRAKE_HOUSING_9550376"), true);
  assert.equal(selectorMatches("~^[LR]H_MAIN_BRAKE", "NOSE_BRAKE"), false);
  assert.equal(selectorMatches("~(", "anything"), false, "invalid regex never matches");
  assert.equal(chainMatches(["=CSU_ARCHIVE_R4"], ["WOODWARD_8210_FLYWEIGHT", "ANIM_PIVOT_FLYWEIGHT_01", "CSU_ARCHIVE_R4"]), true, "ancestor names count");
});

test("a clip label or group always refers to a clip the entry declares", () => {
  /*
    The rot this catches is invisible in the app. `clipGroupsForModel` matches
    labels and groups against `animations`, so a label whose key is not in that
    list is simply never applied - no error, no warning, just auto-derived text
    where somebody wrote a proper one. Five labels had been silently inert
    across flap-system and trim-control because a re-export appended ".001" to
    the clip names and the label keys were never followed along.

    It is also the cheap half of the check the GLB inspector does against real
    files: this needs no models, so it runs everywhere, forever.
  */
  const stale = [];
  for (const model of registry.models) {
    const declared = new Set(model.animations || []);
    Object.keys(model.clips || {}).forEach((key) => {
      if (!declared.has(key)) stale.push(model.id + ": label for undeclared clip " + key);
    });
    Object.entries(model.clipGroups || {}).forEach(([label, selectors]) => {
      const alive = (model.animations || []).some((name) =>
        (selectors || []).some((s) => clipSelectorMatches(s, name)));
      if (!alive) stale.push(model.id + ": group '" + label + "' matches none of its declared clips");
    });
  }
  assert.deepEqual(stale, [], "a label or group nobody can reach is authored text the Lab never shows");
});

test("every registry selector is well formed and every model has a media path, hash and size", () => {
  assert.ok(registry.models.length >= 21);
  const ids = new Set();
  for (const model of registry.models) {
    assert.ok(!ids.has(model.id), "duplicate model id " + model.id); ids.add(model.id);
    assert.match(model.mediaPath, /^models\/systems-lab\/[A-Za-z0-9_.-]+\.glb$/);
    assert.match(model.sha256, /^[0-9a-f]{64}$/);
    assert.ok(model.bytes > 1000);
    assert.ok(["reference-library", "android-bundled"].includes(model.source));
    const all = [].concat(model.hidden || [], ...Object.values(model.parts || {}), ...(model.extraParts || []).map((e) => e.selectors));
    for (const sel of all) {
      assert.equal(typeof sel, "string");
      if (sel[0] === "~") assert.doesNotThrow(() => new RegExp(sel.slice(1), "i"), "bad regex " + sel);
    }
  }
  const files = registry.models.map((m) => m.file);
  for (const expected of ["PT6A27_ENGINE_REPLICA.glb", "DHC6_PT6A27_WOODWARD_CSU_REPLICA.glb", "DHC6_PT6A27_WOODWARD_OSG_REPLICA.glb", "THREE_BLADE_HARTZELL.glb", "FUEL_SYSTEM.glb", "DHC6_STARTER_GENERATOR_REPLICA.glb", "HYDRAULIC_SYSTEM_PACK_REPLICA.glb", "DHC6_FLAP_SYSTEM_REPLICA.glb", "DHC6_TRIM_REPLICA.glb", "AIR-CONDITIONNG.glb", "DHC6_PT6A27_BLEED_VALVE_REPLICA.glb", "DHC6_PTA27_OIL_TO_FUEL_HEATER_MASTER.glb", "DHC6_PT6A27_FUEL_PUMP_MASTER.glb", "DHC6_PT6A27_FCU_REPLICA.glb", "DHC6WHEELS.glb", "DHC6SKIS.glb", "DHC6FLOATS.glb", "DHC6_LANDPLANE_UNDERCARRIAGE_REPLICA.glb"]) {
    assert.ok(files.includes(expected), "reference-library model missing from registry: " + expected);
  }
  const bigOnes = registry.models.filter((m) => m.bytes > 25 * 1024 * 1024).map((m) => m.file);
  assert.deepEqual(bigOnes, ["PT6A27_ENGINE_REPLICA.glb", "DHC6_LANDPLANE_UNDERCARRIAGE_REPLICA.glb"], "models above the KV value limit must go to R2");
});

/*
  How `flap-system` came to ship a 243 KB Android stub in place of the 7 MB
  replica: the registry asked for FLAP_SYSTEM.glb, no such file existed in the
  reference library, and Windows matched core-res/.../models/flap_system.glb
  case-insensitively. The build logged HASH-CHANGED and published it anyway.

  The test that would have caught it is not "does this filename look right" -
  it is that no two entries can resolve to one file on a case-insensitive
  filesystem, and that no two entries claim the same bytes.
*/
test("no two registry entries can resolve to the same file", () => {
  const seen = new Map();
  for (const model of registry.models) {
    const key = model.file.toLowerCase();
    assert.ok(!seen.has(key), "two entries resolve to " + model.file + " on a case-insensitive filesystem: " + seen.get(key) + " and " + model.id);
    seen.set(key, model.id);
  }
  const hashes = new Map();
  for (const model of registry.models) {
    assert.ok(!hashes.has(model.sha256), "identical sha256 on " + hashes.get(model.sha256) + " and " + model.id + " - one was copied, not measured");
    hashes.set(model.sha256, model.id);
  }
});

/*
  A `hidden` rule exists to drop donor geometry the replica carried in - a
  pilot figure, a radio head. A rule that also catches something the same model
  selects as a part is a contradiction: the part would be authored, requested
  and then not drawn.
*/
test("a hidden rule never catches a part the same model selects", () => {
  for (const model of registry.models) {
    const hidden = (model.hidden || [])
      .filter((s) => s[0] === "~")
      .map((s) => ({ source: s, rule: new RegExp(s.slice(1), "i") }));
    if (!hidden.length) continue;
    const selectors = [].concat(...Object.values(model.parts || {}), ...(model.extraParts || []).map((e) => e.selectors));
    for (const selector of selectors) {
      const name = selector.replace(/^[=~]/, "");
      for (const entry of hidden) {
        assert.equal(entry.rule.test(name), false, model.id + ": hidden rule " + entry.source + " also catches the selected part " + selector);
      }
    }
  }
});

/* --------------------------------------------------------- kotlin-lite */
test("kotlin-lite reads literals, lists, calls and when-branches", () => {
  assert.deepEqual(parseValue('listOf("a", "b, c")'), ["a", "b, c"]);
  assert.equal(parseValue("0.755f"), 0.755);
  assert.equal(parseValue('"esc \\"q\\" \\n"'), 'esc "q" \n');
  assert.deepEqual(parseValue("AircraftSystem.FUEL"), { ident: "AircraftSystem.FUEL" });
  const calls = findCalls('x = listOf(LabPart("a", "L", "p", 0.1f, 0.2f, "k", "c"), LabPart("b", "M", "q", 0.3f, 0.4f, "k2", "c2"))', "LabPart");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].args.map((a) => a.value), ["b", "M", "q", 0.3, 0.4, "k2", "c2"]);
  const cases = whenCases('\n    AircraftSystem.A, AircraftSystem.B -> "x"\n    AircraftSystem.C -> {\n        val n = when {\n            a < 1 -> "inner"\n            else -> "inner else"\n        }\n        "outer $n"\n    }\n    else -> 0.46f\n');
  assert.equal(cases.cases.length, 2);
  assert.deepEqual(cases.cases[0].keys, ["AircraftSystem.A", "AircraftSystem.B"]);
  assert.equal(cases.elseRaw, "0.46f", "nested else must not terminate the outer when");
  const src = stripComments('private val order = listOf(\n    AircraftSystem.X, // comment\n    AircraftSystem.Y\n)\nprivate fun f(s: S): String = when (s) {\n    S.A -> "a"\n    else -> "z"\n}');
  assert.equal(valDeclaration(src, "order").replace(/\s+/g, ""), "listOf(AircraftSystem.X,AircraftSystem.Y)");
  assert.match(functionBody(src, "f"), /S\.A -> "a"/);
});

/* ------------------------------------------------------------ pack build */
test("the systems-lab pack is built from the Kotlin fixtures and the registry", () => {
  const pack = fixturePack();
  assert.equal(pack.id, "systems-lab");
  assert.deepEqual(pack.order, ["POWERPLANT", "PROPELLER", "FUEL", "AIR_CONDITIONING", "EXHAUST"], "trailing comments inside listOf() are ignored");
  assert.deepEqual(pack.labSystems, ["POWERPLANT", "PROPELLER", "FUEL", "AIR_CONDITIONING"], "only MODEL_3D_READY systems reach the lab home");
  const pp = pack.systems.POWERPLANT;
  assert.equal(pp.objectTitle, "PT6A-27 powerplant — engine-only training model");
  assert.equal(pp.parts.length, 3);
  assert.deepEqual(pp.parts[0], { id: "air_inlet_case", label: "Air inlet case", notePrompt: "Note: What is the first airflow reference point?", normalizedX: 0.755, normalizedY: 0.4, keyFact: "The inlet case guides air into the PT6 compressor path.", consequence: "Restriction can reduce available power." });
  assert.equal(pp.faults.length, 2);
  assert.equal(pp.faults[1].id, "engine_fire");
  assert.equal(pp.faults[1].evidenceStatus, "Training simulation. Confirm aircraft-specific response with approved operator and maintenance data.");
  assert.equal(pp.androidModelAsset.assetPath, "models/systems_lab/models/pt6a27_cutaway_user.glb");
  assert.deepEqual(pp.models, ["pt6a27-engine"]);
  assert.equal(pp.shortTitle, "Powerplant");
  assert.equal(pp.initialPowerLever, 0.82);
  assert.equal(pp.initialPropLever, 1);
  assert.match(pp.trainingBridge, /^QRH: Engine failure/);
  assert.equal(pack.systems.FUEL.initialPowerLever, 0.46);
  assert.equal(pack.systems.FUEL.shortTitle, "Fuel");
  assert.equal(pack.systems.AIR_CONDITIONING.shortTitle, "Air Conditioning");
  assert.equal(pack.systems.EXHAUST.objectTitle, "Exhaust", "system.displayTitle() resolves to the enum title");
  assert.equal(pack.systems.EXHAUST.parts[0].label, "Exhaust");
  assert.deepEqual(pack.systems.PROPELLER.models, ["woodward-csu", "woodward-osg", "hartzell-propeller"]);
  assert.equal(pack.systems.LANDING_GEAR_SKI.variantLine.startsWith("Ski variant"), true);
  assert.equal(pack.explorer.explorerSystems.length, 4);
  assert.deepEqual(pack.explorer.hotspots[0], { id: "PROP_L", system: "PROPELLER", label: "Propeller", fx: 0.32, fy: 0.56, fz: 0.14 });
  assert.equal(pack.displayTitles.ENGINE_FUEL_CONTROL, "Engine Fuel and Control");
  assert.equal(pack.registry.models.length, registry.models.length);
});

test("the simulation branches, templates and normal-state strings are extracted", () => {
  const pack = fixturePack();
  const sim = pack.simulation;
  assert.deepEqual(sim.faults.hot_start.ng, 24);
  assert.deepEqual(sim.faults.hot_start.effectiveProp, 1);
  assert.deepEqual(sim.faults.hot_start.qrhBridge, { var: "fault.qrhBridge" });
  assert.deepEqual(sim.faults.hot_start.activePartIds, ["compressor", "combustor"]);
  assert.deepEqual(sim.faults.oil_pressure_loss.ng, { ifFuel: [62, 0] });
  assert.deepEqual(sim.faults.prop_overspeed.effectivePower, { atLeast: ["powerLever", 0.72] });
  assert.equal(sim.bladeNotes.length, 5);
  assert.match(sim.normalText.POWERPLANT, /\$normalNg/);
  assert.match(sim.normalText.PROPELLER, /\$bladeNote/);
  assert.match(sim.normalElse, /Use the pins/);
  assert.equal(sim.normalBuild.likelyCause, "No fault selected.");
});

/* ------------------------------------------------------------ simulation */
test("labSimulation mirrors the Android readout model", () => {
  const pack = fixturePack();
  const normal = labSimulation(pack, "POWERPLANT", 0.82, 1, true, null);
  assert.equal(normal.ng, Math.min(102, Math.round(58 + 0.82 * 43.5)));
  assert.equal(normal.np, 96);
  assert.equal(normal.torque, Math.round(0.82 * 50));
  assert.equal(normal.itt, Math.round(680 + ((0.82 - 0.66) / 0.34) * 45));
  assert.equal(normal.fuelFlow, Math.round(185 + 0.82 * 415));
  assert.match(normal.observedResult, /^Normal PT6A-27 model: NG 94% \/ NP 96% \/ Torque 41 PSI \/ T5 701°C \(cruise limit 695°C\)/);
  assert.equal(normal.indication, "Normal indication set for the selected controls.");
  assert.equal(normal.activeFaultId, null);
  assert.match(normal.metricLine, /^NG 94% • NP 96% • Torque 41 PSI • T5 701°C \(cruise lim 695°C\) • FF 525 lb\/hr$/);

  const idle = labSimulation(pack, "POWERPLANT", 0.2, 1, true, null);
  assert.equal(idle.np, 44);
  assert.equal(idle.torque, 0);
  assert.equal(idle.itt, Math.round(490 + (0.2 / 0.3) * 50));
  const off = labSimulation(pack, "POWERPLANT", 0.5, 0.5, false, null);
  assert.deepEqual([off.ng, off.np, off.torque, off.itt, off.fuelFlow], [0, 0, 0, 120, 0]);
  const feather = labSimulation(pack, "PROPELLER", 0.5, 0, true, null);
  assert.equal(feather.np, 0);
  assert.match(feather.observedResult, /Blades at feather/);
  const reverse = labSimulation(pack, "PROPELLER", 0.05, 1, true, null);
  assert.equal(reverse.np, 91);
  assert.match(reverse.observedResult, /BETA\/REVERSE/);

  const hot = labSimulation(pack, "POWERPLANT", 0.82, 1, true, { id: "hot_start", title: "Hot start", qrhBridge: "bridge text" });
  assert.deepEqual([hot.ng, hot.np, hot.torque, hot.itt, hot.fuelFlow], [24, 0, 0, 925, 360]);
  assert.equal(hot.powerLever, 0.22);
  assert.equal(hot.qrhBridge, "bridge text");
  assert.equal(hot.activeFaultId, "hot_start");
  assert.deepEqual(hot.activePartIds, ["compressor", "combustor"]);
  const oil = labSimulation(pack, "POWERPLANT", 0.5, 1, false, { id: "oil_pressure_loss", title: "Oil", qrhBridge: "b" });
  assert.deepEqual([oil.ng, oil.itt, oil.fuelFlow, oil.fuelOn], [0, 120, 0, false]);
  const overspeed = labSimulation(pack, "PROPELLER", 0.5, 1, true, { id: "prop_overspeed", title: "O", qrhBridge: "b" });
  assert.equal(overspeed.powerLever, 0.72);
  // a fault without a simulation branch falls back to the normal readout (Android behaviour)
  const unknown = labSimulation(pack, "FUEL", 0.46, 0.5, true, { id: "boost_pump_fault", title: "x", qrhBridge: "b" });
  assert.equal(unknown.activeFaultId, null);
  assert.equal(unknown.likelyCause, "No fault selected.");
});

test("lever labels and QRH routing match SystemsLabSection.kt", () => {
  assert.deepEqual([0, 0.12, 0.3, 0.48, 0.66, 0.84, 1].map(powerLeverLabel), ["REVERSE", "IDLE", "DESCENT", "CRUISE", "CLIMB", "MAX", "MAX"]);
  assert.deepEqual([0, 0.34, 0.67, 1].map(propLeverLabel), ["FEATHER", "COARSE", "FINE", "FINE"]);
  assert.equal(qrhCategoryTargetFor("POWERPLANT", { id: "engine_fire" }), "EMERGENCY");
  assert.equal(qrhCategoryTargetFor("FUEL", { id: "fuel_off" }), "EMERGENCY");
  assert.equal(qrhCategoryTargetFor("POWERPLANT", { id: "oil_pressure_loss" }), "ABNORMAL");
  assert.equal(qrhCategoryTargetFor("FIRE_PROTECTION", null), "EMERGENCY");
  assert.equal(qrhCategoryTargetFor("HYDRAULICS", null), "ABNORMAL");
  assert.equal(qrhTargetHref("HYDRAULICS", null), "#/qrh/category/ABNORMAL");
  assert.equal(qrhTargetHref("HYDRAULICS", { id: "x", title: "Low pressure / leak" }), "#/systems?q=" + encodeURIComponent("Low pressure / leak"));
  assert.equal(formatBytes(75108224), "75 MB");
  assert.equal(formatBytes(1404788), "1.4 MB");
  assert.equal(formatBytes(192636), "193 KB");
});

test("pins and clip groups combine Android parts with the model registry", () => {
  const pack = fixturePack();
  const models = modelsForSystem(pack, "POWERPLANT");
  assert.equal(models[0].file, "PT6A27_ENGINE_REPLICA.glb");
  const pins = pinsForModel(pack, "POWERPLANT", models[0]);
  assert.equal(pins.length, 3);
  assert.equal(pins[0].id, "air_inlet_case");
  assert.equal(pins[0].mapped, true);
  assert.equal(pins[0].number, 1);
  const prop = modelsForSystem(pack, "PROPELLER");
  const hartzell = prop.find((m) => m.id === "hartzell-propeller");
  const hartzellPins = pinsForModel(pack, "PROPELLER", hartzell);
  assert.ok(hartzellPins.some((p) => p.id === "propeller_blades" && !p.authored), "model-only groups become extra pins");
  assert.ok(hartzellPins.filter((p) => p.authored).every((p) => p.mapped === false), "governor pins are not modelled in the propeller file");
  const groups = clipGroupsForModel(hartzell, hartzell.animations);
  assert.deepEqual(groups.map((g) => g.label), ["Feather (+87°)", "Low pitch (+17°)", "Max reverse (−15°)", "Pitch cycle"]);
  assert.equal(groups[0].clips.length, 8, "the eight FEATHER clips play together");
  const engine = clipGroupsForModel(models[0], models[0].animations);
  assert.deepEqual(engine.map((g) => g.label), ["Engine start sequence", "Engine running"]);
});
