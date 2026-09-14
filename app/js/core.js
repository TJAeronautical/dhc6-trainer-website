/*
  Core runtime for the DHC-6 Trainer web app shell:
  DOM helpers, persistent local state, protected-content client, router.
*/

export const APP_VERSION = "web-0.6.0";
const STATE_KEY = "dhc6.app.v1";
const DB_NAME = "dhc6-protected-content";
const DB_STORE = "packs";

/* ------------------------------------------------------------------ DOM */
export function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
    return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch];
  });
}

export function h(tag, attrs, children) {
  const el = document.createElement(tag);
  if (attrs) {
    Object.keys(attrs).forEach(function (key) {
      const value = attrs[key];
      if (value == null || value === false) return;
      if (key === "class") el.className = value;
      else if (key === "html") el.innerHTML = value;
      else if (key === "text") el.textContent = value;
      else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
      else if (key === "dataset") Object.keys(value).forEach(function (d) { el.dataset[d] = value[d]; });
      else el.setAttribute(key, value === true ? "" : value);
    });
  }
  (Array.isArray(children) ? children : [children]).forEach(function (child) {
    if (child == null || child === false) return;
    el.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  });
  return el;
}

export function frag(nodes) {
  const f = document.createDocumentFragment();
  nodes.forEach(function (n) { if (n) f.appendChild(typeof n === "string" ? document.createTextNode(n) : n); });
  return f;
}

export function titleCase(value) {
  return String(value || "").toLowerCase().replace(/(^|\s|[-/(])([a-z])/g, function (m, p, c) { return p + c.toUpperCase(); });
}

export function relativeTime(ts) {
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return "Just now";
  if (min < 60) return min + " min ago";
  const date = new Date(ts);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return "Today, " + time;
  return date.toLocaleDateString([], { day: "2-digit", month: "short" }) + ", " + time;
}

/* ---------------------------------------------------------------- state */
const defaults = {
  variant: "BOTH",          // AppSettings.selectedAircraftVariant (LEGACY / G950 / BOTH)
  theme: "night",           // AppSettings.nightMode
  soundEnabled: true,
  favorites: [],
  pinnedProcedures: [],     // ProcedureLibraryViewModel priority ids (compiled ids)
  recent: [],
  attempts: [],
  logbook: [],              // LogbookEntry list (LogbookStore)
  srsRecords: {},           // FlashcardMemoryRecord by knowledge-unit id (SrsRepository)
  checklistProgress: {},
  flashcardStats: {},
  cockpitResume: null,
  lastRoute: "#/dashboard"
};

let state = null;
function loadState() {
  if (state) return state;
  state = Object.assign({}, defaults);
  try {
    const raw = window.localStorage.getItem(STATE_KEY);
    if (raw) state = Object.assign(state, JSON.parse(raw));
  } catch (error) { /* ignore */ }
  return state;
}
function saveState() {
  try { window.localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (error) { /* ignore */ }
}

export const Store = {
  get: function (key) { return loadState()[key]; },
  set: function (key, value) { loadState()[key] = value; saveState(); return value; },
  update: function (key, fn) { const next = fn(loadState()[key]); return Store.set(key, next); },
  recordRecent: function (entry) {
    Store.update("recent", function (list) {
      const next = (list || []).filter(function (item) { return item.id !== entry.id; });
      next.unshift(Object.assign({ ts: Date.now() }, entry));
      return next.slice(0, 20);
    });
  },
  recordAttempt: function (attempt) {
    Store.update("attempts", function (list) {
      const next = (list || []).slice();
      next.unshift(Object.assign({ ts: Date.now() }, attempt));
      return next.slice(0, 100);
    });
  },
  toggleFavorite: function (id) {
    let on = false;
    Store.update("favorites", function (list) {
      const next = (list || []).slice();
      const idx = next.indexOf(id);
      if (idx > -1) next.splice(idx, 1); else { next.push(id); on = true; }
      return next;
    });
    return on;
  },
  isFavorite: function (id) { return (Store.get("favorites") || []).indexOf(id) > -1; },
  togglePinned: function (compiledId) {
    let on = false;
    Store.update("pinnedProcedures", function (list) {
      const next = (list || []).slice();
      const idx = next.indexOf(compiledId);
      if (idx > -1) next.splice(idx, 1); else { next.push(compiledId); on = true; }
      return next;
    });
    return on;
  },
  pinned: function () { return Store.get("pinnedProcedures") || []; },
  addLogbookEntry: function (entry) {
    Store.update("logbook", function (list) {
      const next = (list || []).filter(function (e) { return !entry.attemptId || e.attemptId !== entry.attemptId; });
      next.unshift(entry);
      return next.slice(0, 300);
    });
    /* An event rather than a direct call: core.js is imported by everything,
       and importing the sync client here would close a cycle. */
    try { document.dispatchEvent(new CustomEvent("dhc6:logbook-changed")); } catch (error) { /* no DOM in tests */ }
  },
  logbook: function () { return Store.get("logbook") || []; },
  srsRecords: function () { return Store.get("srsRecords") || {}; },
  saveSrsRecord: function (record) {
    Store.update("srsRecords", function (map) { const next = Object.assign({}, map || {}); next[record.flashcardId] = record; return next; });
  },
  clearProgress: function () {
    Store.set("recent", []); Store.set("attempts", []); Store.set("logbook", []); Store.set("srsRecords", {});
    Store.set("checklistProgress", {}); Store.set("flashcardStats", {}); Store.set("pinnedProcedures", []); Store.set("cockpitResume", null);
    /* The account's synced copy goes too. Without this the next pull would put
       every entry the user just asked to delete straight back. */
    try { document.dispatchEvent(new CustomEvent("dhc6:logbook-cleared")); } catch (error) { /* no DOM in tests */ }
  }
};

/* -------------------------------------------------------- content client */
function openDb() {
  return new Promise(function (resolve, reject) {
    if (!("indexedDB" in window)) return resolve(null);
    const request = window.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = function () {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: "id" });
    };
    request.onsuccess = function () { resolve(request.result); };
    request.onerror = function () { resolve(null); };
    request.onblocked = function () { resolve(null); };
  });
}

async function dbGet(id) {
  const db = await openDb();
  if (!db) return null;
  return new Promise(function (resolve) {
    try {
      const tx = db.transaction(DB_STORE, "readonly");
      const req = tx.objectStore(DB_STORE).get(id);
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror = function () { resolve(null); };
    } catch (error) { resolve(null); }
  });
}

async function dbPut(record) {
  const db = await openDb();
  if (!db) return;
  return new Promise(function (resolve) {
    try {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(record);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { resolve(); };
    } catch (error) { resolve(); }
  });
}

export async function clearContentCache() {
  const db = await openDb();
  if (!db) return;
  return new Promise(function (resolve) {
    try {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).clear();
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { resolve(); };
    } catch (error) { resolve(); }
  });
}

class ContentClient {
  constructor() {
    this.manifest = null;
    this.packs = new Map();
    this.pending = new Map();
    this.offline = false;
    this.listeners = [];
    this.mediaIndex = null;
  }
  onChange(fn) { this.listeners.push(fn); }
  emit() { const self = this; this.listeners.forEach(function (fn) { fn(self); }); }

  async loadManifest() {
    try {
      const response = await fetch("/api/content/manifest", { credentials: "same-origin", cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        const error = new Error("session_invalid"); error.status = response.status; throw error;
      }
      if (!response.ok) throw new Error("manifest_unavailable");
      const manifest = await response.json();
      this.manifest = manifest;
      this.offline = false;
      await dbPut({ id: "manifest", version: manifest.version || "none", data: manifest, storedAt: Date.now() });
    } catch (error) {
      if (error && (error.status === 401 || error.status === 403)) throw error;
      const cached = await dbGet("manifest");
      if (cached && cached.data) { this.manifest = cached.data; this.offline = true; }
      else { this.manifest = { ok: true, published: false, packs: [] }; this.offline = !navigator.onLine; }
    }
    this.emit();
    return this.manifest;
  }

  /* /api/media/index — which protected media objects (3D models, posters) are published. */
  async loadMediaIndex() {
    try {
      const response = await fetch("/api/media/index", { credentials: "same-origin", cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        const error = new Error("session_invalid"); error.status = response.status; throw error;
      }
      if (!response.ok) throw new Error("media_index_unavailable");
      const index = await response.json();
      this.mediaIndex = index;
      await dbPut({ id: "media-index", version: index.version || "none", data: index, storedAt: Date.now() });
    } catch (error) {
      if (error && (error.status === 401 || error.status === 403)) throw error;
      const cached = await dbGet("media-index");
      this.mediaIndex = cached && cached.data ? cached.data : null;
    }
    this.emit();
    return this.mediaIndex;
  }

  hasMedia(mediaPath) {
    if (!this.mediaIndex || !this.mediaIndex.published) return null;
    return (this.mediaIndex.items || []).some(function (i) { return i.path === mediaPath; });
  }

  hasPack(id) {
    return Boolean(this.manifest && this.manifest.published && (this.manifest.packs || []).some(function (p) { return p.id === id; }));
  }

  packMeta(id) {
    return (this.manifest && (this.manifest.packs || []).find(function (p) { return p.id === id; })) || null;
  }

  async pack(id) {
    if (this.packs.has(id)) return this.packs.get(id);
    if (this.pending.has(id)) return this.pending.get(id);
    const self = this;
    const promise = (async function () {
      const meta = self.packMeta(id);
      const cached = await dbGet(id);
      if (cached && meta && cached.version === meta.sha256) { self.packs.set(id, cached.data); return cached.data; }
      if (cached && self.offline) { self.packs.set(id, cached.data); return cached.data; }
      try {
        const response = await fetch("/api/content/pack/" + encodeURIComponent(id), { credentials: "same-origin", cache: "no-store" });
        if (response.status === 401 || response.status === 403) {
          const error = new Error("session_invalid"); error.status = response.status; throw error;
        }
        if (response.status === 404) { const error = new Error("pack_not_published"); error.status = 404; throw error; }
        if (!response.ok) throw new Error("pack_unavailable");
        const data = await response.json();
        self.packs.set(id, data);
        await dbPut({ id: id, version: meta ? meta.sha256 : "unknown", data: data, storedAt: Date.now() });
        return data;
      } catch (error) {
        if (cached && !(error && (error.status === 401 || error.status === 403))) { self.packs.set(id, cached.data); return cached.data; }
        throw error;
      } finally {
        self.pending.delete(id);
      }
    })();
    this.pending.set(id, promise);
    return promise;
  }
}

export const Content = new ContentClient();

/* ---------------------------------------------------------------- router */
export const routes = [];
export function route(pattern, handler) {
  const keys = [];
  const regex = new RegExp("^" + pattern.replace(/\//g, "\\/").replace(/:([a-zA-Z]+)/g, function (m, key) { keys.push(key); return "([^/]+)"; }) + "$");
  routes.push({ pattern: pattern, regex: regex, keys: keys, handler: handler });
}

export function parseHash() {
  const raw = window.location.hash || "#/home";
  const path = raw.replace(/^#/, "").split("?")[0] || "/home";
  const query = new URLSearchParams(raw.split("?")[1] || "");
  return { path: path, query: query };
}

export function navigate(path, replace) {
  const target = path.startsWith("#") ? path : "#" + path;
  if (replace) window.location.replace(target); else window.location.hash = target.slice(1);
}

export function match(path) {
  for (const entry of routes) {
    const m = path.match(entry.regex);
    if (m) {
      const params = {};
      entry.keys.forEach(function (key, i) { params[key] = decodeURIComponent(m[i + 1]); });
      return { entry: entry, params: params };
    }
  }
  return null;
}


/* ------------------------------------------------------------- variant */
export const VARIANTS = ["LEGACY", "G950", "BOTH"];
export function currentVariant() {
  const v = Store.get("variant");
  return VARIANTS.includes(v) ? v : "BOTH";
}
/* DashboardScreen: AircraftVariant.dashboardLabel / nextDashboardVariant (LEGACY → G950 → BOTH → LEGACY) */
export function variantLabel(v) { return v === "LEGACY" ? "Legacy" : v === "G950" ? "G950" : "Both"; }
export function nextVariant(v) { return v === "LEGACY" ? "G950" : v === "G950" ? "BOTH" : "LEGACY"; }
/* SettingsScreen.variantSubtitle */
export function variantSubtitle(v) { return v === "LEGACY" ? "Analog / classic cockpit" : v === "G950" ? "Garmin glass cockpit" : "Shared procedures and content"; }

/* ----------------------------------------------------------- features */
/* Android feature inventory with the browser port status. Status legend:
   available = fully usable from Android data/logic · partial = usable, port in progress ·
   later = present in Android, not yet in the browser · blocked = needs a decision/source. */
export const STATUS_LABEL = { available: "Available", partial: "Partial", later: "Coming later", blocked: "Blocked" };
export const FEATURES = [
  { id: "dashboard", title: "Home", route: "#/dashboard", status: "available", desc: "Dashboard, Quick Launch, Training Signals and colour guide (DashboardScreen)." },
  { id: "procedures", title: "Procedures", route: "#/systems", status: "available", desc: "Procedure Library with search, category and normal-subsection filters, pins and drill launch (ProcedureLibraryScreen)." },
  { id: "procedure-detail", title: "Procedure detail + drill", route: "#/systems", status: "available", desc: "QRH detail (memory items / complete checklist) with the interactive MEMORY → FLOW → SUMMARY drill (QrhDetailScreen + ProcedureDrillPane)." },
  { id: "qrh", title: "QRH Checklist", route: "#/qrh", status: "available", desc: "QRH hub, category lists and checklist detail ordered exactly as the Android ProcedureSortOrder." },
  { id: "aircraft-state", title: "Aircraft State", route: "#/live", status: "available", desc: "Aircraft State home, Day-to-Day Operations, scenario state preview, focus snapshot, free-play cockpit and the scenario/MCC drill runner (CockpitHomeScreen / ScenarioProceduresScreen / ScenarioStateScreen / FrozenSnapshotScreen / CockpitScreen / ScenarioDrillRunScreen). The canonical plate, sprites, gauges and CAS render from the protected media store." },
  { id: "study", title: "Study / Knowledge", route: "#/knowledge/home", status: "available", desc: "Study home with the Search, Library and Knowledge tiles of the Android StudyHomeScreen, all present and reachable. Each tile carries its own status, so a tile that is not yet Available is badged there rather than on this hub." },
  { id: "search", title: "Search", route: "#/knowledge/search", status: "available", desc: "Searches the bundled knowledge units, every procedure step, the Definitions list and the documents on this account's Library source index (KnowledgeSearchScreen)." },
  { id: "flashcards", title: "Flashcard Study (SRS)", route: "#/study/srs", status: "available", desc: "SM-2 spaced repetition over the bundled knowledge pool (SrsStudyScreen)." },
  { id: "study-cards", title: "Study Card Review", route: "#/study/flashcards", status: "partial", desc: "Read-only browse of the bundled flashcard decks. Review/approve/edit lanes are authoring tools (Android FlashcardsScreen) and stay app-only." },
  { id: "quizzes", title: "Quizzes", route: "#/quizzes", status: "available", desc: "Multiple-choice quiz with the Android distractor generator (QuizHome/QuizRun)." },
  { id: "definitions", title: "Definitions", route: "#/knowledge/definitions", status: "available", desc: "Acronyms and plain-language meanings (GlossaryScreen)." },
  { id: "limitations", title: "Limitations", route: "#/study/limitations", status: "available", desc: "DHC-6 Series 300 limitations (LimitationsScreen)." },
  { id: "mel", title: "MEL / CDL", route: "#/study/mel-reference", status: "available", desc: "MEL/CDL training reference (MelReferenceScreen)." },
  { id: "aerodromes", title: "Aerodromes & Waterways", route: "#/study/maldives-strips", status: "available", desc: "Aerodrome / water aerodrome training reference (MaldivesStripsScreen)." },
  { id: "cas", title: "CAS Library", route: "#/study/cas", status: "available", desc: "Legacy and G950 annunciator / CAS message library." },
  { id: "performance", title: "Performance", route: "#/training/performance", status: "available", desc: "Seaplane take-off / landing distance interpolation, VREF and reference speeds (PerformanceCalculator)." },
  { id: "fuel", title: "Fuel Planning", route: "#/training/fuel-plan", status: "available", desc: "45-min reserve, trip, alternate, contingency and tank split (FuelPlanCalculator)." },
  { id: "wb", title: "Weight and Balance", route: "#/training/weight-balance", status: "available", desc: "Load sheet, seat map, CG arm / %MAC and envelope chart (WeightBalanceCalculator)." },
  { id: "logbook", title: "Debrief Logbook", route: "#/training/logbook", status: "available", desc: "Search, filters, five sort modes, the Scenario Debrief detail screen and a printable export (LogbookScreen / LogbookDetailScreen / LogbookPdfExporter). Entries sync to the signed-in account through /api/logbook, so they follow the account between browsers and devices and survive cleared site data." },
  { id: "readiness", title: "Check Ride Readiness", route: "#/training/competency-dashboard", status: "available", desc: "Drill currency, score trend and overdue procedures, weighted Emergency 40% / Abnormal 35% / Normal 25% (CompetencyDashboardScreen + CompetencyAnalyzer). Computed from this browser's logbook, as Android computes it from the device logbook." },
  { id: "oral-exam", title: "Oral Exam - Premium", route: "#/training/oral-exam", status: "later", desc: "AI examiner (needs a web-session-gated proxy for /api/ai/oral-exam)." },
  { id: "crm", title: "CRM Drill", route: "#/training/crm-drill", status: "available", desc: "PF/PM callout pacing over four source procedures, eight drills, with the other seat spoken aloud (CrmDrillScreen). The scenario MCC flow drill under AIRCRAFT runs the same crew-flow steps against the cockpit." },
  { id: "systems", title: "Systems", route: "#/systems/home", status: "available", desc: "Aircraft Systems: 35 system tiles, the bundled AFM/FCTM reference packs, 27 reference diagrams from the protected media store and the interactive 2D component pins (AircraftSystemsHomeScreen / SystemDetailScreen / Interactive2dDiagramViewer). Imported user knowledge cards stay app-only." },
  { id: "technical-lab", title: "Technical Lab", route: "#/systems/lab", status: "available", desc: "Systems Lab: aircraft explorer, 21 reference-library / Android 3D models (PT6A-27, governor, fuel, hydraulics, flap, gear, …) with pins, live readout, faults and notes (SystemsLabHomeScreen / SystemsLabSection). Models stream from the protected media store." },
  { id: "library", title: "Library", route: "#/library/home", status: "available", desc: "Sources (your own uploaded manuals, checklists and notes) and Published (the shared shelf) served from R2 behind the session gate, with upload, in-browser viewing and removal (LibraryHubScreen / SourcesScreen / PublishedContentScreen). Import — Android's on-device PDF extraction into draft procedures — stays in the app." },
  { id: "import", title: "Import", route: "#/library/import", status: "later", desc: "Android's on-device PDF extraction into draft procedures and knowledge cards." },
  { id: "settings", title: "Settings", route: "#/settings", status: "available", desc: "Account, plan, display, audio, cockpit variant (SettingsScreen)." }
];
export function feature(id) { return FEATURES.find(function (f) { return f.id === id; }); }

/* Tile artwork shipped from core-res/drawable-nodpi (converted to webp). */
export function tileUrl(name) { return "/app/assets/tiles/" + name + ".webp"; }

/* PrimaryNavigation.owningPrimaryTab */
export function owningTab(path, query) {
  /* A drill can be launched from the Procedures library or from Aircraft State;
     keep the tab the user came from highlighted (Android pops back to that graph). */
  if (path.startsWith("/drill/") && query && query.get("from") === "procs") return "systems";
  if (path === "/dashboard" || path === "/home") return "dashboard";
  if (path === "/systems" || path.startsWith("/procedures/") || path.startsWith("/systems/") || path === "/library/home" || path.startsWith("/library/") || path === "/quizzes" || path.startsWith("/quizzes/")) return "systems";
  if (path === "/training/logbook" || path.startsWith("/training/")) return "dashboard";
  if (path === "/live" || path.startsWith("/live/") || path.startsWith("/scenario/") || path.startsWith("/drill/") || path === "/cockpit" || path.startsWith("/cockpit/")) return "live";
  if (path === "/qrh" || path.startsWith("/qrh/")) return "qrh";
  if (path === "/settings" || path.startsWith("/settings")) return "settings";
  return "dashboard";
}
