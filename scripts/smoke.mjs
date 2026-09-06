import { chromium } from "playwright";

const baseUrl = process.argv.find((argument) => argument.startsWith("http")) || "http://127.0.0.1:3000";
const targetBase = new URL(`${baseUrl.replace(/\/+$/, "")}/`);
const basePath = targetBase.pathname.replace(/\/$/, "");
const browser = await launchBrowser();
const errors = [];

const routeUrl = (route) => {
  if (/^https?:\/\//.test(route)) return route;
  if (basePath && (route === basePath || route.startsWith(`${basePath}/`))) return `${targetBase.origin}${route}`;
  return `${targetBase.origin}${basePath}${route.startsWith("/") ? route : `/${route}`}`;
};

try {
  // Media loading/looping is covered separately by test:reel.
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  page.on("pageerror", (error) => errors.push(`pageerror: ${String(error)}`));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`response: ${response.status()} ${response.url()}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("WebSocket connection") && !message.text().includes("Failed to load resource")) {
      errors.push(`console: ${message.text()}`);
    }
  });

  for (const route of ["/", "/games", "/activities", "/about", "/log"]) {
    const response = await page.goto(routeUrl(route), { waitUntil: "networkidle" });
    assert(response && response.status() < 400, `${route} returned ${response?.status()}`);
    assert(await page.locator("h1").first().isVisible(), `${route} has no visible h1`);
  }

  await page.goto(routeUrl("/activities"), { waitUntil: "networkidle" });
  const videoPosters = page.locator(".video-poster");
  assert(await videoPosters.count() === 2, "Activities video links are missing");
  for (const poster of await videoPosters.all()) {
    await poster.scrollIntoViewIfNeeded();
    const thumbnail = poster.locator("img.video-poster__image");
    await thumbnail.evaluate((image) => image.decode());
    assert(await thumbnail.evaluate((image) => image.naturalWidth >= 640), "YouTube thumbnail is missing or a placeholder");
    const videoId = new URL(await poster.getAttribute("href")).pathname.slice(1);
    assert((await thumbnail.getAttribute("src")) === `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`, "Thumbnail does not match its video link");
  }

  await page.goto(routeUrl("/games"), { waitUntil: "networkidle" });
  await page.locator('input[type="search"]').fill("SLab");
  await page.waitForTimeout(80);
  assert((await page.locator(".game-card").count()) === 1, "Archive search did not narrow to one SLab result");
  assert((await page.locator(".archive-count").textContent())?.includes("1개 작품"), "Archive result count did not update");

  await page.goto(routeUrl("/"), { waitUntil: "networkidle" });
  const reel = page.locator(".hero-reel");
  const reelTopBeforeScroll = await reel.evaluate((element) => Math.round(element.getBoundingClientRect().top));
  await page.evaluate(() => window.scrollTo(0, Math.min(window.innerHeight, document.documentElement.scrollHeight - window.innerHeight)));
  await page.waitForTimeout(120);
  const reelTopAfterScroll = await reel.evaluate((element) => Math.round(element.getBoundingClientRect().top));
  assert(reelTopBeforeScroll === 0 && reelTopAfterScroll === 0, "Home reel is not fixed to the viewport");
  await page.evaluate(() => window.scrollTo(0, 0));
  const detailHref = await page.locator(".game-card").first().getAttribute("href");
  assert(Boolean(detailHref), "Featured game did not expose a detail link");
  const detailResponse = await page.goto(routeUrl(detailHref), { waitUntil: "networkidle" });
  assert(detailResponse && detailResponse.status() < 400, "Featured game detail failed to load");
  assert((await page.title()).includes("GAMMARU"), "Game detail metadata is missing");

  for (const viewport of [
    { width: 1280, height: 800, name: "16:10 laptop" },
    { width: 1440, height: 900, name: "16:10 desktop" },
    { width: 1920, height: 1080, name: "full HD" },
    { width: 390, height: 844, name: "mobile" },
  ]) {
    const responsive = await browser.newPage({ viewport, reducedMotion: "reduce" });
    for (const route of ["/", "/games", "/activities", "/about", "/log"]) {
      await responsive.goto(routeUrl(route), { waitUntil: "networkidle" });
      const overflow = await responsive.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(overflow <= 1, `${route} has ${overflow}px horizontal overflow at ${viewport.name}`);
    }
    await responsive.close();
  }

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  await mobile.goto(routeUrl("/"), { waitUntil: "networkidle" });
  const menu = mobile.locator(".menu-toggle");
  assert(await menu.isVisible(), "Mobile menu is not visible");
  await menu.click();
  assert((await menu.getAttribute("aria-expanded")) === "true", "Mobile menu did not open");
  await mobile.locator(".site-nav").getByRole("link", { name: "ABOUT", exact: true }).click();
  await mobile.waitForURL((url) => url.pathname.replace(/\/$/, "") === `${basePath}/about`);
  assert((await menu.getAttribute("aria-expanded")) === "false", "Mobile menu did not close after navigation");
  await mobile.close();

  const about = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await about.goto(routeUrl("/about"), { waitUntil: "networkidle" });
  await about.locator(".faq-section").scrollIntoViewIfNeeded();
  await about.waitForTimeout(1100);
  assert(await about.locator(".faq-item").first().isVisible(), "FAQ reveal remained hidden after entering the viewport");
  const faqLines = await about.locator(".faq-section__heading h2 span").evaluateAll((elements) => elements.map((element) => element.getClientRects().length));
  assert(faqLines.every((lines) => lines === 1), "FAQ heading broke across unintended lines at 1440x900");
  await about.close();

  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Smoke checks passed: routes, archive search, detail link, responsive overflow, and mobile navigation.");
} finally {
  await browser.close();
}

async function launchBrowser() {
  try {
    return await chromium.launch({ channel: "msedge", headless: true });
  } catch {
    return chromium.launch({ headless: true });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
