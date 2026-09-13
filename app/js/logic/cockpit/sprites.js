/*
  Control sprite pipeline — port of feature-cockpit ui/CanonicalVisualStatePolicy.kt
  (sourceExactFamilySpecFor, defaultControlCalibrationOverride,
  buildCanonicalControlSpritePack, visualStateKeysForSwitchState) and
  ui/layers/CockpitControlsOverlayLayer.kt (draw order, placement, leverTopLeftForPosition).

  The build tool (tools/lib/cockpit-pack.mjs) uses familySpecFor / calibrationFor /
  spriteScale to precompute the sprite pack; the renderer uses the placement helpers.
*/
import { canonicalVisualAliases, cockpitVisualKeys, resolveVisualHostRole, isDirectAnnunciatorHost, ROLE } from "./keys.js";

/* ------------------------------------------------------------ constants */
export const FLIGHT_IDLE_GATE_01 = 0.26;
export const DEFAULT_POWER_LEVER_RAW_01 = FLIGHT_IDLE_GATE_01;
export const DEFAULT_PROP_LEVER_RAW_01 = 1;
export const DEFAULT_FUEL_LEVER_RAW_01 = 1;
export const MAX_SOURCE_EXACT_BITMAP_DIMENSION_PX = 1400;

/* ---------------------------------------------------- family spec table */
const DEFAULT_STATES = ["default", "center", "neutral", "closed", "released", "on", "up", "down"];
const CB_STATES = ["default", "closed", "open"];
const TWO_TOGGLE = ["default", "off", "on"];
const THREE_TOGGLE = ["default", "center", "up", "down", "off", "on"];

const FAMILY_RULES = [
  { tokens: ["POWER_LEVER_L"], family: "power_lever_l", states: DEFAULT_STATES },
  { tokens: ["POWER_LEVER_R"], family: "power_lever_r", states: DEFAULT_STATES },
  { tokens: ["PROP_LEVER_L"], family: "prop_lever_l", states: ["prop", "default", "neutral"] },
  { tokens: ["PROP_LEVER_R"], family: "prop_lever_r", states: ["prop", "default", "neutral"] },
  { tokens: ["PROP_LEVER"], family: "lever_side_profile", states: ["prop", "default", "neutral"] },
  { tokens: ["FUEL_LEVER_L"], family: "fuel_lever_l", states: ["fuel", "default", "neutral"] },
  { tokens: ["FUEL_LEVER_R"], family: "fuel_lever_r", states: ["fuel", "default", "neutral"] },
  { tokens: ["FUEL_LEVER"], family: "lever_side_profile", states: ["fuel", "default", "neutral"] },
  { tokens: ["AUTOFEATHER_SELECT"], family: "autofeather_select", states: ["off", "default", "on"] },
  { tokens: ["FLAP_SELECTOR"], family: "flap_handle", states: ["0", "10", "default", "neutral"] },
  { tokens: ["CHECKLIST", "CHECKLIST_CLOSE"], family: "checklist", states: ["off", "on", "default"] },
  { tokens: ["AIL_TRIM_ACT_CB", "BETA_SYS_CB"], family: "5amp_state_of_cb", states: CB_STATES },
  { tokens: ["INVERTER_1_CB", "INVERTER_2_CB"], family: "20amp_state_of_cb", states: CB_STATES },
  { tokens: ["HYD_OIL_PUMP_CB", "HYD_PUMP_CB"], family: "35amp_state_of_cb", states: CB_STATES },
  { tokens: ["_CB", "CIRCUIT_BREAKER"], family: "20amp_state_of_cb", states: CB_STATES },
  { tokens: ["AVIONICS_MASTER"], family: "avionics_master", states: ["released", "pressed", "default", "on"] },
  { tokens: ["INVERTER_SWITCH"], family: "inverter", states: ["up", "down", "default"] },
  { tokens: ["BATTERY_MASTER", "STBY_BATTERY"], family: "battery_master", states: ["default", "off", "on", "up", "down", "pressed"] },
  { tokens: ["AFT_BOOST_PUMP", "FWD_BOOST_PUMP"], family: "boost_pumps", states: TWO_TOGGLE },
  { tokens: ["STBY_BOOST_PUMP_AFT", "STBY_BOOST_PUMP_FWD"], family: "standby_boost_pump", states: ["default", "on", "off"] },
  { tokens: ["FUEL_SELECTOR"], family: "fuel_crossfeed", states: ["both_aft", "both_fwd", "default"] },
  { tokens: ["STARTER_SWITCH"], family: "start_selector", states: ["default", "off", "center", "start_left", "start_right"] },
  { tokens: ["IGNITION_ARM"], family: "ignition_arm", states: ["manual", "armed", "off", "on", "default"] },
  { tokens: ["IGNITER_L", "IGNITER_R"], family: "vertical_toggle", states: ["default", "off", "on", "up", "down", "pressed"] },
  { tokens: ["LANDING_LIGHT_L"], family: "landing_light_cluster_left", states: TWO_TOGGLE },
  { tokens: ["LANDING_LIGHT_R"], family: "landing_light_cluster_right", states: TWO_TOGGLE },
  { tokens: ["FIRE_PUSH_SWITCH_L", "FIRE_PUSH_SWITCH_R"], family: "fire_push_switch", states: ["default", "on", "off", "discharged"] },
  { tokens: ["FIRE_HANDLE_L", "FIRE_HANDLE_R"], family: "fire_handle_pull", states: ["default", "on", "off", "discharged"] },
  { tokens: ["FUEL_SOV", "FUEL_SHUTOFF", "EMERG_FUEL_SHUTOFF"], family: "fuel_shutoff", states: ["off", "default", "on"] },
  { tokens: ["WINDSHIELD_WASHER"], family: "switch_button", states: ["off", "on", "default"] },
  { tokens: ["FIRE_DETECT_TEST"], family: "fire_detection", states: ["on", "off", "default", "armed"] },
  { tokens: ["AILERON_TRIM"], family: "aileron_trim", states: ["default", "left_down", "right_down"] },
  { tokens: ["LOAD_METER"], family: "load_meter", states: ["default", "load_left", "load_right"] },
  { tokens: ["WINDSHIELD_MODE"], family: "windshield_mode", states: TWO_TOGGLE },
  { tokens: ["WINDSHIELD_POWER"], family: "windshield_power", states: TWO_TOGGLE },
  { tokens: ["STAB_DEICE_R", "STAB_DEICE_L"], family: "stab_deice", states: TWO_TOGGLE },
  { tokens: ["ANTI-COL_LIGHTS", "ANTI_COL_LIGHTS", "STROBE", "PITOT_HEAT_SWITCH", "PITOT_HEAT", "INTAKE_ANTI_ICE", "PROP_DEICE", "WING_INSPECT", "TAXI_LIGHT", "FASTEN_SEATBELTS", "FASTEN_SEATBELT", "NO_SMOKING_LIGHTS", "NO_SMOKING", "FLIGHT_COMP", "BEACON", "POS_LIGHTS", "BLEED_AIR", "CABIN_READING", "FLOOD_LIGHT", "ANTI_ICE"], family: "two_toggle_large", states: TWO_TOGGLE },
  { tokens: ["BUS_TIE", "CABIN_DIM", "CABIN_ENTRANCE", "DEICE_BOOTS_PWR", "DEICE_BOOTS_STAB", "DEICE_BOOTS_AREA", "DEICE_BOOTS_INT", "DEICE_BOOTS_VALVE", "INTAKE_DEFL", "L_DC_GEN", "R_DC_GEN", "AC_FUNCT", "AC_PWR", "TEMP_CONT_MODE", "TEMP_CONT", "CAUT_LT_TEST", "CAUT_LIGHT_TEST"], family: "three_toggle_large", states: THREE_TOGGLE }
];

function bindingField(hb, name) { return hb && hb.binding && hb.binding[name] ? String(hb.binding[name]) : ""; }

/* has(tokens…): substring both ways between hitbox keys and alias-expanded tokens. */
export function hasToken(hb, tokens) {
  const keys = cockpitVisualKeys(hb);
  const wanted = [];
  tokens.forEach(function (t) { canonicalVisualAliases(t).forEach(function (w) { if (wanted.indexOf(w) === -1) wanted.push(w); }); });
  return keys.some(function (k) { return wanted.some(function (w) { return k === w || k.indexOf(w) > -1 || w.indexOf(k) > -1; }); });
}

export function isButtonLikeHitbox(hb) {
  const kind = bindingField(hb, "kind").toLowerCase();
  const axis = bindingField(hb, "switchAxis").toUpperCase();
  return kind === "button" || axis === "BUTTON" || String(hb.type || "").toLowerCase().indexOf("button") > -1;
}

/* sourceExactFamilySpecFor — null when the hitbox has no sprite family. */
export function familySpecFor(hb) {
  const role = resolveVisualHostRole(hb);
  if (role === ROLE.INSTRUMENT || role === ROLE.DISPLAY) return null;
  if (role === ROLE.ANNUNCIATOR && isDirectAnnunciatorHost(hb)) return null;
  if (role === ROLE.REGION || role === ROLE.CONTROL || role === ROLE.UNKNOWN) {
    const keys = cockpitVisualKeys(hb);
    const blocked = keys.some(function (k) {
      return k === "AI" || k === "DI" || k.indexOf("GAUGE") > -1 || k.indexOf("DOCUMENTS_EFB") > -1 || k.indexOf("CIRCUIT_BREAKER_PANEL") > -1 ||
        k.indexOf("AVIONICS_PANEL") > -1 || k.indexOf("DISPLAY") > -1 || k.indexOf("INSTRUMENT") > -1;
    });
    if (blocked) return null;
  }
  for (let i = 0; i < FAMILY_RULES.length; i += 1) {
    const rule = FAMILY_RULES[i];
    if (hasToken(hb, rule.tokens)) return { family: rule.family, preferredStates: rule.states.slice() };
  }
  if (isButtonLikeHitbox(hb)) return { family: "switch_button", preferredStates: ["released", "pressed", "default"] };
  if (role === ROLE.CONTROL) return { family: "two_toggle_large", preferredStates: TWO_TOGGLE.slice() };
  return null;
}

/* Family directory search order relative to the cockpit asset root. */
export function familyDirs(variantLower, family) {
  return ["cockpit/source_exact/" + variantLower + "/" + family, "cockpit/source_exact/shared/" + family, "cockpit/source_exact/" + family];
}

/* Default file among a folder's files (lower-cased stems) for the preferred states. */
export function pickDefaultState(preferredStates, availableStems) {
  for (let i = 0; i < preferredStates.length; i += 1) {
    const s = preferredStates[i];
    if (availableStems.indexOf(s) > -1) return s;
    if (availableStems.indexOf(s.toUpperCase()) > -1) return s.toUpperCase();
    if (availableStems.indexOf(s.toLowerCase()) > -1) return s.toLowerCase();
  }
  return availableStems.length ? availableStems[0] : null;
}

/* ------------------------------------------------ calibration overrides */
const CAL_ROWS = [
  { tokens: ["POWER_LEVER_L", "POWER_LEVER_R"], w: 0.8, h: 0.8, mul: 1, ox: 0, oy: -2 },
  { tokens: ["PROP_LEVER_L", "PROP_LEVER_R"], w: 1, h: 1, mul: 1, ox: 0, oy: -2 },
  { tokens: ["FUEL_LEVER_L", "FUEL_LEVER_R"], w: 1.15, h: 1.15, mul: 1, ox: 0, oy: -1 },
  { tokens: ["AUTOFEATHER_SELECT"], w: 1, h: 1, mul: 1, ox: 0, oy: 0 },
  { tokens: ["IGNITION_ARM"], w: 1, h: 1, mul: 1, ox: 0, oy: 0 },
  { tokens: ["FUEL_SELECTOR"], w: 1, h: 1, mul: 1, ox: 0, oy: 0 },
  { tokens: ["CHECKLIST", "CHECKLIST_CLOSE"], w: 1, h: 1, mul: 1, ox: 0, oy: 0 },
  { tokens: ["STAB_DEICE_L", "STAB_DEICE_R"], w: 0.8, h: 0.8, mul: 1, ox: 0, oy: 0.8 },
  { tokens: ["LANDING_LIGHT_L", "LANDING_LIGHT_R"], w: 1, h: 1, mul: 1, ox: 0, oy: 0 },
  { tokens: ["FLAP_SELECTOR"], w: 1, h: 1, mul: 1, ox: 0, oy: 0 },
  { tokens: ["STBY_BOOST_PUMP_AFT", "STBY_BOOST_PUMP_FWD", "AFT_BOOST_PUMP", "FWD_BOOST_PUMP", "FUEL_SOV", "FUEL_SHUTOFF", "EMERG_FUEL_SHUTOFF", "EMERG_FUEL_SHUTOFF_L", "EMERG_FUEL_SHUTOFF_R", "FIRE_PUSH_SWITCH_L", "FIRE_PUSH_SWITCH_R"], w: 1, h: 1, mul: 1, ox: 0, oy: 0 },
  { tokens: ["BUS_TIE", "L_DC_GEN", "R_DC_GEN", "ANTI_ICE", "INTAKE_ANTI_ICE", "PROP_DEICE", "DEICE_BOOTS_PWR", "DEICE_BOOTS_STAB", "DEICE_BOOTS_AREA", "DEICE_BOOTS_INT", "DEICE_BOOTS_VALVE", "INTAKE_DEFL", "WING_INSPECT", "AVIONICS_MASTER", "AC_FUNCT", "AC_PWR", "TEMP_CONT_MODE", "TEMP_CONT", "CABIN_DIM", "CABIN_ENTRANCE", "CABIN_READING", "PITOT_HEAT_SWITCH", "ANTI-COL_LIGHTS", "ANTI_COL_LIGHTS", "CAUT_LT_TEST", "CAUT_LIGHT_TEST", "TAXI_LIGHT", "CAUT_LT", "FASTEN_SEATBELT", "FASTEN_SEATBELTS", "POS_LIGHTS", "FLIGHT_COMP", "BEACON", "BLEED_AIR_L", "BLEED_AIR_R", "NO_SMOKING", "NO_SMOKING_LIGHTS", "WINDSHIELD_HEAT", "WINDSHIELD_MODE", "WINDSHIELD_POWER", "WINDSHIELD_WASHER", "LOAD_METER", "BATTERY_MASTER", "STBY_BATTERY", "STARTER_SWITCH", "IGNITER_L", "IGNITER_R"], w: 0.8, h: 0.8, mul: 0.8, ox: 0, oy: 0 },
  { tokens: ["FIRE_PUSH_SWITCH", "FIRE_HANDLE", "FIRE_HANDLE_L", "FIRE_HANDLE_R", "FIRE_DETECT_TEST"], w: 1, h: 1, mul: 1, ox: 0, oy: 0 }
];

export function calibrationFor(hb) {
  for (let i = 0; i < CAL_ROWS.length; i += 1) {
    if (hasToken(hb, CAL_ROWS[i].tokens)) { const r = CAL_ROWS[i]; return { w: r.w, h: r.h, mul: r.mul, ox: r.ox, oy: r.oy }; }
  }
  if (bindingField(hb, "switchId")) return { w: 1, h: 1, mul: 1, ox: 0, oy: 0 };
  return null;
}

/* buildCanonicalControlSpritePack scale maths (§3.7). content = default file opaque bounds. */
export function spriteScale(hb, refW, refH, contentW, contentH, override) {
  const cw = Math.max(1, contentW), ch = Math.max(1, contentH);
  let calibrated = null;
  if (override) {
    const fw = override.w, fh = override.h;
    const ws = Number.isFinite(fw) && fw > 0 ? Math.max(0.01, (hb.rect.w * refW * Math.min(3, Math.max(0.05, fw))) / cw) : null;
    const hs = Number.isFinite(fh) && fh > 0 ? Math.max(0.01, (hb.rect.h * refH * Math.min(3, Math.max(0.05, fh))) / ch) : null;
    if (ws != null && hs != null) calibrated = Math.min(ws, hs); else if (ws != null) calibrated = ws; else if (hs != null) calibrated = hs;
  }
  const fitW = Math.max(0.01, (hb.rect.w * refW) / cw);
  const fitH = Math.max(0.01, (hb.rect.h * refH) / ch);
  const autoScale = calibrated != null ? calibrated : Math.min(fitW, fitH) * 0.92;
  return autoScale * (override ? override.mul : 1);
}

/* CockpitScreen.spriteScaleOverride (live only; snapshot uses 1). */
export function liveScaleOverride(id) {
  if (id === "POWER_LEVER_L" || id === "POWER_LEVER_R") return 1.2;
  if (id === "IGNITION_ARM") return 0.82;
  return 1;
}

/* ------------------------------------------------------- draw ordering */
export function drawScore(hb) {
  let s = 0;
  const type = String(hb.type || "").toLowerCase();
  if (bindingField(hb, "kind")) s += 4;
  if (bindingField(hb, "leverId")) s += 5;
  if (bindingField(hb, "switchId")) s += 5;
  if (type.indexOf("lever") > -1) s += 3;
  if (type.indexOf("switch") > -1) s += 3;
  if (type.indexOf("button") > -1) s += 2;
  return s;
}

export function sortForDraw(hitboxes) {
  return hitboxes.map(function (hb, i) { return { hb: hb, i: i, s: drawScore(hb) }; }).sort(function (a, b) { return b.s - a.s || a.i - b.i; }).map(function (x) { return x.hb; });
}

export function isLeverHitbox(hb) { return bindingField(hb, "kind").toLowerCase() === "lever" || Boolean(bindingField(hb, "leverId")) || String(hb.type || "").toLowerCase().indexOf("lever") > -1; }
export function isSwitchHitbox(hb) {
  const kind = bindingField(hb, "kind").toLowerCase();
  const type = String(hb.type || "").toLowerCase();
  return kind === "switch" || Boolean(bindingField(hb, "switchId")) || type.indexOf("switch") > -1 || kind === "button" || kind === "action" || type.indexOf("button") > -1;
}

export const SPRITE_RENDER_OFFSETS = {
  POWER_LEVER_L: { x: 0, y: -4 }, POWER_LEVER_R: { x: 0, y: -4 }, PROP_LEVER_L: { x: 0, y: -4 }, PROP_LEVER_R: { x: 0, y: -4 },
  FUEL_LEVER_L: { x: 0, y: -3 }, FUEL_LEVER_R: { x: 0, y: -3 }, FLAP_SELECTOR: { x: 0, y: -2 }
};

/* ------------------------------------------------------ lever placement */
const LEVER_PROFILES = {
  POWER_LEVER_L: { minVisual: 0.04, maxVisual: 0.96, travelMul: 1, keepInside: true, segmented: true, travelHeightFraction: 0.34 },
  POWER_LEVER_R: { minVisual: 0.04, maxVisual: 0.96, travelMul: 1, keepInside: true, segmented: true, travelHeightFraction: 0.34 },
  PROP_LEVER_L: { minVisual: 0.03, maxVisual: 0.97, travelMul: 1, keepInside: true, segmented: false, travelHeightFraction: 0.38 },
  PROP_LEVER_R: { minVisual: 0.03, maxVisual: 0.97, travelMul: 1, keepInside: true, segmented: false, travelHeightFraction: 0.38 },
  FUEL_LEVER_L: { minVisual: 0.06, maxVisual: 0.94, travelMul: 1, keepInside: true, segmented: false, travelHeightFraction: 0.28 },
  FUEL_LEVER_R: { minVisual: 0.06, maxVisual: 0.94, travelMul: 1, keepInside: true, segmented: false, travelHeightFraction: 0.28 },
  FLAP_SELECTOR: { minVisual: 0.08, maxVisual: 0.92, travelMul: 1, keepInside: true, segmented: false, travelHeightFraction: 0.44 }
};
const DEFAULT_PROFILE = { minVisual: 0, maxVisual: 1, travelMul: 1.25, keepInside: false, segmented: false, travelHeightFraction: 1 };

export function defaultLeverRawPosition(id) {
  if (id.indexOf("POWER_LEVER") === 0) return DEFAULT_POWER_LEVER_RAW_01;
  if (id.indexOf("PROP_LEVER") === 0) return DEFAULT_PROP_LEVER_RAW_01;
  if (id.indexOf("FUEL_LEVER") === 0) return DEFAULT_FUEL_LEVER_RAW_01;
  return 0;
}

function lerp(a, b, t) { return a + (b - a) * Math.min(1, Math.max(0, t)); }

export function remapPowerLeverLogical(rawPos) {
  const raw = Math.min(1, Math.max(0, rawPos));
  const idleGate = FLIGHT_IDLE_GATE_01;
  const v = raw <= idleGate ? lerp(0.04, 0.5, raw / idleGate) : lerp(0.5, 0.96, (raw - idleGate) / (1 - idleGate));
  return Math.min(1, Math.max(0, v));
}

/* leverTopLeftForPosition — rect in image px; content sizes/offsets already scaled. */
export function leverTopLeft(hb, leverId, rect, contentW, contentH, contentLeft, contentTop, rawPos) {
  const profile = LEVER_PROFILES[hb.id] || LEVER_PROFILES[leverId] || DEFAULT_PROFILE;
  const logical = profile.segmented ? remapPowerLeverLogical(rawPos) : rawPos;
  const visualPos = profile.minVisual + (profile.maxVisual - profile.minVisual) * Math.min(1, Math.max(0, logical));
  const x = rect.left + (rect.width - contentW) * 0.5 - contentLeft;
  const safeH = rect.height > 0 ? rect.height : 1;
  const requested = contentH * profile.travelHeightFraction;
  let travel;
  if (requested <= 0) travel = 1; else if (safeH < 1) travel = Math.max(requested, 1); else travel = Math.min(Math.max(requested, 1), safeH);
  const top = rect.top, bottom = rect.top + rect.height;
  let centerY;
  if (profile.keepInside) {
    const a = top + travel / 2, b = bottom - travel / 2;
    const cMin = Math.min(a, b), cMax = Math.max(a, b);
    centerY = cMax - (cMax - cMin) * visualPos;
  } else {
    const extra = Math.max(0, safeH * (profile.travelMul - 1));
    const a = (top - extra / 2) + travel / 2, b = (bottom + extra / 2) - travel / 2;
    const cMin = Math.min(a, b), cMax = Math.max(a, b);
    centerY = cMax - (cMax - cMin) * visualPos;
  }
  return { x: x, y: centerY - contentH * 0.5 - contentTop };
}

/* ---------------------------------------------- switch state → sprite key */
export function normalizeVisualStateKey(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

const POSITION_ALIASES = {
  left: ["left", "start_left", "left_down", "load_left", "both_fwd", "fwd", "up", "on"],
  right: ["right", "start_right", "right_down", "load_right", "both_aft", "aft", "down", "on", "off"],
  center: ["center", "neutral", "default", "off", "released"],
  default: ["default", "center", "neutral", "off", "released"],
  left_down: ["left_down", "left", "down", "on"], right_down: ["right_down", "right", "down", "on"],
  start_left: ["start_left", "left", "on", "pressed"], start_right: ["start_right", "right", "on", "pressed"],
  load_left: ["load_left", "left", "up"], load_right: ["load_right", "right", "down"],
  both_fwd: ["both_fwd", "fwd", "left", "up"], both_aft: ["both_aft", "aft", "right", "down"],
  fwd: ["fwd", "both_fwd", "left", "up"], aft: ["aft", "both_aft", "right", "down"],
  slow: ["slow", "on", "up", "left"], fast: ["fast", "on", "down", "right"], test: ["test", "pressed", "up", "on"],
  one: ["one", "up", "left", "on"], two: ["two", "down", "right", "on"], both: ["both", "center", "default", "on"],
  on: ["on", "up", "pressed", "active"], off: ["off", "default", "center", "released"],
  manual: ["manual", "left", "on"], armed: ["armed", "right", "on"]
};
function expandPosition(key) { return POSITION_ALIASES[key] ? POSITION_ALIASES[key].slice() : [key]; }

const FALLBACK_KEYS = {
  LEFT: ["left", "start_left", "left_down", "load_left", "both_fwd", "fwd", "manual", "on", "up", "open", "armed", "enabled", "pressed", "default"],
  RIGHT: ["right", "start_right", "right_down", "load_right", "both_aft", "aft", "armed", "off", "down", "closed", "disengaged", "disabled", "released", "default"],
  CENTER: ["center", "neutral", "default", "off", "released"],
  UP: ["up", "left", "start_left", "left_down", "load_left", "on", "open", "armed", "enabled", "pressed", "default"],
  DOWN: ["down", "right", "start_right", "right_down", "load_right", "off", "closed", "disengaged", "disabled", "released", "default"],
  MOMENTARY: ["momentary", "pressed", "active", "on", "start_left", "start_right", "default"]
};

export function visualStateKeysForSwitchState(state, hb) {
  const positions = ((hb.binding && hb.binding.switchPositions) || []).map(normalizeVisualStateKey);
  let explicit = [];
  const st = state || "CENTER";
  if (positions.length >= 3) {
    if (st === "LEFT" || st === "UP") explicit = expandPosition(positions[0]);
    else if (st === "CENTER" || st === "MOMENTARY") explicit = expandPosition(positions[1]);
    else explicit = expandPosition(positions[2]);
  } else if (positions.length === 2) {
    if (st === "RIGHT" || st === "DOWN") explicit = expandPosition(positions[1]); else explicit = expandPosition(positions[0]);
  }
  const all = explicit.concat(FALLBACK_KEYS[st] || FALLBACK_KEYS.CENTER);
  const out = [];
  all.forEach(function (k) { if (out.indexOf(k) === -1) out.push(k); });
  return out;
}

/* ---------------------------------------------- instrument / annunciator assets */
export const MASTER_LAMP_FILES = {
  WARNING: ["warning.png", "WARNING.png", "master_warning.png", "MASTER_WARNING.png"],
  CAUTION: ["caution.png", "CAUTION.png", "master_caution.png", "MASTER_CAUTION.png"]
};
export const MASTER_LAMP_KEYS = {
  WARNING: ["WARNING", "MASTER_WARNING", "MASTER_WARNING_LEFT", "MASTER_WARNING_RIGHT"],
  CAUTION: ["CAUTION", "MASTER_CAUTION", "MASTER_CAUTION_LEFT", "MASTER_CAUTION_RIGHT"]
};

export function instrumentDirs(variantLower) {
  return ["cockpit/source_exact/" + variantLower + "/instruments", "cockpit/source_exact/shared/instruments", "cockpit/source_exact/instruments",
    "cockpit/assets/instruments/" + variantLower, "cockpit/assets/instruments"];
}
export function compositeFallbackDirs(variantLower) {
  return instrumentDirs(variantLower).concat(["cockpit/source_exact/" + variantLower, "cockpit/source_exact/shared", "cockpit/assets/controls/" + variantLower,
    "cockpit/assets/controls", "cockpit/assets/instruments/" + variantLower, "cockpit/assets/instruments"]).concat(instrumentDirs(variantLower));
}
export function annunciatorDirs(variantLower) {
  return ["cockpit/source_exact/" + variantLower + "/annunciators", "cockpit/source_exact/shared/annunciators", "cockpit/source_exact/annunciators",
    "cockpit/assets/annunciators/" + variantLower, "cockpit/assets/annunciators"];
}
export const MFD_KEYS = ["MFD_CENTRE", "MFD_CENTER", "MFD_CENTRE_DISPLAY", "MFD_CENTER_DISPLAY"];
