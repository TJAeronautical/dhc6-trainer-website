import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "tests", "fixtures", "android-assets");

test("build-content transforms Android assets into protected packs + KV bulk file", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "dhc6-content-"));
  execFileSync(process.execPath, [path.join(root, "tools", "build-content.mjs"), "--android", fixture, "--out", out], { stdio: "pipe" });

  const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
  assert.match(manifest.version, /^\d{8}-[0-9a-f]{8}$/);
  assert.match(manifest.disclaimer, /AFM, QRH, MEL/);
  const ids = manifest.packs.map((p) => p.id);
  for (const id of ["procedures-index", "procedures-normal", "procedures-abnormal", "procedures-emergency", "flashcards", "quiz-bank", "limitations", "mel", "performance", "cas-library", "cockpit-bindings", "maldives-strips", "scenario-snapshots", "canonical-items"]) {
    assert.ok(ids.includes(id), "missing pack " + id);
    assert.ok(fs.existsSync(path.join(out, "packs", id + ".json")), "missing pack file " + id);
  }

  const index = JSON.parse(fs.readFileSync(path.join(out, "packs", "procedures-index.json"), "utf8"));
  assert.equal(index.count, 3);
  const normal = index.items.find((i) => i.category === "NORMAL");
  assert.equal(normal.id, "normal/test_normal");
  assert.equal(normal.title, "Test Normal [Test]");
  assert.equal(normal.normalSplit, "Everyday Actions");
  assert.deepEqual(normal.counts.LEGACY, { memory: 2, flow: 2 });
  assert.deepEqual(index.groups.EMERGENCY, { "Smoke and Fire": 1 });

  const emergency = JSON.parse(fs.readFileSync(path.join(out, "packs", "procedures-emergency.json"), "utf8"));
  const proc = emergency.procedures[0];
  assert.equal(proc.category, "EMERGENCY");
  assert.deepEqual(proc.variantsAvailable, ["LEGACY", "G950"]);
  assert.equal(proc.variants.LEGACY.memory[1].requiresConfirmation, true);
  assert.equal(proc.variants.LEGACY.memory[0].action, "TEST ITEM ONE - SET", "step text must be carried across verbatim");

  const flashcards = JSON.parse(fs.readFileSync(path.join(out, "packs", "flashcards.json"), "utf8"));
  assert.equal(flashcards.cardCount, 1);
  assert.equal(flashcards.decks[0].cards[0].references[0].source, "FIXTURE");

  const bulk = JSON.parse(fs.readFileSync(path.join(out, "kv-bulk.json"), "utf8"));
  assert.equal(bulk[0].key, "webcontent:manifest");
  assert.ok(bulk.some((entry) => entry.key === "webcontent:pack:limitations"));
  for (const entry of bulk) JSON.parse(entry.value);

  fs.rmSync(out, { recursive: true, force: true });
});

test("no protected content pack is committed to the public repository", () => {
  assert.equal(fs.existsSync(path.join(root, "build")) && fs.readdirSync(path.join(root, "build")).length > 0 ? fs.readFileSync(path.join(root, ".gitignore"), "utf8").includes("build/") : true, true);
  assert.match(fs.readFileSync(path.join(root, ".gitignore"), "utf8"), /^build\/$/m);
  assert.match(fs.readFileSync(path.join(root, ".assetsignore"), "utf8"), /build\/\*\*/);
});

test("build-content ports Kotlin-authored ordering, glossary and knowledge pool", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "dhc6-content-kt-"));
  const kotlin = path.join(root, "tests", "fixtures", "android-kotlin");
  execFileSync(process.execPath, [path.join(root, "tools", "build-content.mjs"), "--android", fixture, "--kotlin", kotlin, "--out", out], { stdio: "pipe" });

  const glossary = JSON.parse(fs.readFileSync(path.join(out, "packs", "glossary.json"), "utf8"));
  assert.equal(glossary.count, 3);
  assert.deepEqual(glossary.entries.map((e) => e.acronym), ["AFM", "QRH", "SRS"]);
  assert.match(glossary.entries[0].note, /"authoritative"/, "escaped quotes inside Kotlin literals survive");
  assert.equal(glossary.entries[1].definition, "Quick Reference Handbook");

  const index = JSON.parse(fs.readFileSync(path.join(out, "packs", "procedures-index.json"), "utf8"));
  const normal = index.items.find((i) => i.category === "NORMAL");
  assert.equal(normal.procedureName, "Test Normal [Test]", "procedureName = drillName.ifBlank { rawName }");
  assert.equal(normal.displayTitle, "Test Normal [test]", "formatProcedureDisplayTitle only strips known [phase] suffixes and title-cases the rest");
  assert.equal(normal.compiledId, "NORMAL/Test Normal [Test]");
  assert.equal(normal.normalBucket, "WEATHER_SPECIAL_CONDITIONS", "bucket parsed from the Kotlin when-branches");
  assert.equal(normal.qrhRank, 201);
  const abnormal = index.items.find((i) => i.category === "ABNORMAL");
  assert.equal(abnormal.qrhRank, 1, "rank from ProcedureSortOrder list position (0-based)");
  const emergency = index.items.find((i) => i.category === "EMERGENCY");
  assert.equal(emergency.qrhRank, 0);

  const pool = JSON.parse(fs.readFileSync(path.join(out, "packs", "knowledge-pool.json"), "utf8"));
  assert.ok(pool.count >= 1);
  const bank = pool.units.find((u) => u.sourceId === "quiz_bank");
  assert.ok(bank, "quiz_bank questions are part of the STATUS:CANDIDATE pool");
  assert.ok(bank.tags.includes("STATUS:CANDIDATE"));
  // The fixture deck uses systemId "test", which is not in BundledFlashcardSeeder.SYSTEM_ID_MAP → not seeded (parity).
  assert.equal(pool.units.some((u) => u.id.startsWith("bundled_test_deck_")), false);

  fs.rmSync(out, { recursive: true, force: true });
});
