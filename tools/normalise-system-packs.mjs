#!/usr/bin/env node
/*
  Normalise the authored system-description packs to the shape Android parses.

  THE DEFECT. `SystemDescription.kt` and assets/schema/system_description.schema.json
  model one shape. Only electrical.json is written in it. The other nineteen packs
  use `name` for a control with plain-string positions, and `parameter` + `note`
  for a limit, so Moshi throws and the AFM/FCTM card silently disappears on
  Android. The web reads both shapes as written (app/js/logic/systems2d.js), which
  is why the browser app has always shown them and the phone has not.

  WHAT THIS IS ALLOWED TO DO. Rename keys. Restructure a positions array from
  strings to objects, carrying each string through as its label. Nothing else.

  WHAT IT WILL NOT DO, EVER. Write an aviation value, fill a required field with
  a default, or guess a regulatory status. `regulatoryStatus` separates an
  AFM-approved number from operator guidance; a pack that does not state it must
  not be made to claim one, and there is no rename that can produce it. Packs
  still incomplete after the renames are REPORTED, with the exact field and the
  exact file, and left alone for you to author.

  So expect this to fix the mechanical half and hand you a short list of the
  half only you can answer. That is the honest outcome, not a shortfall.

  USAGE
    node tools/normalise-system-packs.mjs --android "C:\\path\\to\\DHC-6-Trainer"
    node tools/normalise-system-packs.mjs --android "..." --write
    node tools/normalise-system-packs.mjs --android "..." --check-kotlin

  Dry run by default: it prints what it would change and writes nothing. Add
  --write to apply, which also leaves a .bak beside every file it rewrites.
*/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAssetBasenames, readSystemTaxonomy } from "./lib/systems-2d.mjs";

function arg(name, fallback) {
  const index = process.argv.indexOf("--" + name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}
const has = (name) => process.argv.indexOf("--" + name) > -1;

/* ------------------------------------------------------------------ rules */

/*
  Every rename, in one table, because a rule that lives in a table can be read
  and argued with. `from` is the key the nineteen packs use; `to` is the key the
  schema and the Kotlin data class demand.
*/
export const CONTROL_RENAMES = [
  { from: "name", to: "label" }
];

export const LIMIT_RENAMES = [
  { from: "parameter", to: "name" },
  { from: "note", to: "condition" }
];

/*
  Fields the conforming shape has that no rename can produce. Listed so the
  report can name them rather than the tool inventing them.

  `rationale` is prose and could in principle be left absent. `regulatoryStatus`
  is the safety-critical one: absent means unstated, and unstated must never
  become AFM_APPROVED by default.
*/
export const UNAUTHORED_LIMIT_FIELDS = ["rationale", "regulatoryStatus"];

export const REGULATORY_VALUES = ["AFM_APPROVED", "OPERATOR_GUIDANCE", "MANUFACTURER_RECOMMENDED"];

/* -------------------------------------------------------------- transform */

function renameKeys(object, renames) {
  const out = {};
  const applied = [];
  Object.keys(object || {}).forEach(function (key) {
    const rule = renames.find(function (r) { return r.from === key; });
    if (!rule) { out[key] = object[key]; return; }
    /* A pack that already carries the target key is already conforming for
       this field; renaming onto it would silently drop one of the two. */
    if (Object.prototype.hasOwnProperty.call(object, rule.to)) {
      out[key] = object[key];
      applied.push({ from: rule.from, to: rule.to, skipped: "both keys present" });
      return;
    }
    out[rule.to] = object[key];
    applied.push({ from: rule.from, to: rule.to });
  });
  return { value: out, applied: applied };
}

/*
  Positions: ["ON", "OFF"] -> [{ label: "ON" }, { label: "OFF" }]

  A shape change, not a value change: each string is carried through untouched
  as its label. No `behaviour` key is added - the schema may or may not require
  one, and an empty string is a value this tool did not get from the source.
*/
export function normalisePositions(positions) {
  if (!Array.isArray(positions)) return { value: positions, changed: false };
  let changed = false;
  const value = positions.map(function (entry) {
    if (entry && typeof entry === "object") return entry;
    changed = true;
    return { label: String(entry) };
  });
  return { value: value, changed: changed };
}

/*
  Normalise one parsed pack. Returns the new object plus everything that
  happened, so the caller can report it without re-deriving anything.
*/
export function normalisePack(pack) {
  const notes = [];
  const gaps = [];
  let changed = false;

  const out = Object.assign({}, pack);

  if (Array.isArray(pack && pack.controls)) {
    out.controls = pack.controls.map(function (control, index) {
      const renamed = renameKeys(control, CONTROL_RENAMES);
      renamed.applied.forEach(function (a) {
        if (a.skipped) notes.push("controls[" + index + "]: kept both " + a.from + " and " + a.to + " (" + a.skipped + ")");
        else { changed = true; notes.push("controls[" + index + "]: " + a.from + " -> " + a.to); }
      });
      const positions = normalisePositions(renamed.value.positions);
      if (positions.changed) {
        changed = true;
        notes.push("controls[" + index + "]: positions from strings to { label }");
      }
      const next = Object.assign({}, renamed.value);
      if (renamed.value.positions !== undefined) next.positions = positions.value;
      if (!next.label) gaps.push({ path: "controls[" + index + "].label", why: "no label and no name to rename from" });
      return next;
    });
  }

  if (Array.isArray(pack && pack.limits)) {
    out.limits = pack.limits.map(function (limit, index) {
      const renamed = renameKeys(limit, LIMIT_RENAMES);
      renamed.applied.forEach(function (a) {
        if (a.skipped) notes.push("limits[" + index + "]: kept both " + a.from + " and " + a.to + " (" + a.skipped + ")");
        else { changed = true; notes.push("limits[" + index + "]: " + a.from + " -> " + a.to); }
      });
      const next = renamed.value;
      if (!next.name) gaps.push({ path: "limits[" + index + "].name", why: "no name and no parameter to rename from" });
      UNAUTHORED_LIMIT_FIELDS.forEach(function (field) {
        if (next[field] === undefined) {
          gaps.push({
            path: "limits[" + index + "]." + field,
            why: field === "regulatoryStatus"
              ? "not stated in the source; must be authored, never defaulted (one of: " + REGULATORY_VALUES.join(", ") + ")"
              : "not stated in the source; must be authored"
          });
        }
      });
      if (next.regulatoryStatus !== undefined && REGULATORY_VALUES.indexOf(String(next.regulatoryStatus)) === -1) {
        gaps.push({ path: "limits[" + index + "].regulatoryStatus", why: "value " + JSON.stringify(next.regulatoryStatus) + " is not one the schema allows" });
      }
      return next;
    });
  }

  return { pack: out, changed: changed, notes: notes, gaps: gaps };
}

/* ------------------------------------------------------------- the schema

   The question the first run could not answer.

   Every gap the renames leave behind is `rationale` or `regulatoryStatus`.
   Whether that matters depends entirely on one thing: does
   assets/schema/system_description.schema.json REQUIRE them? If they are
   optional, the renames finish the job and the gap list is a note for later.
   If they are required, each one genuinely blocks the pack from parsing and
   there is authoring to do.

   Guessing either way would be useless, so this reads the real schema. It is
   not a full JSON Schema validator - it extracts the `required` arrays and the
   regulatoryStatus enum, which is what decides the question.
*/
export function findSchema(assetsRoot) {
  const candidates = [
    path.join(assetsRoot, "schema", "system_description.schema.json"),
    path.join(assetsRoot, "schemas", "system_description.schema.json"),
    path.join(assetsRoot, "system_description.schema.json")
  ];
  return candidates.find(function (file) { return fs.existsSync(file); }) || null;
}

/*
  Walk a schema for the object that describes an array member, wherever the
  author nested it. Schemas get restructured; hunting for the shape rather than
  a fixed path means a moved definition is found instead of silently reported
  as "no requirements".
*/
export function requirementsFor(schema, arrayKey, marker) {
  let found = null;
  const seen = new Set();
  const walk = function (node) {
    if (found || !node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { node.forEach(walk); return; }

    const items = node[arrayKey] && node[arrayKey].items;
    const props = items && items.properties;
    if (props && marker.some(function (key) { return Object.prototype.hasOwnProperty.call(props, key); })) {
      found = items;
      return;
    }
    Object.keys(node).forEach(function (key) { walk(node[key]); });
  };
  walk(schema);
  if (!found) return null;
  return {
    required: Array.isArray(found.required) ? found.required.slice() : [],
    properties: Object.keys(found.properties || {}),
    enums: Object.keys(found.properties || {}).reduce(function (out, key) {
      const values = found.properties[key] && found.properties[key].enum;
      if (Array.isArray(values)) out[key] = values.slice();
      return out;
    }, {})
  };
}

export function readSchemaRules(schema) {
  return {
    controls: requirementsFor(schema, "controls", ["label", "name"]),
    limits: requirementsFor(schema, "limits", ["name", "parameter", "value"])
  };
}

/* Split the gap list by whether the schema actually demands the field. */
export function classifyGaps(gaps, rules) {
  const required = function (group) {
    const set = rules && rules[group];
    return set && set.required ? set.required : null;
  };
  return (gaps || []).map(function (gap) {
    const group = gap.path.indexOf("limits[") === 0 ? "limits" : "controls";
    const field = gap.path.slice(gap.path.lastIndexOf(".") + 1);
    const list = required(group);
    /* Unknown is not the same as optional, and must not read as reassurance. */
    const blocking = list === null ? null : list.indexOf(field) >= 0;
    return Object.assign({}, gap, { field: field, blocking: blocking });
  });
}

/* ------------------------------------------------------ the Android side

   Two of the phase-5 findings are not in the JSON at all - they are in Kotlin,
   and this repository already detects them because tools/lib/systems-2d.mjs has
   to work around them to build the web pack. Rather than duplicating that, this
   reports the exact edits, read-only.

   It cannot apply them: they belong to the Android repository and I have no way
   to compile or run that here. Treat the output as a list to apply and test in
   Android Studio, not as a change that has been made.
*/
export function basenameGaps(repositorySource, aircraftSystemSource) {
  const basenames = readAssetBasenames(repositorySource);
  const taxonomy = readSystemTaxonomy(aircraftSystemSource);
  const out = [];
  (taxonomy.members || []).forEach(function (member) {
    const expected = member.toLowerCase();
    const mapped = basenames[member];
    if (mapped === expected) return;
    out.push({
      system: member,
      mapped: mapped || null,
      expected: expected,
      line: "AircraftSystem." + member + ' to "' + expected + '",',
      why: mapped
        ? 'mapped to "' + mapped + '", so systems/' + expected + ".json is never loaded"
        : "no entry at all, so systems/" + expected + ".json is never loaded"
    });
  });
  return out;
}

function reportKotlin(kotlinRoot) {
  const find = function (name) {
    const stack = [kotlinRoot];
    while (stack.length) {
      const dir = stack.pop();
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (error) { continue; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.name === name) return full;
      }
    }
    return null;
  };

  const repo = find("SystemContentRepository.kt");
  const system = find("AircraftSystem.kt");
  if (!repo || !system) {
    console.log("\n--- Android map check skipped ---");
    console.log("  Could not find " + (repo ? "AircraftSystem.kt" : "SystemContentRepository.kt") + " under " + kotlinRoot);
    return;
  }

  let gaps;
  try {
    gaps = basenameGaps(fs.readFileSync(repo, "utf8"), fs.readFileSync(system, "utf8"));
  } catch (error) {
    console.log("\n--- Android map check failed: " + error.message + " ---");
    return;
  }

  console.log("\n--- SYSTEM_TO_ASSET_BASENAME ---");
  if (!gaps.length) {
    console.log("  Every system maps to its own file. Nothing to do.");
    return;
  }
  console.log("  " + gaps.length + " system" + (gaps.length === 1 ? " does" : "s do") + " not map to their own pack file.");
  console.log("  These are Kotlin edits - apply and test them in Android Studio; this tool");
  console.log("  has changed nothing here.\n");
  gaps.forEach(function (gap) {
    console.log("  " + gap.system);
    console.log("      " + gap.why);
    console.log("      add/replace:  " + gap.line);
  });
}

/* ------------------------------------------------------------------- main */

function findPacks(assetsRoot) {
  const candidates = [
    path.join(assetsRoot, "systems", "descriptions"),
    path.join(assetsRoot, "system_descriptions"),
    path.join(assetsRoot, "systems")
  ];
  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(function (f) { return f.endsWith(".json"); });
    if (files.length) return { dir: dir, files: files.map(function (f) { return path.join(dir, f); }) };
  }
  return null;
}

function main() {
  const androidRoot = arg("android", process.env.DHC6_ANDROID_REPO || "");
  if (!androidRoot) {
    console.error("Missing --android <path to DHC-6-Trainer repo> (or DHC6_ANDROID_REPO env var)");
    process.exit(1);
  }
  const assetsRoot = fs.existsSync(path.join(androidRoot, "core-res", "src", "main", "assets"))
    ? path.join(androidRoot, "core-res", "src", "main", "assets")
    : androidRoot;

  const found = findPacks(assetsRoot);
  if (!found) {
    console.error("No system-description packs found under " + assetsRoot);
    console.error("Looked in: systems/descriptions, system_descriptions, systems");
    console.error("Pass the directory directly with --dir if it lives somewhere else.");
    process.exit(1);
  }

  const explicit = arg("dir", "");
  const files = explicit
    ? fs.readdirSync(explicit).filter(function (f) { return f.endsWith(".json"); }).map(function (f) { return path.join(explicit, f); })
    : found.files;

  const write = has("write");

  /* The schema decides whether the leftover gaps matter at all. */
  let rules = null;
  const schemaPath = findSchema(assetsRoot);
  if (schemaPath) {
    try { rules = readSchemaRules(JSON.parse(fs.readFileSync(schemaPath, "utf8").replace(/^\uFEFF/, ""))); }
    catch (error) { rules = null; }
  }

  let changedCount = 0;
  let gapCount = 0;
  const stillIncomplete = [];

  console.log((write ? "APPLYING" : "DRY RUN - nothing will be written") + "  (" + files.length + " packs in " + (explicit || found.dir) + ")\n");

  files.forEach(function (file) {
    const name = path.basename(file);
    let raw, parsed;
    try {
      raw = fs.readFileSync(file, "utf8");
      parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
    } catch (error) {
      console.log("  " + name + ": UNREADABLE - " + error.message);
      return;
    }

    const result = normalisePack(parsed);
    if (result.changed) {
      changedCount++;
      console.log("  " + name);
      result.notes.forEach(function (note) { console.log("      " + note); });
      if (write) {
        fs.writeFileSync(file + ".bak", raw);
        /* Two-space JSON with a trailing newline, which is what the authored
           packs already use - a reformat would bury the real diff. */
        fs.writeFileSync(file, JSON.stringify(result.pack, null, 2) + "\n");
      }
    }

    if (result.gaps.length) {
      gapCount += result.gaps.length;
      stillIncomplete.push({ name: name, gaps: result.gaps });
    }
  });

  console.log("\n" + changedCount + " pack" + (changedCount === 1 ? "" : "s") + " " + (write ? "rewritten" : "would be rewritten"));

  if (stillIncomplete.length) {
    const classified = stillIncomplete.map(function (entry) {
      return { name: entry.name, gaps: classifyGaps(entry.gaps, rules) };
    });
    const blocking = classified.reduce(function (n, e) {
      return n + e.gaps.filter(function (g) { return g.blocking === true; }).length;
    }, 0);
    const unknown = rules === null || !rules.limits;

    console.log("\n--- Fields no rename can produce: " + gapCount + " in " + stillIncomplete.length + " pack" + (stillIncomplete.length === 1 ? "" : "s") + " ---");

    if (unknown) {
      console.log("  Could not read the schema" + (schemaPath ? " at " + schemaPath : "") + ", so whether these");
      console.log("  block parsing is unknown. Not assuming they are optional.");
    } else if (blocking === 0) {
      /* The answer that changes everything: the renames were the whole job. */
      console.log("  NONE OF THEM BLOCK PARSING. The schema at");
      console.log("  " + schemaPath);
      console.log("  requires only: " + rules.limits.required.join(", ") + " on a limit" +
        (rules.controls ? ", " + rules.controls.required.join(", ") + " on a control" : "") + ".");
      console.log("  So --write finishes the job and these are a note for later, not a blocker.");
    } else {
      console.log("  " + blocking + " of them are REQUIRED by the schema and genuinely block parsing.");
      console.log("  The rest are optional and can wait.");
    }
    console.log("  Nothing here has been guessed.\n");

    classified.forEach(function (entry) {
      const show = unknown ? entry.gaps : entry.gaps.filter(function (g) { return g.blocking !== false; });
      if (!show.length) return;
      console.log("  " + entry.name);
      show.forEach(function (gap) {
        console.log("      " + (gap.blocking === true ? "BLOCKING  " : "") + gap.path + "  -  " + gap.why);
      });
    });

    if (!unknown && blocking === 0) {
      console.log("  (every gap is optional, so none are listed individually)");
    }
  }

  const kotlinRoot = arg("kotlin", process.env.DHC6_ANDROID_KOTLIN || "");
  if (kotlinRoot) reportKotlin(kotlinRoot);
  else if (has("check-kotlin")) reportKotlin(androidRoot);

  if (!write && changedCount) {
    console.log("\nRe-run with --write to apply. Each rewritten file keeps a .bak beside it.");
  }
}

/*
  Do two spellings name the same file?

  This is the part that was broken, so it is the part worth testing. The entry
  guard compared process.argv[1] against `new URL(import.meta.url).pathname`,
  which on Windows is "/C:/Android%20Studio/..." - a leading slash, forward
  slashes and a percent-encoded space - against argv's
  "C:\Android Studio\...". They never matched, main() never ran, and node exited
  0: three commands, no output, no error, no packs normalised. On Linux the two
  spellings happen to agree, which is exactly why every test passed.

  Normalising all four differences means the guard now holds whichever spelling
  it is handed, rather than depending on one call being written correctly. And
  it can be tested with Windows inputs from any platform, which a regex over
  this file's own source could not do honestly.
*/
export function samePath(a, b) {
  const norm = function (value) {
    let text = String(value == null ? "" : value);
    try { text = decodeURIComponent(text); } catch (error) { /* leave as-is */ }
    return text
      .replace(/\\/g, "/")
      .replace(/^\/(?=[A-Za-z]:)/, "")
      .replace(/\/+$/, "")
      .toLowerCase();
  };
  const left = norm(a);
  return Boolean(left) && left === norm(b);
}

export function isDirectRun(argv1, metaUrl) {
  if (!argv1) return false;
  let here;
  try { here = fileURLToPath(metaUrl); } catch (error) { here = String(metaUrl).replace(/^file:\/\//, ""); }
  /* Resolve only a relative argv - `node tools/x.mjs` - since path.resolve
     cannot normalise a foreign platform's absolute path. */
  const invoked = path.isAbsolute(argv1) || /^[A-Za-z]:[\\/]/.test(argv1) ? argv1 : path.resolve(argv1);
  return samePath(invoked, here);
}

if (isDirectRun(process.argv[1], import.meta.url)) {
  main();
}
