/* Shared test doubles for the Cloudflare Worker API. */

export function memoryKv(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    map: map,
    async get(key, type) {
      if (!map.has(key)) return null;
      const value = map.get(key);
      if (type === "arrayBuffer") {
        if (value instanceof Uint8Array) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
        if (value instanceof ArrayBuffer) return value;
        return new TextEncoder().encode(String(value)).buffer;
      }
      if (value instanceof Uint8Array) return new TextDecoder().decode(value);
      return value;
    },
    async put(key, value) { map.set(key, value instanceof Uint8Array || value instanceof ArrayBuffer ? new Uint8Array(value) : String(value)); },
    async delete(key) { map.delete(key); }
  };
}

/* Minimal R2 bucket double: objects = { key: Uint8Array | { bytes, contentType } } */
export function memoryR2(initial) {
  const map = new Map();
  Object.keys(initial || {}).forEach(function (key) {
    const entry = initial[key];
    const bytes = entry instanceof Uint8Array ? entry : entry.bytes;
    map.set(key, { bytes: bytes, contentType: entry.contentType || null, etag: "r2-" + key.length + "-" + bytes.byteLength });
  });
  function describe(key, entry, range) {
    return {
      key: key,
      size: entry.bytes.byteLength,
      etag: entry.etag,
      httpEtag: '"' + entry.etag + '"',
      httpMetadata: entry.contentType ? { contentType: entry.contentType } : {},
      range: range || undefined
    };
  }
  return {
    map: map,
    async head(key) { const entry = map.get(key); return entry ? describe(key, entry) : null; },
    async get(key, options) {
      const entry = map.get(key);
      if (!entry) return null;
      let bytes = entry.bytes;
      let range = null;
      if (options && options.range) {
        range = { offset: options.range.offset || 0, length: options.range.length || (bytes.byteLength - (options.range.offset || 0)) };
        bytes = bytes.slice(range.offset, range.offset + range.length);
      }
      return Object.assign(describe(key, entry, range), {
        body: new Blob([bytes]).stream(),
        async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); }
      });
    },
    async put(key, value, options) { const bytes = value instanceof Uint8Array ? value : new Uint8Array(value); map.set(key, { bytes: bytes, contentType: options && options.httpMetadata && options.httpMetadata.contentType || null, etag: "r2-" + key.length + "-" + bytes.byteLength }); },
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
