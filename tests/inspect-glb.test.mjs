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
