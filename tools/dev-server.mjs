#!/usr/bin/env node
/*
  Minimal local dev server that runs worker.js with in-memory bindings —
  no Cloudflare account or network needed.

    node tools/dev-server.mjs --port 8788 --kv build/content/kv-bulk.json

  Seeds LICENSES with the given wrangler bulk file plus a development licence:
    email pilot@example.com · key DHC6-TEST-TEST-TEST
  Secrets come from .dev.vars when present (LICENSE_SIGNING_SECRET etc.).
  The Secure cookie flag is stripped so http://127.0.0.1 works in a browser.
*/
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../worker.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function arg(name, fallback) { const i = process.argv.indexOf("--" + name); return i > -1 ? process.argv[i + 1] : fallback; }
const port = Number(arg("port", 8788));

const env = { PADDLE_ENVIRONMENT: "sandbox", LICENSE_SIGNING_SECRET: "dev-signing-secret", OWNER_ACCESS_EMAIL: "owner@example.com", FIREBASE_WEB_API_KEY: "dev-key" };
if (fs.existsSync(path.join(root, ".dev.vars"))) {
  for (const line of fs.readFileSync(path.join(root, ".dev.vars"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

const kv = new Map();
const seed = arg("kv", "");
if (seed && fs.existsSync(seed)) for (const entry of JSON.parse(fs.readFileSync(seed, "utf8"))) kv.set(entry.key, entry.value);
const devLicense = { key: "DHC6-TEST-TEST-TEST", email: "pilot@example.com", status: "active", plan: "premium_annual", subscriptionId: "sub_dev", customerId: "ctm_dev", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z", activationLimit: 3, activations: [] };
kv.set("license:" + devLicense.key, JSON.stringify(devLicense));
kv.set("email:" + devLicense.email, devLicense.key);
env.LICENSES = { async get(k) { return kv.has(k) ? kv.get(k) : null; }, async put(k, v) { kv.set(k, String(v)); }, async delete(k) { kv.delete(k); } };

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain", ".xml": "application/xml" };
env.ASSETS = {
  async fetch(request) {
    const url = new URL(request.url);
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith("/")) p += "index.html";
    let file = path.join(root, p);
    if (!file.startsWith(root)) return new Response("forbidden", { status: 403 });
    if (!fs.existsSync(file) && fs.existsSync(file + ".html")) file += ".html";
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) return new Response(null, { status: 307, headers: { Location: url.pathname + "/" } });
    if (!fs.existsSync(file)) return new Response(fs.readFileSync(path.join(root, "404.html")), { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } });
    return new Response(fs.readFileSync(file), { status: 200, headers: { "Content-Type": types[path.extname(file)] || "application/octet-stream" } });
  }
};

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  const request = new Request("http://127.0.0.1:" + port + req.url, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
  try {
    const response = await worker.fetch(request, env, { waitUntil() {} });
    const outHeaders = {};
    response.headers.forEach((v, k) => {
      if (k === "set-cookie") v = v.replace("; Secure", "");
      outHeaders[k] = v;
    });
    res.writeHead(response.status, outHeaders);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("dev-server error: " + (error && error.stack || error));
  }
});
server.listen(port, "127.0.0.1", () => console.log("DHC-6 Trainer dev server -> http://127.0.0.1:" + port + "  (licence: pilot@example.com / DHC6-TEST-TEST-TEST)"));
