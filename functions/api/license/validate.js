/*
  POST /api/license/validate
  Body: { "licenseKey": "DHC6-....", "email": "optional" }
  Returns whether the licence is currently active.

  Used by the website gate (desktop-license-gate.js) and by the desktop app
  on launch / periodic re-check.
*/

import { json, normalizeKey, normalizeEmail, isExpired, getLicense, publicLicense } from "../_shared.js";

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

  const record = await getLicense(env, key);
  if (!record) {
    return json({ valid: false, status: "not_found" }, 200);
  }

  let status = record.status;
  if (status === "active" && isExpired(record)) {
    status = "expired";
  }

  const requestedEmail = normalizeEmail(body.email);
  if (requestedEmail && record.email && normalizeEmail(record.email) !== requestedEmail) {
    return json({ valid: false, status: "email_mismatch" }, 200);
  }

  return json({
    valid: status === "active",
    status: status,
    plan: record.plan || "desktop",
    expiresAt: record.expiresAt || null,
    license: publicLicense(record)
  });
}
