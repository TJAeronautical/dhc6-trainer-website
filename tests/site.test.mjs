import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const htmlFiles = fs.readdirSync(root).filter((name) => name.endsWith(".html")).concat(["app/index.html"]);

function localTarget(value, sourceFile) {
  if (!value || value.startsWith("#") || /^(?:https?:|mailto:|tel:|data:|javascript:|dhc6trainer:)/i.test(value)) return null;
  const clean = value.split("#")[0].split("?")[0];
  if (!clean) return null;
  const base = clean.startsWith("/") ? root : path.dirname(path.join(root, sourceFile));
  return path.resolve(base, clean.replace(/^\//, ""));
}

test("public pages have essential metadata and shared design", () => {
  for (const file of htmlFiles) {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(html, /<title>[^<]+<\/title>/i, `${file}: title missing`);
    if (file !== "404.html") assert.match(html, /<meta\s+name="description"/i, `${file}: description missing`);
    if (file !== "app/index.html") assert.match(html, /assets\/site-redesign\.css/i, `${file}: shared stylesheet missing`);
    assert.match(html, /<meta\s+name="viewport"/i, `${file}: viewport missing`);
  }
});

test("concept imagery is never labelled as a real app screenshot", () => {
  for (const file of htmlFiles) {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    for (const match of html.matchAll(/<img[^>]+src="([^"]+)"[^>]*>/gi)) {
      const src = match[1];
      const tag = match[0];
      if (/latest-design|assets\/screenshots\//.test(src)) {
        assert.doesNotMatch(tag, /\b(actual|verified|real)\b/i, `${file}: concept image ${src} described as real`);
        assert.match(tag, /concept|illustration|mock/i, `${file}: concept image ${src} must be labelled as a concept/illustration`);
      }
    }
  }
  const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  assert.doesNotMatch(sw, /latest-design|assets\/screenshots/);
});

test("subscriber app shell is server-gated and keeps no session secret in web storage", () => {
  const worker = fs.readFileSync(path.join(root, "worker.js"), "utf8");
  assert.match(worker, /isProtectedPage/);
  assert.match(worker, /authorizeWebRequest/);
  const login = fs.readFileSync(path.join(root, "assets", "js", "web-app-login.js"), "utf8");
  assert.doesNotMatch(login, /sessionStorage\.setItem\("dhc6WebAccessToken"/);
  assert.match(login, /credentials: "same-origin"/);
  const gate = fs.readFileSync(path.join(root, "assets", "js", "subscriber-gate.js"), "utf8");
  assert.match(gate, /clear-protected/);
  assert.match(gate, /api\/web-access\/logout/);
  const shell = fs.readFileSync(path.join(root, "app", "index.html"), "utf8");
  assert.match(shell, /Training support only/);
  assert.match(shell, /AFM, QRH, MEL/);
  assert.match(shell, /noindex/);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "assets", "site.webmanifest"), "utf8"));
  assert.equal(manifest.start_url, "/app/");
  const robots = fs.readFileSync(path.join(root, "robots.txt"), "utf8");
  assert.match(robots, /Disallow: \/app\//);
  const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
  assert.doesNotMatch(sitemap, /live\.html|\/app\//);
});

test("Technical Lab models are never shipped in the public repo and the viewer is session-gated", () => {
  function walk(dir, out) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if ([".git", "node_modules", "build", "_delivery", ".wrangler"].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out); else out.push(full);
    }
    return out;
  }
  const binaries = walk(root, []).filter((f) => /\.(glb|gltf|bin)$/i.test(f));
  assert.deepEqual(binaries, [], "GLB models must be published to R2 via tools/build-media.mjs, not committed");
  const wrangler = fs.readFileSync(path.join(root, "wrangler.jsonc"), "utf8");
  assert.match(wrangler, /"binding": "WEB_MEDIA"/);
  assert.match(wrangler, /"bucket_name": "dhc6-web-media"/);
  const lab = fs.readFileSync(path.join(root, "app", "js", "lab3d.js"), "utf8");
  assert.match(lab, /\/api\/media\//, "models are fetched only through the protected media API");
  assert.doesNotMatch(lab, /r2\.cloudflarestorage|\.r2\.dev/, "no direct bucket URLs in the client");
  const gate = fs.readFileSync(path.join(root, "assets", "js", "subscriber-gate.js"), "utf8");
  assert.match(gate, /url\.pathname\.startsWith\("\/api\/"\)/, "sign-out clears every /api/ cache entry, including /api/media models");
  const registry = JSON.parse(fs.readFileSync(path.join(root, "tools", "data", "systems-lab-models.json"), "utf8"));
  for (const model of registry.models) assert.ok(fs.existsSync(path.join(root, "app", "vendor", "three-lab.js")), "viewer runtime present for " + model.id);
  const shellCss = fs.readFileSync(path.join(root, "app", "app.css"), "utf8");
  assert.match(shellCss, /scroll-padding-bottom/, "focused controls must not hide under the bottom navigation");
});

test("internal href and src references resolve", () => {
  const failures = [];
  for (const file of htmlFiles) {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    for (const match of html.matchAll(/(?:href|src)="([^"]+)"/gi)) {
      const target = localTarget(match[1], file);
      if (target && !fs.existsSync(target)) failures.push(`${file} -> ${match[1]}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("HTML ids are unique per page", () => {
  for (const file of htmlFiles) {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    const ids = Array.from(html.matchAll(/\sid="([^"]+)"/gi), (m) => m[1]);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    assert.deepEqual([...new Set(duplicates)], [], `${file}: duplicate ids`);
  }
});

test("critical purchase and account controls remain wired", () => {
  const desktop = fs.readFileSync(path.join(root, "desktop.html"), "utf8");
  const access = fs.readFileSync(path.join(root, "access.html"), "utf8");
  for (const plan of ["premium", "instructor", "enterprise"]) assert.match(desktop, new RegExp(`data-plan="${plan}"`));
  assert.match(desktop, /id="checkout-status"/);
  assert.match(desktop, /assets\/js\/paddle-checkout\.js/);
  for (const id of ["billing-status-form", "billingEmail", "billing-summary", "device-list", "desktop-download-message"]) assert.match(access, new RegExp(`id="${id}"`));
  assert.doesNotMatch(desktop, /pri_REPLACE|live_REPLACE|test_REPLACE/);
});

test("Paddle legal pages and primary footer links are published", () => {
  const terms = fs.readFileSync(path.join(root, "terms.html"), "utf8");
  const refund = fs.readFileSync(path.join(root, "refund.html"), "utf8");
  const worker = fs.readFileSync(path.join(root, "worker.js"), "utf8");
  const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
  assert.match(terms, /Terms of Service/);
  assert.match(terms, /Paddle/);
  assert.match(refund, /Refund and Cancellation Policy/);
  assert.match(refund, /mandatory consumer rights/i);
  assert.match(worker, /footer-legal-links/);
  assert.match(worker, /terms\.html/);
  assert.match(worker, /refund\.html/);
  assert.match(sitemap, /terms\.html/);
  assert.match(sitemap, /refund\.html/);
});

test("service worker precache paths exist", () => {
  const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  const entries = Array.from(sw.matchAll(/^\s*"(\/[^"]+)"[,]?$/gm), (m) => m[1]);
  for (const entry of entries) {
    if (entry === "/") continue;
    assert.ok(fs.existsSync(path.join(root, entry.slice(1))), `Missing precache asset ${entry}`);
  }
});

test("all JavaScript modules and browser scripts parse", () => {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if ([".wrangler", "node_modules"].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js") || entry.name.endsWith(".mjs")) files.push(full);
    }
  }
  walk(root);
  for (const file of files) execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
});
