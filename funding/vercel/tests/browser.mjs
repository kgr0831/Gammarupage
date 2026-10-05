import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { setup, sampleHtml, today } from "./helpers.mjs";

const app = setup({}, { fetch: async (url) => String(url).endsWith("token") ? Response.json({ access_token: "test-only-transient", token_type: "Bearer" }) : Response.json({ id: "100000000000000002", username: "browser-member", global_name: "브라우저 검증 회원", avatar: null }) });
const server = createServer(async (req, res) => {
  try {
    if (req.url === "/brand/gammaru-mark.png") { res.setHeader("Content-Type", "image/png"); res.end(await readFile(path.resolve("public/brand/gammaru-mark.png"))); return; }
    if (req.url.startsWith("/mock-discord?")) {
      const auth = new URL(req.url, app.config.origin);
      res.writeHead(302, { location: `/reports/auth/callback?state=${auth.searchParams.get("state")}&code=fake` }); res.end(); return;
    }
    const response = await app.handler(new Request(`${app.config.origin}${req.url}`, { method: req.method, headers: req.headers, ...(req.method === "POST" ? { body: req, duplex: "half" } : {}) }));
    const headers = Object.fromEntries(response.headers);
    if (headers.location?.startsWith("https://discord.com/oauth2/authorize?")) headers.location = `/mock-discord?${new URL(headers.location).searchParams}`;
    if (response.headers.getSetCookie().length) headers["set-cookie"] = response.headers.getSetCookie();
    res.writeHead(response.status, headers); res.end(Buffer.from(await response.arrayBuffer()));
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
  await admin.getByLabel("목록과 DM에 표시할 요약").fill("업로드와 보관함 화면을 확인하는 가상 보고서입니다.");
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
  await app.work.at(-1)();
  await member.goto(`${app.config.origin}/reports/account`);
  await member.getByText("구독 승인 안내: 전송했습니다.", { exact: false }).waitFor();
  await app.store.update((s) => { s.members[user].approval_notice.createdAt = 0; });
  await member.getByRole("button", { name: "확인 DM 다시 받기", exact: true }).click();
  await member.getByText("확인 DM을 요청했습니다.", { exact: false }).waitFor();
  await app.work.at(-1)();
  await member.getByRole("link", { name: "전송 상태 새로고침", exact: true }).click();
  await member.getByText("구독 승인 안내: 전송했습니다.", { exact: false }).waitFor();
  await member.setViewportSize({ width: 390, height: 844 });
  assert.equal(await member.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await member.screenshot({ path: path.join(output, "approval-confirmation-mobile.png"), fullPage: true });
  assert.equal((await member.goto(`${app.config.origin}/reports/${today}/html`)).status(), 200);
  await admin.getByRole("button", { name: "승인 취소", exact: true }).click();
  assert.equal((await member.goto(`${app.config.origin}/reports/${today}/html`)).status(), 403);
  const loginContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const login = await loginContext.newPage();
  await login.goto(`${app.config.origin}/reports/account`);
  await login.getByRole("link", { name: "Discord로 로그인하고 구독 신청" }).click();
  await login.waitForURL("**/reports/account?welcome=1", { timeout: 10000 }).catch(async (error) => {
    console.error("Mock OAuth result:", new URL(login.url()).pathname, (await login.locator("body").innerText()).slice(0, 1800)); throw error;
  });
  await login.getByText("Discord 로그인이 완료되었습니다.", { exact: false }).waitFor();
  await login.getByText("구독 신청이 접수되었습니다.", { exact: false }).waitFor();
  assert.equal(await login.getByLabel("신청자 이름").inputValue(), "브라우저 검증 회원");
  await login.reload();
  assert.equal(await login.getByRole("button", { name: "로그아웃", exact: true }).isVisible(), true);
  assert.equal(await login.evaluate(() => document.cookie.includes("briefs=")), false, "JS cannot read the session cookie");
  assert.equal(await login.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await login.screenshot({ path: path.join(output, "login-account-mobile.png"), fullPage: true });
  const persisted = await loginContext.storageState();
  assert.ok(persisted.cookies.find((c) => c.name === "briefs").expires > Date.now() / 1000 + 29 * 86400);
  await loginContext.close();
  const reopened = await browser.newContext({ storageState: persisted });
  const restored = await reopened.newPage();
  await restored.goto(`${app.config.origin}/reports/account`);
  await restored.getByRole("button", { name: "구독 설정 저장" }).waitFor();
  await restored.getByRole("button", { name: "로그아웃", exact: true }).click();
  await restored.getByRole("link", { name: "Discord로 로그인하고 구독 신청" }).waitFor();
  console.log("Browser passed: upload, sandbox, archive, persistent OAuth login, mobile, approval, confirmation DM status/retry and revocation. Mock private storage only; no deployment or real messages.");
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
