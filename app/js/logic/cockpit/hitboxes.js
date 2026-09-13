/*
  Hitbox model + loader — port of feature-cockpit domain/hitbox/{HitboxModels,
  CockpitHitboxIO (parseHitboxesFlexible / parseHitboxArrayFlexible), HitboxAssetLoader
  (normalizeForVariantParity)} and CanonicalCockpitContract (variants / plate sizes).
*/

export const REFERENCE_SIZES = {
  LEGACY: { width: 3748, height: 5276, asset: "cockpit/images/legacy_cockpit_base_clean.png" },
  G950: { width: 3744, height: 5276, asset: "cockpit/images/g950_cockpit_base_clean.webp" }
};

/* canonicalCockpitDisplayVariant: BOTH renders the LEGACY plate. */
export function displayVariant(variant) {
  return String(variant || "").toUpperCase() === "G950" ? "G950" : "LEGACY";
}

/* ScenarioSnapshotRegistry.cockpitVariantKey: BOTH picks the G950 baseline. */
export function snapshotVariantKey(variant) {
  return String(variant || "").toUpperCase() === "LEGACY" ? "LEGACY" : "G950";
}

function num(v, fallback) {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}
function clamp01(v) { return Math.min(1, Math.max(0, v)); }
function str(v) { return v == null ? "" : String(v).trim(); }

export function clampNormRect(r) {
  const x = clamp01(num(r.x, 0)), y = clamp01(num(r.y, 0));
  let w = clamp01(num(r.w, 0)), h = clamp01(num(r.h, 0));
  w = Math.min(w, 1 - x); h = Math.min(h, 1 - y);
  return { x: x, y: y, w: w, h: h };
}

function parseAxis(raw) {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const o = raw.trim().toLowerCase();
    return o === "vertical" || o === "horizontal" ? { orientation: o, min: 0, max: 1 } : null;
  }
  if (typeof raw === "object") {
    const o = str(raw.orientation).toLowerCase();
    if (o !== "vertical" && o !== "horizontal") return null;
    let min = clamp01(num(raw.min, 0)), max = clamp01(num(raw.max, 1));
    if (min > max) { const t = min; min = max; max = t; }
    return { orientation: o, min: min, max: max };
  }
  return null;
}

function parseBinding(raw) {
  if (!raw || typeof raw !== "object") return null;
  const b = { kind: str(raw.kind) || "" };
  ["leverId", "action", "displayId", "regionId", "instrumentId", "switchId", "switchMode", "switchAxis"].forEach(function (k) {
    const v = str(raw[k]); b[k] = v || null;
  });
  const mom = num(raw.momentaryReturnMs, 0);
  b.momentaryReturnMs = mom > 0 ? mom : null;
  b.switchPositions = Array.isArray(raw.switchPositions) ? raw.switchPositions.map(function (p) { return str(p).toUpperCase(); }).filter(Boolean) : null;
  if (b.switchPositions && !b.switchPositions.length) b.switchPositions = null;
  b.leverDetents = Array.isArray(raw.leverDetents) ? raw.leverDetents.map(function (d) { return num(d, NaN); }).filter(Number.isFinite) : null;
  b.leverClampMin = Number.isFinite(num(raw.leverClampMin, NaN)) ? num(raw.leverClampMin, 0) : null;
  b.leverClampMax = Number.isFinite(num(raw.leverClampMax, NaN)) ? num(raw.leverClampMax, 0) : null;
  b.detentSnapThreshold = Number.isFinite(num(raw.detentSnapThreshold, NaN)) ? num(raw.detentSnapThreshold, 0) : null;
  b.leverGateBands = Array.isArray(raw.leverGateBands) ? raw.leverGateBands.map(function (g) {
    return { min: num(g && g.min, 0), max: num(g && g.max, 1), requiresLongPressMs: num(g && g.requiresLongPressMs, 250) };
  }) : null;
  return b;
}

function parseSprite(raw) {
  if (!raw || typeof raw !== "object") return null;
  const ax = num(raw.anchorX, NaN), ay = num(raw.anchorY, NaN);
  return {
    anchorX: Number.isFinite(ax) ? clamp01(ax) : null,
    anchorY: Number.isFinite(ay) ? clamp01(ay) : null,
    offsetXPx: num(raw.offsetXPx, 0),
    offsetYPx: num(raw.offsetYPx, 0),
    scaleMul: Math.min(8, Math.max(0.05, num(raw.scaleMul, 1)))
  };
}

export function parseHitboxArray(array) {
  const out = [];
  (array || []).forEach(function (raw) {
    if (!raw || typeof raw !== "object") return;
    const id = str(raw.id) || str(raw.hitboxId);
    if (!id) return;
    const rectRaw = raw.rect || raw.replace || {};
    out.push({
      id: id,
      type: str(raw.type) || "action",
      rect: clampNormRect(rectRaw),
      axis: parseAxis(raw.axis),
      binding: parseBinding(raw.binding),
      sprite: parseSprite(raw.sprite)
    });
  });
  return out;
}

/* parseHitboxesFlexible: root array, root.hitboxes, root.data.hitboxes, root.items, root.overrides. */
export function parseHitboxes(root) {
  if (Array.isArray(root)) return parseHitboxArray(root);
  if (!root || typeof root !== "object") return [];
  if (Array.isArray(root.hitboxes)) return parseHitboxArray(root.hitboxes);
  if (root.data && Array.isArray(root.data.hitboxes)) return parseHitboxArray(root.data.hitboxes);
  if (Array.isArray(root.items)) return parseHitboxArray(root.items);
  if (Array.isArray(root.overrides)) return parseHitboxArray(root.overrides.map(function (o) { return { hitboxId: o.hitboxId, replace: o.replace, type: "action" }; }));
  return [];
}

const G950_PARITY = {
  LANDING_LIGHTS_L: "LANDING_LIGHT_L", LANDING_LIGHTS_R: "LANDING_LIGHT_R",
  BOOST_PUMPS_AFT: "AFT_BOOST_PUMP", BOOST_PUMPS_FWD: "FWD_BOOST_PUMP",
  STBY_BOOST_PUMPS_AFT: "STBY_BOOST_PUMP_AFT", STBY_BOOST_PUMPS_FWD: "STBY_BOOST_PUMP_FWD",
  STBY_BATT: "STBY_BATTERY", PITOT_HEAT: "PITOT_HEAT_SWITCH"
};

/* HitboxAssetLoader.normalizeForVariantParity — G950 only; duplicates keep the non-alias entry. */
export function normalizeForVariantParity(hitboxes, variant) {
  if (displayVariant(variant) !== "G950") return hitboxes.slice();
  const existing = new Set(hitboxes.map(function (h) { return h.id; }));
  const out = [];
  hitboxes.forEach(function (hb) {
    const target = G950_PARITY[hb.id];
    if (!target) { out.push(hb); return; }
    if (existing.has(target)) return; // keep the non-alias entry
    const b = hb.binding ? Object.assign({}, hb.binding) : null;
    if (b) {
      if (!b.switchId || b.switchId === hb.id || b.switchId === target) b.switchId = b.switchId ? target : null;
      if (!b.leverId || b.leverId === hb.id || b.leverId === target) b.leverId = b.leverId ? target : null;
    }
    out.push(Object.assign({}, hb, { id: target, binding: b }));
  });
  return out;
}

export function hitboxById(hitboxes, id) {
  for (let i = 0; i < hitboxes.length; i += 1) if (hitboxes[i].id === id) return hitboxes[i];
  return null;
}

export function rectPx(hb, imageW, imageH) {
  return { left: hb.rect.x * imageW, top: hb.rect.y * imageH, width: hb.rect.w * imageW, height: hb.rect.h * imageH };
}

/* CanonicalCockpitGeometry.canonicalCockpitFitFrame — contain fit, centred. */
export function fitFrame(containerW, containerH, imageW, imageH) {
  if (!(containerW > 0) || !(containerH > 0) || !(imageW > 0) || !(imageH > 0)) {
    return { width: Math.max(0, containerW || 0), height: Math.max(0, containerH || 0), left: 0, top: 0, scale: 1 };
  }
  const scale = Math.min(containerW / imageW, containerH / imageH);
  const w = imageW * scale, h = imageH * scale;
  return { width: w, height: h, left: (containerW - w) * 0.5, top: (containerH - h) * 0.5, scale: scale };
}

/* canonicalCockpitTransform: finalScale = fit.scale * userScale, offset = fit + userOffset. */
export function cockpitTransform(containerW, containerH, imageW, imageH, userScale, userOffset) {
  const fit = fitFrame(containerW, containerH, imageW, imageH);
  const scale = Math.max(0.0001, fit.scale * (userScale || 1));
  return { scale: scale, offsetX: fit.left + (userOffset ? userOffset.x : 0), offsetY: fit.top + (userOffset ? userOffset.y : 0), fit: fit };
}
