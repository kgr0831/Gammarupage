import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = (process.argv.find((arg) => arg.startsWith("http")) || "http://127.0.0.1:4320").replace(/\/$/, "");
const browser = await chromium.launch({ channel: "msedge", headless: true }).catch(() => chromium.launch({ headless: true }));
const errors = [];
async function fixture(options = {}, saveData = false) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, ...options });
  for (const service of ["reports", "personal"]) await page.route(`**/${service}/session`, (route) => route.fulfill({ json: { authenticated: false } }));
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((saveData) => {
    window.pixelDraws = new Map();
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (this.canvas.matches('.pixel-canvas')) window.pixelDraws.set(this.canvas, (window.pixelDraws.get(this.canvas) || 0) + 1);
      return draw.apply(this, args);
    };
    if (saveData) {
      const connection = new EventTarget(); connection.saveData = true;
      Object.defineProperty(navigator, "connection", { value: connection, configurable: true });
    }
  }, saveData);
  return page;
}
const open = (page, route) => page.goto(base + route, { waitUntil: "networkidle" });
async function scene(page, name) {
  const canvas = page.locator(`canvas[data-scene="${name}"]:visible`).first();
  await canvas.waitFor();
  await canvas.scrollIntoViewIfNeeded();
  await page.waitForFunction((name) => [...document.querySelectorAll(`canvas[data-scene="${name}"]`)].some((canvas) => {
    const rect = canvas.getBoundingClientRect();
    return rect.width && rect.height && [...canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data].some((value, index) => index % 4 === 3 && value > 0);
  }), name);
  return canvas;
}
async function moving(page, canvas) {
  const pixels = await canvas.evaluate((el) => el.toDataURL());
  await page.waitForFunction(({ name, pixels }) => document.querySelector(`canvas[data-scene="${name}"]`)?.toDataURL() !== pixels, { name: await canvas.getAttribute('data-scene'), pixels });
}
async function stopped(page, canvas, message) {
  await page.waitForTimeout(150); // Let visibility/overlay observers settle.
  const before = await canvas.evaluate((el) => window.pixelDraws.get(el));
  await page.waitForTimeout(350);
  assert.equal(await canvas.evaluate((el) => window.pixelDraws.get(el)), before, message);
}
async function navigate(page, href) {
  await page.locator('.menu-toggle').click();
  await page.locator(`#navigation a[href="${href}"]`).click();
  await page.waitForURL(base + href);
}

try {
  const page = await fixture();
  await open(page, '/games');
  const world = await scene(page, 'world');
  await moving(page, world);
  await page.locator('.menu-toggle').click();
  await stopped(page, world, 'Pixels kept drawing behind the menu');
  await page.keyboard.press('Escape');
  await moving(page, world);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await stopped(page, world, 'Pixels kept drawing in the hidden tab');
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await moving(page, world);
  await page.locator('.site-footer').scrollIntoViewIfNeeded();
  await stopped(page, world, 'Offscreen pixels kept drawing');
  await navigate(page, '/about');
  await scene(page, 'planning');
  for (const role of ['art', 'programming', 'sound', 'plan']) {
    await page.locator(`#role-${role}`).click();
    await scene(page, role === 'plan' ? 'planning' : role);
    assert.equal(await page.locator('#role-panel canvas').count(), 1, 'Role switch duplicated artwork');
  }
  await page.locator('#role-plan').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#role-art').getAttribute('aria-selected'), 'true');
  await scene(page, 'art');
  for (const path of ['/activities', '/games', '/about', '/activities']) {
    await navigate(page, path);
    await scene(page, path === '/activities' ? 'studio' : path === '/games' ? 'world' : 'planning');
    assert.equal(await page.locator('.pixel-canvas').count(), 1, 'Client navigation duplicated scenes');
  }
  // Keep the old nodes only in this test, then prove removed scenes never draw.
  const detachedBefore = await page.evaluate(() => [...window.pixelDraws].filter(([canvas]) => !canvas.isConnected).map(([, count]) => count));
  assert(detachedBefore.length >= 4, 'Expected removed canvases from client navigation');
  await page.waitForTimeout(350);
  const detachedAfter = await page.evaluate(() => [...window.pixelDraws].filter(([canvas]) => !canvas.isConnected).map(([, count]) => count));
  assert.deepEqual(detachedAfter, detachedBefore, 'Removed canvases are still animating');
  await page.close();

  for (const preference of ['reduced-motion', 'save-data']) {
    const still = await fixture(preference === 'reduced-motion' ? { reducedMotion: 'reduce' } : {}, preference === 'save-data');
    await open(still, '/games');
    const artwork = await scene(still, 'world');
    await stopped(still, artwork, `${preference} did not render a still image`);
    if (preference === 'reduced-motion') {
      await still.emulateMedia({ reducedMotion: 'no-preference' });
      await moving(still, artwork);
      await still.emulateMedia({ reducedMotion: 'reduce' });
      await stopped(still, artwork, 'Live motion preference change ignored');
    }
    await still.close();
  }
  for (const width of [320, 390, 1440]) {
    const responsive = await fixture({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    for (const [route, name] of [['/games', 'world'], ['/games/2026/winter', 'world'], ['/about', 'planning'], ['/activities', 'studio'], ['/log', 'planning']]) {
      await open(responsive, route);
      await scene(responsive, name);
      assert(await responsive.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Overflow on ${route} at ${width}px`);
    }
    await open(responsive, '/games');
    const href = await responsive.locator('.game-card').first().getAttribute('href');
    await responsive.locator('.game-card').first().click();
    await responsive.waitForURL(base + href);
    await scene(responsive, 'world');
    assert(await responsive.locator('h1').isVisible(), 'Details were hidden by the artwork');
    assert(await responsive.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Detail overflow at ${width}px`);
    await responsive.close();
  }
  const home = await fixture({ reducedMotion: 'reduce' });
  await open(home, '/');
  assert.equal(await home.locator('.pixel-canvas').count(), 6, 'Original home artwork changed');
  await scene(home, 'world'); await scene(home, 'planning'); await scene(home, 'studio');
  await home.locator('#tab-art').click(); await scene(home, 'art');
  assert.equal(await home.locator('[data-role-art]:visible').count(), 1, 'Home role switch broke');
  await home.close();
  assert.deepEqual(errors, []);
  console.log('Pixel checks passed: actual painting/motion, role tabs, client navigation/cleanup, viewport/overlay/tab pause, motion/data preferences, home reuse and responsive layouts.');
} finally { await browser.close(); }
