/*
  Reading a GLB well enough to author a registry entry from it.

  The defect that motivated this: the flap entry claimed 187 nodes and 1.4 MB
  while pointing at a 243 KB Android stub, for weeks, because nothing could
  compare the declared numbers with the file. A measurement nobody can take is
  a number nobody can check.
*/

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  GLB_MAGIC, CHUNK_JSON, CHUNK_BIN,
  parseGlb, gltfJson, trianglesIn, summarise, rootNodeNames, reconcile, samePath, isDirectRun
} from "../tools/inspect-glb.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* Build a GLB by hand so the parser is tested against the format, not against
   a fixture somebody generated with the same assumptions. */
function glb(gltf, options) {
  const opts = options || {};
  const json = new TextEncoder().encode(JSON.stringify(gltf));
  const pad = (4 - (json.length % 4)) % 4;
  const jsonLen = json.length + pad;
  const bin = opts.bin || new Uint8Array(0);
  const binPad = bin.length ? (4 - (bin.length % 4)) % 4 : 0;
  const binBlock = bin.length ? 8 + bin.length + binPad : 0;

  const total = 12 + 8 + jsonLen + binBlock;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, opts.version === undefined ? 2 : opts.version, true);
  view.setUint32(8, opts.declaredLength === undefined ? total : opts.declaredLength, true);
  view.setUint32(12, jsonLen, true);
  view.setUint32(16, CHUNK_JSON, true);
  out.set(json, 20);
  out.fill(0x20, 20 + json.length, 20 + jsonLen);
  if (bin.length) {
    const at = 20 + jsonLen;
    view.setUint32(at, bin.length + binPad, true);
    view.setUint32(at + 4, CHUNK_BIN, true);
    out.set(bin, at + 8);
  }
  return out;
}

const SIMPLE = {
  asset: { version: "2.0" },
  nodes: [
    { name: "ROOT_ASSEMBLY", children: [1, 2] },
    { name: "ACTUATOR_HOUSING", mesh: 0 },
    { name: "POPPET_04", mesh: 1 },
    { name: "SRCFOWLER__PILOT_HEAD" }
  ],
  meshes: [
    { primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] },
    { primitives: [{ attributes: { POSITION: 0 } }] }
  ],
  accessors: [{ count: 30 }, { count: 90 }],
  animations: [{ name: "FLAPS_DOWN" }, {}]
};

/* ------------------------------------------------------------------ parsing */

test("a GLB is walked chunk by chunk, and a broken one says why", () => {
  const parsed = parseGlb(glb(SIMPLE));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.version, 2);
  assert.equal(parsed.chunks[0].type, CHUNK_JSON);

  assert.equal(parseGlb(new Uint8Array(4)).ok, false);
  assert.match(parseGlb(new Uint8Array(4)).reason, /shorter than/);
  const notGlb = new Uint8Array(32);
  assert.match(parseGlb(notGlb).reason, /bad magic/);
});

test("a chunk that runs past the end is refused, not read anyway", () => {
  const bytes = glb(SIMPLE);
  new DataView(bytes.buffer).setUint32(12, 10 ** 6, true);   /* absurd JSON length */
  const parsed = parseGlb(bytes);
  assert.equal(parsed.ok, false);
  assert.match(parsed.reason, /past the end/);
});

test("the JSON chunk is found and parsed, and junk is reported", () => {
  assert.equal(gltfJson(glb(SIMPLE)).gltf.nodes.length, 4);

  /* A GLB whose JSON chunk is not JSON. */
  const bad = glb(SIMPLE);
  bad[20] = 0x7b; bad[21] = 0x7b;                            /* "{{" */
  assert.match(gltfJson(bad).reason, /not valid JSON/);

  /* A GLB with a BIN chunk and no JSON chunk at all. */
  const view = new DataView(glb(SIMPLE).buffer);
  const onlyBin = glb(SIMPLE);
  new DataView(onlyBin.buffer).setUint32(16, CHUNK_BIN, true);
  assert.match(gltfJson(onlyBin).reason, /no JSON chunk/);
  assert.ok(view);
});

/* ------------------------------------------------------------- measurement */

test("triangles are counted the way a renderer would", () => {
  /* Indexed: 90 indices / 3. Unindexed: 30 positions / 3. */
  assert.equal(trianglesIn(SIMPLE), 30 + 10);

  /* Strips and fans: n vertices make n-2 triangles. */
  assert.equal(trianglesIn({ meshes: [{ primitives: [{ mode: 5, indices: 0 }] }], accessors: [{ count: 10 }] }), 8);
  assert.equal(trianglesIn({ meshes: [{ primitives: [{ mode: 6, indices: 0 }] }], accessors: [{ count: 10 }] }), 8);

  /* Points and lines are not triangles, and neither is a degenerate count. */
  assert.equal(trianglesIn({ meshes: [{ primitives: [{ mode: 0, indices: 0 }] }], accessors: [{ count: 99 }] }), 0);
  assert.equal(trianglesIn({ meshes: [{ primitives: [{ indices: 0 }] }], accessors: [{ count: 2 }] }), 0);
  assert.equal(trianglesIn({}), 0);
});

test("the summary is the six numbers a registry entry needs", () => {
  const summary = summarise(glb(SIMPLE));
  assert.equal(summary.ok, true);
  assert.equal(summary.nodes, 4);
  assert.equal(summary.meshes, 2);
  assert.equal(summary.triangles, 40);
  assert.deepEqual(summary.animations, ["FLAPS_DOWN", "(unnamed 1)"]);
  assert.ok(summary.bytes > 0);
});

test("node names come out, because selectors are node names", () => {
  const summary = summarise(glb(SIMPLE));
  assert.ok(summary.nodeNames.includes("ACTUATOR_HOUSING"));
  assert.ok(summary.nodeNames.includes("SRCFOWLER__PILOT_HEAD"), "donor nodes must be visible, that is the point");
  /* Roots only: the short list somebody actually reads. ROOT_ASSEMBLY has
     children; the donor head has no parent, so it is a root too. */
  assert.deepEqual(summary.rootNames.sort(), ["ROOT_ASSEMBLY", "SRCFOWLER__PILOT_HEAD"]);
  assert.deepEqual(rootNodeNames({ nodes: [] }), []);
  assert.deepEqual(rootNodeNames({}), []);
});

test("an unnamed node is numbered rather than dropped", () => {
  const summary = summarise(glb({ asset: { version: "2.0" }, nodes: [{}, { name: "NAMED" }] }));
  assert.deepEqual(summary.nodeNames, ["(unnamed 0)", "NAMED"]);
});

test("bytes beyond the declared length are surfaced, not silently trimmed", () => {
  /* Our own watermark bumps the header, so a difference means something else
     appended to the file - worth seeing rather than averaging away. */
  const bytes = glb(SIMPLE, { declaredLength: 32 });
  const summary = summarise(bytes);
  assert.equal(summary.trailingBytes, bytes.byteLength - 32);
  assert.equal(summarise(glb(SIMPLE)).trailingBytes, 0);
});

/* ---------------------------------------------------------- reconciliation */

const REGISTRY = {
  version: 2,
  models: [
    { id: "flap-system", file: "FLAP.glb", bytes: 1404788, sha256: "a".repeat(64), nodes: 187, meshes: 167, triangles: 42816 },
    { id: "trim-control", file: "GONE.glb", bytes: 10, sha256: "b".repeat(64), nodes: 1, meshes: 1, triangles: 1 }
  ]
};

test("a registry entry pointing at a file that is not there is named", () => {
  const result = reconcile(REGISTRY, { "FLAP.glb": Object.assign(summarise(glb(SIMPLE)), { sha256: "a".repeat(64) }) });
  assert.deepEqual(result.missing, [{ id: "trim-control", file: "GONE.glb" }]);
});

test("a file in the library that no entry uses is named", () => {
  const measured = {
    "FLAP.glb": Object.assign(summarise(glb(SIMPLE)), { sha256: "a".repeat(64) }),
    "DHC6_FULL_AIRCRAFT_REPLICA.glb": Object.assign(summarise(glb(SIMPLE)), { sha256: "c".repeat(64) })
  };
  assert.deepEqual(reconcile(REGISTRY, measured).unused, ["DHC6_FULL_AIRCRAFT_REPLICA.glb"]);
});

test("declared numbers that the file disagrees with are named, field by field", () => {
  /*
    This is the check that would have caught the flap stub on its own: the entry
    claimed 187 nodes and 1.4 MB, and the file it resolved to had neither.
  */
  const measured = { "FLAP.glb": Object.assign(summarise(glb(SIMPLE)), { sha256: "zzz" }) };
  const result = reconcile(REGISTRY, measured);
  const flap = result.mismatch.find(function (m) { return m.id === "flap-system"; });
  assert.ok(flap, "a wrong entry must be reported");
  const fields = flap.fields.map(function (f) { return f.field; }).sort();
  assert.deepEqual(fields, ["bytes", "meshes", "nodes", "sha256", "triangles"]);
  const nodes = flap.fields.find(function (f) { return f.field === "nodes"; });
  assert.equal(nodes.declared, 187);
  assert.equal(nodes.actual, 4);
});

test("an entry that matches its file is not reported", () => {
  const summary = summarise(glb(SIMPLE));
  const registry = { version: 2, models: [{
    id: "ok", file: "OK.glb",
    bytes: summary.bytes, sha256: "d".repeat(64),
    nodes: summary.nodes, meshes: summary.meshes, triangles: summary.triangles
  }] };
  const result = reconcile(registry, { "OK.glb": Object.assign({}, summary, { sha256: "d".repeat(64) }) });
  assert.deepEqual(result, { missing: [], unused: [], mismatch: [] });
});

test("an unreadable file is skipped rather than reported as a mismatch", () => {
  /*
    The shape that makes this more than decoration: a caller that kept the
    previous measurement and merged a FAILED re-read over it, so `ok` is false
    while stale numbers are still present. Comparing those would report a
    mismatch against a file nothing could actually read - a confident claim
    built on a measurement that did not happen.

    An earlier version of this test passed an {ok:false} with no numbers at
    all, which the field-by-field undefined check already skipped. It could not
    fail, so it was not testing the guard.
  */
  const stale = { ok: false, reason: "not a GLB (bad magic)", bytes: 999, nodes: 3, meshes: 2, triangles: 7, sha256: "e".repeat(64) };
  const result = reconcile(REGISTRY, { "FLAP.glb": stale });
  assert.deepEqual(result.mismatch, [], "nothing is known about it, so nothing is claimed");
  assert.deepEqual(result.missing, [{ id: "trim-control", file: "GONE.glb" }]);
});

/* -------------------------------------------------------------------- cli */

test("the entry guard survives a Windows path", () => {
  assert.equal(isDirectRun(
    "C:\\Android Studio\\dhc6-trainer-website\\tools\\inspect-glb.mjs",
    "file:///C:/Android%20Studio/dhc6-trainer-website/tools/inspect-glb.mjs"
  ), true);
  assert.equal(samePath("C:\\a b\\c.mjs", "/C:/a%20b/c.mjs"), true);
  assert.equal(isDirectRun("/other/file.mjs", "file:///tools/inspect-glb.mjs"), false);
  assert.equal(isDirectRun(undefined, "file:///x.mjs"), false);
});

test("run with nothing to read, it says what it wants instead of guessing", () => {
  const result = spawnSync(process.execPath, [path.join(root, "tools", "inspect-glb.mjs")], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--dir/);
  assert.match(result.stderr, /--file/);
});

test("it reads a real directory and writes nothing to it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "glb-"));
  try {
    fs.writeFileSync(path.join(dir, "MODEL.glb"), glb(SIMPLE));
    fs.writeFileSync(path.join(dir, "NOTES.txt"), "ignored");
    const before = fs.readdirSync(dir).sort();

    const result = spawnSync(process.execPath, [path.join(root, "tools", "inspect-glb.mjs"), "--dir", dir], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /MODEL\.glb/);
    assert.match(result.stdout, /nodes\s+4/);
    assert.doesNotMatch(result.stdout, /NOTES\.txt/, "only .glb files are read");

    assert.deepEqual(fs.readdirSync(dir).sort(), before, "the tool must never write into the library");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a directory with no models says so rather than reporting success", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "glb-empty-"));
  try {
    const result = spawnSync(process.execPath, [path.join(root, "tools", "inspect-glb.mjs"), "--dir", dir], { encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /No \.glb files/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the shipped registry's own numbers are the shape this reads", () => {
  /* Guards against the registry gaining a field spelling reconcile() does not
     compare - a mismatch nobody is told about is the original defect. */
  const registry = JSON.parse(fs.readFileSync(path.join(root, "tools", "data", "systems-lab-models.json"), "utf8"));
  const compared = ["bytes", "sha256", "nodes", "meshes", "triangles", "animations"];
  registry.models.forEach(function (model) {
    compared.forEach(function (field) {
      assert.ok(Object.prototype.hasOwnProperty.call(model, field),
        model.id + " has no " + field + ", so nothing can check it against the file");
    });
  });
});

/* ------------------------------------------------------ selector resolution */

/*
  The question a re-exported library actually raises. Bytes changing is
  expected — somebody re-exported. What the numbers cannot tell you is whether
  the node NAMES changed with them, and a `parts` selector that matches nothing
  is a pin that silently stops highlighting: no error, no warning, just a dot
  that does nothing when a pilot taps it.
*/
test("every authored selector is resolved against the file's real node names", async () => {
  const { selectorsOf, checkSelectors } = await import("../tools/inspect-glb.mjs");

  const model = {
    id: "flap-system",
    file: "FLAP.glb",
    parts: {
      actuator: ["ACTUATOR_HOUSING"],
      poppet: ["=POPPET_04"],
      pulley: ["FOLLOW_UP_PULLEY_B"]          /* renamed away by the re-export */
    },
    hidden: ["~^SRCFOWLER__"],
    extraParts: [{ id: "spider", selectors: ["C6CF1052_11_SPIDER"] }]
  };

  /* Three parts, one hidden rule, one extra part. */
  assert.equal(selectorsOf(model).length, 5);
  assert.deepEqual(selectorsOf(model).map((s) => s.where),
    ["parts.actuator", "parts.poppet", "parts.pulley", "hidden", "extraParts[spider]"],
    "every place a selector can hide must be walked, or it is a selector nobody checks");

  const survived = checkSelectors(model, ["ACTUATOR_HOUSING", "POPPET_04", "FOLLOW_UP_PULLEY_B", "SRCFOWLER__HEAD", "C6CF1052_11_SPIDER_CARRIER"]);
  assert.deepEqual(survived.dead, [], "these names all exist, so nothing is dead");
  assert.equal(survived.total, 5);

  const afterExport = checkSelectors(model, ["ACTUATOR_HOUSING", "POPPET_04", "SRCFOWLER__HEAD", "C6CF1052_11_SPIDER_CARRIER"]);
  assert.deepEqual(afterExport.dead.map((d) => d.where), ["parts.pulley"]);
  assert.equal(afterExport.dead[0].selector, "FOLLOW_UP_PULLEY_B");
});

test("the app's own matcher is used, not a second implementation of it", async () => {
  const { checkSelectors } = await import("../tools/inspect-glb.mjs");
  /*
    Three semantics that a naive string compare would get wrong, and that the
    Technical Lab relies on: a bare selector is a prefix that needs a separator,
    `=` is exact and forgives Blender's .001 suffix, `~` is a regex.
  */
  const model = { id: "m", file: "m.glb", parts: {
    prefix: ["PT6A27_AGB"],
    exact: ["=AC_Compressor"],
    regex: ["~^[LR]H_MAIN_BRAKE"]
  } };
  assert.deepEqual(
    checkSelectors(model, ["PT6A27_AGB_INPUT_GEARSHAFT", "AC_Compressor.001", "RH_MAIN_BRAKE_HOUSING"]).dead,
    [], "all three should resolve through the shipped matcher");

  /* A name that only LOOKS like a prefix match: no separator after the stem. */
  assert.equal(checkSelectors({ id: "m", file: "m.glb", parts: { p: ["PT6A27_AGB"] } }, ["PT6A27_AGBX_FOO"]).dead.length, 1);
});

test("a model with no selectors is not reported as broken", async () => {
  const { checkSelectors } = await import("../tools/inspect-glb.mjs");
  const result = checkSelectors({ id: "bare", file: "b.glb" }, ["ANY"]);
  assert.equal(result.total, 0);
  assert.deepEqual(result.dead, []);
});

/* ------------------------------------------- what kind of dead (phase 52) */

/*
  The first real run reported 259 dead selectors, and 24 of them were the
  library getting cleaner. Reading that by eye is how a genuine broken pin gets
  lost in a list of non-events, so the tool has to make the distinction itself.
*/

test("a dead pin and a dead hygiene rule are not the same finding", async () => {
  const { severityOf } = await import("../tools/inspect-glb.mjs");
  assert.equal(severityOf("parts.overspeed_governor"), "broken", "a pin that never resolves is a dot that does nothing");
  assert.equal(severityOf("extraParts[fuel_plumbing]"), "broken");
  assert.equal(severityOf("hidden"), "inert", "a rule with nothing left to hide is not a fault");
});

test("a selector location nobody has thought of yet errs toward broken", async () => {
  const { severityOf } = await import("../tools/inspect-glb.mjs");
  /* The dangerous direction is calling something inert that a pilot can tap. */
  assert.equal(severityOf("hidden.groups"), "broken");
  assert.equal(severityOf("parts.hidden"), "broken");
  assert.equal(severityOf(undefined), "broken");
});

test("an entry whose pins all survive is safe to repoint; one with a dead pin is not", async () => {
  const { checkSelectors, repointVerdict } = await import("../tools/inspect-glb.mjs");

  const cleaned = repointVerdict(checkSelectors(
    { id: "fcu", file: "f.glb", parts: { body: ["FCU_BODY"] }, hidden: ["~ARCHIVE", "~DONOR"] },
    ["FCU_BODY"]
  ));
  assert.equal(cleaned.broken.length, 0);
  assert.equal(cleaned.inert.length, 2, "both hygiene rules are dead, and neither is a fault");
  assert.equal(cleaned.safe, true, "numbers alone are enough to repoint this one");

  const holed = repointVerdict(checkSelectors(
    { id: "osg", file: "o.glb", parts: { governor: ["OSG_MAIN_CAST", "OSG_COVER"] }, hidden: ["~ARCHIVE"] },
    ["OSG_COVER"]
  ));
  assert.equal(holed.broken.length, 1);
  assert.equal(holed.broken[0].selector, "OSG_MAIN_CAST");
  assert.equal(holed.inert.length, 1);
  assert.equal(holed.safe, false, "repointing this publishes a pin that does nothing");
});

test("a fully intact entry is safe and reports nothing to re-author", async () => {
  const { checkSelectors, repointVerdict } = await import("../tools/inspect-glb.mjs");
  const verdict = repointVerdict(checkSelectors(
    { id: "trim", file: "t.glb", parts: { wheel: ["TRIM_WHEEL"] } },
    ["TRIM_WHEEL", "OTHER"]
  ));
  assert.deepEqual([verdict.broken.length, verdict.inert.length, verdict.safe], [0, 0, true]);
});

test("the run tells you which entries to hold back, not just what is dead", async () => {
  /*
    The output has to end in a decision. "259 dead" is a measurement; "these
    eleven are safe to repoint and these three are not" is the thing the next
    step actually needs.
  */
  const source = fs.readFileSync(path.join(root, "tools", "inspect-glb.mjs"), "utf8");
  assert.match(source, /repoint verdict/, "the verdict section must be printed");
  assert.match(source, /SAFE \(/);
  assert.match(source, /HOLD \(/);
  assert.match(source, /broken reference/, "the summary must count live references separately from inert ones");
  assert.match(source, /inert entr/);
});

/* ---------------------------------------------- clips are references too */

/*
  The check that nearly did not exist. A registry entry names animation CLIPS as
  well as nodes, and clipGroupsForModel() drives the Lab's animation buttons off
  the DECLARED list - so a model whose node names all survived can still have
  lost every clip it offers. In this re-export hydraulic-pack went 82 clips to
  1: judged on node names alone it looks perfectly safe to repoint.
*/

test("a declared clip the file no longer has is a button that plays nothing", async () => {
  const { checkClips } = await import("../tools/inspect-glb.mjs");
  const result = checkClips(
    { id: "pack", file: "p.glb", animations: ["FLOW_A", "FLOW_B", "FLOW_C"] },
    ["FLOW_A"]
  );
  assert.deepEqual(result.dead.map((d) => d.selector), ["FLOW_B", "FLOW_C"]);
  assert.ok(result.dead.every((d) => d.where === "animations"));
});

test("a clip group that catches nothing is inert, a dead clip is not", async () => {
  const { checkClips, repointVerdict, checkSelectors } = await import("../tools/inspect-glb.mjs");
  const model = {
    id: "csu", file: "c.glb",
    parts: { head: ["CSU_HEAD"] },
    animations: ["ANIM_ALIVE", "ANIM_GONE"],
    clips: { ANIM_ALIVE: "Alive", ANIM_GONE: "Gone" },
    clipGroups: { "Governor operation": ["~ALIVE"], "Archive sweep": ["~NOTHING_HERE"] }
  };
  const verdict = repointVerdict(
    checkSelectors(model, ["CSU_HEAD"]),
    checkClips(model, ["ANIM_ALIVE"])
  );
  assert.deepEqual(verdict.broken.map((d) => d.selector), ["ANIM_GONE"], "only the playable one is broken");
  assert.deepEqual(verdict.inert.map((d) => d.where).sort(), ["clipGroups[Archive sweep]", "clips"]);
  assert.equal(verdict.safe, false, "one dead animation is enough to hold the entry back");
});

test("an entry whose nodes survive but whose clips did not is never called safe", async () => {
  /*
    This is the exact shape of hydraulic-pack, and the reason the verdict has to
    look at both. Getting it wrong publishes eighty buttons that do nothing.
  */
  const { checkClips, checkSelectors, repointVerdict } = await import("../tools/inspect-glb.mjs");
  const model = { id: "hydraulic-pack", file: "h.glb", parts: { reservoir: ["RESERVOIR"] }, animations: ["FLOW_1", "FLOW_2"] };
  const nodesOnly = repointVerdict(checkSelectors(model, ["RESERVOIR"]));
  assert.equal(nodesOnly.safe, true, "on node names alone it looks fine - which is the trap");
  const both = repointVerdict(checkSelectors(model, ["RESERVOIR"]), checkClips(model, ["FLOW_1"]));
  assert.equal(both.safe, false);
});

test("clip selectors are matched with the app's matcher, not the node one", async () => {
  const { checkClips } = await import("../tools/inspect-glb.mjs");
  const lab = await import("../app/js/logic/systemslab.js");
  assert.equal(typeof lab.clipSelectorMatches, "function", "the app must own the one implementation");

  /*
    The semantics genuinely differ: a bare node selector matches on the "name_"
    prefix, a bare clip selector is exact. Matching clips with the node matcher
    would call a group alive that the app renders empty.
  */
  assert.equal(lab.selectorMatches("FLOW", "FLOW_1"), true, "node selectors match on the prefix");
  assert.equal(lab.clipSelectorMatches("FLOW", "FLOW_1"), false, "clip selectors do not");

  const dead = checkClips({ id: "m", file: "m.glb", clipGroups: { Flow: ["FLOW"] } }, ["FLOW_1"]);
  assert.equal(dead.dead.length, 1, "the group is empty in the app, so it must read as dead here");
});

test("the shipped registry's clips are in the shape this check reads", async () => {
  const { clipsOf } = await import("../tools/inspect-glb.mjs");
  const registry = JSON.parse(fs.readFileSync(path.join(root, "tools", "data", "systems-lab-models.json"), "utf8"));
  let referenced = 0;
  registry.models.forEach((model) => {
    clipsOf(model).forEach((entry) => {
      referenced++;
      assert.equal(typeof entry.selector, "string", model.id + " produced a non-string clip reference");
      assert.ok(entry.where, model.id + " produced a clip reference with no location");
    });
    (model.animations || []).forEach((name) => assert.equal(typeof name, "string"));
    Object.values(model.clipGroups || {}).forEach((list) => assert.ok(Array.isArray(list), model.id + " clipGroups must map to lists"));
  });
  assert.ok(referenced > 100, "the registry really does carry clip references - found " + referenced);
});

test("the shipped registry's selectors are all well formed for this check", () => {
  /* Guards the reader, not the models: an entry shape selectorsOf() cannot see
     is a selector nobody checks. */
  const registry = JSON.parse(fs.readFileSync(path.join(root, "tools", "data", "systems-lab-models.json"), "utf8"));
  registry.models.forEach((model) => {
    const declared = []
      .concat(Object.values(model.parts || {}).flat())
      .concat(model.hidden || [])
      .concat((model.extraParts || []).flatMap((e) => e.selectors || []));
    const seen = selectorsOfFor(model);
    assert.equal(seen, declared.length, model.id + ": selectorsOf sees " + seen + " of " + declared.length + " selectors");
  });
});

function selectorsOfFor(model) {
  let n = 0;
  Object.keys(model.parts || {}).forEach((p) => { n += (model.parts[p] || []).length; });
  n += (model.hidden || []).length;
  (model.extraParts || []).forEach((e) => { n += (e.selectors || []).length; });
  return n;
}

/* ------------------------------------------------------------------ renames */

/*
  A model re-exported under a NEW name reads as two separate problems — an entry
  pointing at a file that is gone, and a file nobody uses — when it is really
  one. The entry's selectors are the valuable part, so the question worth asking
  is whether they survive the new file. --rename asks it without editing
  anything.
*/
test("a rename is parsed, repeatable, and junk is ignored", async () => {
  const { parseRenames } = await import("../tools/inspect-glb.mjs");
  const renames = parseRenames([
    "node", "tool", "--rename", "FUEL_SYSTEM.glb=DHC6_FUEL_SYSTEM_FULL_REPLICA.glb",
    "--rename", "AIR-CONDITIONNG.glb=DHC6_AIR_CONDITIONING_SYSTEM_REPLICA.glb",
    "--rename", "no-equals-sign",
    "--rename", "=only-a-target.glb",
    "--rename"
  ]);
  assert.equal(renames.size, 2, "two well-formed pairs, and nothing invented from the malformed ones");
  assert.equal(renames.get("FUEL_SYSTEM.glb"), "DHC6_FUEL_SYSTEM_FULL_REPLICA.glb");
  assert.deepEqual(parseRenames([]).size, 0);
  assert.deepEqual(parseRenames(undefined).size, 0);
});

test("a renamed entry keeps its selectors and is checked against the new file", async () => {
  const { applyRenames, reconcile, checkSelectors } = await import("../tools/inspect-glb.mjs");

  const registry = { version: 2, models: [{
    id: "fuel-system", file: "FUEL_SYSTEM.glb",
    bytes: 1, sha256: "f".repeat(64), nodes: 1, meshes: 1, triangles: 1,
    parts: { tank: ["CENTRE_TANK"], pump: ["BOOST_PUMP"] }
  }] };
  const renames = new Map([["FUEL_SYSTEM.glb", "DHC6_FUEL_SYSTEM_FULL_REPLICA.glb"]]);
  const effective = applyRenames(registry, renames);

  assert.equal(effective.models[0].file, "DHC6_FUEL_SYSTEM_FULL_REPLICA.glb");
  assert.equal(effective.models[0].renamedFrom, "FUEL_SYSTEM.glb", "the rename is recorded so a dead selector can be attributed");
  assert.deepEqual(effective.models[0].parts, registry.models[0].parts, "selectors are the valuable part and must survive untouched");
  assert.equal(registry.models[0].file, "FUEL_SYSTEM.glb", "the original registry is not mutated");

  /* Before the rename the entry reads as missing and the file as unused - two
     problems. After it, neither. */
  const measured = { "DHC6_FUEL_SYSTEM_FULL_REPLICA.glb": Object.assign(summarise(glb(SIMPLE)), { sha256: "g".repeat(64) }) };
  const before = reconcile(registry, measured);
  assert.equal(before.missing.length, 1);
  assert.equal(before.unused.length, 1);
  const after = reconcile(effective, measured);
  assert.equal(after.missing.length, 0);
  assert.equal(after.unused.length, 0);

  /* And the real question: do the old selectors resolve against the new file? */
  const survived = checkSelectors(effective.models[0], ["CENTRE_TANK", "BOOST_PUMP"]);
  assert.deepEqual(survived.dead, []);
  const broken = checkSelectors(effective.models[0], ["CENTRE_TANK"]);
  assert.deepEqual(broken.dead.map((d) => d.selector), ["BOOST_PUMP"]);
});

test("with no renames the registry is passed through unchanged", async () => {
  const { applyRenames } = await import("../tools/inspect-glb.mjs");
  const registry = { version: 2, models: [{ id: "a", file: "A.glb" }] };
  assert.equal(applyRenames(registry, new Map()), registry);
  assert.equal(applyRenames(registry, null), registry);
});

test("the usage banner mentions every flag the tool honours", () => {
  const src = fs.readFileSync(path.join(root, "tools", "inspect-glb.mjs"), "utf8");
  const banner = src.slice(src.indexOf("Give it something to read"), src.indexOf("process.exitCode = 2"));
  ["--dir", "--file", "--registry", "--names", "--match", "--json", "--rename"].forEach((flagName) => {
    assert.ok(banner.includes(flagName), "a flag nobody is told about is a flag nobody uses: " + flagName);
  });
});
