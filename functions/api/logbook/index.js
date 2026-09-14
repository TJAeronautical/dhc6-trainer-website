/*
  Debrief Logbook sync — a signed-in session is required for every call, and the
  entries belong to that account alone.

    GET    /api/logbook   -> this account's entries, newest first
    PUT    /api/logbook   -> merge the body's entries in, return the merged set
    DELETE /api/logbook   -> clear this account's entries

  PUT merges rather than replaces. Two browsers sync the same account without one
  erasing the other's attempts, and a client that has just been cleared cannot
  wipe the record by pushing an empty list — DELETE is the explicit way to do
  that, which is what Settings → Clear local progress calls when the user asks
  for it.

  Any active entitlement may read and write: recording your own training is not
  an authoring privilege. When an entitlement lapses authorizeWebRequest answers
  403 and the stored entries become unreachable without being deleted, so
  renewing restores them.
*/

import { json } from "../_shared.js";
import { authorizeWebRequest } from "../web-access/_session.js";
import { accountIdFor, sanitizeEntries, mergeEntries, readLogbook, writeLogbook, deleteLogbook, LIMITS } from "./_store.js";

function protectedJson(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      "Vary": "Cookie, Authorization",
      "X-Robots-Tag": "noindex, nofollow"
    }
  });
}

async function authorize(context) {
  const auth = await authorizeWebRequest(context);
  if (!auth.ok) return { response: json({ ok: false, error: auth.error }, auth.status) };
  return { auth: auth, accountId: await accountIdFor(auth) };
}

export async function onRequestGet(context) {
  const gate = await authorize(context);
  if (gate.response) return gate.response;
  const record = await readLogbook(context.env, gate.accountId);
  return protectedJson({ ok: true, updatedAt: record.updatedAt, entries: record.entries, limit: LIMITS.entries });
}

export async function onRequestPut(context) {
  const gate = await authorize(context);
  if (gate.response) return gate.response;

  let body;
  try { body = await context.request.json(); } catch (error) { return json({ ok: false, error: "invalid_json" }, 400); }
  if (!body || typeof body !== "object") return json({ ok: false, error: "invalid_body" }, 400);
  if (!Array.isArray(body.entries)) return json({ ok: false, error: "entries_required" }, 400);
  if (body.entries.length > LIMITS.entries * 2) return json({ ok: false, error: "too_many_entries" }, 413);

  const incoming = sanitizeEntries(body.entries);
  if (!incoming) return json({ ok: false, error: "invalid_entries" }, 400);

  const existing = await readLogbook(context.env, gate.accountId);
  const merged = mergeEntries(existing.entries, incoming);

  /* A merge that changes nothing does not need a write. Skipping it keeps
     updatedAt meaningful and avoids a KV put on every app open. */
  const unchanged = merged.length === existing.entries.length &&
    merged.every(function (e, i) {
      const prev = existing.entries[i];
      return prev && prev.attemptId === e.attemptId && prev.timestampUtc === e.timestampUtc &&
        prev.instructorFeedback === e.instructorFeedback && prev.examinerOverride === e.examinerOverride;
    });
  if (unchanged) {
    return protectedJson({ ok: true, updatedAt: existing.updatedAt, entries: merged, stored: merged.length, changed: false });
  }

  const payload = JSON.stringify({ entries: merged });
  if (payload.length > LIMITS.bodyBytes) return json({ ok: false, error: "logbook_too_large" }, 413);

  const updatedAt = await writeLogbook(context.env, gate.accountId, merged);
  if (!updatedAt) return json({ ok: false, error: "storage_unavailable" }, 503);
  return protectedJson({ ok: true, updatedAt: updatedAt, entries: merged, stored: merged.length, changed: true });
}

export async function onRequestDelete(context) {
  const gate = await authorize(context);
  if (gate.response) return gate.response;
  await deleteLogbook(context.env, gate.accountId);
  return protectedJson({ ok: true, updatedAt: null, entries: [], stored: 0 });
}
