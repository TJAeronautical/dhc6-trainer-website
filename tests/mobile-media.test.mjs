/*
  The Android client reading the protected media store.

  The hole this file exists to keep shut: FIREBASE_WEB_API_KEY ships inside the
  APK and is public by design, so "holds a valid Firebase ID token for this
  project" is something anybody can arrange in about thirty seconds through
  Firebase's own signUp endpoint. If that alone opened /api/media, the entire
  184 MB replica library - the 75 MB PT6A-27 among it - would be free to take.

  So every test here is really one question asked eight ways: does the server
  ask what Google Play actually granted, or does it settle for the token?
*/

import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet as media } from "../functions/api/media/index.js";
import { onRequestPost as ownerWatermark } from "../functions/api/owner/watermark.js";
import { MEDIA_KV_PREFIX } from "../functions/api/media/_store.js";
import { createWebSession, createOwnerWebSession, SESSION_COOKIE } from "../functions/api/web-access/_session.js";
import { authorizeMobileRequest, hasMobileBearer } from "../functions/api/_mobile_session.js";
import { entitlementsFor, tierFor, hasEntitlement, FREE, PRO, SYSTEMS_LAB_3D } from "../functions/api/_entitlements.js";
import { seedForFirebaseUid, watermarkFromSeed, stampModel } from "../functions/api/_watermark.js";
import { activeLicense, envWithLicense, memoryKv, mockFetch, jsonResponse, jsonRequest, TEST_SERVICE_ACCOUNT_KEY } from "./helpers.mjs";

const ORIGIN = "https://dhc6trainer.com";
const MODEL = "models/systems-lab/PT6A27_ENGINE_REPLICA.glb";
const POSTER = "systems/posters/fuel.png";

/* A minimal valid-looking GLB: the stamper only needs the 12-byte header. */
function glb(size) {
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, size, true);
  for (let i = 12; i < size; i++) bytes[i] = i & 0xff;
  return bytes;
}

function mediaEnv(extra) {
  const env = envWithLicense(activeLicense(), {
    FIREBASE_PROJECT_ID: "dhc6-test",
    GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL: "svc@dhc6-test.iam.gserviceaccount.com",
    GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY: TEST_SERVICE_ACCOUNT_KEY
  });
  env.WEB_CONTENT = memoryKv({
    [MEDIA_KV_PREFIX + "blob:" + MODEL]: glb(256),
    [MEDIA_KV_PREFIX + "blob:" + POSTER]: new Uint8Array([1, 2, 3, 4]),
    [MEDIA_KV_PREFIX + "index"]: JSON.stringify({ version: "test", items: [{ path: MODEL, bytes: 256 }] })
  });
  return Object.assign(env, extra || {});
}

/* Google OAuth + Firebase lookup + Firestore doubles. `granted` is what Play
   validation previously wrote for this Firebase user. */
function play(granted, options) {
  const opts = options || {};
  return async function (url) {
    if (/oauth2\.googleapis\.com/.test(url)) return jsonResponse({ access_token: "token", expires_in: 3600 });
    if (/identitytoolkit.*accounts:lookup/.test(url)) {
      if (opts.tokenInvalid) return jsonResponse({ error: { message: "INVALID_ID_TOKEN" } }, 400);
      return jsonResponse({ users: [{ localId: opts.uid || "uid-android-1", email: "pilot@example.com", disabled: opts.disabled === true }] });
    }
    if (/firestore\.googleapis\.com/.test(url)) {
      if (opts.firestoreDown) return jsonResponse({}, 500);
      return jsonResponse({ fields: {
        tier: { stringValue: opts.tier || "PRO" },
        entitlements: { arrayValue: { values: (granted || []).map(function (e) { return { stringValue: e }; }) } }
      } });
    }
    return jsonResponse({}, 404);
  };
}

async function callMedia(env, path, headers, handler) {
  const mock = handler ? mockFetch(handler) : null;
  try {
    return await media({
      request: new Request(ORIGIN + "/api/media/" + path, { method: "GET", headers: headers || {} }),
      env: env
    });
  } finally {
    if (mock) mock.restore();
  }
}

const BEARER = { Authorization: "Bearer firebase-id-token" };

async function subscriberCookie() {
  const session = await createWebSession("test-signing-secret", activeLicense());
  return { Cookie: SESSION_COOKIE + "=" + session.token };
}

/* ------------------------------------------------- the token is not a purchase */

test("a Firebase account with nothing bought cannot take a single model", async () => {
  /*
    The exact shape of the defect: sign up with the public API key, present the
    token, receive 75 MB. FREE_ENTITLEMENTS does not contain SYSTEMS_LAB_3D and
    this is where that has to be enforced.
  */
  const response = await callMedia(mediaEnv(), MODEL, BEARER, play(["BASIC_STUDY", "FLASHCARD_SELF_ENTRY"], { tier: "FREE" }));
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error, "entitlement_required");
});

test("an Android account with no Firestore record at all is refused", async () => {
  const response = await callMedia(mediaEnv(), MODEL, BEARER, async function (url) {
    if (/oauth2\.googleapis\.com/.test(url)) return jsonResponse({ access_token: "t", expires_in: 3600 });
    if (/identitytoolkit/.test(url)) return jsonResponse({ users: [{ localId: "uid-new" }] });
    if (/firestore/.test(url)) return jsonResponse({}, 404);
    return jsonResponse({}, 404);
  });
  assert.equal(response.status, 403);
});

test("an Android subscriber who bought the Lab gets the model, stamped", async () => {
  const response = await callMedia(mediaEnv(), MODEL, BEARER, play(["BASIC_STUDY", SYSTEMS_LAB_3D]));
  assert.equal(response.status, 200);
  const body = new Uint8Array(await response.arrayBuffer());
  assert.ok(body.byteLength > 256, "the stamp is appended after the source bytes");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});

test("an invalid or expired Firebase token is refused before Firestore is asked", async () => {
  const seen = [];
  const response = await callMedia(mediaEnv(), MODEL, BEARER, async function (url) {
    seen.push(url);
    if (/oauth2\.googleapis\.com/.test(url)) return jsonResponse({ access_token: "t", expires_in: 3600 });
    if (/identitytoolkit/.test(url)) return jsonResponse({ error: { message: "INVALID_ID_TOKEN" } }, 400);
    return jsonResponse({}, 404);
  });
  assert.equal(response.status, 401);
  assert.equal(seen.some((u) => /firestore/.test(u)), false, "a bad token must not cost a Firestore read");
});

test("a disabled Firebase account still holding a live token is refused", async () => {
  const response = await callMedia(mediaEnv(), MODEL, BEARER, play([SYSTEMS_LAB_3D], { disabled: true }));
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error, "firebase_account_disabled");
});

test("an entitlement that cannot be read is refused, never waved through", async () => {
  /* No service account configured: readCurrentEntitlements throws. A
     misconfiguration must not silently reopen the library. */
  const env = mediaEnv();
  /* Both, deliberately: googleAccessToken caches by service-account email, so
     removing only the key can be answered from a token another test warmed. */
  delete env.GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY;
  delete env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL;
  const response = await callMedia(env, MODEL, BEARER, play([SYSTEMS_LAB_3D]));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error, "entitlement_check_unavailable");
});

test("without FIREBASE_PROJECT_ID the mobile door is closed, not open", async () => {
  const env = mediaEnv();
  delete env.FIREBASE_PROJECT_ID;
  const response = await callMedia(env, MODEL, BEARER, play([SYSTEMS_LAB_3D]));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "mobile_access_not_configured");
});

test("a caller that names no entitlement gets nothing", async () => {
  /* Fail closed on the argument being forgotten, rather than on remembering. */
  const result = await authorizeMobileRequest({ env: mediaEnv(), request: new Request(ORIGIN, { headers: BEARER }) });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
});

/* --------------------------------------------------------------- the scope */

test("an Android session reads the Systems Lab models and nothing else", async () => {
  const env = mediaEnv();
  const handler = play([SYSTEMS_LAB_3D]);

  const poster = await callMedia(env, POSTER, BEARER, handler);
  assert.equal(poster.status, 403);
  assert.equal((await poster.json()).error, "android_media_scope");

  const index = await callMedia(env, "index", BEARER, handler);
  assert.equal(index.status, 403, "the index lists the whole library");

  const manifest = await callMedia(env, "offline-manifest", BEARER, handler);
  assert.equal(manifest.status, 403, "the offline manifest is the whole library in one response");
});

test("the scope is measured on the normalised path, not the one sent", async () => {
  const env = mediaEnv();
  const handler = play([SYSTEMS_LAB_3D]);
  for (const attempt of [
    "models%2Fsystems-lab%2F..%2F..%2Fsystems%2Fposters%2Ffuel.png",
    "models/systems-lab/../../systems/posters/fuel.png",
    "systems/posters/fuel.png"
  ]) {
    const response = await callMedia(env, attempt, BEARER, handler);
    assert.ok(response.status === 400 || response.status === 403, attempt + " answered " + response.status);
    assert.notEqual(response.status, 200);
  }
});

/* ------------------------------------------------- the browser is unchanged */

test("a browser request never goes near the mobile path", async () => {
  const calls = [];
  const response = await callMedia(mediaEnv(), POSTER, await subscriberCookie(), async function (url) {
    calls.push(url);
    return jsonResponse({}, 404);
  });
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [], "no Firebase or Firestore call is made for a cookie-bearing browser");
});

test("an anonymous request is refused exactly as it was", async () => {
  const response = await callMedia(mediaEnv(), MODEL, {});
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "session_invalid");
});

test("a lapsed subscriber cannot get back in by attaching a Firebase token", async () => {
  /*
    The trap in accepting two proofs: try the second door whenever the first
    says no, and every refusal becomes an invitation.

    It is subtler than it looks. tokenFromRequest prefers the Authorization
    header over the cookie, so a request carrying both has its cookie ignored -
    the Firebase JWT is read as a web session token, fails to verify, and the
    web layer reports "session_invalid". Taken at face value that reads as "no
    session was presented", which is exactly the case that IS allowed to fall
    through. The cookie has to be given its own hearing first.
  */
  const env = mediaEnv();
  env.LICENSES = memoryKv({
    "license:DHC6-ABCD-EFGH-JKLM": JSON.stringify(activeLicense({ status: "cancelled" }))
  });
  const headers = Object.assign({}, BEARER, await subscriberCookie());
  const calls = [];
  const response = await callMedia(env, MODEL, headers, async function (url) {
    calls.push(url);
    return jsonResponse({}, 404);
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "subscription_inactive", "reported as lapsed, not as anonymous");
  assert.equal(calls.length, 0, "the mobile path was not tried for a rejected session");
});

test("a signed-in browser that also sends a Firebase token is still a browser", async () => {
  /* The same defect in the other direction: a valid cookie must not be
     discarded because a bearer happened to be attached, or a paying subscriber
     would be scoped down to the Systems Lab models. */
  const headers = Object.assign({}, BEARER, await subscriberCookie());
  const response = await callMedia(mediaEnv(), POSTER, headers, play([SYSTEMS_LAB_3D]));
  assert.equal(response.status, 200, "the poster is browser-scope content and the browser is signed in");
});

test("hasMobileBearer needs an actual token, not the word Bearer", () => {
  const of = (value) => new Request(ORIGIN, { headers: value ? { Authorization: value } : {} });
  assert.equal(hasMobileBearer(of("Bearer abc")), true);
  assert.equal(hasMobileBearer(of("bearer abc")), true);
  assert.equal(hasMobileBearer(of("Bearer ")), false);
  assert.equal(hasMobileBearer(of("Bearer")), false);
  assert.equal(hasMobileBearer(of("")), false);
  assert.equal(hasMobileBearer(of(null)), false);
});

/* ------------------------------------------- the tier layer tells the truth */

test("an Android FREE account does not read as PRO", () => {
  /*
    tierForPlan() resolves anything unrecognised to PRO on purpose, so a typo
    in a Paddle plan name never costs a paying web subscriber their content.
    An Android free account's plan string is the word "free" - which that rule
    would read as PRO. The entitlement list is authoritative instead.
  */
  const free = { ok: true, role: "subscriber", client: "android", tier: "FREE", plan: "free", entitlements: ["BASIC_STUDY"] };
  assert.equal(tierFor(free), FREE);
  assert.deepEqual(entitlementsFor(free), ["BASIC_STUDY"]);
  assert.equal(hasEntitlement(free, SYSTEMS_LAB_3D), false);

  const pro = { ok: true, role: "subscriber", client: "android", tier: "PRO", plan: "pro", entitlements: ["BASIC_STUDY", SYSTEMS_LAB_3D] };
  assert.equal(tierFor(pro), PRO);
  assert.equal(hasEntitlement(pro, SYSTEMS_LAB_3D), true);

  const nonsense = { ok: true, role: "subscriber", client: "android", tier: "SOMETHING_NEW", plan: "something_new", entitlements: [] };
  assert.equal(tierFor(nonsense), FREE, "an unknown Android tier falls to FREE, not PRO");
});

test("a web subscriber's tier is still read from the plan, untouched", () => {
  const web = { ok: true, role: "subscriber", plan: "premium_annual" };
  assert.equal(tierFor(web), PRO);
  assert.equal(hasEntitlement(web, SYSTEMS_LAB_3D), true);
  const legacy = { ok: true, role: "subscriber", plan: "desktop" };
  assert.equal(tierFor(legacy), PRO, "the legacy desktop plan is not demoted");
});

/* ----------------------------------------------------------- the watermark */

test("two Android accounts leave two different stamps on the same model", async () => {
  const env = mediaEnv();
  const first = await callMedia(env, MODEL, BEARER, play([SYSTEMS_LAB_3D], { uid: "uid-a" }));
  const second = await callMedia(env, MODEL, BEARER, play([SYSTEMS_LAB_3D], { uid: "uid-b" }));
  const a = new Uint8Array(await first.arrayBuffer());
  const b = new Uint8Array(await second.arrayBuffer());
  assert.equal(a.byteLength, b.byteLength);
  assert.notDeepEqual(Array.from(a.slice(256)), Array.from(b.slice(256)), "the same uid for both would make a leak attributable to nobody");
  assert.deepEqual(Array.from(a.slice(0, 12)).slice(0, 4), [0x67, 0x6c, 0x54, 0x46], "still a GLB");
});

test("an Android stamp is not a licence stamp, and carries no address", async () => {
  const env = mediaEnv();
  const stamp = await watermarkFromSeed(env, seedForFirebaseUid("uid-a"));
  assert.match(stamp, /^[0-9a-f]{16}$/);
  assert.notEqual(stamp, await watermarkFromSeed(env, seedForFirebaseUid("uid-b")));
  assert.equal(stamp.indexOf("pilot"), -1);
  /* Empty uid must not collapse to the same seed as an empty licence key. */
  assert.notEqual(seedForFirebaseUid(""), "license:");
});

test("the owner can check a Firebase uid against a stamp, and is told when a walk proves nothing", async () => {
  const env = mediaEnv();
  const session = await createOwnerWebSession("test-signing-secret", "owner@example.com");
  const headers = { Cookie: SESSION_COOKIE + "=" + session.token };

  const forward = await ownerWatermark({
    request: jsonRequest(ORIGIN + "/api/owner/watermark", { firebaseUid: "uid-a" }, headers),
    env: env
  });
  assert.equal(forward.status, 200);
  const body = await forward.json();
  assert.equal(body.watermark, await watermarkFromSeed(env, seedForFirebaseUid("uid-a")));
  assert.equal(body.account.client, "android");

  /* The reverse walk cannot find an Android account, and says so rather than
     reporting a confident "not one of ours". */
  const reverse = await ownerWatermark({
    request: jsonRequest(ORIGIN + "/api/owner/watermark", { watermark: body.watermark }, headers),
    env: env
  });
  const reverseBody = await reverse.json();
  assert.equal(reverseBody.match, null);
  assert.match(reverseBody.note, /Android accounts are not in the licence store/);
});

/* ------------------------------------------- the contract the Android side reads */

/*
  ANDROID_CLIENT_CONTRACT.md exists because the same four website files were
  proposed twice from the Android repository: once written straight into the
  working tree, breaking npm test, and once re-sent after they had already been
  reviewed, hardened and merged. Both times the proposal was built against a
  picture of this repo that was five phases old, and there was no way for that
  session to know because nothing here stated the contract.

  A document nobody can verify rots into the same problem it was written to
  solve, so the facts it states about the gate are checked against the gate.
*/
test("the verification rule the contract prints actually verifies a stamped model", async () => {
  /*
    This test exists because the rule in that document was WRONG, and an Android
    session implemented what it said.

    It told the client to hash the first `model.bytes` bytes of the response and
    compare against the registry hash - while also, two lines earlier, correctly
    saying the GLB header's declared length is rewritten. Both cannot be true.
    Those bytes are inside the prefix, so the check fails on every model, and the
    documented symptom is VERIFICATION_FAILED with no model on screen: all 21
    would have been discarded.

    So the document is no longer merely written. The code below is the rule as
    printed, executed against a really stamped model, and it is run for several
    account seeds because the stamp's LENGTH varies with the seed while the
    prefix must not.
  */
  const crypto = await import("node:crypto");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const url = await import("node:url");
  const repo = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
  const contract = fs.readFileSync(path.join(repo, "ANDROID_CLIENT_CONTRACT.md"), "utf8");

  /* The document must still tell the client to undo the header bump. */
  assert.match(contract, /offset 8/, "the contract must name the header field that is rewritten");
  assert.match(contract, /restore the source's declared length/, "and say to restore it before hashing");
  assert.doesNotMatch(contract, /^sha256\( first model\.bytes bytes of the response \) == model\.sha256$/m,
    "the old rule must not reappear: it fails on every model");

  const gltf = Buffer.from(JSON.stringify({ asset: { version: "2.0" }, nodes: [{ name: "PT6A27_AGB" }] }), "utf8");
  const pad = (4 - (gltf.length % 4)) % 4;
  const jsonLen = gltf.length + pad;
  const source = Buffer.alloc(12 + 8 + jsonLen, 0x20);
  source.writeUInt32LE(0x46546c67, 0); source.writeUInt32LE(2, 4); source.writeUInt32LE(source.length, 8);
  source.writeUInt32LE(jsonLen, 12); source.writeUInt32LE(0x4e4f534a, 16); gltf.copy(source, 20);

  const bytes = source.length;
  const sha256 = crypto.createHash("sha256").update(source).digest("hex");

  for (const seed of ["3e756966d5a26531", "b26d45c0b2d3c584", "a"]) {
    const body = Buffer.from(stampModel(new Uint8Array(source), seed));
    assert.ok(body.length > bytes, "the delivered body is longer than the registry bytes");

    /* Naive: hash the prefix as it arrives. This is what the old rule said. */
    const naive = crypto.createHash("sha256").update(body.subarray(0, bytes)).digest("hex");
    assert.notEqual(naive, sha256, "if this ever matches, the header is no longer bumped and the doc needs revisiting");

    /* The rule as the contract now prints it. */
    const head = Buffer.from(body.subarray(0, bytes));
    head.writeUInt32LE(bytes, 8);
    assert.equal(crypto.createHash("sha256").update(head).digest("hex"), sha256,
      "the documented rule must reproduce the source file for seed " + seed);

    assert.equal(body.length - bytes, body.length - bytes, "the remainder is the account stamp");
  }
});

test("the Android contract document cannot drift from the code it describes", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const url = await import("node:url");
  const repo = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
  const doc = fs.readFileSync(path.join(repo, "ANDROID_CLIENT_CONTRACT.md"), "utf8");
  const media = fs.readFileSync(path.join(repo, "functions/api/media/index.js"), "utf8");
  const entitlements = fs.readFileSync(path.join(repo, "functions/api/_entitlements.js"), "utf8");
  const spend = fs.readFileSync(path.join(repo, "functions/api/ai/_spend.js"), "utf8");

  /* The scope prefix, quoted verbatim in the endpoint table. */
  const prefix = media.match(/const ANDROID_MEDIA_PREFIX = "([^"]+)"/);
  assert.ok(prefix, "the endpoint must still declare a scope prefix");
  assert.ok(doc.includes(prefix[1]), "the document quotes a path prefix the code no longer uses: " + prefix[1]);

  /* The two entitlements it names, and the tier claim about the first. */
  assert.ok(media.includes("SYSTEMS_LAB_3D") && doc.includes("SYSTEMS_LAB_3D"));
  assert.ok(doc.includes("AI_TRAINER"));
  assert.doesNotMatch(entitlements, /FREE_ENTITLEMENTS = \[[^\]]*SYSTEMS_LAB_3D/,
    "the document says SYSTEMS_LAB_3D is PRO and up; FREE now grants it");
  assert.ok(doc.includes('["BASIC_STUDY", "FLASHCARD_SELF_ENTRY"]'), "the FREE list it quotes must be the real one");
  assert.match(entitlements, /FREE_ENTITLEMENTS = \["BASIC_STUDY", "FLASHCARD_SELF_ENTRY"\]/);

  /* Every refusal code the table promises a client can branch on. */
  ["firebase_token_invalid", "firebase_account_disabled", "entitlement_required",
   "android_media_scope", "ai_rate_limited", "mobile_access_not_configured",
   "entitlement_check_unavailable"].forEach((code) => {
    assert.ok(doc.includes(code), "the document omits the refusal " + code);
  });

  /* The defaults it tells an operator they can change. */
  assert.match(spend, /export const BURST_LIMIT = 15;/);
  assert.match(spend, /export const DAILY_LIMIT = 80;/);
  assert.ok(doc.includes("AI_BURST_LIMIT") && doc.includes("AI_DAILY_LIMIT"));
  assert.ok(doc.includes("15 per 5 min") && doc.includes("80 per 24 h"), "the quoted defaults must be the real ones");
});
