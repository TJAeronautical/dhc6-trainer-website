/*
  The media build, and the one thing it must never do quietly.

  `webmedia:index` is replaced WHOLE. An index built from 16 of 21 registry
  entries does not leave the other five alone - it removes them from the app's
  view, and their tiles report the model unavailable while the objects sit
  untouched in R2.

  Until this, the build warned about missing models and wrote the publishable
  files regardless, which put that outcome one command away. It is the same
  shape as the incident that put a 243 KB Android stub on the flap tile for
  weeks: the build said HASH-CHANGED and published it anyway.
*/

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registry = JSON.parse(fs.readFileSync(path.join(root, "tools", "data", "systems-lab-models.json"), "utf8"));

const UPLOADABLE = ["kv-media-index.json", "upload-media.ps1", "upload-media.sh"];

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dhc6-media-"));
  const ref = path.join(dir, "ref");
  const out = path.join(dir, "out");
  fs.mkdirSync(ref);
  /* Content does not matter here - only whether the file is locatable. The
     hash check is a separate concern and is allowed to disagree. */
  registry.models.forEach((model) => fs.writeFileSync(path.join(ref, model.file), "not a real glb"));
  return { dir, ref, out };
}

function build(ws, extra) {
  return spawnSync(process.execPath, [
    path.join(root, "tools", "build-media.mjs"),
    "--reference", ws.ref, "--out", ws.out,
    /*
      A directory that does not exist, NOT "".

      arg() returns its fallback for any falsy value, so `--extra-media ""`
      reads as "flag absent" and silently uses the default build/cockpit/media.
      This test first shipped that way: it counted whatever generated media
      happened to exist on the machine, so it passed on a checkout with no
      cockpit build and failed on one with one. Naming a path that is really
      empty is what makes the count the same everywhere.
    */
    "--extra-media", path.join(ws.dir, "no-generated-media")
  ].concat(extra || []), { encoding: "utf8" });
}

/* The models only. Generated media rides in the same index and is not what
   these assertions are about. */
function modelItems(ws) {
  const kv = JSON.parse(fs.readFileSync(path.join(ws.out, "kv-media-index.json"), "utf8"));
  return JSON.parse(kv[0].value).items.filter((item) => !item.generated);
}

function present(ws) {
  return UPLOADABLE.filter((name) => fs.existsSync(path.join(ws.out, name)));
}

test("a complete build writes the files you upload", () => {
  const ws = workspace();
  try {
    const result = build(ws);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(present(ws).sort(), UPLOADABLE.slice().sort());
    const kv = JSON.parse(fs.readFileSync(path.join(ws.out, "kv-media-index.json"), "utf8"));
    assert.equal(kv[0].key, "webmedia:index");
    assert.equal(modelItems(ws).length, registry.models.length);
  } finally { fs.rmSync(ws.dir, { recursive: true, force: true }); }
});

test("generated media rides along without changing the model count", () => {
  /*
    The regression guard for this file's own first bug. These tests are about
    registry entries; the cockpit plates and atlases land in the same index and
    must not be able to move a model assertion. Run it against a tree that
    really has generated files in it, which is the shape that caught it.
  */
  const ws = workspace();
  try {
    const extra = path.join(ws.dir, "generated");
    fs.mkdirSync(path.join(extra, "cockpit", "atlas"), { recursive: true });
    fs.writeFileSync(path.join(extra, "cockpit", "atlas", "g950.webp"), "x");
    fs.writeFileSync(path.join(extra, "cockpit", "atlas", "legacy.webp"), "x");

    const result = spawnSync(process.execPath, [
      path.join(root, "tools", "build-media.mjs"),
      "--reference", ws.ref, "--out", ws.out, "--extra-media", extra
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);

    assert.equal(modelItems(ws).length, registry.models.length, "generated files must not be counted as models");
    const kv = JSON.parse(fs.readFileSync(path.join(ws.out, "kv-media-index.json"), "utf8"));
    const all = JSON.parse(kv[0].value).items;
    assert.equal(all.length, registry.models.length + 2, "and they must still be published");
    assert.ok(all.some((i) => i.path === "cockpit/atlas/g950.webp" && i.generated === true));
  } finally { fs.rmSync(ws.dir, { recursive: true, force: true }); }
});

test("a model it cannot find stops the upload rather than shrinking the index", () => {
  const ws = workspace();
  try {
    fs.rmSync(path.join(ws.ref, "DHC6SKIS.glb"));
    const result = build(ws);
    assert.equal(result.status, 1, "a build that would drop a model must fail, not warn");
    assert.deepEqual(present(ws), [], "nothing publishable may be left behind");
    assert.match(result.stderr, /NOTHING WAS WRITTEN TO UPLOAD/);
    assert.match(result.stderr, /replaced whole|no longer see/, "it must say WHY a short index is dangerous");
  } finally { fs.rmSync(ws.dir, { recursive: true, force: true }); }
});

test("a stale upload from an earlier good run is removed, not left looking current", () => {
  /*
    The trap this closes: build succeeds, you walk away; later you rebuild with
    a folder that has moved, the build fails - and the previous run's
    kv-media-index.json is still sitting next to a fresh report, indistinguishable
    from a current one.
  */
  const ws = workspace();
  try {
    assert.equal(build(ws).status, 0);
    const before = fs.readFileSync(path.join(ws.out, "kv-media-index.json"), "utf8");
    assert.ok(before.length > 0);

    fs.rmSync(path.join(ws.ref, "DHC6SKIS.glb"));
    const second = build(ws);
    assert.equal(second.status, 1);
    assert.deepEqual(present(ws), [], "the previous run's upload files must not survive a failed one");
    assert.match(second.stderr, /stale upload file/);
  } finally { fs.rmSync(ws.dir, { recursive: true, force: true }); }
});

test("--allow-missing is the deliberate way to publish a subset", () => {
  const ws = workspace();
  try {
    fs.rmSync(path.join(ws.ref, "DHC6SKIS.glb"));
    const result = build(ws, ["--allow-missing"]);
    assert.equal(result.status, 0);
    assert.deepEqual(present(ws).sort(), UPLOADABLE.slice().sort());
    assert.match(result.stderr, /published anyway because --allow-missing/);
    assert.equal(modelItems(ws).length, registry.models.length - 1);
  } finally { fs.rmSync(ws.dir, { recursive: true, force: true }); }
});

test("the report and the index are always written, because they are what you read", () => {
  const ws = workspace();
  try {
    fs.rmSync(path.join(ws.ref, "DHC6SKIS.glb"));
    assert.equal(build(ws).status, 1);
    const report = fs.readFileSync(path.join(ws.out, "media-report.txt"), "utf8");
    assert.match(report, /MISSING\s+DHC6SKIS\.glb/, "the report must name what was not found");
    assert.ok(fs.existsSync(path.join(ws.out, "media-index.json")), "the index stays for inspection; it is just not packaged for upload");
  } finally { fs.rmSync(ws.dir, { recursive: true, force: true }); }
});

test("a hash that changed is a warning, not a block", () => {
  /*
    A re-exported model still uploads coherently: the index records the FILE's
    sha, not the registry's. Blocking on it would stop exactly the publish that
    fixes it.
  */
  const ws = workspace();
  try {
    const result = build(ws);
    assert.equal(result.status, 0);
    assert.match(result.stderr, /differ from the registry hash/);
    const declared = new Set(registry.models.map((m) => m.sha256));
    assert.ok(modelItems(ws).every((i) => !declared.has(i.sha256)), "the index carries the measured hash, never the declared one");
  } finally { fs.rmSync(ws.dir, { recursive: true, force: true }); }
});
