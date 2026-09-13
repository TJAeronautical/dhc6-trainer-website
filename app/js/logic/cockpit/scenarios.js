/*
  Scenario entry contexts and the Day-to-Day Operations list — port of
  feature-cockpit ui/screens/ScenarioProceduresScreen.kt (ScenarioEntryContext,
  normalScenarioItemsFromProcedures, matchesContext / matchesBucket / matchesSearch,
  cleanScenarioProcedureTitle, inferNormalBucket / inferScenarioPhase /
  inferProcedureGroup, scenarioContextDrawableRes) and ScenarioSelectorScreen.kt
  (allowedScenarioContextsForProcedure, ScenarioLaunchPreset).

  The procedure metadata (bucket / phase / group / section / order) comes from the
  published `procedures-index` pack, which build-content.mjs derives from the same
  Android index the Kotlin table was generated from.
*/

export const CONTEXTS = [
  { key: "GROUND_START", routeKey: "ground_start", title: "Ground / Start", shortDescription: "Before-start, start, and immediate post-start context.", accent: "#1E7D3A", art: "procedure_tile_ground" },
  { key: "TAXI", routeKey: "taxi", title: "Taxi", shortDescription: "Ground handling, checks, and abnormal taxi context.", accent: "#2B79A8", art: "procedure_tile_taxi" },
  { key: "TAKEOFF_INITIAL_CLIMB", routeKey: "takeoff_initial_climb", title: "Takeoff / Initial Climb", shortDescription: "High workload, directional control, and early climb context.", accent: "#C8941A", art: "procedure_tile_takeoff_custom" },
  { key: "CLIMB", routeKey: "climb", title: "Climb", shortDescription: "Power, configuration, and transition-to-climb context.", accent: "#5FB4D8", art: "procedure_tile_climb" },
  { key: "CRUISE", routeKey: "cruise", title: "Cruise", shortDescription: "Stabilized flight and in-flight abnormal context.", accent: "#5FB4D8", art: "procedure_tile_cruise" },
  { key: "APPROACH_LANDING", routeKey: "approach_landing", title: "Approach / Landing", shortDescription: "Approach, go-around, and landing phase context.", accent: "#5FB4D8", art: "procedure_tile_approach" }
];

export function contextByRouteKey(routeKey) {
  const k = String(routeKey || "").trim().toLowerCase();
  return CONTEXTS.find(function (c) { return c.routeKey === k; }) || CONTEXTS.find(function (c) { return c.key === String(routeKey || "").toUpperCase(); }) || CONTEXTS[4];
}

const BRACKET_SUFFIXES = ["GROUND", "AIRBORNE", "GROUND/AIRBORNE", "TAXI", "TAKE-OFF", "CLIMB", "CRUISE", "APPROACH", "LANDING", "ENROUTE", "ARRIVAL", "DEPARTURE", "NORMAL", "ABNORMAL", "EMERGENCY"];
export function cleanScenarioProcedureTitle(title) {
  const raw = String(title || "").trim();
  const match = raw.match(/\s*\[([^\]]*)\]\s*$/);
  if (!match) return raw;
  const inner = match[1].trim().toUpperCase();
  const hit = BRACKET_SUFFIXES.some(function (s) { return inner === s || inner.indexOf(s) === 0; });
  return hit ? raw.slice(0, match.index).trim() : raw;
}

export function inferNormalBucket(title) {
  const u = String(title || "").toUpperCase();
  if (u.indexOf("TEST") > -1 || (u.indexOf("CHECK") > -1 && u.indexOf("SYSTEM") > -1)) return "System Tests";
  if (["ICE", "CROSSWIND", "COLD SOAK", "EXTERNAL POWER"].some(function (t) { return u.indexOf(t) > -1; })) return "Weather / Special Conditions";
  return "Everyday Actions";
}

export function inferScenarioPhase(title, category) {
  const u = String(title || "").toUpperCase();
  const both = ["CABIN EMERGENCY LIGHT", "PROCEDURES UNIQUE TO SERIES 300S", "COCKPIT OR CABIN SMOKE", "KNOWN SOURCE OF FIRE", "UNKNOWN SOURCE OF SMOKE", "SUSPECTED ELECTRICAL FIRE", "DOORS UNLOCKED", "BATTERY OVERHEAT"];
  if (both.some(function (t) { return u.indexOf(t) > -1; })) return "Ground/Airborne";
  const ground = ["ON GROUND", "GROUND", "PRIOR TO ROTATION", "NO LIGHT UP", "DURING START", "FAILURE TO ACCELERATE", "HIGH T5", "LOW OIL PRESSURE", "CLEARING AN ENGINE",
    "BEFORE START", "BEFORE STARTING", "STARTING ENGINE", "AFTER START", "TAXI", "BEFORE TAKE-OFF", "BEFORE TAKEOFF"];
  if (ground.some(function (t) { return u.indexOf(t) > -1; })) return "Ground";
  if (category === "NORMAL" && ["TAKE-OFF", "TAKEOFF", "CROSSWIND TAKE"].some(function (t) { return u.indexOf(t) > -1; })) return "Ground/Airborne";
  return "Airborne";
}

export function inferProcedureGroup(title, category) {
  const u = String(title || "").toUpperCase();
  const rules = [
    [["START", "LIGHT UP", "CLEARING AN ENGINE", "AIR START"], "Engine Start / Restart"],
    [["ENGINE FIRE", "FIRE", "SMOKE"], "Fire / Smoke"],
    [["ENGINE FAILURE", "ENGINE SHUTDOWN", "FLAMEOUT"], "Engine Failure"],
    [["GENERATOR", "ELECTRICAL", "400 CYCLE", "BATTERY"], "Electrical"],
    [["FUEL", "BOOST PUMP"], "Fuel"],
    [["PNEUMATIC", "BLEED", "DUCT"], "Pneumatic / Bleed Air"],
    [["HYDRAULIC"], "Hydraulic"],
    [["PROPELLER", "PROP", "BETA"], "Propeller"],
    [["ICE", "ICING", "DE-ICING"], "Icing / Weather"],
    [["LANDING", "DITCHING", "MISSED APPROACH", "FLAPLESS", "TIRE"], "Approach / Landing"],
    [["CONTROL", "TRIM", "STALL"], "Flight Controls"]
  ];
  for (let i = 0; i < rules.length; i += 1) if (rules[i][0].some(function (t) { return u.indexOf(t) > -1; })) return rules[i][1];
  return category === "NORMAL" ? "Normal Operations" : category === "ABNORMAL" ? "Abnormal Operations" : "Emergency Operations";
}

/* Turn a procedures-index item into the Android ScenarioProcedureMeta shape. */
export function scenarioMetaFor(item) {
  const title = cleanScenarioProcedureTitle(item.displayTitle || item.title || item.procedureName || "");
  const phase = item.phaseTag || inferScenarioPhase(title, item.category);
  return {
    id: item.id,
    compiledId: item.compiledId,
    category: item.category,
    title: title,
    displayLabel: title + " [" + phase + "]",
    phase: phase,
    bucket: item.normalSplit || (item.category === "NORMAL" ? inferNormalBucket(title) : item.category === "ABNORMAL" ? "Abnormal" : "Emergency"),
    sourceSection: item.sourceSection || (item.category === "NORMAL" ? "POH / AFM Section 4" : "POH / AFM Section 3"),
    procedureGroup: item.procedureGroup || inferProcedureGroup(title, item.category),
    sort: item.sortOrder != null ? item.sortOrder : 1000,
    variants: item.variantsAvailable || [],
    counts: item.counts || null
  };
}

export function matchesContext(meta, contextKey) {
  const T = String(meta.title || "").toUpperCase();
  const G = String(meta.procedureGroup || "").toUpperCase();
  const P = String(meta.phase || "").toUpperCase();
  const any = function (hay, list) { return list.some(function (t) { return hay.indexOf(t) > -1; }); };
  switch (contextKey) {
    case "GROUND_START": return P.indexOf("GROUND") > -1 || any(T, ["START", "ON GROUND", "NO LIGHT UP", "HIGH T5", "LOW OIL PRESSURE", "CLEARING AN ENGINE"]);
    case "TAXI": return T.indexOf("TAXI") > -1 || G.indexOf("TAXI") > -1 || T === "AFTER START (PRE-TAXI)" || T === "BEFORE TAKE-OFF";
    case "TAKEOFF_INITIAL_CLIMB": return any(G, ["TAKE-OFF", "TAKEOFF"]) || any(T, ["TAKE-OFF", "TAKEOFF", "PRIOR TO ROTATION", "FAILURE TO ACCELERATE", "PRIOR TO VMC", "AFTER VMC"]) || T === "AFTER TAKE-OFF";
    case "CLIMB": return G.indexOf("CLIMB") > -1 || T === "AFTER TAKE-OFF" || any(T, ["PRIOR TO VMC", "AFTER VMC", "INITIAL CLIMB"]);
    case "CRUISE": return any(G, ["ENROUTE", "ICING"]) || T === "CRUISE" || any(T, ["DURING FLIGHT", "IN FLIGHT", "AIRBORNE"]) || P.indexOf("AIRBORNE") > -1;
    case "APPROACH_LANDING": return any(G, ["ARRIVAL", "APPROACH", "LANDING", "GO-AROUND"]) || any(T, ["APPROACH", "LANDING", "GO AROUND", "BALKED", "MISSED APPROACH", "DITCHING", "FORCED LANDING", "FLAPLESS", "TIRE"]);
    default: return false;
  }
}

export function matchesBucket(meta, bucketFilter) {
  if (!bucketFilter || bucketFilter === "ALL") return true;
  return meta.category === bucketFilter;
}

export function matchesSearch(meta, query) {
  const q = String(query || "").trim().toUpperCase();
  if (!q) return true;
  return [meta.title, meta.displayLabel, meta.bucket, meta.phase, meta.sourceSection, meta.procedureGroup].some(function (v) { return String(v || "").toUpperCase().indexOf(q) > -1; });
}

/* ScenarioSelectorScreen.allowedScenarioContextsForProcedure */
export function allowedContextsFor(title) {
  const u = String(title || "").trim().toUpperCase();
  if (!u) return CONTEXTS.slice();
  const any = function (list) { return list.some(function (t) { return u.indexOf(t) > -1; }); };
  const pick = function (keys) { return keys.map(function (k) { return CONTEXTS.find(function (c) { return c.key === k; }); }).filter(Boolean); };
  if (any(["IN FLIGHT", "DURING FLIGHT", "AIRBORNE", "FLAMEOUT", "EMERGENCY DESCENT", "STALL RECOVERY", "ICE", "OVERSPEED", "HEADING FAILURE", "ALTITUDE"])) return pick(["CLIMB", "CRUISE", "APPROACH_LANDING"]);
  if (u.indexOf("PRIOR TO ROTATION") > -1) return pick(["TAKEOFF_INITIAL_CLIMB"]);
  if (any(["ENGINE FIRE ON GROUND", "NO LIGHT UP", "FAILURE TO ACCELERATE", "HIGH T5", "LOW OIL PRESSURE", "CLEARING AN ENGINE"])) return pick(["GROUND_START"]);
  if (u.indexOf("TAXI") > -1) return pick(["TAXI"]);
  if (any(["START", "BEFORE START", "AFTER START", "PRE-TAXI"])) return pick(["GROUND_START", "TAXI"]);
  if (any(["TAKE-OFF", "TAKEOFF", "LINE UP", "BEFORE TAKE-OFF", "BEFORE TAKEOFF"])) return pick(["TAKEOFF_INITIAL_CLIMB", "CLIMB"]);
  if (any(["APPROACH", "LANDING", "GO AROUND", "BALKED", "MISSED APPROACH"])) return pick(["APPROACH_LANDING"]);
  return CONTEXTS.slice();
}

/* scenarioContextDrawableRes — the tile art, first match wins. */
export function scenarioTileArt(title) {
  const k = String(title || "").toLowerCase();
  const rules = [
    [["propeller", "autofeather", "overspeed", "reversing"], "dhc6_tile_engine_cutaway"],
    [["electrical", "battery", "t5", "auto-ignition", "auto ignition", "bleed", "pneumatic", "intake deflector"], "dhc6_tile_cockpit_panel"],
    [["before entering", "preflight", "exterior", "fuel dipstick"], "dhc6_tile_ground_crew"],
    [["cockpit preparation", "cabin preparation"], "dhc6_tile_apron_departure"],
    [["after start", "pre-taxi"], "procedure_tile_after_start"],
    [["taxi"], "procedure_tile_taxi"],
    [["takeoff", "take-off", "initial climb"], "procedure_tile_takeoff_custom"],
    [["after take-off", "after takeoff"], "procedure_tile_after_takeoff"],
    [["climb"], "procedure_tile_climb"],
    [["cruise"], "procedure_tile_cruise"],
    [["descent"], "procedure_tile_descent"],
    [["approach", "traffic pattern"], "procedure_tile_approach"],
    [["landing", "go around", "balked"], "procedure_tile_landing"],
    [["weather", "icing", "ice", "crosswind", "cold soak", "external power", "special"], "procedure_tile_weather"],
    [["shutdown"], "dhc6_tile_ground"],
    [["ground", "start"], "procedure_tile_ground"]
  ];
  for (let i = 0; i < rules.length; i += 1) if (rules[i][0].some(function (t) { return k.indexOf(t) > -1; })) return rules[i][1];
  return "procedure_tile_scenarios";
}

/* ScenarioLaunchPreset — notes and focus targets used when a context is chosen. */
export const CONTEXT_PRESETS = {
  GROUND_START: { notes: "Use this state for start-related drills and immediate abnormal recognition.", focusTargets: ["condition_levers", "starter_switches", "itt", "ng"] },
  TAXI: { notes: "Use this context for ground movement abnormalities and procedural discipline.", focusTargets: ["nosewheel", "brakes", "power_levers"] },
  TAKEOFF_INITIAL_CLIMB: { notes: "High-workload phase. Prioritize control, power, and immediate actions.", focusTargets: ["power_levers", "torque", "airspeed", "flaps"] },
  CLIMB: { notes: "Transition from departure to stabilized climb.", focusTargets: ["power_levers", "airspeed", "engine_instruments"] },
  CRUISE: { notes: "Use for in-flight QRH and abnormal management in a lower-workload phase.", focusTargets: ["power_levers", "fuel", "engine_instruments"] },
  APPROACH_LANDING: { notes: "Use for approach, landing, or go-around related procedure context.", focusTargets: ["airspeed", "vertical_speed", "flaps", "power_levers"] }
};

/*
  Where a procedure row goes from the Day-to-Day list.

  The user has already chosen an operating context to reach the list, so asking
  again on the way in is a wasted step (Ground -> procedure -> Ground). Only route
  through ScenarioSelectorScreen when the chosen context is not valid for the
  procedure and more than one context is possible.
*/
export function scenarioEntryRoute(procedureId, title, chosenContext) {
  const allowed = allowedContextsFor(title);
  const keep = chosenContext && allowed.some(function (c) { return c.key === chosenContext.key; }) ? chosenContext : null;
  const target = keep || (allowed.length === 1 ? allowed[0] : null);
  return target
    ? { route: "/scenario/state/" + encodeURIComponent(procedureId) + "/" + target.routeKey, context: target, asked: false }
    : { route: "/scenario/select/" + encodeURIComponent(procedureId), context: null, asked: true };
}

/* Build the visible Day-to-Day list for one context. */
export function scenarioItems(indexItems, contextKey, bucketFilter, query) {
  return indexItems
    .map(scenarioMetaFor)
    .filter(function (meta) { return matchesContext(meta, contextKey) && matchesBucket(meta, bucketFilter) && matchesSearch(meta, query); })
    .sort(function (a, b) { return a.sort - b.sort || a.title.localeCompare(b.title); });
}
