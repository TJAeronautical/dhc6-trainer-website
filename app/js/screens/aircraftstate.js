/*
  AIRCRAFT tab — ports of feature-cockpit ui/screens/
    CockpitHomeScreen.kt            -> cockpitHome        (#/live)
    ScenarioProceduresScreen.kt     -> scenarioProcedures (#/live/procedures)
    ScenarioSelectorScreen.kt       -> scenarioSelector   (#/scenario/select/:id)
    ScenarioStateScreen.kt          -> scenarioState      (#/scenario/state/:id/:phase)
    FrozenSnapshotScreen.kt         -> frozenSnapshot     (#/scenario/focus/:id/:phase)
*/
import { h, Store, Content, currentVariant, variantLabel, navigate, feature } from "../core.js";
import { screen, blueCard, tile, bubble, backBubble, selectableChip, searchField, statusPill, notice, emptyState, contentUnavailable, withSearchFocus, primaryButton, outlinedButton } from "../ui.js";
import { openEditStateSheet, canEditScenarioState } from "./scenarioedit.js";
import { CONTEXTS, contextByRouteKey, scenarioItems, scenarioMetaFor, allowedContextsFor, scenarioEntryRoute, scenarioTileArt, cleanScenarioProcedureTitle, CONTEXT_PRESETS } from "../logic/cockpit/scenarios.js";
import { PHASES, buildScenarioBundle, snapshotVisualState, phaseSummaryText, summaryLines, regionsFor, displayFocusTarget, visibleControls } from "../logic/cockpit/snapshot.js";
import { snapshotRegistry, bindingsIndex, cockpitSurface, cockpitPack, variantPackFor, disclaimer } from "./cockpitcommon.js";
import { displayVariant } from "../logic/cockpit/hitboxes.js";

/* --------------------------------------------------------------- helpers */
export function rememberCockpitResume(route, label, procedureId) {
  Store.set("cockpitResume", { route: route, label: label, procedureId: procedureId || null, ts: Date.now() });
}

async function procedureIndex() { return Content.pack("procedures-index"); }

function indexItemFor(index, procedureId) {
  const id = String(procedureId || "");
  return (index.items || []).find(function (i) { return i.compiledId === id || i.id === id; }) ||
    (index.items || []).find(function (i) { return String(i.compiledId || "").toUpperCase() === id.toUpperCase(); }) || null;
}

async function procedureSteps(indexItem, variant) {
  if (!indexItem) return [];
  const pack = await Content.pack(indexItem.pack);
  const proc = (pack.procedures || []).find(function (p) { return p.id === indexItem.id; });
  if (!proc) return [];
  const key = displayVariant(variant);
  const v = proc.variants[key] || proc.variants.LEGACY || proc.variants[Object.keys(proc.variants)[0]] || {};
  return { memory: v.memory || [], flow: v.flow || [], procedure: proc };
}

function phaseFromRoute(raw) {
  const u = String(raw || "").toUpperCase();
  return PHASES.indexOf(u) > -1 ? u : "BEFORE";
}

/* ------------------------------------------------ CockpitHomeScreen (#/live) */
export async function cockpitHome(ctx) {
  ctx.setTopbar({ title: "Aircraft State", subtitle: "AIRCRAFT · scenario states and cockpit" });
  const resume = Store.get("cockpitResume");
  const hasResume = Boolean(resume && resume.route);

  function entryCard(title, subtitle, art, href, status) {
    return tile({ class: "hero card-row h-150", art: art, href: href, status: status }, [
      h("div", { class: "grow stack-4" }, [
        h("div", { class: "t-title-l w-bold c-white", text: title }),
        h("div", { class: "t-body-m clamp-3", style: "color:rgba(255,255,255,.86)", text: subtitle })
      ]),
      h("span", { class: "btn small", text: "Open" })
    ]);
  }

  return screen({ ariaLabel: "Aircraft State" }, [
    blueCard([
      h("div", { class: "row between" }, [
        h("div", { class: "stack-4" }, [
          h("div", { class: "t-headline-s w-bold c-white", text: "Aircraft State" }),
          h("div", { class: "t-body-m", style: "color:rgba(255,255,255,.84)", text: "State-first workflows for free play, resumed preview, cockpit entry, and associated procedure state." })
        ]),
        h("span", { class: "variant-badge", text: currentVariant() })
      ]),
      hasResume ? h("div", { class: "t-body-s c-sec mt-8", text: "Last state: " + (resume.label || "Free Play") }) : null,
      h("div", { class: "equal-row gap-10 mt-10" }, [
        primaryButton("Open Free Play", function () { rememberCockpitResume("/live/cockpit", "Free Play"); navigate("/live/cockpit"); }, { block: true }),
        outlinedButton(hasResume ? "Resume Last State" : "No Saved State", function () {
          if (!hasResume) return;
          const route = resume.route;
          if (route.indexOf("/scenario/run/") === 0) navigate("/live/cockpit");
          else navigate(route);
        }, { block: true, disabled: !hasResume })
      ])
    ]),
    blueCard([
      h("div", { class: "t-title-m w-bold c-white", text: "State Entry" }),
      h("div", { class: "t-body-s c-sec mt-4", text: "Choose a scenario-linked MCC drill path. Use PROCS on the bottom bar for procedure drills." }),
      h("div", { class: "mt-10" }, entryCard("Scenario-linked Drills", "Pick a scenario phase, then continue into the MCC drill.", "dhc6_tile_runway_overview", "#/live/procedures"))
    ]),
    blueCard([
      h("div", { class: "t-title-m w-bold c-white", text: "Related Paths" }),
      h("div", { class: "t-body-s c-sec mt-4", text: "Use Debrief only for review and repeat actions after a run." }),
      h("div", { class: "mt-10" }, entryCard("Debrief Logbook", "Review completed attempts, recent outcomes, and repeat paths.", "dhc6_tile_apron_departure", "#/training/logbook", feature("logbook").status))
    ]),
    blueCard([
      h("div", { class: "t-title-m w-bold c-white", text: "Linked drill flow" }),
      h("div", { class: "t-body-s c-sec mt-4", text: "Use this tab for free play, resume, and scenario-linked MCC drill entry. Procedure drills stay in PROCS on the bottom bar." })
    ]),
    disclaimer()
  ]);
}

/* ------------------------------- ScenarioProceduresScreen (#/live/procedures) */
const proceduresState = { context: null, bucket: "ALL", query: "" };

export async function scenarioProcedures(ctx) {
  ctx.setTopbar({ title: "Day-to-Day Operations", subtitle: "AIRCRAFT · scenario entry", back: "#/live" });
  let index;
  try { index = await procedureIndex(); } catch (error) { return screen({ title: "Day-to-Day Operations", header: [backBubble("#/live")] }, [contentUnavailable("procedures-index", error)]); }
  const root = h("div", { class: "stack-10" });

  function header(title, subtitle) {
    return h("div", { class: "row between wrap gap-10" }, [
      h("div", { class: "grow stack-4" }, [
        h("div", { class: "t-title-l w-bold c-white clamp-1", text: title }),
        h("div", { class: "t-body-m clamp-3", style: "color:var(--white-secondary)", text: subtitle })
      ]),
      h("div", { class: "row gap-8" }, [h("span", { class: "variant-badge", text: currentVariant() }), bubble("light", "Back", { href: "#/live" })])
    ]);
  }

  function contextCard(context) {
    return tile({ class: "hero h-150 scenario-context", art: context.art, accent: context.accent, thinAccent: true, onClick: function () { proceduresState.context = context; render(); } }, [
      h("div", { class: "t-title-l w-bold c-white clamp-1", text: context.title }),
      h("div", { class: "t-body-m w-semi clamp-3", style: "color:rgba(255,255,255,.86)", text: context.shortDescription }),
      h("span", { class: "btn outlined block mt-8", text: "Open Context" })
    ]);
  }

  function procedureRow(meta) {
    const badges = [h("span", { class: "badge cat-" + meta.category.toLowerCase(), text: meta.category.charAt(0) + meta.category.slice(1).toLowerCase() }),
      h("span", { class: "badge phase", text: meta.phase })];
    if (meta.bucket) badges.push(h("span", { class: "badge bucket", text: meta.bucket }));
    if (meta.sourceSection) badges.push(h("span", { class: "badge section", text: meta.sourceSection }));
    return tile({ class: "hero h-150 scenario-row", art: scenarioTileArt(meta.title), onClick: function () { openProcedure(meta); } }, [
      h("div", { class: "t-title-l w-bold c-white clamp-2", text: meta.title }),
      h("div", { class: "t-body-m w-semi clamp-1", style: "color:var(--white-secondary)", text: meta.procedureGroup }),
      h("div", { class: "row gap-6 wrap mt-6" }, badges)
    ]);
  }

  function openProcedure(meta) {
    Store.recordRecent({ id: meta.compiledId, title: meta.title, kind: "scenario" });
    navigate(scenarioEntryRoute(meta.compiledId, meta.title, proceduresState.context).route);
  }

  function render() {
    withSearchFocus(root, function () {
      if (!proceduresState.context) {
        root.replaceChildren(
          header("Day-to-Day Operations", "Choose the operating context first. Ground, taxi, takeoff, cruise, and landing drill lists open after this step."),
          h("div", { class: "stack-12 tile-grid" }, CONTEXTS.map(contextCard)),
          disclaimer()
        );
        return;
      }
      const context = proceduresState.context;
      const visible = scenarioItems(index.items || [], context.key, proceduresState.bucket, proceduresState.query);
      const buckets = [["ALL", "All"], ["NORMAL", "Normal"], ["ABNORMAL", "Abnormal"], ["EMERGENCY", "Emergency"]];
      root.replaceChildren(
        header(context.title, "Select any drill possible for this phase. Use All / Normal / Abnormal / Emergency to narrow the list."),
        outlinedButton("Change Context", function () { proceduresState.context = null; proceduresState.query = ""; render(); }, { block: true }),
        searchField("Search " + context.title.toLowerCase() + " procedures", proceduresState.query, function (v) { proceduresState.query = v; render(); }, "Search procedures"),
        h("div", { class: "row gap-6 equal-row" }, buckets.map(function (b) {
          return selectableChip(b[1], proceduresState.bucket === b[0], function () { proceduresState.bucket = b[0]; render(); });
        })),
        visible.length
          ? h("div", { class: "stack-10 tile-grid" }, visible.map(procedureRow))
          : blueCard([h("div", { class: "t-title-m w-bold c-white", text: "No procedures found" }),
            h("div", { class: "t-body-m mt-6", style: "color:var(--white-secondary)", text: "No " + context.title.toLowerCase() + " procedure matched the current search or bucket filter." })]),
        disclaimer()
      );
    });
  }
  render();
  return screen({ ariaLabel: "Day-to-Day Operations" }, [root]);
}

/* --------------------------- ScenarioSelectorScreen (#/scenario/select/:id) */
export async function scenarioSelector(ctx) {
  const procedureId = ctx.params.id;
  ctx.setTopbar({ title: "Choose Context", subtitle: "AIRCRAFT · scenario entry", back: "#/live/procedures" });
  let index = null;
  try { index = await procedureIndex(); } catch (error) { /* title falls back to the id */ }
  const item = index ? indexItemFor(index, procedureId) : null;
  const title = item ? cleanScenarioProcedureTitle(item.displayTitle || item.title) : String(procedureId).split("/").pop();
  const contexts = allowedContextsFor(title);
  const compact = contexts.length >= 2 && contexts.length <= 4;

  function contextCard(context, recommended) {
    return tile({ class: "hero h-150 scenario-context" + (recommended ? " recommended" : ""), art: context.art, accent: context.accent, thinAccent: true,
      onClick: function () {
        Store.recordRecent({ id: procedureId, title: title, kind: "scenario" });
        navigate("/scenario/state/" + encodeURIComponent(procedureId) + "/" + context.routeKey);
      } }, [
      h("div", { class: "row gap-8 wrap" }, [
        h("div", { class: "t-title-l w-bold c-white", text: context.title }),
        recommended ? h("span", { class: "badge", text: compact ? "Fast launch" : "Recommended" }) : null
      ]),
      h("div", { class: "t-body-m clamp-3", style: "color:var(--white-secondary)", text: context.shortDescription }),
      h("span", { class: "btn outlined block mt-8", text: "Use This Context" })
    ]);
  }

  return screen({ ariaLabel: "Choose Context", header: [bubble("light", "Back", { href: "#/live/procedures" })] }, [
    blueCard([
      h("div", { class: "t-headline-s w-bold c-white", text: "Choose Context" }),
      h("div", { class: "t-title-m mt-6 clamp-2", style: "color:rgba(255,255,255,.86)", text: title || "Procedure" }),
      h("div", { class: "t-body-m mt-6", style: "color:rgba(255,255,255,.84)", text: contexts.length === 1 ? "This procedure has one likely entry context." : compact ? "Pick the closest valid context and continue." : "Choose the context that gets you into training fastest." }),
      h("div", { class: "mt-10" }, outlinedButton("Start Standalone Drill", function () {
        Store.set("lastDrillProcedureId", procedureId);
        navigate("/drill/run/" + encodeURIComponent(procedureId) + "?preset=memory");
      }, { block: true }))
    ]),
    h("div", { class: "stack-12 tile-grid" }, contexts.map(function (c, i) { return contextCard(c, i === 0); })),
    disclaimer()
  ]);
}

/* ------------------------- ScenarioStateScreen (#/scenario/state/:id/:phase) */
const stateScreenState = { phase: "BEFORE", details: false, section: "SUMMARY" };

export async function scenarioState(ctx) {
  const procedureId = ctx.params.id;
  const context = contextByRouteKey(ctx.params.phase);
  const variant = currentVariant();
  ctx.setTopbar({ title: "State Preview", subtitle: "AIRCRAFT · " + context.title, back: "#/live/procedures" });

  let bundle, index, surface, hitboxes = [], procKey = procedureId, rebuild = null;
  try {
    index = await procedureIndex();
    const item = indexItemFor(index, procedureId);
    const steps = item ? await procedureSteps(item, variant) : { memory: [], flow: [] };
    const registry = await snapshotRegistry();
    procKey = registry.resolveKey(procedureId);
    const pack = await cockpitPack();
    const variantPack = variantPackFor(pack, variant);
    hitboxes = variantPack.hitboxes;
    const bindings = await bindingsIndex(variant, hitboxes);
    const title = item ? cleanScenarioProcedureTitle(item.displayTitle || item.title) : String(procedureId).split("/").pop();
    bundle = buildScenarioBundle(registry, procedureId, title, variant, (steps.flow || []).concat(steps.memory || []), function (action) { return bindings.lookup(procedureId, action); });
    bundle.item = item;
    bundle.steps = steps;
    /* Re-resolve after an Edit State save: the registry is rebuilt with the new overrides. */
    rebuild = async function () {
      const fresh = await snapshotRegistry();
      const next = buildScenarioBundle(fresh, procedureId, title, variant, (steps.flow || []).concat(steps.memory || []), function (action) { return bindings.lookup(procedureId, action); });
      next.item = item; next.steps = steps;
      bundle = next;
    };
  } catch (error) {
    return screen({ title: "State Preview", header: [backBubble("#/live/procedures")] }, [contentUnavailable("scenario-snapshots", error)]);
  }

  if (PHASES.indexOf(stateScreenState.phase) === -1) stateScreenState.phase = "BEFORE";
  const root = h("div", { class: "stack-12" });
  surface = cockpitSurface({ variant: variant, stageClass: "cockpit-preview" });

  function applyPhase() {
    const phase = stateScreenState.phase;
    const state = bundle[phase];
    surface.ready.then(function () {
      surface.setVisualState(snapshotVisualState(state.snapshot, variant));
      surface.setScrim(phase);
    }).catch(function () { /* overlay shows the reason */ });
  }

  function editPhase(phase, state) {
    openEditStateSheet({
      procKey: procKey,
      phase: phase,
      title: bundle.title,
      variant: variant,
      phaseState: { annunciators: state.annunciators, instruments: state.instruments, controls: state.controls, notes: state.notes },
      onSaved: function () {
        if (!rebuild) return;
        rebuild().then(function () { applyPhase(); render(); }).catch(function () { /* keep the current view */ });
      }
    });
  }

  function keyValueCard(title, map) {
    const keys = Object.keys(map || {});
    return blueCard([
      h("div", { class: "t-title-m w-semi c-white", text: title }),
      keys.length
        ? h("div", { class: "stack-6 mt-8" }, keys.map(function (k) {
          return h("div", { class: "row between gap-8" }, [h("span", { class: "t-body-m c-sec grow", text: k }), h("span", { class: "t-body-m w-semi c-white", text: String(map[k]) })]);
        }))
        : h("div", { class: "t-body-m c-sec mt-8", text: "No data" })
    ]);
  }

  function render() {
    const phase = stateScreenState.phase;
    const state = bundle[phase];
    const controls = visibleControls(state.snapshot.controls);
    const focusTargets = state.focusTargets || [];
    const lines = summaryLines(state.snapshot, true);
    const detailNodes = [];
    if (stateScreenState.details) {
      detailNodes.push(h("div", { class: "row gap-8 wrap" }, ["SUMMARY", "SYSTEMS", "NOTES"].map(function (s) {
        return selectableChip(s.charAt(0) + s.slice(1).toLowerCase(), stateScreenState.section === s, function () { stateScreenState.section = s; render(); });
      })));
      if (stateScreenState.section === "SUMMARY") {
        detailNodes.push(blueCard([
          h("div", { class: "t-title-m w-semi c-white", text: "Instructor Prompt" }),
          h("div", { class: "stack-4 mt-8" }, ["What do you see?", "What does it indicate?", "What is your immediate priority?"].map(function (q) { return h("div", { class: "t-body-m c-sec", text: q }); }))
        ]));
        detailNodes.push(blueCard([
          h("div", { class: "t-title-m w-semi c-white", text: "Annunciators" }),
          state.annunciators.length
            ? h("div", { class: "stack-6 mt-8" }, state.annunciators.map(function (a) { return h("div", { class: "t-body-m c-white", text: " -  " + a }); }))
            : h("div", { class: "t-body-m c-sec mt-8", text: "None" })
        ]));
        detailNodes.push(blueCard([
          h("div", { class: "t-title-m w-semi c-white", text: "Phase Notes" }),
          h("div", { class: "t-body-m c-sec mt-8 pre-line", text: state.notes || "Use this preview to confirm what the aircraft is telling you, then move to the cockpit only when interaction is required." })
        ]));
      } else if (stateScreenState.section === "SYSTEMS") {
        detailNodes.push(keyValueCard("Instrument Indications", state.instruments));
        detailNodes.push(keyValueCard("Controls / Configuration", state.controls));
      } else {
        detailNodes.push(blueCard([h("div", { class: "t-title-m w-semi c-white", text: "Notes" }), h("div", { class: "t-body-m c-sec mt-8 pre-line", text: state.notes || "No notes" })]));
      }
    }

    root.replaceChildren(
      h("div", { class: "row between wrap gap-8" }, [
        bubble("light", "Back", { href: "#/live/procedures" }),
        h("div", { class: "row gap-8" }, [h("span", { class: "badge state", text: context.title }), h("span", { class: "badge state", text: phase })])
      ]),
      h("h2", { class: "t-headline-s w-bold c-white", text: bundle.title }),
      blueCard([
        h("div", { class: "t-title-m w-semi c-white", text: "State Preview" }),
        h("div", { class: "t-body-m mt-4", style: "color:var(--white-secondary)", text: phase.charAt(0) + phase.slice(1).toLowerCase() + " phase  -  " + variant }),
        h("div", { class: "t-body-s c-ter mt-6", text: "Resolved phase state for the selected procedure. Use this screen as the launcher for drill paths, MCC flow, cockpit entry, and frozen review." }),
        h("div", { class: "row gap-8 equal-row mt-10" }, [
          h("span", { class: "pill info", text: state.annunciators.length + " annunciators" }),
          h("span", { class: "pill info", text: Object.keys(state.instruments).length + " instruments" }),
          h("span", { class: "pill info", text: Object.keys(controls).length + " controls" })
        ])
      ]),
      blueCard([
        h("div", { class: "t-title-m w-semi c-white", text: "Launch Surface" }),
        h("div", { class: "t-body-m mt-4", style: "color:var(--white-secondary)", text: "This page is the single launcher for four actions: drill list, MCC flow, cockpit entry, and phase/state review." }),
        h("div", { class: "t-body-s c-ter mt-6", text: "1. Pick the phase.  2. Review the frozen state.  3. Launch the drill path or enter the cockpit only when you need live interaction." })
      ]),
      h("div", { class: "row gap-8 equal-row" }, PHASES.map(function (p) {
        return h("button", { class: "btn outlined" + (phase === p ? " selected" : ""), type: "button", text: p, onclick: function () { stateScreenState.phase = p; applyPhase(); render(); } });
      })),
      blueCard([
        h("div", { class: "t-title-m w-semi c-white", text: "Phase / State Review" }),
        h("div", { class: "mt-10" }, surface.root),
        h("div", { class: "snapshot-summary mt-10" }, [
          h("div", { class: "t-body-m w-semi c-white", text: phaseSummaryText(phase, state.snapshot) })
        ].concat(lines.map(function (l) { return h("div", { class: "t-body-s c-sec", text: l[0] + "  " + l[1] }); }))),
        h("div", { class: "row gap-8 equal-row mt-10" }, [
          outlinedButton("Focus Snapshot", function () {
            navigate("/scenario/focus/" + encodeURIComponent(procedureId) + "/" + phase + (focusTargets.length ? "?focusTarget=" + encodeURIComponent(focusTargets[0]) : ""));
          }, { block: true, disabled: !focusTargets.length }),
          primaryButton("Enter Cockpit", function () {
            rememberCockpitResume("/scenario/run/" + encodeURIComponent(procedureId) + "/" + phase, bundle.title, procedureId);
            navigate("/scenario/run/" + encodeURIComponent(procedureId) + "/" + phase);
          }, { block: true })
        ]),
        h("div", { class: "row gap-8 equal-row mt-8" }, [
          outlinedButton(stateScreenState.details ? "Hide Details" : "Review Details", function () { stateScreenState.details = !stateScreenState.details; render(); }, { block: true, selected: stateScreenState.details }),
          canEditScenarioState()
            ? outlinedButton("Edit State", function () { editPhase(phase, state); }, { block: true })
            : null
        ]),
        h("div", { class: "t-body-s c-ter mt-8", text: focusTargets.length ? "Preview stays frozen. Focus opens a static snapshot before any live cockpit entry." : "Use Enter Cockpit only when you need live interaction. Keep this screen as a launcher and review surface." })
      ]),
      blueCard([
        h("div", { class: "t-title-m w-semi c-white", text: "Drill List" }),
        h("div", { class: "t-body-s c-ter mt-4", text: "Use this state as the launcher for the procedure drill list. Complete QRH Checklist is checklist recall only. Flow and MCC use the crew-flow / Operations Manual B drill runtime." }),
        h("div", { class: "stack-8 mt-10" }, [
          ["Complete QRH Checklist", "Checklist-item recall only; no MCC callout runtime.", "memory"],
          ["Guided Cockpit Practice", "Procedure-step flow practice using MCC crew-flow logic.", "flow"],
          ["MCC Flow", "Operations Manual B PF/PM procedure-step rehearsal.", "mcc"]
        ].map(function (row) {
          return h("button", { class: "drill-path-row", type: "button", onclick: function () {
            Store.set("lastDrillProcedureId", procedureId);
            navigate("/drill/run/" + encodeURIComponent(procedureId) + "?preset=" + row[2]);
          } }, [
            h("div", { class: "t-body-m w-bold c-white", text: row[0] }),
            h("div", { class: "t-body-s c-sec mt-4", text: row[1] })
          ]);
        }))
      ])
    );
    detailNodes.forEach(function (n) { root.appendChild(n); });
    root.appendChild(disclaimer());
  }

  render();
  applyPhase();
  return screen({ ariaLabel: "Scenario state" }, [root]);
}

/* ------------------------ FrozenSnapshotScreen (#/scenario/focus/:id/:phase) */
export async function frozenSnapshot(ctx) {
  const procedureId = ctx.params.id;
  const phase = phaseFromRoute(ctx.params.phase);
  const variant = currentVariant();
  const initialTarget = ctx.query.get("focusTarget") || "";
  ctx.setTopbar({ title: "Focus Snapshot", subtitle: "AIRCRAFT · frozen review", back: "#/scenario/state/" + encodeURIComponent(procedureId) + "/cruise" });

  let bundle, hitboxes = [], procKey = procedureId;
  try {
    const index = await procedureIndex();
    const item = indexItemFor(index, procedureId);
    const steps = item ? await procedureSteps(item, variant) : { memory: [], flow: [] };
    const registry = await snapshotRegistry();
    procKey = registry.resolveKey(procedureId);
    const pack = await cockpitPack();
    const variantPack = variantPackFor(pack, variant);
    hitboxes = variantPack.hitboxes;
    const bindings = await bindingsIndex(variant, hitboxes);
    const title = item ? cleanScenarioProcedureTitle(item.displayTitle || item.title) : String(procedureId).split("/").pop();
    bundle = buildScenarioBundle(registry, procedureId, title, variant, (steps.flow || []).concat(steps.memory || []), function (action) { return bindings.lookup(procedureId, action); });
  } catch (error) {
    return screen({ title: "Focus Snapshot", header: [backBubble("#/live/procedures")] }, [contentUnavailable("scenario-snapshots", error)]);
  }

  const state = bundle[phase];
  const targets = [];
  if (initialTarget) targets.push(initialTarget);
  (state.focusTargets || []).forEach(function (t) { if (!targets.some(function (x) { return x.toLowerCase() === t.toLowerCase(); })) targets.push(t); });
  let selected = 0;
  let zoom = 1;

  const surface = cockpitSurface({ variant: variant, stageClass: "cockpit-focus" });
  const root = h("div", { class: "stack-12" });

  function currentRegion() {
    const target = targets[selected];
    const regions = regionsFor(target ? [target] : [], phase, hitboxes);
    return regions[0] || null;
  }
  function applyFocus() {
    surface.ready.then(function () {
      surface.setVisualState(snapshotVisualState(state.snapshot, variant));
      surface.setScrim(phase);
      const region = currentRegion();
      if (region) surface.renderer().focusRegion(region, zoom);
    }).catch(function () { /* overlay */ });
  }

  function render() {
    const region = currentRegion();
    const lines = summaryLines(state.snapshot, false);
    root.replaceChildren(
      h("div", { class: "row between wrap gap-8" }, [
        bubble("light", "Back", { onClick: function () { window.history.back(); } }),
        h("div", { class: "t-title-m w-bold c-white", text: "Focus Snapshot" })
      ]),
      h("h2", { class: "t-headline-s w-bold c-white", text: bundle.title }),
      blueCard([
        h("div", { class: "t-title-m w-semi c-white", text: "Frozen focus review" }),
        h("div", { class: "t-body-m mt-4", style: "color:var(--white-secondary)", text: phase.charAt(0) + phase.slice(1).toLowerCase() + " phase • " + variant }),
        h("div", { class: "t-body-s c-ter mt-6", text: "This screen keeps focus review static first. Enter the cockpit only when you need live interaction." }),
        h("div", { class: "row gap-8 equal-row mt-10" }, [
          h("span", { class: "pill info", text: targets.length + " focus targets" }),
          h("span", { class: "pill info", text: targets.length ? displayFocusTarget(targets[selected]) : "No target" })
        ])
      ]),
      h("div", { class: "row gap-8 equal-row" }, PHASES.map(function (p) {
        return h("a", { class: "btn outlined" + (phase === p ? " selected" : ""), href: "#/scenario/focus/" + encodeURIComponent(procedureId) + "/" + p + (targets.length ? "?focusTarget=" + encodeURIComponent(targets[selected]) : ""), text: p });
      })),
      targets.length ? blueCard([
        h("div", { class: "t-title-s w-semi c-white", text: "Procedure focus" }),
        h("div", { class: "t-body-s c-ter mt-4", text: "Targets are derived from the active checklist lines for this drill." }),
        h("div", { class: "row gap-8 wrap mt-8 scroll-x" }, targets.map(function (t, i) {
          return selectableChip(displayFocusTarget(t), i === selected, function () { selected = i; zoom = 1; applyFocus(); render(); });
        }))
      ]) : null,
      blueCard([
        h("div", { class: "t-title-m w-semi c-white", text: targets.length ? displayFocusTarget(targets[selected]) : "Frozen Snapshot" }),
        h("div", { class: "t-body-s c-ter mt-4", text: region ? region.label : "Selected focus area" }),
        h("div", { class: "mt-10" }, surface.root),
        h("div", { class: "row gap-8 equal-row mt-10" }, [
          outlinedButton("Zoom -", function () { zoom = Math.max(1, zoom - 0.35); applyFocus(); }, { block: true }),
          outlinedButton("Reset", function () { zoom = 1; applyFocus(); }, { block: true }),
          primaryButton("Zoom +", function () { zoom = Math.min(6, zoom + 0.35); applyFocus(); }, { block: true })
        ])
      ]),
      h("div", { class: "snapshot-summary" }, [h("div", { class: "t-body-m w-semi c-white", text: phaseSummaryText(phase, state.snapshot) })]
        .concat(targets.length ? [h("div", { class: "t-body-s c-sec", text: "Focus target  " + displayFocusTarget(targets[selected]) })] : [])
        .concat(lines.map(function (l) { return h("div", { class: "t-body-s c-sec", text: l[0] + "  " + l[1] }); }))),
      h("div", { class: "row gap-8 equal-row" }, [
        outlinedButton("Previous", function () { if (selected > 0) { selected -= 1; zoom = 1; applyFocus(); render(); } }, { block: true, disabled: selected <= 0 }),
        outlinedButton("Next", function () { if (selected < targets.length - 1) { selected += 1; zoom = 1; applyFocus(); render(); } }, { block: true, disabled: selected >= targets.length - 1 })
      ]),
      h("div", { class: "row gap-8 equal-row" }, [
        primaryButton("Open Cockpit", function () {
          rememberCockpitResume("/scenario/run/" + encodeURIComponent(procedureId) + "/" + phase, bundle.title, procedureId);
          navigate("/scenario/run/" + encodeURIComponent(procedureId) + "/" + phase);
        }, { block: true }),
        canEditScenarioState()
          ? outlinedButton("Edit State", function () {
            openEditStateSheet({
              procKey: procKey, phase: phase, title: bundle.title, variant: variant,
              phaseState: { annunciators: state.annunciators, instruments: state.instruments, controls: state.controls, notes: state.notes },
              onSaved: function () { window.location.reload(); }
            });
          }, { block: true })
          : null,
        outlinedButton("Close", function () { window.history.back(); }, { block: true })
      ]),
      disclaimer()
    );
  }
  render();
  applyFocus();
  return screen({ ariaLabel: "Focus snapshot" }, [root]);
}
