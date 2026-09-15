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
/* The GLB reader, so the build can see what a model actually contains rather
   than only how big it is. */
import { summarise, checkSelectors } from "./inspect-glb.mjs";

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
/* Generated media trees, comma-separated: the cockpit plate + sprite atlas from
   tools/build-cockpit.mjs, and the system posters and Systems Lab reference figures from tools/build-diagrams.mjs.
   Each tree publishes its files at their path relative to that tree's root. */
const extraMediaDirs = String(arg("extra-media", "build/cockpit/media"))
  .split(",")
  .map((piece) => piece.trim())
  .filter(Boolean)
  .map((piece) => path.resolve(piece));

const registry = JSON.parse(fs.readFileSync(path.join(TOOLS_DIR, "data", "systems-lab-models.json"), "utf8"));

function sha256File(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

/*
  Which clips the registry promises that the file does not contain.

  A stale sha or byte count corrects itself on publish - the index records what
  was actually uploaded. A stale CLIP name does not: `clipGroupsForModel` drives
  the Lab's animation buttons from the registry's `animations` list, so a clip
  the file no longer has becomes a button that plays nothing, and uploading is
  what makes it live.

  This is the reason the re-exported library needs it today. hydraulic-pack went
  from 82 clips to 1 and woodward-csu from 19 to 1; publishing either before its
  entry is re-authored would put eighty-odd dead buttons in front of a pilot.
*/
function deadRefsIn(model, bytes) {
  const read = summarise(bytes);
  if (!read.ok) return [];          /* unreadable is the hash check's problem, not this one */

  const dead = [];
  const declared = Array.isArray(model.animations) ? model.animations : [];
  if (declared.length) {
    const actual = new Set(read.animations);
    declared.forEach((name) => { if (!actual.has(name)) dead.push("clip " + name); });
  }

  /*
    Pins are the same failure wearing a different hat. A `parts` or `extraParts`
    selector that resolves to nothing is a dot a pilot can tap that does
    nothing - no error, no warning - and publishing is what makes it live.
    `hidden` is excluded on purpose: a hygiene rule with nothing left to hide is
    the library getting cleaner, not a fault.
  */
  checkSelectors(model, read.nodeNames).dead.forEach((entry) => {
    if (entry.where !== "hidden") dead.push(entry.where + " " + entry.selector);
  });
  return dead;
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
const deadRefs = [];

for (const model of registry.models) {
  const file = locate(model);
  if (!file) {
    missing += 1;
    report.push("MISSING   " + model.file + "  (" + model.source + ")");
    continue;
  }
  /* Read once: the hash, the size and the clip check all come off these bytes. */
  const buffer = fs.readFileSync(file);
  const bytes = buffer.byteLength;
  const sha = sha256File(buffer);
  const status = sha === model.sha256 ? "ok" : "HASH-CHANGED";
  if (status !== "ok") mismatched += 1;
  const dead = deadRefsIn(model, buffer);
  if (dead.length) deadRefs.push({ id: model.id, file: model.file, refs: dead });
  totalBytes += bytes;
  report.push((dead.length ? "DEAD-REFS" : status).padEnd(12) + model.file.padEnd(48) + String(bytes).padStart(10) + "  " + file);
  if (dead.length) {
    report.push("".padEnd(12) + dead.length + " declared reference(s) are not in this file, e.g. " + dead.slice(0, 2).join(", "));
  }
  const mediaPath = model.mediaPath || (registry.mediaRoot + "/" + model.file);
  items.push({ path: mediaPath, bytes: bytes, sha256: sha, contentType: "model/gltf-binary", store: "r2", modelId: model.id, title: model.title });
  const key = bucket + "/" + R2_PREFIX + mediaPath;
  ps.push('npx wrangler r2 object put "' + key + '" --file "' + file + '" --content-type model/gltf-binary --remote');
  sh.push("npx wrangler r2 object put '" + key + "' --file '" + file.replace(/'/g, "'\\''") + "' --content-type model/gltf-binary --remote");
}

/* Generated media: every file under --extra-media, published at its own relative path. */
function walk(dir, base) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs, base));
    else out.push({ file: abs, mediaPath: path.relative(base, abs).split(path.sep).join("/") });
  }
  return out;
}
const CONTENT_TYPES = { ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json", ".pdf": "application/pdf", ".glb": "model/gltf-binary" };
const extraFiles = extraMediaDirs.flatMap((dir) => walk(dir, dir));
const duplicates = extraFiles.map((e) => e.mediaPath).filter((p, i, all) => all.indexOf(p) !== i);
if (duplicates.length) {
  console.error("Duplicate media path(s) across --extra-media trees: " + Array.from(new Set(duplicates)).join(", "));
  process.exit(1);
}
if (extraFiles.length) report.push("");
for (const entry of extraFiles) {
  const bytes = fs.statSync(entry.file).size;
  const sha = sha256File(entry.file);
  const contentType = CONTENT_TYPES[path.extname(entry.file).toLowerCase()] || "application/octet-stream";
  totalBytes += bytes;
  report.push("ok".padEnd(12) + entry.mediaPath.padEnd(48) + String(bytes).padStart(10) + "  " + entry.file);
  items.push({ path: entry.mediaPath, bytes: bytes, sha256: sha, contentType: contentType, store: "r2", generated: true });
  const key = bucket + "/" + R2_PREFIX + entry.mediaPath;
  ps.push('npx wrangler r2 object put "' + key + '" --file "' + entry.file + '" --content-type ' + contentType + ' --remote');
  sh.push("npx wrangler r2 object put '" + key + "' --file '" + entry.file.replace(/'/g, "'\\''") + "' --content-type " + contentType + " --remote");
}

const index = {
  version: new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + crypto.createHash("sha256").update(items.map((i) => i.sha256).join("")).digest("hex").slice(0, 8),
  publishedAt: new Date().toISOString(),
  bucket: bucket,
  items: items
};
const indexText = JSON.stringify(index);
fs.writeFileSync(path.join(outDir, "media-index.json"), indexText);
report.unshift("Protected media build — " + (items.length - extraFiles.length) + " of " + registry.models.length + " models + " + extraFiles.length + " generated file(s), " + (totalBytes / 1e6).toFixed(1) + " MB, index " + index.version);
fs.writeFileSync(path.join(outDir, "media-report.txt"), report.join("\n") + "\n");
console.log(report.join("\n"));

/*
  A short index is not a partial success, it is a regression waiting to be
  uploaded.

  `webmedia:index` is replaced WHOLE. Publishing an index built from 16 of 21
  entries does not leave the other five alone - it removes them from the app's
  view, and their tiles report the model unavailable even though the objects
  are still sitting in R2. Warning about it and writing the publishable files
  anyway puts that one command away, which is how the flap stub shipped: the
  build said HASH-CHANGED and published it regardless.

  So the upload artifacts are written only when every registry entry was
  located. Stale ones from an earlier run are REMOVED rather than left behind,
  because a leftover kv-media-index.json next to a fresh report is worse than
  no file at all - it looks current and is not.

  --allow-missing is the deliberate escape hatch, for building a subset on
  purpose. `media-index.json` and the report are always written: they are what
  you read to find out what went wrong.
*/
const allowMissing = process.argv.includes("--allow-missing");
const publishable = [
  path.join(outDir, "kv-media-index.json"),
  path.join(outDir, "upload-media.ps1"),
  path.join(outDir, "upload-media.sh")
];

if (deadRefs.length && !allowMissing) {
  const removed = publishable.filter((file) => fs.existsSync(file));
  removed.forEach((file) => fs.rmSync(file));
  const total = deadRefs.reduce((n, entry) => n + entry.refs.length, 0);
  console.error("\n" + total + " declared reference(s) across " + deadRefs.length + " model(s) are not in the files — NOTHING WAS WRITTEN TO UPLOAD.");
  console.error("  Unlike a changed hash, this does not correct itself on publish: the Lab draws its pins and");
  console.error("  plays its animations from the registry, so a name the file has lost becomes a dot or a");
  console.error("  button that does nothing.");
  deadRefs.forEach((entry) => console.error("    " + entry.id.padEnd(24) + entry.refs.length + " dead: " + entry.refs.slice(0, 2).join(", ")));
  console.error("  Re-author those entries against the files first (tools/inspect-glb.mjs --json), or pass");
  console.error("  --allow-missing if you intend to publish them as they are.");
  if (removed.length) console.error("  Removed " + removed.length + " stale upload file(s) so they cannot be published by mistake.");
  console.error("\nOutput → " + outDir);
  process.exit(1);
}

if (missing && !allowMissing) {
  const removed = publishable.filter((file) => fs.existsSync(file));
  removed.forEach((file) => fs.rmSync(file));
  console.error("\n" + missing + " model(s) missing — NOTHING WAS WRITTEN TO UPLOAD.");
  console.error("  Publishing this index would drop those " + missing + " model(s) from the app: the KV key is");
  console.error("  replaced whole, so an entry that is not in the build is an entry the app can no longer see.");
  console.error("  Pass --reference and --android so every registry entry can be located, or --allow-missing");
  console.error("  if a partial publish is genuinely what you want.");
  if (removed.length) console.error("  Removed " + removed.length + " stale upload file(s) from an earlier run so they cannot be published by mistake.");
  if (mismatched) console.error("\n" + mismatched + " model(s) also differ from the registry hash.");
  console.error("\nOutput → " + outDir);
  process.exit(1);
}

fs.writeFileSync(path.join(outDir, "kv-media-index.json"), JSON.stringify([{ key: "webmedia:index", value: indexText }]));
ps.push("# Then publish the index: npx wrangler kv bulk put " + path.join(outDir, "kv-media-index.json") + " --binding LICENSES --remote");
sh.push("# Then publish the index: npx wrangler kv bulk put '" + path.join(outDir, "kv-media-index.json") + "' --binding LICENSES --remote");
fs.writeFileSync(path.join(outDir, "upload-media.ps1"), ps.join("\r\n") + "\r\n");
fs.writeFileSync(path.join(outDir, "upload-media.sh"), sh.join("\n") + "\n");
if (missing) console.warn("\n" + missing + " model(s) missing — published anyway because --allow-missing was given.");
if (mismatched) console.warn(mismatched + " model(s) differ from the registry hash — regenerate tools/data/systems-lab-models.json if the GLB files were re-exported.");
if (!extraFiles.length) console.warn("No generated media found in " + extraMediaDirs.join(", ") + " — run `node tools/build-cockpit.mjs --android <repo>` and `node tools/build-diagrams.mjs --android <repo>` first.");
console.log("\nOutput → " + outDir);
