/*
  Manual QRH editing — port of feature-procedures
    ui/screens/QrhManualEditStore.kt        (draft model, save-time cleaning, role tags)
    ui/screens/QrhEditorTextParser.kt       (free text -> structured item)
    ui/screens/QrhEditorCockpitCatalog.kt   (lookup + written-step / expected-id builders)
    ui/model/QrhManualStepParser.kt         (fromLine, normalized drafts, inferExpectedControlIds)

  The control palette itself is NOT retyped here: it is extracted from
  QrhEditorCockpitCatalog.kt by tools/build-content.mjs into the `qrh-editor`
  content pack, and passed into these functions as `catalog`.
*/

export const ITEM_KINDS = ["GENERIC", "CHECKLIST_CUE", "ITEM_POSITION", "MEMORY_ACTION", "SPOKEN_LINE", "PM_ACK"];

export const ITEM_KIND_LABEL = {
  GENERIC: "Free text",
  CHECKLIST_CUE: "Checklist cue",
  ITEM_POSITION: "Item / position",
  MEMORY_ACTION: "Memory action",
  SPOKEN_LINE: "Spoken line",
  PM_ACK: "PM acknowledgement"
};

export const ROLE_TAGS = ["PF", "PF CMD", "PM", "PM ACK", "PM CALL"];

function str(v) { return v == null ? "" : String(v); }
function alnum(v) { return str(v).toUpperCase().replace(/[^A-Z0-9]/g, ""); }

/* ------------------------------------------------------------- role tags */
/* QrhManualEditStore.toCompactQrhRoleTag */
export function compactRoleTag(raw) {
  const tag = str(raw).trim().toUpperCase();
  if (!tag) return "PF";
  if (tag.indexOf("PM") > -1 && tag.indexOf("CALL") > -1) return "PM CALL";
  if (tag.indexOf("PM") > -1 && tag.indexOf("ACK") > -1) return "PM ACK";
  if (tag.indexOf("PM") > -1) return "PM";
  if (tag.indexOf("PF") > -1 && (tag.indexOf("CMD") > -1 || tag.indexOf("COMMAND") > -1)) return "PF CMD";
  if (tag.indexOf("PF") > -1) return "PF";
  return tag;
}

/* QrhManualStepParser.defaultFlowRole */
export function defaultFlowRole(index) {
  const n = index % 3;
  return n === 0 ? "PM ACK" : n === 1 ? "PF CMD" : "PM CALL";
}

export function removePrefixNumber(value) { return str(value).replace(/^\s*\d+[.)]\s*/, "").trim(); }

/* QrhManualEditScreen.cleanManualStepText */
export function cleanManualStepText(value) {
  return str(value)
    .replace(/^\s*(PF|PM)\s*[-–—:]\s*/i, "")
    .replace(/^\s*(PF|PM)\s+/i, "")
    .replace(/\s*[•|-]\s*POH\s*\/\s*AFM\b.*$/i, "")
    .replace(/\s*[•|-]\s*DHC-6\b.*(?:MCC|PF\/PM|CALLOUT|Section).*$/i, "")
    .replace(/\s*POH\s*\/\s*AFM\b.*$/i, "")
    .replace(/\s*DHC-6\b.*(?:MCC|PF\/PM|CALLOUT|Section).*$/i, "")
    .trim()
    .replace(/[•\-–—:]+$/, "")
    .trim();
}

/* ----------------------------------------------------------- step drafts */
export function emptyStep(overrides) {
  return Object.assign({
    writtenStep: "", spokenWording: "", mccCrmNote: "", expectedControlIds: "",
    requiresConfirmation: true, roleTag: "PF", itemKind: "GENERIC", targetControlId: "", targetPosition: ""
  }, overrides || {});
}

/* QrhManualEditStepDraft.Companion.fromLine */
export function stepFromLine(line, roleTag) {
  const cleaned = removePrefixNumber(line);
  return emptyStep({
    writtenStep: cleaned,
    spokenWording: cleaned ? cleaned.charAt(0).toLowerCase() + cleaned.slice(1) : "",
    roleTag: roleTag || "PF"
  });
}

export function expectedControlIdList(step) {
  const out = [];
  str(step.expectedControlIds).split(",").forEach(function (part) {
    const t = part.trim();
    if (t && out.indexOf(t) === -1) out.push(t);
  });
  return out;
}

/* QrhManualEditStore.cleaned() — applied when the draft is saved. */
export function cleanStep(step) {
  return Object.assign({}, step, {
    writtenStep: str(step.writtenStep).trim(),
    spokenWording: str(step.spokenWording).trim(),
    mccCrmNote: str(step.mccCrmNote).trim(),
    expectedControlIds: expectedControlIdList(step).join(", "),
    roleTag: compactRoleTag(step.roleTag),
    targetControlId: str(step.targetControlId).trim().toUpperCase(),
    targetPosition: str(step.targetPosition).trim(),
    itemKind: ITEM_KINDS.indexOf(step.itemKind) > -1 ? step.itemKind : "GENERIC",
    requiresConfirmation: step.requiresConfirmation !== false
  });
}

/* QrhManualStepParser.cleanManualStep() — applied when a draft is read back. */
export function normalizeStep(step) {
  return Object.assign({}, emptyStep(), step, {
    writtenStep: removePrefixNumber(step.writtenStep),
    spokenWording: str(step.spokenWording).trim(),
    mccCrmNote: str(step.mccCrmNote).trim(),
    expectedControlIds: expectedControlIdList(step).join(", "),
    roleTag: str(step.roleTag).toUpperCase() || "PF"
  });
}

function usable(step) { return Boolean(str(step.writtenStep).trim() || str(step.spokenWording).trim()); }

export function normalizedMemorySteps(draft) {
  const source = (draft.memoryStepDrafts && draft.memoryStepDrafts.length)
    ? draft.memoryStepDrafts
    : (draft.memoryItems || []).map(function (line) { return stepFromLine(line, "PF"); });
  return source.map(normalizeStep).filter(usable);
}

export function normalizedFlowSteps(draft) {
  const source = (draft.flowStepDrafts && draft.flowStepDrafts.length)
    ? draft.flowStepDrafts
    : (draft.flowItems || []).map(function (line, index) { return stepFromLine(line, defaultFlowRole(index)); });
  return source.map(normalizeStep).filter(usable);
}

/* --------------------------------------------------------------- catalog */
function candidateKeys(entry) {
  return [entry.controlId, entry.displayName].concat(entry.aliases || []).map(alnum).filter(Boolean);
}

export function controlById(catalog, controlId) {
  const needle = str(controlId).trim().toUpperCase();
  if (!needle) return null;
  return (catalog.controls || []).find(function (entry) {
    return entry.controlId.toUpperCase() === needle || (entry.aliases || []).some(function (a) { return a.toUpperCase() === needle; });
  }) || null;
}

/* QrhEditorCockpitCatalog.findByNameOrAlias */
export function findByNameOrAlias(catalog, text) {
  const needle = alnum(text);
  if (!needle) return null;
  const controls = catalog.controls || [];
  for (let i = 0; i < controls.length; i += 1) {
    if (candidateKeys(controls[i]).indexOf(needle) > -1) return controls[i];
  }
  const contains = controls.filter(function (entry) {
    return candidateKeys(entry).some(function (k) { return k && (k.indexOf(needle) > -1 || needle.indexOf(k) > -1); });
  });
  if (contains.length === 1) return contains[0];
  if (contains.length > 1) {
    const hasSide = needle.indexOf("L") > -1 || needle.indexOf("R") > -1;
    return contains.find(function (entry) {
      return hasSide || (!/_L$/.test(entry.controlId) && !/_R$/.test(entry.controlId));
    }) || contains[0];
  }
  return null;
}

const POSITION_ALIASES = {
  FULL: ["FULLFWD", "FULLFORWARD", "FORWARD", "MAX"],
  MAX: ["MAXIMUM", "FULLFWD", "FULLFORWARD", "TAKEOFFPOWER"],
  MIN: ["MINIMUM", "REDUCE"],
  FEATHER: ["FEATHERED"],
  REVERSE: ["REVERSED", "BETA"],
  ASREQUIRED: ["ASREQ", "REQ"]
};

export function positionMatches(canonical, typed) {
  const a = alnum(canonical);
  const b = alnum(typed);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.indexOf(b) > -1 || b.indexOf(a) > -1) return true;
  if ((POSITION_ALIASES[a] || []).indexOf(b) > -1) return true;
  if ((POSITION_ALIASES[b] || []).indexOf(a) > -1) return true;
  return false;
}

/* QrhEditorTextParser.parse — null when the text carries no structured signal. */
export function parseStepText(catalog, rawText) {
  const text = str(rawText).trim();
  if (!text) return null;
  const normalized = text.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (normalized && normalized.indexOf("COMPLETE") === -1 && normalized !== "CHECKED" &&
    (normalized === "CHECKLIST" || / CHECKLIST$/.test(normalized) || / CHECKS$/.test(normalized) || / CHECK$/.test(normalized))) {
    return { kind: "CHECKLIST_CUE", controlId: "", position: "" };
  }
  if (["CHECKED", "CONFIRMED", "SET", "COMPLETE"].indexOf(normalized) > -1) {
    return { kind: "PM_ACK", controlId: "", position: "" };
  }
  const match = text.match(/^([^—–\-:]+)[—–\-:](.+)$/);
  if (match) {
    const controlText = match[1].trim();
    const positionText = match[2].trim();
    if (controlText && positionText) {
      const entry = findByNameOrAlias(catalog, controlText);
      if (entry) {
        const matched = (entry.positions || []).find(function (canonical) { return positionMatches(canonical, positionText); }) || positionText;
        return { kind: "ITEM_POSITION", controlId: entry.controlId, position: matched };
      }
    }
  }
  return null;
}

/* QrhEditorCockpitCatalog.buildWrittenStep */
export function buildWrittenStep(catalog, kind, targetControlId, targetPosition, freeText) {
  if (kind !== "ITEM_POSITION") return str(freeText).trim();
  const entry = controlById(catalog, targetControlId);
  const name = entry ? entry.displayName : str(targetControlId).trim();
  const pos = str(targetPosition).trim();
  if (!name && !pos) return str(freeText).trim();
  if (!name) return pos;
  if (!pos) return name;
  return name + " — " + pos;
}

/* QrhEditorCockpitCatalog.buildExpectedControlIds */
export function buildExpectedControlIds(kind, targetControlId) {
  if (kind !== "ITEM_POSITION") return [];
  const id = str(targetControlId).trim();
  return id ? [id.toUpperCase()] : [];
}

/* QrhManualStepParser.inferExpectedControlIds — catalog first, then legacy keywords. */
export function inferExpectedControlIds(catalog, action) {
  const parsed = parseStepText(catalog, action);
  if (parsed && parsed.kind === "ITEM_POSITION" && parsed.controlId) return [parsed.controlId.toUpperCase()];
  const upper = str(action).toUpperCase();
  const out = [];
  function add(id) { if (out.indexOf(id) === -1) out.push(id); }
  if (upper.indexOf("CHECKLIST") > -1) add("CHECKLIST");
  if (upper.indexOf("MASTER CAUTION") > -1) { add("MASTER_CAUTION_LEFT"); add("MASTER_CAUTION_RIGHT"); }
  if (upper.indexOf("MASTER WARNING") > -1) { add("MASTER_WARNING_LEFT"); add("MASTER_WARNING_RIGHT"); }
  if (upper.indexOf("BOOST") > -1 && upper.indexOf("PUMP") > -1) { add("AFT_BOOST_PUMP_1"); add("AFT_BOOST_PUMP_2"); }
  if (upper.indexOf("FUEL") > -1 && (upper.indexOf("LEVER") > -1 || upper.indexOf("SOV") > -1)) { add("FUEL_SOV_L"); add("FUEL_SOV_R"); }
  return out;
}

/* ------------------------------------------------------------ the draft */
/* Seed an editable draft from the published QRH detail. */
export function draftFromDetail(detail) {
  const memoryItems = (detail.memoryItems || []).map(removePrefixNumber).filter(Boolean);
  const flowItems = (detail.steps || []).map(removePrefixNumber).filter(Boolean);
  return {
    title: str(detail.title),
    trigger: str(detail.trigger),
    memoryItems: memoryItems,
    flowItems: flowItems,
    notes: (detail.notes || []).map(str).filter(Boolean),
    memoryStepDrafts: memoryItems.map(function (line) { return stepFromLine(line, "PF"); }),
    flowStepDrafts: flowItems.map(function (line, index) { return stepFromLine(line, defaultFlowRole(index)); })
  };
}

/* QrhManualEditStore.save() — the exact save-time cleaning. */
export function cleanDraft(draft) {
  const memory = (draft.memoryStepDrafts || []).map(cleanStep).filter(usable);
  const flow = (draft.flowStepDrafts || []).map(cleanStep).filter(usable);
  function lines(steps, fallback) {
    const out = steps.map(function (s) { return (s.writtenStep || s.spokenWording).trim(); }).filter(Boolean);
    return out.length ? out : (fallback || []).map(function (l) { return str(l).trim(); }).filter(Boolean);
  }
  return {
    title: str(draft.title).trim(),
    trigger: str(draft.trigger).trim(),
    memoryItems: lines(memory, draft.memoryItems),
    flowItems: lines(flow, draft.flowItems),
    notes: (draft.notes || []).map(function (n) { return str(n).trim(); }).filter(Boolean),
    memoryStepDrafts: memory,
    flowStepDrafts: flow
  };
}

/* QrhRouteHost: a saved edit replaces the displayed detail. */
export function applyDraftToDetail(detail, draft) {
  if (!draft) return detail;
  const memory = normalizedMemorySteps(draft);
  const flow = normalizedFlowSteps(draft);
  return Object.assign({}, detail, {
    title: str(draft.title).trim() || detail.title,
    trigger: str(draft.trigger).trim() || detail.trigger || "",
    memoryItems: memory.map(function (s) { return s.writtenStep || s.spokenWording; }),
    steps: flow.map(function (s, index) { return (index + 1) + ". " + (s.writtenStep || s.spokenWording); }),
    notes: draft.notes || detail.notes || [],
    edited: true
  });
}

/* -------------------------------------------------------- validation */
/*
  Authoring warnings only. They never block a save: an instructor may deliberately
  write a line the drill runner cannot match. Safety-critical values are the
  author's own — nothing here invents or "corrects" aviation data.
*/
export function validateDraft(catalog, draft) {
  const warnings = [];
  if (!str(draft.title).trim()) warnings.push({ level: "error", text: "The procedure needs a title." });
  const memory = (draft.memoryStepDrafts || []).filter(usable);
  const flow = (draft.flowStepDrafts || []).filter(usable);
  if (!memory.length && !flow.length) warnings.push({ level: "error", text: "Add at least one memory item or checklist step." });

  [["Memory item", memory], ["Checklist step", flow]].forEach(function (pair) {
    pair[1].forEach(function (step, index) {
      const where = pair[0] + " " + (index + 1);
      if (step.itemKind === "ITEM_POSITION") {
        if (!str(step.targetControlId).trim()) warnings.push({ level: "warn", text: where + ": item/position step has no cockpit control selected, so the drill runner cannot check it." });
        else if (!controlById(catalog, step.targetControlId)) warnings.push({ level: "warn", text: where + ": \"" + step.targetControlId + "\" is not in the cockpit catalogue." });
        if (!str(step.targetPosition).trim()) warnings.push({ level: "warn", text: where + ": no position selected." });
      }
      if (!str(step.writtenStep).trim() && str(step.spokenWording).trim()) {
        warnings.push({ level: "warn", text: where + ": only spoken wording is set — the written step will fall back to it." });
      }
      expectedControlIdList(step).forEach(function (id) {
        if (!controlById(catalog, id)) warnings.push({ level: "warn", text: where + ": expected control \"" + id + "\" is not in the cockpit catalogue." });
      });
    });
  });
  return warnings;
}

/* A step edited in the UI: re-derive the written step / expected ids like the Android editor. */
export function applyStructure(catalog, step, changes) {
  const next = Object.assign({}, step, changes || {});
  if (next.itemKind === "ITEM_POSITION") {
    next.writtenStep = buildWrittenStep(catalog, next.itemKind, next.targetControlId, next.targetPosition, next.writtenStep);
    const ids = buildExpectedControlIds(next.itemKind, next.targetControlId);
    if (ids.length) next.expectedControlIds = ids.join(", ");
  }
  return next;
}

/* Free-text typing: auto-detect the kind, but never override a manual pick. */
export function autoStructure(catalog, step, typedText) {
  const cleaned = cleanManualStepText(typedText);
  const next = Object.assign({}, step, { writtenStep: cleaned });
  const parsed = parseStepText(catalog, cleaned);
  if (!parsed) return next;
  if (next.itemKind === "GENERIC") next.itemKind = parsed.kind;
  if (parsed.controlId && !str(next.targetControlId).trim()) next.targetControlId = parsed.controlId;
  if (parsed.position && !str(next.targetPosition).trim()) next.targetPosition = parsed.position;
  if (!str(next.expectedControlIds).trim()) {
    const ids = inferExpectedControlIds(catalog, cleaned);
    if (ids.length) next.expectedControlIds = ids.join(", ");
  }
  return next;
}
