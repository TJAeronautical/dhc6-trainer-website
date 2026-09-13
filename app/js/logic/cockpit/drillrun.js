/*
  Scenario drill runtime — port of feature-cockpit
  scenario/engine/DrillStepEvaluator.kt (control-id aliasing, lever/switch
  satisfaction, expected-target resolution), ui/screens/ScenarioDrillRunActionCues.kt
  (cue classification, target labels) and ui/screens/ScenarioDrillRunViewModel.kt
  (ScenarioDrillGradingModel + the run state machine).
*/

export function normalizeControlId(value) { return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, ""); }

function aliasGroupContains(value, aliases) {
  const n = normalizeControlId(value);
  if (!n) return false;
  return aliases.some(function (a) { return n === a || n.indexOf(a) > -1 || a.indexOf(n) > -1; });
}

const FLAP_ALIASES = ["FLAPSELECTOR", "FLAPS", "FLAP"];
const POWER_L = ["POWERLEVERL", "POWERLEFT", "POWERL", "PWRL"];
const POWER_R = ["POWERLEVERR", "POWERRIGHT", "POWERR", "PWRR"];
const PROP_L = ["POWERLEVERL", "PROPLEVERLEFT", "LEFTPROPLEVER", "PROPELLERLEVERL", "PROPELLERLEVERLEFT", "PROPCONTROLL", "PROPCONTROLLEFT", "LEFTPROPCONTROL", "PROPLEFT", "PROPL"];
const PROP_R = ["POWERLEVERR", "PROPLEVERRIGHT", "RIGHTPROPLEVER", "PROPELLERLEVERR", "PROPELLERLEVERRIGHT", "PROPCONTROLR", "PROPCONTROLRIGHT", "RIGHTPROPCONTROL", "PROPRIGHT", "PROPR"];
const PROP_ALL = PROP_L.concat(PROP_R, ["POWERLEVERS", "POWERLEVER", "PROPCONTROLS", "PROPCONTROL", "PROPELLERLEVERS", "PROPELLERLEVER", "PROPELLERCONTROLS", "PROPELLERCONTROL", "PROP"]);
const POWER_ALL = POWER_L.concat(POWER_R, ["POWERLEVERS", "POWERLEVER", "POWER", "THROTTLES", "THROTTLE"]);
const LANDING_LIGHTS = ["LANDINGLIGHT", "LANDINGLIGHTS", "LANDINGLIGHTL", "LANDINGLIGHTR", "LANDINGLIGHTLEFT", "LANDINGLIGHTRIGHT"];
const PITOT_HEAT = ["PITOTHEAT", "PITOTHEATSWITCH"];
const ANTI_COLLISION = ["ANTICOLLIGHTS", "ANTICOLLISION", "ANTICOLLISIONLIGHTS", "ANTICOLLISIONSTROBE", "ANTICOLLISIONSTROBELIGHTS", "STROBE", "STROBELIGHT", "STROBELIGHTS"];
const CAUT_TEST = ["CAUTLTTEST", "CAUTIONLIGHTTEST", "CAUTLIGHTTEST"];

export function areKnownAliases(a, b) {
  return [POWER_L, POWER_R, FLAP_ALIASES, LANDING_LIGHTS, PITOT_HEAT, ANTI_COLLISION, CAUT_TEST, PROP_L, PROP_R, PROP_ALL]
    .some(function (group) { return aliasGroupContains(a, group) && aliasGroupContains(b, group); });
}
export function isLandingLightControlId(v) { return aliasGroupContains(v, LANDING_LIGHTS); }
export function isPitotHeatControlId(v) { return aliasGroupContains(v, PITOT_HEAT); }
export function isAntiCollisionControlId(v) { return aliasGroupContains(v, ANTI_COLLISION); }
export function isCautionLightTestControlId(v) { return aliasGroupContains(v, CAUT_TEST); }
export function isFlapSelectorControlId(v) { return aliasGroupContains(v, FLAP_ALIASES); }
export function isPowerLeverControlId(v) { const n = normalizeControlId(v); return aliasGroupContains(n, POWER_ALL) || aliasGroupContains(n, POWER_L) || aliasGroupContains(n, POWER_R); }
export function isPropLeverControlId(v) { const n = normalizeControlId(v); return aliasGroupContains(n, PROP_ALL) || aliasGroupContains(n, PROP_L) || aliasGroupContains(n, PROP_R); }
export function isLandingLightsOffAction(action) { const n = normalizeControlId(action); return n.indexOf("LANDINGLIGHT") > -1 && n.indexOf("OFF") > -1; }
export function isAntiCollisionOffAction(action) { const n = normalizeControlId(action); return n.indexOf("OFF") > -1 && isAntiCollisionControlId(n); }

export function resolvedExpectedTargetIds(action, expectedIds) {
  const merged = [];
  function add(id) { if (id && merged.indexOf(id) === -1) merged.push(id); }
  let landing = expectedIds.slice();
  if (isLandingLightsOffAction(action)) {
    landing = [];
    expectedIds.forEach(function (id) { if (isLandingLightControlId(id)) { landing.push("LANDING_LIGHT_L"); landing.push("LANDING_LIGHT_R"); } else landing.push(id); });
    if (!landing.some(isLandingLightControlId)) { landing.push("LANDING_LIGHT_L"); landing.push("LANDING_LIGHT_R"); }
  }
  landing.forEach(function (id) {
    if (isPitotHeatControlId(action) && isPitotHeatControlId(id)) add("PITOT_HEAT_SWITCH");
    else if (isAntiCollisionOffAction(action) && isAntiCollisionControlId(id)) add("ANTI-COL_LIGHTS");
    else if (isCautionLightTestControlId(action) && isCautionLightTestControlId(id)) add("CAUT_LT_TEST");
    else add(id);
  });
  if (isPitotHeatControlId(action) && !merged.some(isPitotHeatControlId)) add("PITOT_HEAT_SWITCH");
  if (isAntiCollisionOffAction(action) && !merged.some(isAntiCollisionControlId)) add("ANTI-COL_LIGHTS");
  if (isCautionLightTestControlId(action) && !merged.some(isCautionLightTestControlId)) add("CAUT_LT_TEST");
  const n = normalizeControlId(action);
  if (n.indexOf("POWER") > -1 && !merged.some(isPowerLeverControlId)) { add("POWER_LEVER_L"); add("POWER_LEVER_R"); }
  if (n.indexOf("FLAP") > -1 && !merged.some(isFlapSelectorControlId)) add("FLAP_SELECTOR");
  if (n.indexOf("AUTOFEATHER") > -1 && n.indexOf("ARM") > -1 && !merged.some(function (i) { return normalizeControlId(i).indexOf("AUTOFEATHERARM") > -1; })) add("AUTOFEATHER_ARM");
  if (n.indexOf("AUTOFEATHER") > -1 && n.indexOf("SELECT") > -1 && !merged.some(function (i) { return normalizeControlId(i).indexOf("AUTOFEATHERSELECT") > -1; })) add("AUTOFEATHER_SELECT");
  if (n.indexOf("FUELLEVER") > -1 && !merged.some(function (i) { return normalizeControlId(i).indexOf("FUELLEVER") > -1; })) { add("FUEL_LEVER_L"); add("FUEL_LEVER_R"); }
  if ((n.indexOf("POWERLEVER") > -1 || n.indexOf("PROP") > -1) && !merged.some(function (i) { return normalizeControlId(i).indexOf("POWERLEVER") > -1; })) { add("POWER_LEVER_L"); add("POWER_LEVER_R"); }
  if (n.indexOf("BOOSTPUMP") > -1 && !merged.some(function (i) { return normalizeControlId(i).indexOf("BOOSTPUMP") > -1; })) { add("FWD_BOOST_PUMP"); add("AFT_BOOST_PUMP"); add("STBY_BOOST_PUMP_FWD"); add("STBY_BOOST_PUMP_AFT"); }
  if (n.indexOf("BATTERY") > -1 && !merged.some(function (i) { return normalizeControlId(i).indexOf("BATTERY") > -1; })) add("BATTERY_MASTER");
  return merged;
}

export function isObservedBinarySwitchControlId(value) {
  const n = normalizeControlId(value);
  return isLandingLightControlId(n) || isPitotHeatControlId(n) || isAntiCollisionControlId(n) || isCautionLightTestControlId(n) ||
    n.indexOf("AUTOFEATHER") > -1 || n.indexOf("BOOSTPUMP") > -1 || n.indexOf("BATTERY") > -1 || n.indexOf("GENERATOR") > -1 ||
    /LIGHT$/.test(n) || /LIGHTS$/.test(n);
}

export function safeContainsControlId(a, b) {
  const l = normalizeControlId(a), r = normalizeControlId(b);
  if (!l || !r || l.length < 4 || r.length < 4) return false;
  return l.indexOf(r) > -1 || r.indexOf(l) > -1;
}

export function switchStateForExpectedId(switchStates, expectedId) {
  const wanted = normalizeControlId(expectedId);
  if (!wanted) return null;
  if (switchStates[expectedId]) return switchStates[expectedId];
  const keys = Object.keys(switchStates);
  for (let i = 0; i < keys.length; i += 1) {
    if (normalizeControlId(keys[i]) === wanted || safeContainsControlId(keys[i], expectedId) || areKnownAliases(keys[i], expectedId)) return switchStates[keys[i]];
  }
  return null;
}

export function switchStateSatisfiesAction(controlId, state, stepAction) {
  const control = normalizeControlId(controlId), action = normalizeControlId(stepAction);
  if (!isObservedBinarySwitchControlId(control)) return true;
  if (isCautionLightTestControlId(control) && action.indexOf("TEST") > -1) return state === "LEFT" || state === "UP" || state === "MOMENTARY";
  if (isCautionLightTestControlId(control) && action.indexOf("OFF") > -1) return state === "CENTER";
  if (isCautionLightTestControlId(control) && action.indexOf("ON") > -1) return state === "RIGHT" || state === "DOWN";
  if (action.indexOf("OFF") > -1) return state === "LEFT" || state === "DOWN";
  if (action.indexOf("ON") > -1 || action.indexOf("SET") > -1 || action.indexOf("ARM") > -1 || action.indexOf("SELECT") > -1) return state === "RIGHT" || state === "UP" || state === "MOMENTARY";
  return true;
}
export function isLandingLightOffState(state) { return state === "LEFT" || state === "DOWN"; }

export function flapLeverPositionSatisfiesAction(position, stepAction) {
  const p = Math.min(1, Math.max(0, position)), action = normalizeControlId(stepAction);
  if (action.indexOf("DOWN") > -1 || action.indexOf("FULL") > -1 || action.indexOf("375") > -1 || action.indexOf("37") > -1) return p <= 0.42;
  if (action.indexOf("20") > -1) return p >= 0.30 && p <= 0.78;
  if (action.indexOf("10") > -1) return p >= 0.50 && p <= 0.98;
  if (action.indexOf("UP") > -1 || action.indexOf("ZERO") > -1 || /0$/.test(action)) return p >= 0.58;
  return true;
}
export function powerLeverPositionSatisfiesAction(position, stepAction) {
  const raw = Math.min(1, Math.max(0, position)), forward = 1 - raw, action = normalizeControlId(stepAction);
  if (["TAKEOFF", "TAKEOFFPOWER", "MAXIMUMPOWER", "MAXPOWER"].some(function (t) { return action.indexOf(t) > -1; })) return forward >= 0.72;
  if (action.indexOf("CLIMB") > -1) return forward >= 0.40;
  if (action.indexOf("CRUISE") > -1) return forward >= 0.32;
  if (["IDLE", "ZERO", "REVERSE", "RETARD", "CLOSED", "CLOSE"].some(function (t) { return action.indexOf(t) > -1; })) return forward <= 0.40;
  return true;
}
export function leverPositionSatisfiesAction(controlId, position, stepAction) {
  if (isFlapSelectorControlId(controlId)) return flapLeverPositionSatisfiesAction(position, stepAction);
  if (isPowerLeverControlId(controlId)) return powerLeverPositionSatisfiesAction(position, stepAction);
  return true;
}
export function leverPositionForControlId(leverPositions, controlId) {
  if (leverPositions[controlId] != null) return leverPositions[controlId];
  const keys = Object.keys(leverPositions);
  for (let i = 0; i < keys.length; i += 1) {
    if (normalizeControlId(keys[i]) === normalizeControlId(controlId) || safeContainsControlId(keys[i], controlId) || areKnownAliases(keys[i], controlId)) return leverPositions[keys[i]];
  }
  return null;
}
export function matchingExpectedControlId(eventControlId, expectedIds) {
  const n = normalizeControlId(eventControlId);
  if (!n) return null;
  for (let i = 0; i < expectedIds.length; i += 1) {
    const expected = String(expectedIds[i]).trim();
    const ne = normalizeControlId(expected);
    if (ne && (n === ne || areKnownAliases(eventControlId, expected))) return expected;
  }
  return null;
}
export function requiredPositionLabelForAction(action) {
  const n = normalizeControlId(action);
  if (n.indexOf("TEST") > -1) return "TEST";
  if (n.indexOf("OFF") > -1) return "OFF";
  if (n.indexOf("ON") > -1) return "ON";
  if (n.indexOf("375") > -1 || n.indexOf("37") > -1 || n.indexOf("FULL") > -1 || n.indexOf("DOWN") > -1) return "FULL / 37.5°";
  if (n.indexOf("20") > -1) return "20°";
  if (n.indexOf("10") > -1) return "10°";
  if (n.indexOf("TAKEOFF") > -1 || n.indexOf("MAXPOWER") > -1 || n.indexOf("MAXIMUMPOWER") > -1) return "TAKEOFF / MAX";
  if (n.indexOf("CLIMB") > -1) return "CLIMB POWER";
  if (n.indexOf("CRUISE") > -1) return "CRUISE POWER";
  if (n.indexOf("IDLE") > -1 || n.indexOf("REVERSE") > -1 || (n.indexOf("ZERO") > -1 && n.indexOf("POWER") > -1)) return "IDLE / REQUIRED POWER";
  if (n.indexOf("UP") > -1 || n.indexOf("ZERO") > -1 || /0$/.test(n)) return "UP / 0°";
  if (n.indexOf("SET") > -1) return "SET";
  return "the required position";
}

/* ------------------------------------------------------------ action cues */
export function humanizeControlId(controlId) {
  if (normalizeControlId(controlId) === "CHECKLISTCLOSE") return "Checklist Close";
  return String(controlId || "").trim().replace(/-/g, "_").split("_").filter(Boolean)
    .map(function (t) { return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase(); }).join(" ");
}
export function drillTargetLabel(controlId) {
  const n = normalizeControlId(controlId);
  if (n === "CHECKLIST") return "Checklist ON";
  if (n === "CHECKLISTCLOSE") return "Checklist OFF";
  if (n === "POWERLEVERL") return "Left Power Lever";
  if (n === "POWERLEVERR") return "Right Power Lever";
  if (n === "POWERLEVERS") return "Prop Levers";
  return humanizeControlId(controlId);
}
export function isCheckedAction(action) {
  const n = String(action || "").trim().toLowerCase();
  return n === "checked" || n.indexOf(" checked") > -1 || n.indexOf("checks complete") > -1 || n.indexOf("check complete") > -1 || n.indexOf("complete") > -1 || n.indexOf("confirm") > -1;
}
export function isQuestionOrChallengeAction(action) {
  const raw = String(action || "").trim();
  if (raw.indexOf("?") > -1) return true;
  const n = normalizeControlId(raw);
  if (!n) return false;
  return /QUESTION$/.test(n) || /CHECK$/.test(n) || /CHECKS$/.test(n) || /CONFIRM$/.test(n);
}
export function isGenericAsRequiredResponseAction(action) {
  const n = normalizeControlId(action);
  if (n.indexOf("ASREQUIRED") === -1) return false;
  return !["FLAP", "AUTOFEATHER", "TRANSPONDER", "LIGHT", "BLEED", "TRIM", "PITOT", "GEN", "BATTERY", "FUEL", "POWER", "PROP", "CONDITION", "CHECKLIST"].some(function (w) { return n.indexOf(w) > -1; });
}
export function isChecklistDisplayCue(action) {
  const n = String(action || "").trim().toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (!n) return false;
  if (n.indexOf("COMPLETE") > -1 || n === "CHECKED") return false;
  return n === "CHECKLIST" || / CHECKLIST$/.test(n) || / CHECKS$/.test(n) || / CHECK$/.test(n);
}
export function isMandatoryCockpitActionCue(action) {
  if (isQuestionOrChallengeAction(action)) return false;
  if (isGenericAsRequiredResponseAction(action)) return false;
  if (isChecklistDisplayCue(action)) return false;
  const n = normalizeControlId(action);
  if (!n) return false;
  if (isCheckedAction(action) && n.indexOf("TEST") === -1) return false;
  return ["SELECT", "SELECTED", "SET", "OFF", "ON", "UP", "DOWN", "OPEN", "CLOSE", "CLOSED", "ARM", "ARMED", "TEST", "STANDBY", "GROUND", "IDLE", "POWER", "TAKEOFF", "CLIMB", "CRUISE", "MAXIMUM", "REVERSE", "FEATHER", "7600"]
    .some(function (w) { return n.indexOf(w) > -1; });
}
export function isAfterLandingChecklistCloseCue(procedureKey, action, stepIndex, totalSteps) {
  if (stepIndex !== totalSteps - 1) return false;
  if (normalizeControlId(procedureKey).indexOf("AFTERLANDING") === -1) return false;
  const n = normalizeControlId(action);
  return n === "CHECKED" || n === "CHECKSCOMPLETE";
}
export function isChecklistTargetId(value) { const n = normalizeControlId(value); return n === "CHECKLIST" || n === "CHECKLISTCLOSE"; }

/* ------------------------------------------------------------- grading */
export const GRADING = {
  totalErrors: function (c) { return c.wrongRoleCount + c.wrongCalloutCount + c.rushedCount; },
  scorePercent: function (c) {
    const penalty = c.wrongRoleCount * 20 + c.wrongCalloutCount * 15 + c.rushedCount * 10 + c.toleranceUsedCount * 3;
    return Math.min(100, Math.max(0, 100 - penalty));
  },
  scoreBand: function (c) {
    const score = GRADING.scorePercent(c);
    if (score >= 97 && GRADING.totalErrors(c) === 0) return "EXCELLENT";
    if (score >= 90) return "GOOD";
    if (score >= 80) return "SATISFACTORY";
    if (score >= 70) return "MARGINAL";
    if (score >= 60) return "UNSATISFACTORY";
    return "FAIL";
  },
  remarks: function (c) {
    const parts = ["Score " + GRADING.scorePercent(c) + "%"];
    if (c.wrongRoleCount > 0) parts.push("Role deviations " + c.wrongRoleCount);
    if (c.wrongCalloutCount > 0) parts.push("Callout/action errors " + c.wrongCalloutCount);
    if (c.rushedCount > 0) parts.push("Timing deviations " + c.rushedCount);
    if (c.toleranceUsedCount > 0) parts.push("Tolerance used " + c.toleranceUsedCount);
    if (parts.length === 1) parts.push("Clean run");
    return parts.join(" • ");
  },
  instructorFeedback: function (c) {
    switch (GRADING.scoreBand(c)) {
      case "EXCELLENT": return "Line standard. Maintain the same tempo and discipline.";
      case "GOOD": return "Good control. Tighten minor deviations and standardize callouts.";
      case "SATISFACTORY": return "Acceptable overall. Review memory discipline and PM/PF role separation.";
      case "MARGINAL": return "Below line standard. Repeat the drill with emphasis on sequence and timing.";
      default: return "Unsatisfactory. Rebrief the procedure, then repeat from the top under instruction.";
    }
  }
};

export function formatDuration(valueMs) {
  const seconds = Math.floor(valueMs / 1000), minutes = Math.floor(seconds / 60), rem = seconds % 60;
  return minutes > 0 ? minutes + "m " + String(rem).padStart(2, "0") + "s" : seconds + "s";
}

export function inferredPhaseForProgress(totalSteps, stepIndex) {
  if (totalSteps <= 1) return "BEFORE";
  const n = Math.min(1, Math.max(0, stepIndex / Math.max(1, totalSteps - 1)));
  return n < 0.34 ? "BEFORE" : n < 0.67 ? "DURING" : "AFTER";
}

export const TRAINEE_SLOW_THRESHOLD_MS = 7000;

/* The MCC flow run: step cursor, expected cockpit targets, scoring and the logbook entry. */
export function createDrillRun(opts) {
  const steps = (opts.steps || []).slice();
  const now = opts.now || function () { return Date.now(); };
  const state = {
    procedureId: opts.procedureId, procedureName: opts.procedureName, category: opts.category, variant: opts.variant,
    traineeRole: opts.traineeRole || "PF", stepIndex: 0, started: false, completed: false,
    expectedIds: [], focusIds: [], status: "Ready to run the drill.", feedback: null, severity: "INFO",
    wrongRoleCount: 0, wrongCalloutCount: 0, rushedCount: 0, toleranceUsedCount: 0, stepLatencies: [],
    stepStartedAt: now(), sessionStartedAt: now(), attemptId: "scenario-" + now() + "-" + Math.random().toString(36).slice(2, 10),
    selectedTargetId: null, advancePending: false, alreadyCorrect: null,
    finalScorePercent: null, finalScoreBand: null
  };
  function counters() { return { wrongRoleCount: state.wrongRoleCount, wrongCalloutCount: state.wrongCalloutCount, rushedCount: state.rushedCount, toleranceUsedCount: state.toleranceUsedCount }; }
  const listeners = [];
  function emit() { listeners.forEach(function (fn) { fn(state); }); }

  function isTraineeLine(step) {
    if (!step) return false;
    return state.traineeRole === "PF" ? (step.crewRole === "PF" || step.crewRole === "BOTH") : (step.crewRole === "PM" || step.crewRole === "BOTH");
  }
  function isOppositeRoleLine(step) {
    if (!step) return false;
    return state.traineeRole === "PF" ? step.crewRole === "PM" : step.crewRole === "PF";
  }

  function resolveStep() {
    const step = steps[state.stepIndex];
    state.selectedTargetId = null; state.advancePending = false; state.alreadyCorrect = null;
    state.stepStartedAt = now();
    if (!step) { state.expectedIds = []; state.focusIds = []; return; }
    let ids;
    if (isAfterLandingChecklistCloseCue(state.procedureId, step.action, state.stepIndex, steps.length)) ids = ["CHECKLIST_CLOSE"];
    else if (isChecklistDisplayCue(step.action)) ids = ["CHECKLIST"];
    else if (step.targets && step.targets.length) ids = step.targets.slice();
    else ids = opts.lookupHitboxes ? (opts.lookupHitboxes(step.action) || []) : [];
    const aligned = opts.resolveHitboxes ? opts.resolveHitboxes(ids) : ids;
    const actionable = opts.resolveActionableHitboxes ? opts.resolveActionableHitboxes(aligned) : aligned;
    const requireAction = isTraineeLine(step) && isMandatoryCockpitActionCue(step.action) && actionable.length > 0;
    state.focusIds = aligned;
    state.expectedIds = requireAction ? resolvedExpectedTargetIds(step.action, actionable) : [];
    state.status = state.expectedIds.length ? "Select " + (drillTargetLabel(state.expectedIds[0]) || "cockpit control") + "."
      : aligned.length ? "Review " + drillTargetLabel(aligned[0]) + ". Next when ready."
        : isOppositeRoleLine(step) ? step.crewRole + " callout. Next when ready."
          : isTraineeLine(step) && isCheckedAction(step.action) ? "Say CHECKED. Next when ready."
            : isTraineeLine(step) ? "Your line. Next when ready." : "Shared crew line.";
  }

  function complete() {
    const c = counters();
    state.completed = true;
    state.finalScorePercent = GRADING.scorePercent(c);
    state.finalScoreBand = GRADING.scoreBand(c);
    state.status = "Drill complete. " + state.finalScoreBand + " " + state.finalScorePercent + "%.";
    state.feedback = "Drill complete. " + GRADING.remarks(c) + " " + GRADING.instructorFeedback(c);
    state.severity = ["EXCELLENT", "GOOD", "SATISFACTORY"].indexOf(state.finalScoreBand) > -1 ? "INFO" : state.finalScoreBand === "MARGINAL" ? "WARNING" : "FAIL";
    if (opts.onComplete) opts.onComplete(api.logbookEntry());
  }

  function advance(matchedControlId) {
    state.advancePending = true;
    state.selectedTargetId = matchedControlId;
    const elapsed = now() - state.stepStartedAt;
    state.stepLatencies.push(elapsed);
    if (elapsed > TRAINEE_SLOW_THRESHOLD_MS) state.rushedCount += 1;
    state.feedback = "Correct."; state.severity = "INFO"; state.status = "Correct. Advancing...";
    emit();
    if (state.stepIndex < steps.length - 1) { state.stepIndex += 1; resolveStep(); } else complete();
    emit();
  }

  const api = {
    state: state,
    steps: steps,
    onChange: function (fn) { listeners.push(fn); },
    current: function () { return steps[state.stepIndex] || null; },
    next: function () { return steps[state.stepIndex + 1] || null; },
    isTraineeLine: isTraineeLine,
    isOppositeRoleLine: isOppositeRoleLine,
    counters: counters,
    liveScorePercent: function () { return GRADING.scorePercent(counters()); },
    liveScoreBand: function () { return GRADING.scoreBand(counters()); },
    liveInstructorStandard: function () { return GRADING.instructorFeedback(counters()); },
    totalElapsedMs: function () { return state.stepLatencies.reduce(function (a, b) { return a + b; }, 0); },
    averageLatencyMs: function () { return state.stepLatencies.length ? Math.round(api.totalElapsedMs() / state.stepLatencies.length) : 0; },
    maxLatencyMs: function () { return state.stepLatencies.length ? Math.max.apply(null, state.stepLatencies) : 0; },
    phase: function () { return inferredPhaseForProgress(steps.length, state.stepIndex); },
    setRole: function (role) {
      state.traineeRole = role; state.stepIndex = 0; state.started = false; state.completed = false;
      state.wrongRoleCount = 0; state.wrongCalloutCount = 0; state.rushedCount = 0; state.toleranceUsedCount = 0; state.stepLatencies = [];
      state.finalScorePercent = null; state.finalScoreBand = null; state.feedback = null;
      state.attemptId = "scenario-" + now() + "-" + Math.random().toString(36).slice(2, 10);
      state.sessionStartedAt = now();
      resolveStep(); emit();
    },
    start: function () { state.started = true; resolveStep(); emit(); },
    restart: function () { api.setRole(state.traineeRole); state.started = true; state.status = "Drill reset to item 1."; emit(); },
    previous: function () { if (state.stepIndex > 0) { state.stepIndex -= 1; resolveStep(); emit(); } },
    /* "Next" is locked while the step has an unsatisfied cockpit target. */
    nextLocked: function () { return state.started && !state.completed && state.expectedIds.length > 0 && state.selectedTargetId == null; },
    advanceManually: function () {
      if (api.nextLocked()) {
        const label = state.expectedIds.length ? drillTargetLabel(state.expectedIds[0]) : "yellow control";
        state.feedback = "Locked: complete " + label + " to continue."; state.severity = "WARNING";
        state.status = "Locked until " + label + " is complete.";
        emit(); return false;
      }
      if (state.stepIndex >= steps.length - 1) { if (!state.completed) complete(); emit(); return true; }
      state.stepLatencies.push(now() - state.stepStartedAt);
      state.stepIndex += 1; resolveStep(); emit(); return true;
    },
    confirmAlreadyCorrect: function () { if (state.alreadyCorrect) { const id = state.alreadyCorrect.controlId; state.alreadyCorrect = null; advance(id); } },
    /* Feed control events from the renderer / interaction controller. */
    handleControlEvent: function (event, switchStates, leverPositions) {
      const step = api.current();
      if (!state.started || state.completed || !step || state.advancePending) return;
      if (state.alreadyCorrect) { state.status = "Confirm " + state.alreadyCorrect.label + ", which is already " + state.alreadyCorrect.requiredPosition + ", to continue."; emit(); return; }
      if (!state.expectedIds.length) {
        state.feedback = state.focusIds.length ? "Reference item only. Use Next when ready." : "No cockpit target. Use Next.";
        state.severity = "INFO"; emit(); return;
      }
      const matched = matchingExpectedControlId(event.controlId, state.expectedIds);
      if (!matched) { state.feedback = "Not that one. Use the required cockpit item."; state.severity = "WARNING"; emit(); return; }
      if (isLandingLightsOffAction(step.action) && isLandingLightControlId(matched)) {
        const l = switchStateForExpectedId(switchStates, "LANDING_LIGHT_L"), r = switchStateForExpectedId(switchStates, "LANDING_LIGHT_R");
        if (isLandingLightOffState(l) && isLandingLightOffState(r)) advance("LANDING_LIGHTS");
        else { state.status = "Set both landing light switches to OFF to continue."; state.feedback = "Set both landing lights OFF."; emit(); }
        return;
      }
      if (state.expectedIds.some(isPowerLeverControlId) && isPowerLeverControlId(matched)) {
        const ids = state.expectedIds.filter(isPowerLeverControlId);
        const satisfied = (ids.length ? ids : ["POWER_LEVER_L", "POWER_LEVER_R"]).every(function (id) {
          const p = leverPositionForControlId(leverPositions, id);
          return p != null && powerLeverPositionSatisfiesAction(p, step.action);
        });
        if (satisfied) advance("POWER_LEVERS");
        else { const need = requiredPositionLabelForAction(step.action); state.status = "Set both power levers to " + need + "."; state.feedback = "Set both power levers to " + need + "."; emit(); }
        return;
      }
      if (event.kind === "lever" || event.kind === "action") {
        const p = leverPositionForControlId(leverPositions, matched);
        if (p != null && !leverPositionSatisfiesAction(matched, p, step.action)) {
          const need = requiredPositionLabelForAction(step.action);
          state.status = "Move " + humanizeControlId(matched) + " to " + need + "."; emit(); return;
        }
      }
      if (event.kind === "switch" && !switchStateSatisfiesAction(matched, event.newState, step.action)) {
        const need = requiredPositionLabelForAction(step.action);
        state.feedback = "Move it to " + need + "."; state.status = "Move " + humanizeControlId(matched) + " to " + need + "."; emit(); return;
      }
      advance(matched);
    },
    /* Called after the snapshot is applied so a control that is already correct asks for a confirm. */
    checkAlreadyCorrect: function (switchStates) {
      const step = api.current();
      if (!state.started || state.completed || state.advancePending || state.alreadyCorrect || !step) return;
      const expectedSwitchId = state.expectedIds.find(isObservedBinarySwitchControlId);
      if (!expectedSwitchId) return;
      const current = switchStateForExpectedId(switchStates, expectedSwitchId);
      if (!current) return;
      if (!switchStateSatisfiesAction(expectedSwitchId, current, step.action)) return;
      state.alreadyCorrect = { controlId: expectedSwitchId, label: humanizeControlId(expectedSwitchId), requiredPosition: requiredPositionLabelForAction(step.action) };
      state.status = state.alreadyCorrect.label + " is already " + state.alreadyCorrect.requiredPosition + ". Confirm this item to continue.";
      emit();
    },
    logbookEntry: function () {
      const c = counters();
      const band = state.finalScoreBand || GRADING.scoreBand(c);
      return {
        timestampUtc: state.sessionStartedAt, procedureName: state.procedureName, category: state.category, aircraftVariant: state.variant,
        totalSteps: steps.length, wrongRoleCount: c.wrongRoleCount, wrongCalloutCount: c.wrongCalloutCount, rushedCount: c.rushedCount,
        toleranceUsedCount: c.toleranceUsedCount, totalTimeMs: api.totalElapsedMs(), scoreBand: band,
        scorePercent: state.finalScorePercent != null ? state.finalScorePercent : GRADING.scorePercent(c),
        remarks: GRADING.remarks(c), instructorFeedback: GRADING.instructorFeedback(c), examinerOverride: false, examinerMode: "OFF",
        attemptId: state.attemptId, stepLatencies: state.stepLatencies.slice(), kind: "scenario-drill"
      };
    }
  };
  resolveStep();
  return api;
}
