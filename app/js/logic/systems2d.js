/*
  Knowledge → Systems (2D): ports of AircraftSystemsHomeScreen.kt,
  SystemDetailScreen.kt, BundledSystemReferenceCard.kt and
  Interactive2dDiagramViewer.kt.

  All authored text — tile hints, overviews, study notes, AFM/FCTM component and
  limit tables, diagram pins — arrives in the protected `systems-2d` pack built
  by tools/lib/systems-2d.mjs. Nothing here contains training or aviation data.

  Reference imagery — the system posters and the Systems Lab figures — is served
  from R2 through /api/media/<path> behind the subscriber/owner session, never
  from the public repository.
*/

/* ------------------------------------------------------------ navigation */

export function systemsInOrder(pack) {
  if (!pack || !pack.order) return [];
  return pack.order.map(function (key) { return pack.systems[key]; }).filter(Boolean);
}

export function systemByKey(pack, key) {
  if (!pack || !pack.systems) return null;
  return pack.systems[String(key || "").toUpperCase()] || null;
}

/* Tiles must say what they actually are, so status is computed from what
   resolved rather than from what Android declared. */
export function systemStatus(pack, system) {
  if (!system) return "later";
  const hasDescription = Boolean(descriptionFor(pack, system));
  const hasImage = resolvedReferences(system).length > 0;
  if (hasDescription && hasImage) return "available";
  if (hasDescription || hasImage) return "partial";
  return "later";
}

export function systemSummaryLine(pack, system) {
  const parts = [];
  const description = descriptionFor(pack, system);
  if (description) {
    const counts = descriptionCounts(description);
    if (counts.total) parts.push(counts.total + " bundled");
  }
  const images = resolvedReferences(system).length;
  if (images) parts.push(images + (images === 1 ? " diagram" : " diagrams"));
  const pins = (system.pins || []).length;
  if (pins) parts.push(pins + " pins");
  if (!parts.length) parts.push("Overview only");
  return parts.join("  •  ");
}

export function searchSystems(pack, query) {
  const q = String(query || "").trim().toLowerCase();
  const all = systemsInOrder(pack);
  if (!q) return all;
  return all.filter(function (s) {
    return (s.title + " " + s.hint + " " + s.overview + " " + s.key.replace(/_/g, " ")).toLowerCase().indexOf(q) !== -1;
  });
}

/*
  AircraftSystemsHomeScreen.tileImageResId(). `procedure_tile_takeoff` was a
  watermarked stock comp and was removed from this repository in the Aircraft
  State phase; the licensed replacement stands in for it here too.
*/
const TILE_ART_SUBSTITUTES = { procedure_tile_takeoff: "procedure_tile_takeoff_custom" };
const TILE_ART_FALLBACK = "dhc6_tile_runway_overview";

export function tileArtFor(system) {
  const name = (system && system.tileArt) || TILE_ART_FALLBACK;
  return TILE_ART_SUBSTITUTES[name] || name;
}

/* ------------------------------------------------------- reference images */

export function resolvedReferences(system) {
  return ((system && system.references) || []).filter(function (r) { return r.mediaPath; });
}

export function unresolvedReferences(system) {
  return ((system && system.references) || []).filter(function (r) { return !r.mediaPath; });
}

export function mediaHref(mediaPath) {
  return "/api/media/" + String(mediaPath || "").split("/").map(encodeURIComponent).join("/");
}

/*
  SystemDetailScreen.systemReferenceNote() else-branch: the source type is
  chosen from the reference's label and path, in the order the Kotlin `when`
  lists its conditions.
*/
export function classifySource(pack, reference) {
  const types = (pack && pack.sourceTypes) || [];
  const label = String((reference && reference.label) || "").toLowerCase();
  const path = String((reference && (reference.androidPath || reference.mediaPath)) || "").toLowerCase();
  for (let i = 0; i < types.length; i += 1) {
    const t = types[i];
    if (t.isElse) return t.value;
    if (t.label && label.indexOf(t.label) !== -1) return t.value;
    if ((t.paths || []).some(function (p) { return path.indexOf(p) !== -1; })) return t.value;
  }
  return "bundled reference image";
}

/* The authored per-system note, or the generic one with $sourceType filled in. */
export function referenceNote(pack, system, reference) {
  if (system && system.note) return system.note;
  const fallback = (pack && pack.noteFallback) || null;
  if (!fallback) return null;
  const sourceType = classifySource(pack, reference);
  return Object.assign({}, fallback, {
    description: String(fallback.description || "").replace(/\$sourceType/g, sourceType)
  });
}

/* ------------------------------------------------- bundled AFM/FCTM packs */

export function descriptionFor(pack, system) {
  if (!pack || !system || !system.descriptionId) return null;
  return (pack.descriptions || {})[system.descriptionId] || null;
}

export function descriptionCounts(description) {
  const d = description || {};
  const counts = {
    components: (d.components || []).length,
    controls: (d.controls || []).length,
    limits: (d.limits || []).length,
    modificationVariants: (d.modificationVariants || []).length,
    casMessageRefs: (d.casMessageRefs || []).length,
    references: (d.references || []).length
  };
  counts.total = counts.components + counts.controls + counts.limits +
    counts.modificationVariants + counts.casMessageRefs + counts.references;
  return counts;
}

/* BundledSystemReferenceCard: the "12 components • 4 controls • …" line. */
export function countChips(description) {
  const c = descriptionCounts(description);
  const out = [];
  if (c.components) out.push(c.components + " components");
  if (c.controls) out.push(c.controls + " controls");
  if (c.limits) out.push(c.limits + " limits");
  if (c.modificationVariants) out.push(c.modificationVariants + " mod variants");
  if (c.casMessageRefs) out.push(c.casMessageRefs + " CAS refs");
  return out;
}

/* BundledSystemReferenceCard.displaySourceName */
export function displaySourceName(rawSource) {
  switch (String(rawSource || "")) {
    case "POH_AFM": return "POH/AFM";
    case "FCTM": return "FCTM";
    case "QRH": return "QRH";
    case "OPERATOR_OM": return "Ops Manual";
    case "MANUFACTURER_BULLETIN": return "Mfr Bulletin";
    default: return String(rawSource || "");
  }
}

/* BundledSystemReferenceCard.formatReferenceLine */
export function formatReferenceLine(ref) {
  const revision = ref && ref.revision && String(ref.revision).trim() ? " (" + ref.revision + ")" : "";
  return displaySourceName(ref && ref.source) + " — " + ((ref && ref.locator) || "") + revision;
}

/*
  Two authored shapes are in the bundle and both are read as written.

  `electrical.json` follows assets/schema/system_description.schema.json —
  controls carry `label` + `location` with object positions, limits carry `name`
  + `condition` + `rationale` + `regulatoryStatus`. The other nineteen packs use
  `name` for a control with plain-string positions, and `parameter` + `note` for
  a limit. Android's SystemDescription data class only models the first shape, so
  those packs fail to parse there and the card disappears; nothing is renamed or
  filled in here, the alternate key is simply read.
*/
export function controlLabel(control) {
  const c = control || {};
  return String(c.label || c.name || "").trim();
}

export function controlPositions(control) {
  return ((control && control.positions) || []).map(function (position) {
    if (position && typeof position === "object") {
      return { label: String(position.label || ""), behaviour: String(position.behaviour || "") };
    }
    return { label: String(position || ""), behaviour: "" };
  }).filter(function (p) { return p.label; });
}

export function limitName(limit) {
  const l = limit || {};
  return String(l.name || l.parameter || "").trim();
}

export function limitQualifier(limit) {
  const l = limit || {};
  const value = l.condition || l.note || "";
  return String(value).trim();
}

export function formatLimitLine(limit) {
  const qualifier = limitQualifier(limit);
  return limitName(limit) + ": " + (limit && limit.value != null ? limit.value : "") + (qualifier ? " — " + qualifier : "");
}

/*
  The schema defines regulatoryStatus so the UI can separate an AFM-approved
  number from operator guidance. It is shown where the pack states it and left
  off entirely where it does not — an unstated status is never assumed to be
  AFM-approved.
*/
const REGULATORY_LABELS = {
  AFM_APPROVED: "AFM approved",
  OPERATOR_GUIDANCE: "Operator guidance",
  MANUFACTURER_RECOMMENDED: "Manufacturer recommended"
};

export function regulatoryLabel(limit) {
  const raw = limit && limit.regulatoryStatus ? String(limit.regulatoryStatus) : "";
  if (!raw) return null;
  return REGULATORY_LABELS[raw] || raw;
}

/* ------------------------------------------------------------ diagram 2D */

/*
  Interactive2dDiagramViewer draws the pins over the FIRST bundled reference.
  A pin set with no image behind it is listed as study cards instead of being
  painted onto an empty rectangle.
*/
export function diagramFor(system) {
  const pins = (system && system.pins) || [];
  const image = resolvedReferences(system)[0] || null;
  return {
    image: image,
    pins: pins,
    // Android renders the viewer only when a reference image exists at all.
    mode: pins.length && image ? "interactive" : pins.length ? "list" : image ? "static" : "none"
  };
}

/* fittedImageRect(): the contain-fit rect of the image inside its box, so a pin
   at (0.82, 0.56) lands on the same part of the drawing at any viewport size. */
export function fittedImageRect(imageWidth, imageHeight, boxWidth, boxHeight) {
  const iw = Number(imageWidth) || 0;
  const ih = Number(imageHeight) || 0;
  const bw = Number(boxWidth) || 0;
  const bh = Number(boxHeight) || 0;
  if (iw <= 0 || ih <= 0 || bw <= 0 || bh <= 0) return { left: 0, top: 0, width: bw, height: bh };
  const scale = Math.min(bw / iw, bh / ih);
  const width = iw * scale;
  const height = ih * scale;
  return { left: (bw - width) / 2, top: (bh - height) / 2, width: width, height: height };
}

export function pinPosition(pin, rect) {
  return {
    left: rect.left + rect.width * clamp01(pin.x),
    top: rect.top + rect.height * clamp01(pin.y)
  };
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export function nextPin(pins, currentId, step) {
  if (!pins.length) return null;
  const index = pins.findIndex(function (p) { return p.id === currentId; });
  const base = index === -1 ? 0 : index;
  const next = (base + step + pins.length) % pins.length;
  return pins[next];
}

/* ------------------------------------------------------------ deep links */

export function systemHref(key) { return "#/systems/detail/" + encodeURIComponent(String(key).toLowerCase()); }

export function quizHref(system, variant) {
  return "#/quizzes/run/" + encodeURIComponent(variant || "BOTH") + "/10?sys=" + encodeURIComponent(system.key);
}

/*
  Android sends the system name into `qrh/category/<NAME>`, but the QRH only has
  NORMAL / ABNORMAL / EMERGENCY categories, so that route lands on an empty list.
  The browser opens the QRH hub — the blank-target branch of the same callback.
*/
export function qrhHref() { return "#/qrh"; }
