/*
  POST /api/license/deactivate
  Body: { "licenseKey": "DHC6-....", "email": "buyer@example.com", "deviceId": "stable-machine-id" }

  Removes one activation from a licence so a subscriber can free a seat.
*/

import {
  json,
  normalizeKey,
  normalizeEmail,
  getLicense,
  writeLicense,
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
  const deviceId = String(body.deviceId || "").trim();

  if (!deviceId) {
    return json({ ok: false, error: "missing_device_id" }, 400);
  }

  const record = await getLicense(env, key);
  if (!record) {
    return json({ ok: false, status: "not_found" }, 200);
  }
  if (record.email && email && normalizeEmail(record.email) !== email) {
    return json({ ok: false, status: "email_mismatch" }, 200);
  }

  record.activations = Array.isArray(record.activations) ? record.activations : [];
  const before = record.activations.length;
  record.activations = record.activations.filter(function (item) {
    return item.deviceId !== deviceId;
  });

  if (record.activations.length === before) {
    return json({ ok: false, status: "device_not_found", license: publicLicense(record) }, 200);
  }

  await writeLicense(env, record);
  return json({ ok: true, status: "deactivated", license: publicLicense(record) });
}
