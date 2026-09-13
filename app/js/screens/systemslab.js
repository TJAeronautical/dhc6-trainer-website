/*
  Technical Lab — ports of SystemsLabHomeScreen.kt (aircraft explorer + My Notes)
  and SystemsLabDetailScreen.kt / SystemsLabSection.kt (controls + readout,
  3D model card with pins, fault mode, selected-part card, action cards).

  Content: protected pack `systems-lab` (parts, faults, simulation templates and
  the GLB registry). Models: /api/media/models/systems-lab/<file> (R2).
*/
import { h, Store, Content, currentVariant, variantLabel, navigate } from "../core.js";
import { screen, blueCard, bubble, libraryDivider, selectableChip, notice, emptyState, contentUnavailable, statusPill } from "../ui.js";
import { modelById, modelsForSystem, pinsForModel, clipGroupsForModel, formatBytes, labSimulation, powerLeverLabel, propLeverLabel, qrhTargetHref, noteStorageKey, initialLevers, AUTO_LOAD_LIMIT } from "../logic/systemslab.js";
import { createLabViewer, fetchMedia, webglSupported } from "../lab3d.js";

const NOTES_KEY = "dhc6.systemsLabNotes";
const labState = { lane: "AIRCRAFT", detail: {} };

function notes() { try { return JSON.parse(window.localStorage.getItem(NOTES_KEY) || "{}") || {}; } catch (error) { return {}; } }
function saveNotes(map) { try { window.localStorage.setItem(NOTES_KEY, JSON.stringify(map)); } catch (error) { /* ignore */ } }
function noteFor(system, partId) { return (notes()[noteStorageKey(system, partId)] || "").trim(); }
function setNote(system, partId, value) { const map = notes(); const key = noteStorageKey(system, partId); if (value && value.trim()) map[key] = value; else delete map[key]; saveNotes(map); }

async function loadPack() {
  return Content.pack("systems-lab");
}

function mediaPublished(model) {
  if (!Content.mediaIndex || !Content.mediaIndex.published) return null; // unknown
  return (Content.mediaIndex.items || []).some(function (i) { return i.path === model.mediaPath; });
}

function modelStatusPill(model) {
  const published = mediaPublished(model);
  if (published === true) return h("span", { class: "pill info", text: formatBytes(model.bytes) });
  if (published === false) return h("span", { class: "pill later", text: "Model not published" });
  return h("span", { class: "pill info", text: formatBytes(model.bytes) });
}

/* ------------------------------------------------------------- viewer card */
/*
  Shared model card: chips for the models of a system, the 3D canvas with a
  loading overlay, toolbar and animation controls. Returns { root, setModel,
  viewer(), highlight(selectors) }.
*/
function modelCard(opts) {
  const models = opts.models;
  let current = models[0] || null;
  let viewer = null;
  let loadedId = null;
  let loading = false;
  const canvasHost = h("div", { class: "lab-canvas-host", style: opts.tall ? "height:min(62vh,560px)" : "" });
  const overlay = h("div", { class: "lab-overlay" });
  const stage = h("div", { class: "lab-stage" }, [canvasHost, overlay]);
  const chipRow = h("div", { class: "row gap-8 wrap" });
  const toolbar = h("div", { class: "row gap-8 wrap mt-8" });
  const animRow = h("div", { class: "lab-anim mt-8", hidden: true });
  const meta = h("div", { class: "t-body-s c-ter mt-6" });
  const root = h("div", { class: "stack-8" }, [chipRow, stage, toolbar, animRow, meta]);
  let isolate = false; let archive = false; let rotate = false; let wire = false;
  let clipGroups = []; let activeGroup = null; let scrubTimer = null;

  function setOverlay(nodes, cls) {
    overlay.className = "lab-overlay" + (cls ? " " + cls : "");
    overlay.replaceChildren.apply(overlay, [].concat(nodes || []));
    overlay.hidden = !nodes || !nodes.length;
  }

  function renderChips() {
    chipRow.replaceChildren.apply(chipRow, models.length > 1 ? models.map(function (m) {
      return selectableChip(m.shortTitle || m.title, current && current.id === m.id, function () { setModel(m); });
    }) : []);
  }

  function renderToolbar() {
    const items = [];
    if (viewer && loadedId) {
      items.push(h("button", { class: "btn outlined small", type: "button", text: "Reset view", onclick: function () { viewer.resetView(); } }));
      items.push(h("button", { class: "btn outlined small" + (rotate ? " selected" : ""), type: "button", "aria-pressed": rotate ? "true" : "false", text: "Auto-rotate", onclick: function () { rotate = !rotate; viewer.setAutoRotate(rotate); renderToolbar(); } }));
      items.push(h("button", { class: "btn outlined small" + (isolate ? " selected" : ""), type: "button", "aria-pressed": isolate ? "true" : "false", text: "Isolate pin", onclick: function () { isolate = !isolate; viewer.setIsolate(isolate); renderToolbar(); } }));
      items.push(h("button", { class: "btn outlined small" + (wire ? " selected" : ""), type: "button", "aria-pressed": wire ? "true" : "false", text: "Wireframe", onclick: function () { wire = !wire; viewer.setWireframe(wire); renderToolbar(); } }));
      if (viewer.hasArchived()) items.push(h("button", { class: "btn outlined small" + (archive ? " selected" : ""), type: "button", "aria-pressed": archive ? "true" : "false", text: archive ? "Hide reference / archived parts" : "Show reference / archived parts", onclick: function () { archive = !archive; viewer.setArchiveVisible(archive); renderToolbar(); } }));
    }
    toolbar.replaceChildren.apply(toolbar, items);
  }

  function renderAnim() {
    if (!viewer || !clipGroups.length) { animRow.hidden = true; animRow.replaceChildren(); return; }
    animRow.hidden = false;
    const chips = h("div", { class: "row gap-8 wrap" }, clipGroups.map(function (g) {
      return selectableChip(g.label, activeGroup === g, function () {
        if (activeGroup === g) { activeGroup = null; viewer.stopClips(); }
        else { activeGroup = g; viewer.playClips(g.clips, true); }
        renderAnim();
      });
    }));
    const nodes = [h("div", { class: "t-label-l w-bold c-87", text: "Animations" }), chips];
    if (activeGroup) {
      const playBtn = h("button", { class: "btn outlined small", type: "button", text: viewer.isPlaying() ? "Pause" : "Play", onclick: function () { viewer.pauseClips(viewer.isPlaying()); playBtn.textContent = viewer.isPlaying() ? "Pause" : "Play"; } });
      const slider = h("input", { type: "range", class: "slider", min: 0, max: 1000, step: 1, value: 0, "aria-label": "Animation position" });
      slider.addEventListener("input", function () { viewer.scrubClips(Number(slider.value) / 1000); playBtn.textContent = "Play"; });
      clearInterval(scrubTimer);
      scrubTimer = setInterval(function () {
        if (!viewer || !activeGroup) { clearInterval(scrubTimer); return; }
        if (viewer.isPlaying()) { const d = viewer.clipDuration() || 1; slider.value = String(Math.round((viewer.clipTime() % d) / d * 1000)); }
      }, 120);
      nodes.push(h("div", { class: "row gap-8 mt-6" }, [playBtn, slider]));
    }
    animRow.replaceChildren.apply(animRow, nodes);
  }

  async function ensureViewer() {
    if (viewer) return viewer;
    viewer = await createLabViewer(canvasHost, { ariaLabel: opts.ariaLabel || "3D model", yawDeg: opts.yawDeg, pitchDeg: opts.pitchDeg });
    if (opts.onPick) viewer.onPick(opts.onPick);
    if (opts.onFrame) viewer.onFrame(function () { opts.onFrame(viewer); });
    document.addEventListener("dhc6:view-unmount", function () { if (viewer) { viewer.dispose(); viewer = null; } clearInterval(scrubTimer); }, { once: true });
    return viewer;
  }

  async function load(model, force) {
    if (loading) return;
    if (!webglSupported()) { setOverlay([h("p", { text: "WebGL is not available in this browser, so the 3D model cannot be displayed." })], "error"); return; }
    const published = mediaPublished(model);
    if (published === false) {
      setOverlay([h("p", { class: "w-bold", text: model.title }), h("p", { text: "This model has not been published to the site's protected media store yet (" + formatBytes(model.bytes) + "). Owner: run tools/build-media.mjs and upload-media.ps1." })], "warn");
      return;
    }
    if (!force && model.bytes > AUTO_LOAD_LIMIT) {
      setOverlay([
        h("p", { class: "w-bold", text: model.title }),
        h("p", { text: formatBytes(model.bytes) + " download. Wi-Fi recommended; the model is kept in this browser until you sign out." }),
        h("button", { class: "btn primary", type: "button", text: "Load " + formatBytes(model.bytes) + " model", onclick: function () { load(model, true); } })
      ], "prompt");
      return;
    }
    loading = true;
    const bar = h("div", { class: "lab-progress" }, h("div", { class: "lab-progress-fill", style: "width:0%" }));
    const label = h("p", { text: "Downloading " + model.title + "…" });
    setOverlay([label, bar], "loading");
    try {
      const buffer = await fetchMedia(model.mediaPath, model.sha256, function (loaded, total, cached) {
        const pct = total ? Math.round(loaded / total * 100) : 0;
        bar.firstChild.style.width = pct + "%";
        label.textContent = cached ? "Loading from this browser's cache…" : "Downloading " + model.title + " · " + formatBytes(loaded) + (total ? " of " + formatBytes(total) : "") + "…";
      });
      label.textContent = "Preparing " + model.title + "…";
      const v = await ensureViewer();
      const info = await v.loadModel(buffer, model);
      loadedId = model.id;
      clipGroups = clipGroupsForModel(model, info.clips);
      activeGroup = null;
      isolate = false; archive = false;
      setOverlay(null);
      meta.textContent = model.title + " · " + info.meshes + " meshes · " + Math.round(info.triangles).toLocaleString() + " triangles" + (info.clips.length ? " · " + info.clips.length + " animation clip" + (info.clips.length === 1 ? "" : "s") : "") + " · " + model.description;
      renderToolbar();
      renderAnim();
      if (opts.onLoaded) opts.onLoaded(model, v);
    } catch (error) {
      if (error && (error.status === 401 || error.status === 403)) { if (window.DHC6Session) window.DHC6Session.verify().catch(function () {}); return; }
      const message = error && error.status === 404 ? "This model has not been published to the protected media store yet (owner: tools/build-media.mjs → upload-media.ps1 → kv bulk put)." : "Unable to load the model (" + (error && error.message ? error.message : "unknown error") + ").";
      setOverlay([h("p", { class: "w-bold", text: model.title }), h("p", { text: message }), h("button", { class: "btn outlined small", type: "button", text: "Retry", onclick: function () { load(model, true); } })], "error");
    } finally {
      loading = false;
    }
  }

  function setModel(model) {
    current = model;
    renderChips();
    if (opts.onModelChange) opts.onModelChange(model);
    load(model, false);
  }

  renderChips();
  if (current) load(current, false);
  return {
    root: root,
    current: function () { return current; },
    viewer: function () { return viewer; },
    highlight: function (selectors) { if (viewer && loadedId) viewer.setHighlight(selectors || []); },
    setModel: setModel
  };
}

/* ---------------------------------------------------------------- home */
export async function systemsLabHome(ctx) {
  ctx.setTopbar({ title: "Systems Lab", subtitle: "Technical Lab · 3D models", back: "#/dashboard" });
  let pack;
  try { pack = await loadPack(); } catch (error) { if (error && (error.status === 401 || error.status === 403)) throw error; return screen({ library: true, header: [bubble("dark", "Back", { href: "#/dashboard" })], title: "Systems Lab" }, [contentUnavailable("systems-lab", error)]); }
  const variant = currentVariant();
  const explorer = pack.explorer || { explorerSystems: [], internalSystems: [], hotspots: [] };
  const noteRows = [];
  const map = notes();
  (pack.labSystems || []).forEach(function (system) {
    (pack.systems[system].parts || []).forEach(function (part) {
      const note = (map[noteStorageKey(system, part.id)] || "").trim();
      if (note) noteRows.push({ system: system, partId: part.id, partLabel: part.label, note: note });
    });
  });

  function header() {
    const aircraftCount = explorer.explorerSystems.length;
    return [
      bubble("dark", "Back", { href: "#/dashboard" }),
      bubble("light", variantLabel(variant).toUpperCase(), { onClick: function () {} }),
      labState.lane === "NOTES"
        ? bubble("light", "Aircraft", { count: aircraftCount, onClick: function () { labState.lane = "AIRCRAFT"; ctx.rerender(); } })
        : bubble("dark", "Aircraft", { count: aircraftCount, onClick: function () {} }),
      labState.lane === "NOTES"
        ? bubble("dark", "My Notes", { count: noteRows.length, onClick: function () {} })
        : bubble("light", "My Notes", { count: noteRows.length, onClick: function () { labState.lane = "NOTES"; ctx.rerender(); } })
    ];
  }

  if (labState.lane === "NOTES") {
    return screen({ library: true, header: header(), title: "Systems Lab" }, [
      noteRows.length ? h("div", { class: "stack-8" }, noteRows.map(function (row) {
        return blueCard([
          h("div", { class: "t-title-m w-bold c-white", text: pack.systems[row.system].shortTitle }),
          h("div", { class: "t-title-s c-white mt-6", text: row.partLabel }),
          h("p", { class: "t-body-m c-white mt-6 clamp-4", text: row.note }),
          h("div", { class: "row gap-8 wrap mt-10" }, [
            bubble("light", "Open System", { href: "#/systems/lab/" + row.system }),
            bubble("dark", "Delete Note", { onClick: function () { setNote(row.system, row.partId, ""); ctx.rerender(); } })
          ])
        ]);
      })) : blueCard([h("div", { class: "t-title-m w-bold c-white", text: "No system notes yet" }), h("p", { class: "t-body-m c-white mt-6", text: "Open a system, select a component, and add a study note." })])
    ]);
  }

  /* AIRCRAFT lane — full aircraft explorer with hotspots + internal-system chips */
  const heroModel = (pack.registry.models || []).find(function (m) { return m.explorer; }) || modelById(pack, "aircraft-wheels");
  const hotspotLayer = h("div", { class: "lab-hotspots" });
  const hotspotButtons = explorer.hotspots.map(function (spot) {
    const btn = h("button", { class: "lab-hotspot", type: "button", text: spot.label, "aria-label": spot.label + " — open " + pack.systems[spot.system].shortTitle, onclick: function () { navigate("/systems/lab/" + spot.system); } });
    btn.hidden = true;
    hotspotLayer.appendChild(btn);
    return { spot: spot, btn: btn };
  });
  let card = null;
  if (heroModel) {
    card = modelCard({
      models: [heroModel], tall: true, ariaLabel: "DHC-6 Series 300 aircraft explorer", yawDeg: 140, pitchDeg: 16,
      onFrame: function (viewer) {
        hotspotButtons.forEach(function (entry) {
          const p = viewer.projectFraction(entry.spot.fx, entry.spot.fy, entry.spot.fz);
          if (!p) { entry.btn.hidden = true; return; }
          entry.btn.hidden = false;
          entry.btn.style.left = p.x + "px";
          entry.btn.style.top = p.y + "px";
        });
      }
    });
    card.root.querySelector(".lab-stage").appendChild(hotspotLayer);
    card.root.querySelector(".lab-stage").appendChild(h("div", { class: "lab-explorer-badge" }, [h("div", { class: "t-label-m w-bold", text: "FULL AIRCRAFT EXPLORER" }), h("div", { class: "t-body-s", text: "Tap a highlighted part • drag to orbit" })]));
  }

  const internalChips = h("div", { class: "row gap-8 wrap mt-10" }, explorer.internalSystems.map(function (system) {
    return bubble("dark", pack.systems[system].shortTitle, { href: "#/systems/lab/" + system });
  }));

  const grid = h("div", { class: "grid-2 wide-4 mt-10" }, (pack.labSystems || []).map(function (system) {
    const def = pack.systems[system];
    const models = modelsForSystem(pack, system);
    const primary = models[0];
    return h("a", { class: "lab-system-card", href: "#/systems/lab/" + system }, [
      h("div", { class: "t-title-s w-bold c-white clamp-2", text: def.shortTitle }),
      h("div", { class: "t-body-s clamp-2", style: "color:rgba(255,255,255,.8)", text: primary ? primary.title : "Model not in the reference library" }),
      h("div", { class: "row gap-6 wrap mt-6" }, [
        primary ? modelStatusPill(primary) : h("span", { class: "pill blocked", text: "Blocked" }),
        models.length > 1 ? h("span", { class: "pill info", text: "+" + (models.length - 1) + " more" }) : null,
        h("span", { class: "pill info", text: def.parts.length + " pins" })
      ])
    ]);
  }));
  const extras = (pack.extraSystems || []).filter(function (s) { return !(pack.labSystems || []).includes(s) && s !== "AIRCRAFT_GENERAL" && s !== "STANDARD_AIRFRAME_PRACTICES" && s !== "OPERATIONS_TECHNIQUES"; });
  const extraRow = extras.length ? blueCard([
    h("div", { class: "t-title-m w-bold c-white", text: "Component replicas" }),
    h("p", { class: "t-body-s c-white mt-6", text: "Additional reference-library models grouped under their system." }),
    h("div", { class: "row gap-8 wrap mt-10" }, extras.map(function (system) { return bubble("light", pack.systems[system].shortTitle, { href: "#/systems/lab/" + system }); }))
  ]) : null;

  return screen({ library: true, header: header(), title: "Systems Lab" }, [
    card ? card.root : notice("The aircraft explorer model is not in the registry.", "warn"),
    internalChips,
    h("div", { class: "mt-4" }), libraryDivider(),
    h("div", { class: "t-title-m w-bold c-white mt-10", text: "All systems" }),
    grid,
    extraRow ? h("div", { class: "mt-10" }, extraRow) : null,
    h("p", { class: "t-body-s c-ter mt-10", text: "Training visualisation only. Models are supplied replicas and training-grade context models; they are not maintenance data and do not replace the approved AFM, QRH, MEL or maintenance manuals." })
  ]);
}

/* -------------------------------------------------------------- detail */
export async function systemsLabDetail(ctx) {
  const system = ctx.params.system;
  ctx.setTopbar({ title: "Technical Lab", subtitle: "Systems Lab", back: "#/systems/lab" });
  let pack;
  try { pack = await loadPack(); } catch (error) { if (error && (error.status === 401 || error.status === 403)) throw error; return screen({ library: true, header: [bubble("dark", "Back", { href: "#/systems/lab" })], title: "Technical Lab" }, [contentUnavailable("systems-lab", error)]); }
  const def = pack.systems[system];
  if (!def) return screen({ library: true, header: [bubble("dark", "Back", { href: "#/systems/lab" })], title: "Technical Lab" }, [emptyState("Unknown system: " + system)]);
  const models = modelsForSystem(pack, system);
  const variant = currentVariant();
  const s = labState.detail[system] || (labState.detail[system] = {
    partId: def.parts.length ? def.parts[0].id : null, visited: def.parts.length ? [def.parts[0].id] : [],
    power: initialLevers(pack, system).power, prop: initialLevers(pack, system).prop, fuelOn: true,
    faultMode: false, faultId: def.faults.length ? def.faults[0].id : "", noteOpen: false, modelId: models.length ? models[0].id : null
  });

  const header = [
    bubble("dark", "Back", { href: "#/systems/lab" }),
    bubble("light", variantLabel(variant).toUpperCase(), { onClick: function () {} }),
    bubble("light", def.shortTitle, { count: def.parts.length, onClick: function () {} })
  ];
  const intro = h("p", { class: "t-body-m c-white clamp-4", text: system === "LANDING_GEAR_WHEELS"
    ? "Complete landing-gear trainer: authentic Series 300 architecture, external 3D context, hydraulic-pressure logic, steering/brake operation, abnormal landing scenarios and flight-crew inspection boundaries."
    : "3D model workspace only: built/exploded viewing, component highlights, numbered part pins, fault states and expanded visual review. PNG references and written system notes stay in Knowledge > Systems." });

  if (!def.parts.length) {
    return screen({ library: true, header: header, title: "Technical Lab" }, [intro, libraryDivider(), blueCard([h("div", { class: "t-label-l w-bold c-white", text: "Technical Lab" }), h("p", { class: "t-body-m c-white mt-6", text: "No interactive pins are authored for " + def.displayTitle + " yet." })])]);
  }

  const container = h("div", { class: "stack-12" });
  let card = null;

  function selectedPart() {
    const authored = def.parts.find(function (p) { return p.id === s.partId; });
    if (authored) return authored;
    const pin = pins().find(function (p) { return p.id === s.partId; });
    if (pin) return { id: pin.id, label: pin.label, notePrompt: "What do you want to remember about " + pin.label + "?", keyFact: "Model group from the GLB file — no authored training note for this group.", consequence: "Refer to the approved manuals for operating consequences.", synthetic: true };
    return def.parts[0];
  }
  function selectedFault() { if (!s.faultMode) return null; return def.faults.find(function (f) { return f.id === s.faultId; }) || def.faults[0] || null; }
  function currentModel() { return modelById(pack, s.modelId) || models[0] || null; }
  function pins() { return pinsForModel(pack, system, currentModel()); }
  function activePin() { return pins().find(function (p) { return p.id === s.partId; }) || null; }
  function simulation() { return labSimulation(pack, system, s.power, s.prop, s.fuelOn, selectedFault()); }

  function applyHighlight() {
    if (!card) return;
    const pin = activePin();
    card.highlight(pin ? pin.selectors : []);
  }

  function renderAll() {
    const sim = simulation();
    const part = selectedPart();
    const fault = selectedFault();
    const note = noteFor(system, part.id);
    container.replaceChildren.apply(container, [
      /* Technical Lab summary card */
      blueCard([
        h("div", { class: "t-label-l w-bold c-white", text: "Technical Lab" }),
        h("div", { class: "t-title-m w-bold c-white mt-6 clamp-2", text: def.objectTitle }),
        h("p", { class: "t-body-m c-white mt-6 clamp-4", text: def.subtitle }),
        h("div", { class: "t-body-s w-semi c-white mt-6", text: s.visited.length + " / " + def.parts.length + " pins explored this session" })
      ]),
      /* Live controls + readout (not for AIR_CONDITIONING, as in Android) */
      system !== "AIR_CONDITIONING" ? controlDeck(sim) : null,
      /* 3D model card with pins */
      viewerCard(),
      def.variantLine ? blueCard([
        h("div", { class: "t-title-s w-bold c-white", text: "Model-linked content" }),
        h("p", { class: "t-body-s c-white mt-6", text: def.variantLine }),
        h("p", { class: "t-body-s c-white mt-6", text: "Selected focus: " + part.label + " — " + part.keyFact })
      ]) : null,
      /* Selected pin quick card + note */
      blueCard([
        h("div", { class: "row gap-8", style: "align-items:flex-start" }, [
          h("div", { class: "grow" }, [
            h("div", { class: "t-title-s w-bold c-white", text: "Selected pin: " + part.label }),
            h("p", { class: "t-body-s c-white mt-4 clamp-4", text: part.keyFact })
          ]),
          bubble("light", note ? "Edit note" : "+ Add note", { onClick: function () { s.noteOpen = !s.noteOpen; renderAll(); } })
        ]),
        h("p", { class: "t-body-s c-white mt-6", text: "Cockpit consequence: " + part.consequence }),
        s.noteOpen ? noteEditor(part) : h("p", { class: "t-body-s c-white mt-6 clamp-4", text: note ? "My note: " + note : "My note: none yet. Tap + Add note to save a memory hook, limitation, cockpit cue or QRH link." })
      ], { class: "flat" }),
      /* Fault mode */
      def.faults.length ? faultCard(sim, fault) : null,
      /* Selected part detail */
      blueCard([
        h("div", { class: "t-title-m w-bold c-white", text: part.label }),
        h("p", { class: "t-body-m c-white mt-6", text: part.keyFact }),
        h("p", { class: "t-body-s c-white mt-6", text: "Cockpit consequence: " + part.consequence }),
        h("div", { class: "blue-card flat mt-10" }, [h("div", { class: "t-label-l w-bold c-white", text: "Drill cue" }), h("p", { class: "t-body-s c-white mt-4", text: def.drillPrompt })]),
        h("div", { class: "blue-card flat mt-10" }, [h("div", { class: "t-label-l w-bold c-white", text: "Training bridge" }), h("p", { class: "t-body-s c-white mt-4 pre-line", text: def.trainingBridge || pack.trainingBridgeDefault })])
      ]),
      /* Action cards */
      blueCard([
        h("div", { class: "t-title-s w-bold c-white", text: "Action cards" }),
        h("div", { class: "t-body-m w-semi c-white mt-6", text: "Focus: " + (fault ? fault.title : part.label) }),
        h("p", { class: "t-body-s c-white mt-6", text: fault ? sim.qrhBridge : "Use this part card as the bridge from system knowledge to the QRH, flashcards, procedures and quiz practice." }),
        h("div", { class: "row gap-8 wrap mt-10" }, [
          bubble("light", fault ? "Go to QRH →" : "Open QRH", { href: qrhTargetHref(system, fault) }),
          bubble("light", "Flashcards", { href: "#/study/srs" }),
          bubble("light", "Procedures", { href: "#/systems" }),
          bubble("dark", "Quiz " + def.displayTitle, { href: "#/quizzes" })
        ])
      ])
    ].filter(Boolean));
    applyHighlight();
  }

  function noteEditor(part) {
    const area = h("textarea", { class: "lab-note", rows: 5, placeholder: "Add your memory hook, limitation, cockpit cue, or QRH note for this component…", "aria-label": "Study note for " + part.label });
    area.value = noteFor(system, part.id);
    return h("div", { class: "stack-8 mt-8" }, [
      h("div", { class: "t-body-s c-white", text: "Note: " + part.notePrompt }),
      area,
      h("div", { class: "row gap-8 wrap" }, [
        h("button", { class: "btn primary small", type: "button", text: "Done", onclick: function () { setNote(system, part.id, area.value); s.noteOpen = false; renderAll(); ctx.toast("Note saved"); } }),
        noteFor(system, part.id) ? h("button", { class: "btn outlined small", type: "button", text: "Clear", onclick: function () { setNote(system, part.id, ""); s.noteOpen = false; renderAll(); } }) : null
      ])
    ]);
  }

  function readoutChip(label, value) { return h("div", { class: "readout-chip" }, [h("div", { class: "t-label-s w-bold c-white", text: label }), h("div", { class: "t-body-m w-bold c-white", text: value })]); }

  function controlDeck(sim) {
    const powerSlider = h("input", { type: "range", class: "slider", min: 0, max: 1, step: 0.2, value: s.power, "aria-label": "Power lever" });
    const propSlider = h("input", { type: "range", class: "slider", min: 0, max: 1, step: 0.5, value: s.prop, "aria-label": "Prop lever" });
    powerSlider.addEventListener("input", function () { s.power = Number(powerSlider.value); renderAll(); });
    propSlider.addEventListener("input", function () { s.prop = Number(propSlider.value); renderAll(); });
    const fuelSwitch = h("button", { class: "switch", type: "button", role: "switch", "aria-checked": s.fuelOn ? "true" : "false", "aria-label": "Fuel lever", onclick: function () { s.fuelOn = !s.fuelOn; renderAll(); } });
    return blueCard([
      h("div", { class: "t-label-l w-bold c-white", text: "Live controls + readout" }),
      h("div", { class: "t-body-m w-semi c-white mt-6", text: "Power lever: " + powerLeverLabel(s.power) }),
      powerSlider,
      h("div", { class: "row between t-label-s c-white" }, ["REV", "IDLE", "DESC", "CRUISE", "CLIMB", "MAX"].map(function (l) { return h("span", { text: l }); })),
      h("div", { class: "t-body-m w-semi c-white mt-10", text: "Prop lever: " + propLeverLabel(s.prop) }),
      propSlider,
      h("div", { class: "row between t-label-s c-white" }, ["FEATHER", "COARSE", "FINE"].map(function (l) { return h("span", { text: l }); })),
      h("div", { class: "row gap-8 mt-10", style: "align-items:center" }, [
        h("div", { class: "grow" }, [h("div", { class: "t-body-m w-semi c-white", text: "Fuel lever: " + (s.fuelOn ? "ON" : "OFF") }), h("div", { class: "t-body-s c-white", text: "Fuel stays as ON / OFF for state editing." })]),
        fuelSwitch
      ]),
      h("div", { class: "blue-card flat mt-10" }, [
        h("div", { class: "t-label-l w-bold c-white", text: "Live readout" }),
        h("div", { class: "row gap-8 mt-6 scroll-x" }, [readoutChip("NG", sim.ng + "%"), readoutChip("NP", sim.np + "%"), readoutChip("TQ", sim.torque + " PSI"), readoutChip("T5", sim.itt + "°C"), readoutChip("FF", sim.fuelFlow + " lb/hr")]),
        h("p", { class: "t-body-s c-white mt-6", text: sim.observedResult })
      ])
    ]);
  }

  function faultCard(sim, fault) {
    const sw = h("button", { class: "switch", type: "button", role: "switch", "aria-checked": s.faultMode ? "true" : "false", "aria-label": "Fault mode", onclick: function () { s.faultMode = !s.faultMode; renderAll(); } });
    const selected = fault || def.faults[0];
    return blueCard([
      h("div", { class: "row gap-8", style: "align-items:center" }, [
        h("div", { class: "grow" }, [
          h("div", { class: "t-title-s w-bold c-white", text: "Fault mode" }),
          h("div", { class: "t-body-s c-white clamp-2", text: s.faultMode ? "Active training fault: " + selected.title : "Normal system response. Turn on for abnormal-cue practice." })
        ]),
        sw
      ]),
      s.faultMode ? h("div", { class: "row gap-8 wrap mt-10" }, def.faults.map(function (f) {
        return bubble(f.id === selected.id ? "dark" : "light", f.title, { onClick: function () { s.faultId = f.id; renderAll(); } });
      })) : null,
      s.faultMode ? h("div", { class: "blue-card flat mt-10 stack-6" }, [
        h("div", { class: "t-label-l w-bold c-white", text: "Fault simulation card" }),
        h("p", { class: "t-body-s c-white", text: "Setup: " + selected.setup }),
        h("p", { class: "t-body-s c-white", text: "Evidence status: " + selected.evidenceStatus }),
        h("p", { class: "t-body-s c-white", text: "Indication: " + sim.indication }),
        h("p", { class: "t-body-s c-white", text: "Cause logic: " + sim.likelyCause }),
        h("p", { class: "t-body-s c-white", text: "Immediate action: " + sim.immediateAction }),
        h("p", { class: "t-body-s c-white", text: "QRH bridge: " + sim.qrhBridge })
      ]) : null
    ]);
  }

  let viewerHost = null;
  function viewerCard() {
    if (!models.length) {
      return blueCard([
        h("div", { class: "t-label-l w-bold c-white", text: "3D model" }),
        h("p", { class: "t-body-m c-white mt-6", text: "No model for " + def.displayTitle + " is in the DHC6 reference library or the Android bundle yet." }),
        h("div", { class: "mt-6" }, statusPill("blocked"))
      ]);
    }
    if (!card) {
      card = modelCard({
        models: models, ariaLabel: def.objectTitle + " 3D model",
        onPick: function (hit) {
          if (!hit) return;
          const match = pins().find(function (p) { return p.selectors.length && card.viewer().matchesSelectors(hit.nodeName, hit.chain, p.selectors); });
          if (match) { s.partId = match.id; if (s.visited.indexOf(match.id) === -1) s.visited.push(match.id); ctx.toast(match.label + " — " + hit.nodeName); renderAll(); }
          else ctx.toast("Node: " + hit.nodeName);
        },
        onModelChange: function (model) { s.modelId = model.id; renderAll(); },
        onLoaded: function () { applyHighlight(); }
      });
      if (s.modelId && card.current() && card.current().id !== s.modelId) { const m = modelById(pack, s.modelId); if (m) card.setModel(m); }
      viewerHost = h("div", {}, card.root);
    }
    const pinRow = h("div", { class: "lab-pins mt-8" }, pins().map(function (pin) {
      const active = pin.id === s.partId;
      return h("button", { class: "lab-pin" + (active ? " active" : "") + (pin.mapped ? "" : " unmapped") + (pin.authored ? "" : " extra"), type: "button", "aria-pressed": active ? "true" : "false",
        title: pin.mapped ? pin.label : pin.label + " (not modelled in this file)", onclick: function () { s.partId = pin.id; if (s.visited.indexOf(pin.id) === -1) s.visited.push(pin.id); renderAll(); } }, [
        h("span", { class: "lab-pin-num", text: String(pin.number) }),
        h("span", { class: "lab-pin-label", text: pin.label })
      ]);
    }));
    const activeP = activePin();
    return blueCard([
      h("div", { class: "row gap-8 wrap", style: "align-items:center;justify-content:space-between" }, [
        h("div", { class: "t-label-l w-bold c-white", text: "3D model" }),
        currentModel() ? modelStatusPill(currentModel()) : null
      ]),
      viewerHost,
      pinRow,
      activeP && !activeP.mapped ? h("p", { class: "t-body-s c-ter mt-6", text: "“" + activeP.label + "” has no matching node in " + (currentModel() ? currentModel().shortTitle : "this model") + "; the pin text still applies." }) : null,
      activeP && !activeP.authored ? h("p", { class: "t-body-s c-ter mt-6", text: "Model group only — no authored training note for this pin." }) : null
    ]);
  }

  renderAll();
  return screen({ library: true, header: header, title: "Technical Lab" }, [intro, h("div", { class: "mt-4" }), libraryDivider(), h("div", { class: "mt-4" }), container]);
}
