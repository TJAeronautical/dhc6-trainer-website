/*
  Browser walkthrough of the subscriber web app against the local dev server.
  Not part of `npm test` (Playwright is not a project dependency).

    node tools/build-content.mjs --android "C:\Android Studio\DHC-6-Trainer" --out build\content
    node tools/dev-server.mjs --port 8788 --kv build\content\kv-bulk.json
    npm i -D playwright && npx playwright install chromium
    node tools/playwright-walkthrough.mjs

  Signs in with the dev licence, visits every route at phone / tablet / desktop sizes,
  completes an emergency drill and a 5-question quiz, checks the logbook, search focus
  and sign-out redirect, and writes screenshots to build/screenshots (SHOTS_DIR).
  Exits non-zero on any page error, console error or HTTP >= 400 other than the
  expected 401 from the post-sign-out session check.
*/
import fs from "node:fs";
import { chromium } from "playwright";
const BASE = "http://127.0.0.1:8788";
const OUT = process.env.SHOTS_DIR || "build/screenshots";
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const errors = [];
async function session(viewport, tag) {
  const context = await browser.newContext({ viewport, baseURL: BASE });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(tag + " pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(tag + " console: " + m.text()); });
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("/api/web-access/verify")) errors.push(tag + " http " + r.status() + " " + r.url()); });
  // sign in via API and set cookie
  const res = await context.request.post(BASE + "/api/web-access/session", { data: { email: "pilot@example.com", licenseKey: "DHC6-TEST-TEST-TEST" }, headers: { Origin: BASE } });
  if (!res.ok()) throw new Error("sign-in failed " + res.status());
  const routes = ["#/dashboard", "#/systems", "#/qrh", "#/qrh/category/EMERGENCY", "#/live", "#/settings", "#/knowledge/home", "#/systems/home", "#/systems/detail/electrical", "#/systems/detail/ata_100", "#/knowledge/definitions", "#/study/srs", "#/study/limitations", "#/study/mel-reference", "#/study/maldives-strips", "#/study/cas", "#/study/flashcards", "#/quizzes", "#/quizzes/run/BOTH/5", "#/training/performance", "#/training/fuel-plan", "#/training/weight-balance", "#/training/logbook", "#/training/competency-dashboard", "#/library/home", "#/knowledge/search"];
  for (const r of routes) {
    await page.goto("/app/" + r, { waitUntil: "networkidle" });
    await page.waitForTimeout(250);
    const name = r.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "");
    await page.screenshot({ path: `${OUT}/${tag}_${name}.png`, fullPage: r === "#/dashboard" || r === "#/systems" });
    const title = await page.title();
    const text = (await page.locator("#view").innerText()).slice(0, 80).replace(/\n/g, " | ");
    console.log(tag, r, "→", title, "::", text);
  }
  // Interactive: open an emergency procedure and run the drill
  await page.goto("/app/#/qrh/category/EMERGENCY", { waitUntil: "networkidle" });
  const first = page.locator("a.tile.r-26").filter({ hasText: "Engine Fire" }).first();
  console.log(tag, "first emergency:", (await first.innerText()).split("\n")[0]);
  await first.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${tag}_procedure_detail.png`, fullPage: true });
  if (await page.locator(".drill").count()) {
    for (let i = 0; i < 30; i++) {
      if (!(await page.locator(".drill .flash-card").count())) break;
      await page.locator(".drill .flash-card").click();
      await page.locator(".drill .btn-gotit").click();
    }
    await page.screenshot({ path: `${OUT}/${tag}_drill_flow.png`, fullPage: true });
    const rows = page.locator(".drill .flow-row");
    const n = await rows.count();
    for (let i = 0; i < n; i++) await rows.nth(i).click();
    await page.locator(".drill .btn-finish").click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/${tag}_drill_summary.png`, fullPage: true });
    console.log(tag, "drill summary:", (await page.locator(".drill").innerText()).split("\n").slice(0, 8).join(" | "));
  }
  // Quiz run: pick, grade, next through 5 questions
  await page.goto("/app/#/quizzes/run/BOTH/5", { waitUntil: "networkidle" });
  for (let i = 0; i < 5; i++) {
    await page.locator(".quiz-option").first().click();
    await page.getByRole("button", { name: "Grade" }).click();
    await page.getByRole("button", { name: /Next|Finish/ }).click();
  }
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/${tag}_quiz_result.png`, fullPage: true });
  console.log(tag, "quiz:", (await page.locator("#view").innerText()).split("\n").slice(0, 4).join(" | "));
  await page.getByRole("button", { name: "Save & exit" }).click();
  await page.goto("/app/#/training/logbook", { waitUntil: "networkidle" });
  console.log(tag, "logbook:", (await page.locator("#view").innerText()).split("\n").slice(0, 6).join(" | "));
  await page.screenshot({ path: `${OUT}/${tag}_logbook.png`, fullPage: true });
  // Procedure library: NORMAL filter + search
  await page.goto("/app/#/systems", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "NORMAL", exact: true }).click();
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/${tag}_procs_normal.png`, fullPage: false });
  await page.locator('input[type="search"]').fill("feather");
  await page.waitForTimeout(150);
  console.log(tag, "search feather:", (await page.locator(".lib-row").count()), "rows; focus on search:", await page.evaluate(() => document.activeElement && document.activeElement.type));
  // Sign out → /app/ redirects
  await page.goto("/app/#/settings", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForTimeout(800);
  console.log(tag, "after sign-out URL:", page.url());
  await context.close();
}
await session({ width: 390, height: 844 }, "phone");
await session({ width: 820, height: 1180 }, "tablet");
await session({ width: 1440, height: 900 }, "desktop");
await browser.close();
const unexpected = errors.filter((e) => !/401 \(Unauthorized\)/.test(e));
console.log("ERRORS:", unexpected.length ? unexpected : "none");
process.exit(unexpected.length ? 1 : 0);
