/*
  Edit State — port of feature-cockpit ui/screens/ScenarioStateToggleEditor.kt
  (ScenarioStateToggleSection, ScenarioToggleOption / ScenarioEditorControlStyle,
  buildAnnunciatorOptions / buildInstrumentOptions / buildControlOptions,
  withCurrentCustomEntries, initialEnabledKeys / initialValuesForOptions,
  withToggleSelection, coerceScenarioEditorValue, scenarioCanonicalKey /
  scenarioCanonicalAnnunciatorKey and the annunciator alias table).

  Pure functions: the screens in screens/scenarioedit.js render them.
*/
import { SCENARIO_ANNUNCIATOR_OVERRIDE_KEY } from "./snapshot.js";
import { annunciatorCatalog, PRIORITY_RANK } from "./cas.js";

export const SECTIONS = ["ANNUNCIATORS", "INSTRUMENTS", "CONTROLS"];

export const STYLE = { STATE_ON_OFF: "STATE_ON_OFF", VALUE_ON_OFF: "VALUE_ON_OFF", NUMERIC_STEPPER: "NUMERIC_STEPPER", ORDERED_STEPPER: "ORDERED_STEPPER", SEGMENTED_CHOICE: "SEGMENTED_CHOICE" };

export const EDITOR_COPY = {
  ANNUNCIATORS: {
    title: "Annunciators / Caution Lights",
    subtitle: "Select which lights or CAS messages are ON for this exact phase. OFF removes the annunciator from the phase snapshot.",
    empty: "No annunciator options are available."
  },
  INSTRUMENTS: {
    title: "Instrument Indications",
    subtitle: "Use the up/down controls to change prepared instrument values. Existing values are loaded automatically.",
    empty: "No instrument options are available."
  },
  CONTROLS: {
    title: "Controls / Configuration",
    subtitle: "Set engine lever positions, switch states, crossfeed position, flaps, trim, and other configuration cues from fixed choices.",
    empty: "No control options are available."
  }
};

/* ------------------------------------------------------------------ keys */
export function canonicalKey(value) {
  return String(value == null ? "" : value).trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

const STATE_SUFFIX = /\s*\((?:warning|caution|advisory|status|safe operating|on|off)\)\s*$/i;
export function stripAnnunciatorStateSuffix(value) { return String(value == null ? "" : value).replace(STATE_SUFFIX, "").trim(); }

export const ANNUNCIATOR_ALIASES = {
  MSTR_CAUT_TEST: "MSTR_CAUT_TEST", MASTER_CAUTION_TEST: "MSTR_CAUT_TEST", MASTER_CAUT_TEST: "MSTR_CAUT_TEST", MSTR_CAUTION_TEST: "MSTR_CAUT_TEST",
  "400_CYCLE_LIGHT": "AC_400_CYCLE", FOUR_HUNDRED_CYCLE_LIGHT: "AC_400_CYCLE",
  DOOR_UNLOCKED: "DOORS_UNLOCKED", DOORS_UNLOCKED: "DOORS_UNLOCKED",
  L_GENERATOR: "L_GEN_FAIL", R_GENERATOR: "R_GEN_FAIL", LEFT_GENERATOR: "L_GEN_FAIL", RIGHT_GENERATOR: "R_GEN_FAIL",
  LEFT_GEN_FAIL: "L_GEN_FAIL", RIGHT_GEN_FAIL: "R_GEN_FAIL",
  L_ENGINE_OIL_PRESS: "L_OIL_PRESS", R_ENGINE_OIL_PRESS: "R_OIL_PRESS", LEFT_ENGINE_OIL_PRESS: "L_OIL_PRESS", RIGHT_ENGINE_OIL_PRESS: "R_OIL_PRESS",
  LEFT_OIL_PRESS: "L_OIL_PRESS", RIGHT_OIL_PRESS: "R_OIL_PRESS",
  RESET_PROP: "RESET_PROPS", RESET_PROPS_LIGHT: "RESET_PROPS",
  AFT_BOOST_1_PR: "AFT_BOOST1_PR", AFT_BOOST_2_PR: "AFT_BOOST2_PR", FWD_BOOST_1_PR: "FWD_BOOST1_PR", FWD_BOOST_2_PR: "FWD_BOOST2_PR",
  AFT_BOOST1_PRESS: "AFT_BOOST1_PR", AFT_BOOST2_PRESS: "AFT_BOOST2_PR", FWD_BOOST1_PRESS: "FWD_BOOST1_PR", FWD_BOOST2_PRESS: "FWD_BOOST2_PR",
  BOOST_PUMP_1_AFT_PRESS: "AFT_BOOST1_PR", BOOST_PUMP_2_AFT_PRESS: "AFT_BOOST2_PR", BOOST_PUMP_1_FWD_PRESS: "FWD_BOOST1_PR", BOOST_PUMP_2_FWD_PRESS: "FWD_BOOST2_PR",
  L_REFUEL_VLV_OPEN: "L_RFUEL_VLV_OPN", R_REFUEL_VLV_OPEN: "R_RFUEL_VLV_OPN",
  LEFT_REFUEL_VALVE_OPEN: "L_RFUEL_VLV_OPN", RIGHT_REFUEL_VALVE_OPEN: "R_RFUEL_VLV_OPN",
  L_REFUEL_VALVE_OPEN: "L_RFUEL_VLV_OPN", R_REFUEL_VALVE_OPEN: "R_RFUEL_VLV_OPN"
};

export function canonicalAnnunciatorKey(value) {
  const key = canonicalKey(stripAnnunciatorStateSuffix(value));
  return ANNUNCIATOR_ALIASES[key] || key;
}

export function humanLabel(key) {
  return String(key || "").replace(/_/g, " ").toLowerCase().split(" ").filter(Boolean)
    .map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(" ");
}

const OVERRIDE_ALIASES = ["SNAPSHOT_ANNUNCIATORS_OVERRIDE", "SNAPSHOT_ANNUNCIATOR_OVERRIDE", "ANNUNCIATOR_OVERRIDE", "ANNUNCIATORS_OVERRIDE", "ANNUNCIATOR_OVERRIDES", "ANNUNCIATORS_OVERRIDES"];
export function isAnnunciatorOverrideControl(key) { return OVERRIDE_ALIASES.indexOf(canonicalKey(key)) > -1; }

/* --------------------------------------------------------------- numbers */
export function extractNumber(value) {
  const m = String(value == null ? "" : value).match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}
export function formatNumber(value) {
  if (value % 1 === 0) return String(Math.trunc(value));
  return value.toFixed(1).replace(/0+$/, "").replace(/\.$/, "");
}

/* --------------------------------------------------------------- options */
function option(o) {
  return { category: o.category, key: o.key, label: o.label, defaultValue: o.defaultValue == null ? "ON" : o.defaultValue,
    style: o.style || STYLE.STATE_ON_OFF, choices: o.choices || [], step: o.step == null ? 1 : o.step,
    minimum: o.minimum == null ? null : o.minimum, maximum: o.maximum == null ? null : o.maximum };
}

const CAS_CATEGORY = { WARNING: "Warnings", CAUTION: "Cautions", ADVISORY: "Advisories", STATUS: "Status / Advisory Lights" };

export function buildAnnunciatorOptions(phaseState) {
  const current = new Set((phaseState.annunciators || []).map(canonicalAnnunciatorKey).filter(Boolean));
  const profileOptions = annunciatorCatalog()
    .slice()
    .sort(function (a, b) { return (PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]) || a.displayText.localeCompare(b.displayText); })
    .map(function (entry) {
      return option({ category: CAS_CATEGORY[entry.priority] || "Advisories", key: entry.stableId, label: entry.displayText, defaultValue: "ON" });
    });
  const known = new Set(profileOptions.map(function (o) { return o.key; }));
  const customOnly = Array.from(current).filter(function (id) { return !known.has(id); })
    .map(function (id) { return option({ category: "Current custom items", key: id, label: humanLabel(id), defaultValue: "ON" }); });
  return profileOptions.concat(customOnly);
}

function gauge(category, key, label, defaultValue, step, minimum, maximum) {
  return option({ category: category, key: key, label: label, defaultValue: defaultValue, style: STYLE.NUMERIC_STEPPER, step: step, minimum: minimum, maximum: maximum });
}

export function buildInstrumentOptions(phaseState) {
  const standard = [
    gauge("Engine gauges", "TORQUE_L", "Torque L", "0", 1, 0, 50),
    gauge("Engine gauges", "TORQUE_R", "Torque R", "0", 1, 0, 50),
    gauge("Engine gauges", "NG_L", "NG L", "52", 1, 0, 105),
    gauge("Engine gauges", "NG_R", "NG R", "52", 1, 0, 105),
    gauge("Engine gauges", "NP_L", "NP L", "82", 0.5, 0, 101.5),
    gauge("Engine gauges", "NP_R", "NP R", "82", 0.5, 0, 101.5),
    gauge("Engine gauges", "T5_L", "T5 L", "350", 10, 0, 1100),
    gauge("Engine gauges", "T5_R", "T5 R", "350", 10, 0, 1100),
    gauge("Engine gauges", "FUEL_FLOW_L", "Fuel Flow L", "300", 25, 0, 1000),
    gauge("Engine gauges", "FUEL_FLOW_R", "Fuel Flow R", "300", 25, 0, 1000),
    gauge("Engine gauges", "L_ENGINE_OIL_PRESS", "Oil Press L", "80", 5, 0, 120),
    gauge("Engine gauges", "OIL_PRESS_R", "Oil Press R", "80", 5, 0, 120),
    gauge("Engine gauges", "OIL_TEMP_L", "Oil Temp L", "55", 5, -40, 120),
    gauge("Engine gauges", "OIL_TEMP_R", "Oil Temp R", "55", 5, -40, 120),
    gauge("Fuel / electrical", "FUEL_QUANTITY_L", "Fuel Quantity L", "500", 50, 0, 1500),
    gauge("Fuel / electrical", "FUEL_QUANTITY_R", "Fuel Quantity R", "500", 50, 0, 1500),
    gauge("Fuel / electrical", "VDC_GAUGE", "VDC Gauge", "24", 1, 0, 32),
    gauge("Fuel / electrical", "HYDRAULIC_PRESS_GAUGE", "Hydraulic Press Gauge", "1600", 100, 0, 2500),
    gauge("Flight / status", "AIRSPEED", "Airspeed", "0", 5, 0, 200),
    gauge("Flight / status", "ALTITUDE", "Altitude", "0", 100, -1000, 25000),
    gauge("Flight / status", "VERTICAL_SPEED", "Vertical Speed", "0", 100, -3000, 3000),
    option({ category: "Flight / status", key: "WOW", label: "Weight On Wheels", defaultValue: "ON", style: STYLE.VALUE_ON_OFF })
  ];
  return withCurrentCustomEntries(standard, phaseState.instruments || {}, "Current custom indications");
}

export function buildControlOptions(phaseState) {
  function lever(key, label, defaultValue, choices) {
    return option({ category: "Engine levers", key: key, label: label, defaultValue: defaultValue, style: STYLE.ORDERED_STEPPER, choices: choices });
  }
  function switchOption(key, label, defaultValue) {
    return option({ category: "Electrical / fuel switches", key: key, label: label, defaultValue: defaultValue || "OFF", style: STYLE.VALUE_ON_OFF });
  }
  const powerLeverChoices = ["REVERSE", "IDLE", "DESCENT", "CRUISE", "CLIMB", "MAX"];
  const propLeverChoices = ["FEATHER", "COARSE", "FINE"];
  const fuelLeverChoices = ["OFF", "ON"];
  const standard = [
    lever("POWER_LEVER_L", "Power Lever L", "IDLE", powerLeverChoices),
    lever("POWER_LEVER_R", "Power Lever R", "IDLE", powerLeverChoices),
    lever("PROP_LEVER_L", "Prop Lever L", "FEATHER", propLeverChoices),
    lever("PROP_LEVER_R", "Prop Lever R", "FEATHER", propLeverChoices),
    lever("FUEL_LEVER_L", "Fuel Lever L", "ON", fuelLeverChoices),
    lever("FUEL_LEVER_R", "Fuel Lever R", "ON", fuelLeverChoices),
    switchOption("AUTOFEATHER_ARM", "Autofeather Arm"),
    switchOption("AUTOFEATHER_SELECT", "Autofeather Select"),
    switchOption("BATTERY_MASTER", "Battery Master"),
    switchOption("L_DC_GEN", "L DC Generator"),
    switchOption("R_DC_GEN", "R DC Generator"),
    switchOption("FWD_BOOST1", "Fwd Boost 1"),
    switchOption("FWD_BOOST2", "Fwd Boost 2"),
    switchOption("AFT_BOOST1", "Aft Boost 1"),
    switchOption("AFT_BOOST2", "Aft Boost 2"),
    option({ category: "Electrical / fuel switches", key: "CROSSFEED", label: "Crossfeed", defaultValue: "NEUTRAL", style: STYLE.SEGMENTED_CHOICE, choices: ["FWRD", "NEUTRAL", "AFT"] }),
    option({ category: "Flight configuration", key: "FLAPS", label: "Flaps", defaultValue: "0", style: STYLE.ORDERED_STEPPER, choices: ["0", "10", "20", "30", "37.5"] }),
    option({ category: "Flight configuration", key: "TRIM", label: "Trim", defaultValue: "NEUTRAL", style: STYLE.SEGMENTED_CHOICE, choices: ["NEUTRAL", "LEFT", "RIGHT", "UP", "DOWN"] }),
    option({ category: "Flight configuration", key: "PARKING_BRAKE", label: "Parking Brake", defaultValue: "OFF", style: STYLE.VALUE_ON_OFF }),
    option({ category: "Flight configuration", key: "PITOT_HEAT", label: "Pitot Heat", defaultValue: "OFF", style: STYLE.VALUE_ON_OFF }),
    option({ category: "Flight configuration", key: "EXTERIOR_LIGHTS", label: "Exterior Lights", defaultValue: "OFF", style: STYLE.VALUE_ON_OFF })
  ];
  return withCurrentCustomEntries(standard, phaseState.controls || {}, "Current custom controls");
}

export function withCurrentCustomEntries(options, values, category) {
  const known = new Set(options.map(function (o) { return o.key; }));
  const seen = new Set();
  const custom = [];
  Object.keys(values || {}).forEach(function (rawKey) {
    if (isAnnunciatorOverrideControl(rawKey)) return;
    const key = canonicalKey(rawKey);
    if (!key || known.has(key) || seen.has(key)) return;
    seen.add(key);
    const raw = String(values[rawKey] == null ? "" : values[rawKey]).trim();
    custom.push(option({
      category: category, key: key, label: humanLabel(key), defaultValue: raw || "ON",
      style: category.toLowerCase().indexOf("indication") > -1 ? STYLE.NUMERIC_STEPPER : STYLE.VALUE_ON_OFF
    }));
  });
  return options.concat(custom);
}

export function buildToggleOptions(section, phaseState) {
  if (section === "ANNUNCIATORS") return buildAnnunciatorOptions(phaseState);
  if (section === "INSTRUMENTS") return buildInstrumentOptions(phaseState);
  return buildControlOptions(phaseState);
}

/* --------------------------------------------------------- initial state */
export function initialEnabledKeys(section, phaseState, options) {
  if (section === "ANNUNCIATORS") {
    return new Set((phaseState.annunciators || []).map(canonicalAnnunciatorKey).filter(Boolean));
  }
  return new Set(options.map(function (o) { return o.key; }).filter(Boolean));
}

export function initialValues(section, phaseState, options) {
  const existing = {};
  if (section === "INSTRUMENTS" || section === "CONTROLS") {
    const source = section === "INSTRUMENTS" ? (phaseState.instruments || {}) : (phaseState.controls || {});
    Object.keys(source).forEach(function (k) { existing[canonicalKey(k)] = source[k]; });
  }
  const out = {};
  options.forEach(function (o) { out[o.key] = coerceValue(o, existing[o.key] != null ? existing[o.key] : o.defaultValue); });
  return out;
}

export function coerceValue(o, value) {
  const raw = String(value == null ? "" : value).trim() || o.defaultValue;
  if (o.style === STYLE.VALUE_ON_OFF) {
    return ["ON", "OFF"].some(function (s) { return s.toLowerCase() === raw.toLowerCase(); }) ? raw.toUpperCase() : o.defaultValue;
  }
  if (o.style === STYLE.SEGMENTED_CHOICE || o.style === STYLE.ORDERED_STEPPER) {
    const hit = o.choices.find(function (c) { return c.toLowerCase() === raw.toLowerCase(); });
    return hit == null ? o.defaultValue : hit;
  }
  if (o.style === STYLE.NUMERIC_STEPPER) {
    const n = extractNumber(raw);
    return n == null ? o.defaultValue : formatNumber(n);
  }
  return raw;
}

/* ------------------------------------------------------------- stepping */
export function stepOrdered(o, value, direction) {
  const idx = o.choices.findIndex(function (c) { return c.toLowerCase() === String(value || "").toLowerCase(); });
  const safe = idx >= 0 ? idx : 0;
  const next = direction > 0 ? Math.min(o.choices.length - 1, safe + 1) : Math.max(0, safe - 1);
  return o.choices[next];
}

export function stepNumeric(o, value, direction) {
  const current = extractNumber(value);
  const base = current == null ? 0 : current;
  let next = base + direction * o.step;
  if (o.minimum != null) next = Math.max(o.minimum, next);
  if (o.maximum != null) next = Math.min(o.maximum, next);
  return formatNumber(Math.round(next * 1000) / 1000);
}

/* ----------------------------------------------------------- apply/save */
export function withToggleSelection(phaseState, section, options, enabledKeys, valuesByKey) {
  const next = { annunciators: (phaseState.annunciators || []).slice(), instruments: Object.assign({}, phaseState.instruments), controls: Object.assign({}, phaseState.controls), notes: phaseState.notes };
  function valueFor(o) {
    const raw = valuesByKey[o.key];
    const trimmed = raw == null ? "" : String(raw).trim();
    return coerceValue(o, trimmed || o.defaultValue);
  }
  if (section === "ANNUNCIATORS") {
    next.annunciators = options.filter(function (o) { return enabledKeys.has(o.key); }).map(function (o) { return o.key; })
      .filter(function (k, i, arr) { return arr.indexOf(k) === i; });
    next.controls[SCENARIO_ANNUNCIATOR_OVERRIDE_KEY] = "ON";
    return next;
  }
  if (section === "INSTRUMENTS") {
    const instruments = {};
    options.forEach(function (o) { const v = valueFor(o); if (v) instruments[o.key] = v; });
    next.instruments = instruments;
    return next;
  }
  const controls = {};
  Object.keys(phaseState.controls || {}).forEach(function (k) { if (isAnnunciatorOverrideControl(k)) controls[k] = phaseState.controls[k]; });
  options.forEach(function (o) { const v = valueFor(o); if (v) controls[o.key] = v; });
  next.controls = controls;
  return next;
}

export function toSnapshotAnnunciatorIds(list) {
  const out = [];
  (list || []).forEach(function (v) {
    const key = canonicalAnnunciatorKey(String(v || "").trim());
    if (key && out.indexOf(key) === -1) out.push(key);
  });
  return out;
}

export function toSnapshotScenarioMap(map) {
  const out = {};
  Object.keys(map || {}).forEach(function (k) {
    const key = canonicalKey(k);
    const value = String(map[k] == null ? "" : map[k]).trim();
    if (key && value) out[key] = value;
  });
  return out;
}

/* The override payload the ScenarioSnapshotRegistry reads back (annunciators are
   objects, never bare strings — the Android parser drops bare strings, QUIRK-4). */
export function phaseOverridePayload(phaseState) {
  return {
    annunciators: toSnapshotAnnunciatorIds(phaseState.annunciators).map(function (id) { return { id: id, level: "ON" }; }),
    instruments: toSnapshotScenarioMap(phaseState.instruments),
    controls: toSnapshotScenarioMap(phaseState.controls),
    notes: phaseState.notes == null ? null : String(phaseState.notes)
  };
}
