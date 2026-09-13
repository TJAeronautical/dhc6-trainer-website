/*
  Live cockpit loop — port of the state machine inside
  feature-cockpit ui/screens/CockpitScreen.kt: the 33 ms engine tick, the derived
  gauge normalisation, the failure / CAS evaluation and the CockpitVisualState
  assembly (including the scenario overlay maps published by ScenarioOverlayStore).
*/
import { createEngineModel, createSimRunner, createAutofeather, C } from "./engine.js";
import { createCasController, createCasSystem, evaluateFailures, resolveG950Cas, resolveLegacyAnnunciators, LEGACY_STARTUP_PANEL_ANNUNCIATORS, G950_STARTUP_CAS_MESSAGES } from "./cas.js";
import { createInteractionController } from "./interaction.js";
import { displayVariant } from "./hitboxes.js";
import { canonicalScenarioKey } from "./keys.js";
import { instrumentOverlayKeys, parseInstrumentOverride } from "./snapshot.js";

const LEGACY_TORQUE_GAUGE_FACE_MAX_PSI = 55;
const TICK_MS = 33;

function clamp01(v) { return Math.min(1, Math.max(0, v)); }

/* Gauge keys whose value always comes from the live engine, never the scenario overlay. */
const DYNAMIC_ENGINE_KEYS = ["TORQUE_GAUGE_L", "TORQUE_GAUGE_R", "TORQUE_L", "TORQUE_R", "NG_GAUGE_L", "NG_GAUGE_R", "NG_L", "NG_R",
  "NP_GAUGE_L", "NP_GAUGE_R", "NP_L", "NP_R", "T5_GAUGE_L", "T5_GAUGE_R", "T5_L", "T5_R", "ITT_L", "ITT_R",
  "FUEL_FLOW_GAUGE_L", "FUEL_FLOW_GAUGE_R", "FUEL_FLOW_L", "FUEL_FLOW_R"];

export function createLiveCockpit(options) {
  const opts = options || {};
  const variant = displayVariant(opts.variant);
  const isG950 = variant === "G950";
  const controller = opts.controller || createInteractionController();
  const engine = createEngineModel();
  const simRunner = createSimRunner(createAutofeather());
  const casSystem = createCasSystem({ context: {} });
  const cas = createCasController(casSystem);
  const overlay = { instruments: {}, annunciators: {}, switches: {}, notes: null, scenarioMode: Boolean(opts.scenarioMode) };
  let activeCasIds = new Set();
  let legacyAnnunciators = [];
  let sim = { selectLamp: false, armLamp: false, triggeredL: false, triggeredR: false };
  let engineOut = engine.tick(C.FLIGHT_IDLE_GATE_01, C.FLIGHT_IDLE_GATE_01, 1, 1, 1, 1, true, 0.033, false);
  let timer = null;
  let listener = null;

  function effectiveSwitchStates() {
    if (!overlay.scenarioMode || !Object.keys(overlay.switches).length) return controller.switchStates;
    return Object.assign({}, controller.switchStates, overlay.switches);
  }
  function switchOn(states, key) {
    if (["FWD_BOOST_PUMP", "AFT_BOOST_PUMP", "L_DC_GEN", "R_DC_GEN"].indexOf(key) > -1) return states[key] === "LEFT";
    if (["STBY_BOOST_PUMP_FWD", "STBY_BOOST_PUMP_AFT", "INTAKE_DEFL", "STAB_DEICE_L", "STAB_DEICE_R", "AUTOFEATHER_ARM"].indexOf(key) > -1) return states[key] === "RIGHT";
    return states[key] === "LEFT";
  }
  function autofeatherSelectOn(states) { return states.AUTOFEATHER_SELECT === "LEFT"; }
  function autofeatherArmOn(states) { const s = states.AUTOFEATHER_ARM; return s === "RIGHT" || s === "UP" || s === "MOMENTARY"; }

  function resolveWow(states, levers) {
    const keys = ["WOW", "WEIGHT_ON_WHEELS", "ON_GROUND", "AIRBORNE"];
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      let raw = overlay.instruments[key];
      if (raw == null) {
        const found = Object.keys(overlay.instruments).find(function (k) { return canonicalScenarioKey(k) === key; });
        if (found) raw = overlay.instruments[found];
      }
      if (raw == null) continue;
      const u = String(raw).trim().toUpperCase();
      let value = null;
      if (["TRUE", "ON", "YES", "1", "GROUND", "ON_GROUND"].indexOf(u) > -1) value = true;
      else if (["FALSE", "OFF", "NO", "0", "AIR", "AIRBORNE"].indexOf(u) > -1) value = false;
      if (value == null) continue;
      return key === "AIRBORNE" ? !value : value;
    }
    for (let i = 0; i < keys.length; i += 1) {
      const st = states[keys[i]];
      if (!st) continue;
      const value = st === "LEFT" || st === "UP" ? true : st === "RIGHT" || st === "DOWN" ? false : null;
      if (value == null) continue;
      return keys[i] === "AIRBORNE" ? !value : value;
    }
    const plL = levers.POWER_LEVER_L != null ? levers.POWER_LEVER_L : C.FLIGHT_IDLE_GATE_01;
    const plR = levers.POWER_LEVER_R != null ? levers.POWER_LEVER_R : C.FLIGHT_IDLE_GATE_01;
    return clamp01(plL) < C.FLIGHT_IDLE_GATE_01 || clamp01(plR) < C.FLIGHT_IDLE_GATE_01;
  }

  function tick(dtSec) {
    const levers = controller.leverPositions;
    const states = effectiveSwitchStates();
    const plL = levers.POWER_LEVER_L != null ? levers.POWER_LEVER_L : C.FLIGHT_IDLE_GATE_01;
    const plR = levers.POWER_LEVER_R != null ? levers.POWER_LEVER_R : C.FLIGHT_IDLE_GATE_01;
    const prL = levers.PROP_LEVER_L != null ? levers.PROP_LEVER_L : 1;
    const prR = levers.PROP_LEVER_R != null ? levers.PROP_LEVER_R : 1;
    const flL = levers.FUEL_LEVER_L != null ? levers.FUEL_LEVER_L : 1;
    const flR = levers.FUEL_LEVER_R != null ? levers.FUEL_LEVER_R : 1;
    const afSelected = autofeatherSelectOn(states) || autofeatherArmOn(states);
    const wow = resolveWow(states, levers);

    engineOut = engine.tick(plL, plR, prL, prR, flL, flR, wow, dtSec || TICK_MS / 1000, false);
    sim = simRunner.tick(plL, plR, prL, prR, flL, flR, engineOut, afSelected, wow);
    if (sim.triggeredL) controller.setLever("POWER_LEVER_L", 1, false);
    if (sim.triggeredR) controller.setLever("POWER_LEVER_R", 1, false);

    const batteryOn = switchOn(states, "BATTERY_MASTER");
    const eitherGen = switchOn(states, "L_DC_GEN") || switchOn(states, "R_DC_GEN");
    const totallyDark = !batteryOn && !eitherGen;
    const enginesCold = engineOut.left.ngPercent < 12 && engineOut.right.ngPercent < 12;
    const avionicsSelfTest = batteryOn && !eitherGen && enginesCold;
    const intakeDeflectors = switchOn(states, "INTAKE_DEFL");
    const fwdAvailable = flL < 0.5 && engineOut.left.ngPercent >= 65;
    const aftAvailable = flR < 0.5 && engineOut.right.ngPercent >= 65;
    const fwd1 = switchOn(states, "FWD_BOOST_PUMP"), fwd2 = switchOn(states, "STBY_BOOST_PUMP_FWD");
    const aft1 = switchOn(states, "AFT_BOOST_PUMP"), aft2 = switchOn(states, "STBY_BOOST_PUMP_AFT");
    const failure = evaluateFailures({
      wow: wow, hydraulicPressurePsi: engineOut.hydraulicPressurePsi,
      fuelQtyFwdLb: engineOut.fuelQuantityLeftLb, fuelQtyAftLb: engineOut.fuelQuantityRightLb,
      leftNgPercent: engineOut.left.ngPercent, rightNgPercent: engineOut.right.ngPercent,
      leftNpPercent: engineOut.left.npPercent, rightNpPercent: engineOut.right.npPercent,
      leftTorquePsi: engineOut.left.torquePercent, rightTorquePsi: engineOut.right.torquePercent,
      leftOilPressurePsi: engineOut.left.oilPressurePsi, rightOilPressurePsi: engineOut.right.oilPressurePsi,
      leftGenOn: switchOn(states, "L_DC_GEN"), rightGenOn: switchOn(states, "R_DC_GEN"), leftGenFail: false, rightGenFail: false,
      fwdBoostPump1Selected: fwd1, fwdBoostPump2Selected: fwd2, aftBoostPump1Selected: aft1, aftBoostPump2Selected: aft2,
      fwdBoostPump1PressureLow: fwd1 && !fwdAvailable, fwdBoostPump2PressureLow: fwd2 && !fwdAvailable,
      aftBoostPump1PressureLow: aft1 && !aftAvailable, aftBoostPump2PressureLow: aft2 && !aftAvailable,
      pneumaticPressureLow: engineOut.left.ngPercent < 65 && engineOut.right.ngPercent < 65,
      intakeDeflectorLeft: intakeDeflectors, intakeDeflectorRight: intakeDeflectors,
      stabDeiceLeft: switchOn(states, "STAB_DEICE_L"), stabDeiceRight: switchOn(states, "STAB_DEICE_R"),
      fireHandleLeft: switchOn(states, "FIRE_HANDLE_L"), fireHandleRight: switchOn(states, "FIRE_HANDLE_R"),
      firePushLeft: switchOn(states, "FIRE_PUSH_SWITCH_L"), firePushRight: switchOn(states, "FIRE_PUSH_SWITCH_R"),
      baggageSmoke: switchOn(states, "BAGGAGE_SMOKE") || switchOn(states, "SMOKE_R_BAGGAGE") || switchOn(states, "BAGGAGE_SMOKE_TEST"),
      leftT5Celsius: engineOut.left.t5Celsius, rightT5Celsius: engineOut.right.t5Celsius,
      leftFuelFlowPph: engineOut.left.fuelFlowPph, rightFuelFlowPph: engineOut.right.fuelFlowPph,
      powerLeverL01: plL, powerLeverR01: plR, propLeverL01: prL, propLeverR01: prR,
      fuelOnLeft: flL < 0.5, fuelOnRight: flR < 0.5,
      autofeatherTriggeredLeft: sim.triggeredL, autofeatherTriggeredRight: sim.triggeredR
    });

    if (!overlay.scenarioMode) {
      legacyAnnunciators = totallyDark ? [] : avionicsSelfTest ? LEGACY_STARTUP_PANEL_ANNUNCIATORS.slice() : resolveLegacyAnnunciators(failure);
      const nextIds = new Set(totallyDark ? [] : avionicsSelfTest ? G950_STARTUP_CAS_MESSAGES : resolveG950Cas(failure));
      activeCasIds = cas.applySet(activeCasIds, nextIds);
    }
    controller.setSwitchState("AUTOFEATHER_SELECT_LIGHT", sim.selectLamp ? "RIGHT" : "LEFT", false);
    controller.setSwitchState("AUTOFEATHER_ARM_LIGHT", sim.armLamp ? "RIGHT" : "LEFT", false);
    if (listener) listener(api.visualState());
  }

  const api = {
    controller: controller,
    variant: variant,
    engineOutput: function () { return engineOut; },
    casMessages: function () { return casSystem.messages(); },
    onChange: function (fn) { listener = fn; },
    setScenarioMode: function (on) {
      overlay.scenarioMode = Boolean(on);
      if (overlay.scenarioMode) { activeCasIds = cas.applySet(activeCasIds, new Set()); legacyAnnunciators = []; }
      else { cas.clearAllMessages(); activeCasIds = new Set(); }
    },
    /* ScenarioSnapshotApplier: publish a frozen phase onto the live cockpit. */
    applyScenario: function (visual, snapshot) {
      overlay.instruments = Object.assign({}, snapshot ? snapshot.instruments : {});
      overlay.annunciators = {};
      (visual.casEntries || []).forEach(function (e) { overlay.annunciators[e.key.id] = e.priority === "WARNING" ? "WARNING" : e.priority === "CAUTION" ? "CAUTION" : "ON"; });
      Object.keys(visual.annunciators || {}).forEach(function (id) { if (visual.annunciators[id] && overlay.annunciators[id] == null) overlay.annunciators[id] = "ON"; });
      overlay.switches = Object.assign({}, visual.switchStates);
      controller.applySnapshot(visual);
      engine.reset();
      cas.clearAllMessages();
      activeCasIds = new Set();
      (visual.casEntries || []).forEach(function (e) { cas.onCasEvent({ id: e.key.id, active: true }); activeCasIds.add(e.key.id); });
      legacyAnnunciators = Object.keys(visual.annunciators || {}).filter(function (id) { return visual.annunciators[id] && id !== "MASTER_WARNING" && id !== "MASTER_CAUTION"; });
      tick(0.033);
    },
    clearScenario: function () {
      overlay.instruments = {}; overlay.annunciators = {}; overlay.switches = {};
      legacyAnnunciators = []; cas.clearAllMessages(); activeCasIds = new Set();
    },
    visualState: function () {
      const states = effectiveSwitchStates();
      const analog = {}, raw = {};
      function put(keys, normalized, actual) { keys.forEach(function (k) { analog[k] = normalized; raw[k] = actual; }); }
      const torqueL = engineOut.left.torquePercent, torqueR = engineOut.right.torquePercent;
      const tqNorm = function (v) { return isG950 ? clamp01(v / C.TORQUE_GAUGE_GREEN_MAX_PSI) : clamp01(v / LEGACY_TORQUE_GAUGE_FACE_MAX_PSI); };
      put(["TORQUE_GAUGE_L", "TORQUE_L"], tqNorm(torqueL), torqueL);
      put(["TORQUE_GAUGE_R", "TORQUE_R"], tqNorm(torqueR), torqueR);
      put(["NG_GAUGE_L", "NG_L"], clamp01(engineOut.left.ngPercent / C.NG_MAX_PERCENT), engineOut.left.ngPercent);
      put(["NG_GAUGE_R", "NG_R"], clamp01(engineOut.right.ngPercent / C.NG_MAX_PERCENT), engineOut.right.ngPercent);
      put(["NP_GAUGE_L", "NP_L"], clamp01(engineOut.left.npPercent / C.NP_MAX_PERCENT), engineOut.left.npPercent);
      put(["NP_GAUGE_R", "NP_R"], clamp01(engineOut.right.npPercent / C.NP_MAX_PERCENT), engineOut.right.npPercent);
      put(["T5_GAUGE_L", "T5_L", "ITT_L"], clamp01(engineOut.left.t5Celsius / C.T5_MAX_C), engineOut.left.t5Celsius);
      put(["T5_GAUGE_R", "T5_R", "ITT_R"], clamp01(engineOut.right.t5Celsius / C.T5_MAX_C), engineOut.right.t5Celsius);
      put(["FUEL_FLOW_GAUGE_L", "FUEL_FLOW_L"], clamp01(engineOut.left.fuelFlowPph / C.FUEL_FLOW_MAX_PPH), engineOut.left.fuelFlowPph);
      put(["FUEL_FLOW_GAUGE_R", "FUEL_FLOW_R"], clamp01(engineOut.right.fuelFlowPph / C.FUEL_FLOW_MAX_PPH), engineOut.right.fuelFlowPph);
      put(["OIL_PRESS_GAUGE_L", "L_ENGINE_OIL_PRESS"], clamp01(engineOut.left.oilPressurePsi / C.OIL_PRESSURE_MAX_PSI), engineOut.left.oilPressurePsi);
      put(["OIL_PRESS_GAUGE_R", "OIL_PRESS_R"], clamp01(engineOut.right.oilPressurePsi / C.OIL_PRESSURE_MAX_PSI), engineOut.right.oilPressurePsi);
      put(["OIL_TEMP_GAUGE_L", "OIL_TEMP_L"], clamp01((engineOut.left.oilTemperatureC - C.AMBIENT_TEMPERATURE_C) / (C.OIL_TEMP_MAX_C - C.AMBIENT_TEMPERATURE_C)), engineOut.left.oilTemperatureC);
      put(["OIL_TEMP_GAUGE_R", "OIL_TEMP_R"], clamp01((engineOut.right.oilTemperatureC - C.AMBIENT_TEMPERATURE_C) / (C.OIL_TEMP_MAX_C - C.AMBIENT_TEMPERATURE_C)), engineOut.right.oilTemperatureC);
      put(["FUEL_QUANTITY_GAUGE_L", "FUEL_QUANTITY_L"], clamp01(engineOut.fuelQuantityLeftLb / C.INITIAL_FUEL_QTY_LB), engineOut.fuelQuantityLeftLb);
      put(["FUEL_QUANTITY_GAUGE_R", "FUEL_QUANTITY_R"], clamp01(engineOut.fuelQuantityRightLb / C.INITIAL_FUEL_QTY_LB), engineOut.fuelQuantityRightLb);
      put(["HYDRAULIC_PRESS_GAUGE", "SKIS_GAUGE"], clamp01(engineOut.hydraulicPressurePsi / C.HYDRAULIC_NOMINAL_PSI), engineOut.hydraulicPressurePsi);
      put(["VDC_GAUGE"], clamp01((C.DEFAULT_VDC_VOLTS - 20) / 10), C.DEFAULT_VDC_VOLTS);

      Object.keys(overlay.instruments).forEach(function (id) {
        const key = canonicalScenarioKey(id);
        if (DYNAMIC_ENGINE_KEYS.indexOf(key) > -1) return;
        const parsed = parseInstrumentOverride(key, overlay.instruments[id], variant);
        if (!parsed) return;
        instrumentOverlayKeys(key).forEach(function (k) { analog[k] = parsed.normalized; if (parsed.actual != null) raw[k] = parsed.actual; });
      });

      const messages = casSystem.messages();
      const hasWarning = messages.some(function (m) { return m.priority === "WARNING" && !m.acknowledged; });
      const hasCaution = messages.some(function (m) { return m.priority === "CAUTION" && !m.acknowledged; });
      const annunciators = {};
      annunciators.AUTOFEATHER_SELECT = autofeatherSelectOn(states);
      annunciators.AUTOFEATHER_ARM = sim.armLamp || autofeatherArmOn(states);
      annunciators.MASTER_WARNING = hasWarning;
      annunciators.MASTER_CAUTION = hasCaution;
      legacyAnnunciators.forEach(function (id) { annunciators[id] = true; });
      Object.keys(overlay.annunciators).forEach(function (id) {
        if (isG950 && id === "AC_400_CYCLE") return;
        annunciators[id] = String(overlay.annunciators[id]).toUpperCase() !== "OFF";
      });

      return {
        analogValues: analog, rawAnalogValues: raw, annunciators: annunciators,
        casMessages: messages.map(function (m) { return m.text; }), casEntries: messages,
        autofeatherArmed: sim.armLamp || autofeatherArmOn(states), autofeatherSelected: autofeatherSelectOn(states),
        autofeatherTriggered: sim.triggeredL || sim.triggeredR,
        switchStates: states, leverPositions: controller.leverPositions
      };
    },
    start: function () { if (timer) return; tick(0.033); timer = setInterval(function () { tick(TICK_MS / 1000); }, TICK_MS); },
    stop: function () { if (timer) { clearInterval(timer); timer = null; } },
    dispose: function () { api.stop(); controller.dispose(); listener = null; }
  };
  return api;
}
