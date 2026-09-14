/*
  Mobile (Android) authorisation for the protected endpoints.

  The browser app signs in through /api/web-access and carries a session token
  signed with LICENSE_SIGNING_SECRET. The Android app has no such session: it is
  signed in to Firebase, and its purchases are validated through Google Play
  (functions/api/play/validate-purchase.js), which writes the resulting tier and
  entitlement list to Firestore at users/<uid>/entitlements/current.

  This module turns that into the SAME auth shape authorizeWebRequest returns,
  so an endpoint can accept either client without branching on the client.

  It is deliberately a separate file rather than a change inside
  web-access/_session.js: nothing here can mint, read or weaken a web session
  token, and a bug in the mobile path cannot widen browser access.

  ---------------------------------------------------------------------------
  THE RULE THIS FILE EXISTS TO ENFORCE

  A Firebase account is not a purchase.

  FIREBASE_WEB_API_KEY is public by design - it ships inside the APK, and
  anybody can read it out. With it, anybody can call Firebase's own signUp
  endpoint and hold a valid ID token for this project within seconds. So
  "the caller presented a valid Firebase token" establishes only that somebody
  signed up. It is authentication, and this file must not mistake it for
  authorization.

  Every caller therefore names the entitlement it needs, and the answer comes
  from the list Google Play validation wrote - never from a tier, never from a
  plan string, and never from the mere existence of the account. A caller that
  names no entitlement gets nothing: forgetting the argument must fail closed.

  Why not a tier: tierForPlan() resolves an unrecognised plan to PRO on purpose,
  so a typo in a Paddle plan name can never cost a paying web subscriber their
  training content. That is the right default for a licence that has already
  passed the status allowlist, and precisely the wrong one for a caller whose
  plan string is literally "free". The entitlement list is read directly.
*/

import { verifyFirebaseUser, readCurrentEntitlements } from "./_mobile_shared.js";
import { lowestTierWith, tierLabel } from "./_entitlements.js";

export function hasMobileBearer(request) {
  const header = (request && request.headers && request.headers.get("Authorization")) || "";
  return /^Bearer\s+\S/i.test(header);
}

/*
  authorizeMobileRequest(context, entitlement)

  Returns the shape authorizeWebRequest returns, plus `client: "android"`:
    { ok, status?, error?, role, client, uid, tier, plan, record, entitlements }

  or a refusal. `entitlement` is required - see the rule above.
*/
export async function authorizeMobileRequest(context, entitlement) {
  const env = context && context.env;

  /* Both are needed: the API key verifies the token, the project id addresses
     the Firestore document holding what Play granted. Missing either means the
     entitlement cannot be read, which is a 503 and never a way through. */
  if (!env || !env.FIREBASE_WEB_API_KEY || !env.FIREBASE_PROJECT_ID) {
    return { ok: false, status: 503, error: "mobile_access_not_configured" };
  }

  /* Fail closed on a caller that forgot to say what it needs. */
  if (!entitlement) {
    return { ok: false, status: 403, error: "entitlement_required", entitlement: null, requiredTier: null };
  }

  const verified = await verifyFirebaseUser(context);
  if (!verified.ok) {
    return { ok: false, status: 401, error: "firebase_token_invalid" };
  }

  /* A disabled account still holds an unexpired token until it lapses. */
  if (verified.user && verified.user.disabled === true) {
    return { ok: false, status: 403, error: "firebase_account_disabled" };
  }

  let current;
  try {
    current = await readCurrentEntitlements(env, verified.uid);
  } catch (error) {
    /*
      Reading what Play granted needs a Google service account, and it throws
      when one is not configured. That must not become a 500 - and it must
      certainly not become a way through. An entitlement that cannot be read is
      an entitlement the caller does not have, because the alternative is that
      one missing binding silently reopens the library to every Firebase
      account in the project.
    */
    console.warn("mobile-session: could not read Play entitlements (" + String(error && error.message) + ")");
    return { ok: false, status: 503, error: "entitlement_check_unavailable" };
  }

  const granted = Array.isArray(current && current.entitlements) ? current.entitlements : [];
  if (granted.indexOf(entitlement) < 0) {
    const needed = lowestTierWith(entitlement);
    return {
      ok: false,
      status: 403,
      error: "entitlement_required",
      entitlement: entitlement,
      requiredTier: needed,
      message: needed ? "That is part of the " + tierLabel(needed) + " plan." : undefined
    };
  }

  const tier = String((current && current.tier) || "FREE").toUpperCase();

  return {
    ok: true,
    role: "subscriber",
    client: "android",
    uid: verified.uid,
    tier: tier,
    plan: tier.toLowerCase(),
    /* The caller holds the entitlement it asked for, so it is not a trial in
       the sense `paidUp` means in media/index.js. The bulk offline download is
       refused to Android by an explicit scope guard there, not by this flag -
       a gate you can read is worth more than one you infer. */
    record: { trial: false },
    /* Authoritative: what Play actually wrote, not what a tier implies. */
    entitlements: granted,
    ownedPackIds: (current && current.ownedPackIds) || [],
    entitledUntil: null
  };
}
