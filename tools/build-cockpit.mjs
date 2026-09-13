#!/usr/bin/env node
/*
  Build the cockpit pack + imagery for the AIRCRAFT tab.

  Usage:
    node tools/build-cockpit.mjs --android "C:\Android Studio\DHC-6-Trainer" ^
                                 [--kotlin "C:\Android Studio\DHC-6-Trainer\_web_export"] ^
                                 [--out build\cockpit]

  Reads the Android cockpit assets (plates, hitboxes, source_exact sprite families)
  and writes, into <out>:
    cockpit-pack.json      the `cockpit-plates` content pack (geometry only, no imagery)
    media/cockpit/**       the plate and sprite atlas for each variant (WebP)
    cockpit-report.txt     what was resolved, what was skipped, and the sizes

  `node tools/build-content.mjs` picks up cockpit-pack.json automatically and
  `node tools/build-media.mjs` picks up media/ automatically when --out is left at
  the default, so the normal publish is:

    node tools/build-cockpit.mjs --android <repo>
    node tools/build-content.mjs --android <repo> --kotlin <export> --out build\content
    node tools/build-media.mjs   --android <repo> --reference <library> --out build\media

  This step needs the `sharp` image library (npm install sharp).
*/
import fs from "node:fs";
import path from "node:path";
import { buildCockpitPack, resolveCockpitRoot, loadSharp } from "./lib/cockpit-pack.mjs";

function arg(name, fallback) {
  const index = process.argv.indexOf("--" + name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

const androidRoot = arg("android", process.env.DHC6_ANDROID_REPO || "");
const kotlinRoot = arg("kotlin", "");
const outDir = path.resolve(arg("out", "build/cockpit"));

const candidates = [];
if (kotlinRoot) candidates.push(path.join(kotlinRoot, "assets_cockpit"));
if (androidRoot) {
  candidates.push(path.join(androidRoot, "_web_export", "assets_cockpit"));
  candidates.push(path.join(androidRoot, "core-res", "src", "main", "assets", "cockpit"));
  candidates.push(path.join(androidRoot, "core-res", "src", "main", "assets"));
}
candidates.push(arg("cockpit", ""));

const cockpitRoot = resolveCockpitRoot(candidates.filter(Boolean));
if (!cockpitRoot) {
  console.error("Could not find the cockpit assets. Pass --android <DHC-6-Trainer repo> (it looks for\n" +
    "  <repo>/_web_export/assets_cockpit  or  <repo>/core-res/src/main/assets/cockpit).");
  process.exit(1);
}

const sharp = await loadSharp();
console.log("Cockpit assets → " + cockpitRoot);
const built = await buildCockpitPack({ cockpitRoot: cockpitRoot, sharp: sharp });

fs.mkdirSync(outDir, { recursive: true });
const packText = JSON.stringify(built.pack);
fs.writeFileSync(path.join(outDir, "cockpit-pack.json"), packText);

const report = [];
let mediaBytes = 0;
for (const item of built.media) {
  const target = path.join(outDir, "media", item.path);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, item.buffer);
  mediaBytes += item.buffer.length;
  report.push(String(item.buffer.length).padStart(10) + "  " + item.path + "  (" + item.label + ")");
}

for (const variant of Object.keys(built.pack.variants)) {
  const v = built.pack.variants[variant];
  report.push(variant.padEnd(8) + " hitboxes=" + String(v.hitboxes.length).padStart(3) +
    "  sprites=" + String(Object.keys(v.sprites).length).padStart(3) +
    "  instruments=" + String(Object.keys(v.instruments).length).padStart(3) +
    "  annunciators=" + String(Object.keys(v.annunciators).length).padStart(3) +
    "  atlas=" + v.atlas.width + "x" + v.atlas.height +
    "  plate=" + v.plate.pixelWidth + "x" + v.plate.pixelHeight + " (canonical " + v.plate.width + "x" + v.plate.height + ")");
  v.skipped.forEach((s) => report.push("  skipped " + s.id + " (" + s.family + ": " + s.reason + ")"));
}
report.unshift("Cockpit build — pack " + (packText.length / 1024).toFixed(1) + " KB, media " + (mediaBytes / 1e6).toFixed(2) + " MB");
fs.writeFileSync(path.join(outDir, "cockpit-report.txt"), report.join("\n") + "\n");
console.log(report.join("\n"));
console.log("\nOutput → " + outDir);
