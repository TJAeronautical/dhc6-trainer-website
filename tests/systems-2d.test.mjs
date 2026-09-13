/*
  Knowledge → Systems (2D): the Android extraction and the browser logic.

  What these tests pin down:
    * the tile order, hints, tile art and overviews come out of the Kotlin
      unchanged — nothing is retyped and nothing is invented
    * a reference image Android declares but the repository does not contain is
      reported as blocked, never silently replaced with a different drawing
    * diagram pin coordinates survive the extraction and land on the same part of
      the drawing at any viewport size
    * the AFM/FCTM packs render the way BundledSystemReferenceCard does
*/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildSystems2dPack, readSystemTaxonomy, readHomeScreen, readDetailScreen,
  readDiagramPins, readAssetBasenames
} from "../tools/lib/systems-2d.mjs";

import {
  systemsInOrder, systemByKey, systemStatus, systemSummaryLine, searchSystems,
  tileArtFor, resolvedReferences, unresolvedReferences, mediaHref, classifySource,
  referenceNote, descriptionFor, descriptionCounts, countChips, displaySourceName,
  formatReferenceLine, formatLimitLine, controlLabel, controlPositions, limitName,
  limitQualifier, regulatoryLabel, diagramFor, fittedImageRect, pinPosition,
  nextPin, systemHref, quizHref, qrhHref
} from "../app/js/logic/systems2d.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = path.join(root, "tests", "fixtures", "android-kotlin");

function read(...parts) { return fs.readFileSync(path.join(fixtures, ...parts), "utf8"); }

const SOURCES = {
  aircraftSystemSource: read("domain", "AircraftSystem.kt"),
  homeSource: read("feature-knowledge", "AircraftSystemsHomeScreen.kt"),
  detailSource: read("feature-knowledge", "SystemDetailScreen.kt"),
  diagramSource: read("feature-knowledge", "Interactive2dDiagramViewer.kt"),
  repositorySource: read("data", "SystemContentRepository.kt")
};

/* A stand-in for core-res/src/main/assets/systems/*.json. */
const DESCRIPTIONS = {
  electrical: {
    systemId: "electrical", systemName: "Electrical System", variant: "BOTH",
    summary: "Fixture summary for the electrical system.",
    components: Array.from({ length: 10 }, (_, i) => ({ name: "Component " + (i + 1), description: "Fixture component." })),
    controls: [{ label: "BUS TIE", description: "Fixture control." }],
    limits: [{ name: "Generator load", value: "1.0", condition: "continuous" }, { name: "Battery", value: "24 V" }],
    modificationVariants: [{ name: "Mod 6/1234", description: "Fixture mod." }],
    casMessageRefs: ["L DC GEN"],
    references: [{ source: "POH_AFM", locator: "Section 7", revision: "Rev 12" }, { source: "FCTM", locator: "6.5.1" }]
  },
  fuel: {
    systemId: "fuel", systemName: "Fuel System", variant: "BOTH", summary: "Fixture fuel summary.",
    components: [{ name: "Collector cell", description: "Fixture." }], controls: [], limits: [],
    modificationVariants: [], casMessageRefs: [], references: [{ source: "QRH", locator: "3-1" }]
  },
  powerplant: {
    systemId: "powerplant", systemName: "Powerplant", variant: "BOTH", summary: "Fixture powerplant summary.",
    components: [{ name: "Compressor", description: "Fixture." }], controls: [], limits: [],
    modificationVariants: [], casMessageRefs: [], references: []
  },
  general: {
    systemId: "general", systemName: "General", variant: "BOTH", summary: "Fixture general summary.",
    components: [], controls: [], limits: [], modificationVariants: [], casMessageRefs: [], references: []
  },
  aircraft_general: {
    systemId: "aircraft_general", systemName: "Aircraft General", variant: "BOTH", summary: "Fixture aircraft-general summary.",
    components: [], controls: [], limits: [], modificationVariants: [], casMessageRefs: [], references: []
  }
};

/* What tools/build-diagrams.mjs produced. Android declares these as .webp; the
   repository holds .png, so the build normalises every published path to .webp.
   The fixture's `models/systems_lab/fixture/Refs/Figure_*.png` are deliberately
   absent, standing in for a reference that really was not produced. */
const DIAGRAMS = [
  { mediaPath: "systems/posters/fuel_system_flow_interactive.webp", androidPath: "systems/posters/fuel_system_flow_interactive.png", label: "fuel system flow interactive", group: "poster" },
  { mediaPath: "systems/posters/fuel_heater.webp", androidPath: "systems/posters/fuel_heater.png", label: "fuel heater", group: "poster" },
  { mediaPath: "systems/posters/electrical_system.webp", androidPath: "systems/posters/electrical_system.png", label: "electrical system", group: "poster" },
  { mediaPath: "systems/posters/powerplant_engine_cutaway.webp", androidPath: "systems/posters/powerplant_engine_cutaway.png", label: "powerplant engine cutaway", group: "poster" }
];

function fixturePack() {
  return buildSystems2dPack(Object.assign({}, SOURCES, { descriptions: DESCRIPTIONS, diagrams: DIAGRAMS }));
}

/* ------------------------------------------------------------ extraction */

test("the tile order is read from AircraftSystemsHomeScreen, not reordered", () => {
  const home = readHomeScreen(SOURCES.homeSource);
  assert.deepEqual(home.order, ["ATA_100", "FUEL", "POWERPLANT", "ELECTRICAL", "LIMITATIONS", "ICE_RAIN_PROTECTION", "GENERAL"]);
});

test("shortHint(), tileImageResId() and systemHomeReferenceImageCount() are extracted from the extension functions", () => {
  const home = readHomeScreen(SOURCES.homeSource);
  assert.equal(home.hints.ELECTRICAL, "Fixture hint: electrical.");
  assert.equal(home.tileArt.ELECTRICAL, "dhc6_tile_cockpit_panel");
  assert.equal(home.tileArt.FUEL, "dhc6_tile_engine_cutaway", "a multi-label when branch applies to every label");
  assert.equal(home.tileArt.ICE_RAIN_PROTECTION, "dhc6_tile_engine_cutaway");
  assert.equal(home.imageCounts.POWERPLANT, 5);
  assert.equal(home.imageCountFallback, 0, "the else branch is the fallback count");
  assert.ok(!("GENERAL" in home.imageCounts));
});

test("the taxonomy carries every enum member and its display title", () => {
  const taxonomy = readSystemTaxonomy(SOURCES.aircraftSystemSource);
  assert.equal(taxonomy.members.length, 35);
  assert.equal(taxonomy.titles.ATA_100, "Aircraft Manual Structure");
  assert.equal(taxonomy.titles.INDICATIONS_ALERTING, "Indications & Alerting");
  assert.ok(taxonomy.members.includes("EMERGENCY_EQUIPMENT"));
});

test("systemOverview and systemDetailReferenceImages keep their Kotlin values", () => {
  const detail = readDetailScreen(SOURCES.detailSource);
  assert.equal(detail.overviews.FUEL, "Fixture overview: fuel.");
  assert.deepEqual(detail.references.FUEL, [
    { label: "Fuel system flow", assetPath: "systems/posters/fuel_system_flow_interactive.webp" },
    { label: "Fuel heater", assetPath: "systems/posters/fuel_heater.webp" }
  ]);
  assert.equal(detail.references.GENERAL, undefined, "the else branch authors no images");
});

test("systemReferenceNote is read out of a statement-bodied function, else branch included", () => {
  const detail = readDetailScreen(SOURCES.detailSource);
  assert.equal(detail.notes.POWERPLANT.oralExamCue, "Fixture oral cue.");
  assert.deepEqual(detail.notes.POWERPLANT.studyFocus, ["Fixture focus one.", "Fixture focus two."]);
  assert.match(detail.noteFallback.description, /\$sourceType/, "the placeholder survives so the browser can classify");
  assert.equal(detail.sourceTypes.length, 4);
  assert.equal(detail.sourceTypes[0].value, "manual figure/reference image");
  assert.equal(detail.sourceTypes[3].isElse, true);
});

test("diagram pins keep their ids, coordinates and authored text", () => {
  const pins = readDiagramPins(SOURCES.diagramSource);
  assert.equal(pins.POWERPLANT.length, 2);
  const inlet = pins.POWERPLANT[0];
  assert.equal(inlet.id, "inlet");
  assert.equal(inlet.label, "Air inlet (Station 1)");
  assert.equal(inlet.x, 0.82);
  assert.equal(inlet.y, 0.56);
  assert.equal(inlet.keyFact, "Fixture key fact, with a comma.", "commas inside a string never split an argument");
  assert.equal(inlet.studyPrompt, "Fixture study prompt?");
  assert.equal(pins.GENERAL, undefined);
});

test("SYSTEM_TO_ASSET_BASENAME is read as written, aliases included", () => {
  const map = readAssetBasenames(SOURCES.repositorySource);
  assert.equal(map.ELECTRICAL, "electrical");
  assert.equal(map.ENGINE, "powerplant", "ENGINE shares the powerplant pack");
  assert.equal(map.AIRCRAFT_GENERAL, "general");
});

/* ------------------------------------------------------------- the pack */

test("the pack covers every enum member and keeps the home screen's tile order", () => {
  const pack = fixturePack();
  assert.equal(Object.keys(pack.systems).length, 35);
  assert.equal(pack.order.length, 7);
  assert.equal(pack.order[0], "ATA_100");
  assert.equal(pack.systems.ELECTRICAL.title, "Electrical");
  assert.equal(pack.systems.ELECTRICAL.hint, "Fixture hint: electrical.");
  assert.equal(pack.systems.ELECTRICAL.overview, "Fixture overview: electrical.");
});

test("a reference image the diagram build did not produce is reported, never substituted", () => {
  const pack = fixturePack();
  const ata = pack.systems.ATA_100;
  assert.equal(ata.references.length, 1);
  assert.equal(ata.references[0].mediaPath, null, "no stand-in drawing is put in its place");
  assert.equal(ata.references[0].androidPath, "models/systems_lab/fixture/Refs/Figure_0-0.png");
  const issue = pack.issues.find((i) => i.kind === "missing_reference_image" && i.system === "ATA_100");
  assert.ok(issue, "the gap is recorded in the pack");
  assert.match(issue.detail, /were not produced by the diagram build/);
});

test("a reference declared with the wrong extension resolves to the file that exists", () => {
  /* Android asks for systems/posters/electrical_system.webp; the repository
     holds .png. The build publishes .webp, so the reference resolves and the
     mismatch is flagged rather than treated as a missing image. */
  const pack = fixturePack();
  const electrical = pack.systems.ELECTRICAL.references[0];
  assert.equal(electrical.androidPath, "systems/posters/electrical_system.webp");
  assert.equal(electrical.mediaPath, "systems/posters/electrical_system.webp");
  assert.equal(electrical.extensionMismatch, true, "the source file is .png");
  assert.equal(pack.systems.FUEL.references.length, 2);
  assert.ok(pack.systems.FUEL.references.every((r) => r.mediaPath));
  assert.equal(pack.issues.some((i) => i.kind === "missing_reference_image" && i.system === "ELECTRICAL"), false);
});

test("pins with no drawing behind them are flagged rather than dropped", () => {
  const pack = fixturePack();
  assert.equal(pack.systems.ICE_RAIN_PROTECTION.pins.length, 1);
  assert.equal(resolvedReferences(pack.systems.ICE_RAIN_PROTECTION).length, 0);
  assert.ok(pack.issues.some((i) => i.kind === "pins_without_diagram" && i.system === "ICE_RAIN_PROTECTION"));
});

test("an authored pack Android cannot reach is wired up and the gap recorded", () => {
  const pack = fixturePack();
  assert.equal(pack.systems.AIRCRAFT_GENERAL.descriptionId, "aircraft_general");
  const issue = pack.issues.find((i) => i.kind === "unreachable_pack" && i.system === "AIRCRAFT_GENERAL");
  assert.ok(issue);
  assert.match(issue.detail, /Android never loads it/);
  assert.equal(pack.systems.ENGINE.descriptionId, "powerplant", "the Android alias is preserved");
});

test("the pack carries no Android drawable that this repository does not ship", () => {
  const pack = fixturePack();
  for (const system of Object.values(pack.systems)) {
    if (!system.tileArt) continue;
    const file = path.join(root, "app", "assets", "tiles", tileArtFor(system) + ".webp");
    assert.ok(fs.existsSync(file), tileArtFor(system) + " is missing from app/assets/tiles");
  }
});

/* -------------------------------------------------------- browser logic */

test("tile status distinguishes available, partial and coming later", () => {
  const pack = fixturePack();
  assert.equal(systemStatus(pack, pack.systems.ELECTRICAL), "available", "pack + drawing");
  assert.equal(systemStatus(pack, pack.systems.AIRCRAFT_GENERAL), "partial", "pack, no drawing");
  assert.equal(systemStatus(pack, pack.systems.ICE_RAIN_PROTECTION), "later", "neither");
  assert.equal(systemStatus(pack, pack.systems.ATA_100), "later", "a declared but missing image does not count");
});

test("the tile summary counts what actually resolved, not what Android declared", () => {
  const pack = fixturePack();
  assert.equal(pack.systems.ATA_100.androidImageCount, 1, "Android claims one image");
  assert.equal(systemSummaryLine(pack, pack.systems.ATA_100), "Overview only", "the web counts zero, because none resolves");
  assert.equal(systemSummaryLine(pack, pack.systems.ELECTRICAL), "17 bundled  •  1 diagram");
});

test("search matches the title, hint, overview and the raw enum name", () => {
  const pack = fixturePack();
  assert.equal(searchSystems(pack, "").length, 7);
  assert.deepEqual(searchSystems(pack, "electrical").map((s) => s.key), ["ELECTRICAL"]);
  assert.deepEqual(searchSystems(pack, "ice rain").map((s) => s.key), ["ICE_RAIN_PROTECTION"], "underscores read as spaces");
  assert.deepEqual(searchSystems(pack, "zzz"), []);
});

test("the watermarked takeoff tile is never requested", () => {
  const pack = fixturePack();
  assert.equal(pack.systems.LIMITATIONS.tileArt, "procedure_tile_takeoff", "Android still points at it");
  assert.equal(tileArtFor(pack.systems.LIMITATIONS), "procedure_tile_takeoff_custom", "the browser uses the licensed replacement");
  assert.equal(fs.existsSync(path.join(root, "app", "assets", "tiles", "procedure_tile_takeoff.webp")), false);
});

test("classifySource follows the Android when-order", () => {
  const pack = fixturePack();
  assert.equal(classifySource(pack, { label: "Figure 6-1 — Aircraft dimensions", androidPath: "models/x/Refs/a.png" }), "manual figure/reference image");
  assert.equal(classifySource(pack, { label: "Fuel heater", androidPath: "systems/posters/fuel_heater.webp" }), "system poster");
  assert.equal(classifySource(pack, { label: "Region map", androidPath: "systems/maps/x.webp" }), "system map");
  assert.equal(classifySource(pack, { label: "Something", androidPath: "systems/other/x.webp" }), "bundled reference image");
});

test("the generic study note fills in the source type; an authored note wins", () => {
  const pack = fixturePack();
  const authored = referenceNote(pack, pack.systems.POWERPLANT, pack.systems.POWERPLANT.references[0]);
  assert.equal(authored.oralExamCue, "Fixture oral cue.");
  const generic = referenceNote(pack, pack.systems.ELECTRICAL, pack.systems.ELECTRICAL.references[0]);
  assert.equal(generic.description, "This system poster is included to give a visual anchor.");
  assert.ok(!/\$sourceType/.test(generic.description));
});

test("the bundled AFM/FCTM card renders the way BundledSystemReferenceCard does", () => {
  const pack = fixturePack();
  const description = descriptionFor(pack, pack.systems.ELECTRICAL);
  const counts = descriptionCounts(description);
  assert.deepEqual(
    { components: counts.components, controls: counts.controls, limits: counts.limits, total: counts.total },
    { components: 10, controls: 1, limits: 2, total: 17 }
  );
  assert.deepEqual(countChips(description), ["10 components", "1 controls", "2 limits", "1 mod variants", "1 CAS refs"]);
  assert.equal(displaySourceName("POH_AFM"), "POH/AFM");
  assert.equal(displaySourceName("OPERATOR_OM"), "Ops Manual");
  assert.equal(displaySourceName("SOMETHING_ELSE"), "SOMETHING_ELSE");
  assert.equal(formatReferenceLine(description.references[0]), "POH/AFM — Section 7 (Rev 12)");
  assert.equal(formatReferenceLine(description.references[1]), "FCTM — 6.5.1");
  assert.equal(formatLimitLine(description.limits[0]), "Generator load: 1.0 — continuous");
  assert.equal(formatLimitLine(description.limits[1]), "Battery: 24 V", "a limit with no condition gets no dash");
  assert.equal(descriptionFor(pack, pack.systems.ICE_RAIN_PROTECTION), null);
});

test("both authored control and limit shapes are read as written", () => {
  /* electrical.json follows the schema; the other nineteen packs use a second
     shape that Android's data class cannot parse at all. Neither is renamed. */
  const schemaControl = { id: "dc_master", label: "DC MASTER", location: "Overhead console", description: "Fixture.", positions: [{ label: "MASTER", behaviour: "Buses live." }, { label: "OFF", behaviour: "Buses dead." }] };
  const otherControl = { id: "power_lever", name: "Power Lever (L/R)", description: "Fixture.", positions: ["MAX", "IDLE", "REVERSE"] };
  assert.equal(controlLabel(schemaControl), "DC MASTER");
  assert.equal(controlLabel(otherControl), "Power Lever (L/R)");
  assert.equal(controlLabel({}), "", "a control with neither key renders empty, never \"undefined\"");
  assert.deepEqual(controlPositions(schemaControl), [
    { label: "MASTER", behaviour: "Buses live." },
    { label: "OFF", behaviour: "Buses dead." }
  ]);
  assert.deepEqual(controlPositions(otherControl), [
    { label: "MAX", behaviour: "" }, { label: "IDLE", behaviour: "" }, { label: "REVERSE", behaviour: "" }
  ]);

  const schemaLimit = { id: "a", name: "Single generator load", value: "0 to 0.5", condition: "On ground", regulatoryStatus: "AFM_APPROVED" };
  const otherLimit = { id: "b", parameter: "T5 — Take-Off", value: "725°C", note: "Yellow arc 695–725°C." };
  assert.equal(limitName(schemaLimit), "Single generator load");
  assert.equal(limitName(otherLimit), "T5 — Take-Off");
  assert.equal(limitQualifier(otherLimit), "Yellow arc 695–725°C.");
  assert.equal(formatLimitLine(schemaLimit), "Single generator load: 0 to 0.5 — On ground");
  assert.equal(formatLimitLine(otherLimit), "T5 — Take-Off: 725°C — Yellow arc 695–725°C.");
  assert.equal(formatLimitLine({ name: "Battery", value: "24 V" }), "Battery: 24 V", "no qualifier, no dash");
  assert.doesNotMatch(formatLimitLine({}), /undefined/);
});

test("a limit's regulatory status is shown only where the pack states it", () => {
  assert.equal(regulatoryLabel({ regulatoryStatus: "AFM_APPROVED" }), "AFM approved");
  assert.equal(regulatoryLabel({ regulatoryStatus: "OPERATOR_GUIDANCE" }), "Operator guidance");
  assert.equal(regulatoryLabel({ regulatoryStatus: "MANUFACTURER_RECOMMENDED" }), "Manufacturer recommended");
  assert.equal(regulatoryLabel({ regulatoryStatus: "SOMETHING_NEW" }), "SOMETHING_NEW", "an unknown status is shown verbatim, not dropped");
  assert.equal(regulatoryLabel({ name: "T5" }), null, "an unstated status is never assumed to be AFM-approved");
});

/* ------------------------------------------------------------- diagram */

test("the diagram mode follows what is actually available", () => {
  const pack = fixturePack();
  assert.equal(diagramFor(pack.systems.POWERPLANT).mode, "interactive", "pins + drawing");
  assert.equal(diagramFor(pack.systems.ICE_RAIN_PROTECTION).mode, "list", "pins, no drawing");
  assert.equal(diagramFor(pack.systems.ELECTRICAL).mode, "static", "drawing, no pins");
  assert.equal(diagramFor(pack.systems.ATA_100).mode, "none");
  assert.equal(diagramFor(pack.systems.POWERPLANT).image.mediaPath, "systems/posters/powerplant_engine_cutaway.webp",
    "pins are drawn over the first reference, as Interactive2dDiagramViewer does");
});

test("pins land on the contain-fitted drawing at any viewport size", () => {
  /* A 2000x1000 drawing in a 400x400 box fits to 400x200, centred vertically. */
  const wide = fittedImageRect(2000, 1000, 400, 400);
  assert.deepEqual(wide, { left: 0, top: 100, width: 400, height: 200 });
  /* A 1000x2000 drawing in the same box fits to 200x400, centred horizontally. */
  const tall = fittedImageRect(1000, 2000, 400, 400);
  assert.deepEqual(tall, { left: 100, top: 0, width: 200, height: 400 });

  const pin = { x: 0.82, y: 0.56 };
  assert.deepEqual(pinPosition(pin, wide), { left: 328, top: 100 + 112 });
  /* Same pin, a box twice as wide: still 82% across the drawing. */
  const doubled = fittedImageRect(2000, 1000, 800, 800);
  const at = pinPosition(pin, doubled);
  assert.equal((at.left - doubled.left) / doubled.width, 0.82);
  assert.equal((at.top - doubled.top) / doubled.height, 0.56);
});

test("a degenerate image or box never throws and pin coordinates are clamped", () => {
  assert.deepEqual(fittedImageRect(0, 0, 400, 300), { left: 0, top: 0, width: 400, height: 300 });
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  assert.deepEqual(pinPosition({ x: -1, y: 2 }, rect), { left: 0, top: 100 });
  assert.deepEqual(pinPosition({ x: null, y: undefined }, rect), { left: 0, top: 0 });
});

test("pin stepping wraps in both directions", () => {
  const pins = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.equal(nextPin(pins, "a", 1).id, "b");
  assert.equal(nextPin(pins, "c", 1).id, "a");
  assert.equal(nextPin(pins, "a", -1).id, "c");
  assert.equal(nextPin(pins, "missing", 1).id, "b", "an unknown id starts from the first pin");
  assert.equal(nextPin([], "a", 1), null);
});

/* --------------------------------------------------------------- links */

test("protected media is addressed through the session-gated API", () => {
  assert.equal(mediaHref("systems/posters/fuel_heater.webp"), "/api/media/systems/posters/fuel_heater.webp");
  assert.equal(mediaHref("systems/posters/a b.webp"), "/api/media/systems/posters/a%20b.webp");
});

test("the action bubbles point at routes this app actually has", () => {
  const pack = fixturePack();
  assert.equal(systemHref("ELECTRICAL"), "#/systems/detail/electrical");
  assert.equal(quizHref(pack.systems.ELECTRICAL, "LEGACY"), "#/quizzes/run/LEGACY/10?sys=ELECTRICAL");
  assert.equal(qrhHref(), "#/qrh", "Android's qrh/category/<SYSTEM> lands on an empty category");
});

test("systemByKey is case-insensitive and unknown keys return null", () => {
  const pack = fixturePack();
  assert.equal(systemByKey(pack, "electrical").key, "ELECTRICAL");
  assert.equal(systemByKey(pack, "ELECTRICAL").key, "ELECTRICAL");
  assert.equal(systemByKey(pack, "nope"), null);
  assert.equal(systemsInOrder(pack).length, 7);
  assert.equal(unresolvedReferences(pack.systems.ATA_100).length, 1);
});
