/*
  Shared plumbing for the AIRCRAFT tab: loading the protected cockpit pack and its
  imagery, building a renderer, and the frozen-snapshot surface used by the
  Scenario State / Focus Snapshot screens.
*/
import { h, Content, currentVariant } from "../core.js";
import { notice } from "../ui.js";
import { displayVariant } from "../logic/cockpit/hitboxes.js";
import { createCockpitRenderer, loadProtectedImage, clearCockpitImageCache } from "../cockpit.js";
import { createSnapshotRegistry } from "../logic/cockpit/snapshot.js";
import { createBindingsIndex } from "../logic/cockpit/bindings.js";

const cache = { pack: null, registry: null, bindings: new Map() };

export async function cockpitPack() {
  if (!cache.pack) cache.pack = await Content.pack("cockpit-plates");
  return cache.pack;
}

export async function snapshotRegistry() {
  if (!cache.registry) {
    const pack = await Content.pack("scenario-snapshots");
    cache.registry = createSnapshotRegistry(pack, snapshotOverrides());
  }
  return cache.registry;
}

export async function bindingsIndex(variant, hitboxes) {
  const key = displayVariant(variant);
  if (!cache.bindings.has(key)) {
    let pack = null;
    try { pack = await Content.pack("cockpit-bindings"); } catch (error) { pack = null; }
    cache.bindings.set(key, createBindingsIndex(pack, key, hitboxes));
  }
  return cache.bindings.get(key);
}

export function resetCockpitCaches() { cache.pack = null; cache.registry = null; cache.bindings.clear(); }

/* Per-browser phase overrides (the Android ScenarioSnapshotRegistry writes these to filesDir). */
const OVERRIDE_KEY = "dhc6.scenarioSnapshotOverrides";
export function snapshotOverrides() {
  try { return JSON.parse(window.localStorage.getItem(OVERRIDE_KEY) || "{}") || {}; } catch (error) { return {}; }
}

function writeOverrides(all) {
  try { window.localStorage.setItem(OVERRIDE_KEY, JSON.stringify(all)); return true; } catch (error) { return false; }
}

/* ScenarioSnapshotRegistry.savePhaseSnapshotOverride — one phase of one procedure. */
export function savePhaseOverride(procKey, phase, payload, meta) {
  const all = snapshotOverrides();
  const entry = all[procKey] || { phases: {} };
  entry.phases = entry.phases || {};
  const existing = entry.phases[phase] || {};
  entry.phases[phase] = {
    annunciators: payload.annunciators !== undefined ? payload.annunciators : existing.annunciators,
    instruments: payload.instruments !== undefined ? payload.instruments : existing.instruments,
    controls: payload.controls !== undefined ? payload.controls : existing.controls,
    notes: payload.notes !== undefined ? payload.notes : existing.notes
  };
  if (meta && meta.title) entry.title = meta.title;
  if (meta && meta.variant) entry.variant = meta.variant;
  entry.updatedAt = new Date().toISOString();
  all[procKey] = entry;
  const ok = writeOverrides(all);
  cache.registry = null;   // the registry merges overrides at construction time
  return ok;
}

export function hasOverride(procKey) { return Boolean(snapshotOverrides()[procKey]); }

/* Revert one procedure to the published Android snapshot. */
export function clearPhaseOverride(procKey) {
  const all = snapshotOverrides();
  if (!all[procKey]) return false;
  delete all[procKey];
  const ok = writeOverrides(all);
  cache.registry = null;
  return ok;
}

export function variantPackFor(pack, variant) {
  const key = displayVariant(variant);
  return pack.variants[key] || pack.variants.LEGACY;
}

/* Plate + atlas come from the protected media store; both are cached per session. */
export async function cockpitImages(variantPack, onProgress) {
  const plate = await loadProtectedImage(variantPack.plate.path, onProgress);
  const atlas = await loadProtectedImage(variantPack.atlas.path);
  return { plate: plate, atlas: atlas };
}

export function mediaPublished(mediaPath) {
  if (!Content.mediaIndex || !Content.mediaIndex.published) return null;
  return (Content.mediaIndex.items || []).some(function (i) { return i.path === mediaPath; });
}

/*
  A cockpit surface: canvas host with a loading / error overlay. Returns
  { root, ready, renderer(), setVisualState, setHighlight, setScrim, dispose }.
  `interactive` enables lever drag / switch tap / pan-zoom.
*/
export function cockpitSurface(opts) {
  const options = opts || {};
  const variant = displayVariant(options.variant || currentVariant());
  const host = h("div", { class: "cockpit-host" + (options.hostClass ? " " + options.hostClass : "") });
  const overlay = h("div", { class: "cockpit-overlay" });
  const root = h("div", { class: "cockpit-stage" + (options.stageClass ? " " + options.stageClass : "") }, [host, overlay]);
  let renderer = null;
  let disposed = false;

  function setOverlay(nodes, cls) {
    overlay.className = "cockpit-overlay" + (cls ? " " + cls : "");
    overlay.replaceChildren.apply(overlay, [].concat(nodes || []));
    overlay.hidden = !nodes || !nodes.length;
  }

  const ready = (async function () {
    setOverlay([h("div", { class: "t-body-m c-white", text: "Loading cockpit…" }), h("div", { class: "lab-progress" }, h("i", { style: "width:6%" }))], "loading");
    const bar = overlay.querySelector(".lab-progress i");
    let pack;
    try { pack = await cockpitPack(); } catch (error) {
      setOverlay([h("div", { class: "t-title-m c-white", text: "Cockpit content not published" }),
        h("div", { class: "t-body-s c-sec", text: "The cockpit-plates pack has not been published to this site yet." })], "warn");
      throw error;
    }
    const variantPack = variantPackFor(pack, variant);
    if (disposed) return null;
    renderer = createCockpitRenderer(host, { variant: variant, variantPack: variantPack, interactive: Boolean(options.interactive) });
    try {
      const images = await cockpitImages(variantPack, function (fraction) { if (bar) bar.style.width = Math.max(6, Math.round(fraction * 100)) + "%"; });
      if (disposed) return null;
      renderer.setImages(images.plate, images.atlas);
      setOverlay(null);
    } catch (error) {
      const status = error && error.status;
      if (status === 401 || status === 403) { clearCockpitImageCache(); resetCockpitCaches(); }
      setOverlay([
        h("div", { class: "t-title-m c-white", text: status === 404 ? "Cockpit imagery not published" : status === 401 || status === 403 ? "Session expired" : "Cockpit imagery unavailable" }),
        h("div", { class: "t-body-s c-sec", text: status === 404
          ? "The cockpit plate and sprite atlas have not been uploaded to the protected media store yet."
          : status === 401 || status === 403
            ? "Your web-access session is no longer valid. Cached cockpit imagery has been cleared — sign in again to continue."
            : "Could not load the protected cockpit imagery (" + ((error && error.message) || "unknown error") + ")." })
      ], status === 404 ? "warn" : "error");
      throw error;
    }
    return { renderer: renderer, variantPack: variantPack };
  })();
  ready.catch(function () { /* surfaced in the overlay */ });

  const onUnmount = function () { api.dispose(); };
  document.addEventListener("dhc6:view-unmount", onUnmount, { once: true });

  const api = {
    root: root,
    variant: variant,
    ready: ready,
    renderer: function () { return renderer; },
    setVisualState: function (vs) { if (renderer) renderer.setVisualState(vs); },
    setHighlight: function (ids, primary) { if (renderer) renderer.setHighlight(ids, primary); },
    setScrim: function (phase) { if (renderer) renderer.setScrim(phase); },
    dispose: function () {
      if (disposed) return;
      disposed = true;
      document.removeEventListener("dhc6:view-unmount", onUnmount);
      if (renderer) { renderer.dispose(); renderer = null; }
    }
  };
  return api;
}

export function disclaimer() {
  return h("p", { class: "t-body-s c-ter mt-10", text: "Training support only. This cockpit is a study aid and does not replace the approved AFM, QRH, MEL, company manuals, approved checklists or regulatory/operator documentation." });
}

export { notice };
