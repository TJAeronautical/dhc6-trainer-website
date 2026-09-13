/*
  Systems Lab (Technical Lab) content pack.

  Reads the authored lab content from the Android app's Kotlin sources
  (feature-knowledge …/ui/screens/SystemsLabSection.kt, SystemsLabHomeScreen.kt,
  domain …/knowledge/model/AircraftSystem.kt) and merges it with the model
  registry (tools/data/systems-lab-models.json) that maps the reference-library
  GLB files and their node names onto the Android part ids.

  Pack shape: see buildSystemsLabPack().
*/

import { stripComments, findCalls, argMap, argRaw, functionBody, valDeclaration, whenCases, enumKey, parseValue, balancedEnd } from "./kotlin-lite.mjs";

function fail(message) {
  throw new Error("systems-lab build: " + message);
}

function str(value, what) {
  if (typeof value !== "string") fail("expected string for " + what + ", got " + JSON.stringify(value));
  return value;
}

function enumList(raw) {
  return parseValue(raw).map((v) => enumKey(v.ident || String(v)));
}

/* ---------------------------------------------------------------- systems */
export function readDisplayTitles(source) {
  const body = functionBody(stripComments(source), "displayTitle");
  if (!body) fail("AircraftSystem.displayTitle() not found");
  const map = {};
  const parsed = whenCases(body);
  parsed.cases.forEach((c) => c.keys.forEach((k) => { map[enumKey(k)] = parseValue(c.raw); }));
  // displayTitle uses bare enum names (no AircraftSystem. prefix)
  const bare = /(^|\n)\s*([A-Z_0-9]+)\s*->\s*("(?:[^"\\]|\\.)*")/g;
  let m;
  while ((m = bare.exec(body)) !== null) map[m[2]] = parseValue(m[3]);
  if (!Object.keys(map).length) fail("no displayTitle cases parsed");
  return map;
}

/* Strings may be `system.displayTitle()`; resolved once the system is known. */
function textOrTitle(value, what) {
  if (value && typeof value === "object" && value.expr === "system.displayTitle()") return { displayTitle: true };
  return str(value, what);
}

function parsePart(call) {
  const v = call.args.map((a) => a.value);
  if (v.length < 7) fail("LabPart with " + v.length + " args: " + call.text.slice(0, 80));
  return {
    id: str(v[0], "part id"), label: textOrTitle(v[1], "part label"), notePrompt: textOrTitle(v[2], "notePrompt"),
    normalizedX: Number(v[3]), normalizedY: Number(v[4]), keyFact: textOrTitle(v[5], "keyFact"), consequence: textOrTitle(v[6], "consequence")
  };
}

function resolveTitles(value, title) {
  if (value && typeof value === "object" && value.displayTitle) return title;
  return value;
}

const FAULT_KEYS = ["id", "title", "setup", "observedEffect", "qrhBridge", "evidenceStatus"];
function parseFault(call) {
  const named = argMap(call);
  const out = {};
  if (named.id !== undefined) {
    FAULT_KEYS.forEach((k) => { if (named[k] !== undefined) out[k] = str(named[k], "fault." + k); });
  } else {
    call.args.forEach((a, i) => { if (FAULT_KEYS[i]) out[FAULT_KEYS[i]] = str(a.value, "fault." + FAULT_KEYS[i]); });
  }
  if (!out.evidenceStatus) out.evidenceStatus = "Training simulation. Confirm aircraft-specific response with approved operator and maintenance data.";
  return out;
}

export function readDefinitions(source) {
  const clean = stripComments(source);
  const start = clean.indexOf("private fun systemsLabDefinition(");
  if (start === -1) fail("systemsLabDefinition not found");
  const body = clean.slice(start);
  const systems = {};
  const pattern = /AircraftSystem\.([A-Z_0-9]+)\s*->\s*SystemsLabDefinition\s*\(/g;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    const openIndex = match.index + match[0].length - 1;
    const call = findCalls(body.slice(match.index, balancedEnd(body, openIndex)), "SystemsLabDefinition")[0];
    const named = argMap(call);
    const def = {
      system: match[1],
      objectTitle: typeof named.objectTitle === "string" ? named.objectTitle : (named.objectTitle && named.objectTitle.expr === "system.displayTitle()" ? { displayTitle: true } : null),
      subtitle: typeof named.subtitle === "string" ? named.subtitle : (named.subtitle && named.subtitle.expr ? null : null),
      diagramKind: named.diagramKind ? enumKey(named.diagramKind.ident || "").replace(/^LabDiagramKind\./, "") : null,
      rendererMode: named.rendererMode ? String(named.rendererMode.ident || "").replace(/^LabRendererMode\./, "") : "DIAGRAM_2D",
      drillPrompt: typeof named.drillPrompt === "string" ? named.drillPrompt : "",
      androidModelAsset: null,
      faults: [],
      parts: []
    };
    const modelRaw = argRaw(call, "modelAsset");
    if (modelRaw) {
      const asset = findCalls(modelRaw, "LabModelAsset")[0];
      if (asset) {
        const a = argMap(asset);
        def.androidModelAsset = { assetPath: a.assetPath, displayName: a.displayName, nodePrefix: a.nodePrefix, requiredNodeIds: a.requiredNodeIds || [] };
      } else {
        def.androidModelAsset = { ref: modelRaw.trim() };
      }
    }
    const faultsRaw = argRaw(call, "faults");
    if (faultsRaw) def.faults = findCalls(faultsRaw, "LabFaultScenario").map(parseFault);
    const partsRaw = argRaw(call, "parts");
    if (partsRaw) def.parts = findCalls(partsRaw, "LabPart").map(parsePart);
    systems[match[1]] = def;
    pattern.lastIndex = match.index + match[0].length;
  }
  if (!Object.keys(systems).length) fail("no SystemsLabDefinition branches parsed");
  return systems;
}

function whenStringMap(source, functionName, what) {
  const body = functionBody(source, functionName);
  if (!body) fail(functionName + " not found");
  const parsed = whenCases(body);
  const map = {};
  parsed.cases.forEach((c) => {
    const value = parseValue(c.raw);
    if (typeof value !== "string") return;
    c.keys.forEach((k) => { map[enumKey(k)] = value; });
  });
  return { map: map, elseRaw: parsed.elseRaw };
}

function whenNumberMap(source, functionName) {
  const body = functionBody(source, functionName);
  if (!body) fail(functionName + " not found");
  const parsed = whenCases(body);
  const map = {};
  parsed.cases.forEach((c) => { const v = parseValue(c.raw); if (typeof v === "number") c.keys.forEach((k) => { map[enumKey(k)] = v; }); });
  return { map: map, fallback: parseValue(parsed.elseRaw || "0") };
}

/* ------------------------------------------------------------ simulation */
function simExpr(raw, what) {
  const text = String(raw).trim();
  if (/^-?\d+(\.\d+)?f?$/.test(text)) return Number(text.replace(/f$/, ""));
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "fuelOn" || text === "powerLever" || text === "propLever") return { var: text };
  if (text === "fault.qrhBridge") return { var: "fault.qrhBridge" };
  let m = /^if \(fuelOn\) (.+) else (.+)$/.exec(text);
  if (m) return { ifFuel: [simExpr(m[1], what), simExpr(m[2], what)] };
  m = /^(powerLever|propLever)\.coerceAtLeast\((-?\d+(?:\.\d+)?)f?\)$/.exec(text);
  if (m) return { atLeast: [m[1], Number(m[2])] };
  m = /^(powerLever|propLever)\.coerceAtMost\((-?\d+(?:\.\d+)?)f?\)$/.exec(text);
  if (m) return { atMost: [m[1], Number(m[2])] };
  if (text.startsWith('"')) return parseValue(text);
  if (/^setOf\(/.test(text) || /^emptySet\(\)$/.test(text)) return parseValue(text);
  fail("unsupported simulation expression for " + what + ": " + text);
}

export function readSimulation(source) {
  const clean = stripComments(source);
  const body = functionBody(clean, "labSimulation");
  if (!body) fail("labSimulation not found");
  const letStart = body.indexOf("selectedFault?.let");
  const whenStart = body.indexOf("when (fault.id)", letStart);
  const whenOpen = body.indexOf("{", whenStart);
  const whenEnd = balancedEnd(body, whenOpen);
  const faultBody = body.slice(whenOpen + 1, whenEnd - 1);
  const faults = {};
  whenCases(faultBody).cases.forEach((c) => {
    const call = findCalls(c.raw, "build")[0];
    if (!call) fail("fault case without build(): " + c.keys.join(","));
    const entry = {};
    call.args.forEach((a) => {
      if (!a.name) fail("positional build() arg in " + c.keys.join(","));
      entry[a.name] = simExpr(a.raw, c.keys.join(",") + "." + a.name);
    });
    c.keys.forEach((k) => { faults[enumKey(k)] = entry; });
  });

  // normal-state text per system (template strings with $name / ${expr})
  const normalStart = body.indexOf("val normalText = when (system)");
  const normalOpen = body.indexOf("{", normalStart);
  const normalBody = body.slice(normalOpen + 1, balancedEnd(body, normalOpen) - 1);
  const normalText = {};
  let normalElse = null;
  const bladeNotes = [];
  whenCases(normalBody).cases.forEach((c) => {
    const raw = c.raw.trim();
    if (raw.startsWith("{")) {
      // PROPELLER: `val bladeNote = when { cond -> "…" … else -> "…" }` followed by the template.
      const inner = raw.slice(1, -1);
      const noteStart = inner.indexOf("val bladeNote = when");
      const noteOpen = inner.indexOf("{", noteStart);
      const noteEnd = balancedEnd(inner, noteOpen);
      const noteBody = inner.slice(noteOpen + 1, noteEnd - 1);
      const notePattern = /->\s*("(?:[^"\\]|\\.)*")/g;
      let nm;
      while ((nm = notePattern.exec(noteBody)) !== null) bladeNotes.push(parseValue(nm[1]));
      const tail = inner.slice(noteEnd);
      const templateMatch = /"(?:[^"\\]|\\.)*"/.exec(tail);
      if (!templateMatch) fail("propeller normal-text template not found");
      const template = parseValue(templateMatch[0]);
      c.keys.forEach((k) => { normalText[enumKey(k)] = template; });
    } else {
      const value = parseValue(raw);
      c.keys.forEach((k) => { normalText[enumKey(k)] = value; });
    }
  });
  const elseRaw = whenCases(normalBody).elseRaw;
  if (elseRaw) normalElse = parseValue(elseRaw);
  if (bladeNotes.length !== 5) fail("expected 5 propeller blade notes, got " + bladeNotes.length);
  // final `return build(observedResult = normalText, indication = "…", …)` for the normal state
  const lastBuild = body.lastIndexOf("return build(");
  const normalCall = findCalls(body.slice(lastBuild), "build")[0];
  const normalBuild = {};
  normalCall.args.forEach((a) => {
    if (a.name === "observedResult" || a.name === "activeFaultId" || a.name === "activePartIds") return;
    normalBuild[a.name] = simExpr(a.raw, "normal." + a.name);
  });
  return { faults: faults, normalText: normalText, normalElse: normalElse, bladeNotes: bladeNotes, normalBuild: normalBuild };
}

/* --------------------------------------------------------------- home */
export function readHome(source) {
  const clean = stripComments(source);
  const explorer = enumList(valDeclaration(clean, "aircraftExplorerSystems"));
  const internal = enumList(valDeclaration(clean, "explorerInternalSystems"));
  const hotspots = findCalls(valDeclaration(clean, "explorerExteriorHotspots"), "ExplorerHotspot").map((call) => {
    const v = call.args.map((a) => a.value);
    return { id: str(v[0], "hotspot id"), system: enumKey(v[1].ident), label: str(v[2], "hotspot label"), fx: Number(v[3]), fy: Number(v[4]), fz: Number(v[5]) };
  });
  const heroCall = findCalls(clean, "LabModelAsset")[0];
  const hero = heroCall ? argMap(heroCall) : {};
  return { explorerSystems: explorer, internalSystems: internal, hotspots: hotspots, heroAssetPath: hero.assetPath || null };
}

/* --------------------------------------------------------------- pack */
export function buildSystemsLabPack(input) {
  const section = stripComments(input.sectionSource);
  const definitions = readDefinitions(input.sectionSource);
  const order = enumList(valDeclaration(section, "systemsLabOrder"));
  const shortTitles = whenStringMap(section, "systemsLabShortTitle", "shortTitle").map;
  const trainingBridge = whenStringMap(section, "labTrainingBridge", "trainingBridge");
  const initialPower = whenNumberMap(section, "initialPowerLever");
  const initialProp = whenNumberMap(section, "initialPropLever");
  const simulation = readSimulation(input.sectionSource);
  const home = readHome(input.homeSource);
  const displayTitles = readDisplayTitles(input.aircraftSystemSource);
  const registry = input.registry;

  const variantLines = {};
  const variantBody = functionBody(section, "VariantModelContextCard");
  if (variantBody) {
    const vl = variantBody.indexOf("val variantLine = when (definition.system)");
    const open = variantBody.indexOf("{", vl);
    whenCases(variantBody.slice(open + 1, balancedEnd(variantBody, open) - 1)).cases.forEach((c) => {
      const v = parseValue(c.raw);
      if (typeof v === "string") c.keys.forEach((k) => { variantLines[enumKey(k)] = v; });
    });
  }

  const modelsById = {};
  registry.models.forEach((m) => { modelsById[m.id] = m; });
  const systems = {};
  Object.keys(definitions).forEach((system) => {
    const def = definitions[system];
    const primary = registry.models.filter((m) => (m.primaryFor || []).includes(system)).map((m) => m.id);
    const alternates = registry.models.filter((m) => (m.alternateFor || []).includes(system)).map((m) => m.id);
    const title = displayTitles[system] || system;
    systems[system] = Object.assign({}, def, {
      objectTitle: resolveTitles(def.objectTitle, title) || title,
      subtitle: def.subtitle || "",
      parts: def.parts.map((p) => Object.assign({}, p, { label: resolveTitles(p.label, title), notePrompt: resolveTitles(p.notePrompt, title), keyFact: resolveTitles(p.keyFact, title), consequence: resolveTitles(p.consequence, title) })),
      shortTitle: shortTitles[system] || (displayTitles[system] || system).replace(/^\d+\s*/, ""),
      displayTitle: displayTitles[system] || system,
      trainingBridge: trainingBridge.map[system] || (trainingBridge.elseRaw ? parseValue(trainingBridge.elseRaw) : ""),
      initialPowerLever: initialPower.map[system] !== undefined ? initialPower.map[system] : initialPower.fallback,
      initialPropLever: initialProp.map[system] !== undefined ? initialProp.map[system] : initialProp.fallback,
      variantLine: variantLines[system] || null,
      models: primary.concat(alternates),
      modelStatus: primary.length ? "available" : (def.rendererMode === "MODEL_3D_READY" ? "blocked" : "diagram")
    });
  });

  const labSystems = order.filter((s) => systems[s] && systems[s].rendererMode === "MODEL_3D_READY");
  const extraSystems = Object.keys(systems).filter((s) => !order.includes(s) && systems[s].models.length);

  return {
    id: "systems-lab",
    source: "DHC-6-Trainer feature-knowledge …/ui/screens/SystemsLabSection.kt + SystemsLabHomeScreen.kt + DHC6_REFERENCE_LIBRARY/System-Lab GLB registry",
    count: labSystems.length,
    order: order,
    labSystems: labSystems,
    extraSystems: extraSystems,
    explorer: home,
    displayTitles: displayTitles,
    trainingBridgeDefault: trainingBridge.elseRaw ? parseValue(trainingBridge.elseRaw) : "",
    systems: systems,
    simulation: simulation,
    registry: { version: registry.version, mediaRoot: registry.mediaRoot, models: registry.models }
  };
}
