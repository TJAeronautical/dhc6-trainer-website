import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const htmlFiles = fs.readdirSync(root).filter((name) => name.endsWith(".html"));

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
    assert.match(html, /assets\/site-redesign\.css/i, `${file}: shared stylesheet missing`);
    assert.match(html, /<meta\s+name="viewport"/i, `${file}: viewport missing`);
  }
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
