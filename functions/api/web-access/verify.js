import { json, getLicense, isExpired, normalizeEmail } from "../_shared.js";
import { verifyWebSession } from "./_session.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const payload = await verifyWebSession(env.LICENSE_SIGNING_SECRET, token);
  if (!payload) return json({ ok: false, error: "session_invalid" }, 401);

  const record = await getLicense(env, payload.key);
  const active = record && record.status === "active" && !isExpired(record);
  if (!active || normalizeEmail(record.email) !== normalizeEmail(payload.email)) {
    return json({ ok: false, error: "subscription_inactive" }, 403);
  }

  return json({ ok: true, plan: record.plan || "desktop", expiresAt: new Date(payload.exp * 1000).toISOString() });
}
