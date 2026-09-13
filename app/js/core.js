/*
  Core runtime for the DHC-6 Trainer web app shell:
  DOM helpers, persistent local state, protected-content client, router.
*/

export const APP_VERSION = "web-0.3.0";
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
  variant: "LEGACY",
  theme: "night",
  favorites: [],
  recent: [],
  attempts: [],
  checklistProgress: {},
  flashcardStats: {},
  lastRoute: "#/home"
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
  clearProgress: function () {
    Store.set("recent", []); Store.set("attempts", []); Store.set("checklistProgress", {}); Store.set("flashcardStats", {});
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

/* ------------------------------------------------------------- feature map */
export const FEATURES = [
  { id: "home", title: "Home", icon: "⌂", route: "#/home", status: "available", nav: "primary", desc: "Dashboard, quick launch and recent activity." },
  { id: "qrh", title: "QRH", icon: "▦", route: "#/qrh", status: "available", nav: "primary", desc: "Quick Reference Handbook — abnormal and emergency procedures.", pack: "procedures-index" },
  { id: "drill", title: "Drill", icon: "◎", route: "#/drill", status: "partial", nav: "primary", desc: "Practice questions and memory-item drills. Multiple-choice format is being ported from the Android drill engine.", pack: "quiz-bank" },
  { id: "checklists", title: "Checklists", icon: "☑", route: "#/checklists", status: "available", nav: "primary", desc: "Normal, abnormal and emergency checklists with PF/PM flows.", pack: "procedures-index" },
  { id: "performance", title: "Performance", icon: "⟋", route: "#/performance", status: "partial", nav: "rail", desc: "VREF, seaplane take-off/landing tables and reference speeds from the bundled QRH data. Full calculator port pending.", pack: "performance" },
  { id: "documents", title: "Documents", icon: "▤", route: "#/documents", status: "later", nav: "rail", desc: "Manuals, published library content and imported documents." },
  { id: "flashcards", title: "Flashcards", icon: "❐", route: "#/flashcards", status: "available", nav: "rail", desc: "Study decks per aircraft system with spaced review.", pack: "flashcards" },
  { id: "limitations", title: "Limitations", icon: "⚠", route: "#/limitations", status: "available", nav: "more", desc: "Airspeed, weight, powerplant and system limitations.", pack: "limitations" },
  { id: "mel", title: "MEL", icon: "≣", route: "#/mel", status: "available", nav: "more", desc: "MMEL-derived training reference with placards and crew procedures.", pack: "mel" },
  { id: "cas", title: "CAS Library", icon: "◉", route: "#/cas", status: "available", nav: "more", desc: "Legacy and G950 caution / warning message library.", pack: "cas-library" },
  { id: "strips", title: "Maldives Strips", icon: "⌖", route: "#/strips", status: "available", nav: "more", desc: "Water aerodrome and strip training reference.", pack: "maldives-strips" },
  { id: "fuel", title: "Fuel Planning", icon: "⛽", route: "#/fuel", status: "partial", nav: "more", desc: "Tank capacities, burn rates and reserve rules from the bundled calculator data. Planner UI pending.", pack: "performance" },
  { id: "wb", title: "Weight & Balance", icon: "⚖", route: "#/wb", status: "partial", nav: "more", desc: "Datum, CG limits, standard weights and arms. Interactive loading sheet pending.", pack: "performance" },
  { id: "logbook", title: "Debrief Logbook", icon: "✎", route: "#/logbook", status: "partial", nav: "more", desc: "Attempts and scores stored in this browser. Cloud sync pending." },
  { id: "aircraft-state", title: "Aircraft State", icon: "⊞", route: "#/aircraft-state", status: "later", nav: "more", desc: "Scenario snapshots, frozen cockpit states, Legacy and G950 cockpit views." },
  { id: "knowledge", title: "Knowledge & Systems", icon: "◈", route: "#/knowledge", status: "later", nav: "more", desc: "Systems descriptions, 2D diagrams and PNG references." },
  { id: "technical-lab", title: "Technical Lab", icon: "⚙", route: "#/technical-lab", status: "later", nav: "more", desc: "3D models and component animations." },
  { id: "oral-exam", title: "AI Oral Exam", icon: "✦", route: "#/oral-exam", status: "later", nav: "more", desc: "Premium examiner-style oral practice." },
  { id: "crm", title: "CRM / PF-PM Flows", icon: "⇄", route: "#/crm", status: "partial", nav: "more", desc: "Challenge–response callout flows are available inside each procedure; standalone CRM drills pending.", pack: "procedures-index" },
  { id: "readiness", title: "Check Ride Readiness", icon: "◔", route: "#/readiness", status: "later", nav: "more", desc: "Competency tracking across procedures, drills and knowledge." },
  { id: "settings", title: "Settings", icon: "⚙", route: "#/settings", status: "available", nav: "rail", desc: "Aircraft variant, theme, session and data." }
];

export function feature(id) { return FEATURES.find(function (f) { return f.id === id; }); }

export const STATUS_LABEL = { available: "Available", partial: "Partial", later: "Coming later", blocked: "Blocked" };

/* --------------------------------------------------------------- variant */
export function currentVariant() { return Store.get("variant") === "G950" ? "G950" : "LEGACY"; }

export function variantBody(procedure, variant) {
  const wanted = variant || currentVariant();
  const variants = procedure.variants || {};
  return variants[wanted] || variants.BOTH || variants.LEGACY || variants.G950 || { memory: [], flow: [] };
}

/* Icons/tones for procedure groups (QRH category tiles). */
export function groupTone(group) {
  const g = String(group || "").toLowerCase();
  if (/fire|smoke/.test(g)) return { tone: "red", icon: "🔥" };
  if (/engine|start|restart/.test(g)) return { tone: "orange", icon: "⚙" };
  if (/fuel/.test(g)) return { tone: "yellow", icon: "⛽" };
  if (/electric|instrument/.test(g)) return { tone: "green", icon: "⚡" };
  if (/flight control|airframe|stall/.test(g)) return { tone: "blue", icon: "✈" };
  if (/prop/.test(g)) return { tone: "indigo", icon: "✣" };
  if (/ice|icing/.test(g)) return { tone: "cyan", icon: "❄" };
  if (/landing|approach|go-around|descent/.test(g)) return { tone: "teal", icon: "⤓" };
  if (/hydraulic|bleed|pneumatic/.test(g)) return { tone: "purple", icon: "◍" };
  return { tone: "grey", icon: "▦" };
}
