/*
  POST /api/ai/oral-exam — the AI examiner proxy.

  This endpoint spends money. It forwards to OpenAI on the operator's key, and
  until now it checked only that the caller held a valid Firebase ID token for
  the project: no licence, no subscription, no entitlement. Any account that
  could sign in to Firebase could spend the key, and the feature is sold as
  Premium.

  It is called from two quite different clients, so it accepts two proofs and
  demands the AI_TRAINER entitlement on both:

    1. The browser app - a signed web session cookie or bearer token, whose
       tier comes from the live licence record.
    2. The Android app - a Firebase ID token, whose tier comes from the
       entitlements Google Play validation wrote to Firestore for that user.

  Checking only the web session would have been simpler and would have broken
  the Android oral exam, which is the client the endpoint was built for.
*/

import { json } from "../_shared.js";
import { readJson, verifyFirebaseUser, readCurrentEntitlements } from "../_mobile_shared.js";
import { authorizeWebRequest } from "../web-access/_session.js";
import { AI_TRAINER, hasEntitlement, tierLabel, lowestTierWith } from "../_entitlements.js";
import { chargeExamQuestion } from "./_spend.js";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-4.1-mini";
const MAX_OUTPUT_TOKENS = 600;

/*
  How big a payload this endpoint will forward.

  `instructions` is supplied by the CLIENT, deliberately - the Android
  examiner's brief is not the browser's, and the grounding block rides in it.
  That design decision has a cost nobody had priced: the size of what gets
  forwarded is entirely the caller's choice, the budget in _spend.js counts
  CALLS rather than tokens, and input tokens are billed. A subscriber holding
  AI_TRAINER could post megabytes eighty times a day on the operator's key
  without once exceeding the rate limit.

  MAX_OUTPUT_TOKENS has always bounded the reply. Nothing bounded the question.

  These numbers are far above any real exam - a twelve-unit grounding block is
  a few thousand characters, and a spoken answer is a few hundred - and far
  below a bill. Refused, never truncated: a silently shortened answer is one
  the examiner marks against material the candidate did not send.
*/
export const MAX_INSTRUCTIONS_CHARS = 32768;
export const MAX_TURN_CHARS = 8192;
export const MAX_INPUT_ITEMS = 80;
export const MAX_INPUT_CHARS = 131072;

function tooLarge(reason, limit) {
  return json({ ok: false, error: "oral_exam_payload_too_large", reason: reason, limit: limit }, 413);
}

function refusal() {
  const needed = lowestTierWith(AI_TRAINER);
  return json({
    ok: false,
    error: "entitlement_required",
    entitlement: AI_TRAINER,
    requiredTier: needed,
    message: "The AI oral exam is part of the " + tierLabel(needed) + " plan."
  }, 403);
}

/*
  Returns { ok:true, via } or { ok:false, response }.

  The web session is tried first and only falls through to Firebase when there
  is no session at all. A session that exists but lacks the entitlement is a
  refusal, not an invitation to try the other door - otherwise a subscriber
  without AI_TRAINER could simply present a Firebase token instead.
*/
async function authorize(context) {
  const web = await authorizeWebRequest(context);
  if (web.ok) {
    if (!hasEntitlement(web, AI_TRAINER)) return { ok: false, response: refusal() };
    return { ok: true, via: "web", auth: web };
  }

  /* No session presented at all - this is the Android path. A session that was
     presented and rejected (expired, revoked, lapsed) is reported as such
     rather than silently retried as a different kind of caller. */
  if (web.error !== "session_invalid") {
    return { ok: false, response: json({ ok: false, error: web.error }, web.status) };
  }

  const firebase = await verifyFirebaseUser(context);
  if (!firebase.ok) return { ok: false, response: firebase.response };

  /*
    Reading what Play granted needs a Google service account, and it throws when
    one is not configured. That must not become a 500 - and it must certainly
    not become a way through. An entitlement that cannot be read is an
    entitlement the caller does not have, because the alternative is that a
    misconfiguration silently reopens the key to every Firebase account.
  */
  let entitlements = [];
  try {
    const play = await readCurrentEntitlements(context.env, firebase.uid);
    entitlements = (play && play.entitlements) || [];
  } catch (error) {
    console.warn("oral-exam: could not read Play entitlements (" + String(error && error.message) + ")");
    return { ok: false, response: json({ ok: false, error: "entitlement_check_unavailable" }, 503) };
  }

  if (entitlements.indexOf(AI_TRAINER) < 0) return { ok: false, response: refusal() };
  /* The auth shape the budget counts against. An Android caller has no licence
     key, so its identity is the Firebase uid - see _account.js. */
  return { ok: true, via: "play", auth: { ok: true, role: "subscriber", client: "android", uid: firebase.uid } };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const auth = await authorize(context);
  if (!auth.ok) return auth.response;

  if (!env.OPENAI_API_KEY) {
    return json({ ok: false, error: "openai_api_key_missing" }, 503);
  }

  const body = await readJson(request);
  if (!body || typeof body !== "object") {
    return json({ ok: false, error: "bad_json" }, 400);
  }

  const payload = {
    model: String(env.OPENAI_MODEL || body.model || DEFAULT_MODEL),
    instructions: String(body.instructions || ""),
    input: Array.isArray(body.input) ? body.input : [],
    max_output_tokens: Math.min(
      MAX_OUTPUT_TOKENS,
      Math.max(1, Number(body.max_output_tokens || MAX_OUTPUT_TOKENS))
    )
  };

  if (!payload.instructions || payload.input.length === 0) {
    return json({ ok: false, error: "invalid_oral_exam_payload" }, 400);
  }

  /*
    Bounded before it is charged and before it is forwarded, so an oversized
    payload costs neither the caller their budget nor the operator a call.
  */
  if (payload.instructions.length > MAX_INSTRUCTIONS_CHARS) {
    return tooLarge("instructions", MAX_INSTRUCTIONS_CHARS);
  }
  if (payload.input.length > MAX_INPUT_ITEMS) {
    return tooLarge("input_items", MAX_INPUT_ITEMS);
  }
  let inputChars = 0;
  for (const item of payload.input) {
    const content = item && typeof item.content === "string" ? item.content : "";
    if (content.length > MAX_TURN_CHARS) return tooLarge("turn", MAX_TURN_CHARS);
    inputChars += content.length;
  }
  if (inputChars > MAX_INPUT_CHARS) {
    return tooLarge("input_total", MAX_INPUT_CHARS);
  }

  /*
    Charged here, after the payload is known good and before a penny is spent.
    A malformed request must not cost the caller their budget, and a refused
    one must not cost the operator a call.
  */
  const budget = await chargeExamQuestion(env, auth.auth);
  if (!budget.ok) {
    const headers = budget.retryAfterSeconds ? { "Retry-After": String(budget.retryAfterSeconds) } : undefined;
    const body = { ok: false, error: budget.error };
    if (budget.limit) { body.limit = budget.limit; body.window = budget.window; }
    return new Response(JSON.stringify(body), {
      status: budget.status || 429,
      headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, headers || {})
    });
  }
  if (budget.unavailable) {
    /* A budget that has stopped counting is worth knowing about before the
       bill arrives, rather than after. */
    console.warn("oral-exam: the spend budget could not be read or written; this call was allowed uncounted");
  }

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + env.OPENAI_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  return new Response(text, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("Content-Type") || "application/json",
      "Cache-Control": "no-store"
    }
  });
}
