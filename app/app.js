/*
  DHC-6 Trainer — subscriber web app bootstrap.
  Server-side gate: worker.js only serves /app/* with a valid session cookie.
  Client-side: subscriber-gate.js re-validates the session; this module
  builds the Android-style navigation and renders screens from the protected
  content packs (/api/content/*).
*/

import { APP_VERSION, h, Store, Content, route, match, parseHash, navigate, FEATURES, currentVariant } from "./js/core.js";
import * as S from "./js/screens.js";

const view = document.getElementById("view");
const topbarTitle = document.getElementById("topbar-title");
const topbarSubtitle = document.getElementById("topbar-subtitle");
const topbarBack = document.getElementById("topbar-back");
const variantChip = document.getElementById("variant-chip");
const sessionChip = document.getElementById("session-chip");
const railList = document.getElementById("rail-list");
const bottomList = document.getElementById("bottomnav-list");
const railSync = document.getElementById("rail-sync");
const railSyncValue = document.getElementById("rail-sync-value");
const railVersion = document.getElementById("rail-version");
const offlineBanner = document.getElementById("offline-banner");
const contentBanner = document.getElementById("content-banner");

railVersion.textContent = APP_VERSION;

/* --------------------------------------------------------------- routes */
route("/home", S.home);
route("/more", S.more);
route("/qrh", S.qrh);
route("/qrh/group/:group", S.qrhGroup);
route("/procedure/:id", S.procedure);
route("/checklists", S.checklists);
route("/drill", S.drill);
route("/drill/memory/:id", S.memoryDrill);
route("/flashcards", S.flashcards);
route("/flashcards/:deck", S.flashcards);
route("/limitations", S.limitations);
route("/mel", S.mel);
route("/performance", S.performance);
route("/fuel", S.fuel);
route("/wb", S.wb);
route("/cas", S.cas);
route("/strips", S.strips);
route("/logbook", S.logbook);
route("/settings", S.settings);
["documents", "aircraft-state", "knowledge", "technical-lab", "oral-exam", "crm", "readiness"].forEach(function (id) { route("/" + id, S.laterScreen(id)); });

/* ------------------------------------------------------------ navigation */
const PRIMARY = ["home", "qrh", "drill", "checklists"];
const RAIL = ["home", "qrh", "drill", "checklists", "performance", "documents", "flashcards", "settings"];

function navLink(f, cls) {
  return h("li", {}, h("a", { class: cls, href: f.route, dataset: { feature: f.id } }, [
    h("span", { class: "nav-icon", "aria-hidden": "true", text: f.icon }),
    h("span", { text: f.title }),
    cls === "rail-item" && f.status !== "available" ? h("span", { class: "nav-badge", text: f.status === "partial" ? "Partial" : "Soon" }) : null
  ]));
}

function buildNav() {
  railList.replaceChildren.apply(railList, RAIL.map(function (id) { return navLink(FEATURES.find(function (f) { return f.id === id; }), "rail-item"); }));
  const moreEntry = { id: "more", title: "More", icon: "⋯", route: "#/more", status: "available" };
  bottomList.replaceChildren.apply(bottomList, PRIMARY.map(function (id) { return navLink(FEATURES.find(function (f) { return f.id === id; }), "bottomnav-item"); }).concat([navLink(moreEntry, "bottomnav-item")]));
}

function activeFeatureFor(path) {
  if (path.startsWith("/procedure/")) return path.indexOf("/procedure/normal") === 0 ? "checklists" : "qrh";
  if (path.startsWith("/qrh")) return "qrh";
  if (path.startsWith("/drill")) return "drill";
  if (path.startsWith("/flashcards")) return "flashcards";
  const id = path.replace(/^\//, "").split("/")[0];
  return id || "home";
}

function markActive(path) {
  const active = activeFeatureFor(path);
  const primaryIds = PRIMARY.concat(["more"]);
  document.querySelectorAll("[data-feature]").forEach(function (a) {
    const id = a.dataset.feature;
    let current = id === active;
    if (a.classList.contains("bottomnav-item") && id === "more" && primaryIds.indexOf(active) === -1) current = true;
    if (current) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
}

/* ------------------------------------------------------------ preferences */
function applyPrefs() {
  document.body.dataset.theme = Store.get("theme") === "day" ? "day" : "night";
  document.body.dataset.variant = currentVariant();
  variantChip.textContent = currentVariant();
  document.querySelector('meta[name="theme-color"]').setAttribute("content", "#0f2140");
}

variantChip.addEventListener("click", function () {
  Store.set("variant", currentVariant() === "LEGACY" ? "G950" : "LEGACY");
  applyPrefs();
  render();
});

/* -------------------------------------------------------------- session */
function setSessionChip(state, text) {
  sessionChip.dataset.state = state;
  sessionChip.textContent = text;
}

function applySession(data) {
  data = data || {};
  if (data.ok) {
    setSessionChip(data.role === "owner" ? "owner" : "active", data.role === "owner" ? "Owner" : "Subscriber · " + String(data.plan || "").replace(/_/g, " "));
    railSync.dataset.state = "ok"; railSyncValue.textContent = "Up to date";
  } else if (data.offline) {
    setSessionChip("offline", "Offline"); railSync.dataset.state = "offline"; railSyncValue.textContent = "Offline";
  }
}
document.addEventListener("dhc6:session", function (event) { applySession(event.detail); });
if (window.DHC6Session && window.DHC6Session.get()) applySession(window.DHC6Session.get());

function updateOnline() {
  offlineBanner.hidden = navigator.onLine;
  if (!navigator.onLine) { railSync.dataset.state = "offline"; railSyncValue.textContent = "Offline"; }
}
window.addEventListener("online", function () { updateOnline(); Content.loadManifest().then(render).catch(function () {}); });
window.addEventListener("offline", updateOnline);

/* --------------------------------------------------------------- render */
let renderToken = 0;
const ctxBase = {
  version: APP_VERSION,
  applyPrefs: applyPrefs,
  setTopbar: function (opts) {
    topbarTitle.textContent = opts.title || "DHC-6 Trainer";
    topbarSubtitle.textContent = opts.subtitle || "";
    document.title = (opts.title ? opts.title + " · " : "") + "DHC-6 Trainer";
    if (opts.back) { topbarBack.hidden = false; topbarBack.onclick = function () { navigate(opts.back); }; }
    else { topbarBack.hidden = true; topbarBack.onclick = null; }
  }
};

async function render() {
  const token = ++renderToken;
  const parsed = parseHash();
  const found = match(parsed.path);
  markActive(parsed.path);
  Store.set("lastRoute", "#" + parsed.path);
  if (!found) { navigate("/home", true); return; }
  view.setAttribute("aria-busy", "true");
  const ctx = Object.assign({}, ctxBase, { params: found.params, query: parsed.query, path: parsed.path });
  try {
    const node = await found.entry.handler(ctx);
    if (token !== renderToken) return;
    view.replaceChildren(node);
    view.scrollTop = 0; window.scrollTo(0, 0);
  } catch (error) {
    if (token !== renderToken) return;
    if (error && (error.status === 401 || error.status === 403)) {
      if (window.DHC6Session) window.DHC6Session.verify().catch(function () {});
      return;
    }
    view.replaceChildren(h("div", { class: "empty-state" }, [h("p", { text: "Something went wrong rendering this screen." }), h("p", { class: "muted", text: String(error && error.message || error) })]));
  } finally {
    view.removeAttribute("aria-busy");
  }
}

/* ---------------------------------------------------------------- start */
buildNav();
applyPrefs();
updateOnline();

Content.onChange(function (client) {
  if (client.manifest && !client.manifest.published) {
    contentBanner.hidden = false;
    contentBanner.textContent = "Training content packs have not been published to this site yet — screens show placeholders until the owner publishes them.";
  } else {
    contentBanner.hidden = true;
  }
});

Content.loadManifest().catch(function (error) {
  if (error && (error.status === 401 || error.status === 403) && window.DHC6Session) window.DHC6Session.verify().catch(function () {});
}).then(function () {
  if (!window.location.hash) navigate(Store.get("lastRoute") || "/home", true);
  render();
});

window.addEventListener("hashchange", render);
