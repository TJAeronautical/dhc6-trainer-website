/*
  POST /api/web-access/request-link
  Body: { "email": "buyer@example.com" }

  One-time email sign-in for subscribers who do not have their licence key to
  hand. If (and only if) the email maps to an active licence, Firebase
  Authentication sends an email-link (passwordless) message to that address.
  The response is identical whether or not a licence exists, so this endpoint
  cannot be used to enumerate customers.

  Firebase console prerequisites (cannot be automated from this repo):
    Authentication -> Sign-in method -> Email/Password -> "Email link
    (passwordless sign-in)" enabled, and dhc6trainer.com listed under
    Authentication -> Settings -> Authorized domains.
*/

import { json, normalizeEmail, getLicenseByEmail, isExpired } from "../_shared.js";
import { rateLimitAllows, sameOriginRequest } from "./_session.js";
import { recoverLicenseFromPaddle } from "../billing/status.js";

const SEND_OOB_URL = "https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode";
const TRUSTED_ORIGINS = new Set(["https://dhc6trainer.com", "https://www.dhc6trainer.com"]);

/*
  Completing an email link needs two things: the code from the URL, and the
  address it was issued for. Firebase puts only the code in the link, so the
  address has to come from somewhere - and the original design took it from
  localStorage on the device that asked for the link.

  That is the wrong device. Sign-in links are read on a phone; the request is
  made on a desktop. The phone's localStorage is empty, so the page fell back
  to window.prompt() - which several in-app browsers, Gmail's among them,
  suppress without raising anything. The link then failed silently on the one
  device most people open it from.

  Instead the server remembers the address itself, under a random handle it
  puts in the continue URL. The handle authenticates nothing: it names an
  address, and the Firebase code is still what proves the reader controls it.
  No endpoint turns a handle back into an address, so it cannot be used to
  read a subscriber's email either.
*/
const INTENT_PREFIX = "linkintent:";
const INTENT_TTL_SECONDS = 30 * 60;

function newIntentId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

export async function resolveLinkIntent(env, id) {
  const handle = String(id || "").trim();
  if (!env || !env.LICENSES || !/^[0-9a-f]{32}$/.test(handle)) return "";
  return normalizeEmail(await env.LICENSES.get(INTENT_PREFIX + handle));
}

function continueUrlFor(request, intentId) {
  const origin = new URL(request.url).origin;
  const base = TRUSTED_ORIGINS.has(origin) ? origin : "https://dhc6trainer.com";
  return base + "/web-app.html?mode=link" + (intentId ? "&t=" + encodeURIComponent(intentId) : "");
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.LICENSES || !env.FIREBASE_WEB_API_KEY || !env.LICENSE_SIGNING_SECRET) {
    return json({ ok: false, error: "email_link_not_configured" }, 503);
  }
  if (!sameOriginRequest(request)) return json({ ok: false, error: "cross_site_request" }, 403);
  if (!(await rateLimitAllows(context, "request-link", 5, 15 * 60))) {
    return json({ ok: false, error: "rate_limited" }, 429);
  }

  let body = {};
  try { body = await request.json(); } catch (error) {
    return json({ ok: false, error: "bad_json" }, 400);
  }
  const email = normalizeEmail(body.email);
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: "invalid_email" }, 400);
  }

  let record = await getLicenseByEmail(env, email);
  if (!record) record = await recoverLicenseFromPaddle(context, email);
  const active = record && record.status === "active" && !isExpired(record) && normalizeEmail(record.email) === email;

  if (active) {
    const perEmailKey = "ratelimit:request-link-email:" + email;
    const sent = Number((await env.LICENSES.get(perEmailKey)) || 0);
    if (sent < 3) {
      /* Minted before the send and never returned to the caller, so the
         response stays byte-identical whether or not a licence exists. An
         unused handle simply expires. */
      const intentId = newIntentId();
      await env.LICENSES.put(INTENT_PREFIX + intentId, email, { expirationTtl: INTENT_TTL_SECONDS });

      const response = await fetch(SEND_OOB_URL + "?key=" + encodeURIComponent(env.FIREBASE_WEB_API_KEY), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestType: "EMAIL_SIGNIN",
          email: email,
          continueUrl: continueUrlFor(request, intentId),
          canHandleCodeInApp: true
        })
      });
      if (!response.ok) {
        /*
          A send failure must NOT change the response. This branch is reachable
          only when the email belongs to an active subscriber, so returning a
          distinct error here inverts the whole point of the endpoint: the
          generic "if an active subscription exists" message would mean "not a
          customer" and an error would mean "customer". One Firebase outage, or
          a single bounced address, would turn this into a subscriber oracle.

          The operator signal is kept where it cannot leak: the console, which
          reaches the Workers log. The globally-unconfigured case is still
          reported to the caller at the top of this handler, before any email is
          looked up, so that diagnostic costs nothing.
        */
        let data = {};
        try { data = await response.json(); } catch (error) { data = {}; }
        const message = String((data.error && data.error.message) || "");
        console.warn("request-link: Firebase sendOobCode failed (" + response.status + "): " + (message || "no message"));
      } else {
        await env.LICENSES.put(perEmailKey, String(sent + 1), { expirationTtl: 60 * 60 });
      }
    }
  }

  return json({ ok: true, message: "If an active subscription is linked to that email, a sign-in link has been sent." });
}
