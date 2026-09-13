/*
  Knowledge → Systems (2D).

  systemsHome   ports AircraftSystemsHomeScreen.kt
  systemDetail  ports SystemDetailScreen.kt, in Android's card order:
                  action bubbles → BundledSystemReferenceCard (From AFM/FCTM)
                  → SystemStudyNotesCard (Study focus)
                  → SystemDetailReferenceImagesCard (Bundled 2D references)
                  → Interactive2dDiagramViewer → lane row → knowledge units

  Everything authored comes from the protected `systems-2d` pack; the reference
  imagery comes from R2 through /api/media behind the subscriber/owner session.
*/
import { h, Content, currentVariant, variantLabel, tileUrl } from "../core.js";
import { screen, blueCard, bubble, libraryDivider, tile, statusPill, emptyState, contentUnavailable, searchField, selectableChip } from "../ui.js";
import { loadProtectedImageUrl } from "../cockpit.js";
import * as S from "../logic/systems2d.js";

const state = { query: "", detail: {} };

async function loadPack() { return Content.pack("systems-2d"); }

const DISCLAIMER = "Training support only. Not a replacement for the approved AFM, QRH, MEL, company manuals, approved checklists or regulatory/operator documentation.";

/* ------------------------------------------------------------------ home */

export async function systemsHome(ctx) {
  ctx.setTopbar({ title: "Aircraft Systems", subtitle: "2D diagrams · system notes", back: "#/knowledge/home" });
  let pack;
  try {
    pack = await loadPack();
  } catch (error) {
    if (error && (error.status === 401 || error.status === 403)) throw error;
    return screen({ title: "Aircraft Systems" }, [contentUnavailable("systems-2d", error)]);
  }

  const variant = currentVariant();
  const header = [
    bubble("dark", "Back", { href: "#/knowledge/home" }),
    bubble("light", variantLabel(variant), {}),
    bubble("light", "Open Technical Lab", { href: "#/systems/lab" })
  ];

  const grid = h("div", { class: "tile-grid" });
  const countLine = h("div", { class: "t-body-s c-ter mt-6" });

  function render() {
    const matches = S.searchSystems(pack, state.query);
    countLine.textContent = matches.length === pack.order.length
      ? pack.order.length + " systems"
      : matches.length + " of " + pack.order.length + " systems";
    grid.replaceChildren.apply(grid, matches.length ? matches.map(function (system) {
      const status = S.systemStatus(pack, system);
      return tile({ class: "system-tile", art: S.tileArtFor(system), href: S.systemHref(system.key), status: status }, [
        h("div", { class: "t-title-m w-bold clamp-1", text: system.title }),
        h("div", { class: "t-body-s clamp-2", style: "color:rgba(255,255,255,.88)", text: system.hint }),
        h("div", { class: "t-label-s mt-auto", style: "color:rgba(255,255,255,.92)", text: S.systemSummaryLine(pack, system) })
      ]);
    }) : [emptyState("No system matches “" + state.query + "”.")]);
  }

  const search = searchField("Search systems…", state.query, function (value) { state.query = value; render(); }, "Search aircraft systems");
  render();

  const intro = h("p", { class: "t-body-m c-sec", text: "Tap a system tile. This Systems area is for 2D diagrams, reference images and the bundled AFM/FCTM notes. 3D models live in Technical Lab." });

  /* The search field is built once and only `grid` re-renders, so the caret is
     never lost and withSearchFocus is not needed here. */
  return screen({ library: true, header: header, title: "Aircraft Systems" }, [
    intro,
    h("div", { class: "mt-10" }, [search]),
    countLine,
    h("div", { class: "mt-4" }),
    libraryDivider(),
    h("div", { class: "mt-10" }),
    grid,
    h("p", { class: "t-body-s c-ter mt-12", text: DISCLAIMER })
  ]);
}

/* ---------------------------------------------------------------- detail */

export async function systemDetail(ctx) {
  const key = String(ctx.params.key || "").toUpperCase();
  let pack;
  try {
    pack = await loadPack();
  } catch (error) {
    if (error && (error.status === 401 || error.status === 403)) throw error;
    return screen({ title: "System" }, [contentUnavailable("systems-2d", error)]);
  }

  const system = S.systemByKey(pack, key);
  if (!system) { ctx.navigate("/systems/home", true); return h("div"); }

  const variant = currentVariant();
  ctx.setTopbar({ title: system.title, subtitle: variantLabel(variant) + " · systems", back: "#/systems/home" });

  const s = state.detail[system.key] || (state.detail[system.key] = { referencePath: null, pinId: null, visited: [] });
  const references = S.resolvedReferences(system);
  const unresolved = S.unresolvedReferences(system);
  const description = S.descriptionFor(pack, system);
  if (!s.referencePath && references.length) s.referencePath = references[0].mediaPath;

  const header = [
    bubble("dark", "Back", { href: "#/systems/home" }),
    bubble("light", variantLabel(variant), {}),
    bubble("light", "Technical Lab", { href: "#/systems/lab" })
  ];

  const actionRow = h("div", { class: "row gap-8 wrap scroll-x" }, [
    bubble("light", "QRH", { href: S.qrhHref() }),
    bubble("light", "Flashcards", { href: "#/study/srs" }),
    bubble("light", "Procedures", { href: "#/systems" }),
    bubble("light", "Cockpit State", { href: "#/live/procedures" }),
    bubble("dark", "Quiz", { href: S.quizHref(system, variant) })
  ]);

  return screen({ library: true, header: header, title: system.title }, [
    h("p", { class: "t-body-m c-sec", text: system.overview }),
    h("div", { class: "mt-10" }, [actionRow]),
    h("div", { class: "mt-10" }),
    description ? bundledReferenceCard(description) : null,
    !description ? blueCard([
      h("div", { class: "t-label-l w-bold c-white", text: "From AFM / FCTM" }),
      h("p", { class: "t-body-m c-white mt-6", text: "No bundled reference pack is authored for " + system.title + " yet. The study focus below and any diagrams still apply." }),
      h("div", { class: "mt-8" }, statusPill("later"))
    ]) : null,
    studyNotesCard(pack, system, references[0] || null),
    references.length ? referenceImagesCard(pack, system, s, references, diagramImagePath(system)) : null,
    unresolved.length ? missingReferencesCard(system, unresolved) : null,
    diagramCard(pack, system, s),
    laneRow(),
    h("p", { class: "t-body-s c-ter mt-12", text: DISCLAIMER })
  ].filter(Boolean));
}

/* ---------------------------------------------- BundledSystemReferenceCard */

function listBlock(title, items, render, limit, moreText) {
  if (!items.length) return null;
  const shown = items.slice(0, limit);
  const nodes = [h("div", { class: "t-label-s w-semi c-white mt-8", text: title })];
  shown.forEach(function (item) { nodes.push(h("p", { class: "t-body-s c-white mt-4", text: "• " + render(item) })); });
  if (items.length > limit && moreText) nodes.push(h("p", { class: "t-body-s w-semi c-white mt-4", text: "+ " + (items.length - limit) + " " + moreText }));
  return h("div", {}, nodes);
}

/* A control's switch positions are authored either as plain strings or as
   { label, behaviour } pairs; both are shown as written. */
function controlsBlock(controls) {
  if (!controls.length) return null;
  const nodes = [h("div", { class: "t-label-s w-semi c-white mt-8", text: "Controls" })];
  controls.slice(0, 6).forEach(function (control) {
    const positions = S.controlPositions(control);
    nodes.push(h("p", { class: "t-body-s c-white mt-4", text: "• " + S.controlLabel(control) + ": " + (control.description || "") }));
    if (control.location) nodes.push(h("p", { class: "t-body-s c-ter", text: "   " + control.location }));
    if (positions.length) {
      nodes.push(h("p", { class: "t-body-s c-ter", text: "   " + positions.map(function (p) { return p.behaviour ? p.label + " — " + p.behaviour : p.label; }).join(" · ") }));
    }
  });
  if (controls.length > 6) nodes.push(h("p", { class: "t-body-s w-semi c-white mt-4", text: "+ " + (controls.length - 6) + " more controls in this bundled reference pack" }));
  return h("div", {}, nodes);
}

/* regulatoryStatus separates an AFM-approved number from operator guidance, and
   is shown only where the pack states it. */
function limitsBlock(limits) {
  if (!limits.length) return null;
  const nodes = [h("div", { class: "t-label-s w-semi c-white mt-8", text: "Limits" })];
  limits.slice(0, 6).forEach(function (limit) {
    const status = S.regulatoryLabel(limit);
    nodes.push(h("p", { class: "t-body-s c-white mt-4" }, [
      document.createTextNode("• " + S.formatLimitLine(limit) + " "),
      status ? h("span", { class: "badge reg-" + String(limit.regulatoryStatus).toLowerCase(), text: status }) : null
    ].filter(Boolean)));
  });
  if (limits.length > 6) nodes.push(h("p", { class: "t-body-s w-semi c-white mt-4", text: "+ " + (limits.length - 6) + " more limits in this bundled reference pack" }));
  return h("div", {}, nodes);
}

function bundledReferenceCard(description) {
  const chips = S.countChips(description);
  return blueCard([
    h("div", { class: "t-label-m w-semi c-white", text: "From AFM / FCTM" }),
    h("div", { class: "t-title-m w-bold c-white mt-4", text: description.systemName || "" }),
    h("p", { class: "t-body-m c-white mt-6", text: description.summary || "" }),
    chips.length ? h("p", { class: "t-body-s c-white mt-8", text: chips.join("  •  ") }) : null,
    listBlock("Components", description.components || [], function (c) { return c.name + ": " + c.description; }, 8, "more components in this bundled reference pack"),
    controlsBlock(description.controls || []),
    limitsBlock(description.limits || []),
    listBlock("Modification variants", description.modificationVariants || [], function (v) {
      return v.name + (v.serialRange ? " (" + v.serialRange + ")" : "") + ": " + v.description;
    }, 4, null),
    (description.references || []).length ? h("div", {}, [
      h("div", { class: "t-label-s w-semi c-white mt-8", text: "Sources" })
    ].concat((description.references || []).map(function (ref) {
      return h("p", { class: "t-body-s c-white mt-4", text: "• " + S.formatReferenceLine(ref) });
    }))) : null
  ].filter(Boolean));
}

/* -------------------------------------------------- SystemStudyNotesCard */

function studyNotesCard(pack, system, reference) {
  const note = S.referenceNote(pack, system, reference);
  if (!note) return null;
  const nodes = [
    h("div", { class: "t-label-l w-bold c-white", text: "Study focus" }),
    h("p", { class: "t-body-s c-white mt-6", text: note.description }),
    h("p", { class: "t-body-s c-white mt-6", text: "Normal operation: " + note.howToUse }),
    h("p", { class: "t-body-s w-semi c-white mt-6", text: "Failure cues / cockpit consequence: " + note.whyImportant })
  ];
  (note.studyFocus || []).slice(0, 4).forEach(function (focus) {
    nodes.push(h("p", { class: "t-body-s c-white mt-6", text: "• " + focus }));
  });
  if (note.oralExamCue) nodes.push(h("p", { class: "t-body-s w-semi c-white mt-6", text: "Oral exam cue: " + note.oralExamCue }));
  return blueCard(nodes);
}

/* ------------------------------------------ SystemDetailReferenceImagesCard */

/*
  A protected poster: fetched through /api/media, shown as an <img> so the pins
  above it can be real focusable buttons. `onReady` reports the natural size so
  the diagram can place pins on the contain-fitted rect.
*/
function protectedImage(mediaPath, alt, onReady) {
  /* Not loading="lazy": the bytes are already fetched by loadProtectedImageUrl,
     and a lazy <img> below the fold never fires `load`, so the diagram's pins
     would have no natural size to position against on a phone. */
  const img = h("img", { class: "system-poster", alt: alt, decoding: "async" });
  const host = h("div", { class: "system-poster-host" }, [img, h("div", { class: "system-poster-status t-body-s", text: "Loading diagram…" })]);
  const status = host.lastChild;
  loadProtectedImageUrl(mediaPath).then(function (url) {
    img.addEventListener("load", function () {
      status.remove();
      host.classList.add("ready");
      if (onReady) onReady(img);
    }, { once: true });
    img.addEventListener("error", function () { status.textContent = "This diagram could not be decoded."; }, { once: true });
    img.src = url;
  }, function (error) {
    if (error && (error.status === 401 || error.status === 403)) status.textContent = "Session expired — sign in again to load protected diagrams.";
    else if (error && error.status === 404) status.textContent = "This diagram has not been published to the media bucket yet.";
    else status.textContent = "This diagram is unavailable right now.";
  });
  return { root: host, img: img };
}

/* The image the diagram card below will render full size, if any, so the
   reference card does not show the same drawing a second time. */
function diagramImagePath(system) {
  const diagram = S.diagramFor(system);
  return diagram.image && (diagram.mode === "interactive" || diagram.mode === "static") ? diagram.image.mediaPath : null;
}

function referenceImagesCard(pack, system, s, references, pinnedPath) {
  const body = h("div", { class: "stack-8 mt-8" });

  function render() {
    const focused = references.find(function (r) { return r.mediaPath === s.referencePath; }) || references[0];
    s.referencePath = focused.mediaPath;
    const note = S.referenceNote(pack, system, focused);
    /* The interactive diagram below already renders the pinned drawing full
       size; showing it twice on one screen just pushes the pins off-screen. */
    const isPinned = pinnedPath && focused.mediaPath === pinnedPath;
    const image = isPinned ? null : protectedImage(focused.mediaPath, focused.label + " — " + system.title + " reference diagram");
    body.replaceChildren.apply(body, [
      references.length > 1 ? h("div", { class: "row gap-8 wrap" }, references.map(function (ref) {
        return selectableChip(ref.label, ref.mediaPath === focused.mediaPath, function () { s.referencePath = ref.mediaPath; render(); });
      })) : null,
      h("div", { class: "t-title-s w-bold c-white", text: focused.label }),
      image ? image.root : h("p", { class: "t-body-s c-ter", text: "Shown full size in the diagram card below." }),
      h("p", { class: "t-body-s c-white", text: "How to use it: " + ((note && note.howToUse) || "") })
    ].filter(Boolean));
  }
  render();

  return blueCard([
    h("div", { class: "t-label-l w-bold c-white", text: "Bundled 2D references" }),
    h("div", { class: "t-body-s c-white mt-4", text: references.length + " reference " + (references.length === 1 ? "image" : "images") + " for " + system.title + "." }),
    body
  ]);
}

function missingReferencesCard(system, unresolved) {
  return blueCard([
    h("div", { class: "row gap-8 wrap", style: "align-items:center;justify-content:space-between" }, [
      h("div", { class: "t-label-l w-bold c-white", text: "Reference images not in the source repository" }),
      statusPill("blocked")
    ]),
    h("p", { class: "t-body-s c-white mt-6", text: "The Android app asks for " + unresolved.length + " " + (unresolved.length === 1 ? "image" : "images") + " for " + system.title + " that " + (unresolved.length === 1 ? "does" : "do") + " not exist in the repository, so " + (unresolved.length === 1 ? "it is" : "they are") + " blank there too. Nothing has been substituted." })
  ].concat(unresolved.map(function (ref) {
    return h("p", { class: "t-body-s c-ter mt-4", text: "• " + ref.label + " — " + ref.androidPath });
  })));
}

/* ------------------------------------------- Interactive2dDiagramViewer */

function pinDetailCard(pin, index, total) {
  return h("div", { class: "blue-card flat mt-10 stack-6" }, [
    h("div", { class: "row gap-8", style: "align-items:baseline;justify-content:space-between" }, [
      h("div", { class: "t-title-s w-bold c-white", text: pin.label }),
      h("span", { class: "t-label-s c-white", text: index + 1 + " / " + total })
    ]),
    h("p", { class: "t-body-s c-white", text: pin.keyFact }),
    h("p", { class: "t-body-s w-semi c-white", text: "Why it matters: " + pin.consequence }),
    h("p", { class: "t-body-s c-white", text: "Study prompt: " + pin.studyPrompt })
  ]);
}

function diagramCard(pack, system, s) {
  const diagram = S.diagramFor(system);
  if (diagram.mode === "none") return null;
  const pins = diagram.pins;
  if (!s.pinId && pins.length) s.pinId = pins[0].id;
  if (pins.length && s.visited.indexOf(s.pinId) === -1) s.visited.push(s.pinId);

  /* No image resolves: the authored pin text is still worth reading, so it is
     listed rather than painted onto an empty rectangle. */
  if (diagram.mode === "list") {
    const list = h("div", { class: "stack-8 mt-8" });
    function renderList() {
      list.replaceChildren.apply(list, pins.map(function (pin, i) {
        const open = pin.id === s.pinId;
        return h("div", { class: "pin-row" + (open ? " open" : "") }, [
          h("button", {
            class: "pin-row-head", type: "button", "aria-expanded": open ? "true" : "false",
            onclick: function () { s.pinId = open ? null : pin.id; if (!open && s.visited.indexOf(pin.id) === -1) s.visited.push(pin.id); renderList(); }
          }, [
            h("span", { class: "lab-pin-num", text: String(i + 1) }),
            h("span", { class: "grow t-body-m w-semi c-white", text: pin.label }),
            h("span", { class: "t-body-m c-white", text: open ? "−" : "+" })
          ]),
          open ? h("div", { class: "pin-row-body stack-6" }, [
            h("p", { class: "t-body-s c-white", text: pin.keyFact }),
            h("p", { class: "t-body-s w-semi c-white", text: "Why it matters: " + pin.consequence }),
            h("p", { class: "t-body-s c-white", text: "Study prompt: " + pin.studyPrompt })
          ]) : null
        ].filter(Boolean));
      }));
    }
    renderList();
    return blueCard([
      h("div", { class: "row gap-8 wrap", style: "align-items:center;justify-content:space-between" }, [
        h("div", { class: "t-label-l w-bold c-white", text: "Component study cards" }),
        statusPill("partial")
      ]),
      h("p", { class: "t-body-s c-white mt-6", text: pins.length + " components are authored for " + system.title + ", but the diagram they were pinned to is not in the source repository. The notes are shown as cards until an approved drawing is supplied." }),
      list
    ]);
  }

  if (diagram.mode === "static") {
    const image = protectedImage(diagram.image.mediaPath, diagram.image.label + " — " + system.title);
    return blueCard([
      h("div", { class: "t-label-l w-bold c-white", text: "2D Reference Diagram" }),
      h("div", { class: "t-title-s w-semi c-white mt-4", text: diagram.image.label }),
      h("p", { class: "t-body-s c-white mt-6", text: "No interactive pins are authored for this 2D diagram yet. The reference image remains available so the system section never appears empty." }),
      h("div", { class: "mt-8" }, [image.root])
    ]);
  }

  /* interactive */
  const layer = h("div", { class: "diagram-pins" });
  const stage = h("div", { class: "diagram-stage" });
  const detail = h("div", {});
  let imgEl = null;

  function placePins() {
    if (!imgEl || !imgEl.naturalWidth) return;
    const rect = S.fittedImageRect(imgEl.naturalWidth, imgEl.naturalHeight, imgEl.clientWidth, imgEl.clientHeight);
    Array.prototype.forEach.call(layer.children, function (node, i) {
      const pos = S.pinPosition(pins[i], rect);
      node.style.left = pos.left + "px";
      node.style.top = pos.top + "px";
    });
  }

  function renderPins() {
    layer.replaceChildren.apply(layer, pins.map(function (pin, i) {
      const active = pin.id === s.pinId;
      return h("button", {
        class: "diagram-pin" + (active ? " active" : "") + (s.visited.indexOf(pin.id) !== -1 ? " visited" : ""),
        type: "button", "aria-pressed": active ? "true" : "false", "aria-label": pin.label,
        title: pin.label,
        onclick: function () { select(pin.id); }
      }, [h("span", { text: String(i + 1) })]);
    }));
    placePins();
  }

  function select(id) {
    s.pinId = id;
    if (s.visited.indexOf(id) === -1) s.visited.push(id);
    renderPins();
    renderDetail();
  }

  function renderDetail() {
    const index = pins.findIndex(function (p) { return p.id === s.pinId; });
    const pin = pins[index === -1 ? 0 : index];
    detail.replaceChildren.apply(detail, [
      h("div", { class: "row gap-8 wrap mt-8" }, pins.map(function (p) {
        return selectableChip(p.label, p.id === s.pinId, function () { select(p.id); });
      })),
      pinDetailCard(pin, index === -1 ? 0 : index, pins.length),
      h("div", { class: "row gap-8 mt-8" }, [
        h("button", { class: "btn outlined small", type: "button", text: "Previous", onclick: function () { select(S.nextPin(pins, s.pinId, -1).id); } }),
        h("button", { class: "btn outlined small", type: "button", text: "Next", onclick: function () { select(S.nextPin(pins, s.pinId, 1).id); } }),
        h("span", { class: "t-body-s c-ter", style: "align-self:center", text: s.visited.length + " of " + pins.length + " visited" })
      ])
    ]);
  }

  const image = protectedImage(diagram.image.mediaPath, diagram.image.label + " — " + system.title + " interactive diagram", function (el) {
    imgEl = el;
    placePins();
  });
  stage.replaceChildren(image.root, layer);
  renderPins();
  renderDetail();

  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(function () { placePins(); });
    observer.observe(stage);
    document.addEventListener("dhc6:view-unmount", function () { observer.disconnect(); }, { once: true });
  } else {
    const onResize = function () { placePins(); };
    window.addEventListener("resize", onResize);
    document.addEventListener("dhc6:view-unmount", function () { window.removeEventListener("resize", onResize); }, { once: true });
  }

  return blueCard([
    h("div", { class: "t-label-l w-bold c-white", text: "Interactive 2D Diagram" }),
    h("div", { class: "t-title-s w-semi c-white mt-4", text: diagram.image.label }),
    h("p", { class: "t-body-s c-white mt-6", text: "Tap a numbered pin, or use the component chips. Each pin carries the key fact, the cockpit consequence and an oral-exam prompt." }),
    h("div", { class: "mt-8" }, [stage]),
    detail
  ]);
}

/* --------------------------------------------------------------- lanes */

/*
  Android's lane row filters Room-backed knowledge units the user imported on
  the device. The browser edition has no import pipeline, so the lane is shown
  with its real count and the same message Android uses when a lane is empty.
*/
function laneRow() {
  return h("div", { class: "stack-8 mt-10" }, [
    h("div", { class: "row gap-8 wrap" }, [bubble("dark", "Published", { count: 0 })]),
    libraryDivider(),
    blueCard([
      h("p", { class: "t-body-m c-white", text: "No imported or user-authored cards in this lane. Bundled 2D reference content is shown above." }),
      h("p", { class: "t-body-s c-white mt-6", text: "Importing source documents runs the on-device extraction pipeline and is not part of the browser edition." })
    ])
  ]);
}
