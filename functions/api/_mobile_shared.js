import { json } from "./_shared.js";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FIREBASE_LOOKUP_URL = "https://identitytoolkit.googleapis.com/v1/accounts:lookup";
const FIREBASE_APP_CHECK_JWKS_URL = "https://firebaseappcheck.googleapis.com/v1/jwks";
const ANDROID_PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const DATASTORE_SCOPE = "https://www.googleapis.com/auth/datastore";

let cachedGoogleToken = null;
let cachedAppCheckJwks = null;

export const GOOGLE_API_SCOPES = ANDROID_PUBLISHER_SCOPE + " " + DATASTORE_SCOPE;

export async function readJson(request) {
  try {
    return await request.json();
  } catch (e) {
    return null;
  }
}

export function bearerToken(request) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

export async function verifyFirebaseUser(context) {
  const { request, env } = context;
  const token = bearerToken(request);

  if (!token) {
    return { ok: false, response: json({ ok: false, error: "firebase_token_missing" }, 401) };
  }
  if (!env.FIREBASE_WEB_API_KEY) {
    return { ok: false, response: json({ ok: false, error: "firebase_web_api_key_missing" }, 500) };
  }

  const response = await fetch(FIREBASE_LOOKUP_URL + "?key=" + encodeURIComponent(env.FIREBASE_WEB_API_KEY), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: token })
  });

  let data = {};
  try {
    data = await response.json();
  } catch (e) {
    data = {};
  }

  if (!response.ok || !Array.isArray(data.users) || !data.users[0] || !data.users[0].localId) {
    return { ok: false, response: json({ ok: false, error: "firebase_token_invalid" }, 401) };
  }

  return { ok: true, uid: String(data.users[0].localId), user: data.users[0] };
}

function base64UrlDecode(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJwtJson(segment) {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(segment)));
}

async function firebaseAppCheckJwks() {
  if (cachedAppCheckJwks && cachedAppCheckJwks.expiresAtMillis > Date.now()) {
    return cachedAppCheckJwks.keys;
  }

  const response = await fetch(FIREBASE_APP_CHECK_JWKS_URL, {
    headers: { "Accept": "application/json" }
  });
  if (!response.ok) throw new Error("app_check_jwks_unavailable");

  const data = await response.json();
  if (!data || !Array.isArray(data.keys) || data.keys.length === 0) {
    throw new Error("app_check_jwks_invalid");
  }

  const cacheControl = response.headers.get("Cache-Control") || "";
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSeconds = maxAgeMatch ? Number(maxAgeMatch[1]) : 21600;
  cachedAppCheckJwks = {
    keys: data.keys,
    expiresAtMillis: Date.now() + Math.max(300, Math.min(maxAgeSeconds, 21600)) * 1000
  };
  return data.keys;
}

export async function verifyFirebaseAppCheck(context) {
  const { request, env } = context;
  const token = String(request.headers.get("X-Firebase-AppCheck") || "").trim();
  const projectNumber = String(env.FIREBASE_PROJECT_NUMBER || "").trim();

  if (!token) {
    return { ok: false, response: json({ ok: false, error: "app_check_token_missing" }, 401) };
  }
  if (!/^\d+$/.test(projectNumber)) {
    return { ok: false, response: json({ ok: false, error: "firebase_project_number_missing" }, 503) };
  }

  try {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("invalid_token_shape");
    const header = decodeJwtJson(parts[0]);
    const claims = decodeJwtJson(parts[1]);
    if (header.alg !== "RS256" || header.typ !== "JWT" || !header.kid) {
      throw new Error("invalid_token_header");
    }

    const keys = await firebaseAppCheckJwks();
    const jwk = keys.find(function (candidate) { return candidate.kid === header.kid; });
    if (!jwk) throw new Error("signing_key_not_found");
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const signatureValid = await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      base64UrlDecode(parts[2]),
      new TextEncoder().encode(parts[0] + "." + parts[1])
    );
    if (!signatureValid) throw new Error("signature_invalid");

    const nowSeconds = Math.floor(Date.now() / 1000);
    const expectedIssuer = "https://firebaseappcheck.googleapis.com/" + projectNumber;
    const expectedAudience = "projects/" + projectNumber;
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== expectedIssuer) throw new Error("issuer_invalid");
    if (!audiences.includes(expectedAudience)) throw new Error("audience_invalid");
    if (!Number.isFinite(Number(claims.exp)) || Number(claims.exp) <= nowSeconds) {
      throw new Error("token_expired");
    }
    if (Number.isFinite(Number(claims.iat)) && Number(claims.iat) > nowSeconds + 300) {
      throw new Error("issued_at_invalid");
    }
    if (!claims.sub || typeof claims.sub !== "string") throw new Error("subject_invalid");
    if (env.FIREBASE_ANDROID_APP_ID && claims.sub !== String(env.FIREBASE_ANDROID_APP_ID)) {
      throw new Error("app_id_invalid");
    }

    return { ok: true, appId: claims.sub, claims: claims };
  } catch (e) {
    return { ok: false, response: json({ ok: false, error: "app_check_token_invalid" }, 401) };
  }
}

function base64UrlEncode(input) {
  let binary = "";
  const bytes = input instanceof Uint8Array ? input : new TextEncoder().encode(String(input));
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToArrayBuffer(pem) {
  const normalized = String(pem || "")
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function importServiceAccountKey(privateKeyPem) {
  return crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function signServiceAccountJwt(env, scope) {
  const email = String(env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL || "").trim();
  const privateKey = String(env.GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY || "").trim();
  if (!email || !privateKey) {
    throw new Error("google_service_account_missing");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64UrlEncode(JSON.stringify({
    iss: email,
    scope: scope,
    aud: GOOGLE_TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + 3300
  }));
  const unsigned = header + "." + payload;
  const key = await importServiceAccountKey(privateKey);
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(unsigned)
  );
  return unsigned + "." + base64UrlEncode(new Uint8Array(signature));
}

export async function googleAccessToken(env, scope) {
  const cacheKey = String(env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL || "") + "|" + scope;
  if (
    cachedGoogleToken &&
    cachedGoogleToken.cacheKey === cacheKey &&
    cachedGoogleToken.expiresAtMillis > Date.now() + 60000
  ) {
    return cachedGoogleToken.token;
  }

  const assertion = await signServiceAccountJwt(env, scope);
  const body = new URLSearchParams();
  body.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
  body.set("assertion", assertion);

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });

  let data = {};
  try {
    data = await response.json();
  } catch (e) {
    data = {};
  }
  if (!response.ok || !data.access_token) {
    throw new Error("google_access_token_failed");
  }

  cachedGoogleToken = {
    cacheKey: cacheKey,
    token: data.access_token,
    expiresAtMillis: Date.now() + Math.max(60, Number(data.expires_in || 3000) - 60) * 1000
  };
  return cachedGoogleToken.token;
}

export async function googleJson(env, url, init, scope) {
  const token = await googleAccessToken(env, scope);
  const response = await fetch(url, {
    method: (init && init.method) || "GET",
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: init && init.body ? JSON.stringify(init.body) : undefined
  });

  let data = {};
  try {
    data = await response.json();
  } catch (e) {
    data = {};
  }
  return { ok: response.ok, status: response.status, data: data };
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map(function (byte) { return byte.toString(16).padStart(2, "0"); })
    .join("");
}

export function firestoreString(value) {
  return { stringValue: String(value || "") };
}

export function firestoreInteger(value) {
  return { integerValue: String(Math.trunc(Number(value || 0))) };
}

export function firestoreArray(strings) {
  const values = Array.from(new Set((strings || []).map(function (item) {
    return String(item || "").trim();
  }).filter(Boolean))).map(function (item) {
    return firestoreString(item);
  });
  return values.length ? { arrayValue: { values: values } } : { arrayValue: {} };
}

export function firestoreMap(fields) {
  return { mapValue: { fields: fields || {} } };
}

export function parseFirestoreArray(field) {
  return ((field && field.arrayValue && field.arrayValue.values) || [])
    .map(function (item) { return item.stringValue || ""; })
    .filter(Boolean);
}

export function parseFirestoreString(field) {
  return field && field.stringValue ? field.stringValue : "";
}
