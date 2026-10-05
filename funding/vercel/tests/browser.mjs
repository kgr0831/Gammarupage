import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { setup, sampleHtml, today } from "./helpers.mjs";

const app = setup();
const server = createServer(async (req, res) => {
  try {
    if (req.url === "/brand/gammaru-mark.png") { res.setHeader("Content-Type", "image/png"); res.end(await readFile(path.resolve("public/brand/gammaru-mark.png"))); return; }
    const response = await app.handler(new Request(`${app.config.origin}${req.url}`, { method: req.method, headers: req.headers, ...(req.method === "POST" ? { body: req, duplex: "half" } : {}) }));
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500); res.end("Test bridge failure"); }
});
server.listen(0, "127.0.0.1"); await once(server, "listening"); app.config.origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
const output = path.resolve("test-results/vercel-reports"); await mkdir(output, { recursive: true });
try {
  const admin = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  await admin.goto(`${app.config.origin}/reports/admin`);
  await admin.getByLabel("아이디").fill("admin"); await admin.getByLabel("비밀번호").fill(app.config.token);
  await admin.getByRole("button", { name: "로그인", exact: true }).click();
  await admin.getByRole("link", { name: "HTML 업로드", exact: true }).click();
  const hostile = sampleHtml.replace("</body>", '<script>parent.document.body.dataset.injected="yes";window.scriptRan=true</script><form action="/reports/logout" method="post"><button id="bad-form">bad form</button></form></body>');
  await admin.getByLabel("보고서 제목", { exact: true }).fill("겜마루 후원·운영자금 일일 보고 — 검증용");
  await admin.getByLabel("목록에 표시할 요약").fill("업로드와 보관함 화면을 확인하는 가상 보고서입니다.");
  await admin.getByLabel("HTML 파일", { exact: true }).setInputFiles({ name: "brief.html", mimeType: "text/html", buffer: Buffer.from(hostile) });
  await admin.getByRole("button", { name: "HTML 미리보기", exact: true }).click();
  await admin.frameLocator("iframe").getByRole("heading", { name: "가상 보고서 · 실제 공고 아님" }).waitFor();
  assert.equal(await admin.evaluate(() => document.body.dataset.injected), undefined);
  const frame = admin.frames().find((f) => f !== admin.mainFrame());
  assert.equal(await frame.evaluate(() => window.scriptRan), undefined);
  await admin.evaluate(() => document.fonts.ready);
  await admin.screenshot({ path: path.join(output, "upload-preview.png") });
  await admin.getByLabel("내용을 확인했고 보고서 등록에 동의합니다.").check();
  assert.equal(await admin.getByLabel("내용을 확인했고 보고서 등록에 동의합니다.").isChecked(), true);
  await admin.getByRole("button", { name: "이 HTML 등록하기" }).click();
  await admin.getByText(`${today} 보고서를 등록했습니다.`, { exact: false }).waitFor();
  await admin.getByRole("link", { name: "보고서 목록", exact: true }).click();
  await admin.getByRole("heading", { name: "누적 보고서 1개" }).waitFor();
  await admin.evaluate(() => document.fonts.ready);
  await admin.screenshot({ path: path.join(output, "archive-desktop.png"), fullPage: true });
  await admin.locator(".archive-row").click();
  await admin.frameLocator("iframe").getByRole("heading", { name: "가상 보고서 · 실제 공고 아님" }).waitFor();
  await admin.frameLocator("iframe").locator("#bad-form").click();
  assert.equal((await admin.request.get(`${app.config.origin}/reports/admin`)).status(), 200, "Uploaded forms cannot log out the reader");
  await admin.screenshot({ path: path.join(output, "report-viewer.png"), fullPage: true });
  await admin.setViewportSize({ width: 390, height: 844 });
  assert.equal(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await admin.getByRole("link", { name: "← 전체 보고서 목록" }).click();
  await admin.screenshot({ path: path.join(output, "archive-mobile.png"), fullPage: true });
  assert.equal(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const user = await app.member("100000000000000001", "pending");
  const memberContext = await browser.newContext();
  await memberContext.addCookies([{ name: "briefs", value: (await app.session("member", user)).split("=")[1], url: app.config.origin }]);
  const member = await memberContext.newPage();
  assert.equal((await member.goto(`${app.config.origin}/reports/${today}/html`)).status(), 403);
  await admin.goto(`${app.config.origin}/reports/admin`);
  await admin.getByRole("button", { name: "구독 승인", exact: true }).click();
  assert.equal((await member.goto(`${app.config.origin}/reports/${today}/html`)).status(), 200);
  await admin.getByRole("button", { name: "승인 취소", exact: true }).click();
  assert.equal((await member.goto(`${app.config.origin}/reports/${today}/html`)).status(), 403);
  console.log("Browser passed: HTML file selection, preview, sandboxed scripts/forms, upload, date URL, archive, mobile, member approval and raw HTML revocation. Mock private storage only; no deployment or real messages.");
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
