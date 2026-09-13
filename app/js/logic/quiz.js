/*
  Multiple-choice quiz generator — port of
  feature-training/ui/quizzes/QuizRunScreen.kt (buildQuiz, chooseQuizDistractors,
  quizOptionSnippet, conciseQuizFact, …) and QuizLogbookMapper.kt.
  The candidate pool is the `knowledge-pool` pack (STATUS:CANDIDATE units).
*/

export const CANDIDATE_TAG = "STATUS:CANDIDATE";
const LIMIT_PER_VARIANT = 1200;
const LIMIT_BOTH_VARIANT = 600;
const QUIZ_STOP_WORDS = new Set(["the", "and", "for", "with", "from", "that", "this", "are", "was", "were",
  "has", "have", "into", "onto", "then", "than", "when", "where", "which",
  "aircraft", "system", "systems", "dhc", "twin", "otter"]);

function tags(unit) { return new Set(unit.tags || []); }

/* KnowledgeRepository.search(variant, query=STATUS:CANDIDATE, system, limit) approximation:
   the Android query matches the tag inside tagsCsv and filters by variant + system. */
function fetchUnits(units, variant, system, limit) {
  return units.filter(function (u) {
    return tags(u).has(CANDIDATE_TAG) && u.aircraftVariant === variant && (!system || u.system === system);
  }).slice(0, limit);
}

/* QuizRunScreen.loadCandidatePool */
export function loadCandidatePool(units, aircraftVariant, system) {
  const v = String(aircraftVariant || "BOTH").toUpperCase();
  const sys = system || null;
  if (v === "BOTH") {
    const a = fetchUnits(units, "LEGACY", sys, LIMIT_PER_VARIANT);
    const b = fetchUnits(units, "G950", sys, LIMIT_PER_VARIANT);
    const c = fetchUnits(units, "BOTH", sys, LIMIT_BOTH_VARIANT);
    const seen = new Set();
    return a.concat(b, c).filter(function (u) { if (seen.has(u.id)) return false; seen.add(u.id); return true; });
  }
  return fetchUnits(units, v, sys, LIMIT_PER_VARIANT);
}

/* QuizHomeScreen candidate count (LEGACY + G950 + BOTH for BOTH). */
export function candidateCount(units, aircraftVariant) {
  const v = String(aircraftVariant || "BOTH").toUpperCase();
  const count = function (variant) { return units.filter(function (u) { return tags(u).has(CANDIDATE_TAG) && u.aircraftVariant === variant; }).length; };
  if (v === "BOTH") return count("LEGACY") + count("G950") + count("BOTH");
  return count(v);
}

/* Deterministic-when-seeded Fisher–Yates (Kotlin `shuffled()` uses a random source). */
export function shuffled(list, rng) {
  const random = rng || Math.random;
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const t = out[i]; out[i] = out[j]; out[j] = t;
  }
  return out;
}

function cleanQuizOptionText(text) {
  return String(text || "")
    .replace(/^\s*(?:Q|Question|A|Answer)\s*[:.)-]\s*/i, "")
    .replace(/^\s*\d{1,4}[.)-]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toQuizOptionLength(text, maxChars) {
  const max = maxChars || 150;
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  const head = compact.slice(0, max + 1);
  let punctuationCut = -1;
  for (let i = head.length - 1; i >= 0; i -= 1) { const ch = head[i]; if (ch === "." || ch === ";" || ch === ":") { punctuationCut = i; break; } }
  if (punctuationCut >= 60 && punctuationCut < max) return compact.slice(0, punctuationCut + 1).trim();
  let wordCut = head.lastIndexOf(" ");
  if (!(wordCut >= 60 && wordCut < max)) wordCut = max;
  return compact.slice(0, wordCut).replace(/[.,;:]+$/, "") + "…";
}

function structuredQuizAnswerOrNull(rawLine) {
  const line = cleanQuizOptionText(rawLine).replace(/\s+/g, " ").trim();
  for (const separator of [" - ", ": "]) {
    const index = line.indexOf(separator);
    if (!(index >= 4 && index <= 80)) continue;
    const left = line.slice(0, index).trim();
    const right = line.slice(index + separator.length).trim();
    if (right.length < 16) continue;
    if (left.toUpperCase() === CANDIDATE_TAG) continue;
    const value = (left.length >= 3 && left.length <= 54 && right.length <= 130) ? left + " - " + right : right;
    return cleanQuizOptionText(value);
  }
  return null;
}

/* QuizRunScreen.conciseQuizFact */
export function conciseQuizFact(raw) {
  const cleanedLines = String(raw || "").split(/\r?\n/).map(function (line) {
    let l = line.trim();
    if (l.startsWith("-")) l = l.slice(1);
    if (l.startsWith("*")) l = l.slice(1);
    if (l.startsWith("•")) l = l.slice(1);
    return l.trim();
  }).filter(function (line) {
    const u = line.toUpperCase();
    return line && u !== CANDIDATE_TAG && !u.startsWith("STATUS:") && !u.startsWith("SOURCE:");
  });
  if (!cleanedLines.length) return "";
  for (const line of cleanedLines) {
    const structured = structuredQuizAnswerOrNull(line);
    if (structured != null) return toQuizOptionLength(structured);
  }
  const cleaned = cleanQuizOptionText(cleanedLines.join(" ")).replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const sentences = cleaned.split(/(?<=[.!?])\s+/);
  const first = sentences.find(function (s) { return s.trim().length >= 18; });
  return toQuizOptionLength((first || cleaned).trim());
}

/* QuizRunScreen.quizOptionSnippet */
export function quizOptionSnippet(unit) {
  const fact = conciseQuizFact(unit.content);
  if (fact) return fact;
  return cleanQuizOptionText(unit.title).replace(/\s+/g, " ").trim() || "(empty)";
}

function quizOptionKey(unit) {
  return quizOptionSnippet(unit).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function quizTokenSet(text) {
  const set = new Set();
  String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").forEach(function (token) {
    const t = token.trim();
    if (t.length >= 3 && !QUIZ_STOP_WORDS.has(t)) set.add(t);
  });
  return set;
}

function setEquals(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
function intersectionSize(a, b) { let n = 0; for (const v of a) if (b.has(v)) n += 1; return n; }

function quizOptionSimilarity(a, b) {
  const aTokens = quizTokenSet(quizOptionSnippet(a));
  const bTokens = quizTokenSet(quizOptionSnippet(b));
  const smaller = Math.min(aTokens.size, bTokens.size);
  if (smaller === 0) return 0;
  return intersectionSize(aTokens, bTokens) / smaller;
}

function distractorRank(target, candidate) {
  const targetTags = new Set([...tags(target)].filter(function (t) { return t !== CANDIDATE_TAG; }));
  const candidateTags = new Set([...tags(candidate)].filter(function (t) { return t !== CANDIDATE_TAG; }));
  const commonTags = intersectionSize(targetTags, candidateTags);
  const variantPenalty = (candidate.aircraftVariant === target.aircraftVariant || candidate.aircraftVariant === "BOTH") ? 0 : 25;
  const lengthPenalty = Math.floor(Math.abs(quizOptionSnippet(target).length - quizOptionSnippet(candidate).length) / 12);
  return variantPenalty + lengthPenalty - (commonTags * 10);
}

function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

/* QuizRunScreen.chooseQuizDistractors */
export function chooseQuizDistractors(item, pool) {
  const selected = [];
  const usedKeys = new Set([quizOptionKey(item)]);
  const sameSystem = pool.filter(function (c) { return c.id !== item.id && c.system === item.system; });
  const sameVariantAndSystem = sameSystem.filter(function (c) {
    return c.aircraftVariant === item.aircraftVariant || c.aircraftVariant === "BOTH" || item.aircraftVariant === "BOTH";
  });
  function tryAdd(candidate, strict) {
    if (selected.length >= 3) return true;
    if (candidate.id === item.id) return false;
    const snippet = quizOptionSnippet(candidate);
    const key = quizOptionKey(candidate);
    if (!key || usedKeys.has(key)) return false;
    if (strict && snippet.length < 24) return false;
    if (strict && quizOptionSimilarity(item, candidate) > 0.72) return false;
    const targetTitleTokens = quizTokenSet(item.title);
    const candidateTitleTokens = quizTokenSet(candidate.title);
    if (strict && targetTitleTokens.size > 0 && setEquals(targetTitleTokens, candidateTitleTokens)) return false;
    selected.push(candidate);
    usedKeys.add(key);
    return selected.length >= 3;
  }
  function addFrom(candidates, strict) {
    const sorted = candidates.filter(function (c) { return c.id !== item.id; }).sort(function (a, b) {
      return (distractorRank(item, a) - distractorRank(item, b)) || cmp(a.title, b.title) || cmp(a.id, b.id);
    });
    for (const candidate of sorted) if (tryAdd(candidate, strict)) return;
  }
  addFrom(sameVariantAndSystem, true);
  addFrom(sameSystem, true);
  addFrom(pool.filter(function (c) { return c.id !== item.id; }), false);
  return selected.slice(0, 3);
}

/* QuizRunScreen.buildQuiz */
export function buildQuiz(pool, length, rng) {
  const seen = new Set();
  const candidates = pool.filter(function (u) { return (u.title && u.title.trim()) || (u.content && u.content.trim()); })
    .filter(function (u) { if (seen.has(u.id)) return false; seen.add(u.id); return true; });
  if (!candidates.length) return [];
  const take = shuffled(candidates, rng).slice(0, Math.min(length, candidates.length));
  return take.map(function (item) {
    const distractors = chooseQuizDistractors(item, candidates);
    const seenIds = new Set();
    const optionsRaw = shuffled(distractors.concat([item]).filter(function (u) { if (seenIds.has(u.id)) return false; seenIds.add(u.id); return true; }), rng);
    const correctIndex = Math.max(0, optionsRaw.findIndex(function (u) { return u.id === item.id; }));
    return {
      item: item,
      options: optionsRaw.map(function (opt) { return { itemId: opt.id, snippet: quizOptionSnippet(opt) }; }),
      correctIndex: correctIndex
    };
  });
}

export function answerLabel(index) { return index == null ? "No answer" : String.fromCharCode(65 + index); }

export function formatQuizDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? minutes + "m " + seconds + "s" : seconds + "s";
}

/* Source line shown under each question (QuizRunScreen `src`). */
export function quizSourceLine(unit) {
  let s = unit.system + " • " + unit.aircraftVariant + " • " + (unit.sourceTitle || "Source");
  if (unit.pageStart != null) { s += " • p." + unit.pageStart; if (unit.pageEnd != null && unit.pageEnd !== unit.pageStart) s += "-" + unit.pageEnd; }
  if (unit.sectionRef) s += " • " + String(unit.sectionRef).slice(0, 48);
  return s;
}

/* QuizLogbookMapper.toLogbookEntry */
export function quizResultToLogbookEntry(result) {
  const totalQuestions = result.questions.length;
  const correctCount = result.questions.filter(function (q) { return q.isCorrect; }).length;
  const missedCount = totalQuestions - correctCount;
  const scorePercent = totalQuestions === 0 ? 0 : Math.floor((correctCount * 100) / totalQuestions);
  const sysRaw = String(result.systemNameOrNull || "").trim();
  const systemLabel = sysRaw ? sysRaw.replace(/_/g, " ").toLowerCase().replace(/^./, function (c) { return c.toUpperCase(); }) : "All systems";
  const missedReview = result.questions.filter(function (q) { return !q.isCorrect; }).slice(0, 5).map(function (q) {
    return "Review: " + q.prompt + " (chosen " + (q.chosenOptionIndex == null ? "no answer" : answerLabel(q.chosenOptionIndex)) + ", correct " + answerLabel(q.correctOptionIndex) + ")";
  }).join("\n");
  let remarks = "Knowledge quiz completed. Score " + correctCount + "/" + totalQuestions + " (" + scorePercent + "%). System: " + systemLabel + ".";
  if (missedReview) remarks += "\n" + missedReview;
  const band = scorePercent >= 90 ? "EXCELLENT" : scorePercent >= 80 ? "GOOD" : scorePercent >= 70 ? "SATISFACTORY" : scorePercent >= 60 ? "MARGINAL" : "UNSATISFACTORY";
  const feedback = missedCount === 0 ? "Quiz complete: no review items." : scorePercent >= 80 ? "Quiz complete: review missed source items before the next attempt." : "Quiz complete: repeat the quiz after reviewing missed source items.";
  const variant = ["LEGACY", "G950", "BOTH"].includes(String(result.variantStr || "").trim().toUpperCase()) ? result.variantStr.trim().toUpperCase() : "BOTH";
  return {
    timestampUtc: result.startedAtEpochMs,
    procedureName: "Knowledge Quiz: " + systemLabel,
    category: "NORMAL",
    aircraftVariant: variant,
    totalSteps: totalQuestions,
    wrongRoleCount: 0,
    wrongCalloutCount: missedCount,
    rushedCount: 0,
    toleranceUsedCount: 0,
    totalTimeMs: Math.max(0, result.finishedAtEpochMs - result.startedAtEpochMs),
    scoreBand: band,
    scorePercent: scorePercent,
    remarks: remarks,
    instructorFeedback: feedback,
    examinerOverride: false,
    examinerMode: "OFF",
    attemptId: "quiz-" + result.startedAtEpochMs + "-" + result.finishedAtEpochMs + "-" + (String(result.variantStr || "").trim() || "BOTH") + "-" + (sysRaw || "ALL") + "-" + totalQuestions,
    stepLatencies: result.questions.map(function (q) { return q.timeMs; }),
    kind: "quiz"
  };
}
