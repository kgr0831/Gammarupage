import { chromium } from "playwright";

const baseUrl = process.argv.find((argument) => argument.startsWith("http")) || "http://127.0.0.1:3000";
const targetBase = new URL(`${baseUrl.replace(/\/+$/, "")}/`);
const basePath = targetBase.pathname.replace(/\/$/, "");
const browser = await launchBrowser();
const errors = [];
async function newPage(options) {
  const page = await browser.newPage(options);
  for (const base of ["reports", "personal"]) await page.route(`**/${base}/session`, (route) => route.fulfill({ json: { authenticated: false } }));
  return page;
}

const routeUrl = (route) => {
  if (/^https?:\/\//.test(route)) return route;
  if (basePath && (route === basePath || route.startsWith(`${basePath}/`))) return `${targetBase.origin}${route}`;
  return `${targetBase.origin}${basePath}${route.startsWith("/") ? route : `/${route}`}`;
};

try {
  // Media loading/looping is covered separately by test:reel.
  const page = await newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
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
  assert(await page.locator(".game-card").count() === 6, "Landing gallery is missing games");
  await page.locator('[data-filter="winter"]').click();
  assert(await page.locator(".game-card:visible").count() === 1, "Landing season filter failed");
  await page.locator(".game-card:visible").click();
  assert(await page.locator(".game-dialog").isVisible(), "Game details did not open");
  assert((await page.locator("#dialog-title").textContent()) === "Cosmos Walker", "Wrong game opened");
  assert((await page.locator("#dialog-download").getAttribute("href"))?.startsWith("https://"), "Download destination missing");
  await page.keyboard.press("Escape");
  assert(!(await page.locator(".game-dialog").isVisible()), "Game dialog did not close");
  await page.locator('[data-filter="all"]').click();
  await page.getByRole("tab", { name: "기획", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  assert((await page.locator("#tab-programming").getAttribute("aria-selected")) === "true", "Role keyboard navigation failed");
  assert(await page.locator("#panel-programming").isVisible(), "Selected role panel hidden");
  await page.locator(".faq summary").first().click();
  assert(await page.locator(".faq details").first().getAttribute("open") !== null, "FAQ did not open");
  for (const image of await page.locator(".game-card img").all()) {
    await image.scrollIntoViewIfNeeded();
    await image.evaluate((element) => element.decode());
    assert(await image.evaluate((element) => element.naturalWidth > 0), "Game cover failed to load");
  }
  await page.goto(routeUrl("/games"), { waitUntil: "networkidle" });
  const detailHref = await page.locator(".game-card").first().getAttribute("href");
  assert(Boolean(detailHref), "Featured game did not expose a detail link");
  const detailResponse = await page.goto(routeUrl(detailHref), { waitUntil: "networkidle" });
  assert(detailResponse && detailResponse.status() < 400, "Featured game detail failed to load");
  assert((await page.title()).includes("GAMMARU"), "Game detail metadata is missing");
  await page.locator(".site-brand").click();
  await page.waitForURL(routeUrl("/"));
  await page.locator(".game-card").first().waitFor();
  assert(await page.locator(".game-card").count() === 6, "Returning home did not initialize the new landing");

  for (const viewport of [
    { width: 1280, height: 800, name: "16:10 laptop" },
    { width: 1440, height: 900, name: "16:10 desktop" },
    { width: 1920, height: 1080, name: "full HD" },
    { width: 390, height: 844, name: "mobile" },
    { width: 320, height: 720, name: "small mobile" },
  ]) {
    const responsive = await newPage({ viewport, reducedMotion: "reduce" });
    for (const route of ["/", "/games", "/activities", "/about", "/log"]) {
      await responsive.goto(routeUrl(route), { waitUntil: "networkidle" });
      const overflow = await responsive.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(overflow <= 1, `${route} has ${overflow}px horizontal overflow at ${viewport.name}`);
    }
    await responsive.close();
  }

  const mobile = await newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  await mobile.goto(routeUrl("/"), { waitUntil: "networkidle" });
  const menu = mobile.locator(".menu-toggle");
  assert(await menu.isVisible(), "Mobile menu is not visible");
  await menu.click();
  assert((await menu.getAttribute("aria-expanded")) === "true", "Mobile menu did not open");
  await mobile.locator("#navigation").getByRole("link", { name: "겜마루 소개", exact: true }).click();
  await mobile.waitForURL((url) => url.hash === "#about");
  assert((await menu.getAttribute("aria-expanded")) === "false", "Mobile menu did not close after navigation");
  await mobile.route("**/reports/session", (route) => route.fulfill({ json: { authenticated: true, role: "member", subscription: "approved", canRead: true } }));
  await mobile.route("**/personal/session", (route) => route.fulfill({ json: { authenticated: true, role: "member", canRead: true } }));
  await mobile.evaluate(() => window.dispatchEvent(new Event("focus")));
  await menu.click();
  await mobile.locator('#member-navigation a[href="/reports"]').waitFor();
  assert(await mobile.locator('#member-navigation a[href="/personal"]').isVisible(), "Personal session link missing");
  await mobile.keyboard.press("Escape");
  await mobile.close();

  const about = await newPage({ viewport: { width: 1440, height: 900 } });
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
