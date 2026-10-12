import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const base = (process.argv.find((arg) => arg.startsWith("http")) || "http://127.0.0.1:3000").replace(/\/$/, "");
const browser = await chromium.launch({ channel: "msedge", headless: true }).catch(() => chromium.launch({ headless: true }));
const reel = JSON.parse(await readFile("src/data/hero-reel-manifest.json", "utf8"));
const ids = JSON.parse(await readFile("src/data/hero-reel-game-ids.json", "utf8"));
const archive = JSON.parse(await readFile("src/data/archive/games.json", "utf8"));
const errors = [];
async function fixture(options = {}, init) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  if (init) await context.addInitScript(init);
  const page = await context.newPage(), requests = [];
  for (const service of ["reports", "personal"]) await page.route(`**/${service}/session`, (route) => route.fulfill({ json: { authenticated: false } }));
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (/\/media\/reel\/.*\.mp4/.test(request.url())) requests.push(request.url()); });
  return { context, page, requests };
}
const open = async (page) => {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.locator(".game-card").first().waitFor({ state: "attached" });
};
const playing = (page) => page.waitForFunction(() => {
  const video = document.querySelector(".reel-video");
  return video.currentTime > .3 && !video.paused && document.querySelector(".hero-reel").hasAttribute("data-loaded");
}, null, { timeout: 25000 });
async function credits(page, index) {
  const shot = reel.timeline[index];
  await page.locator(".reel-video").evaluate((video, at) => { video.pause(); video.currentTime = at; }, shot.at + .5);
  await page.waitForFunction(() => !document.querySelector(".reel-video").seeking);
  const actual = await page.locator(".reel-credits li").evaluateAll((rows) => rows.map((row) => ({
    uid: row.dataset.gameId, title: row.querySelector("strong").textContent, people: row.querySelector(".credit-people")?.textContent || "", metadata: row.querySelector("p:last-child").textContent,
  })));
  const expected = shot.games.map((title) => {
    const game = archive.find((game) => game.uid === ids[reel.games.find((game) => game.title === title).id]);
    const seasons = { winter: "겨울 공모전", summer: "여름 공모전", gamejam: "게임잼" };
    return { uid: game.uid, title: game.title, people: game.creators.join(" · "), metadata: `${game.team} · ${game.year} ${seasons[game.season]}` };
  });
  assert.deepEqual(actual, expected, `Incorrect attribution at shot ${index}`);
}
try {
  for (const preference of ["reduced-motion", "save-data"]) {
    const item = await fixture(preference === "reduced-motion" ? { reducedMotion: "reduce" } : {}, preference === "save-data" ? () => {
      const connection = new EventTarget(); connection.saveData = true;
      Object.defineProperty(navigator, "connection", { configurable: true, value: connection });
    } : undefined);
    await open(item.page);
    assert.equal(item.requests.length, 0, `${preference} downloaded video`);
    assert.equal(await item.page.locator(".reel-video").getAttribute("src"), null);
    assert.equal(await item.page.locator(".reel-credits").isVisible(), false);
    await item.context.close();
  }
  const desktop = await fixture();
  await open(desktop.page); await playing(desktop.page);
  assert.ok(desktop.requests.some((url) => url.includes("h264-1080.mp4")));
  assert.ok(await desktop.page.locator(".reel-video").evaluate((video) => video.muted && video.loop && Math.abs(video.duration - 41.4) < .2));
  for (let i = 0; i < reel.timeline.length; i++) await credits(desktop.page, i);
  await desktop.page.locator(".reel-video").evaluate((video) => { video.currentTime = video.duration - .3; return video.play(); });
  await desktop.page.waitForFunction(() => document.querySelector(".reel-video").currentTime < 2, null, { timeout: 10000 });
  await desktop.page.locator(".menu-toggle").click();
  assert.ok(await desktop.page.locator(".reel-video").evaluate((video) => video.paused));
  await desktop.page.keyboard.press("Escape"); await playing(desktop.page);
  await desktop.page.locator("#about").scrollIntoViewIfNeeded();
  await desktop.page.waitForFunction(() => document.querySelector(".reel-video").paused);
  await desktop.page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" })); await playing(desktop.page);
  await desktop.page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange"));
  });
  assert.ok(await desktop.page.locator(".reel-video").evaluate((video) => video.paused));
  await desktop.page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event("visibilitychange")); }); await playing(desktop.page);
  await desktop.page.emulateMedia({ reducedMotion: "reduce" });
  await desktop.page.waitForFunction(() => !document.querySelector(".reel-video").hasAttribute("src"));
  await desktop.context.close();
  const mobile = await fixture({ viewport: { width: 390, height: 844 }, isMobile: true });
  await open(mobile.page); await playing(mobile.page); await credits(mobile.page, 12);
  assert.ok(mobile.requests.some((url) => url.includes("h264-540.mp4")));
  assert.ok(!mobile.requests.some((url) => url.includes("h264-1080.mp4")));
  const fits = await mobile.page.locator(".reel-credits").evaluate((element) => {
    const rect = element.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth;
  });
  assert.ok(fits, "Mobile attribution overflows"); await mobile.context.close();
  for (const mode of ["denied", "missing"]) {
    const item = await fixture({}, mode === "denied" ? () => {
      HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException("Blocked", "NotAllowedError"));
    } : undefined);
    if (mode === "missing") await item.page.route(/\/media\/reel\/.*\.mp4/, (route) => route.fulfill({ status: 404, body: "Missing" }));
    await open(item.page);
    assert.equal(await item.page.locator(".hero-reel").getAttribute("data-loaded"), null);
    assert.ok(await item.page.locator(".reel-poster").evaluate((image) => image.complete && image.naturalWidth > 0));
    assert.ok(await item.page.locator(".menu-toggle").isVisible());
    await item.context.close();
  }
  assert.deepEqual(errors, []);
  console.log("Reel checks passed: all credits, desktop/mobile playback, loop, overlay/visibility pause, reduced motion, data saver and poster fallback.");
} finally { await browser.close(); }
