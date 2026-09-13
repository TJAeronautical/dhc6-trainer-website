/*
  Build the `systems-2d` content pack from the Android sources.

  Authoritative inputs (private DHC-6-Trainer repository):

    domain/.../knowledge/model/AircraftSystem.kt          the taxonomy + displayTitle()
    feature-knowledge/.../AircraftSystemsHomeScreen.kt    tile order, shortHint(),
                                                          tileImageResId(),
                                                          systemHomeReferenceImageCount()
    feature-knowledge/.../SystemDetailScreen.kt           systemOverview(),
                                                          systemDetailReferenceImages(),
                                                          systemReferenceNote()
    feature-knowledge/.../Interactive2dDiagramViewer.kt   diagramPinsForSystem()
    data/.../systems/SystemContentRepository.kt           SYSTEM_TO_ASSET_BASENAME
    core-res/src/main/assets/systems/*.json               the authored AFM/FCTM packs

  Nothing here is retyped: every string, coordinate and count is read out of the
  Kotlin or the bundled JSON. Where the Android source is internally broken the
  pack records the fact rather than papering over it — see `issues` below.
*/

import { stripComments, findCalls, functionBody, valDeclaration, whenCases, enumKey, parseValue, balancedEnd } from "./kotlin-lite.mjs";

function fail(message) { throw new Error("systems-2d: " + message); }

/*
  functionBody() matches `fun name(`. Several of these helpers are extension
  functions on the enum (`private fun AircraftSystem.shortHint(): String = …`),
  so the receiver is stripped first and the body located from there.
*/
function fnBody(source, name) {
  const direct = functionBody(source, name);
  if (direct) return direct;
  const pattern = new RegExp("fun\\s+([A-Za-z_][A-Za-z0-9_]*)\\." + name + "\\s*\\(");
  const match = pattern.exec(source);
  if (!match) return null;
  return functionBody(source.slice(match.index).replace(pattern, "fun " + name + "("), name);
}

/* The `when (x) { … }` block inside a function whose body is a statement block
   (`{ val a = …; return when (x) { … } }`) rather than an expression body. */
function nestedWhenBody(source, functionName, subject) {
  const body = fnBody(source, functionName);
  if (!body) fail(functionName + " not found");
  const head = body.indexOf("when (" + subject + ")");
  if (head === -1) return body; // already an expression body: functionBody unwrapped it
  const open = body.indexOf("{", head);
  if (open === -1) fail(functionName + ": when block has no body");
  return body.slice(open + 1, balancedEnd(body, open) - 1);
}

function whenMap(body, transform) {
  const parsed = whenCases(body);
  const map = {};
  parsed.cases.forEach((c) => {
    const value = transform(c.raw, c.keys);
    if (value === undefined) return;
    c.keys.forEach((k) => { map[enumKey(k)] = value; });
  });
  return { map: map, elseRaw: parsed.elseRaw };
}

/* ------------------------------------------------------------- taxonomy */

export function readSystemTaxonomy(source) {
  const clean = stripComments(source);
  const body = fnBody(clean, "displayTitle");
  if (!body) fail("AircraftSystem.displayTitle() not found");
  const titles = {};
  const bare = /(^|\n)\s*([A-Z_0-9]+)\s*->\s*("(?:[^"\\]|\\.)*")/g;
  let m;
  while ((m = bare.exec(body)) !== null) titles[m[2]] = parseValue(m[3]);
  if (!Object.keys(titles).length) fail("no displayTitle cases parsed");

  // The enum declaration itself, so the pack can spot a system the UI forgot.
  const enumOpen = clean.indexOf("{", clean.indexOf("enum class AircraftSystem"));
  const enumBody = clean.slice(enumOpen + 1, clean.indexOf("fun displayTitle", enumOpen));
  const members = enumBody
    .split(/[,;\n]/)
    .map((piece) => piece.trim())
    .filter((piece) => /^[A-Z][A-Z_0-9]*$/.test(piece));
  return { titles: titles, members: Array.from(new Set(members)) };
}

/* ------------------------------------------------------------ home screen */

export function readHomeScreen(source) {
  const clean = stripComments(source);

  const orderRaw = valDeclaration(clean, "systems");
  if (!orderRaw) fail("AircraftSystemsHomeScreen: `val systems` not found");
  const order = (parseValue(orderRaw.replace(/^remember\s*\{/, "").replace(/\}\s*$/, "").trim()) || [])
    .map((v) => enumKey(v && v.ident ? v.ident : String(v)))
    .filter((k) => /^[A-Z][A-Z_0-9]*$/.test(k));
  if (order.length < 3) fail("AircraftSystemsHomeScreen: parsed only " + order.length + " tiles");

  const hints = whenMap(fnBody(clean, "shortHint"), (raw) => {
    const value = parseValue(raw);
    return typeof value === "string" ? value : undefined;
  }).map;

  /* `CoreRes.drawable.dhc6_tile_engine_cutaway` -> "dhc6_tile_engine_cutaway" */
  const tileArt = whenMap(fnBody(clean, "tileImageResId"), (raw) => {
    const text = String(raw).trim();
    const dot = text.lastIndexOf(".");
    return dot === -1 ? undefined : text.slice(dot + 1);
  }).map;

  const counts = whenMap(fnBody(clean, "systemHomeReferenceImageCount"), (raw) => {
    const value = parseValue(raw);
    return typeof value === "number" ? value : undefined;
  });

  return { order: order, hints: hints, tileArt: tileArt, imageCounts: counts.map, imageCountFallback: parseValue(counts.elseRaw || "0") };
}

/* ---------------------------------------------------------- detail screen */

export function readDetailScreen(source) {
  const clean = stripComments(source);

  const overviews = whenMap(fnBody(clean, "systemOverview"), (raw) => {
    const value = parseValue(raw);
    return typeof value === "string" ? value : undefined;
  }).map;

  const references = whenMap(fnBody(clean, "systemDetailReferenceImages"), (raw) => {
    const calls = findCalls(raw, "SystemDetailReferenceImage");
    if (!calls.length) return undefined;
    return calls.map((call) => {
      const args = call.args.map((a) => a.value);
      return { label: String(args[0]), assetPath: String(args[1]) };
    });
  }).map;

  function note(raw) {
    const call = findCalls(raw, "SystemReferenceNote")[0];
    if (!call) return undefined;
    const out = { description: "", whyImportant: "", howToUse: "", studyFocus: [], oralExamCue: "" };
    call.args.forEach((a, i) => {
      const name = a.name || ["description", "whyImportant", "howToUse", "studyFocus", "oralExamCue"][i];
      if (!name || !(name in out)) return;
      out[name] = a.value;
    });
    return out;
  }

  const notesBody = nestedWhenBody(clean, "systemReferenceNote", "system");
  const notesParsed = whenMap(notesBody, note);

  /*
    The else branch builds its description from a nested `when { … }` on the
    label/path. The template keeps `$sourceType` so the browser can classify the
    reference the same way Android does — see classifySource() in
    app/js/logic/systems2d.js.
  */
  const fallback = note(notesParsed.elseRaw || "");
  if (!fallback) fail("systemReferenceNote: else branch not parsed");
  const sourceTypes = [];
  const nested = /when\s*\{([\s\S]*?)\n\s*\}/.exec(notesParsed.elseRaw || "");
  if (nested) {
    nested[1].split("\n").forEach((line) => {
      const m = /^\s*(.+?)\s*->\s*("(?:[^"\\]|\\.)*")\s*$/.exec(line);
      if (!m) return;
      const condition = m[1].trim();
      const label = /label\.contains\("([^"]+)"\)/.exec(condition);
      const pathParts = Array.from(condition.matchAll(/path\.contains\("([^"]+)"\)/g)).map((x) => x[1]);
      sourceTypes.push({
        label: label ? label[1] : null,
        paths: pathParts,
        isElse: condition === "else",
        value: parseValue(m[2])
      });
    });
  }
  if (sourceTypes.length < 2) fail("systemReferenceNote: source-type classifier not parsed");

  return { overviews: overviews, references: references, notes: notesParsed.map, noteFallback: fallback, sourceTypes: sourceTypes };
}

/* --------------------------------------------------------- diagram pins */

export function readDiagramPins(source) {
  const clean = stripComments(source);
  const body = fnBody(clean, "diagramPinsForSystem");
  if (!body) fail("diagramPinsForSystem not found");
  const parsed = whenMap(body, (raw) => {
    const calls = findCalls(raw, "DiagramPin");
    if (!calls.length) return undefined;
    return calls.map((call) => {
      const a = call.args;
      const named = {};
      a.forEach((arg, i) => {
        const name = arg.name || ["id", "label", "normalizedX", "normalizedY", "keyFact", "consequence", "studyPrompt"][i];
        named[name] = arg.value;
      });
      if (typeof named.normalizedX !== "number" || typeof named.normalizedY !== "number") {
        fail("DiagramPin " + named.id + ": non-numeric coordinates");
      }
      return {
        id: String(named.id),
        label: String(named.label),
        x: named.normalizedX,
        y: named.normalizedY,
        keyFact: String(named.keyFact || ""),
        consequence: String(named.consequence || ""),
        studyPrompt: String(named.studyPrompt || "")
      };
    });
  });
  return parsed.map;
}

/* ------------------------------------------------ system -> JSON basename */

export function readAssetBasenames(source) {
  const clean = stripComments(source);
  const raw = valDeclaration(clean, "SYSTEM_TO_ASSET_BASENAME");
  if (!raw) fail("SYSTEM_TO_ASSET_BASENAME not found");
  const open = raw.indexOf("(");
  const inner = raw.slice(open + 1, balancedEnd(raw, open) - 1);
  const map = {};
  const pattern = /AircraftSystem\.([A-Z_0-9]+)\s+to\s+"([^"]+)"/g;
  let m;
  while ((m = pattern.exec(inner)) !== null) map[m[1]] = m[2];
  if (!Object.keys(map).length) fail("SYSTEM_TO_ASSET_BASENAME: no entries parsed");
  return map;
}

/*
  Four authored packs are unreachable on Android because the enum they belong to
  is mapped elsewhere (AIRCRAFT_GENERAL -> "general") or is not in the map at
  all. The basename equals the lower-snake-case enum name in every case, so the
  wiring is unambiguous; it is applied here and recorded in `issues`.
*/
const ORPHAN_BASENAMES = ["ata_100", "aircraft_general", "standard_airframe_practices", "equipment_furnishings"];

/* ------------------------------------------------------------- the pack */

export function buildSystems2dPack(input) {
  const taxonomy = readSystemTaxonomy(input.aircraftSystemSource);
  const home = readHomeScreen(input.homeSource);
  const detail = readDetailScreen(input.detailSource);
  const pins = readDiagramPins(input.diagramSource);
  const basenames = readAssetBasenames(input.repositorySource);

  const issues = [];
  const availablePosters = new Set(input.posters || []);      // "systems/posters/x.webp"
  const descriptions = {};
  const usedBasenames = new Set();

  ORPHAN_BASENAMES.forEach((basename) => {
    const key = basename.toUpperCase();
    if (!taxonomy.members.includes(key)) return;
    if (basenames[key] === basename) return;
    if (!input.descriptions || !input.descriptions[basename]) return;
    issues.push({
      kind: "unreachable_pack",
      system: key,
      detail: "systems/" + basename + ".json is authored but SYSTEM_TO_ASSET_BASENAME maps " + key +
        " to " + (basenames[key] ? '"' + basenames[key] + '"' : "nothing") + ", so Android never loads it. The web pack wires it to its own file."
    });
    basenames[key] = basename;
  });

  function resolveReference(ref) {
    const path = String(ref.assetPath || "");
    const candidates = [path];
    if (/\.webp$/i.test(path)) candidates.push(path.replace(/\.webp$/i, ".png"));
    if (/\.png$/i.test(path)) candidates.push(path.replace(/\.png$/i, ".webp"));
    // Everything published to R2 is normalised to .webp by tools/build-posters.mjs.
    const normalised = candidates.map((c) => c.replace(/\.(png|jpe?g)$/i, ".webp"));
    const hit = normalised.find((c) => availablePosters.has(c)) || null;
    return { label: ref.label, androidPath: path, mediaPath: hit };
  }

  const systems = {};
  taxonomy.members.forEach((key) => {
    const refs = (detail.references[key] || []).map(resolveReference);
    const missing = refs.filter((r) => !r.mediaPath);
    if (missing.length) {
      issues.push({
        kind: "missing_reference_image",
        system: key,
        detail: missing.length + " of " + refs.length + " reference image(s) declared by systemDetailReferenceImages() do not exist in the Android repository: " +
          missing.map((r) => r.androidPath).join(", ")
      });
    }
    const basename = basenames[key] || null;
    if (basename && input.descriptions && input.descriptions[basename]) {
      descriptions[basename] = input.descriptions[basename];
      usedBasenames.add(basename);
    }
    const resolved = refs.filter((r) => r.mediaPath);
    const systemPins = pins[key] || [];
    if (systemPins.length && !resolved.length) {
      issues.push({
        kind: "pins_without_diagram",
        system: key,
        detail: systemPins.length + " diagram pin(s) are authored but no reference image resolves, so the diagram cannot be drawn."
      });
    }
    systems[key] = {
      key: key,
      title: taxonomy.titles[key] || key,
      hint: home.hints[key] || "",
      overview: detail.overviews[key] || "",
      tileArt: home.tileArt[key] || null,
      descriptionId: basename && descriptions[basename] ? basename : null,
      references: refs,
      note: detail.notes[key] || null,
      pins: systemPins,
      androidImageCount: key in home.imageCounts ? home.imageCounts[key] : home.imageCountFallback
    };
  });

  /*
    Two authored shapes are in the bundle. assets/schema/system_description.schema.json
    and data/.../SystemDescription.kt both require control.label and limit.name;
    most packs instead write control.name and limit.parameter/limit.note, which
    Moshi cannot parse — so on Android the "From AFM / FCTM" card is silently
    absent for those systems. The browser reads either shape; the divergence is
    reported here because the content is Trevor's to reconcile.
  */
  const offSchema = [];
  Object.keys(descriptions).forEach((basename) => {
    const d = descriptions[basename] || {};
    const controls = (d.controls || []).filter((c) => c && !c.label && c.name).length;
    const limits = (d.limits || []).filter((l) => l && !l.name && l.parameter).length;
    if (controls || limits) offSchema.push(basename + " (" + [controls ? controls + " control(s)" : null, limits ? limits + " limit(s)" : null].filter(Boolean).join(", ") + ")");
  });
  if (offSchema.length) {
    issues.push({
      kind: "schema_divergence",
      system: null,
      detail: "Authored against a second shape that system_description.schema.json and SystemDescription.kt do not accept (control.name instead of control.label, limit.parameter/limit.note instead of limit.name/limit.condition), so Moshi cannot parse these packs and the AFM/FCTM card does not appear on Android: " + offSchema.join(", ")
    });
  }

  const orphanPacks = Object.keys(input.descriptions || {}).filter((b) => !usedBasenames.has(b));
  if (orphanPacks.length) {
    issues.push({ kind: "unused_pack", system: null, detail: "Authored but not reachable from any system tile: " + orphanPacks.join(", ") });
  }

  home.order.forEach((key) => {
    if (!systems[key]) fail("tile order references unknown system " + key);
  });

  return {
    id: "systems-2d",
    source: "DHC-6-Trainer core-res/src/main/assets/systems + feature-knowledge system screens",
    order: home.order,
    systems: systems,
    descriptions: descriptions,
    noteFallback: detail.noteFallback,
    sourceTypes: detail.sourceTypes,
    issues: issues,
    count: home.order.length
  };
}
