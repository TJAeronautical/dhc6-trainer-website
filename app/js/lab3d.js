/*
  Technical Lab 3D viewer — browser counterpart of SystemsLab3dViewer.kt.

  - Loads GLB models from the protected media API (/api/media/<path>) with a
    progress readout, and keeps a copy in the Cache API store "dhc6-media-v1"
    keyed by the media index hash. subscriber-gate.js deletes every /api/
    cache entry on sign-out or entitlement lapse.
  - three.js (app/vendor/three-lab.js) is imported on demand so the app shell
    never pays for it.
  - Highlight / dim semantics follow the Android renderer: the selected pin's
    meshes glow, everything else is dimmed; isolate hides the rest.
*/

import { selectorMatches, chainMatches } from "./logic/systemslab.js";

const MEDIA_CACHE = "dhc6-media-v1";
let threePromise = null;

export function loadThree() {
  if (!threePromise) threePromise = import("/app/vendor/three-lab.js");
  return threePromise;
}

export function webglSupported() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(window.WebGLRenderingContext && (canvas.getContext("webgl2") || canvas.getContext("webgl")));
  } catch (error) {
    return false;
  }
}

/* -------------------------------------------------------------- media */
async function cachedModel(url, sha) {
  if (!("caches" in window)) return null;
  try {
    const cache = await window.caches.open(MEDIA_CACHE);
    const hit = await cache.match(url);
    if (!hit) return null;
    if (sha && hit.headers.get("X-Media-Sha256") !== sha) { await cache.delete(url); return null; }
    return hit.arrayBuffer();
  } catch (error) {
    return null;
  }
}

async function storeModel(url, buffer, sha, etag) {
  if (!("caches" in window)) return;
  try {
    const cache = await window.caches.open(MEDIA_CACHE);
    const headers = { "Content-Type": "model/gltf-binary", "X-Media-Sha256": sha || "", "X-Media-ETag": etag || "", "Cache-Control": "private, no-store" };
    await cache.put(url, new Response(buffer, { headers: headers }));
  } catch (error) { /* best effort */ }
}

export async function clearMediaCache() {
  if (!("caches" in window)) return;
  try { await window.caches.delete(MEDIA_CACHE); } catch (error) { /* ignore */ }
}

/*
  Download a protected media object. onProgress(loaded, total).
  Throws { status } on 401/403 (session) and { status:404 } when unpublished.
*/
export async function fetchMedia(mediaPath, sha, onProgress) {
  const url = "/api/media/" + mediaPath.split("/").map(encodeURIComponent).join("/");
  const cached = await cachedModel(url, sha);
  if (cached) { if (onProgress) onProgress(cached.byteLength, cached.byteLength, true); return cached; }
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
  if (response.status === 401 || response.status === 403) { const e = new Error("session_invalid"); e.status = response.status; throw e; }
  if (response.status === 404) { const e = new Error("media_not_published"); e.status = 404; throw e; }
  if (!response.ok) { const e = new Error("media_unavailable"); e.status = response.status; throw e; }
  const total = Number(response.headers.get("Content-Length") || 0);
  const etag = response.headers.get("ETag") || "";
  let buffer;
  if (response.body && response.body.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    while (true) {
      const step = await reader.read();
      if (step.done) break;
      chunks.push(step.value);
      loaded += step.value.byteLength;
      if (onProgress) onProgress(loaded, total, false);
    }
    const out = new Uint8Array(loaded);
    let offset = 0;
    chunks.forEach(function (chunk) { out.set(chunk, offset); offset += chunk.byteLength; });
    buffer = out.buffer;
  } else {
    buffer = await response.arrayBuffer();
    if (onProgress) onProgress(buffer.byteLength, buffer.byteLength, false);
  }
  await storeModel(url, buffer, sha, etag);
  return buffer;
}

/* --------------------------------------------------------------- viewer */
export async function createLabViewer(container, options) {
  const opts = options || {};
  const T = await loadThree();
  const THREE = T.THREE;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.className = "lab-canvas";
  renderer.domElement.setAttribute("aria-label", opts.ariaLabel || "3D model");
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(opts.background || 0x08131f);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new T.RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 1.15;
  scene.add(new THREE.HemisphereLight(0xdfe9f5, 0x0b1a2a, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(3, 5, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xbcd7ff, 0.5);
  fill.position.set(-4, 2, -3);
  scene.add(fill);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 5000);
  const controls = new T.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true;
  controls.autoRotateSpeed = 1.2;

  const state = {
    root: null, meshes: [], mixer: null, actions: [], clock: new THREE.Clock(), playing: false,
    disposed: false, bounds: null, hiddenSelectors: [], archiveVisible: false, isolate: false,
    highlightSelectors: [], pickHandlers: [], frameHandlers: [], activeClips: [], wireframe: false
  };
  const highlightEmissive = new THREE.Color(opts.highlightColor || 0x3fb6ff);

  function resize() {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(function () { resize(); requestRender(); }) : null;
  if (observer) observer.observe(container); else window.addEventListener("resize", resize);
  resize();

  /* Render on demand: only when the camera moved (controls), an animation is
     playing, auto-rotate is on, or something requested a frame. Keeps phones
     cool and software-GL test runners responsive. */
  let needsRender = true;
  function requestRender() { needsRender = true; }
  controls.addEventListener("change", requestRender);
  function frame() {
    if (state.disposed) return;
    requestAnimationFrame(frame);
    const dt = state.clock.getDelta();
    const moved = controls.update();
    if (state.mixer && state.playing) { state.mixer.update(dt); needsRender = true; }
    if (!needsRender && !moved && !controls.autoRotate) return;
    needsRender = false;
    renderer.render(scene, camera);
    state.frameHandlers.forEach(function (fn) { fn(); });
  }
  requestAnimationFrame(frame);

  /* ---- picking (tap without drag) */
  const raycaster = new THREE.Raycaster();
  let downAt = null;
  renderer.domElement.addEventListener("pointerdown", function (e) { downAt = { x: e.clientX, y: e.clientY, t: Date.now() }; });
  renderer.domElement.addEventListener("pointerup", function (e) {
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    const quick = Date.now() - downAt.t < 600;
    downAt = null;
    if (moved > 6 || !quick || !state.root) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const visible = state.meshes.filter(function (m) { return m.mesh.visible && m.parentVisible(); });
    const hits = raycaster.intersectObjects(visible.map(function (m) { return m.mesh; }), false);
    if (!hits.length) { state.pickHandlers.forEach(function (fn) { fn(null); }); return; }
    const entry = state.meshes.find(function (m) { return m.mesh === hits[0].object; });
    state.pickHandlers.forEach(function (fn) { fn(entry ? { nodeName: entry.name, chain: entry.chain, point: hits[0].point } : null); });
  });

  function disposeModel() {
    if (!state.root) return;
    state.actions.forEach(function (a) { a.stop(); });
    if (state.mixer) state.mixer.stopAllAction();
    scene.remove(state.root);
    state.root.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      mats.forEach(function (m) {
        Object.keys(m).forEach(function (k) { if (m[k] && m[k].isTexture) m[k].dispose(); });
        m.dispose();
      });
    });
    state.meshes.forEach(function (m) { m.originals.forEach(function (mat) { mat.dispose(); }); });
    state.root = null; state.meshes = []; state.mixer = null; state.actions = []; state.activeClips = []; state.playing = false;
  }

  function fitCamera(fraction) {
    if (!state.root) return;
    const box = new THREE.Box3();
    const meshBoxes = [];
    let any = false;
    state.meshes.forEach(function (m) {
      if (!m.mesh.visible || !m.parentVisible()) return;
      m.mesh.updateWorldMatrix(true, false);
      const b = new THREE.Box3().setFromObject(m.mesh);
      if (!isFinite(b.min.x) || !isFinite(b.max.x)) return;
      box.union(b); meshBoxes.push(b); any = true;
    });
    if (!any) { box.setFromObject(state.root); meshBoxes.push(box); }
    state.bounds = box;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;
    const yaw = (opts.yawDeg !== undefined ? opts.yawDeg : 35) * Math.PI / 180;
    const pitch = (opts.pitchDeg !== undefined ? opts.pitchDeg : 18) * Math.PI / 180;
    const dir = new THREE.Vector3(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw));
    let dist = (radius / Math.sin((camera.fov * Math.PI / 180) / 2)) * (fraction || 1.0);
    controls.target.copy(center);
    // Tighten the sphere fit to the projected corners of the bounding box
    // (two passes are enough): the model should fill ~86% of the viewport.
    // Per-mesh boxes approximate the silhouette far better than the one big box.
    const corners = [];
    meshBoxes.slice(0, 2000).forEach(function (b) {
      for (let i = 0; i < 8; i += 1) corners.push(new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z));
    });
    for (let pass = 0; pass < 2; pass += 1) {
      camera.position.copy(center).addScaledVector(dir, dist);
      camera.near = Math.max(0.001, dist / 500);
      camera.far = dist * 50;
      camera.updateProjectionMatrix();
      camera.lookAt(center);
      let ext = 0;
      corners.forEach(function (c) { const p = c.clone().project(camera); ext = Math.max(ext, Math.abs(p.x), Math.abs(p.y)); });
      if (ext > 0) dist *= ext / 0.86;
    }
    camera.position.copy(center).addScaledVector(dir, dist);
    camera.near = Math.max(0.001, dist / 500);
    camera.far = dist * 50;
    camera.updateProjectionMatrix();
    controls.minDistance = radius * 0.05;
    controls.maxDistance = dist * 8;
    controls.update();
  }

  function applyVisibility() {
    state.meshes.forEach(function (m) {
      const archived = chainMatches(state.hiddenSelectors, m.chain);
      const selected = state.highlightSelectors.length ? chainMatches(state.highlightSelectors, m.chain) : true;
      m.mesh.visible = (!archived || state.archiveVisible) && (!state.isolate || !state.highlightSelectors.length || selected);
    });
  }

  function applyMaterials() {
    const hasSelection = state.highlightSelectors.length > 0;
    state.meshes.forEach(function (m) {
      const selected = hasSelection && chainMatches(state.highlightSelectors, m.chain);
      m.mesh.material = m.mesh.material; // keep reference
      const mats = Array.isArray(m.mesh.material) ? m.mesh.material : [m.mesh.material];
      mats.forEach(function (mat, i) {
        const original = m.originals[i];
        if (!original) return;
        if (!hasSelection || state.isolate) {
          mat.emissive && mat.emissive.copy(original.emissive || new THREE.Color(0));
          if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity = original.emissiveIntensity !== undefined ? original.emissiveIntensity : 1;
          mat.opacity = original.opacity;
          mat.transparent = original.transparent;
          mat.depthWrite = original.depthWrite;
        } else if (selected) {
          if (mat.emissive) { mat.emissive.copy(highlightEmissive); mat.emissiveIntensity = 1.1; }
          mat.opacity = Math.max(original.opacity, 0.92);
          mat.transparent = original.transparent;
          mat.depthWrite = true;
        } else {
          if (mat.emissive) { mat.emissive.copy(original.emissive || new THREE.Color(0)); mat.emissiveIntensity = original.emissiveIntensity !== undefined ? original.emissiveIntensity : 1; }
          mat.transparent = true;
          mat.opacity = Math.min(original.opacity, 0.14);
          mat.depthWrite = false;
        }
        mat.wireframe = state.wireframe;
      });
    });
  }

  const api = {
    THREE: THREE,
    renderer: renderer, scene: scene, camera: camera, controls: controls,

    async loadModel(buffer, model) {
      disposeModel();
      const loader = new T.GLTFLoader();
      const gltf = await new Promise(function (resolve, reject) { loader.parse(buffer, "", resolve, reject); });
      const root = gltf.scene || gltf.scenes[0];
      state.root = root;
      state.hiddenSelectors = (model && model.hidden) || [];
      state.highlightSelectors = [];
      state.isolate = false;
      root.traverse(function (o) {
        if (!o.isMesh) return;
        const chain = [];
        let p = o;
        while (p && p !== root) { if (p.name) chain.push(p.name); p = p.parent; }
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const cloned = mats.map(function (mat) { return mat.clone(); });
        o.material = Array.isArray(o.material) ? cloned : cloned[0];
        const originals = cloned.map(function (mat) { return { emissive: mat.emissive ? mat.emissive.clone() : null, emissiveIntensity: mat.emissiveIntensity, opacity: mat.opacity, transparent: mat.transparent, depthWrite: mat.depthWrite, dispose: function () {} }; });
        o.frustumCulled = true;
        state.meshes.push({ mesh: o, name: o.name || (o.parent && o.parent.name) || "", chain: chain, originals: originals, parentVisible: function () { let q = o.parent; while (q && q !== root) { if (!q.visible) return false; q = q.parent; } return true; } });
      });
      scene.add(root);
      state.mixer = gltf.animations && gltf.animations.length ? new THREE.AnimationMixer(root) : null;
      state.clips = gltf.animations || [];
      applyVisibility();
      applyMaterials();
      fitCamera();
      requestRender();
      return { clips: state.clips.map(function (c) { return c.name; }), meshes: state.meshes.length, triangles: state.meshes.reduce(function (n, m) { const g = m.mesh.geometry; return n + (g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0)) / 3; }, 0) };
    },

    setHighlight(selectors) { state.highlightSelectors = selectors || []; applyVisibility(); applyMaterials(); requestRender(); },
    setIsolate(on) { state.isolate = Boolean(on); applyVisibility(); applyMaterials(); requestRender(); },
    setArchiveVisible(on) { state.archiveVisible = Boolean(on); applyVisibility(); applyMaterials(); requestRender(); },
    setWireframe(on) { state.wireframe = Boolean(on); applyMaterials(); requestRender(); },
    setAutoRotate(on) { controls.autoRotate = Boolean(on); requestRender(); },
    resetView() { fitCamera(); requestRender(); },
    requestRender: requestRender,
    hasArchived() { return state.meshes.some(function (m) { return chainMatches(state.hiddenSelectors, m.chain); }); },
    nodeNames() { return state.meshes.map(function (m) { return m.name; }); },

    /* animation groups: array of clip names to play together */
    playClips(names, loop) {
      state.actions.forEach(function (a) { a.stop(); });
      state.actions = [];
      state.activeClips = [];
      if (!state.mixer) return;
      (names || []).forEach(function (name) {
        const clip = state.clips.find(function (c) { return c.name === name; });
        if (!clip) return;
        const action = state.mixer.clipAction(clip);
        action.reset();
        action.setLoop(loop === false ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
        action.clampWhenFinished = true;
        action.play();
        state.actions.push(action);
        state.activeClips.push(clip);
      });
      state.playing = state.actions.length > 0;
      requestRender();
    },
    pauseClips(paused) { state.playing = !paused && state.actions.length > 0; requestRender(); },
    isPlaying() { return state.playing; },
    clipDuration() { return state.activeClips.reduce(function (d, c) { return Math.max(d, c.duration); }, 0); },
    clipTime() { return state.actions.length ? state.actions[0].time : 0; },
    scrubClips(fraction) {
      state.playing = false;
      state.actions.forEach(function (a) { a.paused = false; a.time = Math.max(0, Math.min(a.getClip().duration, fraction * a.getClip().duration)); });
      if (state.mixer) state.mixer.update(0);
      requestRender();
    },
    stopClips() { state.actions.forEach(function (a) { a.stop(); }); state.actions = []; state.activeClips = []; state.playing = false; requestRender(); },

    /* fraction (0..1 per axis of the bounding box) → CSS pixel position or null when behind the camera */
    projectFraction(fx, fy, fz) {
      if (!state.bounds) return null;
      const min = state.bounds.min; const max = state.bounds.max;
      const p = new THREE.Vector3(min.x + (max.x - min.x) * fx, min.y + (max.y - min.y) * fy, min.z + (max.z - min.z) * fz);
      const v = p.clone().project(camera);
      if (v.z > 1) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      return { x: (v.x + 1) / 2 * rect.width, y: (1 - v.y) / 2 * rect.height, depth: v.z };
    },
    onPick(fn) { state.pickHandlers.push(fn); },
    onFrame(fn) { state.frameHandlers.push(fn); },
    matchesSelectors(nodeName, chain, selectors) { return chainMatches(selectors, chain && chain.length ? chain : [nodeName]); },
    selectorMatches: selectorMatches,

    dispose() {
      if (state.disposed) return;
      state.disposed = true;
      disposeModel();
      if (observer) observer.disconnect(); else window.removeEventListener("resize", resize);
      controls.dispose();
      pmrem.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
  };
  if (opts.debug || (typeof window !== "undefined" && window.location.search.indexOf("labdebug") !== -1)) window.__labViewer = api;
  return api;
}
