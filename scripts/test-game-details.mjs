import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import sharp from "sharp";
import { chromium } from "playwright";

const base = (process.argv.find((argument) => argument.startsWith("http")) || "http://127.0.0.1:3000").replace(/\/$/, "");
const games = JSON.parse(await readFile("src/data/archive/games.json", "utf8"));
const manualImages = JSON.parse(await readFile("src/data/archive/manual-images.json", "utf8"));
const stills = { ...JSON.parse(await readFile("src/data/archive/video-stills.json", "utf8")), ...manualImages };
const route = (game) => `${base}/games/${game.year}/${game.season}/${encodeURIComponent(game.slug)}`;
const browser = await chromium.launch({ channel: "msedge", headless: true }).catch(() => chromium.launch({ headless: true }));
const errors = [];
await mkdir("test-results/video-stills", { recursive: true });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (/\.(mp4|m3u8|m4s)(?:\?|$)/.test(request.url())) errors.push(`Unexpected video download: ${request.url()}`);
  });
  for (const [uid, media] of Object.entries(stills)) {
    const game = games.find((item) => item.uid === uid);
    assert(game, `Unknown supplemental image game: ${uid}`);
    assert.equal(game.media.cover, null, `Original cover should be preserved: ${uid}`);
    for (const image of [media.cover, ...media.screenshots]) {
      for (const [format, file] of Object.entries(image)) {
        const directory = Object.hasOwn(manualImages, uid) ? "manual-images" : "video-stills";
        assert(file.startsWith(`/archive/${directory}/${uid}/`), `Mismatched game image: ${file}`);
        const metadata = await sharp(await readFile(`public${file}`)).metadata();
        assert(metadata.width > 0 && metadata.width <= 1280 && metadata.height > 0 && metadata.height <= 900, `Invalid dimensions: ${file}`);
        assert.equal(metadata.format, format === "avif" ? "heif" : "webp");
      }
    }
    const response = await page.goto(route(game), { waitUntil: "networkidle" });
    assert(response.ok(), `Detail route failed: ${uid}`);
    assert.equal(await page.locator("h1").textContent(), game.title);
    const pictures = page.locator(".game-detail__cover picture, .screenshot-grid picture");
    assert.equal(await pictures.count(), 1 + media.screenshots.length);
    for (const [index, picture] of (await pictures.all()).entries()) {
      const image = picture.locator("img");
      await image.scrollIntoViewIfNeeded();
      await image.evaluate((element) => element.decode());
      assert((await image.evaluate((element) => element.currentSrc)).endsWith([media.cover, ...media.screenshots][index].avif));
      // Exercise the existing WebP fallback independently of AVIF support.
      await picture.locator("source").evaluate((element) => element.remove());
      await image.evaluate((element) => element.decode());
      assert((await image.evaluate((element) => element.currentSrc)).endsWith([media.cover, ...media.screenshots][index].webp));
    }
  }

  await page.goto(`${base}/games/2026/winter`, { waitUntil: "networkidle" });
  for (const uid of Object.keys(stills)) {
    const game = games.find((item) => item.uid === uid);
    const card = page.locator(".game-card").filter({ has: page.getByRole("heading", { name: game.title, exact: true }) });
    assert((await card.locator("img").getAttribute("src")).endsWith(stills[uid].cover.webp), `Missing card image: ${uid}`);
  }

  const original = games.find((game) => game.media.cover);
  await page.goto(route(original), { waitUntil: "networkidle" });
  assert.equal(await page.locator(".game-detail__cover img").getAttribute("src"), new URL(base).pathname.replace(/\/$/, "") + original.media.cover.webp);

  // Read each real server-rendered title and its computed sizing input.
  const titleMarkup = [];
  for (let offset = 0; offset < games.length; offset += 8) {
    titleMarkup.push(...await Promise.all(games.slice(offset, offset + 8).map(async (game) => {
      const response = await page.request.get(route(game));
      assert(response.ok(), `Detail route failed: ${game.uid}`);
      return (await response.text()).match(/<h1\b[^>]*>.*?<\/h1>/s)?.[0];
    })));
  }
  assert(titleMarkup.every(Boolean), "Missing server-rendered titles");
  const measuredTitles = [];
  for (const width of [320, 390, 768, 1101, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const result = await page.evaluate(async (markup) => {
      const heading = document.querySelector(".game-detail__copy h1");
      const originalHtml = heading.outerHTML;
      const failures = [];
      let smallest = Infinity;
      for (const html of markup) {
        const source = new DOMParser().parseFromString(html, "text/html").querySelector("h1");
        heading.textContent = source.textContent;
        heading.setAttribute("style", source.getAttribute("style") || "");
        // Container-query units settle during rendering, not just a forced
        // style read; let each replacement reach the screen before measuring.
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await document.fonts.ready;
        const range = document.createRange();
        range.selectNodeContents(heading);
        const text = range.getBoundingClientRect();
        const box = heading.getBoundingClientRect();
        smallest = Math.min(smallest, parseFloat(getComputedStyle(heading).fontSize));
        if (range.getClientRects().length !== 1 || text.right > box.right + 1 || heading.scrollWidth > heading.clientWidth + 1) {
          failures.push({ title: source.textContent, textWidth: text.width, available: box.width });
        }
      }
      heading.outerHTML = originalHtml;
      return { failures, smallest };
    }, titleMarkup);
    assert.deepEqual(result.failures, [], `Title overflow at ${width}px`);
    measuredTitles.push({ width, smallestFont: result.smallest.toFixed(1) });
  }

  const sample = games.find((game) => game.uid === "g-2026-wi-001");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(route(sample), { waitUntil: "networkidle" });
    await page.screenshot({ path: `test-results/video-stills/detail-${width}.png`, fullPage: true });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `Page overflow at ${width}px`);
  }
  await page.goto(`${base}/log`, { waitUntil: "networkidle" });
  for (const [label, href] of [["INSTAGRAM", "https://www.instagram.com/ssu_gammaru"], ["YOUTUBE", "https://www.youtube.com/@gammaru9553"]]) {
    for (const selector of [".site-footer__links", ".social-terminal__links"]) {
      const link = page.locator(selector).getByRole("link", { name: new RegExp(label) });
      assert.equal(await link.getAttribute("href"), href);
      assert.equal(await link.getAttribute("target"), "_blank");
      assert(!(await link.textContent()).includes("연결 예정"));
      assert.equal(await link.getAttribute("title"), null);
    }
  }
  assert.deepEqual(errors, []);
  console.log(`Detail checks passed: ${Object.keys(stills).length} matched games, AVIF/WebP decoding, cards, preserved artwork, ${games.length} one-line titles at 6 widths, no video requests, and official social links.`);
  console.table(measuredTitles);
} finally {
  await browser.close();
}
