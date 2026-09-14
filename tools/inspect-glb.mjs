/*
  Read a GLB and report what the registry needs to know about it.

  WHY THIS EXISTS

  Adding a model to tools/data/systems-lab-models.json needs six measured
  numbers - bytes, sha256, nodes, meshes, triangles, animations - and, more
  importantly, the model's NODE NAMES, because every `parts`, `hidden` and
  `extraParts` entry is a node-name selector. Without the names those selectors
  can only be guessed, and a guessed selector is a part that silently never
  highlights.

  Until now nothing in this repository could read them. build-media.mjs measures
  bytes and sha256 and stops there; the registry's node counts were measured by
  hand, once, somewhere else. That is why the flap entry could sit for weeks
  claiming 187 nodes while pointing at a 243 KB Android stub: the numbers and
  the file had no way of being compared.

  So this reads the file and says what is actually in it. It never writes
  anything - not the registry, not the models. What it prints is what a person
  or a later tool authors FROM.

  USAGE

    node tools/inspect-glb.mjs --dir "C:\\...\\DHC6_REFERENCE_LIBRARY\\System-Lab"
    node tools/inspect-glb.mjs --dir <path> --registry tools/data/systems-lab-models.json
    node tools/inspect-glb.mjs --file <one.glb> --names            # every node name
    node tools/inspect-glb.mjs --dir <path> --names --match FLAP   # names matching

  With --registry it also reconciles: which files the registry does not use,
  which entries point at a file that is not there, and which entries declare
  numbers the file disagrees with.
*/

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
/* The app's own matcher, so "does this selector resolve" is answered with the
   same semantics the Technical Lab uses rather than a second implementation
   that agrees with it right up until it doesn't. */
import { selectorMatches, clipSelectorMatches } from "../app/js/logic/systemslab.js";

export const GLB_MAGIC = 0x46546c67;        /* "glTF" */
export const CHUNK_JSON = 0x4e4f534a;
export const CHUNK_BIN = 0x004e4942;

/* ------------------------------------------------------------------ parsing */

/*
  Walk the chunk table. Returns { ok:false, reason } rather than throwing: this
  runs over a directory, and one bad file must not stop the other twenty.
*/
export function parseGlb(bytes) {
  if (!bytes || bytes.byteLength < 12) return { ok: false, reason: "shorter than a GLB header" };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) return { ok: false, reason: "not a GLB (bad magic)" };

  const declared = view.getUint32(8, true);
  const chunks = [];
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + length > bytes.byteLength) {
      return { ok: false, reason: "a chunk runs past the end of the file", chunks: chunks };
    }
    chunks.push({ type: type, start: start, length: length });
    offset = start + length;
  }
  return {
    ok: true,
    version: view.getUint32(4, true),
    declaredLength: declared,
    actualLength: bytes.byteLength,
    chunks: chunks
  };
}

export function gltfJson(bytes) {
  const parsed = parseGlb(bytes);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const chunk = (parsed.chunks || []).find(function (c) { return c.type === CHUNK_JSON; });
  if (!chunk) return { ok: false, reason: "no JSON chunk" };
  try {
    const text = new TextDecoder().decode(bytes.subarray(chunk.start, chunk.start + chunk.length));
    return { ok: true, gltf: JSON.parse(text), header: parsed };
  } catch (error) {
    return { ok: false, reason: "the JSON chunk is not valid JSON" };
  }
}

/*
  Triangles, counted the way a renderer would.

  Primitive mode 4 is TRIANGLES and is the default when `mode` is absent; 5 and
  6 are strips and fans, where n vertices make n-2 triangles. Anything else
  (points, lines) contributes none. An indexed primitive counts its indices, an
  unindexed one its positions - guessing either way would produce a number that
  looks authoritative and is not.
*/
export function trianglesIn(gltf) {
  const accessors = gltf.accessors || [];
  let total = 0;
  (gltf.meshes || []).forEach(function (mesh) {
    (mesh.primitives || []).forEach(function (primitive) {
      const mode = primitive.mode === undefined ? 4 : primitive.mode;
      if (mode !== 4 && mode !== 5 && mode !== 6) return;
      const source = primitive.indices !== undefined
        ? accessors[primitive.indices]
        : accessors[(primitive.attributes || {}).POSITION];
      const count = source && Number(source.count);
      if (!Number.isFinite(count) || count < 3) return;
      total += mode === 4 ? Math.floor(count / 3) : count - 2;
    });
  });
  return total;
}

export function summarise(bytes) {
  const read = gltfJson(bytes);
  if (!read.ok) return { ok: false, reason: read.reason };
  const gltf = read.gltf;
  const nodes = gltf.nodes || [];
  return {
    ok: true,
    bytes: bytes.byteLength,
    declaredLength: read.header.declaredLength,
    /* A stamped model is longer than its header says only if something has gone
       wrong - our own stamp bumps the header. Worth surfacing either way. */
    trailingBytes: bytes.byteLength - read.header.declaredLength,
    nodes: nodes.length,
    meshes: (gltf.meshes || []).length,
    triangles: trianglesIn(gltf),
    animations: (gltf.animations || []).map(function (a, i) { return a.name || "(unnamed " + i + ")"; }),
    nodeNames: nodes.map(function (n, i) { return n.name || "(unnamed " + i + ")"; }),
    /* Nodes with no parent: the scene roots, which is where a selector usually
       starts and the most useful short list to read. */
    rootNames: rootNodeNames(gltf)
  };
}

export function rootNodeNames(gltf) {
  const nodes = gltf.nodes || [];
  const childOf = new Set();
  nodes.forEach(function (node) { (node.children || []).forEach(function (c) { childOf.add(c); }); });
  return nodes
    .map(function (n, i) { return { name: n.name || "(unnamed " + i + ")", index: i }; })
    .filter(function (entry) { return !childOf.has(entry.index); })
    .map(function (entry) { return entry.name; });
}

export function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

/* ------------------------------------------------------------ reconciliation */

/*
  What the registry says against what the files say.

  `measured` is a map of filename -> summarise() result (plus sha256). Three
  kinds of disagreement, kept separate because they mean different things:

    missing   an entry points at a file that is not there    (trim-control, once)
    unused    a file nobody references                        (the full aircraft)
    mismatch  an entry's declared numbers are not the file's  (the flap stub)
*/
export function reconcile(registry, measured) {
  const models = (registry && registry.models) || [];
  const byFile = new Map(models.map(function (m) { return [m.file, m]; }));

  const missing = models
    .filter(function (m) { return !measured[m.file]; })
    .map(function (m) { return { id: m.id, file: m.file }; });

  const unused = Object.keys(measured)
    .filter(function (file) { return !byFile.has(file); })
    .sort();

  const mismatch = [];
  models.forEach(function (model) {
    const actual = measured[model.file];
    if (!actual || !actual.ok) return;
    const fields = [];
    [["bytes", "bytes"], ["sha256", "sha256"], ["nodes", "nodes"], ["meshes", "meshes"], ["triangles", "triangles"]]
      .forEach(function (pair) {
        const declared = model[pair[0]];
        const found = actual[pair[1]];
        if (declared !== undefined && found !== undefined && declared !== found) {
          fields.push({ field: pair[0], declared: declared, actual: found });
        }
      });
    const declaredAnimations = (model.animations || []).slice().sort();
    const actualAnimations = (actual.animations || []).slice().sort();
    if (model.animations && declaredAnimations.join("|") !== actualAnimations.join("|")) {
      fields.push({ field: "animations", declared: declaredAnimations.length, actual: actualAnimations.length });
    }
    if (fields.length) mismatch.push({ id: model.id, file: model.file, fields: fields });
  });

  return { missing: missing, unused: unused, mismatch: mismatch };
}

/* ------------------------------------------------------- selector resolution */

/*
  Every selector a model declares, and whether it still finds a node.

  This is the question a re-exported library actually raises. The numbers
  changing is expected - somebody re-exported. What is NOT visible from the
  numbers is whether the node NAMES changed with them, and a `parts` entry that
  no longer matches anything is a pin that silently stops highlighting. No
  error, no warning: the part is simply never found, and the only symptom is a
  pilot tapping a dot and nothing happening.

  Returns { model, total, dead: [{ where, selector }] }. `dead` is the list to
  re-author; everything else survived the re-export.
*/
export function selectorsOf(model) {
  const out = [];
  Object.keys(model.parts || {}).forEach(function (part) {
    (model.parts[part] || []).forEach(function (selector) {
      out.push({ where: "parts." + part, selector: selector });
    });
  });
  (model.hidden || []).forEach(function (selector) {
    out.push({ where: "hidden", selector: selector });
  });
  (model.extraParts || []).forEach(function (extra, i) {
    (extra.selectors || []).forEach(function (selector) {
      out.push({ where: "extraParts[" + (extra.id || i) + "]", selector: selector });
    });
  });
  return out;
}

export function checkSelectors(model, nodeNames) {
  const names = nodeNames || [];
  const all = selectorsOf(model);
  const dead = all.filter(function (entry) {
    return !names.some(function (name) { return selectorMatches(entry.selector, name); });
  });
  return { model: model.id, file: model.file, total: all.length, dead: dead };
}

/*
  A dead selector is not one thing, and reporting it as one thing cost a whole
  read of the last run.

  `parts` and `extraParts` are PINS. A dead one is a dot on the model that a
  pilot can tap and that does nothing - visible, wrong, and silent.

  `hidden` is a HYGIENE RULE. It exists to keep archive, donor, placeholder and
  label nodes out of the view. A dead one means the junk it was written to hide
  is no longer in the file: the rule is inert, and the export got cleaner. That
  is the opposite of a fault.

  The first run of this tool reported 32 dead selectors on a library where 24
  of them were cleanups. Anything that does not resolve to exactly "hidden" is
  classed as broken, so a shape nobody has thought of yet errs toward being
  looked at rather than dismissed.
*/
export function severityOf(where) {
  const w = String(where);
  /* Inert: nothing a user can activate depends on it.
       hidden        a rule whose junk the export already removed
       clips         a label for a clip that is gone; the label is simply unused
       clipGroups[]  a group with no live clips, which the app skips entirely
     Everything else - a `parts` pin, an `extraParts` pin, a declared animation -
     is something the Lab offers and that would do nothing. */
  if (w === "hidden" || w === "clips") return "inert";
  if (w.indexOf("clipGroups[") === 0) return "inert";
  return "broken";
}

/* ------------------------------------------------------------ clips */

/*
  The other kind of dead reference, and the one that nearly slipped through.

  A registry entry does not only name nodes. It names ANIMATION CLIPS, in three
  places, and `clipGroupsForModel` drives the Lab's animation buttons from
  `model.animations` - the DECLARED list, not the file's. So a declared clip
  the file no longer contains is a button that plays nothing: the same failure
  as a dead pin, in a field the node-selector check never looked at.

  This matters right now rather than in theory. In the re-exported library
  hydraulic-pack went from 82 clips to 1, woodward-csu from 19 to 1 and
  woodward-osg from 5 to 1. Judged on node names alone all three look safe to
  repoint, and repointing them would publish eighty-odd buttons that do
  nothing.

    animations   the declared clip list; the app plays from this
    clips        clip name -> label, used when no clipGroups are configured
    clipGroups   label -> selectors over clip names (exact, or ~regex)

  A `groups` entry names node groups and nothing in the app reads it, so a
  stale one is inert and is not reported.
*/
export function clipsOf(model) {
  const out = [];
  ((model && model.animations) || []).forEach(function (name) {
    out.push({ where: "animations", selector: name });
  });
  Object.keys((model && model.clips) || {}).forEach(function (name) {
    out.push({ where: "clips", selector: name });
  });
  Object.keys((model && model.clipGroups) || {}).forEach(function (label) {
    out.push({ where: "clipGroups[" + label + "]", selector: (model.clipGroups[label] || []).join(" | ") });
  });
  return out;
}

export function checkClips(model, animationNames) {
  const names = animationNames || [];
  const dead = [];

  ((model && model.animations) || []).forEach(function (name) {
    if (names.indexOf(name) < 0) dead.push({ where: "animations", selector: name });
  });
  Object.keys((model && model.clips) || {}).forEach(function (name) {
    if (names.indexOf(name) < 0) dead.push({ where: "clips", selector: name });
  });
  /* A group whose selectors catch nothing renders as an empty animation group.
     Matched with the app's own clip matcher, which is not the node matcher. */
  Object.keys((model && model.clipGroups) || {}).forEach(function (label) {
    const selectors = model.clipGroups[label] || [];
    const alive = names.some(function (name) {
      return selectors.some(function (s) { return clipSelectorMatches(s, name); });
    });
    if (!alive) dead.push({ where: "clipGroups[" + label + "]", selector: selectors.join(" | ") });
  });

  return { model: model.id, file: model.file, total: clipsOf(model).length, dead: dead };
}

/*
  Whether a registry entry can safely be repointed at the file it was checked
  against.

  This is the decision the measurements exist to serve. Updating bytes, hashes
  and counts is arithmetic; it is also the moment every broken pin on that
  model goes live. An entry whose selectors all survived can be repointed on
  the numbers alone. An entry with broken pins must have them re-authored
  FIRST, because today the old file is still in R2 and those pins still work.
*/
export function repointVerdict(check, clipCheck) {
  const dead = (check.dead || []).concat((clipCheck && clipCheck.dead) || []);
  const broken = dead.filter(function (d) { return severityOf(d.where) === "broken"; });
  const inert = dead.filter(function (d) { return severityOf(d.where) === "inert"; });
  return {
    model: check.model,
    file: check.file,
    total: check.total + ((clipCheck && clipCheck.total) || 0),
    broken: broken,
    inert: inert,
    safe: broken.length === 0
  };
}

/* ------------------------------------------------------------------ renames */

/*
  A model that was re-exported under a NEW name reads as two separate problems
  - an entry pointing at a file that is gone, and a file nobody uses - when it
  is really one: a rename. The entry's selectors are the valuable part, so the
  question worth asking is whether they still resolve against the new file.

  --rename OLD.glb=NEW.glb answers it without editing anything: the entry is
  treated as pointing at NEW for the length of the run.
*/
export function parseRenames(argv) {
  const out = new Map();
  (argv || []).forEach(function (token, i) {
    if (token !== "--rename") return;
    const pair = String((argv[i + 1] || "")).split("=");
    if (pair.length === 2 && pair[0].trim() && pair[1].trim()) out.set(pair[0].trim(), pair[1].trim());
  });
  return out;
}

export function applyRenames(registry, renames) {
  if (!renames || !renames.size) return registry;
  return Object.assign({}, registry, {
    models: (registry.models || []).map(function (model) {
      return renames.has(model.file) ? Object.assign({}, model, { file: renames.get(model.file), renamedFrom: model.file }) : model;
    })
  });
}

/* --------------------------------------------------------------------- cli */

export function samePath(a, b) {
  const norm = function (p) {
    let value = String(p || "").replace(/\\/g, "/");
    try { value = decodeURIComponent(value); } catch (error) { /* leave as-is */ }
    if (/^\/[A-Za-z]:/.test(value)) value = value.slice(1);
    return value.replace(/\/+$/, "").toLowerCase();
  };
  return norm(a) === norm(b);
}

export function isDirectRun(argv1, moduleUrl) {
  if (!argv1) return false;
  try { return samePath(argv1, fileURLToPath(moduleUrl)); } catch (error) { return false; }
}

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}
function flag(name) { return process.argv.indexOf("--" + name) >= 0; }

function main() {
  const dir = arg("dir", null);
  const file = arg("file", null);
  if (!dir && !file) {
    console.error("Give it something to read:\n" +
      '  node tools/inspect-glb.mjs --dir "C:\\...\\DHC6_REFERENCE_LIBRARY\\System-Lab"\n' +
      "  node tools/inspect-glb.mjs --file one.glb --names\n" +
      "Optional: --registry tools/data/systems-lab-models.json  --names  --match <text>  --json <out>\n" +
      "          --rename OLD.glb=NEW.glb   (repeatable; checks whether the old selectors survive the new file)");
    process.exitCode = 2;
    return;
  }

  const files = file ? [file] : fs.readdirSync(dir)
    .filter(function (name) { return /\.glb$/i.test(name); })
    .sort()
    .map(function (name) { return path.join(dir, name); });

  if (!files.length) {
    console.log("No .glb files under " + (dir || file));
    return;
  }

  const measured = {};
  console.log("--- " + files.length + " model" + (files.length === 1 ? "" : "s") + " ---\n");
  files.forEach(function (full) {
    const name = path.basename(full);
    const bytes = new Uint8Array(fs.readFileSync(full));
    const summary = summarise(bytes);
    if (!summary.ok) {
      console.log(name.padEnd(48) + "  UNREADABLE: " + summary.reason);
      return;
    }
    summary.sha256 = sha256(bytes);
    measured[name] = summary;
    console.log(name.padEnd(48) + "  " + String(summary.bytes).padStart(10) + " bytes" +
      "  nodes " + String(summary.nodes).padStart(4) +
      "  meshes " + String(summary.meshes).padStart(4) +
      "  tris " + String(summary.triangles).padStart(7) +
      "  clips " + String(summary.animations.length).padStart(2));
    if (summary.trailingBytes !== 0) {
      console.log("".padEnd(50) + "note: " + summary.trailingBytes + " bytes beyond the length in the header");
    }
    if (flag("names")) {
      const match = arg("match", null);
      const names = match
        ? summary.nodeNames.filter(function (n) { return n.toLowerCase().indexOf(match.toLowerCase()) >= 0; })
        : summary.rootNames;
      console.log("".padEnd(50) + (match ? "nodes matching " + match : "root nodes") + " (" + names.length + "):");
      names.forEach(function (n) { console.log("".padEnd(52) + n); });
    }
  });

  const registryPath = arg("registry", null);
  if (registryPath) {
    let registry = null;
    try { registry = JSON.parse(fs.readFileSync(registryPath, "utf8")); } catch (error) {
      console.log("\nCould not read the registry at " + registryPath + ": " + error.message);
      return;
    }
    const renames = parseRenames(process.argv);
    const effective = applyRenames(registry, renames);
    if (renames.size) {
      console.log("\n--- treating " + renames.size + " entr" + (renames.size === 1 ? "y" : "ies") + " as renamed ---");
      renames.forEach(function (to, from) { console.log("  " + from + "  ->  " + to); });
    }
    const result = reconcile(effective, measured);
    console.log("\n--- registry v" + registry.version + " against these files ---");

    if (!result.missing.length && !result.unused.length && !result.mismatch.length) {
      console.log("  Every entry resolves, every file is used, and every declared number matches.");
    }
    result.missing.forEach(function (m) {
      console.log("  MISSING   " + m.id.padEnd(22) + " points at " + m.file + ", which is not here");
    });
    result.unused.forEach(function (f) {
      console.log("  UNUSED    " + f + " is in the library and in no registry entry");
    });
    result.mismatch.forEach(function (m) {
      console.log("  MISMATCH  " + m.id.padEnd(22) + " " + m.file);
      m.fields.forEach(function (f) {
        console.log("              " + f.field.padEnd(11) + " declared " + f.declared + ", file says " + f.actual);
      });
    });
    /*
      The check the numbers cannot answer. A model whose bytes changed has been
      re-exported; whether its NODE NAMES changed with them decides whether
      every authored pin on it still works.
    */
    const checked = [];
    const verdicts = [];
    (effective.models || []).forEach(function (model) {
      const actual = measured[model.file];
      if (!actual || !actual.ok) return;
      const nodes = checkSelectors(model, actual.nodeNames);
      checked.push(nodes);
      /* Clips are checked in the same breath, because a model whose node names
         all survived can still have lost every animation it declares. */
      verdicts.push(repointVerdict(nodes, checkClips(model, actual.animations)));
    });
    const withDead = verdicts.filter(function (v) { return v.broken.length || v.inert.length; });
    const totalBroken = verdicts.reduce(function (n, v) { return n + v.broken.length; }, 0);
    const totalInert = verdicts.reduce(function (n, v) { return n + v.inert.length; }, 0);

    console.log("\n--- authored selectors and clips against these files ---");
    const totalSelectors = verdicts.reduce(function (n, v) { return n + v.total; }, 0);
    console.log("  " + totalSelectors + " authored references across " + verdicts.length + " model" + (verdicts.length === 1 ? "" : "s") + ".");
    console.log("  " + totalBroken + " broken reference" + (totalBroken === 1 ? "" : "s") +
      ", " + totalInert + " inert entr" + (totalInert === 1 ? "y" : "ies") + ".");
    if (!totalBroken && !totalInert) {
      console.log("  Every authored selector still resolves. The re-export kept the node names.");
    } else {
      console.log("  Broken = a pin or an animation the Lab offers that would do nothing.");
      console.log("  Inert  = a hygiene rule, label or group whose target this export no longer");
      console.log("           contains. That is the library getting cleaner, not a fault.");
    }

    withDead.forEach(function (v) {
      const via = (effective.models.find(function (m) { return m.id === v.model; }) || {}).renamedFrom;
      console.log("\n  " + v.model + (via ? "  [renamed from " + via + "]" : "") +
        "  (" + v.broken.length + " broken, " + v.inert.length + " inert, of " + v.total + ")");
      v.broken.forEach(function (d) {
        console.log("      " + d.where.padEnd(28) + d.selector);
      });
      if (v.inert.length) {
        const names = v.inert.slice(0, 6).map(function (d) { return d.selector; }).join(", ");
        console.log("      " + "(inert)".padEnd(28) + names + (v.inert.length > 6 ? ", +" + (v.inert.length - 6) + " more" : ""));
      }
    });

    /*
      The line that turns measurements into a decision. Repointing an entry is
      the moment its broken pins go live, and today the OLD file is still the
      one being served, with its pins working.
    */
    const safe = verdicts.filter(function (v) { return v.safe; });
    const hold = verdicts.filter(function (v) { return !v.safe; });
    console.log("\n--- repoint verdict ---");
    console.log("  SAFE (" + safe.length + "): numbers can be updated as measured; every pin and clip survives.");
    if (safe.length) console.log("      " + safe.map(function (v) { return v.model; }).join(", "));
    console.log("  HOLD (" + hold.length + "): re-author these FIRST. Repointing now would publish dead pins or buttons.");
    hold.forEach(function (v) {
      console.log("      " + v.model.padEnd(24) + v.broken.length + " reference" + (v.broken.length === 1 ? "" : "s") + " would be dead");
    });

    console.log("\n  Nothing was written. These are measurements to author from.");
  }

  const out = arg("json", null);
  if (out) {
    fs.writeFileSync(out, JSON.stringify(measured, null, 2));
    console.log("\nMeasurements written to " + out + " (this is the only file this tool writes).");
  }
}

if (isDirectRun(process.argv[1], import.meta.url)) main();
