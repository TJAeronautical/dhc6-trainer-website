/*
  Canonical cockpit renderer — browser port of feature-cockpit
  ui/{CanonicalCockpitCanvasSurface, CockpitPlateView} and
  ui/layers/{CockpitControlsOverlayLayer, ScenarioStepHighlightOverlayLayer} plus the
  visual-contract overlay in ui/screens/ScenarioPhaseSnapshotRenderer.kt.

  Everything is drawn in the canonical image space of the plate (3748x5276 legacy,
  3744x5276 G950); a single contain-fit transform maps that to the canvas, exactly
  like canonicalCockpitTransform on Android. The geometry (sprite scales, alpha
  content bounds, atlas frames) is precomputed by tools/lib/cockpit-pack.mjs.

  Deliberate deviation from Android, flagged in WEB_APP_FEATURE_MANIFEST.md:
  the master WARNING / CAUTION lamp art is painted only when the lamp is lit.
  ScenarioPhaseSnapshotRenderer paints it unconditionally (a known Android bug —
  warningActive / cautionActive are computed and then only logged), which would
  show a lit MASTER CAUTION on every frozen snapshot.
*/
import { fitFrame, rectPx, displayVariant } from "./logic/cockpit/hitboxes.js";
import { sortForDraw, isLeverHitbox, isSwitchHitbox, isButtonLikeHitbox, leverTopLeft, defaultLeverRawPosition, visualStateKeysForSwitchState, SPRITE_RENDER_OFFSETS, liveScaleOverride } from "./logic/cockpit/sprites.js";
import { cockpitVisualKeys, canonicalVisualKey, canonicalVisualAliases, visualKeysMatch, isInstrumentVisualHost, isAnnunciatorVisualHost, resolveVisualHostRole, visualOverlayCandidateIds, ROLE } from "./logic/cockpit/keys.js";
import { findAnnunciatorHost } from "./logic/cockpit/snapshot.js";
import { C } from "./logic/cockpit/engine.js";

/* ------------------------------------------------------------- constants */
const USER_SCALE_MIN = 0.35, USER_SCALE_MAX = 20, TAP_SLOP_PX = 28;
/* The framing scale a focus region gets at zoom 1, before the user's multiplier.
   Capped well below USER_SCALE_MAX so the multiplier always has somewhere to go:
   the original clamped base * multiplier together at 10, which meant that for any
   region tight enough to frame at 10 or more — a lever slot, a single switch —
   every Zoom + press recomputed the same 10 and nothing moved. */
const FOCUS_BASE_MIN = 1.35, FOCUS_BASE_MAX = 8;

/* Pure, so the zoom behaviour can be tested across region sizes without a canvas. */
export function focusScaleFor(region, zoomMultiplier) {
  if (!region) return USER_SCALE_MIN;
  const w = Math.max(0.0001, region.width), hgt = Math.max(0.0001, region.height);
  const base = clamp(Math.max(1 / w, 1 / hgt) * 0.72, FOCUS_BASE_MIN, FOCUS_BASE_MAX);
  return clamp(base * (zoomMultiplier > 0 ? zoomMultiplier : 1), USER_SCALE_MIN, USER_SCALE_MAX);
}
export const FOCUS_SCALE_LIMITS = { min: USER_SCALE_MIN, max: USER_SCALE_MAX, baseMax: FOCUS_BASE_MAX };
const NEEDLE_PROFILES = {
  TORQUE_GAUGE_L: [-88, 240, 0.355], TORQUE_GAUGE_R: [-88, 240, 0.355],
  NG_GAUGE_L: [180, 272, 0.352], NG_GAUGE_R: [180, 272, 0.352],
  NP_GAUGE_L: [-178, 272, 0.352], NP_GAUGE_R: [-178, 272, 0.352],
  T5_GAUGE_L: [-82, 220, 0.355], T5_GAUGE_R: [-82, 220, 0.355],
  FUEL_QUANTITY_GAUGE_L: [-128, 252, 0.332], FUEL_QUANTITY_GAUGE_R: [-128, 252, 0.332],
  FUEL_FLOW_GAUGE_L: [-126, 248, 0.332], FUEL_FLOW_GAUGE_R: [-126, 248, 0.332],
  OIL_PRESS_GAUGE_L: [-124, 228, 0.328], OIL_PRESS_GAUGE_R: [-124, 228, 0.328],
  OIL_TEMP_GAUGE_L: [-122, 214, 0.328], OIL_TEMP_GAUGE_R: [-122, 214, 0.328]
};
const DEFAULT_NEEDLE = [-135, 270, 0.38];
const CAS_COLOURS = { WARNING: "#FF3B30", CAUTION: "#FFD54F", ADVISORY: "#FFFFFF", STATUS: "#34C759" };
const PHASE_SCRIM = { BEFORE: 0.04, DURING: 0.06, AFTER: 0.05 };

const G950_RANGES = {
  TORQUE_GAUGE_L: [0, C.TORQUE_GAUGE_GREEN_MAX_PSI, 0], TORQUE_GAUGE_R: [0, C.TORQUE_GAUGE_GREEN_MAX_PSI, 0],
  NG_GAUGE_L: [0, 102, 1], NG_GAUGE_R: [0, 102, 1], NP_GAUGE_L: [0, 101.5, 1], NP_GAUGE_R: [0, 101.5, 1],
  T5_GAUGE_L: [0, 980, 0], T5_GAUGE_R: [0, 980, 0], FUEL_QUANTITY_GAUGE_L: [0, 1000, 0], FUEL_QUANTITY_GAUGE_R: [0, 1000, 0],
  FUEL_FLOW_GAUGE_L: [0, 420, 0], FUEL_FLOW_GAUGE_R: [0, 420, 0], OIL_PRESS_GAUGE_L: [0, 100, 0], OIL_PRESS_GAUGE_R: [0, 100, 0],
  OIL_TEMP_GAUGE_L: [0, 100, 0], OIL_TEMP_GAUGE_R: [0, 100, 0], VDC_GAUGE: [20, 30, 1]
};

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

/* --------------------------------------------------- protected media loader */
const MEDIA_CACHE_NAME = "dhc6-media-v1";
const imageCache = new Map();

export async function loadProtectedImage(mediaPath, onProgress) {
  if (imageCache.has(mediaPath)) return imageCache.get(mediaPath);
  const promise = (async function () {
    const url = "/api/media/" + mediaPath.split("/").map(encodeURIComponent).join("/");
    let response = null;
    let cache = null;
    try { cache = await caches.open(MEDIA_CACHE_NAME); response = await cache.match(url); } catch (error) { cache = null; }
    if (!response) {
      response = await fetch(url, { credentials: "same-origin" });
      if (response.status === 401 || response.status === 403) {
        /* the session or entitlement is gone: never keep decoded or cached protected imagery */
        clearCockpitImageCache();
        const e = new Error("session_invalid"); e.status = response.status; throw e;
      }
      if (response.status === 404) { const e = new Error("media_not_published"); e.status = 404; throw e; }
      if (!response.ok) throw new Error("media_unavailable_" + response.status);
      if (cache) { try { await cache.put(url, response.clone()); } catch (error) { /* quota */ } }
    }
    const total = Number(response.headers.get("content-length") || 0);
    let blob;
    if (onProgress && response.body && total > 0) {
      const reader = response.body.getReader();
      const chunks = []; let received = 0;
      for (;;) {
        const step = await reader.read();
        if (step.done) break;
        chunks.push(step.value); received += step.value.length;
        onProgress(received / total);
      }
      blob = new Blob(chunks);
    } else {
      blob = await response.blob();
    }
    const bitmap = typeof createImageBitmap === "function" ? await createImageBitmap(blob) : await new Promise(function (resolve, reject) {
      const img = new Image(); const objectUrl = URL.createObjectURL(blob);
      img.onload = function () { URL.revokeObjectURL(objectUrl); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(objectUrl); reject(new Error("decode_failed")); };
      img.src = objectUrl;
    });
    return bitmap;
  })();
  imageCache.set(mediaPath, promise);
  promise.catch(function () { imageCache.delete(mediaPath); });
  return promise;
}

/*
  Same fetch path, but handed back as an object URL for an <img>. Used by the
  Systems 2D reference posters, where real DOM pins beat a canvas for keyboard
  focus and screen readers. The URLs are tracked so a revoked session drops them
  along with everything else.
*/
const objectUrlCache = new Map();

export async function loadProtectedImageUrl(mediaPath) {
  if (objectUrlCache.has(mediaPath)) return objectUrlCache.get(mediaPath);
  const promise = (async function () {
    const url = "/api/media/" + mediaPath.split("/").map(encodeURIComponent).join("/");
    let response = null;
    let cache = null;
    try { cache = await caches.open(MEDIA_CACHE_NAME); response = await cache.match(url); } catch (error) { cache = null; }
    if (!response) {
      response = await fetch(url, { credentials: "same-origin" });
      if (response.status === 401 || response.status === 403) {
        clearCockpitImageCache();
        const e = new Error("session_invalid"); e.status = response.status; throw e;
      }
      if (response.status === 404) { const e = new Error("media_not_published"); e.status = 404; throw e; }
      if (!response.ok) throw new Error("media_unavailable_" + response.status);
      if (cache) { try { await cache.put(url, response.clone()); } catch (error) { /* quota */ } }
    }
    return URL.createObjectURL(await response.blob());
  })();
  objectUrlCache.set(mediaPath, promise);
  promise.catch(function () { objectUrlCache.delete(mediaPath); });
  return promise;
}

/* Drops the decoded bitmaps AND the on-disk protected-media cache entries. */
export function clearCockpitImageCache() {
  imageCache.clear();
  objectUrlCache.forEach(function (promise) {
    promise.then(function (url) { try { URL.revokeObjectURL(url); } catch (error) { /* gone */ } }, function () { /* never resolved */ });
  });
  objectUrlCache.clear();
  try { return caches.delete(MEDIA_CACHE_NAME); } catch (error) { return Promise.resolve(false); }
}

/* --------------------------------------------------------------- renderer */
export function createCockpitRenderer(container, options) {
  const opts = options || {};
  const variant = displayVariant(opts.variant);
  const data = opts.variantPack;
  const hitboxes = data.hitboxes;
  const refW = data.plate.width, refH = data.plate.height;
  const plateScaleX = refW / (data.plate.pixelWidth || refW);
  const plateScaleY = refH / (data.plate.pixelHeight || refH);

  const canvas = document.createElement("canvas");
  canvas.className = "cockpit-canvas";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "DHC-6 " + (variant === "G950" ? "G950" : "Legacy") + " cockpit");
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  const state = {
    plate: opts.plate || null, atlas: opts.atlas || null,
    visual: { analogValues: {}, rawAnalogValues: {}, annunciators: {}, casEntries: [], switchStates: {}, leverPositions: {}, autofeatherArmed: false, autofeatherSelected: false, autofeatherTriggered: false },
    highlight: [], primaryHighlight: null, scrim: 0, interactive: Boolean(opts.interactive),
    userScale: 1, offsetX: 0, offsetY: 0, cssW: 0, cssH: 0, dpr: 1, needsRender: false, disposed: false
  };
  let onPick = null, onLever = null, onSwitch = null, onView = null;

  function transform() {
    const fit = fitFrame(state.cssW, state.cssH, refW, refH);
    const scale = Math.max(0.0001, fit.scale * state.userScale);
    return { scale: scale, x: fit.left + state.offsetX, y: fit.top + state.offsetY, fit: fit };
  }
  function toWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const t = transform();
    return { x: (clientX - rect.left - t.x) / t.scale, y: (clientY - rect.top - t.y) / t.scale };
  }
  function requestRender() { if (!state.needsRender) { state.needsRender = true; requestAnimationFrame(frame); } }

  /* -------------------------------------------------------------- resize */
  function resize() {
    const rect = container.getBoundingClientRect();
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width)), h = Math.max(1, Math.round(rect.height));
    if (w === state.cssW && h === state.cssH && dpr === state.dpr) return;
    state.cssW = w; state.cssH = h; state.dpr = dpr;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px"; canvas.style.height = h + "px";
    requestRender();
  }
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
  if (observer) observer.observe(container); else window.addEventListener("resize", resize);

  /* ------------------------------------------------------ atlas blitting */
  function blit(entry, dx, dy, dw, dh, alpha) {
    if (!state.atlas || !entry) return;
    const f = entry.frame;
    if (!(dw > 0) || !(dh > 0)) return;
    if (alpha != null && alpha < 1) { ctx.save(); ctx.globalAlpha = alpha; }
    ctx.drawImage(state.atlas, f.x, f.y, f.w, f.h, dx, dy, dw, dh);
    if (alpha != null && alpha < 1) ctx.restore();
  }

  /* ------------------------------------------------- visual contract layer */
  function assetFor(map, hb) {
    const candidates = visualOverlayCandidateIds(hb);
    for (let i = 0; i < candidates.length; i += 1) if (map[candidates[i]]) return map[candidates[i]];
    const keys = Object.keys(map);
    for (let i = 0; i < keys.length; i += 1) if (candidates.some(function (c) { return visualKeysMatch(keys[i], c); })) return map[keys[i]];
    return null;
  }
  function drawToHost(entry, rect, preserveAspect) {
    if (!entry) return;
    if (!preserveAspect) { blit(entry, Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)); return; }
    const hostAspect = rect.width / Math.max(1, rect.height);
    const assetAspect = entry.bmp.w / Math.max(1, entry.bmp.h);
    let w, h;
    if (assetAspect > hostAspect) { w = rect.width; h = rect.width / assetAspect; } else { h = rect.height; w = rect.height * assetAspect; }
    blit(entry, Math.round(rect.left + (rect.width - w) / 2), Math.round(rect.top + (rect.height - h) / 2), Math.round(w), Math.round(h));
  }

  function drawG950Cas(rect, entries) {
    const shown = entries.filter(function (e) { return e.active; }).slice(0, 12);
    if (!shown.length) return;
    const textSize = Math.max(6, rect.height * 0.0272);
    const rowStep = textSize * 1.14, topPad = textSize * 0.90, bottomPad = textSize * 0.50, leftPad = rect.width * 0.032;
    const panelHeight = topPad + shown.length * rowStep + bottomPad;
    const panelWidth = rect.width * 0.19;
    const panelLeft = rect.left + rect.width - panelWidth - rect.width * 0.012;
    const panelTop = rect.top + rect.height - panelHeight - rect.height * 0.050;
    ctx.save();
    roundRect(panelLeft, panelTop, panelWidth, panelHeight, 8);
    ctx.fillStyle = "rgba(0,0,0,0.78)"; ctx.fill();
    ctx.strokeStyle = "rgba(58,70,82,0.4)"; ctx.lineWidth = Math.max(1, rect.width * 0.0032); ctx.stroke();
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    let baseline = panelTop + topPad;
    shown.forEach(function (msg) {
      ctx.font = (msg.acknowledged ? "" : "bold ") + textSize + "px system-ui, sans-serif";
      ctx.fillStyle = CAS_COLOURS[msg.priority] || CAS_COLOURS.ADVISORY;
      ctx.fillText(msg.text, panelLeft + leftPad, baseline);
      baseline += rowStep;
    });
    ctx.restore();
  }

  function displayValue(key) {
    const raw = state.visual.rawAnalogValues[key];
    const norm = state.visual.analogValues[key];
    const range = G950_RANGES[key];
    if (raw != null) return range ? raw.toFixed(range[2]) : String(Math.round(raw));
    if (norm == null) return "---";
    if (!range) return String(Math.round(norm * 100));
    return (range[0] + (range[1] - range[0]) * clamp(norm, 0, 1)).toFixed(range[2]);
  }

  function drawG950Engine(rect, entry) {
    drawToHost(entry, rect, false);
    ctx.save();
    ctx.fillStyle = "rgba(4,17,26,0.90)"; ctx.fillRect(rect.left, rect.top, rect.width, rect.height);
    const w = rect.width, h = rect.height;
    const outerCorner = Math.max(8, w * 0.015), innerCorner = Math.max(6, w * 0.012);
    const valueSize = Math.max(12, h * 0.028), smallValueSize = Math.max(10, h * 0.021), labelSize = Math.max(9, h * 0.018);
    const strokeWidth = Math.max(1.5, w * 0.003);
    function panel(l, t, r, b) {
      roundRect(l, t, r - l, b - t, outerCorner);
      ctx.fillStyle = "rgba(12,24,32,0.80)"; ctx.fill();
      ctx.strokeStyle = "#39505F"; ctx.lineWidth = strokeWidth; ctx.stroke();
    }
    const top = { l: rect.left + 0.035 * w, t: rect.top + 0.035 * h, r: rect.left + w - 0.035 * w, b: rect.top + 0.565 * h };
    const ll = { l: rect.left + 0.035 * w, t: rect.top + 0.605 * h, r: rect.left + 0.325 * w, b: rect.top + h - 0.045 * h };
    const lr = { l: rect.left + 0.355 * w, t: rect.top + 0.605 * h, r: rect.left + w - 0.035 * w, b: rect.top + h - 0.045 * h };
    panel(top.l, top.t, top.r, top.b); panel(ll.l, ll.t, ll.r, ll.b); panel(lr.l, lr.t, lr.r, lr.b);

    const innerL = top.l + (top.r - top.l) * 0.03, innerT = top.t + (top.b - top.t) * 0.05;
    const innerW = (top.r - top.l) * 0.94, innerH = (top.b - top.t) * 0.90;
    const columnGap = 0.03 * (top.r - top.l), rowGap = 0.025 * (top.b - top.t);
    const cellW = (innerW - columnGap) / 2, cellH = (innerH - rowGap * 3) / 4;
    const rows = [["TORQUE_GAUGE_", "TRQ"], ["NP_GAUGE_", "NP"], ["T5_GAUGE_", "T5"], ["NG_GAUGE_", "NG"]];
    for (let col = 0; col < 2; col += 1) {
      for (let row = 0; row < 4; row += 1) {
        const key = rows[row][0] + (col === 0 ? "L" : "R");
        const cx = innerL + col * (cellW + columnGap), cy = innerT + row * (cellH + rowGap);
        roundRect(cx, cy, cellW, cellH, Math.max(4, cellW * 0.08));
        ctx.fillStyle = "rgba(16,34,44,0.67)"; ctx.fill();
        ctx.strokeStyle = "#39505F"; ctx.lineWidth = Math.max(1.25, cellW * 0.015); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + cellW * 0.52, cy + cellH * 0.14); ctx.lineTo(cx + cellW * 0.52, cy + cellH * 0.86);
        ctx.strokeStyle = "#2B3F4C"; ctx.lineWidth = strokeWidth; ctx.stroke();
        ctx.textAlign = "left"; ctx.font = "bold " + labelSize + "px system-ui, sans-serif"; ctx.fillStyle = "#8EA7B8";
        ctx.fillText(rows[row][1], cx + cellW * 0.08, cy + cellH * 0.26);
        ctx.textAlign = "right"; ctx.font = "bold " + smallValueSize + "px system-ui, sans-serif"; ctx.fillStyle = "#EAF6FF";
        ctx.fillText(displayValue(key), cx + cellW * 0.92, cy + cellH * 0.34);
        const norm = state.visual.analogValues[key];
        if (norm != null) {
          const ncx = cx + cellW * 0.30, ncy = cy + cellH * 0.58, radius = Math.min(cellW, cellH) * 0.30;
          const angle = (198 + clamp(norm, 0, 1) * 142) * Math.PI / 180;
          ctx.beginPath(); ctx.moveTo(ncx, ncy); ctx.lineTo(ncx + Math.cos(angle) * radius, ncy + Math.sin(angle) * radius);
          ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = Math.max(2, cellW * 0.020); ctx.stroke();
          ctx.beginPath(); ctx.arc(ncx, ncy, Math.max(1.5, cellW * 0.022), 0, Math.PI * 2); ctx.fillStyle = "#FFFFFF"; ctx.fill();
        }
      }
    }
    const llW = ll.r - ll.l, llH = ll.b - ll.t;
    function section(t0, t1) {
      roundRect(ll.l + llW * 0.08, ll.t + llH * t0, llW * 0.84, llH * (t1 - t0), innerCorner);
      ctx.fillStyle = "rgba(16,34,44,0.67)"; ctx.fill(); ctx.strokeStyle = "#2B3F4C"; ctx.lineWidth = strokeWidth; ctx.stroke();
    }
    section(0.08, 0.46); section(0.56, 0.73); section(0.78, 0.93);
    ctx.textAlign = "left"; ctx.font = "bold " + labelSize + "px system-ui, sans-serif"; ctx.fillStyle = "#8EA7B8";
    ctx.fillText("FUEL QTY", ll.l + llW * 0.10, ll.t + llH * 0.24);
    ctx.fillText("L", ll.l + llW * 0.12, ll.t + llH * 0.55); ctx.fillText("R", ll.l + llW * 0.12, ll.t + llH * 0.83);
    ctx.fillText("AF", ll.l + llW * 0.10, ll.t + llH * 0.62); ctx.fillText("2700", ll.l + llW * 0.10, ll.t + llH * 0.88);
    ctx.textAlign = "right"; ctx.font = "bold " + valueSize + "px system-ui, sans-serif"; ctx.fillStyle = "#EAF6FF";
    ctx.fillText(displayValue("FUEL_QUANTITY_GAUGE_L"), ll.l + llW * 0.90, ll.t + llH * 0.55);
    ctx.fillText(displayValue("FUEL_QUANTITY_GAUGE_R"), ll.l + llW * 0.90, ll.t + llH * 0.83);
    ctx.fillText("SET", ll.l + llW * 0.90, ll.t + llH * 0.88);
    const v = state.visual;
    const afText = v.autofeatherTriggered ? "TRIG" : v.autofeatherArmed ? "ARM" : v.autofeatherSelected ? "SEL" : "OFF";
    ctx.font = "bold " + smallValueSize + "px system-ui, sans-serif";
    ctx.fillStyle = v.autofeatherTriggered ? "#FFC107" : "#B0BEC5";
    ctx.fillText(afText, ll.l + llW * 0.90, ll.t + llH * 0.62);

    const lrW = lr.r - lr.l, lrH = lr.b - lr.t;
    const barLeft = lr.l + lrW * 0.34, barRight = lr.l + lrW * 0.77;
    const leftValueX = lr.l + lrW * 0.26, rightValueX = lr.r - lrW * 0.05;
    const barRows = [["FF", "FUEL_FLOW_GAUGE_L", "FUEL_FLOW_GAUGE_R", 0.16], ["OIL TEMP", "OIL_TEMP_GAUGE_L", "OIL_TEMP_GAUGE_R", 0.41],
      ["OIL PRESS", "OIL_PRESS_GAUGE_L", "OIL_PRESS_GAUGE_R", 0.66], ["VDC", "VDC_GAUGE", null, 0.86]];
    barRows.forEach(function (row) {
      const y = lr.t + lrH * row[3];
      ctx.textAlign = "left"; ctx.font = "bold " + labelSize + "px system-ui, sans-serif"; ctx.fillStyle = "#8EA7B8";
      ctx.fillText(row[0], barLeft, y - h * 0.018);
      ctx.beginPath(); ctx.moveTo(barLeft, y); ctx.lineTo(barRight, y);
      ctx.strokeStyle = "#6F8593"; ctx.lineWidth = Math.max(1.5, h * 0.0035); ctx.stroke();
      const tick = Math.max(3, h * 0.010);
      [barLeft, barRight].forEach(function (x) { ctx.beginPath(); ctx.moveTo(x, y - tick); ctx.lineTo(x, y + tick); ctx.stroke(); });
      ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = Math.max(2, w * 0.004);
      const nl = state.visual.analogValues[row[1]];
      if (nl != null) {
        const x = barLeft + (barRight - barLeft) * clamp(nl, 0, 1);
        ctx.beginPath(); ctx.moveTo(x, y - h * 0.020); ctx.lineTo(x, y + h * (row[2] ? 0.002 : 0.016)); ctx.stroke();
      }
      if (row[2]) {
        const nr = state.visual.analogValues[row[2]];
        if (nr != null) { const x = barLeft + (barRight - barLeft) * clamp(nr, 0, 1); ctx.beginPath(); ctx.moveTo(x, y - h * 0.002); ctx.lineTo(x, y + h * 0.020); ctx.stroke(); }
      }
      ctx.textAlign = "right"; ctx.font = smallValueSize + "px system-ui, sans-serif"; ctx.fillStyle = "#EAF6FF";
      if (row[2]) {
        ctx.fillText("L " + displayValue(row[1]), leftValueX, y + h * 0.010);
        ctx.fillText("R " + displayValue(row[2]), rightValueX, y + h * 0.010);
      } else {
        ctx.fillText(displayValue(row[1]), rightValueX, y + h * 0.010);
      }
    });
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function drawVisualContract() {
    const isLegacy = variant === "LEGACY";
    const needleColor = isLegacy ? "#FF3B30" : "#00E5FF";
    const lampFallback = isLegacy ? "rgba(255,213,79,0.6)" : "rgba(0,229,255,0.6)";
    if (isLegacy) {
      hitboxes.forEach(function (hb) {
        if (!isInstrumentVisualHost(hb)) return;
        const entry = assetFor(data.instruments, hb);
        if (entry) drawToHost(entry, rectPx(hb, refW, refH), false);
      });
    } else {
      function hostFor(keyList) {
        for (let i = 0; i < hitboxes.length; i += 1) {
          const keys = visualOverlayCandidateIds(hitboxes[i]);
          if (keys.some(function (k) { return keyList.indexOf(k) > -1; })) return hitboxes[i];
        }
        return null;
      }
      const pfdL = hostFor(["PFD_LEFT"]), pfdR = hostFor(["PFD_RIGHT"]);
      [pfdL, pfdR].forEach(function (hb) {
        if (!hb) return;
        const rect = rectPx(hb, refW, refH);
        drawToHost(assetFor(data.instruments, hb), rect, true);
        drawG950Cas(rect, state.visual.casEntries || []);
      });
      const mfd = hostFor(["MFD_CENTRE", "MFD_CENTER"]);
      if (mfd) drawG950Engine(rectPx(mfd, refW, refH), assetFor(data.instruments, mfd));
      const mfdDisplay = hostFor(["MFD_CENTRE_DISPLAY", "MFD_CENTER_DISPLAY"]);
      if (mfdDisplay) drawToHost(assetFor(data.instruments, mfdDisplay), rectPx(mfdDisplay, refW, refH), false);
      const handled = [pfdL, pfdR, mfd, mfdDisplay].filter(Boolean);
      hitboxes.forEach(function (hb) {
        if (!isInstrumentVisualHost(hb) || handled.indexOf(hb) > -1) return;
        const entry = assetFor(data.instruments, hb);
        if (entry) drawToHost(entry, rectPx(hb, refW, refH), false);
      });
    }

    /* Master lamps (gated — see the header note). */
    ["WARNING", "CAUTION"].forEach(function (kind) {
      const lit = state.visual.annunciators["MASTER_" + kind];
      if (!lit) return;
      hitboxes.forEach(function (hb) {
        const keys = visualOverlayCandidateIds(hb);
        if (!keys.some(function (k) { return k === "MASTER_" + kind; })) return;
        const entry = data.annunciators[kind] || data.annunciators["MASTER_" + kind];
        if (entry) drawToHost(entry, rectPx(hb, refW, refH), false);
      });
    });

    /* Legacy needles. */
    if (isLegacy) {
      Object.keys(state.visual.analogValues).forEach(function (instrumentId) {
        const normalized = state.visual.analogValues[instrumentId];
        if (normalized == null) return;
        const wanted = canonicalVisualKey(instrumentId);
        let host = null;
        for (let i = 0; i < hitboxes.length; i += 1) {
          if (!isInstrumentVisualHost(hitboxes[i])) continue;
          if (cockpitVisualKeys(hitboxes[i]).indexOf(wanted) > -1) { host = hitboxes[i]; break; }
        }
        if (!host) return;
        const rect = rectPx(host, refW, refH);
        const profile = NEEDLE_PROFILES[wanted] || DEFAULT_NEEDLE;
        const cx = rect.left + rect.width * 0.5, cy = rect.top + rect.height * 0.5;
        const radius = Math.min(rect.width, rect.height) * profile[2];
        const angle = (profile[0] + clamp(normalized, 0, 1) * profile[1]) * Math.PI / 180;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
        ctx.strokeStyle = needleColor; ctx.lineWidth = Math.max(2, Math.min(rect.width, rect.height) * 0.02); ctx.lineCap = "round"; ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, Math.max(2, Math.min(rect.width, rect.height) * 0.04), 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.70)"; ctx.fill();
      });
    }

    /* Annunciator lamps — lit only. */
    Object.keys(state.visual.annunciators).forEach(function (lampId) {
      if (!state.visual.annunciators[lampId]) return;
      if (lampId === "MASTER_WARNING" || lampId === "MASTER_CAUTION") return;
      const host = findAnnunciatorHost(hitboxes, lampId);
      if (!host) return;
      const rect = rectPx(host, refW, refH);
      const entry = assetFor(data.annunciators, host);
      if (entry) drawToHost(entry, rect, false);
      else { ctx.fillStyle = lampFallback; ctx.fillRect(rect.left, rect.top, rect.width, rect.height); }
    });
  }

  /* --------------------------------------------------------- control layer */
  function spriteStateFor(hb) {
    const def = data.sprites[hb.id];
    if (!def) return null;
    const switchId = (hb.binding && hb.binding.switchId) || hb.id;
    if (isSwitchHitbox(hb) && !isLeverHitbox(hb)) {
      const current = state.visual.switchStates[switchId] || state.visual.switchStates[hb.id];
      const keys = visualStateKeysForSwitchState(current || "CENTER", hb);
      for (let i = 0; i < keys.length; i += 1) if (def.states[keys[i]]) return { def: def, state: def.states[keys[i]], explicit: Boolean(current) };
    }
    return { def: def, state: def.states[def.defaultState] || def.states[Object.keys(def.states)[0]], explicit: true };
  }

  function drawControls() {
    const ordered = sortForDraw(hitboxes);
    const rendered = {};
    ordered.forEach(function (hb) {
      const resolved = spriteStateFor(hb);
      if (!resolved || !resolved.state) return;
      const lever = isLeverHitbox(hb);
      const sw = isSwitchHitbox(hb);
      const leverId = (hb.binding && hb.binding.leverId) || hb.id;
      const switchId = (hb.binding && hb.binding.switchId) || hb.id;
      const renderKey = lever ? "lever:" + leverId : sw ? "switch:" + switchId : "hitbox:" + hb.id;
      if (rendered[renderKey]) return;
      rendered[renderKey] = true;
      const rect = rectPx(hb, refW, refH);
      const spriteScaleMul = hb.sprite ? hb.sprite.scaleMul : 1;
      const s = clamp(resolved.def.scaleMul * spriteScaleMul * (state.interactive ? liveScaleOverride(hb.id) : 1), 0.05, 8);
      const content = resolved.state.content;
      const contentW = Math.max(1, content.w * s), contentH = Math.max(1, content.h * s);
      const contentLeft = content.left * s, contentTop = content.top * s;
      let x, y;
      if (lever) {
        const raw = clamp(state.visual.leverPositions[leverId] != null ? state.visual.leverPositions[leverId] : defaultLeverRawPosition(hb.id), 0, 1);
        const p = leverTopLeft(hb, leverId, rect, contentW, contentH, contentLeft, contentTop, raw);
        x = p.x; y = p.y;
      } else {
        const anchorX = hb.sprite && hb.sprite.anchorX != null ? hb.sprite.anchorX * refW : rect.left + rect.width / 2;
        const anchorY = hb.sprite && hb.sprite.anchorY != null ? hb.sprite.anchorY * refH : rect.top + rect.height / 2;
        x = anchorX - contentW / 2 - contentLeft;
        y = anchorY - contentH / 2 - contentTop;
      }
      const nudge = SPRITE_RENDER_OFFSETS[hb.id] || SPRITE_RENDER_OFFSETS[leverId] || SPRITE_RENDER_OFFSETS[switchId] || { x: 0, y: 0 };
      const drawLeft = x + nudge.x + resolved.def.offsetXPx + (hb.sprite ? hb.sprite.offsetXPx : 0);
      const drawTop = y + nudge.y + resolved.def.offsetYPx + (hb.sprite ? hb.sprite.offsetYPx : 0);
      blit(resolved.state, Math.round(drawLeft + contentLeft), Math.round(drawTop + contentTop), Math.round(contentW), Math.round(contentH));
    });
  }

  /* ------------------------------------------------------ highlight layer */
  function highlightMatches(hb, target) {
    const raw = String(target || "").replace(/\|SELECTED$/i, "");
    const norm = function (v) { return String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); };
    const candidates = [hb.id, hb.binding && hb.binding.leverId, hb.binding && hb.binding.switchId, hb.binding && hb.binding.action,
      hb.binding && hb.binding.displayId, hb.binding && hb.binding.regionId, hb.binding && hb.binding.instrumentId].filter(Boolean);
    const h = norm(raw);
    return candidates.some(function (c) {
      const n = norm(c);
      if (n === h) return true;
      if (n.length >= 4 && h.length >= 4 && (n.indexOf(h) > -1 || h.indexOf(n) > -1)) return true;
      return ["FLAPSELECTOR", "FLAPS", "FLAP"].indexOf(n) > -1 && ["FLAPSELECTOR", "FLAPS", "FLAP"].indexOf(h) > -1;
    });
  }
  function drawHighlights() {
    if (!state.highlight.length) return;
    state.highlight.forEach(function (target) {
      const confirmed = /\|SELECTED$/i.test(String(target));
      hitboxes.forEach(function (hb) {
        if (!highlightMatches(hb, target)) return;
        const rect = rectPx(hb, refW, refH);
        const pad = Math.max(18, Math.max(rect.width, rect.height) * 0.18);
        const left = Math.max(0, rect.left - pad), top = Math.max(0, rect.top - pad);
        const right = Math.min(refW, rect.left + rect.width + pad), bottom = Math.min(refH, rect.top + rect.height + pad);
        const w = right - left, h = bottom - top;
        const box = confirmed ? "0,230,118" : "255,235,59";
        roundRect(left, top, w, h, 14); ctx.fillStyle = "rgba(" + box + "," + (confirmed ? 0.34 : 0.22) + ")"; ctx.fill();
        roundRect(left, top, w, h, 14); ctx.strokeStyle = "rgba(0,0,0,0.72)"; ctx.lineWidth = 12; ctx.stroke();
        roundRect(left, top, w, h, 14); ctx.strokeStyle = "rgb(" + box + ")"; ctx.lineWidth = 7; ctx.stroke();
        roundRect(left + 6, top + 6, w - 12, h - 12, 10); ctx.strokeStyle = "rgba(255,255,255,0.95)"; ctx.lineWidth = 2; ctx.stroke();
      });
    });
  }

  /* --------------------------------------------------------------- frame */
  let frameCount = 0, lastError = null;
  function frame() {
    state.needsRender = false;
    if (state.disposed || !state.cssW) return;
    frameCount += 1;
    const t = transform();
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    ctx.clearRect(0, 0, state.cssW, state.cssH);
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, state.cssW, state.cssH);
    if (!state.plate) return;
    ctx.save();
    ctx.translate(t.x, t.y); ctx.scale(t.scale, t.scale);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(state.plate, 0, 0, refW, refH);
    try {
      if (state.atlas) { drawVisualContract(); drawControls(); }
      drawHighlights();
    } catch (error) {
      // A bad overlay must never take the plate down with it.
      lastError = error;
      if (window.console && window.console.warn) window.console.warn("cockpit overlay failed", error);
    }
    ctx.restore();
    if (state.scrim > 0) { ctx.fillStyle = "rgba(0,0,0," + state.scrim + ")"; ctx.fillRect(0, 0, state.cssW, state.cssH); }
  }

  /* ---------------------------------------------------------- interaction */
  function hitTest(world) {
    let best = null;
    hitboxes.forEach(function (hb) {
      const r = rectPx(hb, refW, refH);
      if (world.x < r.left || world.x > r.left + r.width || world.y < r.top || world.y > r.top + r.height) return;
      const area = r.width * r.height;
      if (!best || area < best.area) best = { hb: hb, area: area };
    });
    return best ? best.hb : null;
  }

  const pointers = new Map();
  let drag = null, pinch = null;

  function onPointerDown(event) {
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const pts = Array.from(pointers.values());
      pinch = { dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), scale: state.userScale, cx: (pts[0].x + pts[1].x) / 2, cy: (pts[0].y + pts[1].y) / 2 };
      drag = null;
      return;
    }
    const world = toWorld(event.clientX, event.clientY);
    const hb = state.interactive ? hitTest(world) : null;
    drag = { startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: 0, hb: hb, lever: hb && isLeverHitbox(hb) ? hb : null, accum: 0 };
  }
  function onPointerMove(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && pointers.size >= 2) {
      const pts = Array.from(pointers.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (pinch.dist > 0) {
        const t = transform();
        const rect = canvas.getBoundingClientRect();
        const focalX = (pts[0].x + pts[1].x) / 2 - rect.left, focalY = (pts[0].y + pts[1].y) / 2 - rect.top;
        const worldX = (focalX - t.x) / t.scale, worldY = (focalY - t.y) / t.scale;
        state.userScale = clamp(pinch.scale * (dist / pinch.dist), USER_SCALE_MIN, USER_SCALE_MAX);
        const nt = transform();
        state.offsetX += focalX - (worldX * nt.scale + nt.x);
        state.offsetY += focalY - (worldY * nt.scale + nt.y);
        requestRender();
        if (onView) onView(viewState());
      }
      return;
    }
    if (!drag) return;
    const dx = event.clientX - drag.lastX, dy = event.clientY - drag.lastY;
    drag.lastX = event.clientX; drag.lastY = event.clientY;
    drag.moved += Math.hypot(dx, dy);
    if (drag.lever && state.interactive) {
      const t = transform();
      const rect = rectPx(drag.lever, refW, refH);
      const leverId = (drag.lever.binding && drag.lever.binding.leverId) || drag.lever.id;
      const deltaNorm = -(dy / t.scale) / Math.max(1, rect.height);
      const prior = state.visual.leverPositions[leverId] != null ? state.visual.leverPositions[leverId] : defaultLeverRawPosition(drag.lever.id);
      const next = clamp(prior + deltaNorm, 0, 1);
      if (Math.abs(next - prior) > 0.0001 && onLever) onLever(leverId, next, prior);
      return;
    }
    state.offsetX += dx; state.offsetY += dy;
    requestRender();
    if (onView) onView(viewState());
  }
  function onPointerUp(event) {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!drag) return;
    const finished = drag; drag = null;
    if (finished.lever) { if (onLever) onLever((finished.lever.binding && finished.lever.binding.leverId) || finished.lever.id, null, null, true); return; }
    if (finished.moved <= TAP_SLOP_PX) {
      const world = toWorld(event.clientX, event.clientY);
      const hb = hitTest(world);
      if (hb && onPick) onPick(hb, world);
    }
  }
  function onWheel(event) {
    if (!event.ctrlKey && !event.metaKey && !state.interactive) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const t = transform();
    const focalX = event.clientX - rect.left, focalY = event.clientY - rect.top;
    const worldX = (focalX - t.x) / t.scale, worldY = (focalY - t.y) / t.scale;
    state.userScale = clamp(state.userScale * (event.deltaY < 0 ? 1.12 : 1 / 1.12), USER_SCALE_MIN, USER_SCALE_MAX);
    const nt = transform();
    state.offsetX += focalX - (worldX * nt.scale + nt.x);
    state.offsetY += focalY - (worldY * nt.scale + nt.y);
    requestRender();
    if (onView) onView(viewState());
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  function viewState() { return { userScale: state.userScale, offsetX: state.offsetX, offsetY: state.offsetY }; }

  resize();

  const api = {
    debug: function () {
      const vs = state.visual || {};
      const lit = Object.keys(vs.annunciators || {}).filter(function (k) { return vs.annunciators[k]; });
      return { frames: frameCount, cssW: state.cssW, cssH: state.cssH, hasPlate: Boolean(state.plate), hasAtlas: Boolean(state.atlas),
        transform: transform(), litAnnunciators: lit, annunciatorHosts: lit.map(function (id) { const hb = findAnnunciatorHost(hitboxes, id); return { id: id, host: hb ? hb.id : null, rect: hb ? hb.rect : null }; }),
        lastError: lastError ? String(lastError && lastError.message || lastError) : null };
    },
    canvas: canvas,
    variant: variant,
    hitboxes: hitboxes,
    setImages: function (plate, atlas) { state.plate = plate; state.atlas = atlas; requestRender(); },
    setVisualState: function (visual) { state.visual = Object.assign({ analogValues: {}, rawAnalogValues: {}, annunciators: {}, casEntries: [], switchStates: {}, leverPositions: {} }, visual); requestRender(); },
    setHighlight: function (ids, primaryId) { state.highlight = (ids || []).slice(); state.primaryHighlight = primaryId || null; requestRender(); },
    setScrim: function (phase) { state.scrim = typeof phase === "number" ? phase : (PHASE_SCRIM[phase] || 0); requestRender(); },
    setInteractive: function (on) { state.interactive = Boolean(on); canvas.style.touchAction = on ? "none" : "none"; },
    resetView: function () { state.userScale = 1; state.offsetX = 0; state.offsetY = 0; requestRender(); if (onView) onView(viewState()); },
    zoomBy: function (factor) {
      const t = transform();
      const focalX = state.cssW / 2, focalY = state.cssH / 2;
      const worldX = (focalX - t.x) / t.scale, worldY = (focalY - t.y) / t.scale;
      state.userScale = clamp(state.userScale * factor, USER_SCALE_MIN, USER_SCALE_MAX);
      const nt = transform();
      state.offsetX += focalX - (worldX * nt.scale + nt.x);
      state.offsetY += focalY - (worldY * nt.scale + nt.y);
      requestRender(); if (onView) onView(viewState());
    },
    /* Centre and zoom on a normalized region (Focus Snapshot). */
    focusRegion: function (region, zoomMultiplier) {
      if (!region) return null;
      state.userScale = focusScaleFor(region, zoomMultiplier);
      const centerX = (region.left + region.width / 2) * refW, centerY = (region.top + region.height / 2) * refH;
      state.offsetX = 0; state.offsetY = 0;
      const t2 = transform();
      state.offsetX = state.cssW / 2 - (centerX * t2.scale + t2.x);
      state.offsetY = state.cssH / 2 - (centerY * t2.scale + t2.y);
      requestRender(); if (onView) onView(viewState());
      /* Returned so the caller can tell a saturated zoom from a working one and
         disable the button rather than leaving it silently inert. */
      return { scale: state.userScale, min: USER_SCALE_MIN, max: USER_SCALE_MAX };
    },
    centerOn: function (hitboxId) {
      const hb = hitboxes.find(function (h) { return h.id === hitboxId; });
      if (!hb) return;
      const r = rectPx(hb, refW, refH);
      state.offsetX = 0; state.offsetY = 0;
      const t = transform();
      state.offsetX = state.cssW / 2 - ((r.left + r.width / 2) * t.scale + t.x);
      state.offsetY = state.cssH / 2 - ((r.top + r.height / 2) * t.scale + t.y);
      requestRender(); if (onView) onView(viewState());
    },
    hitTestAt: function (clientX, clientY) { return hitTest(toWorld(clientX, clientY)); },
    onPick: function (fn) { onPick = fn; },
    onLeverDrag: function (fn) { onLever = fn; },
    onSwitchTap: function (fn) { onSwitch = fn; },
    onViewChange: function (fn) { onView = fn; },
    requestRender: requestRender,
    dispose: function () {
      state.disposed = true;
      if (observer) observer.disconnect(); else window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      if (window.__cockpitRenderer === api) delete window.__cockpitRenderer;
    }
  };
  /* Walkthrough hook (tools/playwright-*.mjs); harmless in production. */
  window.__cockpitRenderer = api;
  return api;
}
