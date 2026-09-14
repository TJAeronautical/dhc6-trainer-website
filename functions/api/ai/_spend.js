/*
  A budget for the one endpoint that spends real money.

  /api/ai/oral-exam forwards to OpenAI on the operator's key. Phase 36 settled
  WHO may call it - a signed web session or a Firebase account, both holding
  AI_TRAINER. It never settled HOW MUCH, and until phase 46 that gap was
  academic because no screen called the endpoint at all.

  It is not academic now. The screen caps a session at twelve questions, and a
  client-side cap is not a control: the endpoint is an ordinary POST, and any
  subscriber - or anyone holding a stolen session cookie - can run it in a loop
  and spend the operator's credit until the card declines. Every other gate in
  this codebase is a server-side allowlist. This one was an honour system.

  ---------------------------------------------------------------------------
  TWO WINDOWS, AND WHY

  A burst window stops a loop. A daily window is what actually bounds the bill:
  a script pacing itself just under a five-minute limit would still spend all
  month, and a limit that only catches the impatient is not a budget.

  Counted per ACCOUNT rather than per IP. The account is the thing that spends,
  the caller is already authenticated so there is nothing to be gained by
  hiding, and an IP key would put a whole airline behind one NAT on a single
  budget while a subscriber with a phone and a laptop looks like two people.

  The defaults are set so that ordinary use never reaches them - six full
  twelve-question sessions a day - and both are overridable from Cloudflare
  without a deploy, because the right number is an operating decision and it
  will change.

  ---------------------------------------------------------------------------
  IT FAILS OPEN, DELIBERATELY

  When KV cannot be read, the call is allowed. That is the same choice
  _seats.js makes and for the same reason: a paying subscriber must not be
  locked out of what they bought by a transient storage error. The exposure is
  bounded by the outage, an attacker cannot cause one, and the alternative -
  refusing a real customer mid-exam because a KV read timed out - is a worse
  failure that happens far more often.

  What must NOT fail open is the charge: a refused call costs nothing, so the
  counter is only incremented once the call is actually going to be made.
*/

import { accountIdFor } from "../_account.js";

const PREFIX = "aispend:";

export const BURST_LIMIT = 15;
export const BURST_WINDOW_SECONDS = 5 * 60;
export const DAILY_LIMIT = 80;
export const DAILY_WINDOW_SECONDS = 24 * 60 * 60;

function positiveInt(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return fallback;
  return Math.floor(number);
}

export function burstLimit(env) { return positiveInt(env && env.AI_BURST_LIMIT, BURST_LIMIT); }
export function dailyLimit(env) { return positiveInt(env && env.AI_DAILY_LIMIT, DAILY_LIMIT); }

async function readCount(env, key) {
  try {
    const raw = await env.LICENSES.get(key);
    const count = Number(raw || 0);
    return Number.isFinite(count) && count >= 0 ? count : 0;
  } catch (error) {
    /* Unreadable, not zero. The caller distinguishes them. */
    return null;
  }
}

/*
  Check both windows and, if the call is allowed, charge it.

  Returns { ok: true } or { ok: false, error, limit, window, retryAfterSeconds }.

  `unavailable: true` on the result records that a window could not be read, so
  the endpoint can log it - a budget that has silently stopped counting is worth
  knowing about, and a 200 that says nothing is how you find out from the bill.
*/
export async function chargeExamQuestion(env, auth) {
  if (!env || !env.LICENSES) return { ok: true, unavailable: true };

  const accountId = await accountIdFor(auth);
  if (!accountId) {
    /* Unidentifiable callers do not get an unmetered budget. */
    return { ok: false, error: "account_unidentified", status: 403 };
  }

  const windows = [
    { scope: "burst", limit: burstLimit(env), seconds: BURST_WINDOW_SECONDS },
    { scope: "daily", limit: dailyLimit(env), seconds: DAILY_WINDOW_SECONDS }
  ];

  const counts = [];
  let unavailable = false;
  for (const window of windows) {
    const key = PREFIX + window.scope + ":" + accountId;
    const count = await readCount(env, key);
    if (count === null) { unavailable = true; counts.push({ window: window, key: key, count: 0 }); continue; }
    if (count >= window.limit) {
      return {
        ok: false,
        error: "ai_rate_limited",
        status: 429,
        limit: window.limit,
        window: window.scope,
        retryAfterSeconds: window.seconds
      };
    }
    counts.push({ window: window, key: key, count: count });
  }

  /* Charged only now, because a refused call costs nothing. */
  for (const entry of counts) {
    try {
      await env.LICENSES.put(entry.key, String(entry.count + 1), { expirationTtl: entry.window.seconds });
    } catch (error) {
      unavailable = true;
    }
  }

  return { ok: true, unavailable: unavailable };
}
