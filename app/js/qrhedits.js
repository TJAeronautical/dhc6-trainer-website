/*
  Client for the per-account QRH edit store (/api/qrh-edits).

  Edits live on the server, tied to the signed-in account and its entitlement:
  they follow the account to any device, and when a subscription lapses the API
  stops answering so the app falls back to the published procedure. Nothing is
  cached in the service worker — every request is `private, no-store`.
*/

const memory = new Map();
let permission = null;   // { canEdit } once /api/qrh-edits has answered

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
    return permission.canEdit;
  } catch (error) {
    permission = { canEdit: false };
    return false;
  }
}

export async function listEdits() {
  const result = await request("GET", null, null);
  permission = { canEdit: Boolean(result.data.canEdit) };
  return result.data.items || [];
}

/* The saved draft for one procedure, or null when it has never been edited. */
export async function loadEdit(procedureId) {
  if (memory.has(procedureId)) return memory.get(procedureId);
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
  return result.data.draft || null;
}

export async function clearEdit(procedureId) {
  await request("DELETE", procedureId, null);
  memory.set(procedureId, null);
  return null;
}

/* Sign-out / entitlement lapse: drop the in-memory copies. */
export function resetQrhEditCache() { memory.clear(); permission = null; }
