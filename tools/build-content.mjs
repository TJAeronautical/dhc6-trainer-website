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
import { fileURLToPath } from "node:url";
import { buildSystemsLabPack } from "./lib/systems-lab.mjs";
import { stripComments, findCalls, argMap, valDeclaration } from "./lib/kotlin-lite.mjs";

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const index = process.argv.indexOf("--" + name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

const androidRoot = arg("android", process.env.DHC6_ANDROID_REPO || "");
const outDir = path.resolve(arg("out", "build/content"));
// Optional: a flattened Kotlin export (robocopy of the *.kt sources) when the
// full module tree is not available, e.g. --kotlin "C:\Android Studio\DHC-6-Trainer\_web_export"
const kotlinRoot = arg("kotlin", process.env.DHC6_ANDROID_KOTLIN || "");
if (!androidRoot) {
  console.error("Missing --android <path to DHC-6-Trainer repo> (or DHC6_ANDROID_REPO env var)");
  process.exit(1);
}

const assetsRoot = fs.existsSync(path.join(androidRoot, "core-res", "src", "main", "assets"))
  ? path.join(androidRoot, "core-res", "src", "main", "assets")
  : androidRoot;

/* Kotlin sources that carry authored content (not just UI). Each entry lists the
   real module path first and the flattened `_web_export` path second. */
const KOTLIN_SOURCES = {
  glossary: [
    "feature-knowledge/src/main/java/com/dhc6trainer/feature/knowledge/ui/screens/GlossaryScreen.kt",
    "feature-knowledge/feature/knowledge/ui/screens/GlossaryScreen.kt"
  ],
  sortOrder: [
    "domain/src/main/java/com/dhc6trainer/domain/procedures/ProcedureSortOrder.kt",
    "domain/domain/procedures/ProcedureSortOrder.kt"
  ],
  procedureLibrary: [
    "feature-procedures/src/main/java/com/dhc6trainer/feature/procedures/ui/screens/ProcedureLibraryScreen.kt",
    "feature-procedures/feature/procedures/ui/screens/ProcedureLibraryScreen.kt"
  ],
  systemsLab: [
    "feature-knowledge/src/main/java/com/dhc6trainer/feature/knowledge/ui/screens/SystemsLabSection.kt",
    "feature-knowledge/feature/knowledge/ui/screens/SystemsLabSection.kt"
  ],
  systemsLabHome: [
    "feature-knowledge/src/main/java/com/dhc6trainer/feature/knowledge/ui/screens/SystemsLabHomeScreen.kt",
    "feature-knowledge/feature/knowledge/ui/screens/SystemsLabHomeScreen.kt"
  ],
  qrhEditorCatalog: [
    "feature-procedures/src/main/java/com/dhc6trainer/feature/procedures/ui/screens/QrhEditorCockpitCatalog.kt",
    "feature-procedures/feature/procedures/ui/screens/QrhEditorCockpitCatalog.kt"
  ],
  aircraftSystem: [
    "domain/src/main/java/com/dhc6trainer/domain/knowledge/model/AircraftSystem.kt",
    "domain/domain/knowledge/model/AircraftSystem.kt"
  ]
};

function findKotlin(key) {
  const roots = [kotlinRoot, androidRoot, path.join(androidRoot, "_web_export")].filter(Boolean);
  for (const root of roots) {
    for (const relative of KOTLIN_SOURCES[key]) {
      const full = path.join(root, relative);
      if (fs.existsSync(full)) return full;
    }
  }
  return null;
}

/* Extracts the string arguments of every `Name(...)` call in a Kotlin file.
   Handles plain "…" literals with \" \\ \n \t escapes and skips comments. */
function kotlinCallStrings(source, callName) {
  const results = [];
  let pos = 0;
  while (true) {
    const start = source.indexOf(callName + "(", pos);
    if (start === -1) break;
    let i = start + callName.length + 1;
    let depth = 1;
    const strings = [];
    let current = null;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (current !== null) {
        if (ch === "\\") {
          const next = source[i + 1];
          current += next === "n" ? "\n" : next === "t" ? "\t" : next;
          i += 2;
          continue;
        }
        if (ch === '"') {
          strings.push(current);
          current = null;
        } else {
          current += ch;
        }
        i += 1;
        continue;
      }
      if (ch === '"') {
        current = "";
      } else if (ch === "/" && source[i + 1] === "/") {
        i = source.indexOf("\n", i);
        if (i === -1) i = source.length;
        continue;
      } else if (ch === "(") {
        depth += 1;
      } else if (ch === ")") {
        depth -= 1;
      }
      i += 1;
    }
    results.push(strings);
    pos = i;
  }
  return results;
}

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

/* ------------------------------------------------ procedure ordering (Kotlin) */
// ProcedureTitleFormatter.formatProcedureDisplayTitle — ported 1:1.
const TITLE_ACRONYMS = new Set(["AC", "AFM", "APU", "CAS", "CB", "DC", "DHC", "ELT", "GPU", "IFR", "ITT",
  "MEL", "NG", "NP", "OEI", "PF", "PM", "POH", "PT6", "QRH", "RPM", "STOL", "T5", "TCAS", "TAWS", "VFR", "VMC", "VMO", "VREF"]);
function formatProcedureDisplayTitle(rawTitle) {
  const cleaned = String(rawTitle || "")
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\s*\[(ground|airborne|ground\/airborne|ground airborne|taxi|take off|takeoff|climb|cruise|descent|approach|landing|enroute|arrival|departure|normal|abnormal|emergency)[^\]]*\]\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "Procedure";
  return cleaned.toLowerCase().split(" ").filter(Boolean).map(function (word) {
    const upper = word.toUpperCase();
    if (TITLE_ACRONYMS.has(upper) || /^[A-Z]+[0-9]+$/.test(upper)) return upper;
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(" ");
}

// ProcedureSortOrder.normalizeTitle — ported 1:1.
function normalizeSortTitle(value) {
  return String(value || "").toUpperCase()
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/&/g, " AND ")
    .replace(/\//g, " ").replace(/-/g, " ").replace(/—/g, " ").replace(/–/g, " ")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ProcedureLibraryScreen.normalizeProcedureKey — ported 1:1.
function normalizeProcedureKey(raw) {
  return String(raw || "")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/ - /g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/* Parses `excelSequenceByCategory` from ProcedureSortOrder.kt into
   { NORMAL: Map<normalizedTitle, index>, ABNORMAL: …, EMERGENCY: … }. */
function loadSortOrder() {
  const file = findKotlin("sortOrder");
  const result = { NORMAL: new Map(), ABNORMAL: new Map(), EMERGENCY: new Map() };
  if (!file) {
    console.warn("  (ProcedureSortOrder.kt not found — QRH ranks fall back to source order)");
    return result;
  }
  const source = fs.readFileSync(file, "utf8");
  for (const category of Object.keys(result)) {
    const marker = "ProcedureCategory." + category + " to listOf(";
    const start = source.indexOf(marker);
    if (start === -1) continue;
    const lists = kotlinCallStrings(source.slice(start + marker.length - "listOf(".length), "listOf");
    (lists[0] || []).forEach(function (title, index) { result[category].set(normalizeSortTitle(title), index); });
  }
  return result;
}

/* Parses the `when (normalizeProcedureKey(…)) { "a", "b" -> VALUE … }` bodies
   of normalProcedureBucketFor / normalProcedureSortIndex in ProcedureLibraryScreen.kt. */
function kotlinWhenMap(source, functionName) {
  const map = new Map();
  const start = source.indexOf("fun " + functionName + "(");
  if (start === -1) return map;
  const whenStart = source.indexOf("when (", start);
  const bodyStart = source.indexOf("{", whenStart);
  let depth = 0;
  let end = bodyStart;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  const body = source.slice(bodyStart + 1, end);
  let pendingKeys = [];
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//")) continue;
    const keys = [];
    for (const m of line.matchAll(/"((?:[^"\\]|\\.)*)"/g)) keys.push(m[1]);
    pendingKeys = pendingKeys.concat(keys);
    const arrow = line.indexOf("->");
    if (arrow === -1) continue;
    const valueText = line.slice(arrow + 2).trim();
    if (line.startsWith("else")) { pendingKeys = []; continue; }
    const numeric = Number(valueText);
    const value = Number.isFinite(numeric) ? numeric : valueText.replace(/^NormalProcedureBucket\./, "");
    for (const key of pendingKeys) map.set(key, value);
    pendingKeys = [];
  }
  return map;
}

function loadNormalLibraryMaps() {
  const file = findKotlin("procedureLibrary");
  if (!file) {
    console.warn("  (ProcedureLibraryScreen.kt not found — normal buckets fall back to EVERYDAY_ACTIONS)");
    return { buckets: new Map(), sortIndex: new Map() };
  }
  const source = fs.readFileSync(file, "utf8");
  return {
    buckets: kotlinWhenMap(source, "normalProcedureBucketFor"),
    sortIndex: kotlinWhenMap(source, "normalProcedureSortIndex")
  };
}

/* ---------------------------------------------------------------- procedures */
function buildProcedures() {
  const sortOrder = loadSortOrder();
  const normalMaps = loadNormalLibraryMaps();
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
      const categoryKey = String(raw.category || category.toUpperCase()).toUpperCase();
      // Android: Procedure.procedureName = drillName.ifBlank { rawName }
      const procedureName = String(raw.drillName || "").trim() || String(raw.rawName || "").trim();
      const displayTitle = formatProcedureDisplayTitle(procedureName);
      const qrhRank = categoryKey === "NORMAL"
        ? (normalMaps.sortIndex.get(normalizeProcedureKey(procedureName)) ?? 999)
        : (sortOrder[categoryKey] && sortOrder[categoryKey].get(normalizeSortTitle(displayTitle))) ?? 9999;
      const normalBucket = categoryKey === "NORMAL"
        ? (normalMaps.buckets.get(normalizeProcedureKey(procedureName)) || "EVERYDAY_ACTIONS")
        : null;
      const procedure = {
        id: category + "/" + entry.slug,
        slug: entry.slug,
        category: categoryKey,
        title: raw.displayLabel || (binding && binding.title) || raw.drillName || raw.rawName,
        procedureName: procedureName,
        displayTitle: displayTitle,
        compiledId: categoryKey + "/" + procedureName.replace(/\s+/g, " ").trim(),
        qrhRank: qrhRank,
        normalBucket: normalBucket,
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
        procedureName: procedure.procedureName,
        displayTitle: procedure.displayTitle,
        compiledId: procedure.compiledId,
        qrhRank: procedure.qrhRank,
        normalBucket: procedure.normalBucket,
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
// BundledFlashcardSeeder.SYSTEM_ID_MAP — deck systemId → AircraftSystem enum.
const SYSTEM_ID_MAP = {
  electrical: "ELECTRICAL",
  fuel: "FUEL",
  hydraulics: "HYDRAULICS",
  powerplant: "POWERPLANT",
  propeller: "PROPELLER",
  fire_protection: "FIRE_PROTECTION",
  flight_controls: "FLIGHT_CONTROLS",
  ice_rain_protection: "ICE_RAIN_PROTECTION",
  performance: "PERFORMANCE"
};

// The Android FlashcardDeck Moshi model requires these fields; decks that
// miss any of them fail to parse on the device and never reach the UI.
const DECK_REQUIRED = ["schemaId", "schemaVersion", "deckId", "deckName", "description", "systemId", "variant", "difficulty"];
function validDecks() {
  const all = listJson("flashcards");
  const valid = [];
  const skipped = [];
  for (const entry of all) {
    const missing = DECK_REQUIRED.filter((key) => typeof entry.data[key] !== "string");
    if (missing.length) skipped.push({ file: entry.file, missing: missing });
    else valid.push(entry.data);
  }
  return { valid: valid, skipped: skipped };
}

function buildFlashcards() {
  const decks = validDecks();
  return {
    id: "flashcards",
    source: "DHC-6-Trainer core-res/src/main/assets/flashcards",
    deckCount: decks.valid.length,
    cardCount: decks.valid.reduce((sum, deck) => sum + (deck.cards || []).length, 0),
    skippedDecks: decks.skipped,
    decks: decks.valid.map((deck) => ({
      deckId: deck.deckId,
      deckName: deck.deckName,
      description: deck.description || "",
      systemId: deck.systemId,
      system: SYSTEM_ID_MAP[deck.systemId] || null,
      variant: deck.variant || "BOTH",
      difficulty: deck.difficulty || null,
      schemaVersion: deck.schemaVersion || null,
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

/* --------------------------------------------------------- knowledge pool */
// Mirrors the Room `knowledge_units` rows the Android app seeds on first run:
// BundledFlashcardSeeder (every card of every mapped deck, tagged
// STATUS:CANDIDATE,BUNDLED,<SYSTEM>) plus the offline quiz_bank.json questions.
// QuizRun / SrsStudy pick from exactly this pool (STATUS:CANDIDATE).
function buildKnowledgePool() {
  const decks = validDecks().valid;
  const units = [];
  for (const systemId of Object.keys(SYSTEM_ID_MAP)) {
    const system = SYSTEM_ID_MAP[systemId];
    for (const deck of decks.filter((d) => d.systemId === systemId)) {
      const variant = ["LEGACY", "G950"].includes(String(deck.variant || "").toUpperCase()) ? deck.variant.toUpperCase() : "BOTH";
      for (const card of deck.cards || []) {
        const locator = (card.references && card.references[0] && card.references[0].locator) || "";
        units.push({
          id: "bundled_" + deck.deckId + "_" + card.id,
          system: system,
          title: card.front,
          content: card.back,
          importance: "CORE",
          examRelevant: true,
          aircraftVariant: variant,
          sourceId: "bundled_deck_" + deck.deckId,
          sourceType: "AFM_POH",
          sourceTitle: deck.deckName,
          sourceRevision: deck.schemaVersion || null,
          sectionRef: locator || null,
          tags: ["STATUS:CANDIDATE", "BUNDLED", systemId.toUpperCase()]
        });
      }
    }
  }
  const bank = readJson("quizzes/quiz_bank.json");
  for (const q of bank.questions || []) {
    units.push({
      id: q.id,
      system: q.system || "GENERAL",
      title: q.title,
      content: q.content,
      importance: q.importanceLevel || "CORE",
      examRelevant: true,
      aircraftVariant: ["LEGACY", "G950"].includes(String(q.aircraftVariant || "").toUpperCase()) ? q.aircraftVariant.toUpperCase() : "BOTH",
      sourceId: "quiz_bank",
      sourceType: "AFM_POH",
      sourceTitle: bank.source || "Quiz bank",
      sourceRevision: bank.schemaVersion || null,
      sectionRef: null,
      tags: Array.isArray(q.tags) && q.tags.length ? q.tags : ["STATUS:CANDIDATE", "SOURCE:QUIZ_BANK"]
    });
  }
  return {
    id: "knowledge-pool",
    source: "DHC-6-Trainer flashcards/* (BundledFlashcardSeeder) + quizzes/quiz_bank.json",
    count: units.length,
    units: units
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

/* ------------------------------------------------------------------ glossary */
// The Definitions screen keeps its entries as Kotlin literals
// (private val glossaryEntries = listOf(GlossaryEntry("AFM", "Aircraft Flight Manual", "…"))).
function buildGlossary() {
  const file = findKotlin("glossary");
  if (!file) {
    console.warn("  (glossary skipped: GlossaryScreen.kt not found — pass --kotlin <dir> or use the full repo)");
    return null;
  }
  const source = fs.readFileSync(file, "utf8");
  const listStart = source.indexOf("glossaryEntries = listOf(");
  const body = listStart === -1 ? source : source.slice(listStart);
  const entries = kotlinCallStrings(body, "GlossaryEntry")
    .filter((strings) => strings.length === 3)
    .map((strings) => ({ acronym: strings[0], definition: strings[1], note: strings[2] }));
  return {
    id: "glossary",
    source: "DHC-6-Trainer feature-knowledge …/ui/screens/GlossaryScreen.kt",
    count: entries.length,
    entries: entries
  };
}

/* ------------------------------------------------------------- qrh editor */
// The manual QRH editor's control palette: canonical cockpit control ids, their
// valid position labels and aliases, plus the PF/PM callout starter templates.
// Extracted from QrhEditorCockpitCatalog.kt so the web never retypes them.
function buildQrhEditorCatalog() {
  const file = findKotlin("qrhEditorCatalog");
  if (!file) {
    console.warn("  (qrh-editor skipped: QrhEditorCockpitCatalog.kt not found — pass --kotlin <dir> or use the full repo)");
    return null;
  }
  const source = stripComments(fs.readFileSync(file, "utf8"));

  const controls = findCalls(source, "ControlEntry").map(function (call) {
    const args = argMap(call);
    return {
      controlId: args.controlId,
      displayName: args.displayName,
      positions: Array.isArray(args.positions) ? args.positions : [],
      aliases: Array.isArray(args.aliases) ? args.aliases : []
    };
  }).filter(function (c) { return typeof c.controlId === "string" && c.controlId; });

  function templates(listName) {
    const declaration = valDeclaration(source, listName);
    if (!declaration) return [];
    return findCalls(declaration, "CalloutTemplate").map(function (call) {
      const args = argMap(call);
      const kind = args.itemKind && args.itemKind.ident ? String(args.itemKind.ident).split(".").pop() : "GENERIC";
      return { label: args.label, roleTag: args.roleTag, writtenStep: args.writtenStep, itemKind: kind };
    }).filter(function (t) { return t.label && t.writtenStep; });
  }

  const memoryCallouts = templates("MemoryCallouts");
  const flowCallouts = templates("FlowCallouts");
  if (!controls.length) return null;
  return {
    id: "qrh-editor",
    source: "DHC-6-Trainer feature-procedures …/ui/screens/QrhEditorCockpitCatalog.kt",
    count: controls.length,
    controls: controls,
    memoryCallouts: memoryCallouts,
    flowCallouts: flowCallouts
  };
}

/* -------------------------------------------------------------- systems lab */
// Technical Lab: authored part pins, faults, drill prompts and the live-readout
// simulation come from SystemsLabSection.kt; the model registry maps the
// DHC6_REFERENCE_LIBRARY/System-Lab GLB files (served via /api/media) onto them.
function buildSystemsLab() {
  const section = findKotlin("systemsLab");
  const home = findKotlin("systemsLabHome");
  const aircraftSystem = findKotlin("aircraftSystem");
  if (!section || !home || !aircraftSystem) {
    console.warn("  (systems-lab skipped: SystemsLabSection.kt / SystemsLabHomeScreen.kt / AircraftSystem.kt not found — pass --kotlin <dir> or use the full repo)");
    return null;
  }
  const registry = JSON.parse(fs.readFileSync(path.join(TOOLS_DIR, "data", "systems-lab-models.json"), "utf8"));
  return buildSystemsLabPack({
    sectionSource: fs.readFileSync(section, "utf8"),
    homeSource: fs.readFileSync(home, "utf8"),
    aircraftSystemSource: fs.readFileSync(aircraftSystem, "utf8"),
    registry: registry
  });
}

/* -------------------------------------------------------------- cockpit pack */
// The cockpit plate geometry (hitboxes, sprite scales, atlas frames) is produced by
// tools/build-cockpit.mjs, which also writes the imagery that build-media.mjs
// uploads. It is a separate step because it needs the `sharp` image library.
function readCockpitPack() {
  const file = path.resolve(arg("cockpit-pack", "build/cockpit/cockpit-pack.json"));
  if (!fs.existsSync(file)) {
    console.warn("  (cockpit-plates skipped: " + file + " not found — run `node tools/build-cockpit.mjs --android <repo>` first)");
    return null;
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/* ----------------------------------------------------------------------- main */
function main() {
  const packs = Object.assign({}, buildProcedures());
  packs.flashcards = buildFlashcards();
  packs["quiz-bank"] = passthrough("quiz-bank", "quizzes/quiz_bank.json");
  packs["knowledge-pool"] = buildKnowledgePool();
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
  const glossary = buildGlossary();
  if (glossary) packs.glossary = glossary;
  const systemsLab = buildSystemsLab();
  if (systemsLab) packs["systems-lab"] = systemsLab;
  const cockpit = readCockpitPack();
  if (cockpit) packs["cockpit-plates"] = cockpit;
  const qrhEditor = buildQrhEditorCatalog();
  if (qrhEditor) packs["qrh-editor"] = qrhEditor;

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
