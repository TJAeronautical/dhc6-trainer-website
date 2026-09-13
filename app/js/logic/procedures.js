/*
  Procedure logic ported from the Android app (source of truth):
    domain/procedures/ProcedureTitleFormatter.kt
    domain/procedures/compiled/CompiledDrillProcedure.kt   (compiledProcedureId)
    data/procedures/ProcedureAssetStore.kt                (variant materialisation)
    feature-procedures/ui/model/QrhProcedureMapper.kt     (QRH detail lines, ranks)
    feature-procedures/ui/screens/QrhDetailScreen.kt      (cleanQrhLine, qrhLineToProcedureStep)
    feature-procedures/ui/screens/QrhListScreen.kt        (list ordering, tile art)
    feature-procedures/ui/screens/ProcedureLibraryScreen.kt (buckets, filters, badges)
  Pure functions only — no DOM — so they can be unit-tested in Node.
*/

export const CATEGORIES = ["NORMAL", "ABNORMAL", "EMERGENCY"];

const TITLE_ACRONYMS = new Set(["AC", "AFM", "APU", "CAS", "CB", "DC", "DHC", "ELT", "GPU", "IFR", "ITT",
  "MEL", "NG", "NP", "OEI", "PF", "PM", "POH", "PT6", "QRH", "RPM", "STOL", "T5", "TCAS", "TAWS", "VFR", "VMC", "VMO", "VREF"]);

/* ProcedureTitleFormatter.formatProcedureDisplayTitle */
export function formatProcedureDisplayTitle(rawTitle) {
  const cleaned = String(rawTitle || "")
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\s*\[(ground|airborne|ground\/airborne|ground airborne|taxi|take off|takeoff|climb|cruise|descent|approach|landing|enroute|arrival|departure|normal|abnormal|emergency)[^\]]*\]\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "Procedure";
  return cleaned.toLowerCase().split(" ").filter(Boolean).map(function (word) {
    const upper = word.toUpperCase();
    if (TITLE_ACRONYMS.has(upper) || /^[A-Z]+[0-9]+$/.test(upper)) return upper;
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(" ");
}

/* CompiledDrillProcedure.buildCompiledProcedureId */
export function compiledProcedureId(category, procedureName) {
  const title = String(procedureName || "").replace(/\s+/g, " ").trim() || "UNTITLED PROCEDURE";
  return String(category || "").trim().toUpperCase() + "/" + title;
}

/* CrewRole.fromString / ActionIntent.fromString */
export function crewRole(raw) {
  const n = String(raw || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (["PF", "PILOT_FLYING", "FLYING", "PIC", "CAPTAIN"].includes(n)) return "PF";
  if (["PM", "PNF", "PILOT_MONITORING", "MONITORING", "FO", "FIRST_OFFICER"].includes(n)) return "PM";
  if (["BOTH", "BOTH_CREW", "CREW", "PF_PM", "PM_PF", "ALL"].includes(n)) return "BOTH";
  return "PF";
}
export function actionIntent(raw) {
  const n = String(raw || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (["ANNOUNCE", "CALL", "CALLOUT", "CALL_OUT"].includes(n)) return "ANNOUNCE";
  if (["DO", "ACTION", "EXECUTE", "PERFORM"].includes(n)) return "DO";
  if (["ANNOUNCE_AND_DO", "DO_AND_ANNOUNCE", "ANNOUNCE_DO", "DO_ANNOUNCE", "CALL_AND_DO"].includes(n)) return "ANNOUNCE_AND_DO";
  if (["MEMORY", "MEMORY_ITEM", "IMMEDIATE_ACTION"].includes(n)) return "MEMORY";
  return "DO";
}

/* Normalise a pack step into the Android ProcedureStep shape. */
export function toProcedureStep(step) {
  return {
    action: String(step.action || "").trim(),
    crewRole: crewRole(step.crewRole),
    // Moshi default for a missing intent is ANNOUNCE (ProcedureStep.kt)
    intent: step.intent == null ? "ANNOUNCE" : actionIntent(step.intent),
    requiresConfirmation: Boolean(step.requiresConfirmation),
    reference: step.reference ? String(step.reference) : null
  };
}

/* ProcedureAssetStore.materializeFromContainerJson + addValidated (model-variant rule).
   Returns one Procedure per (file, variant) exactly as the Android repository emits them. */
export function materializeProcedures(packProcedures, selectedVariant) {
  const selected = ["LEGACY", "G950"].includes(selectedVariant) ? selectedVariant : "BOTH";
  const out = [];
  for (const p of packProcedures || []) {
    const variants = p.variants || {};
    const legacy = variants.LEGACY || variants.legacy || null;
    const g950 = variants.G950 || variants.g950 || null;
    const both = variants.BOTH || variants.both || null;
    let produced = [];
    if (selected === "LEGACY") {
      if (legacy) produced = [["LEGACY", legacy]];
      else if (both) produced = [["LEGACY", both]];
    } else if (selected === "G950") {
      if (g950) produced = [["G950", g950]];
      else if (both) produced = [["G950", both]];
    } else {
      if (legacy || g950) produced = [legacy && ["LEGACY", legacy], g950 && ["G950", g950]].filter(Boolean);
      else if (both) produced = [["BOTH", both]];
    }
    for (const pair of produced) {
      const body = pair[1] || {};
      out.push({
        id: p.id,
        pack: p.pack,
        category: String(p.category || "").toUpperCase(),
        rawName: p.rawName || "",
        drillName: p.drillName || "",
        procedureName: p.procedureName || String(p.drillName || "").trim() || String(p.rawName || "").trim(),
        displayTitle: p.displayTitle || formatProcedureDisplayTitle(p.procedureName || p.drillName || p.rawName),
        compiledId: p.compiledId || compiledProcedureId(p.category, p.procedureName || p.drillName || p.rawName),
        qrhRank: Number.isFinite(p.qrhRank) ? p.qrhRank : 9999,
        normalBucket: p.normalBucket || null,
        context: p.context || null,
        sourceNote: p.sourceNote || null,
        aircraftVariant: pair[0],
        /* The build derives this from the Android asset file name
           (procedures/<category>/<slug>.json). The CRM drill names its four
           source procedures by asset path, so it needs the slug to find them. */
        slug: p.slug || null,
        memory: (body.memory || []).map(toProcedureStep),
        flow: (body.flow || []).map(toProcedureStep)
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ QRH */
/* QrhListScreen: sort by ProcedureSortOrder rank, then title upper, variant, id. */
export function qrhListItems(procedures, category, query) {
  const q = String(query || "").trim().toLowerCase();
  return procedures
    .filter(function (p) { return p.category === category && (p.memory.length > 0 || p.flow.length > 0); })
    .filter(function (p) { return !q || p.displayTitle.toLowerCase().includes(q); })
    .sort(function (a, b) {
      return (a.qrhRank - b.qrhRank) ||
        cmp(a.displayTitle.toUpperCase(), b.displayTitle.toUpperCase()) ||
        cmp(a.aircraftVariant, b.aircraftVariant) ||
        cmp(a.compiledId, b.compiledId);
    });
}

function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

/* QrhProcedureMapper.formatProcedureStep */
export function formatProcedureStepLine(step) {
  const ref = String(step.reference || "").trim();
  let line = step.crewRole + " — " + step.action.trim() + " • " + step.intent + (step.requiresConfirmation ? " • CONFIRM" : "");
  if (ref) line += " • " + ref;
  return line;
}

/* QrhProcedureMapper.toDetail */
export function toQrhDetail(procedure) {
  const memoryItems = procedure.memory.map(formatProcedureStepLine).filter(function (l) { return l.trim(); });
  const steps = procedure.flow.map(function (step, index) { return (index + 1) + ". " + formatProcedureStepLine(step); }).filter(function (l) { return l.trim(); });
  const firstMemory = (procedure.memory[0] && procedure.memory[0].action.trim()) || "";
  const firstFlow = (procedure.flow[0] && procedure.flow[0].action.trim()) || "";
  const trigger = firstMemory ? "Immediate action: " + firstMemory : (firstFlow ? "Use when applicable: " + firstFlow : null);
  return { title: procedure.displayTitle, trigger: trigger, memoryItems: memoryItems, steps: steps, notes: [] };
}

/* QrhDetailScreen.cleanQrhLine */
export function cleanQrhLine(raw) {
  return String(raw || "").trim()
    .replace(/^\d+\.\s*/, "")
    .replace(/^(PF|PM)\s*[ -]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* QrhDetailScreen.qrhLineToProcedureStep */
export function qrhLineToProcedureStep(raw, defaultIntent) {
  const trimmed = String(raw || "").trim();
  const upper = trimmed.toUpperCase();
  const role = upper.startsWith("PF") ? "PF" : upper.startsWith("PM") ? "PM" : upper.startsWith("BOTH") ? "BOTH" : "PF";
  const action = cleanQrhLine(trimmed);
  const lower = action.toLowerCase();
  const intent = defaultIntent === "MEMORY" ? "MEMORY" : (lower.includes("announce") || lower.includes("call")) ? "ANNOUNCE" : defaultIntent;
  const requiresConfirmation = lower.includes("confirm") || lower.includes("verify") || defaultIntent === "MEMORY";
  return { action: action, crewRole: role, intent: intent, requiresConfirmation: requiresConfirmation, reference: null };
}

/* Detail lines → drill steps exactly as QrhDetailScreen builds them. */
export function qrhDrillSteps(detail) {
  const memoryItems = detail.memoryItems.map(cleanQrhLine).filter(Boolean);
  let checklistItems = detail.steps.map(cleanQrhLine).filter(Boolean);
  if (!checklistItems.length) checklistItems = memoryItems.slice();
  return {
    memoryItems: memoryItems,
    checklistItems: checklistItems,
    memorySteps: memoryItems.map(function (l) { return qrhLineToProcedureStep(l, "MEMORY"); }),
    flowSteps: checklistItems.map(function (l) { return qrhLineToProcedureStep(l, "DO"); })
  };
}

/* QrhListScreen.qrhTileImageRes / ProcedureLibraryScreen.procedureTileImageRes (same table). */
export function procedureTileImage(title, category) {
  const key = String(title || "").toLowerCase();
  const has = function () { for (let i = 0; i < arguments.length; i += 1) if (key.includes(arguments[i])) return true; return false; };
  if (category === "EMERGENCY") return "procedure_tile_emergency_red";
  if (category === "ABNORMAL") return "procedure_tile_abnormal_caution";
  if (has("propeller", "autofeather", "overspeed", "reversing")) return "procedure_tile_propeller";
  if (has("electrical", "battery", "t5", "auto ignition")) return "procedure_tile_electrical";
  if (has("bleed", "pneumatic", "intake deflector")) return "procedure_tile_pneumatic";
  if (has("before entering", "preflight", "exterior")) return "procedure_tile_preflight";
  if (has("fuel dipstick", "fuel")) return "procedure_tile_fuel";
  if (has("cockpit")) return "procedure_tile_cockpit_prep";
  if (has("cabin", "emergency lights")) return "procedure_tile_cabin";
  if (has("starting", "after start", "pre taxi", "start")) return "procedure_tile_start";
  if (has("taxi")) return "procedure_tile_taxi_custom";
  if (has("take off", "takeoff", "initial climb")) return "procedure_tile_takeoff_custom";
  if (has("after takeoff", "after take off", "climb")) return "procedure_tile_climb_custom";
  if (has("cruise")) return "procedure_tile_cruise_custom";
  if (has("descent")) return "procedure_tile_descent_custom";
  if (has("approach", "traffic pattern")) return "procedure_tile_approach_custom";
  if (has("landing", "go around", "balked")) return "procedure_tile_landing_custom";
  if (has("icing", "ice", "crosswind", "cold soak", "external power", "weather", "special")) return "procedure_tile_weather_custom";
  if (has("shutdown")) return "procedure_tile_shutdown";
  return "procedure_tile_qrh_custom";
}

/* QrhHubScreen.qrhTileImageRes (category hero cards). */
export function qrhCategoryTile(category) {
  return category === "NORMAL" ? "procedure_tile_qrh" : category === "ABNORMAL" ? "procedure_tile_abnormal" : "procedure_tile_emergency";
}

/* ----------------------------------------------------- Procedure Library */
export const NORMAL_BUCKETS = {
  ALL: { label: "All Normal", shortLabel: "ALL", description: "All normal procedures from the Excel index." },
  SYSTEM_TESTS: { label: "System Tests", shortLabel: "TEST", description: "Functional checks and required system test drills." },
  EVERYDAY_ACTIONS: { label: "Everyday Actions", shortLabel: "DAILY", description: "Normal day-to-day flow from preflight to shutdown." },
  WEATHER_SPECIAL_CONDITIONS: { label: "Weather / Special Conditions", shortLabel: "WX/SPECI", description: "Icing, crosswind, cold-soak, external power and special-condition procedures." }
};
export const NORMAL_BUCKET_ORDER = ["EVERYDAY_ACTIONS", "SYSTEM_TESTS", "WEATHER_SPECIAL_CONDITIONS"];
export const NORMAL_BUCKET_FILTERS = ["ALL", "SYSTEM_TESTS", "EVERYDAY_ACTIONS", "WEATHER_SPECIAL_CONDITIONS"];
export const CATEGORY_FILTERS = ["ALL", "NORMAL", "ABNORMAL", "EMERGENCY"];

export function normalBucketFor(procedure) {
  return procedure.category === "NORMAL" ? (procedure.normalBucket || "EVERYDAY_ACTIONS") : null;
}

export function sourceBasisFor(procedure) {
  return procedure.category === "NORMAL" ? "POH / AFM Section 4" : "POH / AFM Section 3";
}

export function readinessBadge(procedure) {
  if (procedure.category === "NORMAL") return "CHECKLIST";
  return procedure.memory.length && procedure.flow.length ? "DRILL READY" : "View Drill";
}

export function titleCaseLabel(raw) {
  return String(raw || "").trim().toLowerCase().split(/[_ ]/).filter(Boolean).map(function (t) { return t.charAt(0).toUpperCase() + t.slice(1); }).join(" ");
}

function searchHaystack(p) {
  const parts = [p.procedureName, p.rawName, p.category, p.aircraftVariant];
  if (p.category === "NORMAL") parts.push(NORMAL_BUCKETS[normalBucketFor(p)].label);
  p.memory.forEach(function (s) { parts.push(s.action); if (s.reference) parts.push(s.reference); });
  p.flow.forEach(function (s) { parts.push(s.action); if (s.reference) parts.push(s.reference); });
  return parts.join(" ").toLowerCase();
}

/* ProcedureLibraryScreen visibleProcedures + sections. */
export function libraryVisible(procedures, opts) {
  const o = Object.assign({ query: "", categoryFilter: "ALL", bucket: "ALL", priorityOnly: false, priorityIds: [] }, opts || {});
  const query = String(o.query || "").trim().toLowerCase();
  const pinned = new Set(o.priorityIds || []);
  const catRank = function (c) { return CATEGORIES.indexOf(c); };
  const visible = procedures
    .filter(function (p) { return o.categoryFilter === "ALL" || p.category === o.categoryFilter; })
    .filter(function (p) { return !o.priorityOnly || pinned.has(p.compiledId); })
    .filter(function (p) { return o.categoryFilter !== "NORMAL" || o.bucket === "ALL" || normalBucketFor(p) === o.bucket; })
    .filter(function (p) { return !query || searchHaystack(p).includes(query); })
    .sort(function (a, b) {
      const pa = pinned.has(a.compiledId) ? 1 : 0;
      const pb = pinned.has(b.compiledId) ? 1 : 0;
      if (pa !== pb) return pb - pa;
      if (catRank(a.category) !== catRank(b.category)) return catRank(a.category) - catRank(b.category);
      const ba = a.category === "NORMAL" ? NORMAL_BUCKET_ORDER.indexOf(normalBucketFor(a)) : 0;
      const bb = b.category === "NORMAL" ? NORMAL_BUCKET_ORDER.indexOf(normalBucketFor(b)) : 0;
      if (ba !== bb) return ba - bb;
      const sa = a.category === "NORMAL" ? a.qrhRank : 0;
      const sb = b.category === "NORMAL" ? b.qrhRank : 0;
      if (sa !== sb) return sa - sb;
      return cmp(a.procedureName, b.procedureName);
    });
  const sections = o.categoryFilter !== "NORMAL" ? [] : NORMAL_BUCKET_ORDER.map(function (bucket) {
    const items = visible.filter(function (p) { return normalBucketFor(p) === bucket; });
    return items.length ? { bucket: bucket, items: items } : null;
  }).filter(Boolean);
  return { visible: visible, sections: sections };
}

export function normalBucketCounts(procedures) {
  const counts = {};
  NORMAL_BUCKET_FILTERS.forEach(function (bucket) {
    counts[bucket] = procedures.filter(function (p) { return p.category === "NORMAL" && (bucket === "ALL" || normalBucketFor(p) === bucket); }).length;
  });
  return counts;
}

/* Find a materialised procedure by compiled id (and optional variant). */
export function findByCompiledId(procedures, compiledId, variant) {
  const matches = procedures.filter(function (p) { return p.compiledId === compiledId; });
  if (!matches.length) return null;
  if (variant) { const exact = matches.find(function (p) { return p.aircraftVariant === variant; }); if (exact) return exact; }
  return matches[0];
}
