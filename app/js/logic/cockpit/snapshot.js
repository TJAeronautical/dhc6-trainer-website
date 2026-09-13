/*
  Scenario snapshots — port of feature-cockpit scenario/{ScenarioSnapshotRegistry,
  engine/ProcedureKeyNormalizer, ScenarioStateModels} and
  ui/screens/{ScenarioPhaseSnapshotRenderer (phase → CockpitVisualState, summary lines,
  focus regions), ProcedureScenarioStateBundleFactory (bundle + focus targets)}.

  Input is the published `scenario-snapshots` pack (core-res scenario_snapshots.json).
*/
import { humanizeKey, canonicalScenarioKey, canonicalVisualKey, canonicalVisualAliases, cockpitVisualKeys, isAnnunciatorVisualHost, visualKeysMatch } from "./keys.js";
import { warmUp } from "./engine.js";
import { evaluateFailures, resolveG950Cas, resolveLegacyAnnunciators, normalizeCas, LEGACY_STARTUP_PANEL_ANNUNCIATORS, G950_STARTUP_CAS_MESSAGES, LEGACY_ANNUNCIATOR_ID_MAP } from "./cas.js";
import { snapshotVariantKey, displayVariant, rectPx } from "./hitboxes.js";
import { FLIGHT_IDLE_GATE_01 } from "./sprites.js";

export const PHASES = ["BEFORE", "DURING", "AFTER"];
export const SCENARIO_ANNUNCIATOR_OVERRIDE_KEY = "SNAPSHOT_ANNUNCIATORS_OVERRIDE";
const OVERRIDE_ALIASES = ["SNAPSHOT_ANNUNCIATORS_OVERRIDE", "SNAPSHOT_ANNUNCIATOR_OVERRIDE", "ANNUNCIATOR_OVERRIDE", "ANNUNCIATORS_OVERRIDE", "ANNUNCIATOR_OVERRIDES", "ANNUNCIATORS_OVERRIDES"];

/* ------------------------------------------------ ProcedureKeyNormalizer */
function normalizeBare(raw) {
  return String(raw || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean).join(" ");
}
const CANONICAL_ALIASES = {};
CANONICAL_ALIASES[normalizeBare("BOTH BOOST PUMP FAILURE CAS MESSAGE SAME TANK")] = normalizeBare("BOTH BOOST PUMP FAILURE SAME TANK");
CANONICAL_ALIASES[normalizeBare("FUEL LOW LEVEL CAUTION LIGHT / CAS MESSAGE ON")] = normalizeBare("FUEL LOW LEVEL CAUTION LIGHT CAS MESSAGE ON");

export const ProcedureKeyNormalizer = {
  normalize: normalizeBare,
  canonicalize: function (raw) { const n = normalizeBare(raw); return CANONICAL_ALIASES[n] || n; },
  equivalentKeys: function (raw) {
    const normalized = normalizeBare(raw), canonical = this.canonicalize(raw);
    const matches = [];
    Object.keys(CANONICAL_ALIASES).forEach(function (alias) {
      const target = CANONICAL_ALIASES[alias];
      if (alias === normalized || target === normalized || target === canonical) { matches.push(alias); matches.push(target); }
    });
    const out = [];
    [normalized, canonical].concat(matches).forEach(function (k) { if (k && out.indexOf(k) === -1) out.push(k); });
    return out;
  }
};

/* ----------------------------------------------------- snapshot parsing */
function parseStringMap(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  Object.keys(raw).forEach(function (k) {
    const key = String(k).trim(); const v = raw[k] == null ? "" : String(raw[k]).trim();
    if (key && v) out[key] = v;
  });
  return out;
}
/* QUIRK-4: bare-string annunciator items are dropped (Android parser). Object form {id, level}; map form {ID: true}. */
function parseAnnunciators(raw) {
  const out = [];
  if (Array.isArray(raw)) {
    raw.forEach(function (item) {
      if (!item || typeof item !== "object") return;
      const id = String(item.id || "").trim();
      if (!id) return;
      const level = String(item.level || "").trim().toUpperCase();
      if (level === "OFF") return;
      out.push({ id: id, level: level === "WARNING" ? "WARNING" : level === "CAUTION" ? "CAUTION" : "ON" });
    });
  } else if (raw && typeof raw === "object") {
    Object.keys(raw).forEach(function (id) {
      if (!raw[id]) return;
      const u = id.toUpperCase();
      out.push({ id: id, level: u.indexOf("WARNING") > -1 ? "WARNING" : u.indexOf("CAUTION") > -1 ? "CAUTION" : "ON" });
    });
  }
  return out;
}
export function parseSnapshot(raw) {
  raw = raw || {};
  return { notes: raw.notes == null ? null : String(raw.notes), controls: parseStringMap(raw.controls), instruments: parseStringMap(raw.instruments), annunciators: parseAnnunciators(raw.annunciators) };
}

/* ------------------------------------------------------------ registry */
export function createSnapshotRegistry(packData, overrides) {
  const data = packData && packData.data ? packData.data : (packData || {});
  const baselines = {};
  Object.keys(data.baselines || {}).forEach(function (k) { baselines[k.toUpperCase()] = parseSnapshot(data.baselines[k]); });
  const procedures = new Map();
  const userOverrides = overrides || {};
  function insert(key, entry) { if (key && !procedures.has(key)) procedures.set(key, entry); }
  Object.keys(data.procedures || {}).forEach(function (rawKey) {
    const p = data.procedures[rawKey] || {};
    const entry = { key: rawKey, variant: String(p.variant || "BOTH").toUpperCase(), title: p.title == null ? null : String(p.title), phases: {} };
    PHASES.forEach(function (ph) { const raw = (p.phases || {})[ph.toLowerCase()] || (p.phases || {})[ph]; if (raw) entry.phases[ph] = parseSnapshot(raw); });
    const trimmed = rawKey.trim();
    procedures.set(trimmed, entry);
    insert(ProcedureKeyNormalizer.canonicalize(trimmed), entry);
    ProcedureKeyNormalizer.equivalentKeys(trimmed).forEach(function (k) { insert(k, entry); });
  });

  function candidateKeys(procedureId) {
    const out = [];
    function add(v) { if (v != null && out.indexOf(v) === -1) out.push(v); }
    const raw = String(procedureId || "").trim();
    const bases = [raw];
    if (raw.indexOf("/") > -1) bases.push(raw.slice(raw.indexOf("/") + 1));
    bases.forEach(function (b) {
      [b, b.toLowerCase(), b.toUpperCase()].forEach(function (c) {
        add(c); add(ProcedureKeyNormalizer.normalize(c)); add(ProcedureKeyNormalizer.canonicalize(c));
        ProcedureKeyNormalizer.equivalentKeys(c).forEach(add);
      });
    });
    return out;
  }
  function overrideFor(procKey) { return userOverrides[procKey] || null; }
  function mergedEntry(procKey) {
    const asset = procedures.get(procKey) || null;
    const ov = overrideFor(procKey);
    if (!asset && !ov) return null;
    const entry = { variant: asset ? asset.variant : "BOTH", title: asset ? asset.title : null, phases: {} };
    PHASES.forEach(function (ph) { if (asset && asset.phases[ph]) entry.phases[ph] = asset.phases[ph]; });
    if (ov) {
      if (ov.variant && String(ov.variant).toUpperCase() !== "BOTH") entry.variant = String(ov.variant).toUpperCase();
      if (ov.title) entry.title = ov.title;
      PHASES.forEach(function (ph) {
        const o = ov.phases && (ov.phases[ph] || ov.phases[ph.toLowerCase()]);
        if (!o) return;
        const base = entry.phases[ph] || { notes: null, controls: {}, instruments: {}, annunciators: [] };
        const parsed = parseSnapshot(o);
        entry.phases[ph] = {
          notes: o.notes !== undefined ? parsed.notes : base.notes,
          controls: o.controls !== undefined ? parsed.controls : base.controls,
          instruments: o.instruments !== undefined ? parsed.instruments : base.instruments,
          annunciators: o.annunciators !== undefined ? parsed.annunciators : base.annunciators
        };
      });
    }
    return entry;
  }
  function merge(baseline, phase) {
    const controls = Object.assign({}, baseline.controls, phase.controls);
    const instruments = Object.assign({}, baseline.instruments, phase.instruments);
    let annunciators;
    if (annunciatorOverrideEnabled(controls)) annunciators = phase.annunciators;
    else if (phase.annunciators.length) annunciators = phase.annunciators;
    else annunciators = baseline.annunciators;
    return { notes: phase.notes != null ? phase.notes : baseline.notes, controls: controls, instruments: instruments, annunciators: annunciators.slice() };
  }
  function resolveKey(procedureId) {
    const candidates = candidateKeys(procedureId);
    for (let i = 0; i < candidates.length; i += 1) if (procedures.has(candidates[i])) return candidates[i];
    for (let i = 0; i < candidates.length; i += 1) if (overrideFor(candidates[i])) return candidates[i];
    return candidates.length ? candidates[0] : "";
  }
  function resolveTriplet(procedureId, variant) {
    const variantKey = snapshotVariantKey(variant);
    const baseline = baselines[variantKey] || { notes: null, controls: {}, instruments: {}, annunciators: [] };
    const procKey = resolveKey(procedureId);
    const entry = mergedEntry(procKey);
    const out = { procKey: procKey, entry: entry, phases: {} };
    const selected = String(variant || "BOTH").toUpperCase();
    const usable = entry && (entry.variant === "BOTH" || entry.variant === selected);
    PHASES.forEach(function (ph) {
      out.phases[ph] = usable && entry.phases[ph] ? merge(baseline, entry.phases[ph]) : Object.assign({}, baseline, { controls: Object.assign({}, baseline.controls), instruments: Object.assign({}, baseline.instruments), annunciators: baseline.annunciators.slice() });
    });
    return out;
  }
  return {
    baselines: baselines,
    procedureKeys: function () { return Array.from(new Set(Array.from(procedures.values()).map(function (e) { return e.key; }))); },
    has: function (procedureId) { return procedures.has(resolveKey(procedureId)); },
    resolveKey: resolveKey,
    resolve: function (procedureId, variant, phase) { return resolveTriplet(procedureId, variant).phases[phase || "BEFORE"]; },
    resolveAll: resolveTriplet,
    entryTitle: function (procedureId) { const e = mergedEntry(resolveKey(procedureId)); return e ? e.title : null; }
  };
}

export function annunciatorOverrideEnabled(controls) {
  const keys = Object.keys(controls || {});
  for (let i = 0; i < keys.length; i += 1) {
    const k = keys[i].trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (OVERRIDE_ALIASES.indexOf(k) > -1) {
      const v = String(controls[keys[i]] || "").trim().toUpperCase();
      return !(v === "OFF" || v === "FALSE" || v === "NO" || v === "0");
    }
  }
  return false;
}
export function visibleControls(controls) {
  const out = {};
  Object.keys(controls || {}).forEach(function (k) {
    const n = k.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (OVERRIDE_ALIASES.indexOf(n) === -1) out[k] = controls[k];
  });
  return out;
}

/* ------------------------------------------ ScenarioPhaseState (humanized) */
export function toPhaseState(snapshot, focusTargets) {
  const lines = snapshot.annunciators.map(function (a) { return humanizeKey(a.id) + (a.level === "WARNING" ? " (warning)" : a.level === "CAUTION" ? " (caution)" : ""); });
  function humanizedMap(m) {
    const out = {};
    Object.keys(m).sort().forEach(function (k) { out[humanizeKey(k)] = m[k]; });
    return out;
  }
  return { annunciators: lines, instruments: humanizedMap(snapshot.instruments), controls: humanizedMap(snapshot.controls), notes: snapshot.notes, focusTargets: focusTargets || [] };
}

/* ----------------------------------------------------- lever parsers (§5.5) */
const IDLE_GATE = FLIGHT_IDLE_GATE_01;
function forwardPosition(fraction) { return IDLE_GATE * (1 - fraction); }
function reversePosition(pct) { return IDLE_GATE + (1 - IDLE_GATE) * pct; }
function genericRatio(s) {
  const t = String(s).replace(/%/g, "").trim();
  if (!/^[-+]?\d*\.?\d+$/.test(t)) return null;
  let n = parseFloat(t);
  if (n > 1) n = n / 100;
  return Math.min(1, Math.max(0, n));
}
export function parseSnapshotPowerLever(raw) {
  const u = String(raw || "").trim().toUpperCase();
  if (["MAX", "MAX POWER", "FULL", "FULL POWER", "TAKEOFF", "TAKE OFF", "TAKE-OFF", "TO", "100", "100%"].indexOf(u) > -1) return 0;
  if (["CLIMB", "MCT", "MAX CONT", "MAX CONTINUOUS", "MAX CONTINUOUS POWER"].indexOf(u) > -1) return forwardPosition(0.90);
  if (u === "CRUISE") return forwardPosition(0.78);
  if (["DESCENT", "DESCEND", "LOW POWER DESCENT"].indexOf(u) > -1) return forwardPosition(0.35);
  if (u === "TAXI" || u === "GROUND TAXI") return IDLE_GATE - 0.04;
  if (["IDLE", "GROUND IDLE", "FLIGHT IDLE", "BETA", "0", "0%"].indexOf(u) > -1) return IDLE_GATE;
  if (u.indexOf("REV") === 0) { const m = u.match(/(\d+(?:\.\d+)?)/); const pct = m ? parseFloat(m[1]) : 100; return reversePosition(Math.min(1, Math.max(0, pct / 100))); }
  const r = genericRatio(u);
  return r == null ? null : forwardPosition(r);
}
export function parseSnapshotPropLever(raw) {
  const u = String(raw || "").trim().toUpperCase();
  if (["MAX", "FULL", "FULL FINE", "FINE", "100", "100%", "96", "96%"].indexOf(u) > -1) return 0;
  if (u === "91" || u === "91%") return 0.09;
  if (u === "82" || u === "82%") return 0.18;
  if (u === "75" || u === "75%") return 0.25;
  if (u === "MIN" || u === "COARSE") return 0.75;
  if (["FEATHER", "0", "0%"].indexOf(u) > -1) return 1;
  const r = genericRatio(u);
  return r == null ? null : 1 - r;
}
export function parseSnapshotFuelLever(raw) {
  const u = String(raw || "").trim().toUpperCase();
  if (["RUN", "ON", "OPEN", "100", "100%"].indexOf(u) > -1) return 0;
  if (["CUTOFF", "CUT OFF", "OFF", "SHUTOFF", "SHUT OFF", "0", "0%"].indexOf(u) > -1) return 1;
  return genericRatio(u);
}
export function parseSnapshotFlap(raw) {
  const u = String(raw || "").trim().toUpperCase();
  if (u.indexOf("FULL") > -1 || u.indexOf("LAND") > -1 || u.indexOf("37.5") > -1 || u.indexOf("40") > -1) return 1;
  if (u.indexOf("20") > -1) return 20 / 37.5;
  if (u.indexOf("TAKEOFF") > -1 || u.indexOf("HALF") > -1 || u.indexOf("10") > -1) return 10 / 37.5;
  if (u.indexOf("UP") > -1 || u.indexOf("0") > -1 || u.indexOf("ZERO") > -1) return 0;
  return null;
}

/* scenarioSnapshotLeverPositions: humanized control labels → raw lever positions. */
export function snapshotLeverPositions(controls) {
  const out = {};
  const entries = Object.keys(controls || {}).map(function (k) { return [k.toUpperCase(), controls[k]]; });
  entries.forEach(function (e) {
    const key = e[0], value = e[1];
    const isL = key.indexOf("POWER_LEVER_L") > -1 || key.indexOf("POWER LEVER L") > -1 || key === "POWER L";
    const isR = key.indexOf("POWER_LEVER_R") > -1 || key.indexOf("POWER LEVER R") > -1 || key === "POWER R";
    if (isL || isR) { const v = parseSnapshotPowerLever(value); if (v != null) out[isL ? "POWER_LEVER_L" : "POWER_LEVER_R"] = v; return; }
    const pL = key.indexOf("PROP_LEVER_L") > -1 || key.indexOf("PROP LEVER L") > -1 || key === "PROP L";
    const pR = key.indexOf("PROP_LEVER_R") > -1 || key.indexOf("PROP LEVER R") > -1 || key === "PROP R";
    if (pL || pR) { const v = parseSnapshotPropLever(value); if (v != null) out[pL ? "PROP_LEVER_L" : "PROP_LEVER_R"] = v; return; }
    const fL = key.indexOf("FUEL_LEVER_L") > -1 || key.indexOf("FUEL LEVER L") > -1 || key === "FUEL L";
    const fR = key.indexOf("FUEL_LEVER_R") > -1 || key.indexOf("FUEL LEVER R") > -1 || key === "FUEL R";
    if (fL || fR) { const v = parseSnapshotFuelLever(value); if (v != null) out[fL ? "FUEL_LEVER_L" : "FUEL_LEVER_R"] = v; return; }
    if (key.indexOf("FLAP") > -1) { const v = parseSnapshotFlap(value); if (v != null) out.FLAP_SELECTOR = v; }
  });
  if (out.FLAP_SELECTOR == null) {
    const joined = entries.map(function (e) { return e[0] + " " + String(e[1]).toUpperCase(); }).join(" ");
    const v = parseSnapshotFlap(joined);
    if (v != null) out.FLAP_SELECTOR = v;
  }
  return out;
}

/* scenarioSnapshotSwitchStates */
function snapshotSwitchIdFor(label) {
  const u = label.toUpperCase();
  if (u.indexOf("AUTOFEATHER") > -1) return "AUTOFEATHER_SELECT";
  if (u.indexOf("IGNITION ARM") > -1) return "IGNITION_ARM";
  if (u.indexOf("STARTER") > -1) return "STARTER_SWITCH";
  if (u.indexOf("FWD BOOST PUMP") > -1) return "FWD_BOOST_PUMP";
  if (u.indexOf("AFT BOOST PUMP") > -1) return "AFT_BOOST_PUMP";
  if (u.indexOf("STBY BOOST PUMP FWD") > -1 || u.indexOf("STANDBY BOOST PUMP FWD") > -1) return "STBY_BOOST_PUMP_FWD";
  if (u.indexOf("STBY BOOST PUMP AFT") > -1 || u.indexOf("STANDBY BOOST PUMP AFT") > -1) return "STBY_BOOST_PUMP_AFT";
  if (u.indexOf("LEFT GEN") > -1 || u.indexOf("L DC GEN") > -1 || u.indexOf("GENERATOR L") > -1) return "L_DC_GEN";
  if (u.indexOf("RIGHT GEN") > -1 || u.indexOf("R DC GEN") > -1 || u.indexOf("GENERATOR R") > -1) return "R_DC_GEN";
  if (u.indexOf("INTAKE DEFLECTOR") > -1) return "INTAKE_DEFLECTORS";
  if (u.indexOf("STAB DEICE L") > -1) return "STAB_DEICE_L";
  if (u.indexOf("STAB DEICE R") > -1) return "STAB_DEICE_R";
  return null;
}
export function parseSnapshotSwitchState(raw) {
  const u = String(raw || "").trim().toUpperCase();
  if (["LEFT", "L", "ON", "OPEN", "UP", "ARM", "ENABLED", "ENABLE", "TRUE", "YES"].indexOf(u) > -1) return "LEFT";
  if (["RIGHT", "R", "OFF", "CLOSED", "DOWN", "DISARM", "DISABLED", "DISABLE", "FALSE", "NO"].indexOf(u) > -1) return "RIGHT";
  if (["CENTER", "CENTRE", "C", "MID", "MIDDLE", "NEUTRAL"].indexOf(u) > -1) return "CENTER";
  if (["MOMENTARY", "MOM", "PUSH", "PRESS"].indexOf(u) > -1) return "MOMENTARY";
  return null;
}
export function snapshotSwitchStates(controls) {
  const out = { L_DC_GEN: "LEFT", R_DC_GEN: "LEFT" };
  Object.keys(controls || {}).forEach(function (label) {
    const id = snapshotSwitchIdFor(label); if (!id) return;
    const st = parseSnapshotSwitchState(controls[label]); if (!st) return;
    out[id] = st;
  });
  return out;
}

/* ------------------------------------------------ instrument normalisation */
export function instrumentNormalized(key, value, variant) {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  if (v >= 0 && v <= 1) return v;
  let n;
  if (/^TORQUE_GAUGE_[LR]$|^TORQUE_[LR]$/.test(key)) n = v / (displayVariant(variant) === "LEGACY" ? 60 : 50);
  else if (/^NG_GAUGE_|^NG_/.test(key)) n = v / 102;
  else if (/^NP_GAUGE_|^NP_/.test(key)) n = v / 101.5;
  else if (/^T5_GAUGE_|^ITT_|^T5_/.test(key)) n = v / 980;
  else if (/^FUEL_FLOW_GAUGE_|^FUEL_FLOW_|^FF_GAUGE_|^FF_/.test(key)) n = v / 420;
  else if (/^OIL_PRESS_GAUGE_[LR]$|^L_ENGINE_OIL_PRESS$|^OIL_PRESS_R$/.test(key)) n = v / 100;
  else if (/^OIL_TEMP_GAUGE_|^OIL_TEMP_/.test(key)) n = (v - 20) / 80;
  else if (/^FUEL_QUANTITY_GAUGE_|^FUEL_QUANTITY_|^FUEL_QTY_/.test(key)) n = v / 1000;
  else if (key === "HYDRAULIC_PRESS_GAUGE" || key === "HYD_GAUGE" || key === "SKIS_GAUGE") n = v / 1600;
  else if (key === "VDC_GAUGE" || key === "VOLT_GAUGE" || key === "VDC") n = (v - 20) / 10;
  else n = v >= 0 && v <= 100 ? v / 100 : 0;
  return Math.min(1, Math.max(0, n));
}
export function instrumentOverlayKeys(key) {
  const k = canonicalScenarioKey(key);
  if (!k) return [];
  const table = [
    [["TORQUE_GAUGE_L", "TORQUE_L"], ["TORQUE_GAUGE_L", "TORQUE_L"]], [["TORQUE_GAUGE_R", "TORQUE_R"], ["TORQUE_GAUGE_R", "TORQUE_R"]],
    [["NG_GAUGE_L", "NG_L"], ["NG_GAUGE_L", "NG_L"]], [["NG_GAUGE_R", "NG_R"], ["NG_GAUGE_R", "NG_R"]],
    [["NP_GAUGE_L", "NP_L"], ["NP_GAUGE_L", "NP_L"]], [["NP_GAUGE_R", "NP_R"], ["NP_GAUGE_R", "NP_R"]],
    [["T5_GAUGE_L", "ITT_L", "T5_L"], ["T5_GAUGE_L", "ITT_L", "T5_L"]], [["T5_GAUGE_R", "ITT_R", "T5_R"], ["T5_GAUGE_R", "ITT_R", "T5_R"]],
    [["FUEL_FLOW_GAUGE_L", "FUEL_FLOW_L", "FF_GAUGE_L", "FF_L"], ["FUEL_FLOW_GAUGE_L", "FUEL_FLOW_L"]], [["FUEL_FLOW_GAUGE_R", "FUEL_FLOW_R", "FF_GAUGE_R", "FF_R"], ["FUEL_FLOW_GAUGE_R", "FUEL_FLOW_R"]],
    [["OIL_PRESS_GAUGE_L", "L_ENGINE_OIL_PRESS"], ["OIL_PRESS_GAUGE_L", "L_ENGINE_OIL_PRESS"]], [["OIL_PRESS_GAUGE_R", "OIL_PRESS_R"], ["OIL_PRESS_GAUGE_R", "OIL_PRESS_R"]],
    [["OIL_TEMP_GAUGE_L", "OIL_TEMP_L"], ["OIL_TEMP_GAUGE_L", "OIL_TEMP_L"]], [["OIL_TEMP_GAUGE_R", "OIL_TEMP_R"], ["OIL_TEMP_GAUGE_R", "OIL_TEMP_R"]],
    [["FUEL_QUANTITY_GAUGE_L", "FUEL_QUANTITY_L", "FUEL_QTY_L"], ["FUEL_QUANTITY_GAUGE_L", "FUEL_QUANTITY_L"]], [["FUEL_QUANTITY_GAUGE_R", "FUEL_QUANTITY_R", "FUEL_QTY_R"], ["FUEL_QUANTITY_GAUGE_R", "FUEL_QUANTITY_R"]],
    [["HYDRAULIC_PRESS_GAUGE", "HYD_GAUGE", "SKIS_GAUGE"], ["HYDRAULIC_PRESS_GAUGE", "SKIS_GAUGE"]], [["VDC_GAUGE", "VOLT_GAUGE", "VDC"], ["VDC_GAUGE"]]
  ];
  for (let i = 0; i < table.length; i += 1) if (table[i][0].indexOf(k) > -1) return table[i][1].slice();
  return [k];
}
export function parseInstrumentOverride(key, raw, variant) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return null;
  const l = s.toLowerCase();
  if (l === "true" || l === "on") return { normalized: 1, actual: 1 };
  if (l === "false" || l === "off") return { normalized: 0, actual: 0 };
  if (/^-?\d*\.?\d+%$/.test(s)) { const n = parseFloat(s); return { normalized: Math.min(1, Math.max(0, n / 100)), actual: n }; }
  if (/^-?\d*\.?\d+$/.test(s)) { const n = parseFloat(s); return { normalized: instrumentNormalized(key, n, variant), actual: n }; }
  return null;
}

/* WOW inference (scenarioSnapshotInferWow). */
export function inferWow(snapshot) {
  const keys = Object.keys(snapshot.instruments || {});
  for (let i = 0; i < keys.length; i += 1) {
    const ck = canonicalScenarioKey(keys[i]);
    if (["WOW", "WEIGHT_ON_WHEELS", "ON_GROUND", "AIRBORNE"].indexOf(ck) === -1) continue;
    const v = String(snapshot.instruments[keys[i]]).trim().toUpperCase();
    if (["TRUE", "ON", "YES", "1", "GROUND", "ON_GROUND"].indexOf(v) > -1) return ck !== "AIRBORNE";
    if (["FALSE", "OFF", "NO", "0", "AIR", "AIRBORNE"].indexOf(v) > -1) return ck === "AIRBORNE";
  }
  return String(snapshot.notes || "").toUpperCase().indexOf("GROUND") > -1;
}

/* -------------------------------- scenarioSnapshotVisualState (§5.7–5.8) */
export function snapshotVisualState(state, variant) {
  const v = displayVariant(variant);
  const isG950 = v === "G950";
  const levers = snapshotLeverPositions(state.controls);
  const switches = snapshotSwitchStates(state.controls);
  const wow = inferWow(state);
  const plL = levers.POWER_LEVER_L != null ? levers.POWER_LEVER_L : 0.26, plR = levers.POWER_LEVER_R != null ? levers.POWER_LEVER_R : 0.26;
  const prL = levers.PROP_LEVER_L != null ? levers.PROP_LEVER_L : 1, prR = levers.PROP_LEVER_R != null ? levers.PROP_LEVER_R : 1;
  const flL = levers.FUEL_LEVER_L != null ? levers.FUEL_LEVER_L : 1, flR = levers.FUEL_LEVER_R != null ? levers.FUEL_LEVER_R : 1;
  // QUIRK-6: the snapshot renderer inverts the prop lever before the engine model.
  const out = warmUp({ powerL: plL, powerR: plR, propL: 1 - prL, propR: 1 - prR, fuelL: flL, fuelR: flR }, wow, 180);
  const analog = {}, rawValues = {};
  function put(id, raw) {
    const n = instrumentNormalized(id, raw, v);
    instrumentOverlayKeys(id).forEach(function (k) { analog[k] = n; rawValues[k] = raw; });
  }
  put("TORQUE_GAUGE_L", out.left.torquePercent); put("TORQUE_GAUGE_R", out.right.torquePercent);
  put("NG_GAUGE_L", out.left.ngPercent); put("NG_GAUGE_R", out.right.ngPercent);
  put("NP_GAUGE_L", out.left.npPercent); put("NP_GAUGE_R", out.right.npPercent);
  put("T5_GAUGE_L", out.left.t5Celsius); put("T5_GAUGE_R", out.right.t5Celsius);
  put("FUEL_FLOW_GAUGE_L", out.left.fuelFlowPph); put("FUEL_FLOW_GAUGE_R", out.right.fuelFlowPph);
  put("OIL_PRESS_GAUGE_L", out.left.oilPressurePsi); put("OIL_PRESS_GAUGE_R", out.right.oilPressurePsi);
  put("OIL_TEMP_GAUGE_L", out.left.oilTemperatureC); put("OIL_TEMP_GAUGE_R", out.right.oilTemperatureC);
  put("FUEL_QUANTITY_GAUGE_L", out.fuelQuantityLeftLb); put("FUEL_QUANTITY_GAUGE_R", out.fuelQuantityRightLb);
  put("HYDRAULIC_PRESS_GAUGE", out.hydraulicPressurePsi); put("VDC_GAUGE", 28);
  Object.keys(state.instruments || {}).forEach(function (id) {
    const ck = canonicalScenarioKey(id);
    const r = parseInstrumentOverride(ck, state.instruments[id], v);
    if (!r) return;
    instrumentOverlayKeys(ck).forEach(function (k) { analog[k] = r.normalized; if (r.actual != null) rawValues[k] = r.actual; });
  });
  const autofeatherSelected = switches.AUTOFEATHER_SELECT === "RIGHT";
  const autofeatherArmed = switches.AUTOFEATHER_ARM === "RIGHT" || autofeatherSelected;

  function switchOn(key) {
    const st = switches[key];
    if (["FWD_BOOST_PUMP", "AFT_BOOST_PUMP", "L_DC_GEN", "R_DC_GEN"].indexOf(key) > -1) return st === "LEFT";
    if (["STBY_BOOST_PUMP_FWD", "STBY_BOOST_PUMP_AFT", "INTAKE_DEFL", "INTAKE_DEFLECTORS", "STAB_DEICE_L", "STAB_DEICE_R", "AUTOFEATHER_ARM"].indexOf(key) > -1) return st === "RIGHT";
    return st === "LEFT";
  }
  const fwdAvail = flL < 0.5 && out.left.ngPercent >= 65, aftAvail = flR < 0.5 && out.right.ngPercent >= 65;
  const failure = evaluateFailures({
    wow: wow, hydraulicPressurePsi: out.hydraulicPressurePsi, fuelQtyFwdLb: out.fuelQuantityLeftLb, fuelQtyAftLb: out.fuelQuantityRightLb,
    leftNgPercent: out.left.ngPercent, rightNgPercent: out.right.ngPercent, leftNpPercent: out.left.npPercent, rightNpPercent: out.right.npPercent,
    leftTorquePsi: out.left.torquePercent, rightTorquePsi: out.right.torquePercent, leftOilPressurePsi: out.left.oilPressurePsi, rightOilPressurePsi: out.right.oilPressurePsi,
    leftGenOn: switchOn("L_DC_GEN"), rightGenOn: switchOn("R_DC_GEN"), leftGenFail: false, rightGenFail: false,
    fwdBoostPump1Selected: switchOn("FWD_BOOST_PUMP"), fwdBoostPump2Selected: switchOn("STBY_BOOST_PUMP_FWD"), aftBoostPump1Selected: switchOn("AFT_BOOST_PUMP"), aftBoostPump2Selected: switchOn("STBY_BOOST_PUMP_AFT"),
    fwdBoostPump1PressureLow: switchOn("FWD_BOOST_PUMP") && !fwdAvail, fwdBoostPump2PressureLow: switchOn("STBY_BOOST_PUMP_FWD") && !fwdAvail,
    aftBoostPump1PressureLow: switchOn("AFT_BOOST_PUMP") && !aftAvail, aftBoostPump2PressureLow: switchOn("STBY_BOOST_PUMP_AFT") && !aftAvail,
    pneumaticPressureLow: out.left.ngPercent < 65 && out.right.ngPercent < 65,
    intakeDeflectorLeft: switchOn("INTAKE_DEFL") || switchOn("INTAKE_DEFLECTORS"), intakeDeflectorRight: switchOn("INTAKE_DEFL") || switchOn("INTAKE_DEFLECTORS"),
    stabDeiceLeft: switchOn("STAB_DEICE_L"), stabDeiceRight: switchOn("STAB_DEICE_R"),
    fireHandleLeft: switchOn("FIRE_HANDLE_L"), fireHandleRight: switchOn("FIRE_HANDLE_R"), firePushLeft: switchOn("FIRE_PUSH_SWITCH_L"), firePushRight: switchOn("FIRE_PUSH_SWITCH_R"),
    baggageSmoke: switchOn("BAGGAGE_SMOKE") || switchOn("SMOKE_R_BAGGAGE") || switchOn("BAGGAGE_SMOKE_TEST"),
    leftT5Celsius: out.left.t5Celsius, rightT5Celsius: out.right.t5Celsius, leftFuelFlowPph: out.left.fuelFlowPph, rightFuelFlowPph: out.right.fuelFlowPph,
    powerLeverL01: plL, powerLeverR01: plR, propLeverL01: prL, propLeverR01: prR, fuelOnLeft: flL < 0.5, fuelOnRight: flR < 0.5,
    autofeatherTriggeredLeft: false, autofeatherTriggeredRight: false
  });
  const aircraftNotStarted = !switchOn("L_DC_GEN") && !switchOn("R_DC_GEN") && prL >= 0.98 && prR >= 0.98 && flL >= 0.98 && flR >= 0.98 && out.left.ngPercent < 12 && out.right.ngPercent < 12;
  const explicitOverride = annunciatorOverrideEnabled(state.controls);
  let derivedIds = [];
  if (!explicitOverride) {
    if (isG950) derivedIds = aircraftNotStarted ? G950_STARTUP_CAS_MESSAGES.slice() : resolveG950Cas(failure);
    else derivedIds = aircraftNotStarted ? LEGACY_STARTUP_PANEL_ANNUNCIATORS.slice() : resolveLegacyAnnunciators(failure);
  }
  const airGround = wow ? "GROUND" : "AIR";
  const explicit = {};
  (state.annunciators || []).forEach(function (raw) {
    const n = normalizeCas(raw, null, airGround);
    if (isG950 && n.stableId === "AC_400_CYCLE") return;
    explicit[n.stableId] = n;
    if (derivedIds.indexOf(n.stableId) === -1) derivedIds.push(n.stableId);
  });
  const casEntries = derivedIds.map(function (id, i) {
    const n = explicit[id] || normalizeCas(id, null, airGround);
    return { key: { id: id, side: null }, text: n.text, priority: n.priority, active: true, acknowledged: true, latched: false, firstActivatedAtMillis: i, lastChangedAtMillis: i };
  });
  let renderIds;
  if (isG950) renderIds = derivedIds.map(canonicalVisualKey);
  else {
    renderIds = [];
    derivedIds.forEach(function (id) {
      const mapped = LEGACY_ANNUNCIATOR_ID_MAP[canonicalVisualKey(id)] || canonicalVisualKey(id);
      const extra = { BOOST_PUMP_1_AFT_PRESS: "AFT_BOOST1_PR", BOOST_PUMP_2_AFT_PRESS: "AFT_BOOST2_PR", BOOST_PUMP_1_FWD_PRESS: "FWD_BOOST1_PR", BOOST_PUMP_2_FWD_PRESS: "FWD_BOOST2_PR" }[mapped];
      [mapped].concat(extra ? [extra] : []).map(canonicalVisualKey).forEach(function (k) { if (renderIds.indexOf(k) === -1) renderIds.push(k); });
    });
  }
  const annunciators = {};
  annunciators.MASTER_WARNING = casEntries.some(function (e) { return e.priority === "WARNING"; });
  annunciators.MASTER_CAUTION = casEntries.some(function (e) { return e.priority === "CAUTION"; });
  renderIds.forEach(function (id) { annunciators[id] = true; });
  return {
    analogValues: analog, rawAnalogValues: rawValues, annunciators: annunciators,
    casMessages: casEntries.map(function (e) { return e.text; }), casEntries: casEntries,
    autofeatherArmed: autofeatherArmed, autofeatherSelected: autofeatherSelected, autofeatherTriggered: false,
    switchStates: switches, leverPositions: levers, wow: wow, engine: out, failure: failure
  };
}

/* ------------------------------------------------- summary text (§5.9) */
export function phaseSummaryText(phase, state) {
  const notes = String(state.notes || "").trim();
  if (notes) { const first = notes.split(".")[0].trim(); if (first) return first; }
  if (phase === "BEFORE") return "Use for in-flight QRH and abnormal management in a lower-workload phase.";
  if (phase === "DURING") return "Use for recognition and immediate action at the active abnormal cue.";
  return "Use for post-action stabilization, cross-check, and clean-up verification.";
}

function numericInstrument(state, key) {
  const v = state.instruments ? state.instruments[key] : undefined;
  if (v == null) return null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

export function summaryLines(state, compact) {
  const maxItems = compact ? 2 : 3, maxAlert = compact ? 3 : 8;
  const levers = snapshotLeverPositions(state.controls);
  const wow = inferWow(state);
  const plL = levers.POWER_LEVER_L != null ? levers.POWER_LEVER_L : 0.26, plR = levers.POWER_LEVER_R != null ? levers.POWER_LEVER_R : 0.26;
  const prL = levers.PROP_LEVER_L != null ? levers.PROP_LEVER_L : 1, prR = levers.PROP_LEVER_R != null ? levers.PROP_LEVER_R : 1;
  const flL = levers.FUEL_LEVER_L != null ? levers.FUEL_LEVER_L : 1, flR = levers.FUEL_LEVER_R != null ? levers.FUEL_LEVER_R : 1;
  const out = warmUp({ powerL: plL, powerR: plR, propL: 1 - prL, propR: 1 - prR, fuelL: flL, fuelR: flR }, wow, 180);
  function val(key, derived) { const n = numericInstrument(state, key); return n != null ? n : derived; }
  const torqueL = Math.min(50, val("TORQUE_L", out.left.torquePercent)), torqueR = Math.min(50, val("TORQUE_R", out.right.torquePercent));
  const ffL = val("FUEL_FLOW_L", out.left.fuelFlowPph), ffR = val("FUEL_FLOW_R", out.right.fuelFlowPph);
  const ngL = val("NG_L", out.left.ngPercent), ngR = val("NG_R", out.right.ngPercent);
  const instrLines = ["Torque L: " + Math.round(torqueL) + " PSI", "Torque R: " + Math.round(torqueR) + " PSI", "Fuel Flow L: " + Math.round(ffL), "Fuel Flow R: " + Math.round(ffR), "NG L: " + Math.round(ngL) + "%", "NG R: " + Math.round(ngR) + "%"];
  const notesU = String(state.notes || "").toUpperCase();
  const controlsU = {};
  Object.keys(state.controls || {}).forEach(function (k) { controlsU[k.toUpperCase()] = String(state.controls[k]).toUpperCase(); });
  const anyOn = ["BATTERY_MASTER", "L_DC_GEN", "R_DC_GEN"].some(function (k) { return controlsU[k] === "ON"; });
  const ngLExplicit = numericInstrument(state, "NG_L") || 0, ngRExplicit = numericInstrument(state, "NG_R") || 0;
  const coldDark = (notesU.indexOf("COLD-AND-DARK") > -1 || notesU.indexOf("COLD DARK") > -1) && !anyOn && ngLExplicit < 12 && ngRExplicit < 12;
  const lines = [];
  let alerts = [];
  if (!coldDark) {
    alerts = (state.annunciators || []).slice(0, maxAlert);
    if (!alerts.length && wow) {
      const battery = controlsU.BATTERY_MASTER === "ON";
      const preStart = notesU.indexOf("PRE-START") > -1;
      const enginesStopped = ngL < 45 && ngR < 45;
      if (battery || preStart || enginesStopped) {
        alerts.push("L Gen Fail"); alerts.push("R Gen Fail");
        if (out.left.oilPressurePsi < 40) alerts.push("L Oil Press");
        if (out.right.oilPressurePsi < 40) alerts.push("R Oil Press");
        if (prL >= 0.98 && prR >= 0.98) alerts.push("Reset Props");
        if (flL >= 0.98) { alerts.push("Aft Boost1 Pr"); alerts.push("Fwd Boost1 Pr"); }
        if (flR >= 0.98) { alerts.push("Aft Boost2 Pr"); alerts.push("Fwd Boost2 Pr"); }
        alerts = alerts.slice(0, maxAlert);
      }
    }
    const chunk = compact ? 2 : 3;
    if (!alerts.length) lines.push(["Alerts", "No highlighted alerts"]);
    for (let i = 0; i < alerts.length; i += chunk) lines.push([i === 0 ? "Alerts" : "Alerts +", alerts.slice(i, i + chunk).join("  -  ")]);
  }
  lines.push(["Instruments", instrLines.slice(0, maxItems).join("  -  ") || "Scan stable indications"]);
  const vis = visibleControls(state.controls);
  const cfg = Object.keys(vis).slice(0, maxItems).map(function (k) { return k + ": " + vis[k]; });
  lines.push(["Configuration", cfg.length ? cfg.join("  -  ") : "Representative phase configuration"]);
  return lines;
}

/* --------------------------------------------------- focus regions (§5.10) */
const FUEL_TOKENS = ["FUEL", "SELECTOR", "SHUTOFF", "CROSSFEED", "TRANSFER", "TANK"];
const ENGINE_TOKENS = ["ENGINE", "ENG", "NG", "NP", "T5", "ITT", "TORQUE", "OIL", "FLOW"];
const POWER_STACK_TOKENS = ["POWER", "PROP", "PROPELLER", "CONDITION"];
const POWER_LEVER_TOKENS = ["LEVER", "LEVERS", "THROTTLE", "THROTTLES", "QUADRANT"];
const FLAP_TOKENS = ["FLAP", "FLAPS"];

function shouldUseExactRegion(target) {
  const u = String(target || "").trim().toUpperCase();
  if (!u) return false;
  const tokens = u.split(/[^A-Z0-9]+/).filter(Boolean);
  if (tokens.length === 1) {
    const t = tokens[0];
    if (FUEL_TOKENS.indexOf(t) > -1 || ENGINE_TOKENS.indexOf(t) > -1 || POWER_STACK_TOKENS.indexOf(t) > -1) return false;
  }
  return true;
}
export function targetHitboxIds(target) {
  const u = String(target || "").toUpperCase();
  const tokens = u.split(/[^A-Z0-9]+/).filter(Boolean);
  const has = function (list) { return tokens.some(function (t) { return list.indexOf(t) > -1; }); };
  if (has(FLAP_TOKENS)) return ["FLAP_SELECTOR"];
  if (u.indexOf("CONDITION") > -1) return ["FUEL_LEVER_L", "FUEL_LEVER_R"];
  if (u.indexOf("START") > -1 || u.indexOf("IGNIT") > -1) return ["IGNITION_ARM", "IGNITER_L", "IGNITER_R", "STARTER_SWITCH"];
  if (u.indexOf("ENGINE") > -1 || u.indexOf("INSTR") > -1 || has(ENGINE_TOKENS)) return ["MFD_CENTER", "MFD_CENTRE_DISPLAY", "TORQUE_GAUGE_L", "TORQUE_GAUGE_R", "NP_GAUGE_L", "NP_GAUGE_R", "T5_GAUGE_L", "T5_GAUGE_R", "NG_GAUGE_L", "NG_GAUGE_R", "FUEL_FLOW_GAUGE_L", "FUEL_FLOW_GAUGE_R", "OIL_PRESS_GAUGE_L", "OIL_PRESS_GAUGE_R", "OIL_TEMP_GAUGE_L", "OIL_TEMP_GAUGE_R", "L_ENGINE_OIL_PRESS", "R_ENGINE_OIL_PRESS"];
  if (u.indexOf("FUEL") > -1 && u.indexOf("SELECT") > -1) return ["FUEL_SELECTOR"];
  if (has(FUEL_TOKENS)) return ["FUEL_SELECTOR", "FUEL_QUANTITY_GAUGE_L", "FUEL_QUANTITY_GAUGE_R", "FUEL_FLOW_GAUGE_L", "FUEL_FLOW_GAUGE_R", "FUEL_SOV_L", "FUEL_SOV_R", "EMERG_FUEL_SHUTOFF_L", "EMERG_FUEL_SHUTOFF_R", "AFT_BOOST_PUMP", "FWD_BOOST_PUMP", "AUTOFEATHER_SELECT"];
  if (u.indexOf("AIRSPEED") > -1) return ["ASI", "PFD_LEFT", "PFD_RIGHT"];
  if (u.indexOf("VERTICAL") > -1 || u.indexOf("VSI") > -1) return ["VSI", "PFD_LEFT", "PFD_RIGHT"];
  if (u.indexOf("ANNUN") > -1 || u.indexOf("MASTER") > -1) return ["MASTER_CAUTION", "MASTER_CAUTION_LEFT", "MASTER_CAUTION_RIGHT", "MASTER_WARNING_LEFT", "MASTER_WARNING_RIGHT", "PFD_LEFT", "PFD_RIGHT", "MFD_CENTER", "MFD_CENTRE_DISPLAY"];
  if (has(POWER_LEVER_TOKENS) || u.indexOf("POWER LEVER") > -1) return ["POWER_LEVER_L", "POWER_LEVER_R", "PROP_LEVER_L", "PROP_LEVER_R", "FUEL_LEVER_L", "FUEL_LEVER_R"];
  if (u.indexOf("PROP") > -1 || u.indexOf("FEATHER") > -1) return ["PROP_LEVER_L", "PROP_LEVER_R"];
  if (has(POWER_STACK_TOKENS)) return ["POWER_LEVER_L", "POWER_LEVER_R", "PROP_LEVER_L", "PROP_LEVER_R", "FUEL_LEVER_L", "FUEL_LEVER_R"];
  return [];
}
const SEMANTIC_REGIONS = {
  POWER_LEVERS: { left: 0.34, top: 0.20, width: 0.26, height: 0.18, labels: ["Power levers", "Power levers", "Power levers"] },
  FLAPS: { left: 0.50, top: 0.39, width: 0.03, height: 0.06, labels: ["Flap selector", "Flap selector", "Flap selector"] },
  FUEL_PANEL: { left: 0.42, top: 0.57, width: 0.12, height: 0.12, labels: ["Fuel selector", "Fuel selector", "Fuel selector"] },
  START_PANEL: { left: 0.29, top: 0.28, width: 0.12, height: 0.10, labels: ["Start / ignition controls", "Start / ignition controls", "Start / ignition controls"] },
  ENGINE_INSTRUMENTS: { left: 0.36, top: 0.49, width: 0.28, height: 0.16, labels: ["Engine instruments", "Engine indications", "Engine cross-check"] },
  POWER_STACK: { left: 0.34, top: 0.18, width: 0.30, height: 0.24, labels: ["Setup / power quadrant", "Power / engine controls", "Power / cleanup check"] },
  INSTRUMENT_SCAN: { left: 0.18, top: 0.15, width: 0.64, height: 0.28, labels: ["Pre-cue instrument scan", "Active cue / indications", "Stabilized instrument scan"] },
  CONFIGURATION: { left: 0.43, top: 0.46, width: 0.18, height: 0.18, labels: ["Configuration set", "Configuration cross-check", "Post-action configuration"] },
  DIRECTIONAL: { left: 0.15, top: 0.56, width: 0.20, height: 0.22, labels: ["Ground / directional setup", "Directional control", "Directional stabilization"] },
  GENERAL_SCAN: { left: 0.28, top: 0.28, width: 0.44, height: 0.32, labels: ["Readiness cross-check", "Recognition cross-check", "Recovery cross-check"] }
};
const PHASE_ORDER = {
  BEFORE: ["POWER_STACK", "START_PANEL", "FUEL_PANEL", "ENGINE_INSTRUMENTS", "CONFIGURATION", "INSTRUMENT_SCAN", "POWER_LEVERS", "FLAPS", "DIRECTIONAL", "GENERAL_SCAN"],
  DURING: ["INSTRUMENT_SCAN", "ENGINE_INSTRUMENTS", "POWER_LEVERS", "POWER_STACK", "FLAPS", "CONFIGURATION", "FUEL_PANEL", "START_PANEL", "DIRECTIONAL", "GENERAL_SCAN"],
  AFTER: ["INSTRUMENT_SCAN", "POWER_STACK", "ENGINE_INSTRUMENTS", "CONFIGURATION", "FLAPS", "POWER_LEVERS", "FUEL_PANEL", "DIRECTIONAL", "START_PANEL", "GENERAL_SCAN"]
};
function semanticKeyFor(target) {
  const u = String(target || "").toUpperCase();
  if (u.indexOf("FLAP") > -1) return "FLAPS";
  if (u.indexOf("START") > -1 || u.indexOf("IGNIT") > -1) return "START_PANEL";
  if (u.indexOf("FUEL") > -1) return "FUEL_PANEL";
  if (u.indexOf("ENGINE") > -1 || u.indexOf("INSTR") > -1 || ENGINE_TOKENS.some(function (t) { return u.split(/[^A-Z0-9]+/).indexOf(t) > -1; })) return "ENGINE_INSTRUMENTS";
  if (u.indexOf("POWER") > -1 || u.indexOf("PROP") > -1 || u.indexOf("CONDITION") > -1 || u.indexOf("LEVER") > -1) return "POWER_LEVERS";
  if (u.indexOf("AIRSPEED") > -1 || u.indexOf("VERTICAL") > -1 || u.indexOf("ANNUN") > -1) return "INSTRUMENT_SCAN";
  if (u.indexOf("CONFIG") > -1) return "CONFIGURATION";
  if (u.indexOf("BRAKE") > -1 || u.indexOf("STEER") > -1 || u.indexOf("NOSE") > -1) return "DIRECTIONAL";
  return null;
}
export function regionsFor(targets, phase, hitboxes) {
  const list = (targets || []).filter(Boolean);
  const ph = PHASES.indexOf(phase) > -1 ? phase : "BEFORE";
  if (list.length && list.every(shouldUseExactRegion)) {
    const regions = [];
    list.forEach(function (target) {
      const upper = String(target).toUpperCase();
      let ids = hitboxes.some(function (h) { return h.id === upper; }) ? [upper] : targetHitboxIds(target);
      const boxes = ids.map(function (id) { return hitboxes.find(function (h) { return h.id === id; }); }).filter(Boolean);
      if (!boxes.length) return;
      let l = 1, t = 1, r = 0, b = 0;
      boxes.forEach(function (h) { l = Math.min(l, h.rect.x); t = Math.min(t, h.rect.y); r = Math.max(r, h.rect.x + h.rect.w); b = Math.max(b, h.rect.y + h.rect.h); });
      const u = upper;
      let px = 0.28, py = 0.30;
      if (u.indexOf("ENGINE") > -1 || u.indexOf("INSTR") > -1) { px = 0.18; py = 0.20; }
      else if (FUEL_TOKENS.some(function (tk) { return u.indexOf(tk) > -1; })) { px = 0.20; py = 0.22; }
      else if (u.indexOf("START") > -1 || u.indexOf("IGNIT") > -1) { px = 0.18; py = 0.20; }
      const w = r - l, h = b - t;
      const padX = Math.max(0.01, w * px), padY = Math.max(0.01, h * py);
      const left = Math.max(0, l - padX), top = Math.max(0, t - padY);
      const right = Math.min(1, r + padX), bottom = Math.min(1, b + padY);
      regions.push({ label: String(target).replace(/_/g, " "), left: left, top: top, width: Math.max(0.02, right - left), height: Math.max(0.02, bottom - top), target: target });
    });
    if (regions.length) return regions;
  }
  const keys = [];
  list.forEach(function (t) { const k = semanticKeyFor(t); if (k && keys.indexOf(k) === -1) keys.push(k); });
  PHASE_ORDER[ph].forEach(function (k) { if (keys.indexOf(k) === -1) keys.push(k); });
  const ordered = PHASE_ORDER[ph].filter(function (k) { return keys.indexOf(k) > -1; });
  return ordered.map(function (k) { const r = SEMANTIC_REGIONS[k]; return { label: r.labels[PHASES.indexOf(ph)], left: r.left, top: r.top, width: r.width, height: r.height, target: k.toLowerCase() }; });
}

/* -------------------------------------------- focus targets (A6.2) */
export function mapHitboxIdToFocusTarget(id) {
  const u = String(id || "").toUpperCase();
  if (u.indexOf("POWER_LEVER") > -1) return "power_levers";
  if (u.indexOf("PROP_LEVER") > -1) return "prop_levers";
  if (u.indexOf("FUEL_LEVER") > -1 || u.indexOf("CONDITION") > -1) return "condition_levers";
  if (u.indexOf("FLAP") > -1) return "flaps";
  if (u.indexOf("START") > -1 || u.indexOf("IGNIT") > -1) return "starter_switches";
  if (["TORQUE", "NG_", "NP_", "T5", "ITT", "OIL", "FUEL_FLOW"].some(function (t) { return u.indexOf(t) > -1; })) return "engine_instruments";
  if (["FUEL", "BOOST", "CROSSFEED", "SOV"].some(function (t) { return u.indexOf(t) > -1; })) return "fuel";
  if (["ASI", "AIRSPEED", "PFD_LEFT", "PFD_RIGHT"].some(function (t) { return u.indexOf(t) > -1; })) return "airspeed";
  if (u.indexOf("VSI") > -1 || u.indexOf("VERTICAL") > -1) return "vertical_speed";
  if (["ANNUN", "MASTER_WARNING", "MASTER_CAUTION", "CAS"].some(function (t) { return u.indexOf(t) > -1; })) return "annunciators";
  if (u.indexOf("TRIM") > -1) return "trim";
  if (u.indexOf("BRAKE") > -1) return "brakes";
  if (u.indexOf("NOSE") > -1 || u.indexOf("STEER") > -1) return "steering";
  if (["BLEED", "DEICE", "DE_ICE", "PITOT", "INTAKE"].some(function (t) { return u.indexOf(t) > -1; })) return "ice_protection";
  if (u.indexOf("LIGHT") > -1) return "lights";
  return String(id || "").toLowerCase();
}
export function deriveTextFocusTargets(text) {
  const u = String(text || "").toUpperCase();
  const out = [];
  function add(t) { if (out.indexOf(t) === -1) out.push(t); }
  if (u.indexOf("CONDITION") > -1 || u.indexOf("FUEL LEVER") > -1 || u.indexOf("CUTOFF") > -1) add("condition_levers");
  if (["POWER LEVER", "POWER", "THROTTLE", "REVERSE", "BETA"].some(function (t) { return u.indexOf(t) > -1; })) add("power_levers");
  if (u.indexOf("PROP") > -1 || u.indexOf("FEATHER") > -1) add("prop_levers");
  if (u.indexOf("FLAP") > -1) add("flaps");
  if (u.indexOf("START") > -1 || u.indexOf("IGNIT") > -1 || u.indexOf("LIGHT UP") > -1) add("starter_switches");
  if (u.indexOf("FUEL") > -1 || u.indexOf("BOOST PUMP") > -1 || u.indexOf("CROSSFEED") > -1) add("fuel");
  if (["TORQUE", "NG", "NP", "T5", "ITT", "OIL", "FUEL FLOW"].some(function (t) { return new RegExp("(^|[^A-Z])" + t + "([^A-Z]|$)").test(u); })) add("engine_instruments");
  if (["AIRSPEED", "ASI", "VREF", "APPROACH SPEED"].some(function (t) { return u.indexOf(t) > -1; })) add("airspeed");
  if (["VSI", "VERTICAL", "CLIMB", "DESCENT"].some(function (t) { return u.indexOf(t) > -1; })) add("vertical_speed");
  if (["ANNUN", "CAS", "CAUTION", "WARNING"].some(function (t) { return u.indexOf(t) > -1; })) add("annunciators");
  if (u.indexOf("TRIM") > -1) add("trim");
  if (u.indexOf("BRAKE") > -1) add("brakes");
  if (u.indexOf("NOSEWHEEL") > -1 || u.indexOf("STEER") > -1) add("steering");
  if (["ICE", "DE-ICE", "DEICE", "PITOT", "INTAKE"].some(function (t) { return u.indexOf(t) > -1; })) add("ice_protection");
  if (u.indexOf("LIGHT") > -1) add("lights");
  return out;
}
export function deriveSnapshotFocusTargets(phase, snapshot, title) {
  const parts = [title || "", snapshot.notes || ""].concat(Object.keys(snapshot.controls || {})).concat(Object.keys(snapshot.instruments || {})).concat((snapshot.annunciators || []).map(function (a) { return a.id || a; }));
  const u = parts.join(" ").toUpperCase();
  const out = [];
  function add(t) { if (out.indexOf(t) === -1 && out.length < 4) out.push(t); }
  if (u.indexOf("CONDITION") > -1 || u.indexOf("FUEL_LEVER") > -1) add("condition_levers");
  if (["POWER_LEVER", "THROTTLE", "REVERSE", "BETA"].some(function (t) { return u.indexOf(t) > -1; })) add("power_levers");
  if (["PROP_LEVER", "PROP", "FEATHER"].some(function (t) { return u.indexOf(t) > -1; })) add("prop_levers");
  if (["FUEL SELECT", "FUEL_SELECTOR", "FUEL QUANTITY", "FUEL_QUANTITY", "BOOST PUMP", "BOOST_PUMP", "CROSSFEED"].some(function (t) { return u.indexOf(t) > -1; })) add("fuel");
  if (["FLAP", "LANDING", "TAKEOFF"].some(function (t) { return u.indexOf(t) > -1; })) add("flaps");
  if (["START", "IGNIT", "NO LIGHT UP"].some(function (t) { return u.indexOf(t) > -1; })) add("starter_switches");
  if (["TORQUE", "NG", "NP", "T5", "ITT", "OIL", "FUEL_FLOW"].some(function (t) { return u.indexOf(t) > -1; })) add("engine_instruments");
  if (["ASI", "AIRSPEED", "VREF", "APPROACH"].some(function (t) { return u.indexOf(t) > -1; })) add("airspeed");
  if (["VSI", "VERTICAL_SPEED", "DESCENT", "CLIMB"].some(function (t) { return u.indexOf(t) > -1; })) add("vertical_speed");
  if ((snapshot.annunciators || []).length) add("annunciators");
  if (!out.length) return phase === "BEFORE" ? ["power_levers", "engine_instruments"] : phase === "DURING" ? ["engine_instruments", "power_levers"] : ["power_levers", "flaps"];
  return out;
}

/* Procedure-derived focus targets: steps grouped into BEFORE/DURING/AFTER by position. */
export function procedureFocusTargetsByPhase(steps, lookupHitboxes) {
  const grouped = { BEFORE: [], DURING: [], AFTER: [] };
  const all = [];
  const n = steps.length;
  steps.forEach(function (step, i) {
    const norm = n <= 1 ? 0 : i / (n - 1);
    const phase = norm < 0.34 ? "BEFORE" : norm < 0.67 ? "DURING" : "AFTER";
    const targets = [];
    const bound = lookupHitboxes ? lookupHitboxes(step.action) : [];
    (bound || []).forEach(function (id) { targets.push(mapHitboxIdToFocusTarget(id)); });
    deriveTextFocusTargets(step.action).forEach(function (t) { targets.push(t); });
    targets.forEach(function (t) {
      if (!grouped[phase].some(function (x) { return x.toLowerCase() === t.toLowerCase(); })) grouped[phase].push(t);
      if (!all.some(function (x) { return x.toLowerCase() === t.toLowerCase(); })) all.push(t);
    });
  });
  PHASES.forEach(function (ph) { if (!grouped[ph].length) grouped[ph] = all.slice(); grouped[ph] = grouped[ph].slice(0, 8); });
  return grouped;
}

export function mergeFocusTargets(primary, fallback, limit) {
  const src = primary && primary.length ? primary : (fallback || []);
  const out = [];
  src.forEach(function (t) { if (t && !out.some(function (x) { return x.toLowerCase() === String(t).toLowerCase(); })) out.push(t); });
  return out.slice(0, limit || 8);
}

/* buildScenarioBundleForProcedure */
export function buildScenarioBundle(registry, procedureId, title, variant, steps, lookupHitboxes) {
  const triplet = registry.resolveAll(procedureId, variant);
  const resolvedTitle = String(title || "").trim() || String(procedureId || "").split("/").pop();
  const procTargets = procedureFocusTargetsByPhase(steps || [], lookupHitboxes);
  const bundle = { title: resolvedTitle, procKey: triplet.procKey, found: Boolean(triplet.entry) };
  PHASES.forEach(function (ph) {
    const snap = triplet.phases[ph];
    const targets = mergeFocusTargets(procTargets[ph], deriveSnapshotFocusTargets(ph, snap, resolvedTitle), 8);
    bundle[ph] = toPhaseState(snap, targets);
    bundle[ph].snapshot = snap;
  });
  return bundle;
}

/* displayFocusTarget: power_levers → "Power Levers" */
export function displayFocusTarget(target) {
  return String(target || "").split("_").filter(Boolean).map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(" ");
}

/* Find the first annunciator host hitbox for a lamp id (§4.6-F). */
export function findAnnunciatorHost(hitboxes, lampId) {
  const wanted = canonicalVisualAliases(lampId);
  const hosts = hitboxes.filter(isAnnunciatorVisualHost);
  for (let i = 0; i < hosts.length; i += 1) { const keys = cockpitVisualKeys(hosts[i]); if (keys.some(function (k) { return wanted.indexOf(k) > -1; })) return hosts[i]; }
  for (let i = 0; i < hosts.length; i += 1) { const keys = cockpitVisualKeys(hosts[i]); if (keys.some(function (k) { return visualKeysMatch(k, lampId); })) return hosts[i]; }
  return null;
}

export { rectPx };
