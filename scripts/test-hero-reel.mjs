import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const base = (process.argv.find((arg) => arg.startsWith("http")) || "http://127.0.0.1:3000").replace(/\/$/, "");
const browser = await chromium.launch({ channel: "msedge", headless: true }).catch(() => chromium.launch({ headless: true }));
const mediaRequest = (url) => /\/media\/reel\/.*\.(m3u8|m4s|mp4)(\?|$)/.test(url);
const errors = [];
await mkdir("test-results", { recursive: true });

async function fixture(options = {}, init) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  const requests = [];
  page.on("request", (request) => { if (mediaRequest(request.url())) requests.push(request.url()); });
  page.on("pageerror", (error) => errors.push(String(error)));
  return { page, context, requests };
}

async function open(page) {
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  assert.equal(await page.locator(".hero-reel__wipe, .hero-loader").count(), 0);
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".hero__actions")).opacity === "1");
  await page.evaluate(() => window.scrollTo({ top: 600, behavior: "instant" }));
  assert.ok(await page.evaluate(() => window.scrollY > 0), "Video must never lock scrolling");
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
}

async function playing(page) {
  await page.waitForFunction(() => {
    const video = document.querySelector(".hero-reel video");
    return video?.currentTime > 0.5 && !video.paused && video.dataset.playing === "true";
  }, null, { timeout: 25000 });
}

try {
  for (const preference of ["reduced-motion", "save-data"]) {
    const { page, context, requests } = await fixture(
      preference === "reduced-motion" ? { reducedMotion: "reduce" } : {},
      preference === "save-data" ? () => {
        const connection = new EventTarget();
        connection.saveData = true;
        Object.defineProperty(navigator, "connection", { configurable: true, value: connection });
      } : undefined,
    );
    await open(page);
    await page.waitForTimeout(700);
    assert.equal(requests.length, 0, `${preference} downloaded video`);
    assert.equal(await page.locator(".hero-reel video").getAttribute("src"), null);
    await context.close();
    console.log(`PASS ${preference}: no video downloads, content usable`);
  }

  const desktop = await fixture();
  await open(desktop.page);
  await playing(desktop.page);
  const initial = await desktop.page.locator(".hero-reel video").evaluate((video) => ({
    codec: video.dataset.codec, transport: video.dataset.transport, duration: video.duration,
    buffered: video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0,
    currentTime: video.currentTime, loop: video.loop,
  }));
  assert.equal(initial.transport, "hls", "Chromium should use segmented HLS");
  assert.equal(initial.loop, true);
  assert.ok(Math.abs(initial.duration - 41.4) < 0.2);
  assert.ok(initial.buffered - initial.currentTime <= 17, "Startup fetched too far ahead");
  assert.ok(!desktop.requests.some((url) => /h264-\d+\.mp4/.test(url)), "Normal playback downloaded a whole MP4");
  await desktop.page.screenshot({ path: "test-results/hero-reel-desktop.png" });
  console.log(`PASS desktop: ${JSON.stringify(initial)}, ${desktop.requests.length} initial media requests`);

  // Exercise the visibility listener without depending on headless window focus.
  await desktop.page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await desktop.page.waitForTimeout(350);
  const hiddenRequests = desktop.requests.length;
  assert.ok(await desktop.page.locator(".hero-reel video").evaluate((video) => video.paused));
  await desktop.page.waitForTimeout(1000);
  assert.equal(desktop.requests.length, hiddenRequests, "Hidden tab continued fetching segments");
  await desktop.page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await playing(desktop.page);
  console.log("PASS visibility: paused downloads/playback, resumed successfully");

  await desktop.page.locator(".hero-reel video").evaluate((video) => {
    window.reelLoops = 0;
    let previous = video.currentTime;
    video.addEventListener("timeupdate", () => {
      if (previous > video.duration - 2 && video.currentTime < 2) window.reelLoops++;
      previous = video.currentTime;
    });
    video.playbackRate = 2;
  });
  await desktop.page.waitForFunction(() => window.reelLoops >= 1, null, { timeout: 55000 });
  const requestsAtLoop = desktop.requests.length;
  await desktop.page.waitForTimeout(2500);
  assert.equal(desktop.requests.length, requestsAtLoop, "Loop downloaded media again despite retained buffers");
  console.log(`PASS loop: no new media requests on replay (${requestsAtLoop} first-pass requests)`);
  await desktop.page.emulateMedia({ reducedMotion: "reduce" });
  await desktop.page.waitForFunction(() => !document.querySelector(".hero-reel video").hasAttribute("src"));
  await desktop.context.close();

  const mobile = await fixture({ viewport: { width: 390, height: 844 }, isMobile: true });
  await open(mobile.page);
  await playing(mobile.page);
  await mobile.page.waitForTimeout(1800);
  assert.ok(mobile.requests.some((url) => url.includes("-540/segment-")));
  assert.ok(!mobile.requests.some((url) => url.includes("-1080/")), "Mobile downloaded 1080p");
  await mobile.page.screenshot({ path: "test-results/hero-reel-mobile.png" });
  await mobile.context.close();
  console.log("PASS mobile: 540p segments only");

  const fallback = await fixture({}, () => {
    navigator.mediaCapabilities.decodingInfo = async () => ({ supported: true, smooth: true, powerEfficient: true });
  });
  await fallback.page.route(/\/media\/reel\/.*av1.*\.m3u8$/, (route) => route.fulfill({ status: 404, body: "Missing" }));
  await open(fallback.page);
  await playing(fallback.page);
  assert.ok(fallback.requests.some((url) => url.endsWith("/av1.m3u8")), "AV1 failure path was not exercised");
  assert.equal(await fallback.page.locator(".hero-reel video").getAttribute("data-codec"), "h264");
  assert.equal(await fallback.page.locator(".hero-reel video").getAttribute("data-transport"), "hls");
  await fallback.context.close();
  console.log("PASS AV1 failure: H.264 HLS fallback plays");

  const mp4 = await fixture();
  await mp4.page.route(/\/media\/reel\/.*\.m3u8$/, (route) => route.fulfill({ status: 404, body: "Missing" }));
  await open(mp4.page);
  await playing(mp4.page);
  assert.equal(await mp4.page.locator(".hero-reel video").getAttribute("data-transport"), "mp4");
  await mp4.context.close();
  console.log("PASS HLS failure: progressive H.264 fallback plays");

  const native = await fixture({}, () => {
    Object.defineProperty(window, "MediaSource", { configurable: true, value: undefined });
  });
  await open(native.page);
  await playing(native.page);
  assert.equal(await native.page.locator(".hero-reel video").getAttribute("data-transport"), "native");
  await native.context.close();
  console.log("PASS native HLS: playback without MSE/player bundle");

  const denied = await fixture({}, () => {
    HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException("Autoplay blocked", "NotAllowedError"));
  });
  await open(denied.page);
  await denied.page.waitForFunction(() => {
    const video = document.querySelector(".hero-reel video");
    return video.dataset.transport && !video.hasAttribute("src");
  });
  const deniedRequests = denied.requests.length;
  await denied.page.waitForTimeout(700);
  assert.equal(denied.requests.length, deniedRequests, "Autoplay denial kept downloading");
  await denied.context.close();
  console.log("PASS autoplay denied: transfers stop, poster remains");

  const broken = await fixture();
  await broken.page.route(/\/media\/reel\/.*\.(m3u8|m4s|mp4)$/, (route) => route.fulfill({ status: 404, body: "Missing" }));
  await open(broken.page);
  await broken.page.waitForFunction(() => {
    const video = document.querySelector(".hero-reel video");
    return video.dataset.transport === "mp4" && !video.hasAttribute("src");
  }, null, { timeout: 25000 });
  assert.ok(await broken.page.locator(".hero-reel__poster").evaluate((image) => image.complete && image.naturalWidth > 0));
  await broken.context.close();
  console.log("PASS all sources missing: poster remains, page never blocks");

  assert.deepEqual(errors, [], "Unexpected browser errors");
  console.log("All hero reel checks passed.");
} finally {
  await browser.close();
}
