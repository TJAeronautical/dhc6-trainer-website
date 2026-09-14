/*
  Import — turning a document the pilot already owns into training material.

  Android runs this on-device (PdfImportViewModel, QrhCandidateExtractor,
  ProcedureDocumentCandidateExtractor). The browser does the same work in the
  page: the PDF is read by the tab that opened it and is never uploaded for
  extraction. That is not only a privacy nicety - a company manual is exactly
  the sort of document an operator will not let leave their machine, and the
  feature is worth nothing to them if it does.

  AVIATION SAFETY. Nothing here invents, completes or corrects a procedure. It
  splits text the user supplied into candidate lines and hands them back for
  review. Extraction is lossy - a two-column manual page, a table, a figure
  caption - so every route out of this module lands in an editor first, never
  in something drillable without a human having looked at it.
*/

import { cleanManualStepText, emptyStep, defaultFlowRole, inferExpectedControlIds } from "./qrhedit.js";

const IMPORT_PREFIX = "imported:";
export const IMPORT_TAG = "SOURCE:IMPORTED";
export const CANDIDATE_TAG = "STATUS:CANDIDATE";

function str(value) { return value == null ? "" : String(value); }

/*
  Page furniture a manual repeats on every page. Dropping it is safe because
  none of it is procedure content; keeping it would put "Page 14 of 233" into a
  drill.
*/
const FURNITURE = [
  /^page\s+\d+(\s+of\s+\d+)?$/i,
  /^\d+\s*$/,
  /^rev(ision)?[\s.:-]+[\w.\/-]+$/i,
  /^issue[\s.:-]+[\w.\/-]+$/i,
  /^(dhc-?6|twin otter)[\s-]*(series\s*\d+)?$/i,
  /^[-=_*.—–\s]+$/
];

export function isFurniture(line) {
  const text = str(line).trim();
  if (!text) return true;
  return FURNITURE.some(function (pattern) { return pattern.test(text); });
}

/*
  Extracted text to candidate lines.

  Hyphenated words broken across a line end are rejoined, because a PDF
  extractor reports them as written and "HYDRAU- LIC PRESSURE" matches no
  control in the catalogue.
*/
export function extractLines(text) {
  const joined = str(text)
    .replace(/\r\n?/g, "\n")
    .replace(/([A-Za-z])-\n([a-z])/g, "$1$2")
    .replace(/\u00a0/g, " ");
  return joined.split("\n")
    .map(function (line) { return line.replace(/\s+/g, " ").trim(); })
    .filter(function (line) { return line && !isFurniture(line); });
}

/*
  Does this read like a checklist?

  Used only to pick which destination to OFFER first. It never decides anything
  on the user's behalf, so a wrong guess costs a click rather than a bad import.
*/
export function looksLikeProcedure(lines) {
  if (!lines || lines.length < 3) return false;
  const signals = lines.filter(function (line) {
    return /[—–:-]/.test(line) && line.length < 90;
  }).length;
  return signals / lines.length >= 0.4;
}

/*
  Strip a section number from the front of a line.

  The ported removePrefixNumber handles "1." and "2)" and is right for a
  checklist step, but it takes only the first component: "3.2 FUEL SYSTEM"
  came out as "2 FUEL SYSTEM". Multi-level numbers need their own pass, and it
  demands a following space so that "10 degrees flap - SET" keeps its ten.
*/
export function stripSectionNumber(value) {
  return str(value)
    .replace(/^\s*\d+(?:\.\d+)+[.)]?\s+/, "")
    .replace(/^\s*\d+[.)]\s*/, "")
    .trim();
}

/* A heading: short, and either all caps or numbered like "3.2 FUEL SYSTEM". */
export function isHeading(line) {
  const text = str(line).trim();
  if (!text || text.length > 70) return false;
  if (/^\d+(\.\d+)*[\s.)-]+\S/.test(text)) return true;
  const letters = text.replace(/[^A-Za-z]/g, "");
  return letters.length >= 3 && letters === letters.toUpperCase() && !/[.!?]$/.test(text);
}

/*
  Lines to QRH draft steps.

  The split between MEMORY and FLOW is the user's, not ours: memory items are a
  regulatory distinction in the source document and guessing which of somebody's
  checklist lines are memory items would be inventing aviation data. Everything
  arrives as FLOW and the editor moves it.
*/
export function toDraftSteps(catalog, lines) {
  const steps = [];
  (lines || []).forEach(function (line) {
    const text = cleanManualStepText(stripSectionNumber(line));
    if (!text) return;
    if (isHeading(line) && !/[—–:-]/.test(line)) return;
    const step = emptyStep({
      action: text,
      roleTag: defaultFlowRole(steps.length),
      expectedControlIds: inferExpectedControlIds(catalog, text)
    });
    steps.push(step);
  });
  return steps;
}

/*
  Lines to study cards.

  Two shapes, both taken from the document rather than composed:
    "NAME — VALUE"  ->  front NAME, back VALUE
    HEADING then the lines under it  ->  front HEADING, back those lines

  A line that is neither is dropped rather than turned into a card whose back
  is a repeat of its front, which is what a card with nothing to recall is.
*/
export function toCards(lines, options) {
  const opts = options || {};
  const system = str(opts.system).trim() || "IMPORTED";
  const source = str(opts.source).trim();
  const variant = str(opts.variant).trim().toUpperCase() || "BOTH";
  const cards = [];
  let heading = "";
  let body = [];

  const flush = function () {
    if (heading && body.length) {
      cards.push({ title: heading, content: body.join(" ") });
    }
    heading = "";
    body = [];
  };

  (lines || []).forEach(function (line) {
    const pair = line.match(/^(.{2,70}?)\s*[—–:]\s*(.+)$/);
    if (pair && pair[1].trim() && pair[2].trim()) {
      flush();
      cards.push({ title: pair[1].trim(), content: pair[2].trim() });
      return;
    }
    if (isHeading(line)) { flush(); heading = stripSectionNumber(line); return; }
    if (heading) body.push(line);
  });
  flush();

  return cards.map(function (card, index) {
    return {
      id: IMPORT_PREFIX + slug(source || system) + ":" + (index + 1),
      title: card.title,
      content: card.content,
      system: system,
      aircraftVariant: variant,
      tags: [CANDIDATE_TAG, IMPORT_TAG],
      importedFrom: source || null,
      importedAt: new Date().toISOString()
    };
  });
}

function slug(value) {
  return str(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "document";
}

export function isImported(unit) {
  return Boolean(unit && typeof unit.id === "string" && unit.id.indexOf(IMPORT_PREFIX) === 0);
}

/*
  Merge imported cards into the bundled pool.

  Imported cards lose to a bundled card of the same id, which cannot happen
  today - the prefix makes collision impossible - but the rule matters if the
  published pool ever adopts an id we already used. The authoritative content
  wins; a user's import never shadows it.
*/
export function mergePool(bundled, imported) {
  const known = {};
  const out = (bundled || []).slice();
  out.forEach(function (unit) { if (unit && unit.id) known[unit.id] = true; });
  (imported || []).forEach(function (unit) {
    if (unit && unit.id && !known[unit.id]) out.push(unit);
  });
  return out;
}
