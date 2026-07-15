/*
  POST /api/billing/status
  Body: { "licenseKey": "DHC6-....", "email": "buyer@example.com" }

  Returns the subscription and activation state for the account page.
*/

import {
  json,
  normalizeKey,
  normalizeEmail,
  getLicense,
  getLicenseByEmail,
  publicLicense
} from "../_shared.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.LICENSES) {
    return json({ ok: false, error: "kv_not_bound" }, 500);
  }

  let body = {};
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: "bad_json" }, 400);
  }

  const key = normalizeKey(body.licenseKey);
  const email = normalizeEmail(body.email);

  let record = key ? await getLicense(env, key) : null;
  if (!record && email) {
    record = await getLicenseByEmail(env, email);
  }

  if (!record) {
    return json({ ok: false, status: "not_found" }, 200);
  }

  if (email && record.email && normalizeEmail(record.email) !== email) {
    return json({ ok: false, status: "email_mismatch" }, 200);
  }

  return json({ ok: true, license: publicLicense(record) });
}
