/*
  ORAL EXAM — the examiner's material, its instructions, and the wire format.

  The endpoint (functions/api/ai/oral-exam.js) has been session-gated and
  AI_TRAINER-gated since phase 36. It takes `instructions` and `input`, which
  means the CLIENT supplies the examiner's brief. That is the whole design
  decision, and it is a safety one.

  ---------------------------------------------------------------------------
  THE RULE: THE EXAMINER IS GROUNDED, NOT ASKED TO REMEMBER

  A language model asked "examine this pilot on the DHC-6" will state torque
  limits, VREF speeds and memory items from whatever it absorbed in training.
  Some of it will be right. Some will be a Series 400, or a different operator's
  numbers, or invented outright — and it will all be stated in the same
  confident voice, to somebody studying for a check ride.

  The project rule is "do not invent fictional flight data, procedures or
  aircraft limitations", and that rule cannot be delegated to a model's
  discretion. So the examiner is never asked to recall anything. Every session
  carries a block of the app's OWN authored material — knowledge-pool units
  built from the Android decks and quiz bank, each with its approved answer and
  its source reference — and the instructions confine the examiner to it:

    - ask about the supplied material and nothing else;
    - the unit's `content` IS the approved answer; mark against that;
    - never state a figure, speed, weight or limit that is not in the block;
    - a question outside the block gets "that is outside the bundled material",
      with the approved source named, not a best guess.

  This is stricter than it needs to be for a conversation to feel natural, and
  that is the intended trade. An examiner that says "I can't confirm that from
  the bundled material" is useful. One that confidently invents a torque limit
  is a hazard wearing the app's badge.

  NOTE ON THE INSTRUCTION TEXT: the wording below is web-authored. The Android
  screen's own examiner brief has not been read into this repository yet, so
  the two products may phrase the examiner's character differently even though
  both are grounded in the same authored decks. When the Android Kotlin arrives,
  EXAMINER_BRIEF is the single constant to replace — the grounding architecture
  around it does not change.
*/

/* Each question is a paid upstream call, so a session is bounded. The cap is
   generous enough for a real practice run and small enough that a left-open
   tab cannot quietly spend the operator's credit. */
export const MAX_QUESTIONS = 12;

/* How much authored material one session carries. Twelve units is a few
   thousand characters — enough for the examiner to follow a thread rather than
   reading a list, and well inside the request budget. */
export const UNITS_PER_SESSION = 12;

/*
  How many questions THIS session may ask, which is not always MAX_QUESTIONS.

  The live topic list shows why: "Indications Alerting (2)". Pick it and the
  examiner is handed two authored facts and told it may ask twelve questions.
  It cannot do that honestly. It will either repeat itself or start reaching
  past the material — and reaching past the material is the one thing this
  feature is built not to do. A cap the content cannot support is pressure to
  invent, applied by us.

  So the promise follows the material: a two-unit topic is a two-question exam,
  and it says so on the card before anybody taps Begin.
*/
export function questionCap(units) {
  const available = Array.isArray(units) ? units.length : 0;
  return Math.max(0, Math.min(MAX_QUESTIONS, available));
}

/* The same number, before a session exists — so the topic card can promise
   honestly rather than promising twelve and delivering two. */
export function questionCapForCount(count) {
  return questionCap(new Array(Math.max(0, Number(count) || 0)));
}

export const EXAMINER_BRIEF = [
  "You are a DHC-6 Twin Otter type examiner conducting an oral examination for check-ride preparation.",
  "",
  "You examine ONLY on the STUDY MATERIAL supplied below. It is the operator's own approved training content.",
  "",
  "Rules you follow without exception:",
  "1. Ask one question at a time, drawn from the study material. Wait for the candidate's answer before the next.",
  "2. The `Answer:` line of a unit is the approved answer. Mark the candidate against it, not against your own recollection.",
  "3. Never state a speed, weight, torque, temperature, time, quantity or limitation that does not appear in the study material. If you need a figure that is not there, say so instead of supplying one.",
  "4. If the candidate asks about something outside the study material, say it is outside the bundled material and name the approved source they should consult. Do not answer from memory.",
  "5. If the candidate is wrong, say so plainly, give the approved answer, and cite the unit's source line.",
  "6. If the candidate is right, confirm briefly and move on. Do not pad.",
  "7. Keep each turn short — a few sentences. This is an oral exam, not a lecture.",
  "",
  "You are training support. You are not a check ride, and you do not replace the approved AFM, QRH, MEL, company manuals or an authorised examiner. Say so if the candidate treats your assessment as a qualification."
].join("\n");

/* ------------------------------------------------------------ the material */

/*
  The systems present in the pool, with how many units each has. Derived from
  the pack rather than hardcoded: a deck added on the Android side appears here
  without a web change, and a system that loses its cards stops being offered
  instead of opening an empty exam.
*/
export function systemsIn(pool) {
  const counts = new Map();
  ((pool && pool.units) || []).forEach(function (unit) {
    if (!unit || unit.examRelevant === false) return;
    const system = String(unit.system || "GENERAL");
    counts.set(system, (counts.get(system) || 0) + 1);
  });
  return Array.from(counts.entries())
    .map(function (entry) { return { system: entry[0], count: entry[1] }; })
    .sort(function (a, b) { return b.count - a.count || a.system.localeCompare(b.system); });
}

export function systemLabel(system) {
  return String(system || "")
    .split("_")
    .filter(Boolean)
    .map(function (word) { return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(); })
    .join(" ") || "General";
}

/*
  Pick the units for one session.

  `variant` filters the way the rest of the app does: a LEGACY airframe must not
  be examined on G950 material, and BOTH applies to either. The shuffle is
  seeded so a session can be reproduced from its own seed — which matters when
  a subscriber says the examiner asked something odd and there is no transcript
  on the server to go and read.
*/
export function pickUnits(pool, options) {
  const opts = options || {};
  const variant = String(opts.variant || "BOTH").toUpperCase();
  const wanted = Math.max(1, Math.min(UNITS_PER_SESSION, Number(opts.count) || UNITS_PER_SESSION));

  const eligible = ((pool && pool.units) || []).filter(function (unit) {
    if (!unit || unit.examRelevant === false) return false;
    if (!String(unit.title || "").trim() || !String(unit.content || "").trim()) return false;
    if (opts.system && String(unit.system || "GENERAL") !== opts.system) return false;
    const unitVariant = String(unit.aircraftVariant || "BOTH").toUpperCase();
    if (variant !== "BOTH" && unitVariant !== "BOTH" && unitVariant !== variant) return false;
    return true;
  });

  const rng = typeof opts.rng === "function" ? opts.rng : Math.random;
  const shuffled = eligible.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const swap = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = swap;
  }
  return shuffled.slice(0, wanted);
}

/* One unit as the examiner reads it: the prompt, the approved answer, and where
   it came from so a correction can cite rather than assert. */
export function unitBlock(unit) {
  const lines = ["Topic: " + String(unit.title || "").trim(), "Answer: " + String(unit.content || "").trim()];
  const source = [unit.sourceTitle, unit.sectionRef].filter(Boolean).join(" — ");
  if (source) lines.push("Source: " + source);
  return lines.join("\n");
}

export function groundingBlock(units) {
  return (units || []).map(unitBlock).join("\n\n");
}

export function buildInstructions(units) {
  return EXAMINER_BRIEF + "\n\n---\nSTUDY MATERIAL (the only material you may examine on):\n\n" + groundingBlock(units);
}

/* ------------------------------------------------------------- the request */

/*
  The transcript as the endpoint wants it. Roles are the OpenAI Responses
  shape; the grounding rides in `instructions`, never in the visible turns, so
  a candidate scrolling back sees the exam rather than the answer key.
*/
export function toRequest(units, turns) {
  return {
    instructions: buildInstructions(units),
    input: (turns || []).map(function (turn) {
      return { role: turn.role === "examiner" ? "assistant" : "user", content: String(turn.text || "") };
    })
  };
}

/* The opening turn. The examiner needs something to answer, and an empty input
   array is refused by the endpoint as an invalid payload. */
export const OPENING_TURN = { role: "candidate", text: "I am ready to begin. Please ask your first question." };

/* Responses-API output, defensively: a shape change upstream must read as
   "nothing came back", never as an exception inside a render. */
export function replyText(body) {
  if (!body || typeof body !== "object") return "";
  const parts = [];
  ((body.output) || []).forEach(function (item) {
    ((item && item.content) || []).forEach(function (chunk) {
      if (chunk && typeof chunk.text === "string") parts.push(chunk.text);
    });
  });
  if (!parts.length && typeof body.output_text === "string") parts.push(body.output_text);
  return parts.join("").trim();
}

/* ------------------------------------------------------------- refusals */

/*
  What the screen says when the endpoint refuses.

  The distinction that matters: `entitlement_check_unavailable` is a 503 from a
  misconfiguration or a Google outage, and it must NOT read as "you do not have
  this". Telling a paying subscriber they lack a feature they bought is a worse
  failure than saying the examiner is unavailable, because one of them sends
  them to the billing page.
*/
export function refusalFor(status, code) {
  const error = String(code || "");
  if (error === "entitlement_required") {
    return { title: "Premium feature", body: "The AI oral exam is part of the Premium plan.", action: { label: "See your plan", href: "#/settings" } };
  }
  if (error === "entitlement_check_unavailable" || error === "openai_api_key_missing" || status === 503) {
    return { title: "The examiner is unavailable", body: "This is a problem at our end, not with your subscription. Please try again shortly.", retry: true };
  }
  if (status === 401 || error === "session_invalid" || error === "session_revoked") {
    return { title: "Please sign in again", body: "Your session has expired.", action: { label: "Sign in", href: "/web-app.html" } };
  }
  if (error === "subscription_inactive") {
    return { title: "Subscription inactive", body: "Your subscription is not currently active.", action: { label: "Manage your account", href: "/access.html" } };
  }
  if (error === "invalid_oral_exam_payload" || status === 400) {
    return { title: "The examiner could not read that", body: "Something went wrong building the question. Starting a new session usually clears it.", retry: true };
  }
  return { title: "The examiner is unavailable", body: "Please try again shortly.", retry: true };
}

/* ------------------------------------------------------------- transcript */

export function appendTurn(turns, role, text) {
  const list = (turns || []).slice();
  list.push({ role: role, text: String(text || "") });
  return list;
}

/* Questions asked, which is what the cap counts — the opening prompt is not a
   question and a candidate's answer is not one either. */
export function questionsAsked(turns) {
  return (turns || []).filter(function (turn) { return turn.role === "examiner"; }).length;
}

/* `units` is what the session was actually given, so a thin topic finishes
   when its material does rather than when a constant says so. */
export function atLimit(turns, units) {
  return questionsAsked(turns) >= (units === undefined ? MAX_QUESTIONS : questionCap(units));
}
