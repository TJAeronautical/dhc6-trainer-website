/*
  Normalising the authored system-description packs.

  The defect: only electrical.json matches SystemDescription.kt, so Moshi throws
  on the other nineteen and the AFM/FCTM card silently disappears on Android.
  The web reads both shapes (app/js/logic/systems2d.js), which is why the browser
  has always shown them and the phone has not.

  These tests exist mostly to hold ONE line: the tool renames keys and never
  writes an aviation value. A normaliser that quietly filled regulatoryStatus
  would make every pack parse, look like a complete success, and assert a
  regulatory status the source never stated. That is the failure worth the
  effort here - not a crash, a silent and confident wrong answer.
*/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  normalisePack, normalisePositions, basenameGaps, samePath, isDirectRun,
  readSchemaRules, requirementsFor, classifyGaps, findSchema, resolveRef,
  relaxRequired, relaxIsFaithful, DEFAULT_RELAXED_FIELDS,
  missingRequired, requiredGaps,
  CONTROL_RENAMES, LIMIT_RENAMES, UNAUTHORED_LIMIT_FIELDS, REGULATORY_VALUES
} from "../tools/normalise-system-packs.mjs";
import { controlLabel, controlPositions, limitName, limitQualifier, regulatoryLabel } from "../app/js/logic/systems2d.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/* The two shapes, as app/js/logic/systems2d.js documents them from the real
   bundle. The web reader is the best evidence available in this repository of
   what the authored files actually contain. */
const NON_CONFORMING = {
  system: "FUEL",
  controls: [
    { name: "Boost pump", positions: ["ON", "OFF"], location: "Overhead" }
  ],
  limits: [
    { parameter: "Max fuel imbalance", value: "300 lb", note: "Normal operations" }
  ]
};

const CONFORMING = {
  system: "ELECTRICAL",
  controls: [
    { label: "Generator", positions: [{ label: "ON", behaviour: "latching" }], location: "Overhead" }
  ],
  limits: [
    { name: "Max continuous load", value: "200 A", condition: "Both generators", rationale: "AFM 2.1", regulatoryStatus: "AFM_APPROVED" }
  ]
};

/* --------------------------------------------- the renames the tool performs */

test("the non-conforming shape becomes the conforming one", () => {
  const result = normalisePack(NON_CONFORMING);
  assert.equal(result.changed, true);
  assert.equal(result.pack.controls[0].label, "Boost pump");
  assert.equal(result.pack.controls[0].name, undefined, "the old key must not linger");
  assert.deepEqual(result.pack.controls[0].positions, [{ label: "ON" }, { label: "OFF" }]);
  assert.equal(result.pack.limits[0].name, "Max fuel imbalance");
  assert.equal(result.pack.limits[0].condition, "Normal operations");
  assert.equal(result.pack.limits[0].parameter, undefined);
});

test("no aviation value is altered by the rename", () => {
  /* The whole justification for doing this automatically. Every value that went
     in comes out, byte for byte; only the key it hangs on changed. */
  const result = normalisePack(NON_CONFORMING);
  assert.equal(result.pack.limits[0].value, "300 lb");
  assert.equal(result.pack.controls[0].location, "Overhead");
  assert.equal(result.pack.system, "FUEL");

  const before = JSON.stringify(Object.values(NON_CONFORMING.limits[0]).sort());
  const after = JSON.stringify(Object.values(result.pack.limits[0]).sort());
  assert.equal(after, before, "the set of values is unchanged; only the keys moved");
});

test("a conforming pack is left exactly as it is", () => {
  /* electrical.json must not be touched at all. */
  const result = normalisePack(CONFORMING);
  assert.equal(result.changed, false);
  assert.deepEqual(result.pack, CONFORMING);
});

test("a pack carrying both keys is not silently halved", () => {
  /* Renaming onto an existing key would drop one of the two values, and which
     one survived would depend on key order. */
  const both = { limits: [{ name: "A", parameter: "B", value: "1" }] };
  const result = normalisePack(both);
  assert.equal(result.pack.limits[0].name, "A");
  assert.equal(result.pack.limits[0].parameter, "B");
  assert.ok(result.notes.some(function (n) { return /both/.test(n); }), "and it must say so");
});

test("positions carry each string through untouched", () => {
  assert.deepEqual(normalisePositions(["ON", "OFF"]).value, [{ label: "ON" }, { label: "OFF" }]);
  assert.equal(normalisePositions(["ON"]).changed, true);

  const objects = [{ label: "ON", behaviour: "latching" }];
  const already = normalisePositions(objects);
  assert.equal(already.changed, false);
  assert.deepEqual(already.value, objects, "an authored behaviour is not disturbed");

  assert.deepEqual(normalisePositions(undefined).value, undefined);
  assert.deepEqual(normalisePositions("nonsense").value, "nonsense");
});

test("no behaviour is invented for a position that had none", () => {
  /* An empty string is a value the source did not provide. Leaving the key off
     entirely is the honest shape, and the report says the pack may still fail
     if the schema demands one. */
  const result = normalisePack(NON_CONFORMING);
  result.pack.controls[0].positions.forEach(function (position) {
    assert.equal(Object.prototype.hasOwnProperty.call(position, "behaviour"), false);
  });
});

/* ------------------------------------------- what it refuses to do, and says */

test("regulatoryStatus is never written, only reported", () => {
  /*
    THE line. An unstated regulatory status must never become AFM_APPROVED
    because that is convenient. A pilot reading "AFM approved" against a number
    the AFM never approved is the worst outcome this whole feature can produce.
  */
  const result = normalisePack(NON_CONFORMING);
  assert.equal(result.pack.limits[0].regulatoryStatus, undefined, "not filled, not defaulted, not guessed");

  const gap = result.gaps.find(function (g) { return /regulatoryStatus/.test(g.path); });
  assert.ok(gap, "and the gap must be reported, not passed over in silence");
  assert.match(gap.why, /never be defaulted|never defaulted/);
  REGULATORY_VALUES.forEach(function (value) {
    assert.ok(gap.why.indexOf(value) > -1, "the report names the allowed values so you can author it");
  });
});

test("rationale is reported too, and equally not invented", () => {
  const result = normalisePack(NON_CONFORMING);
  assert.equal(result.pack.limits[0].rationale, undefined);
  assert.ok(result.gaps.some(function (g) { return /rationale/.test(g.path); }));
});

test("a regulatory status the schema does not allow is flagged", () => {
  const odd = { limits: [{ name: "X", value: "1", regulatoryStatus: "PROBABLY_FINE", rationale: "-" }] };
  const result = normalisePack(odd);
  assert.equal(result.pack.limits[0].regulatoryStatus, "PROBABLY_FINE", "left as authored");
  assert.ok(result.gaps.some(function (g) { return /is not one the schema allows/.test(g.why); }));
});

test("a control with nothing to rename from is reported, not dropped", () => {
  const nameless = { controls: [{ positions: ["ON"], location: "Overhead" }] };
  const result = normalisePack(nameless);
  assert.equal(result.pack.controls.length, 1, "the control survives");
  assert.ok(result.gaps.some(function (g) { return /controls\[0\]\.label/.test(g.path); }));
});

test("the gap report names the exact field, so it is actionable", () => {
  const result = normalisePack(NON_CONFORMING);
  result.gaps.forEach(function (gap) {
    assert.match(gap.path, /^(controls|limits)\[\d+\]\.\w+$/, "a vague report is an ignored report");
    assert.ok(gap.why && gap.why.length > 20);
  });
});

test("a pack with neither controls nor limits does not throw", () => {
  assert.doesNotThrow(function () { normalisePack({}); });
  assert.doesNotThrow(function () { normalisePack(null); });
  assert.doesNotThrow(function () { normalisePack({ controls: "nonsense", limits: 7 }); });
  assert.deepEqual(normalisePack({ controls: "nonsense" }).pack.controls, "nonsense");
});

/* --------------------------------- the output is what the app actually reads */

test("normalised packs read identically through the web reader", () => {
  /*
    The safety net for the whole exercise: if normalising changed what the app
    displays, it changed content rather than shape. Both shapes go through the
    shipped reader and must produce the same strings.
  */
  const before = NON_CONFORMING;
  const after = normalisePack(before).pack;

  assert.equal(controlLabel(after.controls[0]), controlLabel(before.controls[0]));
  assert.deepEqual(
    controlPositions(after.controls[0]).map(function (p) { return p.label; }),
    controlPositions(before.controls[0]).map(function (p) { return p.label; })
  );
  assert.equal(limitName(after.limits[0]), limitName(before.limits[0]));
  assert.equal(limitQualifier(after.limits[0]), limitQualifier(before.limits[0]));
  assert.equal(regulatoryLabel(after.limits[0]), regulatoryLabel(before.limits[0]));
  assert.equal(regulatoryLabel(after.limits[0]), null, "unstated before, unstated after");
});

test("the rename table matches the keys the shipped reader accepts", () => {
  /*
    The tool and the app must agree about which alternate key means what. If the
    reader ever learns a new alternate spelling and this table does not, the
    normaliser would leave that field behind.
  */
  const reader = fs.readFileSync(path.join(root, "app", "js", "logic", "systems2d.js"), "utf8");
  CONTROL_RENAMES.forEach(function (rule) {
    assert.match(reader, new RegExp("c\\." + rule.to + " \\|\\| c\\." + rule.from),
      "controlLabel must read " + rule.to + " then " + rule.from);
  });
  LIMIT_RENAMES.forEach(function (rule) {
    const pattern = new RegExp("l\\." + rule.to + " \\|\\| l\\." + rule.from);
    assert.match(reader, pattern, "the reader must accept " + rule.from + " as " + rule.to);
  });
});

test("the tool is dry-run by default", () => {
  /* Pointed at somebody's authored aviation content, a tool that writes before
     being asked is the wrong default. */
  const source = fs.readFileSync(path.join(root, "tools", "normalise-system-packs.mjs"), "utf8");
  assert.match(source, /const write = has\("write"\);/);
  assert.match(source, /DRY RUN - nothing will be written/);
  assert.match(source, /fs\.writeFileSync\(file \+ "\.bak", raw\)/, "and it keeps the original when it does write");
});

test("the tool states what it will never do, where somebody will read it", () => {
  const source = fs.readFileSync(path.join(root, "tools", "normalise-system-packs.mjs"), "utf8");
  assert.match(source, /WHAT IT WILL NOT DO, EVER/);
  assert.match(source, /never be defaulted|never defaulted/);
  assert.deepEqual(UNAUTHORED_LIMIT_FIELDS, ["rationale", "regulatoryStatus"]);
});

/* ------------------------------------------------------- the Android side */

const AIRCRAFT_SYSTEM_KT = `
enum class AircraftSystem {
  ELECTRICAL, FUEL, ATA_100, AIRCRAFT_GENERAL, STANDARD_AIRFRAME_PRACTICES, EQUIPMENT_FURNISHINGS;
  fun displayTitle(): String = when (this) {
    ELECTRICAL -> "Electrical"
    FUEL -> "Fuel"
    ATA_100 -> "ATA 100"
    AIRCRAFT_GENERAL -> "Aircraft General"
    STANDARD_AIRFRAME_PRACTICES -> "Standard Airframe Practices"
    EQUIPMENT_FURNISHINGS -> "Equipment and Furnishings"
  }
}`;

const REPOSITORY_KT = `
private val SYSTEM_TO_ASSET_BASENAME = mapOf(
  AircraftSystem.ELECTRICAL to "electrical",
  AircraftSystem.FUEL to "fuel",
  AircraftSystem.AIRCRAFT_GENERAL to "general"
)`;

test("the four unreachable packs are found, with the line to add", () => {
  /* Phase 5's third finding: AIRCRAFT_GENERAL is mapped to "general" and three
     systems have no entry at all, so four authored packs are never loaded on
     Android however well-formed their JSON is. */
  const gaps = basenameGaps(REPOSITORY_KT, AIRCRAFT_SYSTEM_KT);
  assert.deepEqual(gaps.map(function (g) { return g.system; }),
    ["ATA_100", "AIRCRAFT_GENERAL", "STANDARD_AIRFRAME_PRACTICES", "EQUIPMENT_FURNISHINGS"]);

  const general = gaps.find(function (g) { return g.system === "AIRCRAFT_GENERAL"; });
  assert.equal(general.mapped, "general");
  assert.match(general.why, /mapped to "general"/);
  assert.equal(general.line, 'AircraftSystem.AIRCRAFT_GENERAL to "aircraft_general",');

  const ata = gaps.find(function (g) { return g.system === "ATA_100"; });
  assert.equal(ata.mapped, null);
  assert.match(ata.why, /no entry at all/);
});

test("a system already mapping to its own file is not reported", () => {
  const gaps = basenameGaps(REPOSITORY_KT, AIRCRAFT_SYSTEM_KT);
  assert.equal(gaps.some(function (g) { return g.system === "ELECTRICAL"; }), false);
  assert.equal(gaps.some(function (g) { return g.system === "FUEL"; }), false);
});

test("the Android half is reported, never edited", () => {
  /* It belongs to a repository this tool cannot compile or run. Emitting a line
     to paste is the honest limit of what can be done from here. */
  const source = fs.readFileSync(path.join(root, "tools", "normalise-system-packs.mjs"), "utf8");
  const section = source.slice(source.indexOf("the Android side"));
  assert.doesNotMatch(section.slice(0, section.indexOf("function main")), /writeFileSync/,
    "nothing in the Kotlin path may write");
  assert.match(source, /apply and test them in Android Studio/);
});

/* ------------------------------------------------- the command line itself

   These exist because the unit tests above all passed while the tool did
   nothing at all when run. The entry guard compared process.argv[1] against
   `new URL(import.meta.url).pathname`, which on Windows is
   "/C:/Android%20Studio/..." - leading slash, percent-encoded space - so it
   never matched, main() never ran, and node exited 0. Three commands, no
   output, no error, no packs normalised.

   Importing a module is precisely the case where main() is supposed NOT to
   run, so no amount of testing the exported functions could have caught it.
   The only way is to actually run the thing.
*/

import { spawnSync } from "node:child_process";
import os from "node:os";

const TOOL = path.join(root, "tools", "normalise-system-packs.mjs");

function fixtureRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dhc6-packs-"));
  const packs = path.join(dir, "core-res", "src", "main", "assets", "systems", "descriptions");
  fs.mkdirSync(packs, { recursive: true });
  fs.writeFileSync(path.join(packs, "fuel.json"), JSON.stringify(NON_CONFORMING, null, 2) + "\n");
  fs.writeFileSync(path.join(packs, "electrical.json"), JSON.stringify(CONFORMING, null, 2) + "\n");
  return { dir: dir, packs: packs };
}

function run(args) {
  const result = spawnSync(process.execPath, [TOOL].concat(args), { encoding: "utf8" });
  return { status: result.status, out: String(result.stdout || ""), err: String(result.stderr || "") };
}

test("running the tool actually runs it", () => {
  /* THE test. If the entry guard breaks again, this is what says so. */
  const repo = fixtureRepo();
  const result = run(["--android", repo.dir]);

  assert.notEqual(result.out.trim(), "", "no output at all means main() never ran");
  assert.match(result.out, /DRY RUN - nothing will be written/);
  assert.match(result.out, /fuel\.json/);
  assert.match(result.out, /controls\[0\]: name -> label/);
  assert.match(result.out, /1 pack would be rewritten/);
  assert.equal(result.status, 0);
});

test("the entry guard survives a Windows path", () => {
  /*
    The exact pair that failed in production. argv gives backslashes and a bare
    drive letter; the URL gives a leading slash, forward slashes and %20. On
    Linux those two spellings agree, so this is the only way to test it here.
  */
  const argv = "C:\\Android Studio\\dhc6-trainer-website\\tools\\normalise-system-packs.mjs";
  const url = "file:///C:/Android%20Studio/dhc6-trainer-website/tools/normalise-system-packs.mjs";
  assert.equal(isDirectRun(argv, url), true, "this returned false, so the tool did nothing at all");

  /* And the raw pathname spelling is normalised too, so no single call has to
     be written correctly for the guard to hold. */
  assert.equal(samePath(argv, "/C:/Android%20Studio/dhc6-trainer-website/tools/normalise-system-packs.mjs"), true);
});

test("the guard still says no when it should", () => {
  const url = "file:///C:/Android%20Studio/tools/normalise-system-packs.mjs";
  assert.equal(isDirectRun("C:\\Android Studio\\tools\\something-else.mjs", url), false);
  assert.equal(isDirectRun("", url), false, "no argv[1] is not a direct run");
  assert.equal(isDirectRun(null, url), false);
  assert.equal(samePath("", ""), false, "two empties are not the same file");
  assert.equal(samePath("/a/b", "/a/b/"), true, "a trailing slash is not a different file");
  assert.equal(samePath("/a/b", "/a/c"), false);
});

test("a dry run leaves every file untouched", () => {
  const repo = fixtureRepo();
  const before = fs.readFileSync(path.join(repo.packs, "fuel.json"), "utf8");
  run(["--android", repo.dir]);
  assert.equal(fs.readFileSync(path.join(repo.packs, "fuel.json"), "utf8"), before);
  assert.equal(fs.existsSync(path.join(repo.packs, "fuel.json.bak")), false);
});

test("--write rewrites the pack and keeps the original beside it", () => {
  const repo = fixtureRepo();
  const before = fs.readFileSync(path.join(repo.packs, "fuel.json"), "utf8");
  const result = run(["--android", repo.dir, "--write"]);
  assert.match(result.out, /APPLYING/);

  const after = JSON.parse(fs.readFileSync(path.join(repo.packs, "fuel.json"), "utf8"));
  assert.equal(after.controls[0].label, "Boost pump");
  assert.equal(after.limits[0].name, "Max fuel imbalance");
  assert.equal(fs.readFileSync(path.join(repo.packs, "fuel.json.bak"), "utf8"), before,
    "the .bak must be the original, byte for byte");

  /* And the conforming pack is not rewritten, so it gets no .bak either. */
  assert.equal(fs.existsSync(path.join(repo.packs, "electrical.json.bak")), false);
});

test("it refuses to guess where the repository is", () => {
  const result = run([]);
  assert.equal(result.status, 1);
  assert.match(result.err, /Missing --android/);
});

test("a repository with no packs says so instead of reporting success", () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "dhc6-empty-"));
  const result = run(["--android", empty]);
  assert.equal(result.status, 1);
  assert.match(result.err, /No system-description packs found/);
  assert.match(result.err, /Looked in/, "and it must say where it looked");
});

/* ----------------------------------------------------- reading the schema

   The first real run left 154 gaps, every one of them `rationale` or
   `regulatoryStatus`. Whether that is a day's authoring or nothing at all
   depends on one fact: does the schema require them? Guessing either way would
   be useless, so the tool reads the schema and says.
*/

const SCHEMA = {
  type: "object",
  properties: {
    controls: { type: "array", items: { type: "object", required: ["label"], properties: { label: {}, positions: {} } } },
    limits: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "value"],
        properties: {
          name: {}, value: {}, condition: {}, rationale: {},
          regulatoryStatus: { enum: ["AFM_APPROVED", "OPERATOR_GUIDANCE", "MANUFACTURER_RECOMMENDED"] }
        }
      }
    }
  }
};

test("the schema's own requirements are read, not assumed", () => {
  const rules = readSchemaRules(SCHEMA);
  assert.deepEqual(rules.limits.required, ["name", "value"]);
  assert.deepEqual(rules.controls.required, ["label"]);
  assert.deepEqual(rules.limits.enums.regulatoryStatus, REGULATORY_VALUES,
    "the tool and the schema must agree on the allowed values");
});

test("a moved definition is found rather than reported as no requirements", () => {
  /* Schemas get restructured. Hunting for the shape means a definition that
     moved under $defs is still found, instead of the tool quietly concluding
     nothing is required - which would read as reassurance. */
  const nested = { $defs: { pack: { properties: SCHEMA.properties } }, $ref: "#/$defs/pack" };
  const rules = readSchemaRules(nested);
  assert.deepEqual(rules.limits.required, ["name", "value"]);
});

test("gaps are split by whether the schema actually demands them", () => {
  const rules = readSchemaRules(SCHEMA);
  const gaps = classifyGaps([
    { path: "limits[0].rationale", why: "x" },
    { path: "limits[0].regulatoryStatus", why: "y" },
    { path: "limits[0].name", why: "z" },
    { path: "controls[0].label", why: "w" }
  ], rules);

  assert.equal(gaps.find(function (g) { return g.field === "rationale"; }).blocking, false);
  assert.equal(gaps.find(function (g) { return g.field === "regulatoryStatus"; }).blocking, false);
  assert.equal(gaps.find(function (g) { return g.field === "name"; }).blocking, true);
  assert.equal(gaps.find(function (g) { return g.field === "label"; }).blocking, true);
});

test("a required regulatoryStatus is reported as blocking", () => {
  const strict = JSON.parse(JSON.stringify(SCHEMA));
  strict.properties.limits.items.required = ["name", "value", "regulatoryStatus"];
  const gaps = classifyGaps([{ path: "limits[0].regulatoryStatus", why: "y" }], readSchemaRules(strict));
  assert.equal(gaps[0].blocking, true);
});

test("an unreadable schema is unknown, never 'optional'", () => {
  /*
    The dangerous reassurance. If the schema cannot be read, saying "nothing
    blocks parsing" would send somebody off to rebuild packs that still will
    not load. null means unknown and the report says so.
  */
  const gaps = classifyGaps([{ path: "limits[0].regulatoryStatus", why: "y" }], null);
  assert.equal(gaps[0].blocking, null);
  assert.notEqual(gaps[0].blocking, false);

  assert.equal(requirementsFor({ type: "object" }, "limits", ["name"]), null);
  assert.equal(readSchemaRules({}).limits, null);
});

test("findSchema looks where the schema actually lives", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dhc6-schema-"));
  assert.equal(findSchema(dir), null);
  fs.mkdirSync(path.join(dir, "schema"), { recursive: true });
  const file = path.join(dir, "schema", "system_description.schema.json");
  fs.writeFileSync(file, "{}");
  assert.equal(findSchema(dir), file);
});

test("the run says plainly whether the renames finish the job", () => {
  const repo = fixtureRepo();
  const schemaDir = path.join(repo.dir, "core-res", "src", "main", "assets", "schema");
  fs.mkdirSync(schemaDir, { recursive: true });
  const schemaFile = path.join(schemaDir, "system_description.schema.json");

  fs.writeFileSync(schemaFile, JSON.stringify(SCHEMA));
  const optional = run(["--android", repo.dir]);
  assert.match(optional.out, /NONE OF THEM BLOCK PARSING/);
  assert.match(optional.out, /--write finishes the job/);

  const strict = JSON.parse(JSON.stringify(SCHEMA));
  strict.properties.limits.items.required = ["name", "value", "regulatoryStatus"];
  fs.writeFileSync(schemaFile, JSON.stringify(strict));
  const blocked = run(["--android", repo.dir]);
  assert.match(blocked.out, /REQUIRED by the schema and genuinely block parsing/);
  assert.match(blocked.out, /BLOCKING  limits\[0\]\.regulatoryStatus/);
  assert.doesNotMatch(blocked.out, /NONE OF THEM BLOCK/);

  fs.rmSync(schemaFile);
  const unknown = run(["--android", repo.dir]);
  assert.match(unknown.out, /Not assuming they are optional/);
  assert.doesNotMatch(unknown.out, /NONE OF THEM BLOCK PARSING/);
});

/* --------------------------------------------------- schemas with $ref

   The real schema was sitting exactly where the tool looked and was still
   reported unreadable, because the first walker only recognised an inline
   `items.properties`. Any schema of reasonable quality puts its definitions in
   $defs and points at them.
*/

const REF_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $defs: {
    Limit: {
      type: "object",
      required: ["name", "value"],
      properties: {
        name: {}, value: {}, condition: {}, rationale: {},
        regulatoryStatus: { enum: ["AFM_APPROVED", "OPERATOR_GUIDANCE", "MANUFACTURER_RECOMMENDED"] }
      }
    },
    Control: { type: "object", required: ["label"], properties: { label: {}, positions: {} } }
  },
  properties: {
    limits: { type: "array", items: { $ref: "#/$defs/Limit" } },
    controls: { type: "array", items: { $ref: "#/$defs/Control" } }
  }
};

test("a $defs definition behind a $ref is followed", () => {
  const rules = readSchemaRules(REF_SCHEMA);
  assert.deepEqual(rules.limits.required, ["name", "value"]);
  assert.deepEqual(rules.controls.required, ["label"]);
  assert.deepEqual(rules.limits.enums.regulatoryStatus, REGULATORY_VALUES);
});

test("draft-07 'definitions' works the same way", () => {
  const old = {
    definitions: { Limit: { required: ["name"], properties: { name: {}, value: {} } } },
    properties: { limits: { type: "array", items: { $ref: "#/definitions/Limit" } } }
  };
  assert.deepEqual(readSchemaRules(old).limits.required, ["name"]);
});

test("required lists composed with allOf are merged", () => {
  const composed = {
    $defs: {
      Base: { properties: { name: {}, value: {} }, required: ["name"] },
      Limit: { allOf: [{ $ref: "#/$defs/Base" }], required: ["value"], properties: {} }
    },
    properties: { limits: { type: "array", items: { $ref: "#/$defs/Limit" } } }
  };
  const required = readSchemaRules(composed).limits.required;
  assert.ok(required.indexOf("name") >= 0 && required.indexOf("value") >= 0);
});

test("resolveRef copes with pointers that go nowhere", () => {
  assert.deepEqual(resolveRef(REF_SCHEMA, { $ref: "#/$defs/Nope" }), { $ref: "#/$defs/Nope" });
  assert.deepEqual(resolveRef(REF_SCHEMA, { $ref: "https://example.com/x" }), { $ref: "https://example.com/x" });
  assert.equal(resolveRef(REF_SCHEMA, null), null);

  /* A pointer loop must not hang the tool. */
  const loop = { $defs: { a: { $ref: "#/$defs/b" }, b: { $ref: "#/$defs/a" } } };
  assert.doesNotThrow(function () { resolveRef(loop, { $ref: "#/$defs/a" }); });
});

test("a schema it genuinely cannot read says why, and what it found", () => {
  /* So the next failure is fixable instead of a shrug. */
  const repo = fixtureRepo();
  const schemaDir = path.join(repo.dir, "core-res", "src", "main", "assets", "schema");
  fs.mkdirSync(schemaDir, { recursive: true });
  fs.writeFileSync(path.join(schemaDir, "system_description.schema.json"),
    JSON.stringify({ title: "SystemDescription", $defs: { Thing: {} }, properties: { widgets: {} } }));

  const out = run(["--android", repo.dir]).out;
  assert.match(out, /Not assuming they are optional/);
  assert.match(out, /reason: the limits definition was not found in it/);
  assert.match(out, /it contains: .*\$defs\.Thing/);
});

test("a schema that is not valid JSON says so", () => {
  const repo = fixtureRepo();
  const schemaDir = path.join(repo.dir, "core-res", "src", "main", "assets", "schema");
  fs.mkdirSync(schemaDir, { recursive: true });
  fs.writeFileSync(path.join(schemaDir, "system_description.schema.json"), "{ not json");

  const out = run(["--android", repo.dir]).out;
  assert.match(out, /reason: it is not valid JSON/);
  assert.doesNotMatch(out, /NONE OF THEM BLOCK PARSING/);
});

test("a $ref schema reaches the all-clear end to end", () => {
  const repo = fixtureRepo();
  const schemaDir = path.join(repo.dir, "core-res", "src", "main", "assets", "schema");
  fs.mkdirSync(schemaDir, { recursive: true });
  fs.writeFileSync(path.join(schemaDir, "system_description.schema.json"), JSON.stringify(REF_SCHEMA));

  const out = run(["--android", repo.dir]).out;
  assert.match(out, /NONE OF THEM BLOCK PARSING/);
  assert.match(out, /requires only: name, value on a limit, label on a control/);
});

/* --------------------------------------------------- relaxing the schema

   The finding: of 154 leftover fields, 77 block parsing and every one is
   `rationale` - prose the web app never renders. Meanwhile regulatoryStatus,
   which IS displayed and separates an AFM-approved number from operator
   guidance, is optional. The safety-critical field was optional and the
   explanatory one was mandatory.

   Removing a required entry is the one edit of this kind safe to automate,
   because it takes a constraint AWAY rather than writing a value. These tests
   hold it to that: nothing else in the schema may move.
*/

const STRICT = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "SystemDescription",
  $defs: {
    Limit: {
      type: "object",
      required: ["name", "value", "rationale"],
      properties: { name: {}, value: {}, condition: {}, rationale: {}, regulatoryStatus: { enum: REGULATORY_VALUES } }
    },
    Control: { type: "object", required: ["label"], properties: { label: {}, positions: {} } }
  },
  properties: {
    limits: { type: "array", items: { $ref: "#/$defs/Limit" } },
    controls: { type: "array", items: { $ref: "#/$defs/Control" } }
  }
};

test("rationale comes out of required, and says where from", () => {
  const result = relaxRequired(STRICT);
  assert.deepEqual(result.schema.$defs.Limit.required, ["name", "value"]);
  assert.deepEqual(result.removed, [{ at: "/$defs/Limit/required", field: "rationale" }]);
  assert.deepEqual(DEFAULT_RELAXED_FIELDS, ["rationale"]);
});

test("the original is not mutated", () => {
  const before = JSON.stringify(STRICT);
  relaxRequired(STRICT);
  assert.equal(JSON.stringify(STRICT), before, "a dry run that mutates is not a dry run");
});

test("nothing else in the schema moves", () => {
  /* The check that matters: this is somebody's authored schema, and a rewrite
     that quietly reshaped it would be far worse than one that failed. */
  const after = relaxRequired(STRICT).schema;
  assert.equal(after.$schema, STRICT.$schema);
  assert.equal(after.title, STRICT.title);
  assert.deepEqual(after.$defs.Control, STRICT.$defs.Control, "an untouched definition stays identical");
  assert.deepEqual(after.$defs.Limit.properties, STRICT.$defs.Limit.properties);
  assert.deepEqual(after.properties, STRICT.properties);
  assert.deepEqual(Object.keys(after.$defs.Limit), Object.keys(STRICT.$defs.Limit), "key order is preserved");
});

test("the faithfulness check catches a rewrite that changed more", () => {
  const after = relaxRequired(STRICT).schema;
  assert.equal(relaxIsFaithful(STRICT, after), true);

  const tampered = JSON.parse(JSON.stringify(after));
  tampered.$defs.Limit.properties.value = { type: "number" };
  assert.equal(relaxIsFaithful(STRICT, tampered), false, "an extra change must be refused");

  const alsoTampered = JSON.parse(JSON.stringify(after));
  alsoTampered.$defs.Control.required = [];
  assert.equal(relaxIsFaithful(STRICT, alsoTampered), false);
});

test("a schema that never required it is left alone", () => {
  const already = { $defs: { Limit: { required: ["name", "value"], properties: { name: {} } } } };
  const result = relaxRequired(already);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.schema, already);
});

test("relaxing is dry-run, keeps a .bak, and actually clears the blockers", () => {
  const repo = fixtureRepo();
  const schemaDir = path.join(repo.dir, "core-res", "src", "main", "assets", "schema");
  fs.mkdirSync(schemaDir, { recursive: true });
  const schemaFile = path.join(schemaDir, "system_description.schema.json");
  const original = JSON.stringify(STRICT, null, 2) + "\n";
  fs.writeFileSync(schemaFile, original);

  /* Before: it blocks. */
  assert.match(run(["--android", repo.dir]).out, /REQUIRED by the schema and genuinely block parsing/);

  /* Dry run changes nothing. */
  const dry = run(["--android", repo.dir, "--relax-schema"]);
  assert.match(dry.out, /remove "rationale" from \/\$defs\/Limit\/required/);
  assert.match(dry.out, /dry run - add --write to apply/);
  assert.equal(fs.readFileSync(schemaFile, "utf8"), original, "a dry run must not touch the schema");

  /* Applied. */
  run(["--android", repo.dir, "--relax-schema", "--write"]);
  assert.equal(fs.readFileSync(schemaFile + ".bak", "utf8"), original, "the .bak is the original, byte for byte");
  assert.deepEqual(JSON.parse(fs.readFileSync(schemaFile, "utf8")).$defs.Limit.required, ["name", "value"]);

  /* After: it does not. The loop closes. */
  assert.match(run(["--android", repo.dir]).out, /NONE OF THEM BLOCK PARSING/);
});

test("the Kotlin change is printed, never applied", () => {
  const repo = fixtureRepo();
  const ktDir = path.join(repo.dir, "kt");
  fs.mkdirSync(ktDir, { recursive: true });
  const kt = path.join(ktDir, "SystemDescription.kt");
  const source = "data class SystemLimit(\n  val name: String,\n  val rationale: String,\n)\n";
  fs.writeFileSync(kt, source);

  const out = run(["--android", repo.dir, "--relax-schema", "--kotlin", ktDir, "--write"]).out;
  assert.match(out, /now:\s+val rationale: String,/);
  assert.match(out, /make it:\s+val rationale: String\? = null,/);
  assert.match(out, /apply and build it in Android Studio/);
  assert.equal(fs.readFileSync(kt, "utf8"), source, "even with --write, the Kotlin is untouched");
});

test("an already-nullable Kotlin property is reported as done", () => {
  const repo = fixtureRepo();
  const ktDir = path.join(repo.dir, "kt");
  fs.mkdirSync(ktDir, { recursive: true });
  fs.writeFileSync(path.join(ktDir, "SystemDescription.kt"),
    "data class SystemLimit(\n  val rationale: String? = null,\n)\n");

  const out = run(["--android", repo.dir, "--relax-schema", "--kotlin", ktDir]).out;
  assert.match(out, /already nullable/);
  assert.doesNotMatch(out, /make it:/);
});

/* ------------------------------ every required field, not a hardcoded pair

   My defect, found by running the tool against the real repository. The gap
   check looked for `rationale` and `regulatoryStatus` and nothing else, so when
   the real schema turned out to require id, name, value and references on a
   limit, the tool printed "NONE OF THEM BLOCK PARSING" in the same breath as
   listing four required fields it had never looked for.

   An all-clear that checked two fields out of four is worse than no check.
*/

const REAL_SHAPED = {
  definitions: {
    limit: {
      type: "object",
      required: ["id", "name", "value", "references"],
      properties: { id: {}, name: {}, value: {}, condition: {}, references: {}, rationale: {}, regulatoryStatus: { enum: REGULATORY_VALUES } }
    },
    control: {
      type: "object",
      required: ["id", "label", "positions", "description", "references"],
      properties: { id: {}, label: {}, positions: {}, description: {}, references: {} }
    }
  },
  properties: {
    limits: { type: "array", items: { $ref: "#/definitions/limit" } },
    controls: { type: "array", items: { $ref: "#/definitions/control" } }
  }
};

test("a required field absent from the pack is found, whatever it is called", () => {
  assert.deepEqual(missingRequired({ name: "X", value: "1" }, ["id", "name", "value", "references"]),
    ["id", "references"]);
  assert.deepEqual(missingRequired({ id: "a", name: "X", value: "1", references: ["AFM"] },
    ["id", "name", "value", "references"]), []);
});

test("empty is missing - a blank string or empty list is not a value", () => {
  assert.deepEqual(missingRequired({ id: "", name: "X" }, ["id", "name"]), ["id"]);
  assert.deepEqual(missingRequired({ references: [], name: "X" }, ["references", "name"]), ["references"]);
  assert.deepEqual(missingRequired({ id: "   ", name: "X" }, ["id"]), ["id"]);
  assert.deepEqual(missingRequired({ id: null }, ["id"]), ["id"]);
  assert.deepEqual(missingRequired(null, ["id"]), ["id"]);
  assert.deepEqual(missingRequired({}, []), [], "no requirements, no gaps");
});

test("requiredGaps names the entity and the field", () => {
  const gaps = requiredGaps(
    { controls: [{ label: "Boost pump" }], limits: [{ name: "X" }] },
    readSchemaRules(REAL_SHAPED)
  );
  const paths = gaps.map(function (g) { return g.path; });
  assert.ok(paths.indexOf("controls[0].id") >= 0);
  assert.ok(paths.indexOf("controls[0].description") >= 0);
  assert.ok(paths.indexOf("limits[0].references") >= 0);
  assert.equal(paths.indexOf("controls[0].label"), -1, "a field that IS present is not a gap");
});

test("the all-clear is refused while a required field is missing", () => {
  /* THE test. The tool said NONE OF THEM BLOCK PARSING against a schema
     requiring four fields it had never checked. */
  const repo = fixtureRepo();
  const packs = repo.packs;
  fs.writeFileSync(path.join(packs, "fuel.json"), JSON.stringify({
    system: "FUEL",
    controls: [{ name: "Boost pump", positions: ["ON", "OFF"] }],
    limits: [{ parameter: "Max imbalance", value: "300 lb", note: "Normal" }]
  }));
  fs.rmSync(path.join(packs, "electrical.json"));

  const schemaDir = path.join(repo.dir, "core-res", "src", "main", "assets", "schema");
  fs.mkdirSync(schemaDir, { recursive: true });
  fs.writeFileSync(path.join(schemaDir, "system_description.schema.json"), JSON.stringify(REAL_SHAPED));

  const out = run(["--android", repo.dir]).out;
  assert.doesNotMatch(out, /NONE OF THEM BLOCK PARSING/,
    "the renames are clean but id, description and references are still absent");
  assert.match(out, /REQUIRED by the schema and genuinely block parsing/);
  assert.match(out, /BLOCKING\s+limits\[0\]\.id/);
  assert.match(out, /BLOCKING\s+controls\[0\]\.description/);
  assert.match(out, /BLOCKING\s+limits\[0\]\.references/);
});

test("a pack that satisfies the schema does get the all-clear", () => {
  const repo = fixtureRepo();
  fs.readdirSync(repo.packs).forEach(function (f) { fs.rmSync(path.join(repo.packs, f)); });
  fs.writeFileSync(path.join(repo.packs, "fuel.json"), JSON.stringify({
    system: "FUEL",
    controls: [{ id: "c1", name: "Boost pump", positions: ["ON"], description: "d", references: ["AFM"] }],
    limits: [{ id: "l1", parameter: "Max imbalance", value: "300 lb", references: ["AFM"] }]
  }));
  const schemaDir = path.join(repo.dir, "core-res", "src", "main", "assets", "schema");
  fs.mkdirSync(schemaDir, { recursive: true });
  fs.writeFileSync(path.join(schemaDir, "system_description.schema.json"), JSON.stringify(REAL_SHAPED));

  const out = run(["--android", repo.dir]).out;
  assert.match(out, /NONE OF THEM BLOCK PARSING/, "renames satisfy it, so it must say so");
});

/* ------------------------------------- an alias is not a gap */

const ALIAS_KT = `
enum class AircraftSystem { FUEL, POWERPLANT, ENGINE, IGNITION;
  fun displayTitle(): String = when (this) {
    FUEL -> "Fuel"
    POWERPLANT -> "Powerplant"
    ENGINE -> "Engine"
    IGNITION -> "Ignition"
  } }`;

const ALIAS_REPO_KT = `
private val SYSTEM_TO_ASSET_BASENAME = mapOf(
  AircraftSystem.FUEL to "fuel",
  AircraftSystem.ENGINE to "powerplant",
  AircraftSystem.IGNITION to "powerplant"
)`;

test("a system sharing a pack is an alias, not a gap", () => {
  /*
    The over-report, and it would have done real harm if acted on: ENGINE,
    IGNITION and STARTING all point at "powerplant" because there is one
    powerplant pack, not three. Telling somebody to map ENGINE to "engine" when
    systems/engine.json does not exist takes that system's content away.
  */
  const present = ["fuel", "powerplant"];
  const gaps = basenameGaps(ALIAS_REPO_KT, ALIAS_KT, present);
  assert.deepEqual(gaps.map(function (g) { return g.system; }), ["POWERPLANT"],
    "only the system whose own file exists and is unmapped");
  assert.equal(gaps.some(function (g) { return g.system === "ENGINE"; }), false);
  assert.equal(gaps.some(function (g) { return g.system === "IGNITION"; }), false);
});

test("without the file list it still reports everything, as before", () => {
  /* Callers that cannot supply the list are not silently given a narrower
     answer; they get the old behaviour and can judge it themselves. */
  const gaps = basenameGaps(ALIAS_REPO_KT, ALIAS_KT);
  assert.ok(gaps.length > 1);
  assert.ok(gaps.some(function (g) { return g.system === "ENGINE"; }));
});

test("the run only reports basename gaps for packs that exist", () => {
  const repo = fixtureRepo();
  fs.readdirSync(repo.packs).forEach(function (f) { fs.rmSync(path.join(repo.packs, f)); });
  fs.writeFileSync(path.join(repo.packs, "fuel.json"), JSON.stringify({ system: "FUEL" }));
  fs.writeFileSync(path.join(repo.packs, "powerplant.json"), JSON.stringify({ system: "POWERPLANT" }));

  const ktDir = path.join(repo.dir, "app", "kotlin");
  fs.mkdirSync(ktDir, { recursive: true });
  fs.writeFileSync(path.join(ktDir, "AircraftSystem.kt"), ALIAS_KT);
  fs.writeFileSync(path.join(ktDir, "SystemContentRepository.kt"), ALIAS_REPO_KT);

  const out = run(["--android", repo.dir, "--kotlin", ktDir]).out;
  assert.match(out, /POWERPLANT/);
  assert.doesNotMatch(out, /add\/replace:  AircraftSystem\.ENGINE/);
  assert.doesNotMatch(out, /add\/replace:  AircraftSystem\.IGNITION/);
});

test("SystemDescription.kt is looked for in the repo, not under assets", () => {
  /* It is Kotlin. It does not live in an assets folder, which is why the run
     reported it missing. */
  const repo = fixtureRepo();
  const ktDir = path.join(repo.dir, "app", "src", "main", "kotlin");
  fs.mkdirSync(ktDir, { recursive: true });
  fs.writeFileSync(path.join(ktDir, "SystemDescription.kt"),
    "data class SystemLimit(\n  val id: String,\n  val rationale: String,\n)\n");
  const schemaDir = path.join(repo.dir, "core-res", "src", "main", "assets", "schema");
  fs.mkdirSync(schemaDir, { recursive: true });
  fs.writeFileSync(path.join(schemaDir, "system_description.schema.json"), JSON.stringify(STRICT));

  const out = run(["--android", repo.dir, "--relax-schema"]).out;
  assert.match(out, /make it:\s+val rationale: String\? = null/);
  assert.doesNotMatch(out, /SystemDescription\.kt not found/);
});

test("the suggested Kotlin line would actually compile", () => {
  /*
    A real defect: the type regex ran to the end of the line, so a single-line
    `data class SystemLimit(val rationale: String)` yielded the type "String)"
    and the tool offered
    `data class SystemLimit(val rationale: String)? = null` - a line that does
    not compile, presented as the line to paste. Offering a broken edit is
    worse than offering none.
  */
  const oneLine = fixtureRepo();
  const ktA = path.join(oneLine.dir, "kt");
  fs.mkdirSync(ktA, { recursive: true });
  fs.writeFileSync(path.join(ktA, "SystemDescription.kt"),
    "data class SystemLimit(val rationale: String)\n");
  const schemaA = path.join(oneLine.dir, "core-res", "src", "main", "assets", "schema");
  fs.mkdirSync(schemaA, { recursive: true });
  fs.writeFileSync(path.join(schemaA, "system_description.schema.json"), JSON.stringify(STRICT));

  const out = run(["--android", oneLine.dir, "--relax-schema", "--kotlin", ktA]).out;
  const suggested = /make it:\s+(.*)/.exec(out);
  assert.ok(suggested, "a suggestion must be offered");
  assert.equal(suggested[1].trim(), "data class SystemLimit(val rationale: String? = null)");
  assert.doesNotMatch(suggested[1], /String\)\? = null/, "the nullable marker must go on the TYPE");

  /* Balanced parens are a cheap proxy for "this would compile". */
  const line = suggested[1];
  assert.equal((line.match(/\(/g) || []).length, (line.match(/\)/g) || []).length);
});
