/*
  Library — the web equivalent of
    feature-knowledge/ui/screens/LibraryHubScreen.kt
    feature-knowledge/ui/screens/SourcesScreen.kt
    feature-knowledge/ui/screens/PublishedContentScreen.kt

  Android's Library is not authored content: there are no documents in
  core-res/src/main/assets. SourcesScreen lists what the user imported on the
  device (Room, via PdfImportScreen) and PublishedContentScreen lists what was
  promoted to runtime-ready content. The browser edition keeps that shape but
  swaps the on-device extraction pipeline for a straight upload: the file goes to
  the account's own shelf in R2 and opens in the browser's own PDF/image viewer.

  What is deliberately NOT ported: the PDF text-extraction and candidate
  extraction (QrhCandidateExtractor, ProcedureDocumentCandidateExtractor,
  PdfImportViewModel — around 140 KB of Kotlin) that turns an imported manual
  into draft procedures and knowledge cards. That writes to Room and is an
  authoring pipeline; the browser stores and shows the document instead.
*/
import { h, Store } from "../core.js";
import { screen, blueCard, libraryDivider, backBubble, bubble, notice, statusPill, emptyState, outlinedButton, primaryButton } from "../ui.js";

const ENDPOINT = "/api/library";

/* One fetch per screen visit; the shelves are small and always re-read after a
   change, so there is nothing to invalidate. */
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
     connection and upload progress is the difference between "working" and
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

/* A header value must be Latin-1. File names are not — "Håndbok.pdf" would
   throw on setRequestHeader — so non-ASCII is escaped and the server keeps the
   readable form after decodeURIComponent on its side is not needed: the name is
   only ever shown, so the escaped text is decoded here before display. */
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

/* The state the screen shows when the bucket is not bound on this deployment. */
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

/* ------------------------------------------------------------------- hub */
export async function libraryHub(ctx) {
  ctx.setTopbar({ title: "Library", subtitle: "Sources · Published", back: "#/dashboard" });
  const root = screen({ title: "Library", library: true, header: [backBubble("#/dashboard")] }, []);
  const body = h("div", { class: "stack-10" });
  root.appendChild(body);

  let data;
  try { data = await loadLibrary(); } catch (error) {
    body.appendChild(unavailable(error));
    return root;
  }

  body.appendChild(h("p", { class: "t-body-m c-white", text: "Your own reference documents, and the shelf published for everyone on this account's plan. Documents open in the browser and are never public — every request is checked against your session." }));
  body.appendChild(libraryDivider());

  if (!data.configured) {
    body.appendChild(notConfigured());
    return root;
  }

  function card(title, subtitle, count, href, extra) {
    return blueCard([
      h("div", { class: "row between gap-12" }, [
        h("div", { class: "t-title-m c-white", text: title }),
        h("span", { class: "pill info", text: count + (count === 1 ? " document" : " documents") })
      ]),
      h("div", { class: "t-body-s c-sec mt-8", text: subtitle }),
      extra || null,
      h("div", { class: "mt-10" }, h("a", { class: "btn outlined small", href: href, text: "Open" }))
    ]);
  }

  body.appendChild(card(
    "Sources",
    "Manuals, checklists and notes you have uploaded to your own account. Only you can see them.",
    data.privateShelf.items.length,
    "#/library/sources",
    h("div", { class: "t-body-s c-ter mt-6", text: formatBytes(data.privateShelf.usedBytes) + " of " + formatBytes(data.limits.totalBytes) + " used" })
  ));
  body.appendChild(card(
    "Published",
    data.canPublish
      ? "The shared shelf. Documents here are readable by every signed-in subscriber, and you can publish to it."
      : "Documents published for everyone on this plan by your training organisation.",
    data.publishedShelf.items.length,
    "#/library/published"
  ));
  body.appendChild(card(
    "Import",
    "On-device manual extraction — turning an imported PDF into draft procedures and knowledge cards — stays in the Android app. Uploading a document to read it is on the Sources screen.",
    0,
    "#/library/import"
  ));
  return root;
}

/* --------------------------------------------------------------- a shelf */
function shelfScreen(shelf) {
  return async function (ctx) {
    const isPublished = shelf === "published";
    ctx.setTopbar({
      title: isPublished ? "Published" : "Sources",
      subtitle: isPublished ? "Library · shared shelf" : "Library · your documents",
      back: "#/library/home"
    });
    const root = screen({ title: isPublished ? "Published" : "Sources", library: true, header: [backBubble("#/library/home")] }, []);
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

    function render() {
      const shelfData = isPublished ? data.publishedShelf : data.privateShelf;
      const mayWrite = isPublished ? data.canPublish : true;
      const items = shelfData.items;

      const nodes = [
        h("p", { class: "t-body-m c-sec", text: isPublished
          ? "Documents on the shared shelf. Every signed-in subscriber on this account's plan can read them."
          : "Your own documents. They are stored against your account, not this browser, and nobody else can list or open them." })
      ];

      if (mayWrite) nodes.push(uploadCard());
      else if (isPublished) nodes.push(h("p", { class: "t-body-s c-ter", text: "Publishing to the shared shelf needs Instructor, Enterprise or Owner access." }));

      nodes.push(status);
      nodes.push(libraryDivider());

      if (!items.length) {
        nodes.push(blueCard([
          h("div", { class: "t-title-l w-xbold c-white", text: "Nothing here yet" }),
          h("p", { class: "t-body-m c-sec mt-6", text: isPublished
            ? "No documents have been published for this plan yet."
            : "Upload a manual, checklist or set of notes and it will appear here, on every browser you sign in from." })
        ]));
      } else {
        nodes.push(h("div", { class: "stack-8" }, items.map(function (doc) { return docRow(doc, mayWrite); })));
      }
      nodes.push(h("p", { class: "t-body-s c-ter", text: "Training support only. A document you upload here is your own reference copy and is not an approved AFM, QRH, MEL, company manual or checklist." }));
      body.replaceChildren.apply(body, nodes.filter(Boolean));
    }

    function docRow(doc, mayWrite) {
      return h("div", { class: "log-entry" }, [
        h("div", { class: "row between gap-12" }, [
          h("div", { class: "t-title-s w-semi grow clamp-2", text: decodeHeaderText(doc.title) }),
          h("span", { class: "pill info", text: doc.docType })
        ]),
        h("div", { class: "t-body-s c-sec", text: decodeHeaderText(doc.fileName) + " · " + formatBytes(doc.bytes) + " · " + docDate(doc.uploadedAt) + (doc.publishedBy ? " · " + doc.publishedBy : "") }),
        doc.note ? h("div", { class: "t-body-s c-ter mt-4", text: decodeHeaderText(doc.note) }) : null,
        h("div", { class: "row gap-8 wrap mt-8" }, [
          h("a", { class: "btn outlined small", href: docHref(shelf, doc.docId), target: "_blank", rel: "noopener", text: "Open" }),
          mayWrite ? h("button", {
            class: "btn text", type: "button", text: "Remove",
            onclick: function () {
              if (!window.confirm("Remove “" + decodeHeaderText(doc.title) + "” from this shelf?")) return;
              status.textContent = "Removing…";
              deleteDoc(shelf, doc.docId)
                .then(refresh)
                .then(function (ok) { if (ok) { status.textContent = "Removed."; render(); } })
                .catch(function (error) { status.textContent = "Could not remove that document (" + (error.message || "error") + ")."; });
            }
          }) : null
        ])
      ]);
    }

    function uploadCard() {
      const fileInput = h("input", { type: "file", accept: ".pdf,.png,.jpg,.jpeg,.webp,.svg,.txt,.md,.csv", "aria-label": "Document file" });
      const titleInput = h("input", { type: "text", placeholder: "Title (optional)", "aria-label": "Document title" });
      const noteInput = h("input", { type: "text", placeholder: "Note (optional)", "aria-label": "Document note" });
      const typeSelect = h("select", { "aria-label": "Document type" }, (data.docTypes || []).map(function (t) {
        return h("option", { value: t, text: t, selected: t === "MANUAL" ? true : null });
      }));
      const bar = h("div", { class: "progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0", hidden: true }, h("span", { style: "width:0%" }));

      const button = primaryButton("Upload document", function () {
        const file = fileInput.files && fileInput.files[0];
        if (!file) { status.textContent = "Choose a file first."; return; }
        if (file.size > data.limits.bytes) { status.textContent = "That file is larger than the " + formatBytes(data.limits.bytes) + " limit."; return; }
        button.disabled = true;
        bar.hidden = false;
        status.textContent = "Uploading " + file.name + "…";
        uploadDoc(file, { shelf: shelf, title: titleInput.value, docType: typeSelect.value, note: noteInput.value }, function (fraction) {
          const pct = Math.round(fraction * 100);
          bar.firstChild.style.width = pct + "%";
          bar.setAttribute("aria-valuenow", String(pct));
        })
          .then(refresh)
          .then(function (ok) {
            button.disabled = false;
            bar.hidden = true;
            if (!ok) return;
            status.textContent = "Uploaded.";
            render();
          })
          .catch(function (error) {
            button.disabled = false;
            bar.hidden = true;
            status.textContent = uploadErrorText(error, data.limits);
          });
      }, { block: true });

      return blueCard([
        h("div", { class: "t-title-m w-semi c-white", text: isPublished ? "Publish a document" : "Add a document" }),
        h("div", { class: "t-body-s c-ter mt-4", text: "PDF, image, text, markdown or CSV, up to " + formatBytes(data.limits.bytes) + "." }),
        h("div", { class: "stack-8 mt-10" }, [fileInput, titleInput, typeSelect, noteInput, bar, button])
      ]);
    }

    render();
    return root;
  };
}

export function uploadErrorText(error, limits) {
  const code = (error && error.message) || "";
  if (code === "file_too_large") return "That file is larger than the " + formatBytes(limits && limits.bytes) + " limit.";
  if (code === "unsupported_file_type") return "That file type cannot be stored. Use a PDF, image, text, markdown or CSV file.";
  if (code === "quota_exceeded") return "Your Library is full. Remove a document to free space.";
  if (code === "library_full") return "This shelf has reached its document limit.";
  if (code === "publish_forbidden") return "Publishing to the shared shelf needs Instructor, Enterprise or Owner access.";
  if (code === "library_not_configured") return "Library storage is not configured on this deployment yet.";
  if (code === "empty_file") return "That file is empty.";
  if (code === "network_error") return "The upload did not reach the server. Check your connection and try again.";
  return "The upload failed (" + (code || "unknown error") + ").";
}

export const librarySources = shelfScreen("private");
export const libraryPublished = shelfScreen("published");
