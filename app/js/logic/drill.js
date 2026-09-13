/*
  Interactive procedure drill state machine — port of
  feature-procedures/ui/screens/ProcedureDrillPane.kt.
  Memory phase: one-at-a-time card reveal with GOT IT / MISSED scoring.
  Flow phase: checklist with tap-to-check steps.
  Summary phase: scorecard + ProcedureDrillResult.
*/

export function createDrill(opts) {
  const memorySteps = (opts.memorySteps || []).slice();
  const flowSteps = (opts.flowSteps || []).slice();
  const now = opts.now || function () { return Date.now(); };
  const state = {
    procedureId: opts.procedureId,
    procedureName: opts.procedureName,
    category: opts.category,
    memorySteps: memorySteps,
    flowSteps: flowSteps,
    phase: memorySteps.length ? "MEMORY" : "FLOW",
    cards: memorySteps.map(function (step) { return { step: step, revealed: false, result: "PENDING" }; }),
    memoryIndex: 0,
    flowChecked: flowSteps.map(function () { return false; }),
    startedAt: now(),
    completionReported: false,
    result: null
  };

  function counts() {
    return {
      memoryTotal: state.cards.length,
      memoryDone: state.cards.filter(function (c) { return c.result !== "PENDING"; }).length,
      memoryCorrect: state.cards.filter(function (c) { return c.result === "CORRECT"; }).length,
      memoryMissed: state.cards.filter(function (c) { return c.result === "MISSED"; }).length,
      flowTotal: state.flowChecked.length,
      flowDone: state.flowChecked.filter(Boolean).length
    };
  }

  function maybeReport() {
    if (state.phase === "SUMMARY" && !state.completionReported) {
      state.completionReported = true;
      const c = counts();
      const totalItems = c.memoryTotal + c.flowTotal;
      const completedItems = c.memoryCorrect + c.flowDone;
      const percent = totalItems > 0 ? Math.min(100, Math.max(0, Math.round((completedItems / totalItems) * 100))) : 0;
      state.result = {
        procedureId: state.procedureId,
        procedureName: state.procedureName,
        memoryTotal: c.memoryTotal,
        memoryCorrect: c.memoryCorrect,
        memoryMissed: c.memoryMissed,
        flowTotal: c.flowTotal,
        flowCompleted: c.flowDone,
        scorePercent: percent,
        elapsedMs: now() - state.startedAt,
        completedAtUtcMs: now()
      };
      if (opts.onComplete) opts.onComplete(state.result);
    }
  }

  return {
    state: state,
    counts: counts,
    current: function () { return state.cards[state.memoryIndex] || null; },
    reveal: function () {
      const card = state.cards[state.memoryIndex];
      if (card) card.revealed = true;
    },
    score: function (correct) {
      const card = state.cards[state.memoryIndex];
      if (!card) return;
      card.result = correct ? "CORRECT" : "MISSED";
      if (state.memoryIndex + 1 < state.cards.length) state.memoryIndex += 1;
      else state.phase = state.flowSteps.length ? "FLOW" : "SUMMARY";
      maybeReport();
    },
    toggleFlow: function (index) {
      if (index >= 0 && index < state.flowChecked.length) state.flowChecked[index] = !state.flowChecked[index];
    },
    finishFlow: function () { state.phase = "SUMMARY"; maybeReport(); },
    restart: function () {
      state.cards = state.memorySteps.map(function (step) { return { step: step, revealed: false, result: "PENDING" }; });
      state.memoryIndex = 0;
      state.flowChecked = state.flowSteps.map(function () { return false; });
      state.phase = state.memorySteps.length ? "MEMORY" : "FLOW";
      state.startedAt = now();
      state.completionReported = false;
      state.result = null;
    }
  };
}

/* ProcedureDrillLogbookMapper.toLogbookEntry — band thresholds and remarks. */
export function drillScoreBand(scorePercent) {
  if (scorePercent >= 95) return "EXCELLENT";
  if (scorePercent >= 85) return "GOOD";
  if (scorePercent >= 75) return "SATISFACTORY";
  if (scorePercent >= 60) return "MARGINAL";
  return "UNSATISFACTORY";
}

export function drillResultToLogbookEntry(result, category, aircraftVariant) {
  const flowRemaining = Math.max(0, result.flowTotal - result.flowCompleted);
  const reviewCount = result.memoryMissed + flowRemaining;
  return {
    timestampUtc: result.completedAtUtcMs,
    procedureName: result.procedureName,
    category: category,
    aircraftVariant: aircraftVariant,
    totalSteps: Math.max(0, result.memoryTotal + result.flowTotal),
    wrongRoleCount: 0,
    wrongCalloutCount: reviewCount,
    rushedCount: 0,
    toleranceUsedCount: 0,
    totalTimeMs: result.elapsedMs,
    scoreBand: drillScoreBand(result.scorePercent),
    scorePercent: result.scorePercent,
    remarks: "Procedure drill completed. Memory " + result.memoryCorrect + "/" + result.memoryTotal + ", flow " + result.flowCompleted + "/" + result.flowTotal + ".",
    instructorFeedback: null,
    examinerOverride: false,
    examinerMode: "OFF",
    attemptId: "procedure-drill-" + result.completedAtUtcMs + "-" + hashCode(result.procedureId),
    stepLatencies: [],
    kind: "procedure-drill"
  };
}

/* java.lang.String.hashCode — keeps attempt ids identical to Android. */
export function hashCode(text) {
  let hash = 0;
  const s = String(text || "");
  for (let i = 0; i < s.length; i += 1) hash = (Math.imul(31, hash) + s.charCodeAt(i)) | 0;
  return hash;
}
