/*
  Client for the per-account QRH edit store (/api/qrh-edits).

  Edits live on the server, tied to the signed-in account and its entitlement:
  they follow the account to any device, and when a subscription lapses the API
  stops answering so the app falls back to the published procedure. Nothing is
  cached in the service worker — every request is `private, no-store`.
*/

const memory = new Map();
let permission = null;   // { canEdit } once /api/qrh-edits has answered

/*
  The index of this account's edited procedures, fetched once per session.

  Opening a procedure used to GET /api/qrh-edits/<id> every time, which answers
  404 for the overwhelmingly common case of "never edited". That is a correct
  REST answer, but it put a 404 in the console on the app's most-opened screen —
  noise that hides real 404s — and spent a round trip to learn nothing.

  The index already lists every edited procedure, so a procedure that is not in
  it provably has no draft and needs no request at all.

  Two things keep that safe:
    * The server caps the index at LIMITS.indexItems (500). At the cap it may be
      truncated, so it is no longer proof of absence and we go back to asking
      per procedure.
    * If the index cannot be fetched (no session, offline, error), indexIds
      stays null and every lookup falls back to the old behaviour.
*/
const INDEX_CAP = 500;
let indexIds = null;          // Set of procedureIds, or null when not usable

function adoptIndex(data) {
  const items = (data && data.items) || [];
  indexIds = items.length >= INDEX_CAP
    ? null
    : new Set(items.map(function (i) { return i && i.procedureId; }).filter(Boolean));
  return items;
}

function url(procedureId) {
  return "/api/qrh-edits" + (procedureId ? "/" + encodeURIComponent(procedureId) : "");
}

async function request(method, procedureId, body) {
  const response = await fetch(url(procedureId), {
    method: method,
    credentials: "same-origin",
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await response.json(); } catch (error) { data = null; }
  if (!response.ok && response.status !== 404) {
    const error = new Error((data && data.error) || "qrh_edit_request_failed");
    error.status = response.status;
    throw error;
  }
  return { status: response.status, data: data || {} };
}

/* Whether this account may write QRH edits (owner / instructor / enterprise). */
export async function canEdit() {
  if (permission) return permission.canEdit;
  try {
    const result = await request("GET", null, null);
    permission = { canEdit: Boolean(result.data.canEdit) };
    adoptIndex(result.data);
    return permission.canEdit;
  } catch (error) {
    permission = { canEdit: false };
    return false;
  }
}

export async function listEdits() {
  const result = await request("GET", null, null);
  permission = { canEdit: Boolean(result.data.canEdit) };
  return adoptIndex(result.data);
}

/* Make sure the index has been fetched at least once this session. */
async function ensureIndex() {
  if (indexIds !== null || permission !== null) return;
  try {
    const result = await request("GET", null, null);
    permission = { canEdit: Boolean(result.data.canEdit) };
    adoptIndex(result.data);
  } catch (error) {
    /* Leave indexIds null: every lookup then asks per procedure, as before. */
  }
}

/* The saved draft for one procedure, or null when it has never been edited. */
export async function loadEdit(procedureId) {
  if (memory.has(procedureId)) return memory.get(procedureId);
  await ensureIndex();
  /* Provably unedited: no request, and no 404 in the console. */
  if (indexIds && !indexIds.has(procedureId)) {
    memory.set(procedureId, null);
    return null;
  }
  let draft = null;
  try {
    const result = await request("GET", procedureId, null);
    if (result.data.canEdit != null) permission = { canEdit: Boolean(result.data.canEdit) };
    draft = result.status === 404 ? null : (result.data.draft || null);
  } catch (error) {
    /* 401/403: the session or entitlement is gone. The published procedure is
       what the user sees; the stored draft is untouched on the server. */
    draft = null;
  }
  memory.set(procedureId, draft);
  return draft;
}

export async function saveEdit(procedureId, draft) {
  const result = await request("PUT", procedureId, { draft: draft });
  memory.set(procedureId, result.data.draft || null);
  if (indexIds) indexIds.add(procedureId);
  return result.data.draft || null;
}

export async function clearEdit(procedureId) {
  await request("DELETE", procedureId, null);
  memory.set(procedureId, null);
  if (indexIds) indexIds.delete(procedureId);
  return null;
}

/* Sign-out / entitlement lapse: drop the in-memory copies. */
export function resetQrhEditCache() { memory.clear(); permission = null; indexIds = null; }
