import assert from "node:assert/strict";
import test from "node:test";
import { onRequest as apiMiddleware } from "../functions/api/_middleware.js";
import { onRequestPost as oralExam } from "../functions/api/ai/oral-exam.js";

function base64Url(value) {
  const bytes = typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
  return bytes.toString("base64url");
}

async function appCheckFixture(projectNumber, appId) {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  jwk.kid = "test-key";
  jwk.alg = "RS256";
  jwk.use = "sig";
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: jwk.kid }));
  const claims = base64Url(JSON.stringify({
    iss: `https://firebaseappcheck.googleapis.com/${projectNumber}`,
    aud: [`projects/${projectNumber}`],
    sub: appId,
    iat: now - 5,
    exp: now + 3600
  }));
  const unsigned = `${header}.${claims}`;
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    pair.privateKey,
    new TextEncoder().encode(unsigned)
  );
  return { token: `${unsigned}.${base64Url(signature)}`, jwk };
}

test("API preflight allows the Firebase App Check header", async () => {
  const request = new Request("https://dhc6trainer.com/api/ai/oral-exam", {
    method: "OPTIONS",
    headers: { Origin: "https://dhc6trainer.com" }
  });
  const response = await apiMiddleware({ request, next: async () => new Response("unused") });
  assert.equal(response.status, 204);
  assert.match(response.headers.get("Access-Control-Allow-Headers"), /X-Firebase-AppCheck/);
});

test("oral exam rejects a request without Firebase authentication", async () => {
  const request = new Request("https://dhc6trainer.com/api/ai/oral-exam", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instructions: "test", message: "question" })
  });
  const response = await oralExam({ request, env: {} });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { ok: false, error: "firebase_token_missing" });
});

test("oral exam verifies App Check and returns the Android text contract", async () => {
  const projectNumber = "123456789012";
  const appId = "1:123456789012:android:test";
  const fixture = await appCheckFixture(projectNumber, appId);
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith("https://identitytoolkit.googleapis.com/")) {
      return Response.json({ users: [{ localId: "pilot-1" }] });
    }
    if (String(url) === "https://firebaseappcheck.googleapis.com/v1/jwks") {
      return Response.json({ keys: [fixture.jwk] }, { headers: { "Cache-Control": "max-age=300" } });
    }
    if (String(url) === "https://api.openai.com/v1/responses") {
      return Response.json({ output_text: "Examiner response" });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const request = new Request("https://dhc6trainer.com/api/ai/oral-exam", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer firebase-id-token",
        "X-Firebase-AppCheck": fixture.token
      },
      body: JSON.stringify({
        instructions: "Act as an examiner",
        history: [{ role: "assistant", content: "Previous question" }],
        message: "Pilot answer"
      })
    });
    const response = await oralExam({
      request,
      env: {
        FIREBASE_WEB_API_KEY: "test-api-key",
        FIREBASE_PROJECT_NUMBER: projectNumber,
        FIREBASE_ANDROID_APP_ID: appId,
        OPENAI_API_KEY: "test-openai-key",
        OPENAI_MODEL: "gpt-4.1-mini"
      }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { text: "Examiner response" });

    const openAiCall = calls.find((call) => call.url === "https://api.openai.com/v1/responses");
    const payload = JSON.parse(openAiCall.init.body);
    assert.deepEqual(payload.input, [
      { role: "assistant", content: "Previous question" },
      { role: "user", content: "Pilot answer" }
    ]);
    assert.equal(payload.model, "gpt-4.1-mini");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
