#!/usr/bin/env node
/*
  Convert the Android reference imagery to WebP for the protected media bucket.

  Usage:
    node tools/build-diagrams.mjs --android "C:\Android Studio\DHC-6-Trainer" --out build/systems

  Two sources, both authoritative:

  1. `systems/posters/*` — the 27 system posters referenced by
     SystemDetailScreen.systemDetailReferenceImages().

  2. The Systems Lab reference figures, listed by
     `models/systems_lab/aircraft_variants/dhc6_reference_sections_manifest.json`.
     That manifest is the source of truth: five sections (aircraft dimensions,
     lifting/shoring, weight & balance, performance charts, cockpit instruments),
     each naming its model variants and its figures with the authored label. The
     figures are the reference material that belongs with those 3D model
     sections, and SystemDetailScreen maps each section onto a system tile.

  Output (build/ is git-ignored — nothing here is committed):
    <out>/media/<asset path>.webp        fed to build-media.mjs
    <out>/diagrams.json                  the media paths + labels, for build-content.mjs
    <out>/diagram-report.txt

  One thing to know about the sources: several poster files carry a .png
  extension but hold JPEG data. Android's BitmapFactory sniffs the content so it
  never noticed; a browser would be served the wrong Content-Type. Converting
  everything to WebP removes the question. The report names them.

  Everything here is served only through /api/media/<path> after the
  subscriber/owner session is verified. Nothing is committed to the public
  repository.
*/

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

function arg(name, fallback) {
  const index = process.argv.indexOf("--" + name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

const androidRoot = arg("android", process.env.DHC6_ANDROID_REPO || "");
const outDir = path.resolve(arg("out", "build/systems"));
const maxEdge = Number(arg("max-edge", "2200"));
const quality = Number(arg("quality", "82"));

if (!androidRoot) {
  console.error("Missing --android <path to DHC-6-Trainer repo> (or DHC6_ANDROID_REPO env var)");
  process.exit(1);
}

const assetsRoot = fs.existsSync(path.join(androidRoot, "core-res", "src", "main", "assets"))
  ? path.join(androidRoot, "core-res", "src", "main", "assets")
  : androidRoot;

const SECTIONS_MANIFEST = "models/systems_lab/aircraft_variants/dhc6_reference_sections_manifest.json";

/* Every image to convert: { assetPath, label, group }. */
function collectSources() {
  const items = [];
  const seen = new Set();

  function add(assetPath, label, group) {
    const key = assetPath.replace(/\\/g, "/");
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ assetPath: key, label: label, group: group });
  }

  const postersDir = path.join(assetsRoot, "systems", "posters");
  if (fs.existsSync(postersDir)) {
    for (const name of fs.readdirSync(postersDir).filter((n) => /\.(png|jpe?g|webp)$/i.test(n)).sort()) {
      add("systems/posters/" + name, name.replace(/\.[^.]+$/, "").replace(/_/g, " "), "poster");
    }
  } else {
    console.warn("No systems/posters directory under " + assetsRoot);
  }

  const manifestFile = path.join(assetsRoot, SECTIONS_MANIFEST);
  if (fs.existsSync(manifestFile)) {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    for (const [sectionId, section] of Object.entries(manifest.sections || {})) {
      for (const ref of section.references || []) {
        if (!ref || !ref.assetPath) continue;
        add(ref.assetPath, ref.label || path.basename(ref.assetPath), "section:" + sectionId);
      }
    }
  } else {
    console.warn("No " + SECTIONS_MANIFEST + " under " + assetsRoot + " — the Systems Lab reference figures will not be published.");
  }

  return items;
}

const sources = collectSources();
if (!sources.length) {
  console.error("Nothing to convert. Check --android points at the DHC-6-Trainer repository.");
  process.exit(1);
}

const report = [];
const produced = [];
const missing = [];
let sourceBytes = 0;
let outputBytes = 0;

for (const item of sources) {
  const source = path.join(assetsRoot, item.assetPath);
  if (!fs.existsSync(source)) {
    missing.push(item.assetPath);
    report.push("MISSING".padEnd(12) + item.assetPath);
    continue;
  }
  const mediaPath = item.assetPath.replace(/\.(png|jpe?g|webp)$/i, ".webp");
  const target = path.join(outDir, "media", mediaPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });

  const input = fs.readFileSync(source);
  sourceBytes += input.length;
  const image = sharp(input, { limitInputPixels: 512 * 1024 * 1024 });
  const meta = await image.metadata();
  const resize = Math.max(meta.width || 0, meta.height || 0) > maxEdge
    ? { width: meta.width >= meta.height ? maxEdge : null, height: meta.height > meta.width ? maxEdge : null, fit: "inside", withoutEnlargement: true }
    : null;
  const buffer = await (resize ? image.resize(resize) : image).webp({ quality: quality, effort: 5 }).toBuffer();
  fs.writeFileSync(target, buffer);
  outputBytes += buffer.length;

  const mislabelled = meta.format === "jpeg" && /\.png$/i.test(item.assetPath);
  produced.push({
    mediaPath: mediaPath,
    androidPath: item.assetPath,
    label: item.label,
    group: item.group,
    actualFormat: meta.format,
    width: meta.width,
    height: meta.height,
    sourceBytes: input.length,
    bytes: buffer.length
  });
  report.push(
    (mislabelled ? "jpeg-as-png" : "ok").padEnd(12) +
    item.assetPath.padEnd(72) +
    String(meta.width + "x" + meta.height).padStart(12) +
    String((input.length / 1024).toFixed(0) + " KB").padStart(10) + " ->" +
    String((buffer.length / 1024).toFixed(0) + " KB").padStart(10)
  );
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "diagrams.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: "DHC-6-Trainer core-res/src/main/assets (systems/posters + " + SECTIONS_MANIFEST + ")",
  diagrams: produced
}, null, 2));

const posters = produced.filter((p) => p.group === "poster").length;
const figures = produced.length - posters;
const mislabelledCount = produced.filter((p) => p.actualFormat === "jpeg" && /\.png$/i.test(p.androidPath)).length;
report.unshift(
  "Diagram build — " + produced.length + " file(s) (" + posters + " posters, " + figures + " Systems Lab figures), " +
  (sourceBytes / 1e6).toFixed(1) + " MB -> " + (outputBytes / 1e6).toFixed(1) + " MB WebP" +
  " (max edge " + maxEdge + ", quality " + quality + ")"
);
fs.writeFileSync(path.join(outDir, "diagram-report.txt"), report.join("\n") + "\n");
console.log(report.join("\n"));
if (mislabelledCount) console.log("\n" + mislabelledCount + " source file(s) are JPEG data with a .png extension in the Android repository.");
if (missing.length) console.warn("\n" + missing.length + " file(s) listed by the manifest are not on disk:\n  " + missing.join("\n  "));
console.log("\nOutput -> " + outDir);
console.log("Next: node tools/build-media.mjs --android <repo> --extra-media \"build/cockpit/media," + path.join(outDir, "media") + "\"");
