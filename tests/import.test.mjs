/*
  Import — a document the pilot owns, turned into training material.

  The safety rule this file exists to hold: nothing invents, completes or
  corrects a procedure. Extraction from a PDF is lossy, so everything this
  produces is a CANDIDATE that lands in an editor. A test that let an imported
  step become drillable without review would be the dangerous kind of green.
*/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  extractLines, isFurniture, isHeading, looksLikeProcedure,
  toCards, toDraftSteps, mergePool, isImported, stripSectionNumber, IMPORT_TAG, CANDIDATE_TAG
} from "../app/js/logic/import.js";
import { linesFromTextContent, isPdf, isText } from "../app/js/pdftext.js";
import { buildSession } from "../app/js/logic/srs.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const MANUAL = [
  "DHC-6 Series 300",
  "Page 12 of 233",
  "3.2 FUEL SYSTEM",
  "The fuel system comprises two main tanks and a centre tank.",
  "Boost pumps — ON",
  "Crossfeed — CLOSED",
  "Fuel quantity — CHECK",
  "",
  "Rev. 4.1"
].join("\n");

/* ------------------------------------------------------------- extraction */

test("page furniture is dropped, real lines are kept", () => {
  const lines = extractLines(MANUAL);
  assert.deepEqual(lines, [
    "3.2 FUEL SYSTEM",
    "The fuel system comprises two main tanks and a centre tank.",
    "Boost pumps — ON",
    "Crossfeed — CLOSED",
    "Fuel quantity — CHECK"
  ]);
  assert.equal(lines.indexOf("Page 12 of 233"), -1, "a page number must never reach a drill");
});

test("furniture recognition covers what a manual repeats", () => {
  ["Page 4", "Page 4 of 90", "17", "Rev. 3", "Revision: 2.1", "Issue 4",
   "DHC-6", "Twin Otter", "————", "   "].forEach(function (line) {
    assert.equal(isFurniture(line), true, JSON.stringify(line) + " is furniture");
  });
  ["Boost pumps — ON", "FUEL SYSTEM", "Set flaps to 10 degrees"].forEach(function (line) {
    assert.equal(isFurniture(line), false, JSON.stringify(line) + " is content");
  });
});

test("a word broken across a line end is rejoined", () => {
  /* PDF extractors report the hyphen as written. "HYDRAU- LIC PRESSURE"
     matches no control in the catalogue, so the step would silently lose its
     cockpit binding. */
  const lines = extractLines("Check hydrau-\nlic pressure — NORMAL");
  assert.deepEqual(lines, ["Check hydraulic pressure — NORMAL"]);
});

test("a non-breaking space is treated as a space", () => {
  const lines = extractLines("Boost pumps — ON");
  assert.deepEqual(lines, ["Boost pumps — ON"]);
});

test("headings are recognised without swallowing sentences", () => {
  assert.equal(isHeading("3.2 FUEL SYSTEM"), true);
  assert.equal(isHeading("EMERGENCY DESCENT"), true);
  assert.equal(isHeading("The fuel system comprises two main tanks."), false,
    "a sentence is not a heading, whatever its length");
  assert.equal(isHeading(""), false);
  assert.equal(isHeading("x".repeat(100)), false);
});

test("the shape of the text only chooses which destination is offered first", () => {
  assert.equal(looksLikeProcedure(extractLines(MANUAL)), true);
  assert.equal(looksLikeProcedure(["A long paragraph of prose with no structure at all in it whatsoever",
    "Another paragraph continuing the same discussion of the system in question",
    "And a third one, still prose, still carrying no checklist structure anywhere"]), false);
  assert.equal(looksLikeProcedure(["one", "two"]), false, "too little to judge");
  assert.equal(looksLikeProcedure(null), false);
});

/* ------------------------------------------------------------- study cards */

test("a name-value line becomes a card, front and back", () => {
  const cards = toCards(extractLines(MANUAL), { source: "OM-B.pdf" });
  const pairs = cards.map(function (c) { return c.title + " => " + c.content; });
  assert.ok(pairs.indexOf("Boost pumps => ON") >= 0);
  assert.ok(pairs.indexOf("Crossfeed => CLOSED") >= 0);
});

test("a heading with text under it becomes a card", () => {
  const cards = toCards(extractLines("3.2 FUEL SYSTEM\nTwo main tanks and a centre tank."), { source: "x" });
  assert.equal(cards.length, 1);
  assert.equal(cards[0].title, "FUEL SYSTEM");
  assert.equal(cards[0].content, "Two main tanks and a centre tank.");
});

test("a line with nothing to recall is dropped, not made into a card", () => {
  /* A card whose back repeats its front teaches nothing and pollutes the
     review queue for as long as the account exists. */
  const cards = toCards(["Just a loose sentence with no structure"], { source: "x" });
  assert.equal(cards.length, 0);
});

test("imported cards carry the tags the study engine filters on", () => {
  const cards = toCards(extractLines(MANUAL), { source: "OM-B.pdf" });
  assert.ok(cards.length > 0);
  cards.forEach(function (card) {
    assert.ok(card.tags.indexOf(CANDIDATE_TAG) >= 0, "or the SRS session skips it entirely");
    assert.ok(card.tags.indexOf(IMPORT_TAG) >= 0, "and it must be identifiable as imported");
    assert.equal(card.importedFrom, "OM-B.pdf");
    assert.ok(isImported(card));
  });
});

test("an imported card actually reaches a study session", () => {
  /* The failure this prevents: cards that save successfully, appear in a
     count, and are never shown - because buildSession filters on a tag the
     importer forgot to set. */
  const cards = toCards(extractLines(MANUAL), { source: "OM-B.pdf", variant: "BOTH" });
  const session = buildSession(cards, {}, "BOTH");
  assert.ok(session.length > 0, "imported cards must be reviewable, not merely stored");
  assert.ok(isImported(session[0].unit));
});

test("an import can never shadow the published content", () => {
  const bundled = [{ id: "k1", title: "Bundled" }];
  const imported = [{ id: "k1", title: "Mine" }, { id: "imported:x:1", title: "Also mine" }];
  const merged = mergePool(bundled, imported);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].title, "Bundled", "the authoritative card wins its id");
  assert.equal(merged[1].id, "imported:x:1");
});

test("card ids are namespaced so they cannot collide with a pack", () => {
  const cards = toCards(extractLines(MANUAL), { source: "OM-B.pdf" });
  cards.forEach(function (card) { assert.match(card.id, /^imported:om-b-pdf:\d+$/); });
  assert.equal(isImported({ id: "knowledge-42" }), false);
  assert.equal(isImported(null), false);
});

/* -------------------------------------------------------------- QRH drafts */

test("steps keep the document's words, verbatim", () => {
  /* The safety rule. Nothing may be reworded, completed or corrected on the
     way in - what comes out is what the pilot's own manual said. */
  const steps = toDraftSteps({ controls: [] }, extractLines(MANUAL));
  const actions = steps.map(function (s) { return s.action; });
  assert.ok(actions.indexOf("Boost pumps — ON") >= 0);
  assert.ok(actions.indexOf("Crossfeed — CLOSED") >= 0);
  assert.ok(actions.indexOf("Fuel quantity — CHECK") >= 0);
});

test("a bare heading does not become a step", () => {
  const steps = toDraftSteps({ controls: [] }, ["EMERGENCY DESCENT", "Power levers — IDLE"]);
  assert.deepEqual(steps.map(function (s) { return s.action; }), ["Power levers — IDLE"]);
});

test("numbered steps lose the number, not the step", () => {
  const steps = toDraftSteps({ controls: [] }, [
    "1. Power levers — IDLE", "2) Flaps — UP", "3.2 Boost pumps — ON", "10 degrees flap — SET"
  ]);
  assert.deepEqual(steps.map(function (s) { return s.action; }),
    ["Power levers — IDLE", "Flaps — UP", "Boost pumps — ON", "10 degrees flap — SET"]);
});

test("a multi-level section number is removed whole", () => {
  /* The ported removePrefixNumber took only the first component, so
     "3.2 FUEL SYSTEM" became "2 FUEL SYSTEM" - a card front that reads as a
     typo and a step that no longer matches its control. */
  assert.equal(stripSectionNumber("3.2 FUEL SYSTEM"), "FUEL SYSTEM");
  assert.equal(stripSectionNumber("3.2.1 ENGINE FIRE"), "ENGINE FIRE");
  assert.equal(stripSectionNumber("1. Power levers — IDLE"), "Power levers — IDLE");
  assert.equal(stripSectionNumber("2) Flaps — UP"), "Flaps — UP");
  assert.equal(stripSectionNumber("10 degrees flap — SET"), "10 degrees flap — SET",
    "a leading number that is content keeps its number");
});

test("nothing is guessed about which items are memory items", () => {
  /*
    Memory items are a regulatory distinction made by the approved document.
    Deciding which of somebody's checklist lines are memory items would be
    inventing aviation data, so every imported step arrives as FLOW and a human
    moves it.
  */
  const steps = toDraftSteps({ controls: [] }, [
    "MEMORY ITEMS", "Power levers — IDLE", "Fuel — OFF", "COMPLETE CHECKLIST", "Flaps — UP"
  ]);
  assert.ok(steps.length > 0);
  steps.forEach(function (step) {
    assert.ok(!step.isMemory && !step.memory,
      "nothing here may decide a step is a memory item - that is what the source document says");
  });

  const screen = read("app/js/screens/import.js");
  assert.match(screen, /memoryStepDrafts: \[\]/, "an import never writes memory items");
  assert.match(screen, /flowStepDrafts: steps/);
});

test("a draft is written in the shape the server whitelists", () => {
  /* The server rebuilds the draft from a whitelist and returns null for
     anything else, so a draft in the wrong shape saves as nothing at all. */
  const screen = read("app/js/screens/import.js");
  ["title:", "trigger:", "memoryItems:", "flowItems:", "memoryStepDrafts:", "flowStepDrafts:", "notes:"]
    .forEach(function (field) { assert.ok(screen.indexOf(field) > -1, "draft must carry " + field); });

  const store = read("functions/api/qrh-edits/_store.js");
  ["title", "trigger", "memoryItems", "flowItems", "notes", "memoryStepDrafts", "flowStepDrafts"]
    .forEach(function (field) { assert.ok(store.indexOf(field + ": ") > -1, "server still whitelists " + field); });
});

test("the QRH draft route is gated on the editor's own entitlement", () => {
  /* Writing a draft needs QRH_MANUAL_EDIT because that is what it writes into.
     Cards do not, the same way anyone may upload to their own Sources shelf. */
  const screen = read("app/js/screens/import.js");
  assert.match(screen, /state\.authoring = await canEdit\(\)/);
  assert.match(screen, /state\.authoring\s*\n?\s*\? h\("div", \{ class: "mt-8" \}, \[draftButton\]\)/);
  assert.match(screen, /part of the Instructor plan/);
  assert.doesNotMatch(screen, /saveCards[\s\S]{0,200}authoring/, "cards are not gated on authoring");
});

/* ------------------------------------------------------------ PDF plumbing */

test("positioned PDF fragments are reassembled into lines", () => {
  /*
    pdf.js returns fragments, not lines: without grouping by the vertical
    position every page arrives as one paragraph and no step can be found.
  */
  const content = { items: [
    { str: "Boost pumps", transform: [1, 0, 0, 1, 40, 700] },
    { str: "— ON", transform: [1, 0, 0, 1, 200, 700] },
    { str: "Crossfeed", transform: [1, 0, 0, 1, 40, 680] },
    { str: "— CLOSED", transform: [1, 0, 0, 1, 200, 680] }
  ] };
  assert.deepEqual(linesFromTextContent(content), ["Boost pumps — ON", "Crossfeed — CLOSED"]);
});

test("lines come out top of page first", () => {
  /* PDF y grows upward, so the naive sort reverses the checklist. */
  const content = { items: [
    { str: "second", transform: [1, 0, 0, 1, 40, 100] },
    { str: "first", transform: [1, 0, 0, 1, 40, 700] }
  ] };
  assert.deepEqual(linesFromTextContent(content), ["first", "second"]);
});

test("fragments out of horizontal order are put back in reading order", () => {
  const content = { items: [
    { str: "ON", transform: [1, 0, 0, 1, 300, 700] },
    { str: "Boost pumps —", transform: [1, 0, 0, 1, 40, 700] }
  ] };
  assert.deepEqual(linesFromTextContent(content), ["Boost pumps — ON"]);
});

test("odd text content does not throw", () => {
  assert.deepEqual(linesFromTextContent({ items: [] }), []);
  assert.deepEqual(linesFromTextContent({}), []);
  assert.deepEqual(linesFromTextContent({ items: [{ str: "x" }] }), ["x"], "a fragment with no transform still counts");
  assert.deepEqual(linesFromTextContent({ items: [{ notStr: 1 }] }), []);
});

test("file types are recognised by type and by name", () => {
  assert.equal(isPdf({ type: "application/pdf" }), true);
  assert.equal(isPdf({ name: "OM-B.PDF" }), true);
  assert.equal(isPdf({ name: "notes.txt" }), false);
  assert.equal(isPdf(null), false);
  assert.equal(isText({ type: "text/plain" }), true);
  assert.equal(isText({ name: "checklist.md" }), true);
  assert.equal(isText({ name: "scan.png" }), false);
});

/* ------------------------------------------------------------- what ships */

test("the PDF library is vendored, lazily, and never precached", () => {
  const pdftext = read("app/js/pdftext.js");
  assert.match(pdftext, /import\("\/app\/vendor\/pdf-lib\.mjs"\)/, "on demand, like three.js");
  assert.match(pdftext, /GlobalWorkerOptions\.workerSrc = "\/app\/vendor\/pdf-worker\.mjs"/,
    "without this it runs on the main thread and locks the tab on a large manual");
  assert.match(pdftext, /libPromise = null;\s*\n\s*throw error;/,
    "a failed load must not disable Import for the rest of the session");

  ["app/vendor/pdf-lib.mjs", "app/vendor/pdf-worker.mjs", "app/vendor/PDFJS-LICENSE.txt"]
    .forEach(function (file) {
      assert.ok(fs.existsSync(path.join(root, file)), file + " must ship");
    });

  const sw = read("sw.js");
  assert.equal(sw.indexOf("pdf-lib.mjs"), -1, "1.7 MB must not be precached for people who never import");
  assert.equal(sw.indexOf("pdf-worker.mjs"), -1);
});

test("the document is never uploaded, and the screen says so", () => {
  /* An operations manual is exactly the document an operator forbids
     uploading. Extraction happens in the tab; if that ever changes, this is
     the test that should stop it. */
  const screen = read("app/js/screens/import.js");
  assert.match(screen, /never uploaded/);
  const pdftext = read("app/js/pdftext.js");
  assert.match(pdftext, /file\.arrayBuffer\(\)/);
  assert.doesNotMatch(pdftext, /fetch\(|FormData|XMLHttpRequest/, "nothing here may send the file anywhere");
});

test("the screen keeps the training-support-only statement", () => {
  const screen = read("app/js/screens/import.js");
  assert.match(screen, /does not replace the approved AFM, QRH, MEL/);
  assert.match(screen, /Check every imported item against the approved source/);
});

test("Import is wired into the app and into the study pool", () => {
  const app = read("app/app.js");
  assert.match(app, /route\("\/library\/import", importScreen\)/);

  const data = read("app/js/data.js");
  assert.match(data, /mergePool\(pack\.units \|\| \[\], importedCards\(\)\)/,
    "imported cards must reach the pool the study screens read");

  const core = read("app/js/core.js");
  assert.match(core, /id: "import"[^}]*status: "available"/);
  assert.doesNotMatch(core, /id: "import"[^}]*requires:/,
    "cards are available to every subscriber; only the QRH draft is gated, inside the screen");
});

test("no later screen still describes Import as unbuilt", () => {
  const misc = read("app/js/screens/misc.js");
  assert.doesNotMatch(misc, /That authoring pipeline stays in the app/,
    "the placeholder copy must go with the placeholder");
});
