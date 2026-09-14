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
    async delete(key) { map.delete(key); },
    /* Cloudflare KV's prefix listing, including the cursor paging, so code
       that walks the store is exercised against more than one page. */
    async list(options) {
      const opts = options || {};
      const prefix = opts.prefix || "";
      const limit = Math.max(1, Math.min(1000, Number(opts.limit) || 1000));
      const all = Array.from(map.keys()).filter(function (key) { return key.startsWith(prefix); }).sort();
      const start = opts.cursor ? all.indexOf(opts.cursor) + 1 : 0;
      const page = all.slice(start, start + limit);
      const last = page.length ? page[page.length - 1] : null;
      const complete = start + page.length >= all.length;
      return {
        keys: page.map(function (name) { return { name: name }; }),
        list_complete: complete,
        cursor: complete ? undefined : last
      };
    }
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

/* A throwaway RSA key so the Google service-account JWT signing path runs for
   real rather than being stubbed around. Generated for the test suite only;
   it grants access to nothing. */
export const TEST_SERVICE_ACCOUNT_KEY = "-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCI1rw3FSEm6hgp\nqakiMMX8lSDaIEYTqJzo+nwrxEjuMKBib2yJb4glUhKizdZrZOC8WJEgNy+qnfQn\ndJpxpLh78XGxaStvDFrka469YlXL0a0tzX502oAysIgidOnY7762atygltxO5F4X\nUlAN9hEG1/YGyrbWFsT90+sHvZomrf/Gs55j/IspKgLSk4lT3L2QZj+W5HpKh+Vr\nm5DrqemTqxxhdocOq9g9jEbtSV5kCL8K+eUaoqZXihJjNqT6NiEbkuYnwbxar3b8\n+RRLfQh4+9GHxsolSzQbpmkSMH+U+ONfAzG65WQMIBEh2Fq3r/VCYrSd5KKWDzQe\nQQhaZ3oXAgMBAAECggEAPcTtJlI36liOurPW4NOyc7+fmkcqSvJ4jiSQC7OpljfG\nFlkk3e9GPk6LkgknqsfZOLwkGq4+qp5tmafllboc+vn07/hA/npNx0GUKAItJ3nJ\nWl0iIb6GUxtkAGXVL7OdW7vmRumCnmww2wcxkvPKINQ4vz0fhom1t7zDIfXhEWcd\n/WSe4PjevHEZ4d5Z6pGAL1yi9QdfJl0l8ShHHGUnRjhHLoarCvMh0zzE6E2q/B4K\nKgXqmGGnbVEFiAaF/Ejoj5ts8dEPRbKNRSugZz1wwQCbpf08H9MlO0ficemWP6YL\ni6TRmfmuDpv+F0+7SsezcLO2ARlwq3Z+YiOLNJ7jAQKBgQDAdj/8Koz3axH6OS3R\nufUorptIDRwixwovRCAqp4u7YHRCE7pFXtoDc+kfLhL9stTh8t+fhH0iYdeXe+gW\n4lNAUxLArooWdF0RxLF/50DHn9Cs5Qejhb2MFBTgQZJsftsO5kWJuLRstdHPYYex\nD0p7F+Yjkmwebzt5F9GTOsbXAQKBgQC2A4wdyDu5RRxwkik34qIpRd8tvxgCLOXD\nN+Q1QFafC/hmyA/p1w2QUXPn8tWEUyFnQl/HofTVKyQ35AFNE7zhyowXkLYl52np\nVtGQHi2ezucCOW9X3qFoTTyRgBwQOoynPzjueKM3uaE7tnpFpSswmWw8Vm142MRa\nzCEAjRspFwKBgGaC1YPfuiPSsMmhiQkrTix0DBtteC4B7CfO1n9BrIiKUIIdddqb\nMe4i3+mOpejhRshuj7OsYuZcTPPPuIfv1r3tQZDFpqFdK3FaXdytdPCe7AwbFV2A\nz7v7uj7UTkRhsRYXirRXYCqDEZSu8xJY/afgy+DojZQMVRYjnKoZ5W0BAoGAZLFR\nsqgzYit5sE0rwF8AlxSwgv5Uqd9svLMO7ObLBPH6WeIT66mtN0nYdVlCBhJ3SEjP\n9AEFEWjsgH8CuUFSHReQqPjFy/JaBVyiUrhfRJvx8KkVj+b6JFmWSGg3HkNFzMCN\nHmBe61UmfYJV4nGdkyVNW5P0vAYvmouTNlrZy8ECgYB1OW+uSye5qNCbJDTnFevV\nATDnIuyfXewspDrTbaw9kD6LdPV4+lawuUwEFpusffvUi4sYbFD+yvC+kMZj+oot\nQhzpMW/sOQgmk/0m5/GazqCJhmchbb9JLYyaRWyE4iENqv7xNyEO88uGBMMzxznI\nPGIQ4+tMHATgi0PgDjQ8yg==\n-----END PRIVATE KEY-----\n";
