/*
  DHC-6 Trainer — subscriber web app bootstrap.
  Server-side gate: worker.js only serves /app/* with a valid session cookie.
  Client-side: subscriber-gate.js re-validates the session; this module builds
  the Android navigation (HOME · PROCS · AIRCRAFT · QRH · SETTINGS) and renders
  the ported screens from the protected content packs (/api/content/*).
*/

import { APP_VERSION, h, Store, Content, route, match, parseHash, navigate, currentVariant, variantLabel, owningTab } from "./js/core.js";
import { ICONS } from "./js/ui.js";
import { dashboard } from "./js/screens/dashboard.js";
import { procedureLibrary, procedureDetail, qrhHub, qrhList } from "./js/screens/procedures.js";
import { qrhManualEdit } from "./js/screens/qrhmanualedit.js";
import { studyHome, definitions, srsStudy, deckBrowser, limitations, melReference, aerodromes, casLibrary, knowledgeSearch } from "./js/screens/study.js";
import { quizHome, quizRun, performanceCalc, fuelPlan, weightBalance, competencyDashboard, laterTraining } from "./js/screens/training.js";
import { logbook, logbookDetail, logbookExport } from "./js/screens/logbook.js";
import { crmDrill } from "./js/screens/crmdrill.js";
import { libraryHub, laterScreen, settings } from "./js/screens/misc.js";
import { systemsLabHome, systemsLabDetail } from "./js/screens/systemslab.js";
import { systemsHome, systemDetail } from "./js/screens/systems2d.js";
import { cockpitHome, scenarioProcedures, scenarioSelector, scenarioState, frozenSnapshot } from "./js/screens/aircraftstate.js";
import { freePlayCockpit, scenarioRun, drillRun } from "./js/screens/cockpitscreens.js";
import { start as startLogbookSync } from "./js/logbooksync.js";

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

/* ------------------------------------------------------------ routes (Routes.kt) */
route("/dashboard", dashboard);
route("/systems", procedureLibrary);
route("/procedures/detail/:id", procedureDetail);
route("/live", cockpitHome);
route("/live/cockpit", freePlayCockpit);
route("/live/procedures", scenarioProcedures);
route("/scenario/select/:id", scenarioSelector);
route("/scenario/state/:id/:phase", scenarioState);
route("/scenario/focus/:id/:phase", frozenSnapshot);
route("/scenario/run/:id/:phase", scenarioRun);
route("/drill/run/:id", drillRun);
route("/qrh", qrhHub);
route("/qrh/category/:category", qrhList);
route("/qrh/detail/:id", procedureDetail);
route("/qrh/edit/:id", qrhManualEdit);
route("/settings", settings);
route("/knowledge/home", studyHome);
route("/knowledge/definitions", definitions);
route("/knowledge/search", knowledgeSearch);
route("/library/home", libraryHub);
route("/library/sources", laterScreen("library", "Source documents (manuals, imported PDFs) will be served from a dedicated R2 bucket for web content, dhc6-web-content, behind the same session gate as the training packs and media. The bucket and its binding are not configured yet."));
route("/library/import", laterScreen("import", "Import runs the on-device extraction pipeline and writes to the app's Room database; it is an authoring tool for the owner/instructor accounts and is not planned for the browser edition."));
route("/library/published", laterScreen("library", "Published library content will be served from R2 behind the subscriber session once the document decision is made."));
route("/systems/home", systemsHome);
route("/systems/detail/:key", systemDetail);
route("/systems/lab", systemsLabHome);
route("/systems/lab/:system", systemsLabDetail);
route("/quizzes", quizHome);
route("/quizzes/run/:variant/:length", quizRun);
route("/study/srs", srsStudy);
route("/study/flashcards", deckBrowser);
route("/study/flashcards/:deck", deckBrowser);
route("/study/limitations", limitations);
route("/study/mel-reference", melReference);
route("/study/maldives-strips", aerodromes);
route("/study/cas", casLibrary);
route("/training/performance", performanceCalc);
route("/training/fuel-plan", fuelPlan);
route("/training/weight-balance", weightBalance);
route("/training/logbook", logbook);
route("/training/logbook/entry/:key", logbookDetail);
route("/training/logbook/export", logbookExport);
route("/training/competency-dashboard", competencyDashboard);
route("/training/oral-exam", laterTraining("oral-exam"));
route("/training/crm-drill", crmDrill);

/* Phase-1 routes → Android routes (keeps bookmarks working) */
const LEGACY_ROUTES = {
  "/home": "/dashboard", "/more": "/dashboard", "/checklists": "/qrh/category/NORMAL", "/drill": "/quizzes",
  "/flashcards": "/study/srs", "/limitations": "/study/limitations", "/mel": "/study/mel-reference", "/performance": "/training/performance",
  "/fuel": "/training/fuel-plan", "/wb": "/training/weight-balance", "/cas": "/study/cas", "/strips": "/study/maldives-strips",
  "/logbook": "/training/logbook", "/documents": "/library/home", "/aircraft-state": "/live", "/knowledge": "/knowledge/home",
  "/technical-lab": "/systems/lab", "/oral-exam": "/training/oral-exam", "/crm": "/training/crm-drill", "/readiness": "/training/competency-dashboard"
};

/* ------------------------------------------------------------ navigation */
const TABS = [
  { id: "dashboard", label: "HOME", icon: ICONS.home, href: "#/dashboard" },
  { id: "systems", label: "PROCS", icon: ICONS.menuBook, href: "#/systems" },
  { id: "live", label: "AIRCRAFT", icon: ICONS.airplane, href: "#/live" },
  { id: "qrh", label: "QRH", icon: ICONS.warning, href: "#/qrh" },
  { id: "settings", label: "SETTINGS", icon: ICONS.settings, href: "#/settings" }
];

function navLink(tab, cls) {
  return h("li", {}, h("a", { class: cls, href: tab.href, dataset: { tab: tab.id }, "aria-label": tab.label }, [
    h("span", { class: "nav-icon", "aria-hidden": "true", html: tab.icon }),
    h("span", { text: tab.label })
  ]));
}

function buildNav() {
  railList.replaceChildren.apply(railList, TABS.map(function (t) { return navLink(t, "rail-item"); }));
  bottomList.replaceChildren.apply(bottomList, TABS.map(function (t) { return navLink(t, "bottomnav-item"); }));
}

function markActive(path, query) {
  const active = owningTab(path, query);
  document.querySelectorAll("[data-tab]").forEach(function (a) {
    if (a.dataset.tab === active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
}

/* ------------------------------------------------------------ preferences */
function applyPrefs() {
  document.body.dataset.theme = Store.get("theme") === "day" ? "day" : "night";
  document.body.dataset.variant = currentVariant();
  variantChip.textContent = "Variant: " + variantLabel(currentVariant());
  document.querySelector('meta[name="theme-color"]').setAttribute("content", Store.get("theme") === "day" ? "#0E3A56" : "#060E18");
}

variantChip.addEventListener("click", function () {
  const v = currentVariant();
  Store.set("variant", v === "LEGACY" ? "G950" : v === "G950" ? "BOTH" : "LEGACY");
  applyPrefs();
  toast("Variant set to " + variantLabel(currentVariant()));
  render();
});

/* ---------------------------------------------------------------- toast */
let toastTimer = null;
function toast(message) {
  let el = document.getElementById("app-toast");
  if (!el) {
    el = h("div", { id: "app-toast", role: "status", style: "position:fixed;left:50%;bottom:calc(var(--bottomnav-h) + 16px);transform:translateX(-50%);background:var(--inverse-surface);color:#fff;padding:10px 16px;border-radius:999px;font-size:13px;z-index:70;box-shadow:0 6px 18px rgba(0,0,0,.4);max-width:90vw" });
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.hidden = true; }, 2200);
}

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
  toast: toast,
  navigate: navigate,
  rerender: function () { render(); },
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
  if (LEGACY_ROUTES[parsed.path]) { navigate(LEGACY_ROUTES[parsed.path], true); return; }
  if (parsed.path.startsWith("/procedure/")) { navigate("/systems", true); return; }
  const found = match(parsed.path);
  markActive(parsed.path, parsed.query);
  Store.set("lastRoute", "#" + parsed.path);
  if (!found) { navigate("/dashboard", true); return; }
  view.setAttribute("aria-busy", "true");
  const ctx = Object.assign({}, ctxBase, { params: found.params, query: parsed.query, path: parsed.path });
  // Screens holding live resources (WebGL viewers, timers) release them before
  // the next screen is built.
  document.dispatchEvent(new CustomEvent("dhc6:view-unmount"));
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
    view.replaceChildren(h("div", { class: "empty-state" }, [h("p", { text: "Something went wrong rendering this screen." }), h("p", { class: "c-ter", text: String(error && error.message || error) })]));
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
  if (!window.location.hash) navigate(Store.get("lastRoute") || "/dashboard", true);
  render();
  Content.loadMediaIndex().catch(function () {});
  /* After the first screen is up: the logbook renders from the local copy, and
     the pull only ever adds to it. */
  startLogbookSync();
});

window.addEventListener("hashchange", render);
