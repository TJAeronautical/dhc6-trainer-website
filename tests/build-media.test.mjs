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
import { selectorMatches } from "../app/js/logic/systemslab.js";

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

/* ------------------------------------------- clips the file no longer has */

/*
  The guard that matters once a re-exported library is in hand. A stale hash
  corrects itself on publish; a stale CLIP NAME does not, because the Lab plays
  animations from the registry's list. Publishing hydraulic-pack while it still
  declared 82 clips against a file with 1 would have put eighty-one dead
  buttons in front of a pilot.
*/

/*
  Node names that satisfy every pin a model declares, or null when a selector
  cannot be satisfied by construction. The guard now checks pins as well as
  clips, so a fixture that supplies clips and no nodes is a file with every pin
  dead - which is exactly what the guard should refuse, and not what the clip
  tests are about.

  Each candidate is checked with the app's own matcher rather than assumed:
  a fixture that quietly fails to satisfy a selector would turn these into
  tests of the guard again.
*/
function satisfyingNodes(model) {
  const selectors = [].concat(
    ...Object.values(model.parts || {}),
    ...(model.extraParts || []).map((e) => e.selectors || [])
  );
  const names = [];
  for (const selector of selectors) {
    let candidate;
    if (selector[0] === "~") {
      candidate = selector.slice(1)
        .replace(/^\^/, "").replace(/\$$/, "")
        .replace(/\\\./g, ".")
        .replace(/\[0-9\]/g, "0")
        .replace(/\[[^\]]*\]/g, "A")
        .replace(/[*+?()|]/g, "");
    } else {
      candidate = selector.replace(/^=/, "");
    }
    if (!selectorMatches(selector, candidate)) return null;
    names.push(candidate);
  }
  return names;
}

function glbWithClips(names, nodeNames) {
  const gltf = {
    asset: { version: "2.0" },
    animations: names.map((n) => ({ name: n })),
    nodes: (nodeNames || []).map((n) => ({ name: n }))
  };
  const json = Buffer.from(JSON.stringify(gltf), "utf8");
  const pad = (4 - (json.length % 4)) % 4;
  const jsonLen = json.length + pad;
  const out = Buffer.alloc(12 + 8 + jsonLen, 0x20);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(jsonLen, 12); out.writeUInt32LE(0x4e4f534a, 16);
  json.copy(out, 20);
  return out;
}

test("a declared clip the file has lost stops the upload", () => {
  const ws = workspace();
  try {
    const model = registry.models.find((m) => (m.animations || []).length);
    assert.ok(model, "the shipped registry must have an entry that declares clips");
    /* The file keeps one real clip and loses the rest - the exact shape of the
       re-export, not an empty file. */
    const nodes = satisfyingNodes(model) || [];
    fs.writeFileSync(path.join(ws.ref, model.file), glbWithClips([model.animations[0], "SOMETHING_ELSE"], nodes));

    const result = build(ws);
    if (model.animations.length < 2) return;   /* nothing was actually lost */
    assert.equal(result.status, 1, "a build that would publish a dead button must fail");
    assert.deepEqual(present(ws), [], "nothing publishable may be left behind");
    assert.match(result.stderr, /NOTHING WAS WRITTEN TO UPLOAD/);
    assert.match(result.stderr, /does not correct itself on publish/, "it must say why this differs from a hash change");
    assert.match(result.stderr, new RegExp(model.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally { fs.rmSync(ws.dir, { recursive: true, force: true }); }
});

test("a file that has every declared clip publishes normally", () => {
  const ws = workspace();
  try {
    let written = 0;
    registry.models.forEach((model) => {
      if (!(model.animations || []).length) return;
      const nodes = satisfyingNodes(model);
      if (!nodes) return;          /* left unparseable, which the guard ignores */
      fs.writeFileSync(path.join(ws.ref, model.file), glbWithClips(model.animations, nodes));
      written += 1;
    });
    assert.ok(written > 0, "the registry must have a clip-declaring entry this fixture can satisfy");
    const result = build(ws);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(present(ws).sort(), UPLOADABLE.slice().sort());
  } finally { fs.rmSync(ws.dir, { recursive: true, force: true }); }
});

test("--allow-missing also covers a deliberate publish of reduced clips", () => {
  const ws = workspace();
  try {
    const model = registry.models.find((m) => (m.animations || []).length > 1);
    fs.writeFileSync(path.join(ws.ref, model.file), glbWithClips([model.animations[0]], satisfyingNodes(model) || []));
    const result = build(ws, ["--allow-missing"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(present(ws).sort(), UPLOADABLE.slice().sort());
  } finally { fs.rmSync(ws.dir, { recursive: true, force: true }); }
});

test("an entry that declares no clips is never reported as having lost any", () => {
  const ws = workspace();
  try {
    /* Most entries declare nothing; a file full of clips they never named is
       not a fault, and must not block a publish. */
    let written = 0;
    registry.models.forEach((model) => {
      if ((model.animations || []).length) return;
      const nodes = satisfyingNodes(model);
      if (!nodes) return;
      fs.writeFileSync(path.join(ws.ref, model.file), glbWithClips(["UNDECLARED_A", "UNDECLARED_B"], nodes));
      written += 1;
    });
    assert.ok(written > 0, "the registry must have a clipless entry this fixture can satisfy");
    assert.equal(build(ws).status, 0);
  } finally { fs.rmSync(ws.dir, { recursive: true, force: true }); }
});

test("a pin that resolves to nothing stops the upload too", () => {
  /*
    Same failure as a dead clip, wearing a different hat: a `parts` selector
    that finds no node is a dot a pilot can tap that does nothing. The guard
    covers both because publishing is what makes either one live.
  */
  const ws = workspace();
  try {
    const model = registry.models.find((m) => Object.values(m.parts || {}).some((list) => list.length));
    assert.ok(model, "the shipped registry must have an entry with pins");
    /* Every clip it declares, and none of the nodes its pins name. */
    fs.writeFileSync(path.join(ws.ref, model.file), glbWithClips(model.animations || [], ["NOTHING_MATCHES_THIS"]));

    const result = build(ws);
    assert.equal(result.status, 1, "a build that would publish a dead pin must fail");
    assert.deepEqual(present(ws), [], "nothing publishable may be left behind");
    assert.match(result.stderr, /parts\.|extraParts\[/, "the message must name where the dead pin lives");
  } finally { fs.rmSync(ws.dir, { recursive: true, force: true }); }
});

test("a hygiene rule with nothing left to hide never blocks a publish", () => {
  /*
    The distinction phase 52 established, now load-bearing: `hidden` exists to
    drop archive and donor geometry, so a rule that matches nothing means the
    export got cleaner. Blocking on it would stop every publish after a tidy-up.
  */
  const ws = workspace();
  try {
    const model = registry.models.find((m) => (m.hidden || []).length && !Object.values(m.parts || {}).some((l) => l.length));
    if (!model) return;   /* no such entry shipped; nothing to prove here */
    fs.writeFileSync(path.join(ws.ref, model.file), glbWithClips(model.animations || [], ["NOTHING_MATCHES_THIS"]));
    assert.equal(build(ws).status, 0, "a dead hidden rule is not a fault");
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
