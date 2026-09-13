/*
  Debrief Logbook — port of the filter / sort / export layer of
  feature-training/ui/dashboard/LogbookScreen.kt and LogbookPdfExporter.kt.

  The web tile has been marked "Partial" with the explanation that it is waiting
  on cloud sync. Cloud sync is a real gap, but it was not the main one: the
  Android logbook is a 616-line screen with search, three enum filters, an
  overrides-only toggle and five sort modes, plus a 395-line detail screen and a
  260-line PDF exporter. The web had a flat list sorted newest-first.

  Everything here operates on the same LogbookEntry list the browser already
  keeps in Store.logbook(), written by procedure drills, cockpit scenario drills
  and quizzes. No new content, no server.
*/

/* The enums the filter dropdowns offer, in declaration order. `null` is ALL. */
export const VARIANTS = ["LEGACY", "G950", "BOTH"];
export const SCORE_BANDS = ["EXCELLENT", "GOOD", "SATISFACTORY", "MARGINAL", "UNSATISFACTORY", "FAIL"];
export const EXAMINER_MODES = ["OFF", "ON"];

export const SORT_MODES = [
  { id: "NEWEST", label: "Newest" },
  { id: "OLDEST", label: "Oldest" },
  { id: "MOST_MISSES", label: "Most misses" },
  { id: "WORST_SCORE", label: "Worst score" },
  { id: "LONGEST_TIME", label: "Longest time" }
];

export function defaultFilters() {
  return { query: "", aircraftVariant: null, scoreBand: null, examinerMode: null, overridesOnly: false, sort: "NEWEST" };
}

/* missesCount(): negative counts are clamped, as the Kotlin does with
   coerceAtLeast(0), so a malformed entry cannot sort above a real one. */
export function missesCount(entry) {
  const role = Math.max(0, Number(entry && entry.wrongRoleCount) || 0);
  const callout = Math.max(0, Number(entry && entry.wrongCalloutCount) || 0);
  return role + callout;
}

/* scoreRank(): lower is worse. The Kotlin folds several historical band names
   onto the same rank, and anything unrecognised lands on GOOD's rank (2). */
export function scoreRank(band) {
  switch (String(band || "").toUpperCase()) {
    case "FAIL":
    case "UNSATISFACTORY": return 0;
    case "MARGINAL":
    case "CAUTION": return 1;
    case "GOOD": return 2;
    case "EXCELLENT":
    case "PASS":
    case "SATISFACTORY": return 3;
    default: return 2;
  }
}

/* applyFilters(): the search matches the procedure name only — not remarks, not
   the category — which is what the Kotlin does. */
export function applyFilters(entries, filters) {
  const f = Object.assign(defaultFilters(), filters || {});
  const q = String(f.query || "").trim().toLowerCase();
  return (entries || []).filter(function (entry) {
    if (!entry) return false;
    if (q && !String(entry.procedureName || "").toLowerCase().includes(q)) return false;
    if (f.aircraftVariant && entry.aircraftVariant !== f.aircraftVariant) return false;
    if (f.scoreBand && entry.scoreBand !== f.scoreBand) return false;
    if (f.examinerMode && entry.examinerMode !== f.examinerMode) return false;
    if (f.overridesOnly && !entry.examinerOverride) return false;
    return true;
  });
}

/* applySort(): each mode's tiebreakers are the Kotlin's, in order. */
export function applySort(entries, sort) {
  const list = (entries || []).slice();
  const byNewest = function (a, b) { return b.timestampUtc - a.timestampUtc; };
  switch (sort) {
    case "OLDEST":
      return list.sort(function (a, b) { return a.timestampUtc - b.timestampUtc; });
    case "MOST_MISSES":
      return list.sort(function (a, b) {
        return (missesCount(b) - missesCount(a)) || byNewest(a, b);
      });
    case "LONGEST_TIME":
      return list.sort(function (a, b) {
        return ((b.totalTimeMs || 0) - (a.totalTimeMs || 0)) || byNewest(a, b);
      });
    case "WORST_SCORE":
      return list.sort(function (a, b) {
        return (scoreRank(a.scoreBand) - scoreRank(b.scoreBand))
          || (missesCount(b) - missesCount(a))
          || byNewest(a, b);
      });
    default:
      return list.sort(byNewest);
  }
}

export function visibleEntries(entries, filters) {
  const f = Object.assign(defaultFilters(), filters || {});
  return applySort(applyFilters(entries, f), f.sort);
}

export function filtersAreDefault(filters) {
  const f = Object.assign(defaultFilters(), filters || {});
  const d = defaultFilters();
  return Object.keys(d).every(function (k) { return f[k] === d[k]; });
}

/* --------------------------------------------------------------- entry keys */

/* LogbookEntry.stableKey() — every field that can distinguish two entries taken
   in the same millisecond. Used as the row key and the detail-screen address. */
export function stableKey(entry) {
  return [
    entry.timestampUtc,
    entry.procedureName,
    entry.category,
    entry.aircraftVariant,
    entry.scoreBand,
    entry.examinerMode,
    entry.examinerOverride,
    entry.attemptId || "",
    missesCount(entry)
  ].join("|");
}

export function findByKey(entries, key) {
  return (entries || []).find(function (e) { return e && stableKey(e) === key; }) || null;
}

/* attemptShortId(): the last 8 characters, or an em dash when there is none. */
export function attemptShortId(attemptId) {
  const a = String(attemptId == null ? "" : attemptId).trim();
  if (!a) return "—";
  return a.length <= 8 ? a : a.slice(-8);
}

/* --------------------------------------------------------------- formatting */

/* LogbookDetailScreen.formatDuration: "3m 07s" once there is a whole minute,
   otherwise plain seconds. No hours branch — the Kotlin has none. */
export function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? minutes + "m " + String(seconds).padStart(2, "0") + "s" : seconds + "s";
}

export function scoreLabel(entry) {
  if (entry && entry.scorePercent !== null && entry.scorePercent !== undefined) {
    return entry.scorePercent + "% " + (entry.scoreBand || "");
  }
  return String((entry && entry.scoreBand) || "—");
}

/* LogbookPdfExporter.averageScoreLabel — the mean of the entries that carry a
   percentage; entries without one are excluded rather than counted as zero. */
export function averageScoreLabel(entries) {
  const scored = (entries || []).filter(function (e) { return e && e.scorePercent !== null && e.scorePercent !== undefined; });
  if (!scored.length) return "—";
  const total = scored.reduce(function (sum, e) { return sum + Number(e.scorePercent); }, 0);
  return Math.round(total / scored.length) + "%";
}

export function totalDrillTime(entries) {
  return (entries || []).reduce(function (sum, e) { return sum + (Number(e && e.totalTimeMs) || 0); }, 0);
}

export function ellipsize(value, max) {
  const s = String(value == null ? "" : value);
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)) + "…";
}

/* ------------------------------------------------------------------ export */

/*
  LogbookPdfExporter writes this note onto the first page. It is the reason the
  export is safe to hand to an instructor, so it is carried verbatim and the
  export must not be produced without it.
*/
export const EXPORT_NOTE = "This PDF is a local study export from the DHC-6 Trainer app. It is intended for debrief review, instructor discussion, and personal proficiency tracking. It is not an aircraft technical log or certified training record.";

export function exportFileName(now) {
  const d = new Date(now === undefined ? Date.now() : now);
  const p = function (n) { return String(n).padStart(2, "0"); };
  return "dhc6_logbook_" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate())
    + "_" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + ".pdf";
}

/* The summary block at the head of the export. */
export function exportSummary(entries, now) {
  return {
    exportDate: new Date(now === undefined ? Date.now() : now),
    totalEntries: (entries || []).length,
    totalDrillTime: formatDuration(totalDrillTime(entries)),
    averageScore: averageScoreLabel(entries),
    note: EXPORT_NOTE
  };
}

/* The entry table columns, in the Kotlin's order. */
export function exportRow(entry) {
  return {
    date: new Date(entry.timestampUtc),
    procedure: ellipsize(entry.procedureName, 34),
    category: titleCaseCategory(entry.category),
    score: scoreLabel(entry),
    time: formatDuration(entry.totalTimeMs),
    remarks: ellipsize(String(entry.remarks || "").replace(/\s+/g, " ").trim(), 74)
  };
}

function titleCaseCategory(category) {
  const s = String(category || "").toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

/* ------------------------------------------------------------ debrief text */

/*
  DebriefInstructorCard: the entry's own instructorFeedback wins; when it is
  blank the Kotlin substitutes a line chosen by score band. These are training
  judgements written into the app, not aviation data, and they are reproduced
  word for word.
*/
export const INSTRUCTOR_FALLBACK = {
  EXCELLENT: "Line standard maintained throughout the run.",
  GOOD: "Good line performance with minor polish items.",
  SATISFACTORY: "Acceptable, but not yet crisp enough for line standard.",
  MARGINAL: "Below desired standard. Re-run with tighter role discipline.",
  UNSATISFACTORY: "Unsatisfactory performance. Rebrief and repeat under instruction.",
  FAIL: "Unsatisfactory performance. Rebrief and repeat under instruction."
};

export function instructorDebrief(entry) {
  const written = String((entry && entry.instructorFeedback) || "").trim();
  if (written) return written;
  return INSTRUCTOR_FALLBACK[String((entry && entry.scoreBand) || "").toUpperCase()] || INSTRUCTOR_FALLBACK.SATISFACTORY;
}

export function remarksText(entry) {
  const remarks = String((entry && entry.remarks) || "").trim();
  return remarks || "No remarks recorded.";
}

/* DebriefRecommendationCard — note the first branch needs a clean run, not just
   an EXCELLENT band. */
export function repeatRecommendation(entry) {
  const band = String((entry && entry.scoreBand) || "").toUpperCase();
  const rushed = Number((entry && entry.rushedCount) || 0);
  const wrongCallout = Number((entry && entry.wrongCalloutCount) || 0);
  if (band === "EXCELLENT" && rushed === 0 && wrongCallout === 0) {
    return "Advance to a scenario variant with added ATC pressure and PM/PF swaps.";
  }
  if (band === "GOOD" || band === "SATISFACTORY") {
    return "Repeat once in the same mode, then switch roles and run again.";
  }
  return "Return to QRH memory items, brief the flow aloud, then repeat the drill from the top.";
}

/* DebriefTimingCard: averages are over the recorded step latencies, not the
   total, and an entry with no latencies reports zeros rather than dividing. */
export function timingSummary(entry) {
  const latencies = ((entry && entry.stepLatencies) || []).map(Number).filter(function (n) { return Number.isFinite(n); });
  const sum = latencies.reduce(function (a, b) { return a + b; }, 0);
  return {
    total: Number((entry && entry.totalTimeMs) || 0),
    average: latencies.length ? Math.floor(sum / latencies.length) : 0,
    slowest: latencies.length ? Math.max.apply(null, latencies) : 0,
    fastest: latencies.length ? Math.min.apply(null, latencies) : 0,
    latencies: latencies,
    shown: latencies.slice(0, 12),
    moreCount: Math.max(0, latencies.length - 12)
  };
}

/* DebriefOutcomeCard metric rows, in the Kotlin's order. */
export function outcomeRows(entry) {
  return [
    ["Band", String((entry && entry.scoreBand) || "").replace(/_/g, " ")],
    ["Score", entry && entry.scorePercent !== null && entry.scorePercent !== undefined ? entry.scorePercent + "%" : "N/A"],
    ["Total steps", String((entry && entry.totalSteps) || 0)],
    ["Wrong role", String((entry && entry.wrongRoleCount) || 0)],
    ["Wrong callout/action", String((entry && entry.wrongCalloutCount) || 0)],
    ["Rushed steps", String((entry && entry.rushedCount) || 0)],
    ["Tolerance used", String((entry && entry.toleranceUsedCount) || 0)]
  ];
}

/* The examiner line appears only when it says something. */
export function examinerLine(entry) {
  const mode = String((entry && entry.examinerMode) || "OFF").toUpperCase();
  const override = Boolean(entry && entry.examinerOverride);
  if (mode === "OFF" && !override) return null;
  return "Examiner mode: " + mode + (override ? "  -  Override used" : "");
}

/* ScorePill: "GOOD  -  85%", or just the band when no percentage was recorded. */
export function scorePillText(entry) {
  const band = String((entry && entry.scoreBand) || "").replace(/_/g, " ");
  if (entry && entry.scorePercent !== null && entry.scorePercent !== undefined) {
    return band + "  -  " + entry.scorePercent + "%";
  }
  return band;
}

/* Which colour band a score sits in, reusing the app's existing tone names. */
export function bandTone(scoreBand) {
  const rank = scoreRank(scoreBand);
  if (rank >= 2) return "ready";
  if (rank === 1) return "caution";
  return "overdue";
}
