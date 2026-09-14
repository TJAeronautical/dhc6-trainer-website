/*
  IMPORT — a document the pilot owns, turned into training material.

  Port of Android's on-device import (PdfImportViewModel, QrhCandidateExtractor,
  ProcedureDocumentCandidateExtractor), with the same shape: pick a document,
  extract, REVIEW, then choose where it goes.

  Two destinations, gated differently, and the split follows the one the Library
  already uses rather than a new rule:

    Study cards   any active subscriber, the way anyone may upload to their own
                  Sources shelf. Importing your own manual for your own study is
                  studying, not authoring.
    QRH draft     QRH_MANUAL_EDIT (Instructor and above), the same entitlement
                  the QRH editor itself requires - because that is what this
                  writes into.

  AVIATION SAFETY. Nothing is auto-committed and nothing is invented. Extraction
  from a PDF is lossy, so everything lands in an editor and the disclaimer says
  plainly that the result must be checked against the approved document.
*/

import { h, Store, Content, Entitlements, currentVariant, feature } from "../core.js";
import { screen, blueCard, backBubble, statusPill, outlinedButton, matButton, settingsSection } from "../ui.js";
import { extractLines, looksLikeProcedure, toCards, toDraftSteps } from "../logic/import.js";
import { isPdf, isText, extractPdfText, readTextFile } from "../pdftext.js";
import { saveEdit, canEdit } from "../qrhedits.js";

const IMPORTED_KEY = "importedCards";

export function importedCards() {
  const stored = Store.get(IMPORTED_KEY);
  return Array.isArray(stored) ? stored : [];
}

export function saveImportedCards(cards) {
  return Store.set(IMPORTED_KEY, cards);
}

export async function importScreen(ctx) {
  ctx.setTopbar({ title: "Import", subtitle: "Manuals, PDFs and documents", back: "#/dashboard" });

  const state = { text: "", source: "", pages: 0, busy: false, authoring: false };
  const root = h("div", { class: "stack-12" });

  try { state.authoring = await canEdit(); } catch (error) { state.authoring = false; }

  /* ------------------------------------------------------------- picking */
  const fileInput = h("input", {
    type: "file",
    accept: ".pdf,.txt,.md,.markdown,.csv,.log,application/pdf,text/plain",
    style: "display:none",
    onchange: function () { if (fileInput.files && fileInput.files[0]) take(fileInput.files[0]); }
  });

  const progress = h("div", { class: "t-body-s c-ter mt-6", hidden: true });

  async function take(file) {
    state.busy = true;
    state.source = file.name || "document";
    progress.hidden = false;
    progress.textContent = "Reading " + state.source + "…";
    render();
    try {
      let result;
      if (isPdf(file)) {
        result = await extractPdfText(file, {
          onProgress: function (p) { progress.textContent = "Reading page " + p.page + " of " + p.pages + "…"; }
        });
      } else if (isText(file)) {
        result = await readTextFile(file);
      } else {
        /* Android imports images through OCR. There is no OCR here, and
           pretending otherwise by accepting the file and producing nothing
           would be worse than saying so. */
        progress.textContent = "";
        progress.hidden = true;
        state.busy = false;
        ctx.toast("Only PDF and text files can be read here");
        render();
        return;
      }
      state.text = result.text;
      state.pages = result.pages;
      if (result.totalPages > result.pages) {
        ctx.toast("Read the first " + result.pages + " of " + result.totalPages + " pages");
      }
    } catch (error) {
      ctx.toast("That file could not be read");
      state.text = "";
    }
    state.busy = false;
    progress.hidden = true;
    render();
  }

  /* -------------------------------------------------------------- saving */
  async function saveCards(lines) {
    const cards = toCards(lines, { source: state.source, variant: currentVariant() });
    if (!cards.length) {
      ctx.toast("No question-and-answer pairs were found in this text");
      return;
    }
    const existing = importedCards().filter(function (card) { return card.importedFrom !== state.source; });
    saveImportedCards(existing.concat(cards));
    ctx.toast(cards.length + " card" + (cards.length === 1 ? "" : "s") + " added to Flashcard Study");
    render();
  }

  async function saveDraft(lines) {
    let catalog;
    try { catalog = await Content.pack("qrh-editor"); } catch (error) { catalog = { controls: [] }; }
    const steps = toDraftSteps(catalog, lines);
    if (!steps.length) {
      ctx.toast("No procedure steps were found in this text");
      return;
    }
    /* The shape the server whitelists (functions/api/qrh-edits/_store.js):
       flowItems is the plain checklist text, flowStepDrafts the structured
       steps the drill runner uses. Both are written so the draft reads
       correctly in the editor whichever lane it opens in. Everything arrives
       as FLOW - see toDraftSteps on why memory items are the user's call. */
    const id = "imported-" + Date.now().toString(36);
    try {
      await saveEdit(id, {
        title: state.source || "Imported procedure",
        trigger: "Imported from " + (state.source || "a document") + " - not yet checked against the approved source",
        memoryItems: [],
        flowItems: steps.map(function (step) { return step.action; }),
        memoryStepDrafts: [],
        flowStepDrafts: steps,
        notes: ["Imported by text extraction. Check every step against the approved document before use."]
      });
      ctx.toast("Draft saved - open Library > QRH Drafts to review it");
      ctx.navigate("/library/qrh-drafts");
    } catch (error) {
      ctx.toast("The draft could not be saved");
    }
  }

  /* ------------------------------------------------------------ rendering */
  function render() {
    const lines = extractLines(state.text);
    const held = importedCards();

    const textarea = h("textarea", {
      class: "import-text",
      rows: 12,
      spellcheck: "false",
      placeholder: "Paste text from a manual, or choose a file above.",
      style: "width:100%;min-height:180px;font:inherit;padding:10px;border-radius:10px;border:1px solid var(--hairline);background:var(--surface-2,rgba(255,255,255,.04));color:inherit",
      oninput: function () { state.text = textarea.value; refreshSummary(); }
    });
    textarea.value = state.text;

    const summary = h("div", { class: "t-body-s c-ter mt-6" });
    function refreshSummary() {
      const now = extractLines(textarea.value);
      summary.textContent = now.length
        ? now.length + " usable line" + (now.length === 1 ? "" : "s") + " after removing page numbers and headers."
        : "Nothing usable yet.";
    }
    refreshSummary();

    const cardsButton = matButton("Add to Flashcard Study", function () {
      saveCards(extractLines(textarea.value));
    }, { block: true });

    const draftButton = outlinedButton("Create a QRH draft", function () {
      saveDraft(extractLines(textarea.value));
    }, { small: true });

    const destinations = [
      h("div", { class: "t-title-m c-white", text: "Where should it go?" }),
      h("div", { class: "t-body-s c-ter mt-4", text: looksLikeProcedure(lines)
        ? "This reads like a checklist. A QRH draft keeps the step order and can be drilled once you have checked it."
        : "This reads like reference text. Study cards turn each heading or “name — value” line into a flashcard." }),
      h("div", { class: "mt-10" }, [cardsButton]),
      state.authoring
        ? h("div", { class: "mt-8" }, [draftButton])
        : h("div", { class: "t-body-s c-ter mt-8", text: "Creating a QRH draft is part of the Instructor plan." })
    ];

    root.replaceChildren(
      h("div", { class: "row wrap gap-8" }, [statusPill(feature("import").status)]),

      blueCard([
        h("div", { class: "t-title-m c-white", text: "1. Choose a document" }),
        h("div", { class: "t-body-s c-ter mt-4", text: "PDF, plain text or markdown. The file is read here in your browser and is never uploaded — your company manual stays on this device." }),
        h("div", { class: "row gap-8 wrap mt-10" }, [
          outlinedButton(state.busy ? "Reading…" : "Choose file", function () { if (!state.busy) fileInput.click(); }, { small: true }),
          fileInput
        ]),
        progress,
        state.source && state.text
          ? h("div", { class: "t-body-s c-sec mt-6", text: state.source + (state.pages > 1 ? " · " + state.pages + " pages" : "") })
          : null
      ]),

      blueCard([
        h("div", { class: "t-title-m c-white", text: "2. Check what came out" }),
        h("div", { class: "t-body-s c-ter mt-4", text: "Extraction is not perfect — columns, tables and figure captions come out jumbled. Edit this before continuing." }),
        h("div", { class: "mt-10" }, [textarea]),
        summary
      ]),

      state.text ? blueCard(destinations) : null,

      held.length ? blueCard([
        settingsSection("Imported cards"),
        h("div", { class: "t-body-s c-sec", text: held.length + " imported card" + (held.length === 1 ? "" : "s") + " are in your Flashcard Study queue." }),
        h("div", { class: "row gap-8 wrap mt-8" }, [
          outlinedButton("Open Flashcard Study", function () { ctx.navigate("/study/srs"); }, { small: true }),
          outlinedButton("Remove imported cards", function () {
            if (!window.confirm("Remove all " + held.length + " imported cards from this device?")) return;
            saveImportedCards([]);
            ctx.toast("Imported cards removed");
            render();
          }, { small: true })
        ])
      ]) : null,

      blueCard([
        h("div", { class: "t-body-s c-sec", text: "Training support only" }),
        h("div", { class: "t-body-s c-ter mt-4", text: "Imported material is a copy of your own document, extracted by software. It does not replace the approved AFM, QRH, MEL, company manuals, approved checklists or any regulatory or operator documentation. Check every imported item against the approved source before using it." })
      ])
    );
  }

  render();
  return screen({ title: "Import", library: true, header: [backBubble("#/dashboard")] }, [root]);
}
