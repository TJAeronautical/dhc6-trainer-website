/*
  CRM / MCC Callout Drill — a port of
  feature-training/ui/crm/CrmDrillScreen.kt (its data layer and state machine).

  What the Android screen actually does, checked against the Kotlin rather than
  against the placeholder text the web app was carrying:

    * It is NOT built from "every procedure". Exactly FOUR procedures are named
      in CRM_SOURCE_SPECS, and each produces TWO drills (you as PF, you as PM),
      so eight drills for the resolved variant.
    * There is NO timing anywhere in it. The web stub claimed "challenge-response
      flow with role timing"; the Kotlin has no timer, no latency, no score. It
      is a paced read-through: the app speaks the other seat's callout, you say
      yours, you tap Confirm.
    * The callout text is the procedure's raw `action` string, used verbatim.
      cleanQrhLine() is not applied, so nothing here rewrites authored aviation
      wording.

  The steps come from the same published procedure packs the rest of the app
  uses, so there is no new content to build.
*/

/* CrmDrillScreen.CRM_SOURCE_SPECS, keyed by the slug the content build derives
   from each asset path (procedures/<category>/<slug>.json).

   The titles are the Kotlin's own, not the procedure's published title: Android
   labels the third drill "Engine Failure Prior to Rotation" while the library
   calls the same procedure "Rejected Take-Off [Ground]". Kept as Android has
   it so the two apps read the same. */
export const CRM_SOURCE_SPECS = [
  { id: "before_takeoff", slug: "before_take_off", title: "Before Take-off", category: "NORMAL" },
  { id: "engine_fire", slug: "engine_fire_in_flight", title: "Engine Fire in Flight", category: "EMERGENCY" },
  { id: "engine_failure_rto", slug: "engine_failure_prior_to_rotation", title: "Engine Failure Prior to Rotation", category: "EMERGENCY" },
  { id: "oei_landing", slug: "one_engine_inoperative_landing", title: "One Engine Inoperative Landing", category: "EMERGENCY" }
];

export const CREW_ROLES = ["PF", "PM"];
export const COMPLETE_SPEECH = "Drill complete. Well done.";

/*
  AppSettings.resolveVariantForContent(null).

  Android's chain is: the stored preference if it is not BOTH, then the content
  variant (null here), then lastManualVariant, then LEGACY. The browser has no
  lastManualVariant — that is an Android-only stored preference — so the chain
  collapses to "the preference, or LEGACY". Same answer for every case the web
  can actually be in.
*/
export function resolveVariantForContent(preferred) {
  const v = String(preferred || "").toUpperCase();
  return v === "LEGACY" || v === "G950" ? v : "LEGACY";
}

/* loadSourceGroundedCrmDrills(): the PF/PM callouts of one procedure flow, in
   order, skipping any step with another crew role or a blank action. */
export function calloutsFrom(flow) {
  const out = [];
  for (const step of flow || []) {
    const crew = String((step && step.crewRole) || "").toUpperCase();
    const callout = String((step && step.action) || "").trim();
    if (CREW_ROLES.includes(crew) && callout) out.push({ crew: crew, callout: callout });
  }
  return out;
}

/* One CrmDrillDef: the same callout list seen from one seat. */
export function drillFor(spec, variant, traineeRole, callouts) {
  return {
    id: spec.id + "_" + String(variant).toLowerCase() + "_" + traineeRole.toLowerCase(),
    title: spec.title + " — " + traineeRole,
    category: spec.category,
    traineeRole: traineeRole,
    steps: callouts.map(function (c) {
      return {
        crew: c.crew,
        callout: c.callout,
        isTrainee: c.crew === traineeRole,
        isTts: c.crew !== traineeRole
      };
    })
  };
}

/*
  `procedures` is the materialised list for one variant (allProcedures(variant)),
  so each entry already carries a flat `flow`. A source procedure that is missing
  or has no PF/PM callouts contributes nothing, exactly as the Kotlin's
  runCatching/emptyList path does — it is never substituted or invented.
*/
export function buildCrmDrills(procedures, variant) {
  const bySlug = new Map();
  for (const p of procedures || []) if (p && p.slug) bySlug.set(p.slug, p);

  const drills = [];
  for (const spec of CRM_SOURCE_SPECS) {
    const procedure = bySlug.get(spec.slug);
    const callouts = calloutsFrom(procedure && procedure.flow);
    if (!callouts.length) continue;
    for (const role of CREW_ROLES) drills.push(drillFor(spec, variant, role, callouts));
  }
  return drills;
}

/* Which published procedures the drills were built from, and which were not
   found — so the screen can say so rather than quietly showing fewer drills. */
export function missingSources(procedures) {
  const bySlug = new Set((procedures || []).map(function (p) { return p && p.slug; }));
  return CRM_SOURCE_SPECS.filter(function (spec) { return !bySlug.has(spec.slug); }).map(function (s) { return s.title; });
}

/* ------------------------------------------------------------ state machine */
/* CrmDrillState.Select / Running, and the ViewModel's three transitions. */

export function selectState() {
  return { mode: "select", drill: null, currentStep: 0, completedSteps: [], isComplete: false };
}

export function startDrill(drill) {
  return { mode: "running", drill: drill, currentStep: 0, completedSteps: [], isComplete: false };
}

export function confirmStep(state) {
  if (!state || state.mode !== "running" || state.isComplete) return state;
  const completed = state.completedSteps.concat([state.currentStep]);
  const next = state.currentStep + 1;
  if (next >= state.drill.steps.length) {
    return Object.assign({}, state, { completedSteps: completed, isComplete: true });
  }
  return Object.assign({}, state, { currentStep: next, completedSteps: completed });
}

export function reset() {
  return selectState();
}

export function currentStepOf(state) {
  if (!state || state.mode !== "running") return null;
  return state.drill.steps[state.currentStep] || null;
}

/* What the app speaks when a step becomes current: only the other seat's lines,
   read as "PM. CONFIRMED L/R ENGINE FIRE — …". */
export function speechFor(step) {
  if (!step || !step.isTts) return null;
  return step.crew + ". " + step.callout;
}

/* --------------------------------------------------------------- presentation */

export function progressLabel(state) {
  if (!state || state.mode !== "running") return "";
  return (state.currentStep + 1) + "/" + state.drill.steps.length;
}

/* LinearProgressIndicator: currentStep / size — so step 1 of 27 reads 0%, and
   the bar only fills once the last callout is confirmed. */
export function progressFraction(state) {
  if (!state || state.mode !== "running" || !state.drill.steps.length) return 0;
  if (state.isComplete) return 1;
  return state.currentStep / state.drill.steps.length;
}

/* The per-row tone in CrmRunningContent. */
export function stepTone(state, index) {
  if (!state || state.mode !== "running") return "idle";
  if (state.completedSteps.includes(index)) return "done";
  if (index === state.currentStep && !state.isComplete) {
    return state.drill.steps[index] && state.drill.steps[index].isTrainee ? "current-you" : "current";
  }
  return "idle";
}

export function categoryBand(category) {
  if (category === "EMERGENCY") return "overdue";
  if (category === "ABNORMAL") return "caution";
  return "ready";
}

/* Surface { Text(drill.category.name.take(4)) } */
export function categoryBadge(category) {
  return String(category || "").slice(0, 4);
}

export function drillSubtitle(drill) {
  return "Your role: " + drill.traineeRole + "  ·  " + drill.steps.length + " callouts";
}

export function promptFor(state) {
  const step = currentStepOf(state);
  if (!step) return "";
  return step.isTrainee ? "Say the callout above, then tap Confirm" : "Listen to TTS callout, then tap Continue";
}

export function confirmLabel(state) {
  const step = currentStepOf(state);
  if (!step) return "Continue";
  return step.isTrainee ? "Confirm Callout" : "Continue";
}
