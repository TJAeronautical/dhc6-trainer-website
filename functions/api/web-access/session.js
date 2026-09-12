import { json, getLicense, isExpired, normalizeEmail, normalizeKey } from "../_shared.js";
import { createWebSession } from "./_session.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.LICENSES || !env.LICENSE_SIGNING_SECRET) {
    return json({ ok: false, error: "web_access_not_configured" }, 503);
  }

  let body = {};
  try {
    body = await request.json();
  } catch (error) {
    return json({ ok: false, error: "bad_json" }, 400);
  }

  const email = normalizeEmail(body.email);
  const licenseKey = normalizeKey(body.licenseKey);
  if (!email || !/^DHC6-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(licenseKey)) {
    return json({ ok: false, error: "invalid_credentials" }, 401);
  }

  const record = await getLicense(env, licenseKey);
  const active = record && record.status === "active" && !isExpired(record);
  if (!active || normalizeEmail(record.email) !== email) {
    return json({ ok: false, error: "invalid_credentials" }, 401);
  }

  const session = await createWebSession(env.LICENSE_SIGNING_SECRET, record);
  return json({ ok: true, token: session.token, expiresAt: session.expiresAt, plan: record.plan || "desktop" });
}
