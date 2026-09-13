import test from "node:test";
import assert from "node:assert/strict";
import worker, { isProtectedPage, API_ROUTES } from "../worker.js";
import { createWebSession, SESSION_COOKIE } from "../functions/api/web-access/_session.js";
import { activeLicense, envWithLicense } from "./helpers.mjs";

function fakeAssets() {
  const served = [];
  return {
    served: served,
    async fetch(request) {
      const url = new URL(request.url);
      served.push(url.pathname);
      if (url.pathname === "/app") return new Response(null, { status: 307, headers: { Location: "/app/" } });
      const html = url.pathname.endsWith("/") || url.pathname.endsWith(".html");
      return new Response(html ? "<html><body>asset " + url.pathname + "</body></html>" : "asset " + url.pathname, {
        status: 200,
        headers: { "Content-Type": html ? "text/html; charset=utf-8" : "text/plain" }
      });
    }
  };
}

function run(path, env, headers) {
  return worker.fetch(new Request("https://dhc6trainer.com" + path, { headers: headers || {} }), env, { waitUntil() {} });
}

test("protected page matcher covers the app shell and the legacy live trainer", () => {
  assert.equal(isProtectedPage("/app"), true);
  assert.equal(isProtectedPage("/app/"), true);
  assert.equal(isProtectedPage("/app/index.html"), true);
  assert.equal(isProtectedPage("/app/qrh/engine-fire"), true);
  assert.equal(isProtectedPage("/live.html"), true);
  assert.equal(isProtectedPage("/live"), true);
  assert.equal(isProtectedPage("/app/app.js"), false, "code is public, content is not");
  assert.equal(isProtectedPage("/app/app.css"), false);
  assert.equal(isProtectedPage("/index.html"), false);
  assert.equal(isProtectedPage("/web-app.html"), false);
  assert.equal(isProtectedPage("/application.html"), false);
});

test("anonymous requests for protected pages are redirected to sign-in and never served", async () => {
  const env = envWithLicense();
  env.ASSETS = fakeAssets();
  for (const path of ["/app/", "/app", "/app/qrh", "/live.html", "/live"]) {
    const response = await run(path, env);
    assert.equal(response.status, 302, path);
    const location = new URL(response.headers.get("Location"));
    assert.equal(location.pathname, "/web-app.html");
    assert.equal(location.searchParams.get("status"), "signin-required");
    assert.equal(location.searchParams.get("next"), path);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  }
  assert.deepEqual(env.ASSETS.served, [], "the asset layer must not be touched for unauthenticated protected requests");
});

test("expired, garbage and lapsed-entitlement cookies are rejected at the edge", async () => {
  const env = envWithLicense();
  env.ASSETS = fakeAssets();
  const garbage = await run("/app/", env, { Cookie: SESSION_COOKIE + "=abc.def" });
  assert.equal(garbage.status, 302);
  const lapsedEnv = envWithLicense(activeLicense({ status: "canceled" }));
  lapsedEnv.ASSETS = fakeAssets();
  const session = await createWebSession("test-signing-secret", activeLicense());
  const lapsed = await run("/app/", lapsedEnv, { Cookie: SESSION_COOKIE + "=" + session.token });
  assert.equal(lapsed.status, 302);
  assert.deepEqual(lapsedEnv.ASSETS.served, []);
});

test("valid session cookies get the shell with private no-store headers, deep links serve the shell", async () => {
  const env = envWithLicense();
  env.ASSETS = fakeAssets();
  const session = await createWebSession("test-signing-secret", activeLicense());
  const headers = { Cookie: SESSION_COOKIE + "=" + session.token };
  const shell = await run("/app/", env, headers);
  assert.equal(shell.status, 200);
  assert.equal(shell.headers.get("Cache-Control"), "private, no-store");
  assert.equal(shell.headers.get("X-Robots-Tag"), "noindex, nofollow");
  assert.equal(shell.headers.get("X-Content-Type-Options"), "nosniff");
  assert.match(await shell.text(), /asset \/app\//);

  const deep = await run("/app/qrh/engine-fire?x=1", env, headers);
  assert.equal(deep.status, 200);
  assert.equal(env.ASSETS.served.pop(), "/app/", "client-side routes are served from the canonical shell document");

  const legacy = await run("/live.html", env, headers);
  assert.equal(legacy.status, 200);
  assert.equal(legacy.headers.get("Cache-Control"), "private, no-store");

  const canonical = await run("/app", env, headers);
  assert.equal(canonical.status, 307, "asset-layer canonical redirects pass through without looping");
});

test("public pages and static app code are unaffected by the gate", async () => {
  const env = envWithLicense();
  env.ASSETS = fakeAssets();
  const home = await run("/index.html", env);
  assert.equal(home.status, 200);
  assert.equal(home.headers.get("Cache-Control"), null);
  const script = await run("/app/app.js", env);
  assert.equal(script.status, 200);
  const api = await run("/api", env);
  assert.equal(api.status, 200);
  const routes = (await api.json()).routes;
  for (const path of ["/api/web-access/logout", "/api/web-access/request-link", "/api/web-access/link-session", "/api/content/manifest"]) assert.ok(routes.includes(path), path);
  assert.deepEqual(routes, API_ROUTES);
});
