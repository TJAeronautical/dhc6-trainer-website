/*
  POST /api/license/validate
  Body: { "licenseKey": "DHC6-....", "email": "optional" }
  Returns whether the licence is currently active.

  Used by the website gate (desktop-license-gate.js) and by the desktop app
  on launch / periodic re-check.
*/

import { json, normalizeKey } from "../_shared.js";

function isExpired(record) {
  if (!record.expiresAt) return false;
  return new Date(record.expiresAt).getTime() < Date.now();
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.LICENSES) {
    return json({ valid: false, error: "kv_not_bound" }, 500);
  }

  let body = {};
  try {
    body = await request.json();
  } catch (e) {
    return json({ valid: false, error: "bad_json" }, 400);
  }

  const key = normalizeKey(body.licenseKey);
  if (!/^DHC6-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key)) {
    return json({ valid: false, status: "invalid_format" }, 200);
  }

  const raw = await env.LICENSES.get("license:" + key);
  if (!raw) {
    return json({ valid: false, status: "not_found" }, 200);
  }

  const record = JSON.parse(raw);
  let status = record.status;
  if (status === "active" && isExpired(record)) {
    status = "expired";
  }

  return json({
    valid: status === "active",
    status: status,
    plan: record.plan || "desktop",
    expiresAt: record.expiresAt || null
  });
}
