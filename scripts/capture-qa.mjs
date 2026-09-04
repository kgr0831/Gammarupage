import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = process.argv.find((argument) => argument.startsWith("http")) || "http://127.0.0.1:3000";
const output = path.join(process.cwd(), "test-results", "visual");
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const cases = [
    { name: "home-1280x800", route: "/", width: 1280, height: 800 },
    { name: "home-1440x900", route: "/", width: 1440, height: 900 },
    { name: "home-games-1440x900", route: "/", width: 1440, height: 900, scroll: ".section--games" },
    { name: "home-roles-1280x800", route: "/", width: 1280, height: 800, scroll: ".role-deck" },
    { name: "home-roles-mobile", route: "/", width: 390, height: 844, scroll: ".role-deck" },
    { name: "games-1440x900", route: "/games", width: 1440, height: 900 },
    { name: "games-mobile", route: "/games", width: 390, height: 844, scroll: ".archive-controls" },
    { name: "activities-mobile", route: "/activities", width: 390, height: 844 },
  ];

  for (const item of cases) {
    const page = await browser.newPage({ viewport: { width: item.width, height: item.height } });
    await page.goto(`${baseUrl}${item.route}`, { waitUntil: "networkidle" });
    if (item.scroll) await page.locator(item.scroll).scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
    const motion = await page.evaluate(() => ({
      ready: document.documentElement.classList.contains("motion-ready"),
      revealed: document.querySelectorAll(".is-visible").length,
      cards: [...document.querySelectorAll(".game-card")].slice(0, 3).map((element) => ({
        className: element.className,
        top: Math.round(element.getBoundingClientRect().top),
        opacity: getComputedStyle(element).opacity,
      })),
    }));
    console.log(item.name, motion);
    await page.screenshot({ path: path.join(output, `${item.name}.png`), fullPage: false });
    await page.close();
  }

  const about = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await about.goto(`${baseUrl}/about`, { waitUntil: "networkidle" });
  await about.locator(".faq-section").scrollIntoViewIfNeeded();
  await about.waitForTimeout(1000);
  console.log("about-faq", await about.locator(".faq-item").first().evaluate((element) => ({
    className: element.className,
    top: Math.round(element.getBoundingClientRect().top),
    opacity: getComputedStyle(element).opacity,
  })));
  await about.screenshot({ path: path.join(output, "about-faq-1440x900.png"), fullPage: false });
  await about.close();
} finally {
  await browser.close();
}
