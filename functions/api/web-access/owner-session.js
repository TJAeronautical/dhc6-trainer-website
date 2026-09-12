import { json, normalizeEmail } from "../_shared.js";
import { createOwnerWebSession } from "./_session.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  const allowedOwner = normalizeEmail(env.OWNER_ACCESS_EMAIL);
  if (!allowedOwner || !env.FIREBASE_WEB_API_KEY || !env.LICENSE_SIGNING_SECRET) {
    return json({ ok: false, error: "owner_access_not_configured" }, 503);
  }
  let body = {};
  try { body = await request.json(); } catch (error) {
    return json({ ok: false, error: "bad_json" }, 400);
  }
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  if (email !== allowedOwner || !password) return json({ ok: false, error: "invalid_credentials" }, 401);
  const response = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + encodeURIComponent(env.FIREBASE_WEB_API_KEY), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email, password: password, returnSecureToken: true })
  });
  let identity = {};
  try { identity = await response.json(); } catch (error) { identity = {}; }
  if (!response.ok || normalizeEmail(identity.email) !== allowedOwner || !identity.idToken) {
    return json({ ok: false, error: "invalid_credentials" }, 401);
  }
  const session = await createOwnerWebSession(env.LICENSE_SIGNING_SECRET, allowedOwner);
  return json({ ok: true, token: session.token, expiresAt: session.expiresAt, plan: "owner" });
}
