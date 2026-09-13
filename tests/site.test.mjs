import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const htmlFiles = fs.readdirSync(root).filter((name) => name.endsWith(".html")).concat(["app/index.html"]);

function localTarget(value, sourceFile) {
  if (!value || value.startsWith("#") || /^(?:https?:|mailto:|tel:|data:|javascript:|dhc6trainer:)/i.test(value)) return null;
  // Worker/Pages Functions routes are served at runtime, not from the repo tree.
  if (value.startsWith("/api/")) return null;
  const clean = value.split("#")[0].split("?")[0];
  if (!clean) return null;
  const base = clean.startsWith("/") ? root : path.dirname(path.join(root, sourceFile));
  return path.resolve(base, clean.replace(/^\//, ""));
}

test("public pages have essential metadata and shared design", () => {
  for (const file of htmlFiles) {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(html, /<title>[^<]+<\/title>/i, `${file}: title missing`);
    if (file !== "404.html") assert.match(html, /<meta\s+name="description"/i, `${file}: description missing`);
    if (file !== "app/index.html") assert.match(html, /assets\/site-redesign\.css/i, `${file}: shared stylesheet missing`);
    assert.match(html, /<meta\s+name="viewport"/i, `${file}: viewport missing`);
  }
});

test("no concept artwork is shipped, and nothing is labelled as the wrong product", () => {
  /*
    The design mock-ups the site used to run on are gone: every remaining
    screenshot is a capture of the product actually running. The rules that
    survive are (a) a concept file must never come back and be called real, and
    (b) an Android capture and a browser capture must never be described as each
    other.
  */
  const CONCEPT = ["assets/latest-design-overview.webp", "assets/latest-design-mcc.webp",
    // Was shipped as "the verified Android screenshot". It is not: it is a phone
    // screenshot OF A WEB PAGE (Chrome custom-tab chrome and the dhc6trainer.com
    // header are baked into it) showing a light-themed mock-up. The real app is
    // dark (both themes derive from darkColorScheme) and its bottom nav reads
    // HOME / PROCS / AIRCRAFT / QRH / SETTINGS, not Home / QRH / Drill /
    // Checklists / More. None of its screen strings exist in the Android source.
    "assets/actual-android-app.jpeg",
    "assets/screenshots/3d-viewer.webp", "assets/screenshots/aircraft-focus-snapshot.webp",
    "assets/screenshots/aircraft-state.webp", "assets/screenshots/cockpit-drill-runner.webp",
    "assets/screenshots/dashboard.webp", "assets/screenshots/memory-drill.webp",
    "assets/screenshots/procedures.webp", "assets/screenshots/qrh-checklist.webp",
    "assets/screenshots/study-cards.webp", "assets/screenshots/systems-lab.webp"];
  for (const file of CONCEPT) {
    assert.equal(fs.existsSync(path.join(root, file)), false, file + " is design mock-up artwork and must stay deleted");
  }

  for (const file of htmlFiles) {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    for (const match of html.matchAll(/<img[^>]+src="([^"]+)"[^>]*>/gi)) {
      const src = match[1];
      const tag = match[0];
      for (const concept of CONCEPT) {
        assert.notEqual(src, concept, `${file}: ${src} is concept artwork and must not be displayed`);
      }
      // A browser capture is never presented as the Android app, and vice versa.
      if (/assets\/screenshots\/web-/.test(src)) {
        assert.doesNotMatch(tag, /android/i, `${file}: ${src} is a browser capture and must not be called Android`);
      }
      if (/app-screens-collage/.test(src)) {
        assert.doesNotMatch(tag, /\b(web app|browser)\b/i, `${file}: the Android capture must not be called a browser capture`);
        assert.match(tag, /android/i, `${file}: the Android capture must say which platform it is from`);
      }
    }
  }

  const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  assert.doesNotMatch(sw, /latest-design/);
});

test("every screenshot the public pages reference exists and is a real capture", () => {
  const referenced = new Set();
  for (const file of htmlFiles) {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    for (const match of html.matchAll(/(?:src|href|content)="(assets\/(?:screenshots\/[^"]+|[^"/]+\.(?:webp|jpe?g|png)))"/gi)) {
      referenced.add(match[1]);
    }
    // live.html swaps the preview image from a script table.
    for (const match of html.matchAll(/image:"(assets\/screenshots\/[^"]+)"/g)) referenced.add(match[1]);
  }
  for (const src of referenced) {
    assert.ok(fs.existsSync(path.join(root, src)), "referenced asset is missing: " + src);
  }
  const shots = fs.readdirSync(path.join(root, "assets", "screenshots"));
  assert.ok(shots.length > 0, "the screenshots directory must not be empty");
  for (const name of shots) {
    assert.match(name, /^web-[a-z0-9-]+\.webp$/, name + ": screenshots are captures of the running trainer, named web-*.webp");
  }
});

test("subscriber app shell is server-gated and keeps no session secret in web storage", () => {
  const worker = fs.readFileSync(path.join(root, "worker.js"), "utf8");
  assert.match(worker, /isProtectedPage/);
  assert.match(worker, /authorizeWebRequest/);
  const login = fs.readFileSync(path.join(root, "assets", "js", "web-app-login.js"), "utf8");
  assert.doesNotMatch(login, /sessionStorage\.setItem\("dhc6WebAccessToken"/);
  assert.match(login, /credentials: "same-origin"/);
  const gate = fs.readFileSync(path.join(root, "assets", "js", "subscriber-gate.js"), "utf8");
  assert.match(gate, /clear-protected/);
  assert.match(gate, /api\/web-access\/logout/);
  const shell = fs.readFileSync(path.join(root, "app", "index.html"), "utf8");
  assert.match(shell, /Training support only/);
  assert.match(shell, /AFM, QRH, MEL/);
  assert.match(shell, /noindex/);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "assets", "site.webmanifest"), "utf8"));
  assert.equal(manifest.start_url, "/app/");
  const robots = fs.readFileSync(path.join(root, "robots.txt"), "utf8");
  assert.match(robots, /Disallow: \/app\//);
  const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
  assert.doesNotMatch(sitemap, /live\.html|\/app\//);
});

test("Technical Lab models are never shipped in the public repo and the viewer is session-gated", () => {
  function walk(dir, out) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if ([".git", "node_modules", "build", "_delivery", ".wrangler"].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out); else out.push(full);
    }
    return out;
  }
  const binaries = walk(root, []).filter((f) => /\.(glb|gltf|bin)$/i.test(f));
  assert.deepEqual(binaries, [], "GLB models must be published to R2 via tools/build-media.mjs, not committed");
  const wrangler = fs.readFileSync(path.join(root, "wrangler.jsonc"), "utf8");
  assert.match(wrangler, /"binding": "WEB_MEDIA"/);
  assert.match(wrangler, /"bucket_name": "dhc6-web-media"/);
  const lab = fs.readFileSync(path.join(root, "app", "js", "lab3d.js"), "utf8");
  assert.match(lab, /\/api\/media\//, "models are fetched only through the protected media API");
  assert.doesNotMatch(lab, /r2\.cloudflarestorage|\.r2\.dev/, "no direct bucket URLs in the client");
  const gate = fs.readFileSync(path.join(root, "assets", "js", "subscriber-gate.js"), "utf8");
  assert.match(gate, /url\.pathname\.startsWith\("\/api\/"\)/, "sign-out clears every /api/ cache entry, including /api/media models");
  const registry = JSON.parse(fs.readFileSync(path.join(root, "tools", "data", "systems-lab-models.json"), "utf8"));
  for (const model of registry.models) assert.ok(fs.existsSync(path.join(root, "app", "vendor", "three-lab.js")), "viewer runtime present for " + model.id);
  const shellCss = fs.readFileSync(path.join(root, "app", "app.css"), "utf8");
  assert.match(shellCss, /scroll-padding-bottom/, "focused controls must not hide under the bottom navigation");
});

test("cockpit imagery is never committed to the public repo and only loads through the protected media API", () => {
  function walk(dir, out) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if ([".git", "node_modules", "build", "_delivery", ".wrangler"].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out); else out.push(full);
    }
    return out;
  }
  const files = walk(root, []);
  const cockpitArt = files
    .map((f) => path.relative(root, f).split(path.sep).join("/"))
    .filter((rel) => /\.(png|webp|jpe?g)$/i.test(rel))
    .filter((rel) => rel.split("/").includes("cockpit") || /(_base_clean|cockpit-atlas|cockpit_atlas|source_exact)/i.test(rel));
  assert.deepEqual(cockpitArt, [], "cockpit plates, sprite atlases and source_exact art belong in R2, not in the public repo");
  const tiles = files.map((f) => path.relative(root, f).split(path.sep).join("/")).filter((rel) => rel.startsWith("app/assets/tiles/"));
  assert.ok(tiles.length > 0, "the small Android tile art stays bundled — it is not protected cockpit imagery");

  const cockpit = fs.readFileSync(path.join(root, "app", "js", "cockpit.js"), "utf8");
  assert.match(cockpit, /"\/api\/media\/"/, "the plate and atlas are fetched through the session-gated media API");
  assert.doesNotMatch(cockpit, /r2\.cloudflarestorage|\.r2\.dev/, "no direct bucket URLs in the client");
  assert.match(cockpit, /credentials: "same-origin"/);
  assert.match(cockpit, /status === 401 \|\| response\.status === 403|401 \|\| response\.status === 403/, "a lost session is handled explicitly");
  assert.match(cockpit, /caches\.delete\(MEDIA_CACHE_NAME\)/, "clearing the image cache also drops the on-disk protected copies");

  const gate = fs.readFileSync(path.join(root, "assets", "js", "subscriber-gate.js"), "utf8");
  assert.match(gate, /url\.pathname\.startsWith\("\/api\/"\)/, "sign-out clears every cached /api/media entry, cockpit imagery included");
  const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  assert.doesNotMatch(sw, /cockpit\//, "the service worker never precaches cockpit imagery");
  assert.match(sw, /isProtectedRequest/);
});

test("the Aircraft State routes are registered and every cockpit screen it imports exists", () => {
  const appJs = fs.readFileSync(path.join(root, "app", "app.js"), "utf8");
  const routes = Array.from(appJs.matchAll(/route\("([^"]+)",\s*([A-Za-z0-9_]+)\)/g), (m) => [m[1], m[2]]);
  const registered = new Map(routes);
  for (const expected of ["/live", "/live/cockpit", "/live/procedures", "/scenario/select/:id", "/scenario/state/:id/:phase", "/scenario/focus/:id/:phase", "/scenario/run/:id/:phase", "/drill/run/:id"]) {
    assert.ok(registered.has(expected), "missing Aircraft State route " + expected);
  }
  // every screen bound to a route must be imported from a file that exists and exports it
  const imports = Array.from(appJs.matchAll(/import\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g));
  const provided = new Map();
  for (const [, names, from] of imports) {
    if (!from.startsWith("./")) continue;
    const file = path.join(root, "app", from.replace(/^\.\//, ""));
    assert.ok(fs.existsSync(file), "app.js imports a missing module: " + from);
    const source = fs.readFileSync(file, "utf8");
    for (const name of names.split(",").map((n) => n.trim().split(/\s+as\s+/).pop()).filter(Boolean)) {
      if (new RegExp("export\\s+(?:async\\s+)?function\\s+" + name + "\\b").test(source) || new RegExp("export\\s+(?:const|let)\\s+" + name + "\\b").test(source)) provided.set(name, from);
    }
  }
  for (const [route, handler] of routes) assert.ok(provided.has(handler), "route " + route + " points at an unexported handler: " + handler);

  const core = fs.readFileSync(path.join(root, "app", "js", "core.js"), "utf8");
  assert.match(core, /id: "aircraft-state"[^}]*status: "available"/, "the Aircraft State tile is no longer a COMING LATER stub");
  for (const status of ["available", "partial", "later"]) assert.ok(core.includes('status: "' + status + '"'), "the tile status vocabulary stays intact: " + status);
  const misc = fs.readFileSync(path.join(root, "app", "js", "screens", "misc.js"), "utf8");
  assert.doesNotMatch(misc, /Aircraft State[\s\S]{0,200}Coming later/i, "the old Aircraft State placeholder is gone");
});

test("no tile art carries a stock-library watermark and every referenced tile exists", () => {
  const tileDir = path.join(root, "app", "assets", "tiles");
  const have = new Set(fs.readdirSync(tileDir).filter((f) => f.endsWith(".webp")).map((f) => f.replace(/\.webp$/, "")));
  // procedure_tile_takeoff.webp was an unlicensed Getty Images comp with a visible
  // watermark (and an A340, not a DHC-6). It must never come back.
  assert.equal(have.has("procedure_tile_takeoff"), false, "procedure_tile_takeoff.webp is a watermarked stock comp and must stay deleted");

  const referenced = new Set();
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) {
        const source = fs.readFileSync(full, "utf8");
        for (const m of source.matchAll(/"((?:procedure|dhc6)_[a-z0-9_]*tile[a-z0-9_]*|[a-z0-9_]*tile_[a-z0-9_]+)"/g)) referenced.add(m[1]);
      }
    }
  }
  walk(path.join(root, "app", "js"));
  const missing = [...referenced].filter((name) => !have.has(name));
  assert.deepEqual(missing, [], "tile art referenced by the app but not committed");
});

test("the Procedures library row opens the QRH detail, and its arrow opens the drill runner", () => {
  const source = fs.readFileSync(path.join(root, "app", "js", "screens", "procedures.js"), "utf8");
  // ProcedureLibraryRow: tapping the row body -> onOpenProcedureDetail,
  // tapping the arrow -> onQuickStartDrill -> Screen.DrillRun (the full runner).
  assert.match(source, /href: "#\/drill\/run\/" \+ encodeURIComponent\(p\.compiledId\)/, "the arrow must open the drill runner, not the detail page");
  assert.doesNotMatch(source, /drill-btn[^}]*drill=1/, "the arrow must no longer just scroll the detail page's inline pane");
  assert.match(source, /class: "lib-row hero"[\s\S]{0,400}href: detailHref\(p\)/, "the row body still opens the QRH detail");
  assert.match(source, /from=procs/, "the drill remembers which tab launched it");

  const core = fs.readFileSync(path.join(root, "app", "js", "core.js"), "utf8");
  assert.match(core, /path\.startsWith\("\/drill\/"\) && query && query\.get\("from"\) === "procs"/, "a drill launched from PROCS keeps the PROCS tab highlighted");
  const drill = fs.readFileSync(path.join(root, "app", "js", "screens", "cockpitscreens.js"), "utf8");
  assert.match(drill, /ctx\.query\.get\("from"\) === "procs" \? "#\/systems"/, "Back returns to the launching tab");
});

test("the Systems 2D routes are registered and posters never reach the public repo", () => {
  const appJs = fs.readFileSync(path.join(root, "app", "app.js"), "utf8");
  const registered = new Map(Array.from(appJs.matchAll(/route\("([^"]+)",\s*([A-Za-z0-9_]+)\)/g), (m) => [m[1], m[2]]));
  assert.equal(registered.get("/systems/home"), "systemsHome", "Knowledge -> Systems must open the real screen, not a COMING LATER stub");
  assert.equal(registered.get("/systems/detail/:key"), "systemDetail");
  assert.doesNotMatch(appJs, /laterScreen\("systems"/, "the Systems placeholder is gone");

  const core = fs.readFileSync(path.join(root, "app", "js", "core.js"), "utf8");
  assert.match(core, /id: "systems"[^}]*status: "available"/);

  // Reference posters are protected media: they live in R2 and are fetched
  // through the session-gated API, never committed or linked publicly.
  const screen = fs.readFileSync(path.join(root, "app", "js", "screens", "systems2d.js"), "utf8");
  assert.match(screen, /loadProtectedImageUrl/, "posters must come through the protected media loader");
  assert.doesNotMatch(screen, /src:\s*"\/(app\/)?assets\/systems/, "no poster may be served from the public assets directory");
  const publicPosters = path.join(root, "assets", "systems");
  assert.equal(fs.existsSync(publicPosters), false, "system posters must never be committed to the public repo");
  assert.equal(fs.existsSync(path.join(root, "app", "assets", "systems")), false);

  // A revoked session must drop the decoded posters and the on-disk media cache.
  const cockpit = fs.readFileSync(path.join(root, "app", "js", "cockpit.js"), "utf8");
  assert.match(cockpit, /objectUrlCache\.forEach[\s\S]{0,220}revokeObjectURL/, "clearCockpitImageCache must revoke the poster object URLs");
  assert.match(cockpit, /objectUrlCache\.clear\(\)/);

  const logic = fs.readFileSync(path.join(root, "app", "js", "logic", "systems2d.js"), "utf8");
  assert.match(logic, /"\/api\/media\/"/, "posters are addressed through /api/media");
});

test("the Systems screens keep the training-support-only disclaimer", () => {
  const screen = fs.readFileSync(path.join(root, "app", "js", "screens", "systems2d.js"), "utf8");
  assert.match(screen, /Training support only/);
  assert.match(screen, /AFM, QRH, MEL/);
});

test("every cockpit screen keeps the training-support-only disclaimer", () => {
  const common = fs.readFileSync(path.join(root, "app", "js", "screens", "cockpitcommon.js"), "utf8");
  assert.match(common, /Training support only/);
  assert.match(common, /AFM, QRH, MEL/);
  for (const file of ["aircraftstate.js", "cockpitscreens.js", "scenarioedit.js"]) {
    const source = fs.readFileSync(path.join(root, "app", "js", "screens", file), "utf8");
    assert.match(source, /disclaimer\(\)|do not replace the approved AFM/, file + " must render the disclaimer");
  }
});

test("internal href and src references resolve", () => {
  const failures = [];
  for (const file of htmlFiles) {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    for (const match of html.matchAll(/(?:href|src)="([^"]+)"/gi)) {
      const target = localTarget(match[1], file);
      if (target && !fs.existsSync(target)) failures.push(`${file} -> ${match[1]}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("HTML ids are unique per page", () => {
  for (const file of htmlFiles) {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    const ids = Array.from(html.matchAll(/\sid="([^"]+)"/gi), (m) => m[1]);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    assert.deepEqual([...new Set(duplicates)], [], `${file}: duplicate ids`);
  }
});

test("critical purchase and account controls remain wired", () => {
  const desktop = fs.readFileSync(path.join(root, "desktop.html"), "utf8");
  const access = fs.readFileSync(path.join(root, "access.html"), "utf8");
  for (const plan of ["premium", "instructor", "enterprise"]) assert.match(desktop, new RegExp(`data-plan="${plan}"`));
  assert.match(desktop, /id="checkout-status"/);
  assert.match(desktop, /assets\/js\/paddle-checkout\.js/);
  for (const id of ["billing-status-form", "billingEmail", "billing-summary", "device-list", "desktop-download-message"]) assert.match(access, new RegExp(`id="${id}"`));
  assert.doesNotMatch(desktop, /pri_REPLACE|live_REPLACE|test_REPLACE/);
});

test("Paddle legal pages and primary footer links are published", () => {
  const terms = fs.readFileSync(path.join(root, "terms.html"), "utf8");
  const refund = fs.readFileSync(path.join(root, "refund.html"), "utf8");
  const worker = fs.readFileSync(path.join(root, "worker.js"), "utf8");
  const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
  assert.match(terms, /Terms of Service/);
  assert.match(terms, /Paddle/);
  assert.match(refund, /Refund and Cancellation Policy/);
  assert.match(refund, /mandatory consumer rights/i);
  assert.match(worker, /footer-legal-links/);
  assert.match(worker, /terms\.html/);
  assert.match(worker, /refund\.html/);
  assert.match(sitemap, /terms\.html/);
  assert.match(sitemap, /refund\.html/);
});

test("service worker precache paths exist", () => {
  const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  const entries = Array.from(sw.matchAll(/^\s*"(\/[^"]+)"[,]?$/gm), (m) => m[1]);
  for (const entry of entries) {
    if (entry === "/") continue;
    assert.ok(fs.existsSync(path.join(root, entry.slice(1))), `Missing precache asset ${entry}`);
  }
});

test("all JavaScript modules and browser scripts parse", () => {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if ([".wrangler", "node_modules"].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js") || entry.name.endsWith(".mjs")) files.push(full);
    }
  }
  walk(root);
  for (const file of files) execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
});
