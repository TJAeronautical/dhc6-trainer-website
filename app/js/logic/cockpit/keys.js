/*
  Cockpit visual keys — port of feature-cockpit ui/CanonicalVisualStatePolicy.kt
  (canonicalVisualKey, canonicalVisualAliases, visualKeysMatch, cockpitVisualKeys,
  resolveCockpitVisualHostRole, visualOverlayCandidateIds).

  Pure functions shared by the browser renderer and the build tools.
*/

const NON_VISUAL = /[^A-Z0-9]+/g;
const REPEATED_UNDERSCORE = /_+/g;

export function canonicalVisualKey(raw) {
  let s = String(raw == null ? "" : raw).trim().toUpperCase();
  const idx = s.lastIndexOf(".PNG");
  if (idx >= 0) s = s.slice(0, idx);
  s = s.replace(NON_VISUAL, "_").replace(REPEATED_UNDERSCORE, "_");
  return s.replace(/^_+|_+$/g, "");
}

export const ANNUNCIATOR_HOST_ALIASES = {
  AFT_BOOST1_PR: ["BOOST_PUMP_1_AFT_PRESS"],
  AFT_BOOST2_PR: ["BOOST_PUMP_2_AFT_PRESS"],
  AFT_FUEL_LOW: ["AFT_FUEL_LOW_LEVEL"],
  FWD_BOOST1_PR: ["BOOST_PUMP_1_FWD_PRESS"],
  FWD_BOOST2_PR: ["BOOST_PUMP_2_FWD_PRESS"],
  FWD_FUEL_LOW: ["FWD_FUEL_LOW_LEVEL"],
  L_GEN_FAIL: ["L_GENERATOR", "LEFT_GENERATOR", "LEFT_GENERATOR_FAIL"],
  L_GEN_OVHT: ["L_GENERATOR_OVERHEAT", "LEFT_GENERATOR_OVERHEAT"],
  L_OIL_PRESS: ["L_ENGINE_OIL_PRESS", "LEFT_ENGINE_OIL_PRESS", "LEFT_OIL_PRESS"],
  PNU_LOW_PRESS: ["PNEUMATIC_LOW_PRESSURE", "PNEU_LOW_PRESS", "PNEUMATIC_LOW_PRESS"],
  R_GEN_FAIL: ["R_GENERATOR", "RIGHT_GENERATOR", "RIGHT_GENERATOR_FAIL"],
  R_GEN_OVHT: ["R_GENERATOR_OVERHEAT", "RIGHT_GENERATOR_OVERHEAT"],
  R_OIL_PRESS: ["R_ENGINE_OIL_PRESS", "RIGHT_ENGINE_OIL_PRESS", "RIGHT_OIL_PRESS"],
  MASTER_WARNING: ["WARNING", "MASTER_WARNING_LEFT", "MASTER_WARNING_RIGHT", "MSTR_WARN"],
  MASTER_CAUTION: ["CAUTION", "MASTER_CAUTION_LEFT", "MASTER_CAUTION_RIGHT", "MSTR_CAUT"]
};

const STBY_ALIASES = ["STBY_INST", "STBY_INSTR", "STANDBY_INST", "STANDBY_INSTR"];

/* LinkedHashSet semantics: insertion order preserved. */
export function canonicalVisualAliases(raw) {
  const key = canonicalVisualKey(raw);
  const out = [];
  function add(v) { if (v && out.indexOf(v) === -1) out.push(v); }
  if (!key) return out;
  add(key);
  if (key === "MFD_CENTRE") add("MFD_CENTER");
  if (key === "MFD_CENTER") add("MFD_CENTRE");
  if (key === "MFD_CENTRE_DISPLAY") add("MFD_CENTER_DISPLAY");
  if (key === "MFD_CENTER_DISPLAY") add("MFD_CENTRE_DISPLAY");
  if (STBY_ALIASES.indexOf(key) > -1) STBY_ALIASES.forEach(add);
  (ANNUNCIATOR_HOST_ALIASES[key] || []).forEach(function (a) { add(canonicalVisualKey(a)); });
  Object.keys(ANNUNCIATOR_HOST_ALIASES).forEach(function (canonical) {
    const aliases = ANNUNCIATOR_HOST_ALIASES[canonical];
    if (key === canonical || aliases.indexOf(key) > -1) {
      add(canonical);
      aliases.forEach(add);
    }
  });
  return out;
}

export function visualKeysMatch(a, b) {
  const ka = canonicalVisualKey(a);
  const kb = canonicalVisualKey(b);
  if (!ka || !kb) return false;
  return ka === kb || ka.indexOf(kb) > -1 || kb.indexOf(ka) > -1;
}

function bindingField(hb, name) {
  return hb && hb.binding && hb.binding[name] ? String(hb.binding[name]) : "";
}

/* Union of aliases over id, action, switchId, leverId, instrumentId, displayId, regionId. */
export function cockpitVisualKeys(hb) {
  const out = [];
  [hb.id, bindingField(hb, "action"), bindingField(hb, "switchId"), bindingField(hb, "leverId"), bindingField(hb, "instrumentId"), bindingField(hb, "displayId"), bindingField(hb, "regionId")]
    .forEach(function (raw) { canonicalVisualAliases(raw).forEach(function (k) { if (out.indexOf(k) === -1) out.push(k); }); });
  return out;
}

function isFireControlKey(k) {
  return k.indexOf("FIRE_HANDLE") > -1 || k.indexOf("FIRE_PUSH_SWITCH") > -1 || k.indexOf("FIRE_DETECT_TEST") > -1;
}

export function isDirectAnnunciatorHost(hb) {
  const keys = cockpitVisualKeys(hb);
  if (keys.some(isFireControlKey)) return false;
  return keys.some(function (k) {
    return k.indexOf("ANNUNCIATOR") > -1 || k.indexOf("WARNING") > -1 || k.indexOf("CAUTION") > -1 || k.indexOf("MASTER_WARNING") > -1 ||
      k.indexOf("MASTER_CAUTION") > -1 || k.indexOf("MSTR_WARN") > -1 || k.indexOf("MSTR_CAUT") > -1 || k.indexOf("FIRE") > -1 || k.indexOf("LAMP") > -1;
  });
}

export const ROLE = { CONTROL: "CONTROL", ANNUNCIATOR: "ANNUNCIATOR", INSTRUMENT: "INSTRUMENT", DISPLAY: "DISPLAY", REGION: "REGION", UNKNOWN: "UNKNOWN" };

export function resolveVisualHostRole(hb) {
  const kind = bindingField(hb, "kind").toLowerCase();
  const type = String(hb.type || "").toLowerCase();
  const keys = cockpitVisualKeys(hb);
  if (keys.some(function (k) { return k === "CHECKLIST" || k === "CHECKLIST_CLOSE" || k === "CHECKLISTCLOSE"; })) return ROLE.CONTROL;
  if (keys.some(isFireControlKey)) return ROLE.CONTROL;
  if (kind === "annunciator" || type.indexOf("annunciator") > -1) return ROLE.ANNUNCIATOR;
  if (isDirectAnnunciatorHost(hb)) return ROLE.ANNUNCIATOR;
  if (keys.some(function (k) { return k.indexOf("CIRCUIT_BREAKER_PANEL") > -1 || k.indexOf("AVIONICS_PANEL") > -1; })) return ROLE.REGION;
  if (kind === "display" || type === "display") return ROLE.DISPLAY;
  if (kind === "region" || type === "region") return ROLE.REGION;
  if (kind === "instrument" || kind === "gauge" || type === "instrument" || type === "gauge") return ROLE.INSTRUMENT;
  if (kind === "switch" || kind === "lever" || kind === "button" || kind === "action" || bindingField(hb, "switchId") || bindingField(hb, "leverId") ||
    type.indexOf("switch") > -1 || type.indexOf("lever") > -1 || type.indexOf("button") > -1) return ROLE.CONTROL;
  return ROLE.UNKNOWN;
}

export function isInstrumentVisualHost(hb) {
  const role = resolveVisualHostRole(hb);
  return role === ROLE.INSTRUMENT || role === ROLE.DISPLAY || role === ROLE.REGION;
}

export function isAnnunciatorVisualHost(hb) { return resolveVisualHostRole(hb) === ROLE.ANNUNCIATOR; }

/* Ordered candidate ids for asset lookup, expanded through the alias table. */
export function visualOverlayCandidateIds(hb) {
  const role = resolveVisualHostRole(hb);
  const id = hb.id;
  const action = bindingField(hb, "action"), switchId = bindingField(hb, "switchId"), leverId = bindingField(hb, "leverId");
  const instrumentId = bindingField(hb, "instrumentId"), displayId = bindingField(hb, "displayId"), regionId = bindingField(hb, "regionId");
  let raw;
  if (role === ROLE.ANNUNCIATOR) raw = [id, action, switchId, regionId, instrumentId, displayId];
  else if (role === ROLE.INSTRUMENT) raw = [instrumentId, id, displayId, regionId];
  else if (role === ROLE.DISPLAY) raw = [displayId, id, instrumentId, regionId];
  else if (role === ROLE.REGION) raw = [regionId, id, displayId, instrumentId];
  else raw = [id, action, switchId, leverId, instrumentId, displayId, regionId];
  const out = [];
  raw.forEach(function (r) { canonicalVisualAliases(r).forEach(function (k) { if (out.indexOf(k) === -1) out.push(k); }); });
  return out;
}

/* humanizeKey (ProcedureScenarioStateBundleFactory): "L_GEN_FAIL" -> "L Gen Fail". */
export function humanizeKey(id) {
  return String(id || "").replace(/_/g, " ").toLowerCase().split(" ").filter(Boolean)
    .map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(" ");
}

/* canonicalScenarioInstrumentKey: "Ng L" -> "NG_L". */
export function canonicalScenarioKey(id) {
  return String(id || "").trim().toUpperCase().replace(/-/g, "_").replace(/ /g, "_");
}
