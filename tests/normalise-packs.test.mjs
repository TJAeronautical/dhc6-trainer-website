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
