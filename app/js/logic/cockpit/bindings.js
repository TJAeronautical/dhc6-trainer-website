/*
  Procedure → cockpit hitbox bindings — port of feature-cockpit
  bindings/ProcedureCockpitBindingsIndex.kt. Reads the published `cockpit-bindings`
  pack (core-res/src/main/assets/bindings/*.json) and the variant hitbox list.
*/

function normalize(s) {
  return String(s || "").trim().replace(/\s+/g, " ").replace(/[—–]/g, "-").replace(/•/g, " ").replace(/:/g, " ").replace(/\//g, " ")
    .toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
function canonicalHitboxKey(s) { return String(s || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, ""); }

function scoreOverlap(a, b) {
  if (!a || !b) return 0;
  if (a === b) return a.length;
  const ta = a.split(" ").filter(Boolean), tb = b.split(" ").filter(Boolean);
  if (!ta.length || !tb.length) return 0;
  let prefix = 0;
  while (prefix < ta.length && prefix < tb.length && ta[prefix] === tb[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < ta.length && suffix < tb.length && ta[ta.length - 1 - suffix] === tb[tb.length - 1 - suffix]) suffix += 1;
  return Math.max(prefix, suffix);
}

const ACTIONABLE_TYPES = ["SWITCH", "BUTTON", "LEVER", "KNOB"];
const ACTIONABLE_KINDS = ["SWITCH", "BUTTON", "LEVER"];

export function createHitboxIndex(hitboxes) {
  const ids = new Set();
  const byAlias = new Map();
  const byId = new Map();
  function addAlias(alias, id) {
    const key = canonicalHitboxKey(alias);
    if (!key) return;
    if (!byAlias.has(key)) byAlias.set(key, []);
    const list = byAlias.get(key);
    if (list.indexOf(id) === -1) list.push(id);
  }
  hitboxes.forEach(function (hb) {
    ids.add(hb.id);
    addAlias(hb.id, hb.id);
    byId.set(hb.id, { type: String(hb.type || "").trim().toUpperCase(), kind: hb.binding && hb.binding.kind ? String(hb.binding.kind).trim().toUpperCase() : "" });
    if (hb.binding) ["switchId", "leverId", "instrumentId", "displayId", "regionId", "action"].forEach(function (k) { if (hb.binding[k]) addAlias(hb.binding[k], hb.id); });
  });
  function resolve(rawIds) {
    const out = [];
    (rawIds || []).forEach(function (raw) {
      const trimmed = String(raw || "").trim();
      if (!trimmed) return;
      if (ids.has(trimmed)) { if (out.indexOf(trimmed) === -1) out.push(trimmed); return; }
      (byAlias.get(canonicalHitboxKey(trimmed)) || []).forEach(function (id) { if (out.indexOf(id) === -1) out.push(id); });
    });
    return out;
  }
  return {
    resolve: resolve,
    resolveActionable: function (rawIds) {
      return resolve(rawIds).filter(function (id) {
        const d = byId.get(id);
        return Boolean(d) && (ACTIONABLE_TYPES.indexOf(d.type) > -1 || ACTIONABLE_KINDS.indexOf(d.kind) > -1);
      });
    }
  };
}

/* Assets are loaded in the Android order; the generic + variant + abnormal/emergency + qrh files. */
const ORDER = {
  LEGACY: ["procedure_cockpit_bindings", "procedure_cockpit_bindings_legacy", "procedure_cockpit_bindings_abnormal_emergency", "qrh_cockpit_bindings"],
  G950: ["procedure_cockpit_bindings", "procedure_cockpit_bindings_g950", "procedure_cockpit_bindings_abnormal_emergency", "qrh_cockpit_bindings"]
};

function parseFile(data) {
  const out = [];
  if (!data || typeof data !== "object") return out;
  if (data.procedure) {
    const proc = data.procedure;
    (proc.steps || []).forEach(function (step) {
      const rawText = String(step.rawText || "").trim();
      if (!rawText) return;
      const hitboxIds = [];
      (step.controls || []).forEach(function (c) {
        if (String(c.refType || "").toUpperCase() !== "HITBOX") return;
        const refId = String(c.refId || "").trim();
        if (refId && hitboxIds.indexOf(refId) === -1) hitboxIds.push(refId);
      });
      if (hitboxIds.length) out.push({ procedureId: String(proc.procedureId || "").trim(), procedureTitle: String(proc.title || "").trim(), rawText: rawText, hitboxIds: hitboxIds });
    });
    return out;
  }
  const bindings = data.bindings;
  if (!Array.isArray(bindings) || !bindings.length) return out;
  if (bindings[0] && bindings[0].stepBindings) {
    bindings.forEach(function (b) {
      const procedureId = String(b.procedureId || "").trim();
      const procedureTitle = String(b.title || "").trim() || procedureId;
      (b.stepBindings || []).forEach(function (sb) {
        const rawText = String(sb.rawText || "").trim() || String(sb.stepText || "").trim() || String(sb.stepId || "").trim();
        if (!rawText) return;
        const hitboxIds = [];
        (sb.hitboxIds || []).forEach(function (id) { const t = String(id || "").trim(); if (t && hitboxIds.indexOf(t) === -1) hitboxIds.push(t); });
        if (hitboxIds.length) out.push({ procedureId: procedureId, procedureTitle: procedureTitle, rawText: rawText, hitboxIds: hitboxIds });
      });
    });
    return out;
  }
  if (bindings[0] && bindings[0].targets) {
    bindings.forEach(function (b) {
      const procedureId = String(b.qrhId || "").trim() || String(b.procedureId || "").trim();
      if (!procedureId) return;
      const hitboxIds = [];
      (b.targets || []).forEach(function (t) {
        if (String(t.type || "").toUpperCase() !== "HITBOX") return;
        const id = String(t.id || "").trim();
        if (id && hitboxIds.indexOf(id) === -1) hitboxIds.push(id);
      });
      if (hitboxIds.length) out.push({ procedureId: procedureId, procedureTitle: procedureId, rawText: procedureId, hitboxIds: hitboxIds });
    });
  }
  return out;
}

export function createBindingsIndex(bindingsPack, variant, hitboxes) {
  const files = new Map(((bindingsPack && bindingsPack.files) || []).map(function (f) { return [f.file, f.data]; }));
  const order = ORDER[String(variant || "").toUpperCase() === "G950" ? "G950" : "LEGACY"];
  const all = [];
  const seen = new Set();
  order.forEach(function (name) {
    parseFile(files.get(name)).forEach(function (b) {
      const key = [normalize(b.procedureId), normalize(b.procedureTitle), normalize(b.rawText), b.hitboxIds.join("|")].join("::");
      if (seen.has(key)) return;
      seen.add(key); all.push(b);
    });
  });
  const byProcedureId = new Map(), byProcedureTitle = new Map(), stepOnly = new Map();
  all.forEach(function (b) {
    const pid = normalize(b.procedureId), ptitle = normalize(b.procedureTitle), stepKey = normalize(b.rawText);
    if (!byProcedureId.has(pid)) byProcedureId.set(pid, []);
    byProcedureId.get(pid).push(b);
    if (!byProcedureTitle.has(ptitle)) byProcedureTitle.set(ptitle, []);
    byProcedureTitle.get(ptitle).push(b);
    if (stepKey) {
      if (!stepOnly.has(stepKey)) stepOnly.set(stepKey, []);
      const list = stepOnly.get(stepKey);
      b.hitboxIds.forEach(function (id) { if (list.indexOf(id) === -1) list.push(id); });
    }
  });
  const hitboxIndex = createHitboxIndex(hitboxes);

  return {
    resolve: hitboxIndex.resolve,
    resolveActionable: hitboxIndex.resolveActionable,
    lookup: function (procedureKey, stepText) {
      const proc = String(procedureKey || "").trim(), step = String(stepText || "").trim();
      if (!proc || !step || !all.length) return [];
      const procNorm = normalize(proc), stepNorm = normalize(step);
      let candidates = (byProcedureId.get(procNorm) || []).concat(byProcedureTitle.get(procNorm) || []);
      if (!candidates.length) {
        candidates = all.filter(function (b) {
          const idNorm = normalize(b.procedureId), titleNorm = normalize(b.procedureTitle);
          return procNorm === idNorm || procNorm === titleNorm || procNorm.indexOf(idNorm) > -1 || procNorm.indexOf(titleNorm) > -1 ||
            idNorm.indexOf(procNorm) > -1 || titleNorm.indexOf(procNorm) > -1;
        });
      }
      candidates = candidates.filter(function (b, i, arr) { return arr.indexOf(b) === i; });
      if (!candidates.length) return hitboxIndex.resolve(stepOnly.get(stepNorm) || []);
      const exact = candidates.find(function (b) { return normalize(b.rawText) === stepNorm; });
      if (exact) return hitboxIndex.resolve(exact.hitboxIds);
      let best = null, bestScore = 0;
      candidates.forEach(function (b) { const s = scoreOverlap(stepNorm, normalize(b.rawText)); if (s > bestScore) { bestScore = s; best = b; } });
      if (best && bestScore >= 3) return hitboxIndex.resolve(best.hitboxIds);
      return hitboxIndex.resolve(stepOnly.get(stepNorm) || []);
    }
  };
}
