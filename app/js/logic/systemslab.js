/*
  Technical Lab logic — port of feature-knowledge/…/SystemsLabSection.kt:
  labSimulation(), powerLeverLabel(), propLeverLabel(), qrhCategoryTargetFor(),
  noteStorageKey(), plus the node-name selector matching shared with the
  Android region maps (see tools/data/systems-lab-models.json).

  The authored content (parts, faults, templates) arrives in the protected
  `systems-lab` pack; nothing here contains training text.
*/

/* ------------------------------------------------------------ selectors */
/* Android SystemsLab3dViewer.normalizedModelName: trim, lower-case, strip ".NNN" */
export function normalizeNodeName(name) {
  return String(name || "").trim().toLowerCase().replace(/\.\d{3}$/, "");
}

const regexCache = new Map();
function selectorRegex(body) {
  if (!regexCache.has(body)) {
    let re = null;
    try { re = new RegExp(body, "i"); } catch (error) { re = null; }
    regexCache.set(body, re);
  }
  return regexCache.get(body);
}

/*
  "Name"  -> normalized equality or prefix "name_" / "name." / "name " / "name|"
  "=Name" -> exact (normalized)
  "~re"   -> case-insensitive regular expression on the raw name
*/
export function selectorMatches(selector, nodeName) {
  if (!selector) return false;
  if (selector[0] === "~") { const re = selectorRegex(selector.slice(1)); return re ? re.test(String(nodeName || "")) : false; }
  const n = normalizeNodeName(nodeName);
  if (selector[0] === "=") return n === normalizeNodeName(selector.slice(1));
  const s = normalizeNodeName(selector);
  return n === s || n.startsWith(s + "_") || n.startsWith(s + ".") || n.startsWith(s + " ") || n.startsWith(s + "|");
}

export function anySelectorMatches(selectors, nodeName) {
  return (selectors || []).some(function (s) { return selectorMatches(s, nodeName); });
}

/* Does any name in the ancestor chain (mesh → … → root) match? */
export function chainMatches(selectors, chain) {
  return (chain || []).some(function (name) { return anySelectorMatches(selectors, name); });
}

/* ------------------------------------------------------------ registry */
export function modelById(pack, id) {
  return ((pack && pack.registry && pack.registry.models) || []).find(function (m) { return m.id === id; }) || null;
}

export function modelsForSystem(pack, system) {
  const def = pack && pack.systems && pack.systems[system];
  if (!def) return [];
  return (def.models || []).map(function (id) { return modelById(pack, id); }).filter(Boolean);
}

/* Part pins for a model inside a system: Android LabParts first (with their
   selectors from the registry), then model-only groups (no authored text). */
export function pinsForModel(pack, system, model) {
  const def = pack.systems[system];
  const pins = [];
  (def.parts || []).forEach(function (part, index) {
    const selectors = (model && model.parts && model.parts[part.id]) || [];
    pins.push({ id: part.id, number: index + 1, label: part.label, part: part, selectors: selectors, authored: true, mapped: selectors.length > 0 });
  });
  (model && model.extraParts ? model.extraParts : []).forEach(function (extra) {
    if (pins.some(function (p) { return p.id === extra.id; })) return;
    pins.push({ id: extra.id, number: pins.length + 1, label: extra.label, part: null, selectors: extra.selectors || [], authored: false, mapped: true });
  });
  return pins;
}

/*
  Clip selectors are NOT node selectors, and the difference is load-bearing:
  a clip name is matched exactly unless it is a "~regex", where a node name
  also matches on the "name_" / "name." / "name " / "name|" prefixes. Exported
  so that anything asking "does this clip selector resolve" - the GLB
  inspector, for one - asks with these semantics rather than a second
  implementation that agrees with them right up until it doesn't.
*/
export function clipSelectorMatches(selector, clipName) {
  if (!selector) return false;
  if (selector[0] === "~") { const re = selectorRegex(selector.slice(1)); return re ? re.test(String(clipName || "")) : false; }
  return selector === clipName;
}

/* Animation clip groups: registry clipGroups (label → selectors over clip
   names) or one entry per distinct clip label. */
export function clipGroupsForModel(model, clipNames) {
  const names = clipNames || model.animations || [];
  const groups = [];
  const configured = model.clipGroups || {};
  Object.keys(configured).forEach(function (label) {
    const selectors = configured[label];
    const clips = names.filter(function (name) {
      return selectors.some(function (s) { return clipSelectorMatches(s, name); });
    });
    if (clips.length) groups.push({ label: label, clips: clips });
  });
  if (!groups.length) {
    const labels = model.clips || {};
    const byLabel = new Map();
    names.forEach(function (name) {
      const label = labels[name] || name.replace(/\.\d{3}$/, "").replace(/Action(\.\d{3})?$/, "").replace(/_/g, " ");
      if (!byLabel.has(label)) byLabel.set(label, []);
      byLabel.get(label).push(name);
    });
    byLabel.forEach(function (clips, label) { groups.push({ label: label, clips: clips }); });
  }
  return groups;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(bytes >= 10e6 ? 0 : 1) + " MB";
  if (bytes >= 1e3) return Math.round(bytes / 1e3) + " KB";
  return bytes + " B";
}

/* ---------------------------------------------------------- lever labels */
export function powerLeverLabel(value) {
  if (value < 0.12) return "REVERSE";
  if (value < 0.30) return "IDLE";
  if (value < 0.48) return "DESCENT";
  if (value < 0.66) return "CRUISE";
  if (value < 0.84) return "CLIMB";
  return "MAX";
}

export function propLeverLabel(value) {
  if (value < 0.34) return "FEATHER";
  if (value < 0.67) return "COARSE";
  return "FINE";
}

/* ------------------------------------------------------------ simulation */
function evalExpr(expr, env) {
  if (expr === null || expr === undefined) return undefined;
  if (typeof expr !== "object") return expr;
  if (Array.isArray(expr)) return expr;
  if (expr.var === "fuelOn") return env.fuelOn;
  if (expr.var === "powerLever") return env.powerLever;
  if (expr.var === "propLever") return env.propLever;
  if (expr.var === "fault.qrhBridge") return env.fault ? env.fault.qrhBridge : "";
  if (expr.ifFuel) return env.fuelOn ? evalExpr(expr.ifFuel[0], env) : evalExpr(expr.ifFuel[1], env);
  if (expr.atLeast) return Math.max(env[expr.atLeast[0]], expr.atLeast[1]);
  if (expr.atMost) return Math.min(env[expr.atMost[0]], expr.atMost[1]);
  return undefined;
}

function fillTemplate(template, values) {
  return String(template || "").replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, function (m, a, b) {
    const key = a || b;
    return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : m;
  });
}

/* labSimulation(system, powerLever, propLever, fuelOn, selectedFault) */
export function labSimulation(pack, system, powerLever, propLever, fuelOn, selectedFault) {
  const sim = pack.simulation;
  // POH/FCTM limits as authored in the Android model (see SystemsLabSection.kt)
  const normalNg = fuelOn ? Math.min(102, Math.round(58 + powerLever * 43.5)) : 0;
  const normalNp = !fuelOn ? 0
    : propLever < 0.34 ? 0
    : powerLever < 0.12 ? 91
    : powerLever < 0.30 ? 44
    : propLever > 0.67 ? 96
    : Math.round(75 + propLever * 15);
  const normalTorque = (!fuelOn || propLever < 0.34 || powerLever < 0.30) ? 0
    : propLever > 0.67 ? Math.round(Math.min(powerLever * 50, 50))
    : Math.round(powerLever * 40);
  const normalItt = !fuelOn ? 120
    : powerLever < 0.12 ? 490
    : powerLever < 0.30 ? Math.round(490 + (powerLever / 0.30) * 50)
    : powerLever < 0.66 ? Math.round(565 + ((powerLever - 0.30) / 0.36) * 110)
    : Math.round(680 + ((powerLever - 0.66) / 0.34) * 45);
  const normalFuelFlow = fuelOn ? Math.round(185 + powerLever * 415) : 0;

  function build(o) {
    const ng = o.ng !== undefined ? o.ng : normalNg;
    const np = o.np !== undefined ? o.np : normalNp;
    const torque = o.torque !== undefined ? o.torque : normalTorque;
    const itt = o.itt !== undefined ? o.itt : normalItt;
    const fuelFlow = o.fuelFlow !== undefined ? o.fuelFlow : normalFuelFlow;
    const t5Limit = powerLever < 0.30 ? "idle lim 660°C" : powerLever < 0.84 ? "cruise lim 695°C" : "T/O lim 725°C";
    return {
      powerLever: o.effectivePower !== undefined ? o.effectivePower : powerLever,
      propLever: o.effectiveProp !== undefined ? o.effectiveProp : propLever,
      fuelOn: o.effectiveFuel !== undefined ? o.effectiveFuel : fuelOn,
      ng: ng, np: np, torque: torque, itt: itt, fuelFlow: fuelFlow,
      metricLine: "NG " + ng + "% • NP " + np + "% • Torque " + torque + " PSI • T5 " + itt + "°C (" + t5Limit + ") • FF " + fuelFlow + " lb/hr",
      observedResult: o.observedResult || "",
      indication: o.indication || "",
      likelyCause: o.likelyCause || "",
      immediateAction: o.immediateAction || "",
      qrhBridge: o.qrhBridge || "",
      activePartIds: o.activePartIds || [],
      activeFaultId: o.activeFaultId !== undefined ? o.activeFaultId : (selectedFault ? selectedFault.id : null)
    };
  }

  if (selectedFault && sim.faults && sim.faults[selectedFault.id]) {
    const env = { fuelOn: fuelOn, powerLever: powerLever, propLever: propLever, fault: selectedFault };
    const branch = sim.faults[selectedFault.id];
    const resolved = {};
    Object.keys(branch).forEach(function (key) { resolved[key] = evalExpr(branch[key], env); });
    return build(resolved);
  }

  const power = powerLeverLabel(powerLever);
  const prop = propLeverLabel(propLever);
  const fuel = fuelOn ? "ON" : "OFF";
  const t5Limit = powerLever < 0.30 ? "idle limit 660°C" : powerLever < 0.84 ? "cruise limit 695°C" : "T/O limit 725°C";
  const notes = sim.bladeNotes || [];
  const bladeNote = propLever < 0.34 ? notes[0] : powerLever < 0.12 ? notes[1] : powerLever < 0.30 ? notes[2] : propLever > 0.67 ? notes[3] : notes[4];
  const values = { normalNg: normalNg, normalNp: normalNp, normalTorque: normalTorque, normalItt: normalItt, normalFuelFlow: normalFuelFlow, t5Limit: t5Limit, power: power, prop: prop, fuel: fuel, bladeNote: bladeNote || "" };
  const template = (sim.normalText && sim.normalText[system]) || sim.normalElse || "";
  const normal = Object.assign({}, sim.normalBuild || {}, { observedResult: fillTemplate(template, values), activePartIds: [], activeFaultId: null });
  return build(normal);
}

/* ---------------------------------------------------------- QRH routing */
export function qrhCategoryTargetFor(system, selectedFault) {
  const faultId = selectedFault ? selectedFault.id : "";
  if (faultId === "engine_fire" || faultId === "fuel_off") return "EMERGENCY";
  if (faultId === "oil_pressure_loss") return "ABNORMAL";
  if (faultId) return "ABNORMAL";
  if (system === "FIRE_PROTECTION") return "EMERGENCY";
  return "ABNORMAL";
}

/* Android deep link "procedure:<title> <bridge>" opens the QRH with a search;
   the web routes to the Procedure Library search with the fault title. */
export function qrhTargetHref(system, selectedFault) {
  if (selectedFault) return "#/systems?q=" + encodeURIComponent(selectedFault.title);
  return "#/qrh/category/" + qrhCategoryTargetFor(system, null);
}

export function noteStorageKey(system, partId) { return system + "::" + partId; }

/* Default lever positions per system (initialPowerLever / initialPropLever). */
export function initialLevers(pack, system) {
  const def = pack.systems[system] || {};
  return { power: typeof def.initialPowerLever === "number" ? def.initialPowerLever : 0.46, prop: typeof def.initialPropLever === "number" ? def.initialPropLever : 0.5 };
}

/* Models a viewer may auto-load without an explicit tap (bytes). */
export const AUTO_LOAD_LIMIT = 12 * 1024 * 1024;
