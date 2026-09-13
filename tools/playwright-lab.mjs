/*
  Browser walkthrough of the Technical Lab (3D models) against the local dev server.
  Not part of `npm test` (Playwright is not a project dependency).

    node tools/build-content.mjs --android "C:\Android Studio\DHC-6-Trainer" --kotlin "C:\Android Studio\DHC-6-Trainer\_web_export" --out build\content
    node tools/build-media.mjs --reference "C:\Android Studio\DHC6_REFERENCE_LIBRARY\System-Lab" --android "C:\Android Studio\DHC-6-Trainer" --out build\media
    node tools/dev-server.mjs --port 8788 --kv build\content\kv-bulk.json --media-kv build\media\kv-media-index.json --media-dir "C:\Android Studio\DHC6_REFERENCE_LIBRARY\System-Lab;C:\Android Studio\DHC-6-Trainer\core-res\src\main\assets\models\systems_lab\models"
    npm i -D playwright && npx playwright install chromium
    node tools/playwright-lab.mjs

  Loads the aircraft explorer, opens every lab system, loads its primary model
  (including the 75 MB engine), selects pins, toggles fault mode, plays an
  animation group and checks that models are cached and cleared on sign-out.
  Writes screenshots to build/screenshots/lab (SHOTS_DIR).
*/
import fs from "node:fs";
import { chromium } from "playwright";
const BASE = process.env.BASE_URL || "http://127.0.0.1:8788";
const OUT = process.env.SHOTS_DIR || "build/screenshots/lab";
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const errors = [];

async function waitForModel(page, timeout) {
  await page.waitForFunction(() => {
    const overlay = document.querySelector(".lab-overlay");
    const canvas = document.querySelector("canvas.lab-canvas");
    return canvas && overlay && overlay.hidden;
  }, null, { timeout: timeout || 120000 });
}

async function session(viewport, tag, systems) {
  const context = await browser.newContext({ viewport, baseURL: BASE });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(tag + " pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(tag + " console: " + m.text()); });
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("/api/web-access/verify")) errors.push(tag + " http " + r.status() + " " + r.url()); });
  const res = await context.request.post(BASE + "/api/web-access/session", { data: { email: "pilot@example.com", licenseKey: "DHC6-TEST-TEST-TEST" }, headers: { Origin: BASE } });
  if (!res.ok()) throw new Error("sign-in failed " + res.status());

  // Systems Lab home: aircraft explorer auto-loads (4.8 MB)
  await page.goto("/app/#/systems/lab", { waitUntil: "networkidle" });
  await waitForModel(page);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${tag}_lab_home.png`, fullPage: true });
  const hotspots = await page.locator(".lab-hotspot:visible").count();
  console.log(tag, "lab home: hotspots visible =", hotspots, "| systems cards =", await page.locator(".lab-system-card").count());
  // Notes lane
  await page.getByRole("button", { name: /My Notes/ }).click();
  await page.waitForTimeout(200);
  console.log(tag, "notes lane:", (await page.locator("#view").innerText()).split("\n").slice(0, 4).join(" | "));
  await page.locator(".screen-header .bubble", { hasText: /^Aircraft/ }).click();
  await page.waitForTimeout(200);

  for (const system of systems) {
    await page.goto("/app/#/systems/lab/" + system, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    const loadBtn = page.locator(".lab-overlay button", { hasText: /^Load/ });
    if (await loadBtn.count()) { console.log(tag, system, "large model prompt:", await loadBtn.innerText()); await loadBtn.click(); }
    await waitForModel(page, 240000);
    await page.waitForTimeout(500);
    const meta = await page.locator(".lab-anim ~ .t-body-s, .stack-8 > .t-body-s.c-ter").first().innerText().catch(() => "");
    console.log(tag, system, "loaded:", meta.slice(0, 110));
    await page.screenshot({ path: `${OUT}/${tag}_${system}.png`, fullPage: false, timeout: 90000 });
    // pins
    const pins = page.locator(".lab-pin");
    const pinCount = await pins.count();
    if (pinCount > 1) { await pins.nth(1).click({ force: true }); await page.waitForFunction(() => document.querySelectorAll(".lab-pin.active").length === 1 && document.querySelectorAll(".lab-pin")[1].classList.contains("active"), null, { timeout: 60000 }); }
    // animation group
    const animChip = page.locator(".lab-anim .chip").first();
    // force: under software WebGL the render loop can starve Playwright's stability check
    if (await animChip.count()) {
      await animChip.scrollIntoViewIfNeeded(); await animChip.click({ force: true }); await page.waitForTimeout(700);
      console.log(tag, system, "animation:", await animChip.innerText(), "| playing:", await page.locator(".lab-anim button", { hasText: "Pause" }).count() > 0);
      await animChip.click({ force: true }); // stop before screenshots (software GL is slow on big models)
      await page.waitForTimeout(200);
    }
    // fault mode
    const faultSwitch = page.locator('button[aria-label="Fault mode"]');
    if (await faultSwitch.count()) { await faultSwitch.scrollIntoViewIfNeeded(); await faultSwitch.click({ force: true }); await page.waitForTimeout(200); }
    // levers
    const power = page.locator('input[aria-label="Power lever"]');
    if (await power.count()) { await power.fill("1"); await page.waitForTimeout(150); }
    if (system !== "AIR_CONDITIONING") await page.waitForSelector(".readout-chip", { state: "attached", timeout: 60000 });
    const readout = await page.locator(".readout-chip").allInnerTexts().catch(() => []);
    await page.screenshot({ path: `${OUT}/${tag}_${system}_full.png`, fullPage: true, timeout: 90000 });
    console.log(tag, system, "pins =", pinCount, "| readout:", readout.map((t) => t.replace(/\n/g, " ")).join(", "));
    // add a note on the selected pin
    if (system === systems[0]) {
      await page.getByRole("button", { name: /Add note|Edit note/ }).click({ force: true });
      await page.locator("textarea.lab-note").fill("Playwright note for " + system);
      await page.getByRole("button", { name: "Done" }).click({ force: true });
      await page.waitForTimeout(150);
    }
  }
  // cache check: models are in the Cache API store, then cleared on sign-out
  const cachedBefore = await page.evaluate(async () => { const c = await caches.open("dhc6-media-v1"); return (await c.keys()).length; });
  console.log(tag, "cached models before sign-out:", cachedBefore);
  await page.goto("/app/#/systems/lab", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /My Notes/ }).click();
  console.log(tag, "notes:", (await page.locator("#view").innerText()).split("\n").filter((l) => /Playwright note/.test(l)).length, "saved");
  await page.goto("/app/#/settings", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/web-app\.html/, { timeout: 15000 });
  await page.waitForLoadState("load");
  await page.waitForTimeout(1200);
  const cachedAfter = await page.evaluate(async () => { const keys = await caches.keys(); let n = 0; for (const k of keys) { const c = await caches.open(k); n += (await c.keys()).filter((r) => r.url.includes("/api/media/")).length; } return n; });
  console.log(tag, "after sign-out URL:", page.url(), "| protected media entries left:", cachedAfter);
  if (cachedAfter !== 0) errors.push(tag + " media cache not cleared on sign-out");
  await context.close();
}

const ALL = ["FLIGHT_CONTROLS", "AIR_CONDITIONING", "AIR_SYSTEMS", "HYDRAULICS", "ENGINE_FUEL_CONTROL", "PROPELLER", "ENGINE_CONTROLS", "STARTING", "FUEL", "ELECTRICAL", "INDICATIONS_ALERTING", "ENVIRONMENTAL", "LANDING_GEAR_WHEELS", "LANDING_GEAR_SKI", "LANDING_GEAR_FLOATS", "POWERPLANT"];
const quick = process.env.LAB_SYSTEMS ? process.env.LAB_SYSTEMS.split(",") : null;
await session({ width: 390, height: 844 }, "phone", quick || ALL);
await session({ width: 1440, height: 900 }, "desktop", quick || ["FLIGHT_CONTROLS", "POWERPLANT"]);
await browser.close();
const unexpected = errors.filter((e) => !/401 \(Unauthorized\)/.test(e));
console.log("ERRORS:", unexpected.length ? unexpected : "none");
process.exit(unexpected.length ? 1 : 0);
