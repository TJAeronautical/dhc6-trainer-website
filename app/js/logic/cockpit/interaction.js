/*
  Live cockpit control state — port of feature-cockpit ui/CockpitInteractionController.kt
  (seedInitialSwitchStates / defaultOffStateForSwitch / seedInitialLeverPositions,
  switch mode inference, momentary pulses) and the tap semantics in
  ui/layers/CockpitInteractionLayer.kt (three-position tap fraction, gate bands).
*/
import { FLIGHT_IDLE_GATE_01, DEFAULT_PROP_LEVER_RAW_01, DEFAULT_FUEL_LEVER_RAW_01, isButtonLikeHitbox } from "./sprites.js";

const OFF_RIGHT = ["BATTERY_MASTER", "STBY_BATTERY", "AVIONICS_MASTER", "INVERTER_SWITCH", "INVERTER_1_CB", "INVERTER_2_CB", "FWD_BOOST_PUMP", "AFT_BOOST_PUMP",
  "PROP_DEICE", "INTAKE_ANTI_ICE", "PITOT_HEAT_SWITCH", "ANTI-COL_LIGHTS", "ANTI_COL_LIGHTS", "TAXI_LIGHT", "WING_INSPECT", "FASTEN_SEATBELTS", "NO_SMOKING_LIGHTS",
  "FLIGHT_COMP", "BEACON", "POS_LIGHTS", "CABIN_READING", "BLEED_AIR_L", "BLEED_AIR_R", "AUTOFEATHER_SELECT", "FIRE_HANDLE_L", "FIRE_HANDLE_R",
  "FIRE_PUSH_SWITCH_L", "FIRE_PUSH_SWITCH_R", "FUEL_SOV_L", "FUEL_SOV_R", "BAGGAGE_SMOKE", "SMOKE_R_BAGGAGE", "BAGGAGE_SMOKE_TEST", "HYD_OIL_PUMP_CB", "BETA_SYS_CB", "AIL_TRIM_ACT_CB"];
const OFF_LEFT = ["STBY_BOOST_PUMP_FWD", "STBY_BOOST_PUMP_AFT", "STAB_DEICE_L", "STAB_DEICE_R", "AUTOFEATHER_ARM"];
const OFF_CENTER = ["L_DC_GEN", "R_DC_GEN", "BUS_TIE", "CABIN_DIM", "CABIN_ENTRANCE", "DEICE_BOOTS_PWR", "DEICE_BOOTS_STAB", "DEICE_BOOTS_AREA", "DEICE_BOOTS_INT",
  "DEICE_BOOTS_VALVE", "INTAKE_DEFL", "AC_FUNCT", "AC_PWR", "TEMP_CONT_MODE", "TEMP_CONT", "CAUT_LT_TEST", "WINDSHIELD_HEAT", "IGNITION_START", "STARTER", "STARTER_SWITCH",
  "ENGINE_START", "IGNITION_SWITCH", "AILERON_TRIM"];
const SEED_IDS = ["BATTERY_MASTER", "STBY_BATTERY", "L_DC_GEN", "R_DC_GEN", "BUS_TIE", "AVIONICS_MASTER", "INVERTER_SWITCH", "INVERTER_1_CB", "INVERTER_2_CB",
  "FWD_BOOST_PUMP", "AFT_BOOST_PUMP", "STBY_BOOST_PUMP_FWD", "STBY_BOOST_PUMP_AFT", "FUEL_SOV_L", "FUEL_SOV_R",
  "INTAKE_ANTI_ICE", "INTAKE_DEFL", "STAB_DEICE_L", "STAB_DEICE_R", "DEICE_BOOTS_PWR", "DEICE_BOOTS_STAB", "DEICE_BOOTS_AREA", "DEICE_BOOTS_INT", "DEICE_BOOTS_VALVE",
  "PROP_DEICE", "WINDSHIELD_HEAT", "PITOT_HEAT_SWITCH", "TEMP_CONT_MODE", "TEMP_CONT", "AC_FUNCT", "AC_PWR",
  "LANDING_LIGHT_L", "LANDING_LIGHT_R", "ANTI-COL_LIGHTS", "ANTI_COL_LIGHTS", "TAXI_LIGHT", "WING_INSPECT", "FASTEN_SEATBELTS", "NO_SMOKING_LIGHTS", "FLIGHT_COMP",
  "BEACON", "POS_LIGHTS", "CABIN_DIM", "CABIN_ENTRANCE", "CABIN_READING", "BLEED_AIR_L", "BLEED_AIR_R", "CAUT_LT_TEST",
  "AUTOFEATHER_ARM", "AUTOFEATHER_SELECT", "FIRE_HANDLE_L", "FIRE_HANDLE_R", "FIRE_PUSH_SWITCH_L", "FIRE_PUSH_SWITCH_R", "BAGGAGE_SMOKE", "SMOKE_R_BAGGAGE", "BAGGAGE_SMOKE_TEST",
  "AILERON_TRIM", "HYD_OIL_PUMP_CB", "BETA_SYS_CB", "AIL_TRIM_ACT_CB"];

export function defaultOffStateForSwitch(id) {
  const key = String(id || "").trim().toUpperCase();
  if (OFF_RIGHT.indexOf(key) > -1) return "RIGHT";
  if (OFF_LEFT.indexOf(key) > -1) return "LEFT";
  if (OFF_CENTER.indexOf(key) > -1) return "CENTER";
  return "RIGHT";
}

export function seedSwitchStates() {
  const out = {};
  SEED_IDS.forEach(function (id) { out[id] = defaultOffStateForSwitch(id); });
  out.BATTERY_MASTER = "LEFT";
  out.STBY_BATTERY = "LEFT";
  out.AUTOFEATHER_SELECT_LIGHT = "LEFT";
  out.AUTOFEATHER_ARM_LIGHT = "LEFT";
  return out;
}

export function seedLeverPositions() {
  return { POWER_LEVER_L: FLIGHT_IDLE_GATE_01, POWER_LEVER_R: FLIGHT_IDLE_GATE_01, PROP_LEVER_L: DEFAULT_PROP_LEVER_RAW_01, PROP_LEVER_R: DEFAULT_PROP_LEVER_RAW_01,
    FUEL_LEVER_L: DEFAULT_FUEL_LEVER_RAW_01, FUEL_LEVER_R: DEFAULT_FUEL_LEVER_RAW_01, FLAP_SELECTOR: 0 };
}

export function switchModeFor(hb) {
  const raw = hb && hb.binding && hb.binding.switchMode ? String(hb.binding.switchMode).toLowerCase().replace(/[\s-]/g, "") : "";
  if (["toggle", "twopositionswitch", "two_pos", "twoposition", "2positions", "2pos"].indexOf(raw) > -1) return "TOGGLE";
  if (["threepositionswitch", "3pos", "three_pos", "threeposition", "3positions"].indexOf(raw) > -1) return "THREE_POS";
  if (["momentary", "momentaryswitch", "mom"].indexOf(raw) > -1) return "MOMENTARY";
  const id = String((hb && hb.id) || "").toUpperCase();
  if (id.indexOf("TEST") > -1 || id.indexOf("PUSH") > -1 || id.indexOf("START") > -1) return "MOMENTARY";
  return "TOGGLE";
}

/* CockpitInteractionLayer tap: three-position uses the tap fraction along switchAxis. */
export function nextSwitchState(hb, current, tapFractionX, tapFractionY) {
  const mode = switchModeFor(hb);
  if (mode === "MOMENTARY") return { state: "MOMENTARY", releaseTo: "CENTER", releaseMs: (hb.binding && hb.binding.momentaryReturnMs) || 180 };
  if (mode === "THREE_POS") {
    const axis = hb.binding && hb.binding.switchAxis ? String(hb.binding.switchAxis).toUpperCase() : "VERTICAL";
    const f = axis === "HORIZONTAL" ? tapFractionX : tapFractionY;
    const state = f < 0.42 ? "LEFT" : f > 0.58 ? "RIGHT" : "CENTER";
    const releaseMs = (hb.binding && hb.binding.momentaryReturnMs) || null;
    return releaseMs ? { state: state, releaseTo: "CENTER", releaseMs: releaseMs } : { state: state };
  }
  return { state: current === "RIGHT" ? "LEFT" : "RIGHT" };
}

/* Lever gate bands: POWER [0,0.25] and PROP [0,0.15] need a hold before crossing down. */
export const LEVER_GATE_BANDS = { POWER_LEVER_L: [0, 0.25], POWER_LEVER_R: [0, 0.25], PROP_LEVER_L: [0, 0.15], PROP_LEVER_R: [0, 0.15] };

export function createInteractionController() {
  const switchStates = seedSwitchStates();
  const leverPositions = seedLeverPositions();
  const listeners = [];
  const timers = new Map();
  function emit(event) { listeners.forEach(function (fn) { fn(event); }); }
  return {
    switchStates: switchStates,
    leverPositions: leverPositions,
    onControlEvent: function (fn) { listeners.push(fn); },
    getSwitchState: function (id) { return switchStates[id]; },
    setSwitchState: function (id, next, emitEvent) {
      const prior = switchStates[id];
      switchStates[id] = next;
      if (emitEvent !== false) emit({ kind: "switch", controlId: id, newState: next, priorState: prior });
    },
    tapHitbox: function (hb, fractionX, fractionY) {
      const id = (hb.binding && hb.binding.switchId) || hb.id;
      const result = nextSwitchState(hb, switchStates[id], fractionX, fractionY);
      this.setSwitchState(id, result.state);
      if (result.releaseTo && result.releaseMs) {
        clearTimeout(timers.get(id));
        const self = this;
        timers.set(id, setTimeout(function () { self.setSwitchState(id, result.releaseTo); }, Math.max(30, result.releaseMs)));
      }
      if (hb.binding && hb.binding.action) emit({ kind: "action", controlId: hb.binding.action });
      emit({ kind: "action", controlId: hb.id });
      return result.state;
    },
    setLever: function (leverId, position, emitEvent) {
      const prior = leverPositions[leverId] != null ? leverPositions[leverId] : 0;
      const next = Math.min(1, Math.max(0, position));
      leverPositions[leverId] = next;
      if (emitEvent !== false) { emit({ kind: "lever", controlId: leverId, position: next, priorPosition: prior }); emit({ kind: "action", controlId: leverId }); }
      return next;
    },
    applySnapshot: function (visual) {
      Object.keys(visual.switchStates || {}).forEach(function (k) { switchStates[k] = visual.switchStates[k]; });
      Object.keys(visual.leverPositions || {}).forEach(function (k) { leverPositions[k] = visual.leverPositions[k]; });
    },
    reset: function () {
      timers.forEach(function (t) { clearTimeout(t); }); timers.clear();
      Object.assign(switchStates, seedSwitchStates());
      Object.assign(leverPositions, seedLeverPositions());
    },
    dispose: function () { timers.forEach(function (t) { clearTimeout(t); }); timers.clear(); listeners.length = 0; }
  };
}
