/*
  SM-2 spaced repetition — port of domain/analytics/SpacedRepetitionEngine.kt and
  the session builder from feature-knowledge/ui/screens/SrsStudyViewModel.kt.
  Records are persisted per browser (Store "srsRecords"), keyed by knowledge-unit id.
*/

export const MAX_SESSION_CARDS = 20;
export const MAX_NEW_CARDS_PER_SESSION = 8;
const CANDIDATE_TAG = "STATUS:CANDIDATE";

export function currentEpochDay(date) {
  const d = date || new Date();
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}

export function newRecord(flashcardId) {
  return { flashcardId: flashcardId, easeFactor: 2.5, intervalDays: 0, repetitions: 0, nextReviewEpochDay: 0, lastReviewedEpochDay: null };
}

/* SpacedRepetitionEngine.review */
export function review(record, quality, today) {
  const t = today == null ? currentEpochDay() : today;
  const q = Math.min(5, Math.max(0, quality | 0));
  const newEase = Math.max(1.3, record.easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  if (q < 3) {
    return Object.assign({}, record, { easeFactor: newEase, repetitions: 0, intervalDays: 1, nextReviewEpochDay: t + 1, lastReviewedEpochDay: t });
  }
  const newInterval = record.repetitions === 0 ? 1 : record.repetitions === 1 ? 6 : Math.round(record.intervalDays * newEase);
  return Object.assign({}, record, {
    easeFactor: newEase,
    repetitions: record.repetitions + 1,
    intervalDays: Math.max(newInterval, 1),
    nextReviewEpochDay: t + newInterval,
    lastReviewedEpochDay: t
  });
}

/* SrsStudyViewModel.buildSession — units for the selected variant, due first then new. */
export function buildSession(units, recordsById, variant, today) {
  const t = today == null ? currentEpochDay() : today;
  const v = String(variant || "BOTH").toUpperCase();
  const all = units.filter(function (u) {
    if (!(u.tags || []).includes(CANDIDATE_TAG)) return false;
    // KnowledgeRepository.listByStatusTag(variant, …): BOTH lists every variant, a specific
    // variant lists its own rows plus shared BOTH rows.
    return v === "BOTH" || u.aircraftVariant === v || u.aircraftVariant === "BOTH";
  }).slice(0, 200);
  if (!all.length) return [];
  const due = [];
  const fresh = [];
  for (const unit of all) {
    const record = recordsById[unit.id];
    if (!record) fresh.push({ unit: unit, record: newRecord(unit.id), isNew: true });
    else if (record.nextReviewEpochDay <= t) due.push({ unit: unit, record: record, isNew: false });
  }
  due.sort(function (a, b) { return a.record.nextReviewEpochDay - b.record.nextReviewEpochDay; });
  const session = due.slice(0, MAX_SESSION_CARDS);
  const newSlots = Math.min(MAX_SESSION_CARDS - session.length, MAX_NEW_CARDS_PER_SESSION);
  return session.concat(fresh.slice(0, Math.max(0, newSlots))).slice(0, MAX_SESSION_CARDS);
}

export function nextDueDays(recordsById, today) {
  const t = today == null ? currentEpochDay() : today;
  let best = null;
  Object.keys(recordsById).forEach(function (id) {
    const r = recordsById[id];
    if (r.nextReviewEpochDay > t) { const d = r.nextReviewEpochDay - t; if (best == null || d < best) best = d; }
  });
  return best;
}

export function dueCount(units, recordsById, variant, today) {
  return buildSession(units, recordsById, variant, today).filter(function (c) { return !c.isNew; }).length;
}

/* SrsStudyScreen.QualityRatingRow */
export const QUALITY_BUTTONS = [
  { quality: 1, label: "Again", sublabel: "Tomorrow", tone: "red" },
  { quality: 2, label: "Hard", sublabel: "1-3 days", tone: "amber" },
  { quality: 3, label: "Good", sublabel: "~6 days", tone: "blue" },
  { quality: 4, label: "Easy", sublabel: "~12 days", tone: "green" },
  { quality: 5, label: "Perfect", sublabel: "~20 days", tone: "green-bright" }
];
