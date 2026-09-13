#!/usr/bin/env node
/*
  Build the protected web-content packs from the Android app's authoritative
  assets (core-res/src/main/assets in the private DHC-6-Trainer repository).

  Usage:
    node tools/build-content.mjs --android "C:\Android Studio\DHC-6-Trainer" --out build/content

  Output:
    <out>/manifest.json           manifest stored at KV key  webcontent:manifest
    <out>/packs/<id>.json         one file per pack, KV key  webcontent:pack:<id>
    <out>/kv-bulk.json            wrangler bulk-upload file (see tools/publish-content.md)

  Nothing produced here is committed to the public website repository
  (build/ is git-ignored). The Worker serves packs only to authenticated
  subscriber/owner sessions via /api/content/*.

  The transform is deliberately conservative: procedure steps, flashcards,
  limitations, MEL rows, performance tables and calculator constants are
  carried across verbatim. Only identity/grouping metadata is normalised so
  the browser app can build the same navigation the Android app uses.
*/

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function arg(name, fallback) {
  const index = process.argv.indexOf("--" + name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

const androidRoot = arg("android", process.env.DHC6_ANDROID_REPO || "");
const outDir = path.resolve(arg("out", "build/content"));
if (!androidRoot) {
  console.error("Missing --android <path to DHC-6-Trainer repo> (or DHC6_ANDROID_REPO env var)");
  process.exit(1);
}

const assetsRoot = fs.existsSync(path.join(androidRoot, "core-res", "src", "main", "assets"))
  ? path.join(androidRoot, "core-res", "src", "main", "assets")
  : androidRoot;

function readJson(relative) {
  const full = path.join(assetsRoot, relative);
  return JSON.parse(fs.readFileSync(full, "utf8"));
}

function listJson(relativeDir) {
  const dir = path.join(assetsRoot, relativeDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort().map((name) => ({
    file: name,
    slug: name.replace(/\.json$/, ""),
    data: readJson(path.join(relativeDir, name))
  }));
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function stepView(step, index) {
  return {
    n: Number.isFinite(step.stepNumber) ? step.stepNumber : index + 1,
    action: String(step.action || ""),
    crewRole: step.crewRole || "BOTH",
    intent: step.intent || null,
    requiresConfirmation: Boolean(step.requiresConfirmation),
    reference: step.reference || null,
    note: step.note || null,
    callout: step.callout || null,
    targets: Array.isArray(step.targets) ? step.targets : null
  };
}

function variantView(body) {
  if (!body) return null;
  return {
    memory: (body.memory || []).map(stepView),
    flow: (body.flow || []).map(stepView)
  };
}

/* ---------------------------------------------------------------- procedures */
function buildProcedures() {
  const categories = ["normal", "abnormal", "emergency"];
  const normalBindings = readJson("procedures/procedure_bindings_normal.json");
  const bindingByAsset = new Map();
  for (const item of normalBindings.items || []) bindingByAsset.set(item.assetPath, item);

  const packs = {};
  const index = [];

  for (const category of categories) {
    const entries = listJson("procedures/" + category);
    const procedures = entries.map((entry) => {
      const raw = entry.data;
      const assetPath = "procedures/" + category + "/" + entry.file;
      const binding = bindingByAsset.get(assetPath);
      const variants = {};
      if (raw.variants) {
        for (const key of Object.keys(raw.variants)) variants[key] = variantView(raw.variants[key]);
      } else {
        variants[raw.variant || "BOTH"] = variantView(raw);
      }
      const procedure = {
        id: category + "/" + entry.slug,
        slug: entry.slug,
        category: String(raw.category || category.toUpperCase()).toUpperCase(),
        title: raw.displayLabel || (binding && binding.title) || raw.drillName || raw.rawName,
        rawName: raw.rawName,
        drillName: raw.drillName || null,
        context: raw.context || (binding && binding.phase) || null,
        phaseTag: raw.phaseTag || (binding && binding.phase) || null,
        procedureGroup: raw.procedureGroup || (binding && binding.procedureGroup) || null,
        normalSplit: raw.normalSplit || (binding && binding.normalSplit) || null,
        manualSection: raw.manualSection || null,
        sourceSection: raw.sourceSection || (binding && binding.sourceSection) || null,
        sortOrder: Number.isFinite(raw.sortOrder) ? raw.sortOrder : (binding && binding.sortOrder) || 9999,
        sequenceBasis: raw.sequenceBasis || null,
        mccGroup: raw.mccGroup || null,
        mccReference: raw.mccReference || null,
        sourceNote: raw.sourceNote || null,
        variantsAvailable: Object.keys(variants),
        variants: variants
      };
      return procedure;
    });
    procedures.sort((a, b) => (a.sortOrder - b.sortOrder) || a.title.localeCompare(b.title));
    packs["procedures-" + category] = {
      id: "procedures-" + category,
      category: category.toUpperCase(),
      source: "DHC-6-Trainer core-res/src/main/assets/procedures/" + category,
      count: procedures.length,
      procedures: procedures
    };
    for (const procedure of procedures) {
      const counts = {};
      for (const key of Object.keys(procedure.variants)) {
        counts[key] = { memory: procedure.variants[key].memory.length, flow: procedure.variants[key].flow.length };
      }
      index.push({
        id: procedure.id,
        pack: "procedures-" + category,
        category: procedure.category,
        title: procedure.title,
        context: procedure.context,
        phaseTag: procedure.phaseTag,
        procedureGroup: procedure.procedureGroup,
        normalSplit: procedure.normalSplit,
        manualSection: procedure.manualSection,
        sourceSection: procedure.sourceSection,
        sortOrder: procedure.sortOrder,
        variantsAvailable: procedure.variantsAvailable,
        counts: counts
      });
    }
  }

  const groups = {};
  for (const item of index) {
    const key = item.category;
    groups[key] = groups[key] || {};
    const group = item.procedureGroup || "Other";
    groups[key][group] = (groups[key][group] || 0) + 1;
  }

  packs["procedures-index"] = {
    id: "procedures-index",
    source: "DHC-6-Trainer core-res/src/main/assets/procedures + procedure_bindings_normal.json",
    count: index.length,
    groups: groups,
    canonicalPhases: readJson("procedures/canonical/canonical_phases.json").phases || [],
    items: index
  };
  return packs;
}

/* ----------------------------------------------------------------- flashcards */
function buildFlashcards() {
  const decks = listJson("flashcards").map((entry) => entry.data);
  return {
    id: "flashcards",
    source: "DHC-6-Trainer core-res/src/main/assets/flashcards",
    deckCount: decks.length,
    cardCount: decks.reduce((sum, deck) => sum + (deck.cards || []).length, 0),
    decks: decks.map((deck) => ({
      deckId: deck.deckId,
      deckName: deck.deckName,
      description: deck.description || "",
      systemId: deck.systemId,
      variant: deck.variant || "BOTH",
      difficulty: deck.difficulty || null,
      cards: (deck.cards || []).map((card) => ({
        id: card.id,
        front: card.front,
        back: card.back,
        tags: card.tags || [],
        references: card.references || []
      }))
    }))
  };
}

/* ------------------------------------------------------------ simple passthru */
function passthrough(id, relative, extra) {
  const data = readJson(relative);
  return Object.assign({ id: id, source: "DHC-6-Trainer core-res/src/main/assets/" + relative }, extra || {}, { data: data });
}

function buildCasLibrary() {
  const files = listJson("cas-library");
  return {
    id: "cas-library",
    source: "DHC-6-Trainer core-res/src/main/assets/cas-library",
    libraries: files.filter((f) => f.slug !== "scenario_snapshot_aliases").map((f) => ({ file: f.slug, data: f.data })),
    aliases: (files.find((f) => f.slug === "scenario_snapshot_aliases") || {}).data || null
  };
}

function buildBindings() {
  const files = listJson("bindings");
  return {
    id: "cockpit-bindings",
    source: "DHC-6-Trainer core-res/src/main/assets/bindings",
    files: files.map((f) => ({ file: f.slug, data: f.data }))
  };
}

/* ----------------------------------------------------------------------- main */
function main() {
  const packs = Object.assign({}, buildProcedures());
  packs.flashcards = buildFlashcards();
  packs["quiz-bank"] = passthrough("quiz-bank", "quizzes/quiz_bank.json");
  packs.limitations = passthrough("limitations", "limitations/dhc6_limitations.json");
  packs.mel = passthrough("mel", "mel/dhc6_mel_reference.json");
  packs.performance = {
    id: "performance",
    source: "DHC-6-Trainer core-res/src/main/assets/performance + calculators",
    tables: readJson("performance/dhc6_performance_tables.json"),
    calculators: readJson("calculators/dhc6_calc_data.json")
  };
  packs["cas-library"] = buildCasLibrary();
  packs["cockpit-bindings"] = buildBindings();
  packs["maldives-strips"] = passthrough("maldives-strips", "strips/maldives_strips.json");
  packs["scenario-snapshots"] = passthrough("scenario-snapshots", "scenario_snapshots.json");
  packs["canonical-items"] = passthrough("canonical-items", "procedures/canonical/canonical_items.json");

  fs.mkdirSync(path.join(outDir, "packs"), { recursive: true });
  const manifestPacks = [];
  const bulk = [];
  for (const id of Object.keys(packs).sort()) {
    const text = JSON.stringify(packs[id]);
    fs.writeFileSync(path.join(outDir, "packs", id + ".json"), text);
    const pack = packs[id];
    manifestPacks.push({
      id: id,
      bytes: Buffer.byteLength(text, "utf8"),
      sha256: sha256(text),
      items: pack.count || pack.cardCount || (pack.items && pack.items.length) || null,
      source: pack.source || null
    });
    bulk.push({ key: "webcontent:pack:" + id, value: text });
  }
  const manifest = {
    version: new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + sha256(bulk.map((b) => b.value).join("")).slice(0, 8),
    publishedAt: new Date().toISOString(),
    source: "TJAeronautical/DHC-6-Trainer core-res/src/main/assets",
    disclaimer: "Training support only. Not a replacement for the approved AFM, QRH, MEL, company manuals, approved checklists or regulatory/operator documentation.",
    packs: manifestPacks
  };
  const manifestText = JSON.stringify(manifest);
  fs.writeFileSync(path.join(outDir, "manifest.json"), manifestText);
  bulk.unshift({ key: "webcontent:manifest", value: manifestText });
  fs.writeFileSync(path.join(outDir, "kv-bulk.json"), JSON.stringify(bulk));

  console.log("Content build complete → " + outDir);
  for (const pack of manifestPacks) console.log("  " + pack.id.padEnd(22) + String(pack.bytes).padStart(9) + " bytes" + (pack.items ? "  items=" + pack.items : ""));
  console.log("manifest version " + manifest.version);
}

main();
