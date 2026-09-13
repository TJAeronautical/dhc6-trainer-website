/*
  Check Ride Readiness — a direct port of
  domain/analytics/CompetencyAnalyzer.kt.

  The Kotlin is a pure function over a list of LogbookEntry with no Android
  dependency, and the web app already keeps that same list (Store.logbook(),
  written by procedure drills, cockpit scenario drills and quizzes). So this is
  a line-for-line port, not a re-design: same thresholds, same weights, same
  rounding, same labels, same edge cases.

  Two Kotlin behaviours that JavaScript does not give you for free, and that the
  numbers depend on:

    * `Double.toInt()` truncates toward zero — NOT Math.round. A category at
      2 of 3 current is 66%, not 67%. Math.trunc() below.
    * `TimeUnit.MILLISECONDS.toDays()` also truncates, so "days since" is whole
      elapsed days; 13.9 days is 13.
    * `Int / Int` is integer division (`scores.size / 2`, `score / 10`).

  Deliberate, documented deviation from Android: Android's onDrillCategory
  ignores the category it is handed and just opens the procedure library
  (DashboardNavGraph.kt:130). The web carries the category through as a query
  parameter so the library opens already filtered. Nothing about the
  computation differs.
*/

export const THRESHOLD_DAYS = { EMERGENCY: 14, ABNORMAL: 21, NORMAL: 30 };
export const WEIGHTS = { EMERGENCY: 0.40, ABNORMAL: 0.35, NORMAL: 0.25 };
export const WEIGHT_LABEL = { EMERGENCY: "40%", ABNORMAL: "35%", NORMAL: "25%" };
export const CATEGORY_ORDER = ["EMERGENCY", "ABNORMAL", "NORMAL"];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/* CategoryCompetency.scorePercent */
function scorePercentOf(drilled, current) {
  if (drilled === 0) return 0;
  const raw = Math.trunc((current * 100) / drilled);
  return Math.min(100, Math.max(0, raw));
}

/* CategoryCompetency.trendLabel */
function trendLabelOf(recentScores) {
  const scores = recentScores.slice(0, 5);
  if (scores.length < 2) return "Insufficient data";
  const half = Math.floor(scores.length / 2);
  const recent = average(scores.slice(0, half + 1));
  const older = average(scores.slice(half));
  if (recent > older + 5) return "Improving";
  if (recent < older - 5) return "Declining";
  return "Stable";
}

function average(list) {
  if (!list.length) return NaN;
  let total = 0;
  for (const n of list) total += n;
  return total / list.length;
}

/* CategoryCompetency.statusLabel */
function statusLabelOf(drilled, isOverdue, scorePercent) {
  if (drilled === 0) return "No records";
  if (isOverdue) return "Overdue";
  if (scorePercent >= 80) return "Current";
  return "Partial";
}

/* CheckRideReadiness.readinessLabel — note the Kotlin order: the zero-data case
   is checked AFTER the >= 50 case, which is reachable because zero data scores
   0 overall. */
function readinessLabelOf(overallPercent, totalDrillCount) {
  if (overallPercent >= 90) return "Check Ride Ready";
  if (overallPercent >= 75) return "Approaching Standard";
  if (overallPercent >= 50) return "Building Currency";
  if (totalDrillCount === 0) return "No Training Data";
  return "Needs Drilling";
}

/* CompetencyAnalyzer.analyzeCategory */
export function analyzeCategory(category, allEntries, thresholdDays, nowMs) {
  const catEntries = (allEntries || []).filter(function (e) { return e && e.category === category; });

  if (!catEntries.length) {
    return finishCategory({
      category: category,
      thresholdDays: thresholdDays,
      distinctProceduresDrilled: 0,
      distinctProceduresCurrent: 0,
      daysSinceLastDrill: null,
      isOverdue: true,
      recentScores: [],
      overdueProcedureNames: []
    });
  }

  const thresholdMs = thresholdDays * MS_PER_DAY;

  /* Distinct procedure names ever drilled in this category, first-seen order
     (Kotlin's List.distinct() preserves encounter order). */
  const distinctNames = [];
  for (const e of catEntries) if (!distinctNames.includes(e.procedureName)) distinctNames.push(e.procedureName);

  const overdueNames = [];
  let currentCount = 0;
  for (const name of distinctNames) {
    const latest = latestBy(catEntries.filter(function (e) { return e.procedureName === name; }));
    if (!latest) continue;
    if (nowMs - latest.timestampUtc <= thresholdMs) currentCount += 1;
    else overdueNames.push(name);
  }

  const newest = latestBy(catEntries);
  const daysSinceLast = newest ? Math.trunc((nowMs - newest.timestampUtc) / MS_PER_DAY) : null;

  const recentScores = catEntries.slice()
    .sort(function (a, b) { return b.timestampUtc - a.timestampUtc; })
    .slice(0, 10)
    .map(function (e) { return e.scorePercent; })
    .filter(function (s) { return s !== null && s !== undefined; });

  return finishCategory({
    category: category,
    thresholdDays: thresholdDays,
    distinctProceduresDrilled: distinctNames.length,
    distinctProceduresCurrent: currentCount,
    daysSinceLastDrill: daysSinceLast,
    isOverdue: daysSinceLast === null || daysSinceLast > thresholdDays,
    recentScores: recentScores,
    overdueProcedureNames: overdueNames.slice(0, 6)
  });
}

/* The Kotlin data class exposes scorePercent / trendLabel / statusLabel as
   computed properties; here they are materialised once. */
function finishCategory(base) {
  const scorePercent = scorePercentOf(base.distinctProceduresDrilled, base.distinctProceduresCurrent);
  return Object.assign({}, base, {
    scorePercent: scorePercent,
    trendLabel: trendLabelOf(base.recentScores),
    statusLabel: statusLabelOf(base.distinctProceduresDrilled, base.isOverdue, scorePercent)
  });
}

function latestBy(entries) {
  let best = null;
  for (const e of entries) if (!best || e.timestampUtc > best.timestampUtc) best = e;
  return best;
}

/* CompetencyAnalyzer.analyze */
export function analyze(entries, nowMs) {
  const now = nowMs === undefined || nowMs === null ? Date.now() : nowMs;
  const list = entries || [];

  const emergency = analyzeCategory("EMERGENCY", list, THRESHOLD_DAYS.EMERGENCY, now);
  const abnormal = analyzeCategory("ABNORMAL", list, THRESHOLD_DAYS.ABNORMAL, now);
  const normal = analyzeCategory("NORMAL", list, THRESHOLD_DAYS.NORMAL, now);

  const weighted = emergency.scorePercent * WEIGHTS.EMERGENCY
    + abnormal.scorePercent * WEIGHTS.ABNORMAL
    + normal.scorePercent * WEIGHTS.NORMAL;
  const overallPercent = Math.min(100, Math.max(0, Math.trunc(weighted)));

  return {
    overallPercent: overallPercent,
    emergency: emergency,
    abnormal: abnormal,
    normal: normal,
    totalDrillCount: list.length,
    computedAtMs: now,
    isReadyForCheckRide: overallPercent >= 80,
    readinessLabel: readinessLabelOf(overallPercent, list.length)
  };
}

export function categoriesOf(readiness) {
  return [readiness.emergency, readiness.abnormal, readiness.normal];
}

/* Every overdue procedure across the three categories, in Android's order. */
export function allOverdue(readiness) {
  const out = [];
  for (const cat of categoriesOf(readiness)) {
    for (const name of cat.overdueProcedureNames) out.push({ category: cat.category, name: name });
  }
  return out;
}

/* ----------------------------------------------------------- presentation */

/* CompetencyDashboardScreen.readinessColor */
export function readinessBand(percent) {
  if (percent >= 80) return "ready";
  if (percent >= 60) return "caution";
  return "overdue";
}

/* CompetencyDashboardScreen.CategoryCard statusColor */
export function statusBand(competency) {
  if (competency.distinctProceduresDrilled === 0) return "muted";
  if (competency.isOverdue) return "overdue";
  if (competency.scorePercent >= 80) return "ready";
  return "caution";
}

/* ProcedureCategory.displayLabel */
export function displayLabel(category) {
  if (category === "EMERGENCY") return "Emergency";
  if (category === "ABNORMAL") return "Abnormal";
  if (category === "NORMAL") return "Normal";
  return String(category || "");
}

/* CompetencyDashboardScreen.ScoreChip — "!" at 100, otherwise the tens digit. */
export function scoreChipText(score) {
  if (score >= 100) return "!";
  return String(Math.trunc(score / 10));
}

export function lastDrillLabel(daysSinceLastDrill) {
  if (daysSinceLastDrill === null || daysSinceLastDrill === undefined) return "Never";
  return daysSinceLastDrill + "d ago";
}

export function currentLabel(competency) {
  return competency.distinctProceduresCurrent + "/" + competency.distinctProceduresDrilled;
}

export function thresholdLabel(competency) {
  return competency.thresholdDays + " days";
}

/* The three footer lines, verbatim from the Kotlin. */
export function footerLines(readiness) {
  return [
    "Thresholds: Emergency 14 days / Abnormal 21 days / Normal 30 days",
    "Weights: Emergency 40% / Abnormal 35% / Normal 25%",
    "Drill count: " + readiness.totalDrillCount + " total entries"
  ];
}

/* Android opens the unfiltered library; the web pre-selects the category. */
export function drillHref(category) {
  return "#/systems?category=" + encodeURIComponent(category);
}
