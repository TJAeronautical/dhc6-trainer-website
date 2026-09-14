/*
  PDF text extraction, in the page.

  pdf.js is vendored (app/vendor/pdf-lib.mjs, ~350 KB plus a 1.4 MB worker) and
  imported ON DEMAND, the same way three.js is for the Technical Lab. Nobody who
  never opens Import pays for it, which matters on the mobile connections this
  app is meant to work on.

  The file never leaves the browser. That is the point: a company operations
  manual is exactly the document an operator will not allow to be uploaded, and
  an import feature that required it would be worth nothing to them.
*/

let libPromise = null;

function load() {
  if (!libPromise) {
    libPromise = import("/app/vendor/pdf-lib.mjs").then(function (pdfjs) {
      /* The worker is a separate file and pdf.js must be told where it is;
         without this it falls back to running on the main thread, which locks
         the UI solid on a 200-page manual. */
      pdfjs.GlobalWorkerOptions.workerSrc = "/app/vendor/pdf-worker.mjs";
      return pdfjs;
    }).catch(function (error) {
      /* A failed import must not be cached as a permanent failure - a dropped
         connection on the first try would otherwise disable Import for the
         rest of the session. */
      libPromise = null;
      throw error;
    });
  }
  return libPromise;
}

export function isPdf(file) {
  if (!file) return false;
  if (file.type === "application/pdf") return true;
  return /\.pdf$/i.test(String(file.name || ""));
}

/*
  Reassemble a page's text items into lines.

  pdf.js returns positioned fragments, not lines: a fragment per run of styling,
  in reading order but with no newlines. Grouping by the vertical position in
  the text matrix is what turns them back into the lines a checklist was written
  as - without it every page arrives as one unbroken paragraph and nothing
  downstream can find a step.
*/
export function linesFromTextContent(content, tolerance) {
  const gap = typeof tolerance === "number" ? tolerance : 2;
  const rows = [];
  (content.items || []).forEach(function (item) {
    if (typeof item.str !== "string") return;
    const y = item.transform ? Math.round(item.transform[5] / gap) * gap : 0;
    const row = rows.find(function (r) { return Math.abs(r.y - y) <= gap; });
    if (row) row.parts.push(item);
    else rows.push({ y: y, parts: [item] });
  });
  /* Top of the page first: PDF y grows upward. */
  rows.sort(function (a, b) { return b.y - a.y; });
  return rows.map(function (row) {
    const sorted = row.parts.slice().sort(function (a, b) {
      return (a.transform ? a.transform[4] : 0) - (b.transform ? b.transform[4] : 0);
    });
    return sorted.map(function (item) { return item.str; }).join(" ").replace(/\s+/g, " ").trim();
  }).filter(Boolean);
}

/*
  Extract every page. `onProgress({ page, pages })` so a 200-page manual shows
  movement rather than an apparently hung tab.

  `pageLimit` is a guard, not a product decision: a very large document would
  otherwise build a string big enough to lose the tab, and stopping with a
  stated count is better than dying silently.
*/
export async function extractPdfText(file, options) {
  const opts = options || {};
  const pdfjs = await load();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data: data, isEvalSupported: false }).promise;
  const limit = Math.min(doc.numPages, Number(opts.pageLimit) || 400);
  const out = [];

  try {
    for (let n = 1; n <= limit; n++) {
      if (opts.shouldStop && opts.shouldStop()) break;
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      out.push(linesFromTextContent(content).join("\n"));
      /* Release the page's canvas-side resources as we go; holding 400 of them
         is what turns a large import into a crashed tab. */
      if (page.cleanup) page.cleanup();
      if (opts.onProgress) opts.onProgress({ page: n, pages: limit });
    }
  } finally {
    if (doc.destroy) await doc.destroy();
  }

  return { text: out.join("\n"), pages: limit, totalPages: doc.numPages };
}

/* Plain text and markdown need no library at all. */
export function isText(file) {
  if (!file) return false;
  if (/^text\//.test(String(file.type || ""))) return true;
  return /\.(txt|md|markdown|csv|log)$/i.test(String(file.name || ""));
}

export async function readTextFile(file) {
  return { text: await file.text(), pages: 1, totalPages: 1 };
}
