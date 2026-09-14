/*
  Storage for per-account manual QRH edits.

  An edit belongs to the account that made it and to nobody else. Nothing here is
  ever merged into the published Android content: `/api/content` keeps serving the
  authoritative packs, and the browser overlays the account's own draft on top.

  KV layout (namespace LICENSES, same binding as the licence and content data):
    qrhedit:<accountId>:index            { updatedAt, items: [{ procedureId, title, updatedAt }] }
    qrhedit:<accountId>:p:<procedureId>  the draft

  `accountId` is a SHA-256 of the licence key (or the owner email), so neither the
  key nor the address appears in a KV key name. Records are kept when an
  entitlement lapses — `authorizeWebRequest` simply stops answering, and they come
  back on renewal.
*/

import { hasEntitlement, QRH_MANUAL_EDIT } from "../_entitlements.js";

export const QRH_EDIT_PREFIX = "qrhedit:";
export const PROCEDURE_ID_PATTERN = /^[A-Za-z0-9 _\-./[\]()+&,'"]{1,180}$/;

export const LIMITS = {
  title: 200,
  trigger: 400,
  stepText: 600,
  note: 600,
  controlIds: 400,
  steps: 120,
  notes: 40,
  draftBytes: 96 * 1024,
  indexItems: 500
};

function str(v) { return v == null ? "" : String(v); }
function clip(v, max) { return str(v).trim().slice(0, max); }

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
}

/* Stable per-account id. Owner and subscriber namespaces never collide. */
export async function accountIdFor(auth) {
  const payload = (auth && auth.payload) || {};
  const seed = auth && auth.role === "owner"
    ? "owner:" + str(payload.email).trim().toLowerCase()
    : "license:" + str(payload.key).trim().toUpperCase();
  return (await sha256Hex(seed)).slice(0, 32);
}

/*
  Android AccessPolicy.canEditQrh: owner access, corporate OWNER, or the
  QRH_MANUAL_EDIT entitlement (Instructor and Enterprise tiers).
*/
export function canEditQrh(auth) {
  /* This compared the plan string here. It now asks the one tier table that
     both the web and Google Play read, so "who may edit a QRH" is answered in
     a single place instead of re-derived per endpoint - and a future plan
     called "instructorship" no longer matches "instructor". */
  return hasEntitlement(auth, QRH_MANUAL_EDIT);
}

export function normalizeProcedureId(raw) {
  const id = str(raw).trim();
  if (!id || id.length > 180) return null;
  if (!PROCEDURE_ID_PATTERN.test(id)) return null;
  if (id.indexOf("..") > -1) return null;
  return id;
}

/* KV keys must not carry raw procedure text. */
export async function procedureSlug(procedureId) {
  return (await sha256Hex(procedureId)).slice(0, 40);
}

const ITEM_KINDS = ["GENERIC", "CHECKLIST_CUE", "ITEM_POSITION", "MEMORY_ACTION", "SPOKEN_LINE", "PM_ACK"];

function sanitizeStep(raw) {
  if (!raw || typeof raw !== "object") return null;
  const step = {
    writtenStep: clip(raw.writtenStep, LIMITS.stepText),
    spokenWording: clip(raw.spokenWording, LIMITS.stepText),
    mccCrmNote: clip(raw.mccCrmNote, LIMITS.note),
    expectedControlIds: clip(raw.expectedControlIds, LIMITS.controlIds),
    requiresConfirmation: raw.requiresConfirmation !== false,
    roleTag: clip(raw.roleTag, 16).toUpperCase() || "PF",
    itemKind: ITEM_KINDS.indexOf(raw.itemKind) > -1 ? raw.itemKind : "GENERIC",
    targetControlId: clip(raw.targetControlId, 80).toUpperCase(),
    targetPosition: clip(raw.targetPosition, 80)
  };
  return (step.writtenStep || step.spokenWording) ? step : null;
}

/* Server-side shape enforcement — never trust the browser's draft. */
export function sanitizeDraft(raw) {
  if (!raw || typeof raw !== "object") return null;
  const lines = function (value) {
    return (Array.isArray(value) ? value : []).map(function (l) { return clip(l, LIMITS.stepText); }).filter(Boolean).slice(0, LIMITS.steps);
  };
  const steps = function (value) {
    return (Array.isArray(value) ? value : []).map(sanitizeStep).filter(Boolean).slice(0, LIMITS.steps);
  };
  const draft = {
    title: clip(raw.title, LIMITS.title),
    trigger: clip(raw.trigger, LIMITS.trigger),
    memoryItems: lines(raw.memoryItems),
    flowItems: lines(raw.flowItems),
    notes: (Array.isArray(raw.notes) ? raw.notes : []).map(function (n) { return clip(n, LIMITS.note); }).filter(Boolean).slice(0, LIMITS.notes),
    memoryStepDrafts: steps(raw.memoryStepDrafts),
    flowStepDrafts: steps(raw.flowStepDrafts)
  };
  if (!draft.title) return null;
  if (!draft.memoryStepDrafts.length && !draft.flowStepDrafts.length && !draft.memoryItems.length && !draft.flowItems.length) return null;
  if (JSON.stringify(draft).length > LIMITS.draftBytes) return null;
  return draft;
}

function kv(env) { return env && env.LICENSES ? env.LICENSES : null; }

async function readJson(env, key) {
  const store = kv(env);
  if (!store) return null;
  try {
    const raw = await store.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (error) { return null; }
}

export async function readIndex(env, accountId) {
  const index = await readJson(env, QRH_EDIT_PREFIX + accountId + ":index");
  return index && Array.isArray(index.items) ? index : { updatedAt: null, items: [] };
}

export async function readEdit(env, accountId, procedureId) {
  const slug = await procedureSlug(procedureId);
  return readJson(env, QRH_EDIT_PREFIX + accountId + ":p:" + slug);
}

export async function writeEdit(env, accountId, procedureId, draft) {
  const store = kv(env);
  if (!store) return null;
  const slug = await procedureSlug(procedureId);
  const now = new Date().toISOString();
  const record = { procedureId: procedureId, draft: draft, updatedAt: now, version: 1 };
  await store.put(QRH_EDIT_PREFIX + accountId + ":p:" + slug, JSON.stringify(record));

  const index = await readIndex(env, accountId);
  const items = index.items.filter(function (i) { return i.procedureId !== procedureId; });
  items.unshift({ procedureId: procedureId, title: draft.title, updatedAt: now });
  await store.put(QRH_EDIT_PREFIX + accountId + ":index", JSON.stringify({ updatedAt: now, items: items.slice(0, LIMITS.indexItems) }));
  return record;
}

export async function deleteEdit(env, accountId, procedureId) {
  const store = kv(env);
  if (!store) return false;
  const slug = await procedureSlug(procedureId);
  await store.delete(QRH_EDIT_PREFIX + accountId + ":p:" + slug);
  const index = await readIndex(env, accountId);
  const items = index.items.filter(function (i) { return i.procedureId !== procedureId; });
  await store.put(QRH_EDIT_PREFIX + accountId + ":index", JSON.stringify({ updatedAt: new Date().toISOString(), items: items }));
  return true;
}
