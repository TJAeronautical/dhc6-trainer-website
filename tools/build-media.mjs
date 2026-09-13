#!/usr/bin/env node
/*
  Prepare the protected media publish (3D models for the Technical Lab).

  Usage:
    node tools/build-media.mjs --reference "C:\Android Studio\DHC6_REFERENCE_LIBRARY\System-Lab" ^
                               --android   "C:\Android Studio\DHC-6-Trainer" ^
                               --out build\media [--bucket dhc6-web-media]

  Reads tools/data/systems-lab-models.json (the model registry: file names,
  node-name selectors, sizes, sha256) and locates every GLB either in the
  reference library (source "reference-library") or in the Android repo
  (source "android-bundled", core-res/src/main/assets/models/systems_lab/models).

  Output (build/ is git-ignored — nothing here is committed):
    <out>/media-index.json      value for KV key  webmedia:index
    <out>/kv-media-index.json   wrangler bulk file publishing that key
    <out>/upload-media.ps1      wrangler r2 object put … for every model (PowerShell)
    <out>/upload-media.sh       same for bash
    <out>/media-report.txt      what was found, sizes and hash checks

  Models are served only through /api/media/<path> after the subscriber/owner
  session is verified (functions/api/media). They are never committed here and
  never placed under the public assets directory.
*/

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

function arg(name, fallback) {
  const index = process.argv.indexOf("--" + name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const referenceDir = arg("reference", process.env.DHC6_REFERENCE_LIBRARY || "");
const androidRoot = arg("android", process.env.DHC6_ANDROID_REPO || "");
const outDir = path.resolve(arg("out", "build/media"));
const bucket = arg("bucket", "dhc6-web-media");
const R2_PREFIX = "webmedia/";

const registry = JSON.parse(fs.readFileSync(path.join(TOOLS_DIR, "data", "systems-lab-models.json"), "utf8"));

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

function locate(model) {
  const candidates = [];
  if (model.source === "reference-library" && referenceDir) candidates.push(path.join(referenceDir, model.file));
  if (androidRoot) {
    candidates.push(path.join(androidRoot, "core-res", "src", "main", "assets", "models", "systems_lab", "models", model.file));
  }
  if (referenceDir) candidates.push(path.join(referenceDir, model.file));
  return candidates.find((c) => fs.existsSync(c)) || null;
}

fs.mkdirSync(outDir, { recursive: true });
const items = [];
const report = [];
const ps = ["# Upload the Technical Lab models to R2 (run from the website repo, after `npx wrangler r2 bucket create " + bucket + "`)", "$ErrorActionPreference = 'Stop'"];
const sh = ["#!/usr/bin/env bash", "# Upload the Technical Lab models to R2 (run from the website repo, after `npx wrangler r2 bucket create " + bucket + "`)", "set -euo pipefail"];
let missing = 0;
let mismatched = 0;
let totalBytes = 0;

for (const model of registry.models) {
  const file = locate(model);
  if (!file) {
    missing += 1;
    report.push("MISSING   " + model.file + "  (" + model.source + ")");
    continue;
  }
  const bytes = fs.statSync(file).size;
  const sha = sha256File(file);
  const status = sha === model.sha256 ? "ok" : "HASH-CHANGED";
  if (status !== "ok") mismatched += 1;
  totalBytes += bytes;
  report.push(status.padEnd(12) + model.file.padEnd(48) + String(bytes).padStart(10) + "  " + file);
  const mediaPath = model.mediaPath || (registry.mediaRoot + "/" + model.file);
  items.push({ path: mediaPath, bytes: bytes, sha256: sha, contentType: "model/gltf-binary", store: "r2", modelId: model.id, title: model.title });
  const key = bucket + "/" + R2_PREFIX + mediaPath;
  ps.push('npx wrangler r2 object put "' + key + '" --file "' + file + '" --content-type model/gltf-binary --remote');
  sh.push("npx wrangler r2 object put '" + key + "' --file '" + file.replace(/'/g, "'\\''") + "' --content-type model/gltf-binary --remote");
}

const index = {
  version: new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + crypto.createHash("sha256").update(items.map((i) => i.sha256).join("")).digest("hex").slice(0, 8),
  publishedAt: new Date().toISOString(),
  bucket: bucket,
  items: items
};
const indexText = JSON.stringify(index);
fs.writeFileSync(path.join(outDir, "media-index.json"), indexText);
fs.writeFileSync(path.join(outDir, "kv-media-index.json"), JSON.stringify([{ key: "webmedia:index", value: indexText }]));
ps.push("# Then publish the index: npx wrangler kv bulk put " + path.join(outDir, "kv-media-index.json") + " --binding LICENSES --remote");
sh.push("# Then publish the index: npx wrangler kv bulk put '" + path.join(outDir, "kv-media-index.json") + "' --binding LICENSES --remote");
fs.writeFileSync(path.join(outDir, "upload-media.ps1"), ps.join("\r\n") + "\r\n");
fs.writeFileSync(path.join(outDir, "upload-media.sh"), sh.join("\n") + "\n");
report.unshift("Technical Lab media build — " + items.length + " of " + registry.models.length + " models found, " + (totalBytes / 1e6).toFixed(1) + " MB, index " + index.version);
fs.writeFileSync(path.join(outDir, "media-report.txt"), report.join("\n") + "\n");
console.log(report.join("\n"));
if (missing) console.warn("\n" + missing + " model(s) missing — pass --reference and --android so every registry entry can be located.");
if (mismatched) console.warn(mismatched + " model(s) differ from the registry hash — regenerate tools/data/systems-lab-models.json if the GLB files were re-exported.");
console.log("\nOutput → " + outDir);
