/*
  Manual QRH edits API — a signed-in session is required for every call, and the
  edits belong to that account alone.

    GET    /api/qrh-edits              -> this account's edited procedures
    GET    /api/qrh-edits/<procId>     -> one draft (404 when unedited)
    PUT    /api/qrh-edits/<procId>     -> save a draft   (owner / instructor only)
    DELETE /api/qrh-edits/<procId>     -> revert to the published procedure

  Reading needs any active entitlement, so a subscriber whose plan changed can
  still see and revert their own work. Writing follows Android's
  AccessPolicy.canEditQrh: owner access or the QRH_MANUAL_EDIT entitlement.

  When an entitlement lapses, authorizeWebRequest answers 403 and the stored
  drafts simply become unreachable — nothing is deleted, so renewing restores them.
*/

import { json } from "../_shared.js";
import { authorizeWebRequest } from "../web-access/_session.js";
import { accountIdFor, canEditQrh, normalizeProcedureId, sanitizeDraft, readIndex, readEdit, writeEdit, deleteEdit, LIMITS } from "./_store.js";

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

function procedureIdFrom(url) {
  const path = url.pathname.replace(/\/+$/, "");
  const match = path.match(/^\/api\/qrh-edits\/(.+)$/);
  if (!match) return null;
  let raw;
  try { raw = decodeURIComponent(match[1]); } catch (error) { return null; }
  return normalizeProcedureId(raw);
}

async function authorize(context) {
  const auth = await authorizeWebRequest(context);
  if (!auth.ok) return { response: json({ ok: false, error: auth.error }, auth.status) };
  return { auth: auth, accountId: await accountIdFor(auth) };
}

export async function onRequestGet(context) {
  const gate = await authorize(context);
  if (gate.response) return gate.response;
  const url = new URL(context.request.url);

  if (url.pathname.replace(/\/+$/, "") === "/api/qrh-edits") {
    const index = await readIndex(context.env, gate.accountId);
    return protectedJson({ ok: true, canEdit: canEditQrh(gate.auth), updatedAt: index.updatedAt, items: index.items });
  }

  const procedureId = procedureIdFrom(url);
  if (!procedureId) return json({ ok: false, error: "bad_procedure_id" }, 400);
  const record = await readEdit(context.env, gate.accountId, procedureId);
  if (!record) return protectedJson({ ok: true, edited: false, procedureId: procedureId, draft: null }, 404);
  return protectedJson({ ok: true, edited: true, canEdit: canEditQrh(gate.auth), procedureId: procedureId, draft: record.draft, updatedAt: record.updatedAt });
}

export async function onRequestPut(context) {
  const gate = await authorize(context);
  if (gate.response) return gate.response;
  if (!canEditQrh(gate.auth)) return json({ ok: false, error: "qrh_edit_not_permitted" }, 403);

  const url = new URL(context.request.url);
  const procedureId = procedureIdFrom(url);
  if (!procedureId) return json({ ok: false, error: "bad_procedure_id" }, 400);

  let body;
  try { body = await context.request.json(); } catch (error) { return json({ ok: false, error: "bad_json" }, 400); }
  const draft = sanitizeDraft(body && body.draft);
  if (!draft) return json({ ok: false, error: "bad_draft", limits: LIMITS }, 422);

  const record = await writeEdit(context.env, gate.accountId, procedureId, draft);
  if (!record) return json({ ok: false, error: "storage_unavailable" }, 503);
  return protectedJson({ ok: true, edited: true, procedureId: procedureId, draft: record.draft, updatedAt: record.updatedAt });
}

export async function onRequestDelete(context) {
  const gate = await authorize(context);
  if (gate.response) return gate.response;
  if (!canEditQrh(gate.auth)) return json({ ok: false, error: "qrh_edit_not_permitted" }, 403);

  const url = new URL(context.request.url);
  const procedureId = procedureIdFrom(url);
  if (!procedureId) return json({ ok: false, error: "bad_procedure_id" }, 400);

  await deleteEdit(context.env, gate.accountId, procedureId);
  return protectedJson({ ok: true, edited: false, procedureId: procedureId, draft: null });
}
