/* Shared test doubles for the Cloudflare Worker API. */

export function memoryKv(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    map: map,
    async get(key) { return map.has(key) ? map.get(key) : null; },
    async put(key, value) { map.set(key, String(value)); },
    async delete(key) { map.delete(key); }
  };
}

export function activeLicense(overrides) {
  return Object.assign({
    key: "DHC6-ABCD-EFGH-JKLM",
    email: "pilot@example.com",
    status: "active",
    plan: "premium_annual",
    subscriptionId: "sub_123",
    customerId: "ctm_123",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    activationLimit: 3,
    activations: []
  }, overrides || {});
}

export function envWithLicense(license, extra) {
  const record = license || activeLicense();
  const kv = memoryKv({
    ["license:" + record.key]: JSON.stringify(record),
    ["email:" + record.email]: record.key
  });
  return Object.assign({
    LICENSES: kv,
    LICENSE_SIGNING_SECRET: "test-signing-secret",
    OWNER_ACCESS_EMAIL: "owner@example.com",
    FIREBASE_WEB_API_KEY: "firebase-key"
  }, extra || {});
}

export function jsonRequest(url, body, headers) {
  return new Request(url, {
    method: "POST",
    headers: Object.assign({ "Content-Type": "application/json", "Origin": "https://dhc6trainer.com" }, headers || {}),
    body: JSON.stringify(body)
  });
}

export function cookieFrom(response) {
  const header = response.headers.get("Set-Cookie") || "";
  return header.split(";")[0];
}

/* Install a fetch mock; returns { calls, restore }. handler(url, init) -> Response */
export function mockFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async function (url, init) {
    calls.push({ url: String(url), init: init || {} });
    return handler(String(url), init || {}, calls.length);
  };
  return { calls: calls, restore: function () { globalThis.fetch = original; } };
}

export function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: { "Content-Type": "application/json" } });
}
