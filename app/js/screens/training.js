/*
  Training screens — ports of feature-training/ui:
    quizzes/QuizHomeScreen + QuizRunScreen, performance/PerformanceCalcScreen,
    calculators/CalculatorScreens (FuelPlanScreen, WeightBalanceScreen, CgEnvelopeChart),
    dashboard/LogbookScreen (local entries), CompetencyDashboard / OralExam / CrmDrill (later).
*/
import { h, Store, Content, currentVariant, feature } from "../core.js";
import { screen, blueCard, libraryDivider, backText, backTonal, backBubble, matButton, sliderRow, selectableChip, field, contentUnavailable, statusPill, notice, navCard } from "../ui.js";
import { knowledgePool } from "../data.js";
import * as Q from "../logic/quiz.js";
import * as PERF from "../logic/performance.js";
import * as CMP from "../logic/competency.js";
import { FuelPlanCalculator, WeightBalanceCalculator, OCCUPANT_TYPES, nextOccupant, CG_ENVELOPE } from "../logic/calculators.js";

/* ---------------------------------------------------------------- Quizzes */
const quizHomeState = { variant: null, length: "20", system: "" };
export async function quizHome(ctx) {
  ctx.setTopbar({ title: "Quizzes", subtitle: "STATUS:CANDIDATE knowledge pool", back: "#/knowledge/home" });
  if (!quizHomeState.variant) quizHomeState.variant = currentVariant();
  let units;
  try { units = await knowledgePool(); } catch (error) { if (error && (error.status === 401 || error.status === 403)) throw error; return screen({ header: [matButton("Back", function () { ctx.navigate("/knowledge/home"); })], title: "Quizzes" }, [contentUnavailable("knowledge-pool", error)]); }
  const root = h("div", { class: "stack-12" });
  function render() {
    const variantValue = quizHomeState.variant.trim().toUpperCase();
    const validVariant = ["LEGACY", "G950", "BOTH"].includes(variantValue);
    const count = validVariant ? Q.candidateCount(units, variantValue) : 0;
    const len = Math.min(200, Math.max(5, parseInt(quizHomeState.length, 10) || 20));
    const system = quizHomeState.system.trim().toUpperCase() || "";
    const variantInput = h("input", { type: "text", value: quizHomeState.variant, "aria-label": "VARIANT (LEGACY / G950 / BOTH)", autocapitalize: "characters" });
    variantInput.addEventListener("input", function () { quizHomeState.variant = variantInput.value; countEl.textContent = "Candidate pool: " + (["LEGACY", "G950", "BOTH"].includes(variantInput.value.trim().toUpperCase()) ? Q.candidateCount(units, variantInput.value.trim().toUpperCase()) : 0); });
    const lenInput = h("input", { type: "text", inputmode: "numeric", value: quizHomeState.length, "aria-label": "LENGTH (e.g., 10 / 20 / 30)" });
    lenInput.addEventListener("input", function () { lenInput.value = lenInput.value.replace(/\D/g, "").slice(0, 3); quizHomeState.length = lenInput.value; });
    const sysInput = h("input", { type: "text", value: quizHomeState.system, "aria-label": "OPTIONAL SYSTEM FILTER (e.g., FUEL / ELECTRICAL)", autocapitalize: "characters" });
    sysInput.addEventListener("input", function () { quizHomeState.system = sysInput.value; });
    const countEl = h("div", { class: "t-body-m c-white", text: "Candidate pool: " + count });
    root.replaceChildren(
      h("div", { class: "row gap-10" }, [matButton("Back", function () { ctx.navigate("/knowledge/home"); }), h("h2", { class: "t-headline-s c-white", text: "Quizzes" })]),
      h("p", { class: "t-body-m", style: "color:var(--white-secondary)", text: "Quiz pool = STATUS:CANDIDATE cards only (quality gate)." }),
      field("VARIANT (LEGACY / G950 / BOTH)", variantInput),
      field("LENGTH (e.g., 10 / 20 / 30)", lenInput),
      field("OPTIONAL SYSTEM FILTER (e.g., FUEL / ELECTRICAL)", sysInput),
      countEl,
      matButton("Start Quiz", function () {
        const v = variantInput.value.trim().toUpperCase();
        const l = Math.min(200, Math.max(5, parseInt(lenInput.value, 10) || 20));
        const s = sysInput.value.trim().toUpperCase();
        ctx.navigate("/quizzes/run/" + encodeURIComponent(v) + "/" + l + (s ? "?sys=" + encodeURIComponent(s) : ""));
      }, { block: true, disabled: count <= 0 }),
      h("div", { class: "t-body-s c-ter", text: "Systems in the pool: " + Array.from(new Set(units.map(function (u) { return u.system; }))).sort().join(", ") })
    );
    void len; void system;
  }
  render();
  return screen({ ariaLabel: "Quizzes" }, [root]);
}

export async function quizRun(ctx) {
  const variantStr = String(ctx.params.variant || "BOTH").toUpperCase();
  const length = Math.min(200, Math.max(5, parseInt(ctx.params.length, 10) || 20));
  const systemOrNull = (ctx.query.get("sys") || "").trim().toUpperCase() || null;
  ctx.setTopbar({ title: "Quiz", subtitle: variantStr + " · " + length + " questions" + (systemOrNull ? " · " + systemOrNull : ""), back: "#/quizzes" });
  let units;
  try { units = await knowledgePool(); } catch (error) { if (error && (error.status === 401 || error.status === 403)) throw error; return screen({ title: "Quiz" }, [contentUnavailable("knowledge-pool", error)]); }
  const root = h("div", { class: "stack-12" });
  const run = {};
  function start() {
    const pool = Q.loadCandidatePool(units, variantStr, systemOrNull);
    run.quiz = Q.buildQuiz(pool, length);
    run.idx = 0; run.chosen = null; run.reveal = false; run.results = []; run.completed = null;
    run.startedAt = Date.now(); run.questionStart = performance.now();
    render();
  }
  function commitAndNext() {
    const q = run.quiz[run.idx];
    if (!q) return;
    const elapsed = Math.max(0, Math.round(performance.now() - run.questionStart));
    const correct = run.chosen != null && run.chosen === q.correctIndex;
    run.results.push({ itemId: q.item.id, prompt: q.item.title, correctOptionIndex: q.correctIndex, chosenOptionIndex: run.chosen, optionSnippets: q.options.map(function (o) { return o.snippet; }), isCorrect: correct, timeMs: elapsed });
    if (run.idx >= run.quiz.length - 1) {
      run.completed = { variantStr: variantStr, length: run.quiz.length, systemNameOrNull: systemOrNull, startedAtEpochMs: run.startedAt, finishedAtEpochMs: Date.now(), questions: run.results.slice() };
    } else { run.idx += 1; run.chosen = null; run.reveal = false; run.questionStart = performance.now(); }
    render();
  }
  function exitBtn() { return matButton("Exit", function () { ctx.navigate("/quizzes"); }); }
  function render() {
    const head = h("div", { class: "row gap-10" }, [exitBtn(), h("h2", { class: "t-headline-s c-white", text: "Quiz" })]);
    if (run.completed) { root.replaceChildren(head, summary(run.completed)); return; }
    const q = run.quiz[run.idx];
    if (!q) { root.replaceChildren(head, h("p", { class: "t-body-m c-white", text: "No quiz items available (candidate pool empty or filtered out)." })); return; }
    const options = q.options.map(function (opt, i) {
      const isChosen = run.chosen === i;
      const isCorrect = run.reveal && i === q.correctIndex;
      const isWrongChosen = run.reveal && isChosen && i !== q.correctIndex;
      const tone = isCorrect ? " [CORRECT]" : isWrongChosen ? " [REVIEW]" : "";
      return h("button", { class: "quiz-option" + (isChosen ? " chosen" : "") + (isCorrect ? " correct" : "") + (isWrongChosen ? " wrong" : ""), type: "button", disabled: run.reveal ? true : null, "aria-pressed": isChosen ? "true" : "false", text: String.fromCharCode(65 + i) + ". " + opt.snippet + tone, onclick: function () { if (!run.reveal) { run.chosen = i; render(); } } });
    });
    root.replaceChildren(
      head,
      h("div", { class: "t-body-m", style: "color:var(--white-secondary)", text: "Q " + (run.idx + 1) + " / " + run.quiz.length }),
      h("div", { class: "t-title-l c-white", text: q.item.title || "Untitled" }),
      h("div", { class: "t-body-s", style: "color:var(--white-secondary)", text: Q.quizSourceLine(q.item) }),
      h("div", { class: "stack-8 mt-6" }, options),
      h("div", { class: "row gap-10 wrap mt-6" }, [
        matButton("Grade", function () { run.reveal = true; render(); }, { disabled: run.chosen == null || run.reveal }),
        matButton(run.idx === run.quiz.length - 1 ? "Finish" : "Next", commitAndNext, { disabled: !run.reveal })
      ]),
      h("p", { class: "t-body-s", style: "color:var(--white-secondary)", text: "Tip: If extraction is wrong, Source → Edit, then re-triage to keep quizzes clean." })
    );
  }
  function summary(result) {
    const total = Math.max(1, result.questions.length);
    const correct = result.questions.filter(function (x) { return x.isCorrect; }).length;
    const missed = result.questions.filter(function (x) { return !x.isCorrect; });
    const percent = Math.floor((correct * 100) / total);
    const elapsed = Math.max(0, result.finishedAtEpochMs - result.startedAtEpochMs);
    const average = result.questions.length ? Math.floor(result.questions.reduce(function (s, x) { return s + x.timeMs; }, 0) / result.questions.length) : 0;
    let saved = false;
    const saveBtn = matButton("Save & exit", function () {
      if (!saved) { Store.addLogbookEntry(Q.quizResultToLogbookEntry(result)); Store.recordAttempt({ id: "quiz", kind: "quiz", title: "Knowledge Quiz", score: percent }); saved = true; }
      ctx.navigate("/quizzes");
    });
    return h("div", { class: "stack-12" }, [
      h("div", { class: "t-headline-s c-white", text: "Quiz result" }),
      blueCard([
        h("div", { class: "t-title-l c-white", text: "Score: " + correct + " / " + result.questions.length + " (" + percent + "%)" }),
        h("div", { style: "color:var(--white-secondary)", text: "Variant: " + (result.variantStr || "BOTH") }),
        h("div", { style: "color:var(--white-secondary)", text: "System: " + (result.systemNameOrNull || "All systems") }),
        h("div", { style: "color:var(--white-secondary)", text: "Elapsed: " + Q.formatQuizDuration(elapsed) + " • Avg/question: " + Q.formatQuizDuration(average) })
      ]),
      h("div", { class: "t-title-m c-white", text: missed.length ? "Missed / review items" : "No missed questions." }),
      missed.length ? h("div", { class: "stack-8" }, missed.slice(0, 8).map(function (item, index) {
        return blueCard([h("div", { class: "t-body-m c-white", text: (index + 1) + ". " + item.prompt }), h("div", { class: "t-body-s", style: "color:var(--white-secondary)", text: "Chosen: " + Q.answerLabel(item.chosenOptionIndex) + " • Correct: " + Q.answerLabel(item.correctOptionIndex) }), h("div", { class: "t-body-s c-sec mt-4", text: item.optionSnippets[item.correctOptionIndex] || "" })]);
      }).concat(missed.length > 8 ? [h("div", { style: "color:var(--white-secondary)", text: (missed.length - 8) + " more review items not shown." })] : [])) : null,
      libraryDivider(),
      h("div", { class: "row gap-10 wrap" }, [saveBtn, matButton("Retry", start), exitBtn()])
    ]);
  }
  start();
  return screen({ ariaLabel: "Quiz" }, [root]);
}

/* ------------------------------------------------------------ Performance */
export async function performanceCalc(ctx) {
  ctx.setTopbar({ title: "Performance", subtitle: "Seaplane QRH table set", back: "#/dashboard" });
  let pack;
  try { pack = await Content.pack("performance"); } catch (error) { if (error && (error.status === 401 || error.status === 403)) throw error; return screen({ title: "Performance", library: true, header: [backTonal("#/dashboard")] }, [contentUnavailable("performance", error)]); }
  const tables = PERF.parseTables(pack.tables || {});
  let state = PERF.initialPerformanceState(tables);
  const results = h("div", { class: "stack-14" });
  const r = function (n) { return Math.round(n); };
  function infoRow(label, value, note) {
    return h("div", { class: "pv-5" }, [h("div", { class: "row gap-10 top" }, [h("span", { class: "t-body-m w-semi c-white clamp-2", style: "flex:0.8 1 0", text: label }), value ? h("span", { class: "t-body-m w-bold c-gold clamp-2", style: "flex:1 1 0", text: value }) : null]), note ? h("div", { class: "t-body-s c-67 clamp-4", text: note }) : null]);
  }
  function resultBox(label, value) { return h("div", { class: "result-box" }, [h("div", { class: "t-label-m c-67 clamp-1", text: label }), h("div", { class: "t-title-l w-xbold c-gold clamp-1", text: value })]); }
  function resultsCard(title, subtitle, result, secondaryLabel) {
    return blueCard([
      h("div", { class: "t-title-m w-bold c-white", text: title }),
      h("div", { class: "t-body-s c-67 clamp-3 mt-4", text: subtitle }),
      h("div", { class: "equal-row gap-10 mt-12" }, [resultBox("Water run", r(result.waterRunFt) + " ft"), resultBox(secondaryLabel, r(result.distanceTo50Ft) + " ft")]),
      h("div", { class: "t-body-s c-67 clamp-2 mt-8", text: result.correctionSummary })
    ]);
  }
  function renderResults() {
    const s = tables.referenceSpeeds, p = tables.performanceSummary;
    results.replaceChildren(
      resultsCard("Take-off - seaplane flaps " + state.takeoffFlaps, "Water run and distance to 50 ft AGL from the authored flaps 20, PA 0 ft, calm-water table.", state.takeoffResult, "To 50 ft"),
      resultsCard("Landing - seaplane flaps " + state.landingFlaps, "Water run and full-stop distance from 50 ft AGL from the authored flaps 37.5, PA 0 ft, calm-water table. Reverse thrust is not included.", state.landingResult, "From 50 ft"),
      blueCard([h("div", { class: "t-title-m w-bold c-white", text: "VREF" }), h("div", { class: "mt-8" }, resultBox("Flaps " + state.selectedFlaps, r(state.vrefKias) + " KIAS")), h("div", { class: "t-body-s c-67 mt-8", text: "Interpolated by weight from the QRH VREF table." })]),
      blueCard([h("div", { class: "t-title-m w-bold c-white", text: "Reference speeds" }), h("div", { class: "mt-10" }, [
        infoRow("V1", s.v1Kias > 0 ? s.v1Kias + " KIAS" : "CONFIG-SPECIFIC", s.v1Note),
        infoRow("VYSE", s.vyseKias + " KIAS / " + s.vyseKcas + " KCAS", s.vyseNote),
        infoRow("VY", s.vyKias + " KIAS / " + s.vyKcas + " KCAS", s.vyNote),
        infoRow("VX", s.vxKias + " KIAS / " + s.vxKcas + " KCAS", s.vxNote),
        infoRow("VMC", s.vmcKias + " KIAS / " + s.vmcKcas + " KCAS", s.vmcNote)
      ])]),
      blueCard([h("div", { class: "t-title-m w-bold c-white", text: "Performance summary" }), h("div", { class: "mt-10" }, [
        infoRow("OEI ROC", p.oeiRateOfClimbFpm + " fpm", p.oeiRocNote),
        infoRow("OEI ceiling", p.oeiServiceCeilingFt + " ft", "Service ceiling"),
        infoRow("Both-engine ROC", p.bothEngRocFpm + " fpm", p.bothEngRocNote),
        infoRow("Service ceiling", p.serviceCeilingFt + " ft", "Both engines"),
        infoRow("Maximum altitude", p.maxAltFt + " ft", "Aircraft maximum altitude")
      ])]),
      blueCard([h("div", { class: "t-title-m w-bold c-white", text: "Sources and assumptions" }), h("div", { class: "mt-8" }, [
        infoRow("Take-off", "QRH", state.sourceTakeoff), infoRow("Landing", "QRH", state.sourceLanding), infoRow("VREF", "QRH", state.sourceVref)
      ].concat(state.notes.slice(0, 5).map(function (note, index) { return infoRow("Note " + (index + 1), "", note); })))])
    );
  }
  const flapsRow = h("div", { class: "equal-row gap-8" });
  function renderFlaps() {
    flapsRow.replaceChildren.apply(flapsRow, state.availableFlaps.map(function (f) { return selectableChip(f, f === state.selectedFlaps, function () { state = PERF.setVrefFlaps(state, tables, f); renderFlaps(); renderResults(); }); }));
  }
  renderFlaps(); renderResults();
  const inputs = blueCard([
    h("div", { class: "t-title-m w-bold c-white", text: "Inputs" }),
    h("div", { class: "stack-8 mt-12" }, [
      sliderRow({ label: "Weight", value: state.weightLb, min: state.weightMinLb, max: state.weightMaxLb, step: 10, valueText: function (v) { return r(v) + " lb"; }, onChange: function (v) { state = PERF.setWeight(state, tables, v); renderResults(); } }),
      sliderRow({ label: "OAT", value: state.temperatureC, min: state.tempMinC, max: state.tempMaxC, step: 0.5, valueText: function (v) { return r(v) + " C"; }, onChange: function (v) { state = PERF.setTemperature(state, tables, v); renderResults(); } })
    ]),
    h("div", { class: "t-label-l w-semi c-87 mt-8", text: "Distance-table configuration" }),
    h("div", { class: "t-body-s c-67", text: "Take-off: flaps 20. Landing: flaps 37.5. PA 0 ft and calm water. No wind, torque, intake-deflector or alternate-flap correction is synthesized." }),
    h("div", { class: "t-label-l w-semi c-87 mt-10", text: "VREF flap setting" }),
    h("div", { class: "mt-6" }, flapsRow)
  ]);
  return screen({ title: "Performance", library: true, header: [backTonal("#/dashboard")] }, [
    h("p", { class: "t-body-m c-87 clamp-5", text: "Check-ride performance calculator for the bundled DHC-6 seaplane table set. Use it for study and oral preparation; verify the approved AFM/QRH, aircraft configuration, and operator SOPs for dispatch." }),
    h("div", { class: "mt-4" }), libraryDivider(), h("div", { class: "mt-4" }),
    h("div", { class: "two-col" }, [inputs, results])
  ]);
}

/* ---------------------------------------------------------- Fuel planning */
export async function fuelPlan(ctx) {
  ctx.setTopbar({ title: "Fuel Planning", subtitle: "45-min reserve planner", back: "#/dashboard" });
  const st = { flightMins: 60, altMins: 0, contingencyPct: 5, fuelUsg: 100 };
  const out = h("div", { class: "stack-8" });
  const r = function (n) { return Math.round(n); };
  const F = FuelPlanCalculator;
  function fuelRow(label, lb, bold, color) {
    return h("div", { class: "kv" + (bold ? " bold" : "") }, [h("span", { class: bold ? "c-white" : "c-67", text: label }), h("span", { class: "mono" + (bold ? " w-bold" : ""), style: "color:" + (color || (bold ? "#fff" : "#fff")), text: r(lb) + " lb  /  " + r(F.lbToUsg(lb)) + " USG" })]);
  }
  function render() {
    const fuelLb = F.usgToLb(st.fuelUsg);
    const res = F.plan({ flightTimeMins: r(st.flightMins), alternateMins: r(st.altMins), contingencyPct: r(st.contingencyPct), departFuelLb: fuelLb });
    const ok = res.isAdequate;
    out.replaceChildren(
      h("div", { class: "calc-result " + (ok ? "ok" : "bad") }, [
        h("div", { class: "t-title-m w-xbold " + (ok ? "c-ok" : "c-bad"), text: ok ? "FUEL ADEQUATE" : "INSUFFICIENT FUEL" }),
        h("div", { class: "mt-10" }, [
          fuelRow("Trip fuel", res.tripFuelLb),
          res.alternateFuelLb > 0 ? fuelRow("Alternate", res.alternateFuelLb) : null,
          fuelRow("Contingency " + r(st.contingencyPct) + "%", res.contingencyLb),
          fuelRow("Reserve (45 min)", res.reserveFuelLb),
          fuelRow("Taxi", res.totalRequiredLb - res.tripFuelLb - res.alternateFuelLb - res.contingencyLb - res.reserveFuelLb),
          libraryDivider(),
          fuelRow("Total required", res.totalRequiredLb, true, "var(--caution-amber)"),
          fuelRow("Fuel on board", res.totalBoardLb, true, "#fff"),
          fuelRow("Margin", res.marginLb, true, res.marginLb >= 0 ? "var(--status-normal-green)" : "var(--emergency-red-strong)"),
          (res.fwdTankLb > 0 || res.aftTankLb > 0) ? h("div", { class: "t-label-s c-67 mt-4", text: "FWD: " + r(res.fwdTankLb) + " lb · AFT: " + r(res.aftTankLb) + " lb" }) : null
        ])
      ]),
      h("div", { class: "stack-6" }, res.warnings.map(function (w) { return h("div", { class: "t-body-s w-bold c-bad", text: "⚠  " + w }); })),
      h("div", { class: "stack-4" }, res.notes.map(function (n) { return h("div", { class: "t-label-s c-67", text: n }); }))
    );
  }
  render();
  const sliders = h("div", { class: "stack-8" }, [
    sliderRow({ label: "Flight time", value: st.flightMins, min: 10, max: 300, valueText: function (v) { return r(v) + " min"; }, valueClass: "c-amber", mono: true, onChange: function (v) { st.flightMins = v; render(); } }),
    sliderRow({ label: "Alternate", value: st.altMins, min: 0, max: 90, valueText: function (v) { return r(v) + " min"; }, valueClass: "c-amber", mono: true, onChange: function (v) { st.altMins = v; render(); } }),
    sliderRow({ label: "Contingency", value: st.contingencyPct, min: 0, max: 15, valueText: function (v) { return r(v) + "%"; }, valueClass: "c-amber", mono: true, onChange: function (v) { st.contingencyPct = v; render(); } }),
    sliderRow({ label: "Fuel on board", value: st.fuelUsg, min: 10, max: 378, valueText: function (v) { return r(v) + " USG  ·  " + r(F.usgToLb(v)) + " lb"; }, valueClass: "c-amber", mono: true, onChange: function (v) { st.fuelUsg = v; render(); } })
  ]);
  return screen({ title: "Fuel Planning", library: true, header: [backText("#/dashboard")] }, [
    blueCard([h("div", { class: "t-label-s w-bold c-amber", text: "TRAINING USE ONLY" }), h("div", { class: "t-body-s c-67", text: "FWD " + r(F.FWD_TANK_MAX_LB) + " lb / AFT " + r(F.AFT_TANK_MAX_LB) + " lb / Total " + r(F.TOTAL_USABLE_LB) + " lb usable" })]),
    h("div", { class: "two-col" }, [sliders, h("div", { class: "stack-12" }, [libraryDivider(), out])])
  ]);
}

/* ------------------------------------------------------ Weight & Balance */
export async function weightBalance(ctx) {
  ctx.setTopbar({ title: "Weight & Balance", subtitle: "QRH OM-B 11.1 simplified limits", back: "#/dashboard" });
  const W = WeightBalanceCalculator;
  const st = { basicWeight: 8450, basicIndex: "10.0", crew: 380, seats: Array(15).fill(0), fwdBag: 0, aftBag: 0, fuel: 500 };
  const r = function (n) { return Math.round(n); };
  const out = h("div", { class: "stack-8" });
  const seatMap = h("div", { class: "stack-8" });
  const paxLine = h("div", { class: "t-body-m w-bold c-amber" });
  function rowWeights() { return [0, 1, 2, 3, 4].map(function (row) { return st.seats.slice(row * 3, row * 3 + 3).reduce(function (s, i) { return s + OCCUPANT_TYPES[i].weightLb; }, 0); }); }
  function compute() {
    const rw = rowWeights();
    return W.calculate(W.defaultLoadItems({ basicWeightLb: st.basicWeight, crewLb: st.crew, paxRow1Lb: rw[0], paxRow2Lb: rw[1], paxRow3Lb: rw[2], paxRow4Lb: rw[3], paxRow5Lb: rw[4], fwdBaggageLb: st.fwdBag, aftBaggageLb: st.aftBag, fuelLb: st.fuel }));
  }
  function wbRow(label, value, color) { return h("div", { class: "kv" }, [h("span", { class: "c-67", text: label }), h("span", { class: "mono w-bold", style: "color:" + color, text: value })]); }
  function renderSeats() {
    seatMap.replaceChildren.apply(seatMap, [0, 1, 2, 3, 4].map(function (row) {
      return h("div", { class: "row gap-8" }, [h("span", { class: "c-67 w-bold", style: "width:22px", text: String(row + 1) })].concat(["A", "C", "D"].map(function (letter, column) {
        const index = row * 3 + column;
        const occ = OCCUPANT_TYPES[st.seats[index]];
        return h("button", { class: "seat-btn grow" + (st.seats[index] ? " on" : ""), type: "button", "aria-label": "Seat " + (row + 1) + letter + " " + occ.key, text: (row + 1) + letter + "  " + occ.code, onclick: function () { st.seats[index] = nextOccupant(st.seats[index]); renderSeats(); render(); } });
      })));
    }));
    const pax = st.seats.reduce(function (s, i) { return s + OCCUPANT_TYPES[i].paxCount; }, 0);
    const occupied = st.seats.filter(Boolean).length;
    const lb = st.seats.reduce(function (s, i) { return s + OCCUPANT_TYPES[i].weightLb; }, 0);
    paxLine.textContent = pax + " passengers · " + occupied + " seats · " + lb + " lb";
  }
  function render() {
    const res = compute();
    const ok = res.isWithinCgLimits && res.isWithinWeightLimits;
    const color = ok ? "var(--status-normal-green)" : "var(--emergency-red-strong)";
    out.replaceChildren(
      h("div", { class: "calc-result wb " + (ok ? "ok" : "bad") }, [
        h("div", { class: "t-title-m w-xbold", style: "color:" + color, text: ok ? "WITHIN LIMITS" : "OUT OF LIMITS" }),
        h("div", { class: "mt-10" }, [
          wbRow("Total weight", r(res.totalWeightLb) + " lb", res.isWithinWeightLimits ? "var(--status-normal-green)" : "var(--emergency-red-strong)"),
          wbRow("CG Arm", res.cgArmIn.toFixed(2) + " in", res.isWithinCgLimits ? "var(--status-normal-green)" : "var(--emergency-red-strong)"),
          wbRow("CG % MAC", res.cgMacPct.toFixed(1) + " %", res.isWithinCgLimits ? "var(--status-normal-green)" : "var(--emergency-red-strong)"),
          wbRow("Total moment", r(res.totalMomentLbIn) + " lb·in", "var(--text-67)")
        ]),
        h("div", { class: "mt-12" }, [h("div", { class: "t-label-s c-67", text: "CG Envelope — study reference only" }), h("div", { class: "mt-4" }, cgChart(res.totalWeightLb, res.cgArmIn, ok)), h("div", { class: "row between mt-4" }, [h("span", { class: "t-label-s w-bold", style: "color:" + color, text: "Arm: " + res.cgArmIn.toFixed(2) + " in" }), h("span", { class: "t-label-s c-67", text: "Weight: " + r(res.totalWeightLb) + " lb" })])])
      ]),
      h("div", { class: "stack-6" }, res.warnings.map(function (w) { return h("div", { class: "t-body-s w-bold c-bad", text: "⚠  " + w }); })),
      h("div", { class: "stack-4" }, res.notes.map(function (n) { return h("div", { class: "t-label-s c-67", text: n }); }))
    );
  }
  const apsInput = h("input", { type: "text", inputmode: "decimal", value: String(r(st.basicWeight)), "aria-label": "APS / DOW (lb)" });
  apsInput.addEventListener("input", function () { const v = parseFloat(apsInput.value); if (Number.isFinite(v)) { st.basicWeight = Math.min(12500, Math.max(0, v)); render(); } });
  const idxInput = h("input", { type: "text", inputmode: "decimal", value: st.basicIndex, "aria-label": "DOI / index" });
  idxInput.addEventListener("input", function () { st.basicIndex = idxInput.value; });
  renderSeats(); render();
  const inputs = h("div", { class: "stack-12" }, [
    h("div", { class: "t-title-s w-bold c-white", text: "Aircraft APS / DOW" }),
    h("div", { class: "row gap-10 top" }, [field("APS / DOW (lb)", apsInput), field("DOI / index", idxInput)]),
    h("div", { class: "t-label-s c-67", text: "Starting index is recorded for the operator load sheet; aircraft-specific station/index data is required before it can drive dispatch calculations." }),
    sliderRow({ label: "Flight crew", value: st.crew, min: 100, max: 600, valueText: function (v) { return r(v) + " lb"; }, valueClass: "c-amber", mono: true, onChange: function (v) { st.crew = v; render(); } }),
    h("div", { class: "t-title-s w-bold c-white mt-8", text: "Passenger seat map" }),
    h("div", { class: "t-label-s c-67", text: "Tap a seat to cycle Empty → M → F → C → FI. FI is one occupied seat, 150 lb and two passengers." }),
    seatMap,
    paxLine,
    sliderRow({ label: "Fwd baggage", value: st.fwdBag, min: 0, max: 300, valueText: function (v) { return r(v) + " lb  (max 300)"; }, valueClass: "c-amber", mono: true, onChange: function (v) { st.fwdBag = v; render(); } }),
    sliderRow({ label: "Aft baggage", value: st.aftBag, min: 0, max: 500, valueText: function (v) { return r(v) + " lb  (max 500)"; }, valueClass: "c-amber", mono: true, onChange: function (v) { st.aftBag = v; render(); } }),
    sliderRow({ label: "Fuel", value: st.fuel, min: 0, max: 2576, valueText: function (v) { return r(v) + " lb"; }, valueClass: "c-amber", mono: true, onChange: function (v) { st.fuel = v; render(); } })
  ]);
  return screen({ title: "Weight & Balance", library: true, header: [backText("#/dashboard")] }, [
    blueCard([h("div", { class: "t-label-s w-bold c-amber", text: "TRAINING USE ONLY — Use approved W&B forms for dispatch" }), h("div", { class: "t-label-s c-67", text: "MTOW " + r(W.MTOW_LB) + " lb  ·  CG FWD " + W.FWD_LIMIT_ARM_IN + " in (25% MAC)  AFT " + W.AFT_LIMIT_ARM_IN.toFixed(1) + " in (32% MAC)" })]),
    h("div", { class: "two-col" }, [inputs, h("div", { class: "stack-12" }, [libraryDivider(), out])])
  ]);
}

/* CgEnvelopeChart — SVG port of the Compose Canvas drawing */
function cgChart(weightLb, cgArmIn, ok) {
  const E = CG_ENVELOPE;
  const W = 640, H = 200, padL = 46, padR = 12, padT = 14, padB = 28;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const armX = function (a) { return padL + (a - E.armMin) / (E.armMax - E.armMin) * plotW; };
  const wY = function (w) { return padT + (1 - (w - E.wMin) / (E.mtow - E.wMin)) * plotH; };
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.setAttribute("class", "cg-chart"); svg.setAttribute("preserveAspectRatio", "none"); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "CG envelope chart");
  const el = function (tag, attrs, textContent) { const n = document.createElementNS(ns, tag); Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); }); if (textContent) n.textContent = textContent; svg.appendChild(n); return n; };
  const grid = "rgba(255,255,255,0.13)", lbl = "rgba(255,255,255,0.6)", env = "#4FC3F7";
  [8000, 9000, 10000, 11000, 12000, 12500].forEach(function (w) { const y = wY(w); el("line", { x1: padL, y1: y, x2: W - padR, y2: y, stroke: grid, "stroke-width": 0.8 }); el("text", { x: 2, y: y + 3, fill: lbl, "font-size": 9 }, (w / 1000) + "k"); });
  [202, 204, 206, 208, 210, 212, 214, 216, 218].forEach(function (a) { const x = armX(a); el("line", { x1: x, y1: padT, x2: x, y2: H - padB, stroke: grid, "stroke-width": 0.8 }); el("text", { x: x - 8, y: H - padB + 14, fill: lbl, "font-size": 9 }, String(a)); });
  const path = "M" + armX(E.fwdLow) + "," + wY(E.wMin) + " L" + armX(E.fwdLow) + "," + wY(E.fwdLowWeight) + " L" + armX(E.fwdHigh) + "," + wY(E.mtow) + " L" + armX(E.aft) + "," + wY(E.mtow) + " L" + armX(E.aft) + "," + wY(E.wMin) + " Z";
  el("path", { d: path, fill: env, "fill-opacity": 0.1, stroke: env, "stroke-width": 2 });
  const mtowY = wY(E.mtow);
  el("line", { x1: padL, y1: mtowY, x2: W - padR, y2: mtowY, stroke: env, "stroke-opacity": 0.4, "stroke-width": 1 });
  el("text", { x: padL + 2, y: mtowY + 11, fill: lbl, "font-size": 9 }, "MTOW");
  const dot = ok ? "#66BB6A" : "#EF5350";
  const dx = armX(Math.min(E.armMax, Math.max(E.armMin, cgArmIn))), dy = wY(Math.min(E.mtow, Math.max(E.wMin, weightLb)));
  el("circle", { cx: dx, cy: dy, r: 13, fill: dot, "fill-opacity": 0.22 });
  el("circle", { cx: dx, cy: dy, r: 5, fill: dot });
  el("line", { x1: dx - 15, y1: dy, x2: dx + 15, y2: dy, stroke: dot, "stroke-opacity": 0.7 });
  el("line", { x1: dx, y1: dy - 15, x2: dx, y2: dy + 15, stroke: dot, "stroke-opacity": 0.7 });
  return svg;
}

/* ------------------------------------------------- Check Ride Readiness */
/* Port of feature-training/ui/dashboard/CompetencyDashboardScreen.kt, in the
   same card order: overall ring, divider, "Category Breakdown", three category
   cards, overdue list, then the three threshold/weight/count footer lines. */
export async function competencyDashboard(ctx) {
  ctx.setTopbar({ title: "Check Ride Readiness", subtitle: "Drill currency and score trend", back: "#/dashboard" });
  const readiness = CMP.analyze(Store.logbook());

  const header = [backBubble("#/dashboard"), h("span", { class: "bubble light" }, [document.createTextNode("Entries"), h("small", { text: String(readiness.totalDrillCount) })])];

  if (readiness.totalDrillCount === 0) {
    return screen({ title: "Check Ride Readiness", library: true, header: header }, [
      blueCard([
        h("div", { class: "t-title-m w-bold c-white", text: "No training data yet" }),
        h("p", { class: "t-body-m mt-6 c-sec", text: "Complete procedure drills to start tracking your check ride readiness. This screen shows currency, score trends, and overdue items across Emergency, Abnormal, and Normal categories." })
      ]),
      navCard("Open a procedure drill", "PROCS → open a procedure to run the memory + flow drill.", { href: "#/systems" })
    ]);
  }

  return screen({ title: "Check Ride Readiness", library: true, header: header }, [
    overallReadinessCard(readiness),
    libraryDivider(),
    h("h3", { class: "t-title-m w-bold c-white", text: "Category Breakdown" }),
    h("div", { class: "stack-8" }, CMP.categoriesOf(readiness).map(categoryCard)),
    overdueSection(CMP.allOverdue(readiness)),
    libraryDivider(),
    h("div", { class: "stack-2" }, CMP.footerLines(readiness).map(function (line) {
      return h("div", { class: "t-label-s c-ter", text: line });
    })),
    /* Not in the Kotlin. The labels here ("Check Ride Ready", "Overdue") read
       like a currency statement, so say plainly that they are this trainer's
       own study scheme and not a regulatory or operator recency requirement. */
    notice("These windows and weights are the trainer's own study scheme for spacing practice. They are not a regulatory, operator or training-organisation recency requirement, and this screen is not a record of your currency.")
  ]);
}

function overallReadinessCard(readiness) {
  const band = CMP.readinessBand(readiness.overallPercent);
  return blueCard([
    h("div", { class: "row gap-16 readiness-head" }, [
      h("div", { class: "readiness-ring band-" + band, role: "img", "aria-label": "Overall readiness " + readiness.overallPercent + " percent" }, [
        h("span", { class: "readiness-ring-value", text: readiness.overallPercent + "%" })
      ]),
      h("div", { class: "grow" }, [
        h("div", { class: "t-title-l w-bold c-white", text: readiness.readinessLabel }),
        h("div", { class: "t-body-s c-sec", text: "Overall check ride readiness" }),
        h("div", { class: "row gap-8 mt-6" }, CMP.categoriesOf(readiness).map(function (cat, i) {
          return miniScore(cat, ["EM", "AB", "NM"][i]);
        }))
      ])
    ])
  ]);
}

function miniScore(cat, abbrev) {
  return h("div", { class: "mini-score" }, [
    h("span", { class: "t-label-s c-ter", text: abbrev }),
    h("span", { class: "t-label-m w-bold band-" + CMP.readinessBand(cat.scorePercent), text: cat.scorePercent + "%" })
  ]);
}

function categoryCard(competency) {
  const band = CMP.statusBand(competency);
  const label = CMP.displayLabel(competency.category);
  return h("a", {
    class: "competency-card band-" + band,
    href: CMP.drillHref(competency.category),
    "aria-label": label + " " + competency.scorePercent + " percent, " + competency.statusLabel + ". Drill this category."
  }, [
    h("div", { class: "row between gap-12" }, [
      h("div", { class: "row gap-8" }, [
        h("span", { class: "status-dot" }),
        h("span", { class: "t-title-s w-bold c-white", text: label }),
        h("span", { class: "t-label-s c-ter", text: CMP.WEIGHT_LABEL[competency.category] })
      ]),
      h("div", { class: "col-end" }, [
        h("span", { class: "t-title-m w-xbold", text: competency.scorePercent + "%" }),
        h("span", { class: "t-label-s", text: competency.statusLabel })
      ])
    ]),
    h("div", { class: "row wrap gap-16 mt-8" }, [
      statPill("Threshold", CMP.thresholdLabel(competency)),
      statPill("Last drill", CMP.lastDrillLabel(competency.daysSinceLastDrill)),
      statPill("Current", CMP.currentLabel(competency))
    ]),
    competency.recentScores.length ? h("div", { class: "row wrap gap-4 mt-6 trend-row" }, [
      h("span", { class: "t-label-s c-ter", text: "Trend:" })
    ].concat(competency.recentScores.slice(0, 5).map(scoreChip), [
      h("span", { class: "t-label-s c-ter", text: competency.trendLabel })
    ])) : null,
    h("div", { class: "t-label-s tap-to-drill mt-6", text: "Tap to drill this category" })
  ]);
}

function statPill(label, value) {
  return h("div", { class: "stat-pill" }, [
    h("span", { class: "t-label-s c-ter", text: label }),
    h("span", { class: "t-body-s w-semi c-white", text: value })
  ]);
}

function scoreChip(score) {
  return h("span", { class: "score-chip band-" + CMP.readinessBand(score), title: score + "%", text: CMP.scoreChipText(score) });
}

function overdueSection(overdue) {
  if (!overdue.length) return null;
  return h("div", null, [
    libraryDivider(),
    blueCard([
      h("div", { class: "t-title-s w-bold band-overdue", text: "Overdue Procedures" }),
      h("div", { class: "stack-2 mt-6" }, overdue.map(function (item) {
        return h("div", { class: "row between gap-8 overdue-row" }, [
          h("span", { class: "overdue-dot cat-" + item.category.toLowerCase() }),
          h("span", { class: "t-body-s c-white grow", text: item.name }),
          h("span", { class: "t-label-s c-ter", text: CMP.displayLabel(item.category) })
        ]);
      }))
    ])
  ]);
}

/* --------------------------------------------- Later training features */
/*
  Nothing reaches this now, and it is kept only because the next feature to be
  ported will want it.

  It has twice held a string that outlived its own truth. First the CRM drill,
  whose branch said the standalone screen was "scheduled for the CRM phase"
  long after it shipped. Then the Oral Exam, whose branch named three missing
  things — a subscriber-session-gated proxy, a confirmed upstream, an API key
  in Cloudflare — every one of which phase 36 delivered, leaving the screen
  telling subscribers a feature was unbuildable while its endpoint sat there
  finished.

  That is the failure mode of a hand-written status: it is written once, when
  it is true, and nothing makes it false again. The test below walks it.

  One explanation, not two: the registry `desc` is the short line tiles show,
  and the card carries the detail. Rendering both put the same sentence on the
  screen twice.
*/
const LATER_TRAINING_DETAIL = {};

export function laterTraining(id) {
  return async function (ctx) {
    const f = feature(id);
    ctx.setTopbar({ title: f.title, subtitle: "Coming later", back: "#/dashboard" });
    return screen({ title: f.title, library: true, header: [backBubble("#/dashboard")] }, [
      h("div", { class: "row wrap gap-8" }, [statusPill(f.status)]),
      blueCard([h("div", { class: "t-body-m", text: LATER_TRAINING_DETAIL[id] || f.desc })]),
      navCard("Open a procedure drill instead", "Procedure drills (memory + flow) are fully available in PROCS.", { href: "#/systems" })
    ]);
  };
}
