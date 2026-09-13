/*
  Interactive cockpit screens — ports of feature-cockpit ui/screens/
    CockpitScreen.kt            -> freePlayCockpit (#/live/cockpit)
    CockpitScenarioScreen.kt    -> scenarioRun     (#/scenario/run/:id/:phase)
    ScenarioDrillRunScreen.kt   -> drillRun        (#/drill/run/:id?preset=)
      (MemoryChecklistDrillScreen for preset=memory; the MCC crew-flow runner
       over the live cockpit for flow / mcc)
*/
import { h, Store, Content, currentVariant, navigate, feature } from "../core.js";
import { screen, blueCard, bubble, backBubble, selectableChip, statusPill, notice, contentUnavailable, primaryButton, outlinedButton } from "../ui.js";
import { cockpitSurface, cockpitPack, variantPackFor, snapshotRegistry, bindingsIndex, disclaimer } from "./cockpitcommon.js";
import { createLiveCockpit } from "../logic/cockpit/live.js";
import { createInteractionController } from "../logic/cockpit/interaction.js";
import { PHASES, buildScenarioBundle, snapshotVisualState, phaseSummaryText } from "../logic/cockpit/snapshot.js";
import { cleanScenarioProcedureTitle } from "../logic/cockpit/scenarios.js";
import { createDrillRun, drillTargetLabel, humanizeControlId, formatDuration, GRADING } from "../logic/cockpit/drillrun.js";
import { isLeverHitbox, isSwitchHitbox } from "../logic/cockpit/sprites.js";
import { displayVariant, rectPx } from "../logic/cockpit/hitboxes.js";
import { rememberCockpitResume } from "./aircraftstate.js";

/* ------------------------------------------------------- shared cockpit rig */
/*
  Wires a cockpit surface to the live engine loop and the interaction controller:
  lever drag, switch tap, engine tick → renderer. Returns the rig so the screens
  can add their own chrome and listen for control events.
*/
async function liveRig(opts) {
  const variant = displayVariant(currentVariant());
  const surface = cockpitSurface({ variant: variant, interactive: true, stageClass: opts.stageClass || "cockpit-live" });
  const controller = createInteractionController();
  const live = createLiveCockpit({ variant: variant, controller: controller, scenarioMode: Boolean(opts.scenarioMode) });
  const ready = surface.ready.then(function (res) {
    if (!res) return null;
    const renderer = res.renderer;
    renderer.onLeverDrag(function (leverId, position, prior, ended) {
      if (ended) { controller.setLever(leverId, controller.leverPositions[leverId]); return; }
      controller.setLever(leverId, position);
    });
    renderer.onPick(function (hb) {
      if (isLeverHitbox(hb)) return;
      if (!isSwitchHitbox(hb)) return;
      const rect = rectPx(hb, res.variantPack.plate.width, res.variantPack.plate.height);
      controller.tapHitbox(hb, 0.5, 0.5);
      if (opts.onTap) opts.onTap(hb);
    });
    live.onChange(function (visual) { renderer.setVisualState(visual); });
    live.start();
    renderer.setVisualState(live.visualState());
    return res;
  });
  ready.catch(function () { /* overlay */ });
  const onUnmount = function () { live.dispose(); };
  document.addEventListener("dhc6:view-unmount", onUnmount, { once: true });
  return { surface: surface, controller: controller, live: live, ready: ready, variant: variant,
    dispose: function () { document.removeEventListener("dhc6:view-unmount", onUnmount); live.dispose(); surface.dispose(); } };
}

function cockpitToolbar(rig, extra) {
  const items = [
    outlinedButton("Reset view", function () { rig.surface.ready.then(function () { rig.surface.renderer().resetView(); }); }, { small: true }),
    outlinedButton("Zoom +", function () { rig.surface.ready.then(function () { rig.surface.renderer().zoomBy(1.4); }); }, { small: true }),
    outlinedButton("Zoom -", function () { rig.surface.ready.then(function () { rig.surface.renderer().zoomBy(1 / 1.4); }); }, { small: true })
  ];
  return h("div", { class: "row gap-8 wrap mt-8" }, items.concat(extra || []));
}

/* Indications HUD — ScenarioIndicationsHud.kt */
function indicationsHud(live) {
  const root = h("div", { class: "cockpit-hud" });
  function render() {
    const visual = live.visualState();
    const warn = [], caut = [], on = [];
    (visual.casEntries || []).forEach(function (e) {
      if (e.priority === "WARNING") warn.push(e.text); else if (e.priority === "CAUTION") caut.push(e.text); else on.push(e.text);
    });
    const raw = visual.rawAnalogValues;
    const instruments = [["TRQ L", "TORQUE_GAUGE_L"], ["TRQ R", "TORQUE_GAUGE_R"], ["NG L", "NG_GAUGE_L"], ["NG R", "NG_GAUGE_R"],
      ["NP L", "NP_GAUGE_L"], ["NP R", "NP_GAUGE_R"], ["T5 L", "T5_GAUGE_L"], ["T5 R", "T5_GAUGE_R"]]
      .filter(function (r) { return raw[r[1]] != null; }).slice(0, 8)
      .map(function (r) { return h("span", { class: "hud-chip", text: r[0] + " " + Math.round(raw[r[1]]) }); });
    const lines = warn.slice(0, 3).map(function (t) { return h("span", { class: "hud-chip warn", text: "WARN: " + t }); })
      .concat(caut.slice(0, 3).map(function (t) { return h("span", { class: "hud-chip caut", text: "CAUT: " + t }); }))
      .concat(on.slice(0, Math.max(0, 6 - warn.length - caut.length)).map(function (t) { return h("span", { class: "hud-chip", text: t }); }));
    root.replaceChildren(
      h("div", { class: "t-label-s c-ter", text: "Indications" }),
      h("div", { class: "row gap-6 wrap" }, lines.length ? lines : [h("span", { class: "hud-chip", text: "No active messages" })]),
      h("div", { class: "t-label-s c-ter mt-6", text: "Instruments" }),
      h("div", { class: "row gap-6 wrap" }, instruments)
    );
  }
  render();
  const timer = setInterval(render, 500);
  document.addEventListener("dhc6:view-unmount", function () { clearInterval(timer); }, { once: true });
  return root;
}

/* ------------------------------------------------ free play (#/live/cockpit) */
export async function freePlayCockpit(ctx) {
  ctx.setTopbar({ title: "Cockpit", subtitle: "AIRCRAFT · free play", back: "#/live" });
  rememberCockpitResume("/live/cockpit", "Free Play");
  const rig = await liveRig({ stageClass: "cockpit-live" });
  rig.live.setScenarioMode(false);

  const leverRow = h("div", { class: "stack-8" });
  function renderLevers() {
    const levers = [["POWER_LEVER_L", "Power L"], ["POWER_LEVER_R", "Power R"], ["PROP_LEVER_L", "Prop L"], ["PROP_LEVER_R", "Prop R"], ["FUEL_LEVER_L", "Fuel L"], ["FUEL_LEVER_R", "Fuel R"], ["FLAP_SELECTOR", "Flaps"]];
    leverRow.replaceChildren.apply(leverRow, levers.map(function (row) {
      const value = rig.controller.leverPositions[row[0]] || 0;
      const input = h("input", { type: "range", class: "slider", min: 0, max: 1000, step: 1, value: String(Math.round(value * 1000)), "aria-label": row[1] });
      const readout = h("span", { class: "t-label-l w-bold c-gold mono", text: value.toFixed(2) });
      input.addEventListener("input", function () {
        const v = Number(input.value) / 1000;
        rig.controller.setLever(row[0], v);
        readout.textContent = v.toFixed(2);
      });
      return h("div", { class: "stack-4" }, [h("div", { class: "slider-row" }, [h("span", { class: "t-label-l w-semi c-87", text: row[1] }), readout]), input]);
    }));
  }
  renderLevers();

  return screen({ ariaLabel: "Free play cockpit" }, [
    h("div", { class: "row between wrap gap-8" }, [
      bubble("light", "Back", { href: "#/live" }),
      h("div", { class: "row gap-8" }, [h("span", { class: "badge state", text: rig.variant }), h("span", { class: "badge state", text: "FREE PLAY" })])
    ]),
    rig.surface.root,
    cockpitToolbar(rig, [outlinedButton("Reset controls", function () { rig.controller.reset(); renderLevers(); }, { small: true })]),
    indicationsHud(rig.live),
    blueCard([
      h("div", { class: "t-title-m w-semi c-white", text: "Power quadrant" }),
      h("div", { class: "t-body-s c-ter mt-4", text: "Drag a lever on the plate, or use these sliders. Power 0 = full forward, 0.26 = flight idle, 1 = full reverse; prop 1 = feather; fuel 1 = cutoff." }),
      h("div", { class: "mt-10" }, leverRow)
    ]),
    blueCard([
      h("div", { class: "t-title-m w-semi c-white", text: "How this behaves" }),
      h("div", { class: "t-body-s c-ter mt-4", text: "Tap a switch to move it, drag a lever to set power, prop, fuel or flap. Gauges, annunciators and the CAS list are driven by the same engine and failure model as the Android cockpit." })
    ]),
    disclaimer()
  ]);
}

/* ------------------------------ scenario run (#/scenario/run/:id/:phase) */
export async function scenarioRun(ctx) {
  const procedureId = ctx.params.id;
  const phase = PHASES.indexOf(String(ctx.params.phase || "").toUpperCase()) > -1 ? String(ctx.params.phase).toUpperCase() : "BEFORE";
  const variant = currentVariant();
  ctx.setTopbar({ title: "Scenario", subtitle: "AIRCRAFT · cockpit state", back: "#/live/procedures" });

  let bundle;
  try {
    const index = await Content.pack("procedures-index");
    const item = (index.items || []).find(function (i) { return i.compiledId === procedureId || i.id === procedureId; }) || null;
    const registry = await snapshotRegistry();
    const title = item ? cleanScenarioProcedureTitle(item.displayTitle || item.title) : String(procedureId).split("/").pop();
    bundle = buildScenarioBundle(registry, procedureId, title, variant, [], null);
  } catch (error) {
    return screen({ title: "Scenario", header: [backBubble("#/live/procedures")] }, [contentUnavailable("scenario-snapshots", error)]);
  }

  const rig = await liveRig({ scenarioMode: true, stageClass: "cockpit-live" });
  rig.live.setScenarioMode(true);
  let current = phase;

  function applyPhase(p) {
    current = p;
    const state = bundle[p];
    const visual = snapshotVisualState(state.snapshot, variant);
    rig.live.applyScenario(visual, state.snapshot);
    rig.surface.ready.then(function () { rig.surface.renderer().setVisualState(rig.live.visualState()); });
    rememberCockpitResume("/scenario/run/" + encodeURIComponent(procedureId) + "/" + p, bundle.title, procedureId);
    renderChrome();
  }

  const chrome = h("div", { class: "stack-8" });
  function renderChrome() {
    const state = bundle[current];
    chrome.replaceChildren(
      h("div", { class: "row gap-8 equal-row" }, PHASES.map(function (p) {
        return h("button", { class: "btn outlined" + (current === p ? " selected" : ""), type: "button", text: p, onclick: function () { applyPhase(p); } });
      })),
      h("div", { class: "t-body-m w-semi c-white mt-8", text: phaseSummaryText(current, state.snapshot) }),
      state.annunciators.length
        ? h("div", { class: "row gap-6 wrap mt-6" }, state.annunciators.slice(0, 8).map(function (a) { return h("span", { class: "hud-chip caut", text: a }); }))
        : h("div", { class: "t-body-s c-ter mt-6", text: "No highlighted alerts for this phase." })
    );
  }

  applyPhase(phase);

  return screen({ ariaLabel: "Scenario cockpit" }, [
    h("div", { class: "row between wrap gap-8" }, [
      bubble("light", "Back", { onClick: function () { window.history.back(); } }),
      h("div", { class: "row gap-8" }, [h("span", { class: "badge state", text: variant }), h("span", { class: "badge state", text: current })])
    ]),
    h("h2", { class: "t-headline-s w-bold c-white", text: bundle.title }),
    rig.surface.root,
    cockpitToolbar(rig, [
      outlinedButton("Live (clear scenario)", function () { rig.live.setScenarioMode(false); rig.live.clearScenario(); }, { small: true }),
      h("a", { class: "btn outlined small", href: "#/scenario/state/" + encodeURIComponent(procedureId) + "/cruise", text: "State Preview" })
    ]),
    indicationsHud(rig.live),
    blueCard([h("div", { class: "t-title-m w-semi c-white", text: "Cockpit State" }), h("div", { class: "mt-8" }, chrome)]),
    disclaimer()
  ]);
}

/* ---------------------------------------- drill run (#/drill/run/:id?preset=) */
export async function drillRun(ctx) {
  const procedureId = ctx.params.id;
  const preset = String(ctx.query.get("preset") || "").toLowerCase();
  const variant = currentVariant();
  const backHref = "#/live/procedures";

  let index, item, steps, title, category;
  try {
    index = await Content.pack("procedures-index");
    item = (index.items || []).find(function (i) { return i.compiledId === procedureId || i.id === procedureId; }) || null;
    if (!item) throw Object.assign(new Error("procedure_not_found"), { status: 404 });
    const pack = await Content.pack(item.pack);
    const proc = (pack.procedures || []).find(function (p) { return p.id === item.id; });
    const key = displayVariant(variant);
    const v = (proc && (proc.variants[key] || proc.variants.LEGACY)) || { memory: [], flow: [] };
    steps = { memory: v.memory || [], flow: v.flow || [] };
    title = cleanScenarioProcedureTitle(item.displayTitle || item.title);
    category = item.category;
  } catch (error) {
    return screen({ title: "Drill", header: [backBubble(backHref)] }, [contentUnavailable("procedures-index", error)]);
  }

  if (preset === "memory") return memoryChecklistDrill(ctx, { title: title, steps: steps.memory, backHref: backHref });
  return flowDrill(ctx, { procedureId: procedureId, title: title, category: category, steps: steps.flow, variant: variant, backHref: backHref, preset: preset });
}

/* MemoryChecklistDrillScreen — fully portable, no cockpit needed. */
function memoryChecklistDrill(ctx, opts) {
  ctx.setTopbar({ title: "Memory Drill", subtitle: "Checklist recall", back: opts.backHref });
  const checked = opts.steps.map(function () { return false; });
  const root = h("div", { class: "stack-12" });
  function render() {
    const complete = checked.filter(Boolean).length;
    root.replaceChildren(
      bubble("light", "Back", { href: opts.backHref }),
      h("h2", { class: "t-headline-s w-bold c-white clamp-2", text: opts.title }),
      h("div", { class: "t-body-m w-semi", style: "color:#E6FFFFFF", text: "Memory Drill  -  Checklist recall only  -  " + complete + "/" + opts.steps.length + " complete" }),
      h("div", { class: "t-body-s", style: "color:#CCFFFFFF", text: "This path does not run MCC PF/PM callouts, cockpit scoring, or crew-flow logic. Use Flow Drill or MCC Flow for Operations Manual B crew procedure rehearsal." }),
      opts.steps.length
        ? h("div", { class: "stack-8" }, opts.steps.map(function (step, i) {
          return h("button", { class: "memory-row" + (checked[i] ? " checked" : ""), type: "button", onclick: function () { checked[i] = !checked[i]; render(); } }, [
            h("div", { class: "t-label-l w-bold c-white", text: (i + 1) + ". " + (checked[i] ? "CHECKED" : "RECALL") }),
            h("div", { class: "t-body-l w-semi c-white mt-4", text: step.action })
          ]);
        }))
        : blueCard([h("div", { class: "t-title-m w-bold c-white", text: "No memory items mapped" }),
          h("div", { class: "t-body-m c-sec mt-6", text: "Open the QRH page to review the memory-item mapping for this procedure." })]),
      disclaimer()
    );
  }
  render();
  return screen({ ariaLabel: "Memory drill" }, [root]);
}

/* The MCC crew-flow runner over the live cockpit. */
async function flowDrill(ctx, opts) {
  ctx.setTopbar({ title: opts.preset === "mcc" ? "MCC Flow" : "Flow Drill", subtitle: "AIRCRAFT · drill", back: opts.backHref });
  const rig = await liveRig({ scenarioMode: true, stageClass: "cockpit-live" });
  rig.live.setScenarioMode(true);

  let bindings = null, hitboxes = [];
  try {
    const pack = await cockpitPack();
    hitboxes = variantPackFor(pack, opts.variant).hitboxes;
    bindings = await bindingsIndex(opts.variant, hitboxes);
  } catch (error) { bindings = null; }

  /* Seed the cockpit from the procedure's own BEFORE snapshot when one exists. */
  try {
    const registry = await snapshotRegistry();
    const bundle = buildScenarioBundle(registry, opts.procedureId, opts.title, opts.variant, [], null);
    const visual = snapshotVisualState(bundle.BEFORE.snapshot, opts.variant);
    rig.live.applyScenario(visual, bundle.BEFORE.snapshot);
  } catch (error) { /* free-play baseline */ }

  const run = createDrillRun({
    procedureId: opts.procedureId, procedureName: opts.title, category: opts.category, variant: opts.variant, steps: opts.steps,
    lookupHitboxes: bindings ? function (action) { return bindings.lookup(opts.procedureId, action); } : null,
    resolveHitboxes: bindings ? bindings.resolve : null,
    resolveActionableHitboxes: bindings ? bindings.resolveActionable : null,
    onComplete: function (entry) { Store.addLogbookEntry(entry); Store.recordAttempt({ kind: "scenario-drill", procedureId: opts.procedureId, score: entry.scorePercent }); }
  });

  rig.controller.onControlEvent(function (event) {
    run.handleControlEvent(event, rig.controller.switchStates, rig.controller.leverPositions);
  });

  const panel = h("div", { class: "stack-8" });
  const speech = window.speechSynthesis || null;
  function speak(text) {
    if (!speech || Store.get("soundEnabled") === false) return;
    try { const u = new SpeechSynthesisUtterance(text); u.rate = 0.98; speech.cancel(); speech.speak(u); } catch (error) { /* ignore */ }
  }

  function applyHighlights() {
    rig.surface.ready.then(function () {
      const ids = run.state.expectedIds.length ? run.state.expectedIds : run.state.focusIds;
      const selected = run.state.selectedTargetId;
      rig.surface.renderer().setHighlight(selected ? [selected + "|SELECTED"] : ids, ids[0]);
      if (ids.length) rig.surface.renderer().centerOn(ids[0]);
    });
  }

  function renderPanel() {
    const step = run.current(), next = run.next();
    const s = run.state;
    if (!s.started) {
      panel.replaceChildren(
        h("div", { class: "t-title-m w-bold c-white", text: "Ready for Flow 1/" + opts.steps.length }),
        h("div", { class: "t-body-s c-ter mt-4", text: "Select PF or PM, then start the flow drill." }),
        h("div", { class: "row gap-8 mt-8" }, [
          selectableChip("PF", s.traineeRole === "PF", function () { run.setRole("PF"); renderPanel(); }),
          selectableChip("PM", s.traineeRole === "PM", function () { run.setRole("PM"); renderPanel(); })
        ]),
        h("div", { class: "mt-10" }, primaryButton("START DRILL", function () { run.start(); applyHighlights(); renderPanel(); }, { block: true }))
      );
      return;
    }
    if (s.completed) {
      const c = run.counters();
      panel.replaceChildren(
        h("div", { class: "t-title-m w-bold c-white", text: "Drill complete" }),
        h("div", { class: "t-body-m w-semi c-white mt-6", text: "Band: " + s.finalScoreBand + " | Score: " + s.finalScorePercent + "%" }),
        h("div", { class: "t-body-s c-sec mt-4 pre-line", text: "Errors - role " + c.wrongRoleCount + ", callout/action " + c.wrongCalloutCount + ", rushed " + c.rushedCount + ", tolerance " + c.toleranceUsedCount +
          "\nTiming - total " + formatDuration(run.totalElapsedMs()) + ", avg " + formatDuration(run.averageLatencyMs()) + ", max " + formatDuration(run.maxLatencyMs()) +
          "\n" + GRADING.instructorFeedback(c) }),
        h("div", { class: "row gap-8 equal-row mt-10" }, [
          h("a", { class: "btn primary", href: "#/training/logbook", text: "Open Debrief" }),
          outlinedButton("Run Again", function () { run.restart(); applyHighlights(); renderPanel(); }, { block: true })
        ])
      );
      return;
    }
    const roleLabel = step ? step.crewRole : "";
    const nodes = [
      h("div", { class: "row between wrap gap-8" }, [
        h("span", { class: "badge state", text: "Flow " + (s.stepIndex + 1) + "/" + opts.steps.length }),
        h("span", { class: "badge " + (run.isOppositeRoleLine(step) ? "phase" : "bucket"), text: roleLabel + (run.isTraineeLine(step) ? " ACTION" : " CALLOUT") })
      ]),
      h("div", { class: "t-title-m w-bold c-white mt-6", text: step ? step.action : "" }),
      h("div", { class: "t-body-s c-sec mt-4", text: s.status })
    ];
    if (s.expectedIds.length) nodes.push(h("div", { class: "t-body-s", style: "color:#FFF59D", text: "Required: " + drillTargetLabel(s.expectedIds[0]) }));
    if (s.selectedTargetId) nodes.push(h("div", { class: "t-body-s", style: "color:#00E676", text: "Completed: " + drillTargetLabel(s.selectedTargetId) }));
    if (s.feedback) nodes.push(h("div", { class: "t-body-s " + (s.severity === "WARNING" ? "c-amber" : s.severity === "FAIL" ? "c-red" : "c-ter"), text: s.feedback }));
    if (next) nodes.push(h("div", { class: "t-body-s c-ter mt-4", text: "Next: " + next.crewRole + " - " + next.action }));
    if (step && step.reference) nodes.push(h("div", { class: "t-body-s c-ter", text: "Instructor: " + step.reference }));
    if (s.alreadyCorrect) {
      nodes.push(blueCard([
        h("div", { class: "t-title-m w-bold c-white", text: "Already Correct" }),
        h("div", { class: "t-body-m c-sec mt-4", text: s.alreadyCorrect.label + " is already " + s.alreadyCorrect.requiredPosition + "." }),
        h("div", { class: "t-body-s c-ter mt-4", text: "Confirm this item to continue." }),
        h("div", { class: "mt-8" }, primaryButton("Confirm", function () { run.confirmAlreadyCorrect(); applyHighlights(); renderPanel(); }, { block: true }))
      ]));
    }
    nodes.push(h("div", { class: "row gap-8 equal-row mt-10" }, [
      outlinedButton("Prev", function () { run.previous(); applyHighlights(); renderPanel(); }, { block: true, disabled: s.stepIndex <= 0 }),
      outlinedButton(run.nextLocked() ? "Locked Next" : "Next", function () { run.advanceManually(); applyHighlights(); renderPanel(); }, { block: true }),
      outlinedButton("Replay", function () { if (step) speak(step.action); }, { block: true }),
      outlinedButton("Restart", function () { run.restart(); applyHighlights(); renderPanel(); }, { block: true })
    ]));
    panel.replaceChildren.apply(panel, nodes);
  }

  run.onChange(function () { applyHighlights(); renderPanel(); });
  let lastSpokenIndex = -1;
  function maybeSpeak() {
    const step = run.current();
    if (!step || !run.state.started || run.state.stepIndex === lastSpokenIndex) return;
    lastSpokenIndex = run.state.stepIndex;
    if (run.isOppositeRoleLine(step)) speak(step.crewRole + ". " + step.action);
  }
  run.onChange(maybeSpeak);
  renderPanel();
  rig.surface.ready.then(function () { applyHighlights(); run.checkAlreadyCorrect(rig.controller.switchStates); });

  return screen({ ariaLabel: "Flow drill" }, [
    h("div", { class: "row between wrap gap-8" }, [
      bubble("light", "Back", { href: opts.backHref }),
      h("div", { class: "row gap-8" }, [h("span", { class: "badge state", text: run.phase() }), h("span", { class: "badge state", text: opts.variant })])
    ]),
    h("h2", { class: "t-title-l w-bold c-white clamp-2", text: opts.title }),
    rig.surface.root,
    cockpitToolbar(rig, [h("a", { class: "btn outlined small", href: "#/qrh/detail/" + encodeURIComponent(opts.procedureId), text: "QRH" })]),
    blueCard([panel]),
    disclaimer()
  ]);
}
