#!/usr/bin/env node
/*
  Convert the Android system reference posters to WebP for the protected media
  bucket.

  Usage:
    node tools/build-posters.mjs --android "C:\Android Studio\DHC-6-Trainer" --out build/systems

  Input:
    <android>/core-res/src/main/assets/systems/posters/*      27 files, 26 MB

  Output (build/ is git-ignored — nothing here is committed):
    <out>/media/systems/posters/<name>.webp                   fed to build-media.mjs
    <out>/posters.json                                        the media paths, for build-content.mjs
    <out>/poster-report.txt

  Two things about the source files are worth knowing:

  * 12 of the 27 files carry a .png extension but are actually JPEG. Android's
    BitmapFactory sniffs the content so it never noticed; a browser would be
    served the wrong Content-Type. Converting everything to WebP removes the
    question.
  * SystemDetailScreen.systemDetailReferenceImages() asks for `.webp` paths that
    have never existed in the repository, which is why those reference images are
    blank on Android today. The web resolves each reference against what is
    really published — see tools/lib/systems-2d.mjs.

  Posters are served only through /api/media/<path> after the subscriber/owner
  session is verified. They are never committed to the public repository.
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
const postersDir = path.join(assetsRoot, "systems", "posters");
if (!fs.existsSync(postersDir)) {
  console.error("No posters directory at " + postersDir);
  process.exit(1);
}

const mediaDir = path.join(outDir, "media", "systems", "posters");
fs.mkdirSync(mediaDir, { recursive: true });

const files = fs.readdirSync(postersDir).filter((name) => /\.(png|jpe?g|webp)$/i.test(name)).sort();
const report = [];
const produced = [];
let sourceBytes = 0;
let outputBytes = 0;

for (const name of files) {
  const source = path.join(postersDir, name);
  const slug = name.replace(/\.(png|jpe?g|webp)$/i, "");
  const target = path.join(mediaDir, slug + ".webp");
  const input = fs.readFileSync(source);
  sourceBytes += input.length;
  const image = sharp(input, { limitInputPixels: 512 * 1024 * 1024 });
  const meta = await image.metadata();
  const resize = Math.max(meta.width || 0, meta.height || 0) > maxEdge
    ? { width: meta.width >= meta.height ? maxEdge : null, height: meta.height > meta.width ? maxEdge : null, fit: "inside", withoutEnlargement: true }
    : null;
  const pipeline = resize ? image.resize(resize) : image;
  const buffer = await pipeline.webp({ quality: quality, effort: 5 }).toBuffer();
  fs.writeFileSync(target, buffer);
  outputBytes += buffer.length;
  produced.push({
    mediaPath: "systems/posters/" + slug + ".webp",
    androidFile: "systems/posters/" + name,
    actualFormat: meta.format,
    width: meta.width,
    height: meta.height,
    sourceBytes: input.length,
    bytes: buffer.length
  });
  report.push(
    (meta.format === "jpeg" && /\.png$/i.test(name) ? "jpeg-as-png" : "ok").padEnd(12) +
    name.padEnd(50) +
    String(meta.width + "x" + meta.height).padStart(12) +
    String((input.length / 1024).toFixed(0) + " KB").padStart(10) + " ->" +
    String((buffer.length / 1024).toFixed(0) + " KB").padStart(10)
  );
}

fs.writeFileSync(path.join(outDir, "posters.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: "DHC-6-Trainer core-res/src/main/assets/systems/posters",
  mediaRoot: "systems/posters",
  posters: produced
}, null, 2));

const mislabelled = produced.filter((p) => p.actualFormat === "jpeg" && /\.png$/i.test(p.androidFile)).length;
report.unshift(
  "Poster build — " + produced.length + " file(s), " +
  (sourceBytes / 1e6).toFixed(1) + " MB -> " + (outputBytes / 1e6).toFixed(1) + " MB WebP" +
  " (max edge " + maxEdge + ", quality " + quality + ")"
);
fs.writeFileSync(path.join(outDir, "poster-report.txt"), report.join("\n") + "\n");
console.log(report.join("\n"));
if (mislabelled) console.log("\n" + mislabelled + " source file(s) are JPEG data with a .png extension in the Android repository.");
console.log("\nOutput -> " + outDir);
console.log("Next: node tools/build-media.mjs --android <repo> --extra-media \"build/cockpit/media," + path.join(outDir, "media") + "\"");
