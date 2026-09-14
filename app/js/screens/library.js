/*
  Library — ports of
    feature-knowledge/ui/screens/LibraryHubScreen.kt
    feature-knowledge/ui/screens/SourcesScreen.kt
    feature-knowledge/ui/screens/PublishedContentScreen.kt

  Two things the Kotlin settles that earlier guesses got wrong:

  1. Published is NOT a document shelf. PublishedContentScreen takes a list of
     CompiledDrillProcedure and shows the ones whose reviewStatus is PUBLISHED,
     as "title / CATEGORY • VARIANT / Status: PUBLISHED". The web app already
     has exactly that data in the published procedure packs, so this screen is a
     faithful port rather than an invention.

  2. Sources is the SHARED source index — LibraryHubScreen calls it "Imported
     PDFs, source documents, and promoted content in the shared source index."
     So the documents an owner or instructor publishes belong here, alongside the
     account's own, not on a separate shelf.

  Android's Library holds what the user imported on the device into Room via
  PdfImportScreen; there are no documents in core-res/src/main/assets. The
  browser cannot run that extraction pipeline, so the web edition keeps the
  screens and swaps the import for a straight upload: the file goes to R2 behind
  the session gate and opens in the browser's own viewer.

  Where Android shows extraction facts the browser has no equivalent for —
  "Created: N linked study items", Re-import — the web shows what it actually
  knows (file name, size, date) rather than inventing a count.
*/
import { h } from "../core.js";
import { screen, blueCard, libraryDivider, bubble, notice, statusPill, primaryButton } from "../ui.js";
import { allProcedures } from "../data.js";
import { listEdits, canEdit as canEditQrh } from "../qrhedits.js";

const ENDPOINT = "/api/library";

async function loadLibrary() {
  const response = await fetch(ENDPOINT, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
  let data = null;
  try { data = await response.json(); } catch (error) { data = null; }
  if (!response.ok || !data || data.ok !== true) {
    const error = new Error((data && data.error) || "library_unavailable");
    error.status = response.status;
    throw error;
  }
  return data;
}

async function deleteDoc(shelf, docId) {
  const response = await fetch(ENDPOINT + "/doc/" + shelf + "/" + encodeURIComponent(docId), {
    method: "DELETE", credentials: "same-origin", cache: "no-store"
  });
  if (!response.ok) {
    let data = null;
    try { data = await response.json(); } catch (error) { data = null; }
    const error = new Error((data && data.error) || "delete_failed");
    error.status = response.status;
    throw error;
  }
}

function uploadDoc(file, fields, onProgress) {
  /* XHR rather than fetch: a manual can be tens of megabytes on a phone
     connection, and upload progress is the difference between "working" and
     "broken" to the person watching it. */
  return new Promise(function (resolve, reject) {
    const request = new XMLHttpRequest();
    request.open("POST", ENDPOINT + "/doc", true);
    request.withCredentials = true;
    request.setRequestHeader("X-Doc-Shelf", fields.shelf);
    request.setRequestHeader("X-Doc-Filename", encodeHeader(file.name));
    request.setRequestHeader("X-Doc-Title", encodeHeader(fields.title || file.name));
    request.setRequestHeader("X-Doc-Type", fields.docType || "OTHER");
    if (fields.note) request.setRequestHeader("X-Doc-Note", encodeHeader(fields.note));
    request.upload.onprogress = function (event) {
      if (onProgress && event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = function () {
      let data = null;
      try { data = JSON.parse(request.responseText); } catch (error) { data = null; }
      if (request.status >= 200 && request.status < 300 && data && data.ok) return resolve(data);
      const error = new Error((data && data.error) || "upload_failed");
      error.status = request.status;
      reject(error);
    };
    request.onerror = function () { reject(new Error("network_error")); };
    request.send(file);
  });
}

/* A header value must be Latin-1; "Håndbok.pdf" would throw on
   setRequestHeader. Escaped on the way out, decoded before display. */
function encodeHeader(value) {
  return String(value == null ? "" : value).replace(/[^\x20-\x7E]/g, function (ch) {
    return "%" + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0");
  });
}
export function decodeHeaderText(value) {
  try { return decodeURIComponent(String(value || "")); } catch (error) { return String(value || ""); }
}

export function formatBytes(n) {
  const bytes = Number(n) || 0;
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(bytes < 10485760 ? 1 : 0) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + " GB";
}

export function docHref(shelf, docId) {
  return "/api/library/doc/" + shelf + "/" + encodeURIComponent(docId);
}

function docDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });
}

function notConfigured() {
  return blueCard([
    h("div", { class: "row wrap gap-8" }, [statusPill("later"), h("span", { class: "t-title-s w-semi c-white", text: "Library storage is not configured" })]),
    h("p", { class: "t-body-m c-sec mt-8", text: "This deployment has no document store bound, so nothing can be uploaded or listed yet. Everything else in the app is unaffected." }),
    h("p", { class: "t-body-s c-ter mt-8", text: "Bind an R2 bucket as WEB_LIBRARY in wrangler.jsonc and redeploy." })
  ]);
}

function unavailable(error) {
  const forbidden = error && (error.status === 401 || error.status === 403);
  return notice(forbidden
    ? "Your session no longer has access to the Library. Sign in again to continue."
    : "The Library could not be loaded. Check your connection and try again.");
}

/* ------------------------------------------------------ LibraryHubScreen */
export async function libraryHub(ctx) {
  ctx.setTopbar({ title: "Library", subtitle: "Import · Sources · Published", back: "#/dashboard" });
  const root = screen({ title: "Library", library: true, header: [bubble("light", "Back", { href: "#/dashboard" })] }, []);
  const body = h("div", { class: "stack-10" });
  root.appendChild(body);

  let data;
  try { data = await loadLibrary(); } catch (error) { body.appendChild(unavailable(error)); return root; }
  const authoring = Boolean(data.canPublish);

  /* LibraryHubScreen's two intro strings, verbatim. */
  body.appendChild(h("p", { class: "t-body-m c-white", text: authoring
    ? "One place for protected knowledge imports, source documents, extracted QRH procedures, and published training content."
    : "Read-only source index and published training content. Knowledge import is visible here, but opens only for authorised accounts." }));
  body.appendChild(h("div", { class: "mt-4" }));
  body.appendChild(libraryDivider());
  body.appendChild(h("div", { class: "mt-4" }));

  if (!data.configured) { body.appendChild(notConfigured()); return root; }

  function card(title, text, buttonTitle, href, extra) {
    return blueCard([
      h("div", { class: "t-title-m c-white", text: title }),
      h("div", { class: "t-body-s c-white mt-10", text: text }),
      extra || null,
      h("div", { class: "mt-10" }, h("a", { class: "bubble light", href: href, text: buttonTitle }))
    ]);
  }

  /* Card order is the Kotlin's: Import, Sources, [QRH Drafts], Published. */
  body.appendChild(card("Import",
    authoring
      ? "Import selectable PDFs and structured JSON before reviewing sources or compiling procedures."
      : "Protected import entry for owner or content-authoring accounts. Free and guest accounts remain read-only here.",
    authoring ? "Open Import" : "Unlock Import", "#/library/import"));
  body.appendChild(h("div", { class: "mt-4" }));

  const sourceCount = data.privateShelf.items.length + data.publishedShelf.items.length;
  body.appendChild(card("Sources",
    "Imported PDFs, source documents, and promoted content in the shared source index.",
    "Open Sources", "#/library/sources",
    h("div", { class: "t-body-s c-ter mt-6", text: sourceCount + (sourceCount === 1 ? " document" : " documents") + " · " + formatBytes(data.privateShelf.usedBytes) + " of " + formatBytes(data.limits.totalBytes) + " used" })));
  body.appendChild(h("div", { class: "mt-4" }));

  /* allowCompileTools in the Kotlin. The web equivalent of the compile queue is
     the account's own QRH edits, which /api/qrh-edits already indexes. */
  if (authoring) {
    body.appendChild(card("QRH Drafts",
      "Review extracted QRH procedures in the shared QRH edit screen.",
      "Open QRH Drafts", "#/library/qrh-drafts"));
    body.appendChild(h("div", { class: "mt-4" }));
  }

  body.appendChild(card("Published", "Trusted runtime-ready content only.", "Open Published", "#/library/published"));
  return root;
}

/* ---------------------------------------------------------- SourcesScreen */
export async function librarySources(ctx) {
  ctx.setTopbar({ title: "Library Sources", subtitle: "Shared source index", back: "#/library/home" });

  /* screen() only creates .screen-header when it is given one, and render()
     replaces its children once the count is known. */
  const root = screen({ title: "Library Sources", library: true, header: [bubble("dark", "Back", { href: "#/library/home" })] }, []);
  const body = h("div", { class: "stack-10" });
  root.appendChild(body);

  let data;
  async function refresh() {
    try { data = await loadLibrary(); } catch (error) { body.replaceChildren(unavailable(error)); return false; }
    return true;
  }
  if (!(await refresh())) return root;
  if (!data.configured) { body.appendChild(notConfigured()); return root; }

  const status = h("div", { class: "t-body-s c-sec", "aria-live": "polite" });

  /* One list, as Android has one source index: the shared documents first,
     then this account's own. `shelf` rides along so each row knows where it
     lives and who may remove it. */
  function allSources() {
    return data.publishedShelf.items.map(function (d) { return { doc: d, shelf: "published" }; })
      .concat(data.privateShelf.items.map(function (d) { return { doc: d, shelf: "private" }; }));
  }

  function render() {
    const sources = allSources();
    const authoring = Boolean(data.canPublish);

    /* SourcesScreen's header: Back, a Sources bubble carrying the count, and
       Import for authoring accounts. */
    const header = root.querySelector(".screen-header") || null;
    const headerNodes = [
      bubble("dark", "Back", { href: "#/library/home" }),
      bubble("light", "Sources", { count: sources.length, onClick: function () { /* noop, as the Kotlin */ } })
    ];
    if (authoring) headerNodes.push(bubble("dark", "Import", { href: "#/library/import" }));
    if (header) header.replaceChildren.apply(header, headerNodes);

    const nodes = [libraryDivider(), h("div", { class: "mt-4" }), uploadCard(authoring), status];

    if (!sources.length) {
      nodes.push(emptySourcesCard(authoring));
    } else {
      sources.forEach(function (entry) { nodes.push(sourceCard(entry, authoring)); });
    }
    nodes.push(h("p", { class: "t-body-s c-ter", text: "Training support only. A document here is a reference copy and is not an approved AFM, QRH, MEL, company manual or checklist." }));
    body.replaceChildren.apply(body, nodes.filter(Boolean));
  }

  /* EmptySourcesCard — the Kotlin's title, and its read-only body, which is
     still true in the browser. The authoring body names an upload rather than
     an on-device import. */
  function emptySourcesCard(authoring) {
    return blueCard([
      h("div", { class: "t-title-m w-xbold c-white", text: "No sources yet." }),
      h("p", { class: "t-body-m c-sec mt-8", text: authoring
        ? "Upload a PDF, AFM/POH, QRH, flashcard document or image-backed study pack. Everything you add is tracked here so it can be reviewed, replaced or removed from one place."
        : "No source documents are installed. Runtime study content can still be available from Systems, QRH, and Flashcards." })
    ]);
  }

  /* SourceCard — title, "TYPE • VARIANT • Active", then the facts the browser
     actually has. Android's "Created: N linked study items" counts rows the
     on-device extractor wrote; there is no extractor here, so the line is the
     file itself rather than a fabricated count. */
  function sourceCard(entry, authoring) {
    const doc = entry.doc;
    const shared = entry.shelf === "published";
    const mayRemove = shared ? authoring : true;
    return blueCard([
      h("div", { class: "row between gap-12" }, [
        h("div", { class: "t-title-m w-semi c-white grow clamp-2", text: decodeHeaderText(doc.title) }),
        shared ? h("span", { class: "pill info", text: "Shared" }) : null
      ]),
      h("div", { class: "t-body-s c-sec mt-4", text: doc.docType + " • " + (shared ? "Shared source index" : "Your account") + " • Active" }),
      h("div", { class: "t-body-s c-sec mt-4", text: decodeHeaderText(doc.fileName) + " • " + formatBytes(doc.bytes) + " • Added " + docDate(doc.uploadedAt) + (doc.publishedBy ? " by " + doc.publishedBy : "") }),
      doc.note ? h("div", { class: "t-body-s c-ter mt-4", text: decodeHeaderText(doc.note) }) : null,
      h("div", { class: "row gap-8 wrap mt-10" }, [
        h("a", { class: "bubble light", href: docHref(entry.shelf, doc.docId), target: "_blank", rel: "noopener", text: "Open" }),
        mayRemove ? h("button", {
          class: "bubble dark", type: "button", text: "Delete",
          onclick: function () { confirmDelete(entry); }
        }) : null
      ])
    ]);
  }

  /* The Kotlin confirms before deleting and spells out what goes with it. */
  function confirmDelete(entry) {
    const title = decodeHeaderText(entry.doc.title) || entry.doc.fileName;
    const shared = entry.shelf === "published";
    const message = "Delete source?\n\n" + title + "\n\n" +
      (shared
        ? "This removes it from the shared source index for everyone on this plan."
        : "This removes the document from your account on every browser you sign in from.") +
      "\n\nPublished QRH drills are not removed here.";
    if (!window.confirm(message)) return;
    status.textContent = "Deleting…";
    deleteDoc(entry.shelf, entry.doc.docId)
      .then(refresh)
      .then(function (ok) { if (ok) { status.textContent = "Source deleted."; render(); } })
      .catch(function (error) { status.textContent = "Could not delete that source (" + (error.message || "error") + ")."; });
  }

  function uploadCard(authoring) {
    const fileInput = h("input", { type: "file", accept: ".pdf,.png,.jpg,.jpeg,.webp,.svg,.txt,.md,.csv", "aria-label": "Document file" });
    const titleInput = h("input", { type: "text", placeholder: "Title (optional)", "aria-label": "Document title" });
    const noteInput = h("input", { type: "text", placeholder: "Note (optional)", "aria-label": "Document note" });
    const typeSelect = h("select", { "aria-label": "Document type" }, (data.docTypes || []).map(function (t) {
      return h("option", { value: t, text: t, selected: t === "MANUAL" ? true : null });
    }));
    /* Authoring accounts choose where it lands; everyone else can only add to
       their own account, which is what the API enforces anyway. */
    const shelfSelect = authoring ? h("select", { "aria-label": "Where to add this document" }, [
      h("option", { value: "private", text: "My account only", selected: true }),
      h("option", { value: "published", text: "Shared source index (everyone)" })
    ]) : null;
    const bar = h("div", { class: "progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0", hidden: true }, h("span", { style: "width:0%" }));

    const button = primaryButton("Add document", function () {
      const file = fileInput.files && fileInput.files[0];
      if (!file) { status.textContent = "Choose a file first."; return; }
      if (file.size > data.limits.bytes) { status.textContent = "That file is larger than the " + formatBytes(data.limits.bytes) + " limit."; return; }
      button.disabled = true;
      bar.hidden = false;
      status.textContent = "Uploading " + file.name + "…";
      uploadDoc(file, {
        shelf: shelfSelect ? shelfSelect.value : "private",
        title: titleInput.value, docType: typeSelect.value, note: noteInput.value
      }, function (fraction) {
        const pct = Math.round(fraction * 100);
        bar.firstChild.style.width = pct + "%";
        bar.setAttribute("aria-valuenow", String(pct));
      })
        .then(refresh)
        .then(function (ok) {
          button.disabled = false; bar.hidden = true;
          if (!ok) return;
          status.textContent = "Source added.";
          render();
        })
        .catch(function (error) {
          button.disabled = false; bar.hidden = true;
          status.textContent = uploadErrorText(error, data.limits);
        });
    }, { block: true });

    return blueCard([
      h("div", { class: "t-title-m w-semi c-white", text: "Add a source document" }),
      h("div", { class: "t-body-s c-ter mt-4", text: "PDF, image, text, markdown or CSV, up to " + formatBytes(data.limits.bytes) + ". Android imports and extracts on the device; the browser keeps the document and opens it." }),
      h("div", { class: "stack-8 mt-10" }, [fileInput, titleInput, typeSelect, shelfSelect, noteInput, bar, button].filter(Boolean))
    ]);
  }

  render();
  return root;
}

export function uploadErrorText(error, limits) {
  const code = (error && error.message) || "";
  if (code === "file_too_large") return "That file is larger than the " + formatBytes(limits && limits.bytes) + " limit.";
  if (code === "unsupported_file_type") return "That file type cannot be stored. Use a PDF, image, text, markdown or CSV file.";
  if (code === "quota_exceeded") return "Your Library is full. Remove a document to free space.";
  if (code === "library_full") return "This shelf has reached its document limit.";
  if (code === "publish_forbidden") return "Adding to the shared source index needs Instructor, Enterprise or Owner access.";
  if (code === "library_not_configured") return "Library storage is not configured on this deployment yet.";
  if (code === "empty_file") return "That file is empty.";
  if (code === "network_error") return "The upload did not reach the server. Check your connection and try again.";
  return "The upload failed (" + (code || "unknown error") + ").";
}

/* -------------------------------------------------- PublishedContentScreen */
/*
  The Kotlin filters CompiledDrillProcedure by reviewStatus == PUBLISHED and
  shows title / CATEGORY • VARIANT / Status. Everything in the web app's
  procedure packs is published content by definition — it is what /api/content
  serves — so this lists the same set from the same data.
*/
export async function libraryPublished(ctx) {
  ctx.setTopbar({ title: "Published", subtitle: "Runtime-ready content", back: "#/library/home" });
  const root = screen({ title: "Published", library: true, header: [bubble("dark", "Back", { href: "#/library/home" })] }, []);
  const body = h("div", { class: "stack-10" });
  root.appendChild(body);

  let procedures;
  try { procedures = await allProcedures(); } catch (error) {
    body.appendChild(unavailable(error));
    return root;
  }

  const published = (procedures || []).filter(function (p) { return (p.memory || []).length || (p.flow || []).length; });
  if (!published.length) {
    body.appendChild(h("p", { class: "t-body-m c-white", text: "No published content yet." }));
    return root;
  }

  body.appendChild(h("p", { class: "t-body-m c-sec", text: published.length + " published procedures are installed and drillable. Published content is served from the training packs, not from uploaded documents." }));
  body.appendChild(libraryDivider());

  const byCategory = { EMERGENCY: [], ABNORMAL: [], NORMAL: [] };
  published.forEach(function (p) { (byCategory[p.category] || (byCategory[p.category] = [])).push(p); });

  Object.keys(byCategory).forEach(function (category) {
    const items = byCategory[category];
    if (!items.length) return;
    body.appendChild(h("div", { class: "t-title-m w-bold c-white mt-10", text: category.charAt(0) + category.slice(1).toLowerCase() + " · " + items.length }));
    items.forEach(function (p) {
      body.appendChild(blueCard([
        h("div", { class: "t-title-m w-semi c-white clamp-2", text: p.displayTitle }),
        h("div", { class: "t-body-m c-sec mt-4", text: p.category + " • " + p.aircraftVariant }),
        h("div", { class: "t-body-s c-ter mt-4", text: "Status: PUBLISHED" }),
        h("div", { class: "mt-8" }, h("a", { class: "bubble light", href: "#/procedures/detail/" + encodeURIComponent(p.compiledId), text: "Open" }))
      ]));
    });
  });
  return root;
}

/* ------------------------------------------- QRH Drafts (compile queue) */
/*
  LibraryHubScreen's onOpenCompileQueue, for accounts with authoring tools. The
  Android queue holds procedures the PDF extractor produced; the browser's
  equivalent is the account's own manual QRH edits, which /api/qrh-edits already
  indexes and the QRH editor already writes.
*/
export async function libraryQrhDrafts(ctx) {
  ctx.setTopbar({ title: "QRH Drafts", subtitle: "Your edited procedures", back: "#/library/home" });
  const root = screen({ title: "QRH Drafts", library: true, header: [bubble("dark", "Back", { href: "#/library/home" })] }, []);
  const body = h("div", { class: "stack-10" });
  root.appendChild(body);

  let mayEdit = false;
  try { mayEdit = await canEditQrh(); } catch (error) { mayEdit = false; }
  if (!mayEdit) {
    /* Not "coming later" — it exists and is finished, this plan just may not
       use it. A COMING LATER pill here would say something untrue. */
    body.appendChild(blueCard([
      h("div", { class: "t-title-m w-xbold c-white", text: "Not available on this plan" }),
      h("p", { class: "t-body-m c-sec mt-8", text: "QRH editing requires Instructor, Enterprise or Owner access. Pro subscribers can view and drill every published QRH checklist, but cannot edit the source procedures." }),
      h("div", { class: "mt-10" }, h("a", { class: "bubble light", href: "#/qrh", text: "Open QRH" }))
    ]));
    return root;
  }

  let items = [];
  try { items = await listEdits(); } catch (error) { body.appendChild(unavailable(error)); return root; }

  body.appendChild(h("p", { class: "t-body-m c-sec", text: "Procedures you have edited for this account. Your edits replace the published procedure for you alone and never change it for anyone else." }));
  body.appendChild(libraryDivider());

  if (!items.length) {
    body.appendChild(blueCard([
      h("div", { class: "t-title-m w-xbold c-white", text: "No drafts yet." }),
      h("p", { class: "t-body-m c-sec mt-8", text: "Open a QRH procedure and use Edit QRH to write your own version. It will be listed here." }),
      h("div", { class: "mt-10" }, h("a", { class: "bubble light", href: "#/qrh", text: "Open QRH" }))
    ]));
    return root;
  }

  items.forEach(function (item) {
    body.appendChild(blueCard([
      h("div", { class: "t-title-m w-semi c-white clamp-2", text: item.title || item.procedureId }),
      h("div", { class: "t-body-s c-ter mt-4", text: "Updated " + docDate(item.updatedAt) }),
      h("div", { class: "row gap-8 wrap mt-8" }, [
        h("a", { class: "bubble light", href: "#/procedures/detail/" + encodeURIComponent(item.procedureId), text: "Open" }),
        h("a", { class: "bubble dark", href: "#/qrh/edit/" + encodeURIComponent(item.procedureId), text: "Edit" })
      ])
    ]));
  });
  return root;
}
