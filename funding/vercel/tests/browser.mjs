import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { setup, sampleHtml, today } from "./helpers.mjs";
import { createSiteHandler } from "../router.mjs";
import { BriefStore } from "../storage.mjs";

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
  await admin.getByRole("link", { name: "이전 보고·진행 기록", exact: true }).click();
  assert.match(admin.url(), /\/reports\/upload\?guide=1#research-state$/);
  assert.equal(JSON.parse(await admin.locator("#research-state-json").innerText()).stateVersion, 0);
  assert.match(await admin.locator("#design pre").innerText(), /gammaru-opportunities/);
  for (const width of [1440, 390]) {
    await admin.setViewportSize({ width, height: 900 });
    assert.equal(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Research sources wrap on mobile");
  }
  await admin.setViewportSize({ width: 1440, height: 1080 });
  await admin.getByRole("link", { name: "HTML 업로드로 돌아가기", exact: true }).click();
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
  app.config.discordReportChannelId = "300000000000000001";
  await admin.goto(`${app.config.origin}/reports/upload`);
  await admin.getByLabel("목록과 채널에 표시할 요약").waitFor();
  await admin.getByRole("button", { name: "오늘 보고서 채널 게시·대기 처리" }).waitFor();
  assert.equal(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await admin.screenshot({ path: path.join(output, "channel-upload-mobile.png"), fullPage: true });
  await member.goto(`${app.config.origin}/reports/account`);
  assert.equal(await member.locator('input[name="dm"]').count(), 0);
  await member.getByText("일일 보고서의 제목·요약·링크는 Discord 서버 채널에 게시됩니다.", { exact: false }).waitFor();
  assert.equal(await member.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await member.screenshot({ path: path.join(output, "channel-account-mobile.png"), fullPage: true });
  const opportunity = { id: "browser-club-support", title: "검증용 동아리 지원 정보", sourceUrl: "https://example.org/club", benefit: "실제 모집이 아닌 테스트 혜택", eligibility: "학생 동아리", deadline: "테스트 자료", nextAction: "지원 자격 검토", changeNote: "" };
  await app.store.attachOpportunities(today, { version: 1, stateVersion: 0, opportunities: [opportunity] });
  await admin.goto(`${app.config.origin}/reports/${today}`);
  assert.equal(await admin.locator(".full-report").getAttribute("open"), null);
  assert.equal(await admin.locator('select[name="status"]').count(), 0);
  await admin.getByRole("button", { name: "보류", exact: true }).click();
  await admin.waitForURL(`**/reports/${today}?progress=browser-club-support*`);
  assert.equal(await admin.getByRole("button", { name: "보류", exact: true }).isDisabled(), true);
  await admin.locator(".note-editor > summary").click();
  await admin.getByLabel("다음 조사에 반영할 메모").fill("행사 예산 확정 후 재검토");
  await Promise.all([admin.waitForNavigation(), admin.getByRole("button", { name: "메모 저장", exact: true }).click()]);
  await admin.reload();
  assert.equal(await admin.getByRole("button", { name: "보류", exact: true }).getAttribute("aria-pressed"), "true");
  assert.equal(await admin.getByLabel("다음 조사에 반영할 메모").inputValue(), "행사 예산 확정 후 재검토");
  const feedback = await (await admin.request.get(`${app.config.origin}/reports/research-state`)).json();
  assert.equal(feedback.known[0].status, "deferred");
  assert.equal(feedback.known[0].note, "행사 예산 확정 후 재검토");
  assert.equal(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await admin.screenshot({ path: path.join(output, "progress-mobile.png"), fullPage: true });
  await app.store.update((s) => { s.members[user].status = "approved"; });
  await member.goto(`${app.config.origin}/reports/${today}`);
  await member.getByRole("button", { name: "진행 중", exact: true }).click();
  await member.waitForURL(`**/reports/${today}?progress=browser-club-support*`);
  const memberFeedback = await (await admin.request.get(`${app.config.origin}/reports/research-state`)).json();
  assert.equal(memberFeedback.known[0].status, "in_progress");
  assert.equal(memberFeedback.known[0].note, "행사 예산 확정 후 재검토");
  await admin.goto(`${app.config.origin}/reports/progress`);
  await admin.locator('.status-filters a[href$="status=in_progress"]').click();
  assert.equal(await admin.locator('.full-report > summary').count(), 0, "Club progress is directly visible");
  await admin.getByRole("heading", { name: opportunity.title }).waitFor();
  await admin.locator('.status-filters a[href$="status=completed"]').click();
  assert.equal(await admin.locator(".opportunity-row").count(), 0);
  assert.equal(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const noScriptContext = await browser.newContext({ javaScriptEnabled: false });
  await noScriptContext.addCookies([{ name: "briefs", value: (await app.session("member", user)).split("=")[1], url: app.config.origin }]);
  const noScript = await noScriptContext.newPage();
  await noScript.goto(`${app.config.origin}/reports/${today}`);
  await noScript.getByRole("button", { name: "완료", exact: true }).click();
  await noScript.waitForURL(`**/reports/${today}?progress=browser-club-support*`);
  assert.equal(await noScript.getByRole("button", { name: "완료", exact: true }).isDisabled(), true);
  assert.equal((await app.store.read()).opportunities[opportunity.id].note, "행사 예산 확정 후 재검토");
  await noScriptContext.close();
  const publisherContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  await publisherContext.addCookies([{ name: "briefs", value: (await app.session("publisher")).split("=")[1], url: app.config.origin }]);
  const publisher = await publisherContext.newPage();
  await publisher.goto(`${app.config.origin}/reports/upload?guide=1`);
  await publisher.getByRole("link", { name: "HTML 업로드로 돌아가기", exact: true }).click();
  await publisher.getByText("파일 대신 HTML 내용 붙여넣기", { exact: true }).click();
  await publisher.getByLabel("발행일", { exact: true }).fill("2020-01-01");
  await publisher.getByLabel("보고서 제목", { exact: true }).fill("붙여넣기 검증용 과거 보고서");
  await publisher.getByLabel("HTML 전체 내용", { exact: true }).fill(sampleHtml);
  assert.equal(await publisher.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await publisher.screenshot({ path: path.join(output, "paste-upload-mobile.png"), fullPage: true });
  await publisher.getByRole("button", { name: "HTML 미리보기", exact: true }).click();
  await publisher.frameLocator("iframe").getByRole("heading", { name: "가상 보고서 · 실제 공고 아님" }).waitFor();
  await publisher.getByLabel("내용을 확인했고 보고서 등록에 동의합니다.").check();
  await publisher.getByRole("button", { name: "이 HTML 등록하기" }).click();
  await publisher.getByText("2020-01-01 보고서를 등록했습니다.", { exact: false }).waitFor();
  await publisher.getByText("알림 기록이 없습니다.", { exact: false }).waitFor();
  await publisher.reload();
  assert.equal((await app.store.read()).reports.length, 2);
  await publisherContext.close();
  app.config.personalOwnerId = user;
  const personalItems = ["contest", "job"].map((category) => ({ ...opportunity, id: `browser-${category}`, category, title: { contest: "AI 개발 공모전 · 검증용", job: "AI 개발 채용 · 검증용" }[category], sourceUrl: `https://example.org/${category}` }));
  await app.store.update((s) => {
    s.reports[0].audience = "personal"; s.reports[0].opportunities = personalItems;
    s.reports[0].title = "개인 데일리 브리핑 — 검증용";
    s.reports[0].summary = "공모전·채용 화면 검증용입니다. 실제 추천 정보가 아닙니다.";
    for (const item of personalItems) s.opportunities[item.id] = { ...item, status: "new", note: "", revision: 0, lastReported: today, history: [] };
  });
  await member.goto(`${app.config.origin}/reports/${today}`);
  for (const category of ["contest", "job"]) assert.equal(await member.locator(`#category-${category} .opportunity-row`).count(), 1);
  await member.locator("#category-job").getByRole("button", { name: "보류", exact: true }).click();
  await member.waitForURL(`**/reports/${today}?progress=browser-job*`);
  assert.equal((await app.store.read()).opportunities["browser-job"].status, "deferred");
  for (const width of [1440, 390, 320]) {
    await member.setViewportSize({ width, height: 1000 });
    await member.evaluate(() => scrollTo(0, 0));
    assert.equal(await member.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await member.screenshot({ path: path.join(output, `personal-${width}.png`), fullPage: true });
  }
  await member.setViewportSize({ width: 390, height: 844 });
  await member.goto(`${app.config.origin}/reports/profile`);
  await member.getByLabel("기술과 경험", { exact: true }).fill("검증용 프로필 · 실제 개인 조건 아님");
  await member.getByRole("button", { name: "조사 조건 저장", exact: true }).click();
  await member.getByText("조사 조건을 저장했습니다. 다음 조사부터 반영됩니다.", { exact: true }).waitFor();
  await member.reload();
  assert.equal(await member.getByLabel("기술과 경험", { exact: true }).inputValue(), "검증용 프로필 · 실제 개인 조건 아님");
  assert.equal(await member.locator(".brand").innerText(), "PERSONAL BRIEF");
  for (const width of [390, 320]) {
    await member.setViewportSize({ width, height: 844 });
    assert.equal(await member.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await member.screenshot({ path: path.join(output, `personal-profile-${width}.png`), fullPage: true });
  }
  app.config.service = "personal";
  const personalContext = await browser.newContext();
  const personalPage = await personalContext.newPage();
  await personalPage.goto(`${app.config.origin}/reports`);
  await personalPage.getByRole("heading", { name: "개인 로그인", exact: true }).waitFor();
  await personalPage.getByLabel("아이디", { exact: true }).fill(app.config.adminUsername);
  await personalPage.getByLabel("비밀번호", { exact: true }).fill(app.config.token);
  await personalPage.getByRole("button", { name: "로그인", exact: true }).click();
  await personalPage.getByRole("heading", { name: "내 데일리 스크럼", exact: true }).waitFor();
  await personalPage.getByRole("link", { name: "Discord 연결하기", exact: true }).click();
  await personalPage.getByRole("button", { name: "Discord로 로그인하고 연결", exact: true }).click();
  await personalPage.getByText("Discord 연결을 완료했습니다.", { exact: true }).waitFor();
  assert.equal((await app.store.read()).personalAccount.discordId, "100000000000000002");
  for (const width of [1440, 390, 320]) {
    await personalPage.setViewportSize({ width, height: 900 });
    assert.equal(await personalPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Personal account wraps on mobile");
    await personalPage.screenshot({ path: path.join(output, `personal-account-${width}.png`), fullPage: true });
  }
  await personalPage.getByLabel("새 보고서 요약과 링크를 DM으로 받기", { exact: true }).uncheck();
  await personalPage.getByRole("button", { name: "알림 설정 저장", exact: true }).click();
  await personalPage.reload();
  assert.equal(await personalPage.getByLabel("새 보고서 요약과 링크를 DM으로 받기", { exact: true }).isChecked(), false);
  await personalPage.getByRole("button", { name: "Discord 연결 해제", exact: true }).click();
  await personalPage.getByText("아직 연결된 Discord 계정이 없습니다.", { exact: true }).waitFor();
  await personalContext.close();
  const mountedStore = new BriefStore(app.files, "personal/briefs");
  let mountedDiscordId = user;
  const mountedEnv = {
    REPORTS_SITE_URL: app.config.origin, FUNDING_ADMIN_USERNAME: "club-admin", FUNDING_ADMIN_TOKEN: app.config.token,
    PERSONAL_ADMIN_USERNAME: "personal-owner", PERSONAL_ADMIN_TOKEN: app.config.publisherToken,
    PERSONAL_PUBLISHER_TOKEN: "test-publisher-".repeat(4), DISCORD_APPLICATION_ID: app.config.discordApplicationId,
    DISCORD_CLIENT_SECRET: "mock-client-secret",
  };
  app.handler = createSiteHandler({ env: mountedEnv, clubStore: app.store, personalStore: mountedStore, fetch: async url => {
    if (String(url).endsWith("/channels/300000000000000002")) return Response.json({ id: "300000000000000002", guild_id: "400000000000000002", type: 0, name: "데일리-스크럼" });
    if (String(url).endsWith("/guilds/400000000000000002")) return Response.json({ id: "400000000000000002", name: "검증용 데일리 스크럼 서버" });
    return String(url).endsWith("token") ? Response.json({ access_token: "mock", token_type: "Bearer" }) : Response.json({ id: mountedDiscordId, username: "linked-personal", global_name: "개인 검증 계정" });
  } });
  const sharedContext = await browser.newContext(), sharedPage = await sharedContext.newPage();
  await sharedPage.goto(`${app.config.origin}/reports/login/admin`);
  await sharedPage.getByLabel("아이디", { exact: true }).fill("club-admin");
  await sharedPage.getByLabel("비밀번호", { exact: true }).fill(app.config.token);
  await sharedPage.getByRole("button", { name: "로그인", exact: true }).click();
  await sharedPage.waitForURL("**/reports/admin");
  await sharedPage.goto(`${app.config.origin}/personal/login/admin`);
  await sharedPage.getByLabel("아이디", { exact: true }).fill("personal-owner");
  await sharedPage.getByLabel("비밀번호", { exact: true }).fill(app.config.publisherToken);
  await sharedPage.getByRole("button", { name: "로그인", exact: true }).click();
  await sharedPage.waitForURL("**/personal");
  for (const width of [1440, 390, 320]) {
    await sharedPage.setViewportSize({ width, height: 950 });
    assert.equal(await sharedPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await sharedPage.screenshot({ path: path.join(output, `personal-mounted-${width}.png`), fullPage: true });
  }
  await sharedPage.getByRole("link", { name: "Discord 연결하기", exact: true }).click();
  await sharedPage.getByRole("button", { name: "Discord로 로그인하고 연결", exact: true }).click();
  await sharedPage.waitForURL("**/personal/account?welcome=1");
  await sharedPage.getByText("Discord 연결을 완료했습니다.", { exact: true }).waitFor();
  assert.equal((await (await sharedPage.request.get(`${app.config.origin}/reports/session`)).json()).authenticated, true);
  await sharedPage.goto(`${app.config.origin}/personal/profile`);
  await sharedPage.getByLabel("기술과 경험", { exact: true }).fill("Mounted private browser fixture");
  await sharedPage.getByRole("button", { name: "조사 조건 저장", exact: true }).click();
  await sharedPage.waitForURL("**/personal/profile?saved=1");
  await sharedPage.goto(`${app.config.origin}/personal/upload?guide=1`);
  assert.match(await sharedPage.locator("#context pre").innerText(), /Mounted private browser fixture/);
  assert.ok((await sharedPage.locator("#instructions pre").innerText()).includes(`${app.config.origin}/personal/upload`));
  await sharedPage.getByRole("link", { name: "HTML 업로드로 돌아가기", exact: true }).click();
  await sharedPage.waitForURL("**/personal/upload");
  assert.equal((await mountedStore.read()).personalAccount.discordId, user);
  const clickItem = { id: "personal-click-fixture", category: "contest", title: "개인 상태 버튼 검증", sourceUrl: "https://example.org/click", benefit: "가상 기회", eligibility: "검증용", deadline: "미정", nextAction: "조건 확인" };
  for (const revision of [1, 2]) {
    if (revision > 1) await sharedPage.goto(`${app.config.origin}/personal/upload`);
    const stateVersion = (await mountedStore.read()).workflowVersion;
    const html = `<html><body><h1>Personal fixture v${revision}</h1><script type="application/json" id="gammaru-opportunities">${JSON.stringify({ version: 1, audience: "personal", stateVersion, opportunities: [clickItem] })}</script></body></html>`;
    await sharedPage.getByLabel("보고서 제목", { exact: true }).fill(`개인 수정본 검증 v${revision}`);
    await sharedPage.getByText("파일 대신 HTML 내용 붙여넣기", { exact: true }).click();
    await sharedPage.getByLabel("HTML 전체 내용", { exact: true }).fill(html);
    if (revision > 1) {
      await sharedPage.getByLabel("이미 발행한 날짜의 수정본으로 재발행", { exact: true }).check();
      await sharedPage.getByLabel("재발행 사유 (수정본일 때 필수)", { exact: true }).fill("개인 조사 조건 변경 반영");
    }
    await sharedPage.getByRole("button", { name: "HTML 미리보기", exact: true }).click();
    await sharedPage.frameLocator("iframe").getByRole("heading", { name: `Personal fixture v${revision}` }).waitFor();
    await sharedPage.getByLabel("내용을 확인했고 보고서 등록에 동의합니다.").check();
    await sharedPage.getByRole("button", { name: revision > 1 ? "이 수정본 재발행하기" : "이 HTML 등록하기", exact: true }).click();
    await sharedPage.getByText(`현재 v${revision}`, { exact: false }).waitFor();
  }
  assert.equal((await mountedStore.read()).reports.length, 1);
  assert.equal((await mountedStore.read()).reports[0].previousVersions.length, 1);
  for (const width of [1440, 390, 320]) {
    await sharedPage.setViewportSize({ width, height: 950 });
    assert.equal(await sharedPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Reissue controls wrap on mobile");
  }
  await sharedPage.screenshot({ path: path.join(output, "personal-reissue-mobile.png"), fullPage: true });
  await sharedPage.goto(`${app.config.origin}/personal/${today}`);
  const clickRow = sharedPage.locator(`#progress-${clickItem.id}`);
  assert.equal(await clickRow.locator('.quick-status input[name="revision"]').inputValue(), "0");
  await mountedStore.setProgress(clickItem.id, { revision: 0, note: "다른 창에서 새로 저장한 메모" }, "admin");
  await clickRow.getByRole("button", { name: "보류", exact: true }).click();
  await clickRow.getByText("현재 상태 · 보류", { exact: true }).waitFor();
  assert.equal((await mountedStore.read()).opportunities[clickItem.id].note, "다른 창에서 새로 저장한 메모");
  await clickRow.getByRole("button", { name: "진행 중", exact: true }).click();
  await clickRow.getByText("현재 상태 · 진행 중", { exact: true }).waitFor();
  assert.equal((await mountedStore.read()).opportunities[clickItem.id].status, "in_progress");
  await sharedPage.getByText("수정 이력 · 현재 v2", { exact: true }).click();
  const oldUrl = await sharedPage.getByRole("link", { name: "이전 v1 원문 보기", exact: true }).getAttribute("href");
  const oldVersion = await sharedPage.request.get(`${app.config.origin}${oldUrl}`);
  assert.match(await oldVersion.text(), /Personal fixture v1/);
  assert.match(oldVersion.headers()["content-security-policy"], /script-src 'none'/);
  const readerContexts = [];
  for (const [index, discordId] of ["100000000000000011", "100000000000000012"].entries()) {
    mountedDiscordId = discordId;
    const context = await browser.newContext({ viewport: { width: 320, height: 950 } }); readerContexts.push(context);
    const reader = await context.newPage();
    await reader.goto(`${app.config.origin}/personal`);
    assert.equal(await reader.locator('input[name="password"]').count(), 0);
    await reader.getByRole("link", { name: "Discord로 로그인 →", exact: true }).click();
    await reader.getByRole("heading", { name: "함께 보는 데일리 스크럼", exact: true }).waitFor();
    assert.equal(await reader.getByRole("link", { name: "내 조사 조건", exact: true }).count(), 0);
    await reader.locator(".archive-row").click();
    assert.doesNotMatch(await reader.locator("body").innerText(), /다른 창에서 새로 저장한 메모|Mounted private browser fixture|첫 번째 독자 메모/);
    const row = reader.locator(`#progress-${clickItem.id}`);
    await row.getByRole("button", { name: index ? "완료" : "보류", exact: true }).click();
    await row.getByText(`현재 상태 · ${index ? "진행 완료" : "보류"}`, { exact: true }).waitFor();
    if (!index) {
      await row.getByText("메모 추가", { exact: true }).click();
      await row.getByLabel("나만 보는 메모", { exact: true }).fill("첫 번째 독자 메모");
      await row.getByRole("button", { name: "메모 저장", exact: true }).click();
    }
    await reader.reload();
    assert.equal(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Shared reader fits 320px");
    await reader.screenshot({ path: path.join(output, `personal-shared-reader-${index}.png`), fullPage: true });
  }
  const sharedState = await mountedStore.read();
  assert.equal(sharedState.memberProgress["100000000000000011"][clickItem.id].note, "첫 번째 독자 메모");
  assert.equal(sharedState.memberProgress["100000000000000012"][clickItem.id].note, "");
  assert.equal(sharedState.opportunities[clickItem.id].status, "in_progress");
  for (const context of readerContexts) await context.close();
  // Start with no cookies or browser storage. Only Discord identity is reused.
  for (const [discordId, expected, note] of [["100000000000000011", "deferred", "첫 번째 독자 메모"], [user, "in_progress", "다른 창에서 새로 저장한 메모"]]) {
    mountedDiscordId = discordId;
    const fresh = await browser.newContext({ viewport: { width: 320, height: 950 } });
    assert.deepEqual(await fresh.storageState(), { cookies: [], origins: [] });
    const reader = await fresh.newPage();
    await reader.goto(`${app.config.origin}/personal`);
    await reader.getByRole("link", { name: "Discord로 로그인 →", exact: true }).click();
    await reader.locator(".archive-row").click();
    const row = reader.locator(`#progress-${clickItem.id}`);
    assert.equal(await row.getAttribute("data-status"), expected);
    assert.equal(await row.locator('textarea[name="note"]').inputValue(), note);
    await reader.getByLabel("진행 기록 계정").getByText("개인 검증 계정 · 내 진행 기록", { exact: true }).waitFor();
    assert.equal(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await reader.screenshot({ path: path.join(output, `personal-account-synced-${expected}.png`), fullPage: true });
    await fresh.close();
  }
  mountedEnv.PERSONAL_DISCORD_REPORT_CHANNEL_ID = "300000000000000002";
  mountedEnv.DISCORD_BOT_TOKEN = "mock-channel-bot";
  await sharedPage.goto(`${app.config.origin}/personal/account`);
  await sharedPage.getByRole("heading", { name: "서버 채널 알림", exact: true }).waitFor();
  assert.equal(await sharedPage.locator('input[name="dm"]').count(), 0);
  assert.equal(await sharedPage.getByRole("button", { name: "확인 DM 보내기", exact: true }).count(), 0);
  assert.equal(await sharedPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await sharedPage.screenshot({ path: path.join(output, "personal-channel-account-mobile.png"), fullPage: true });
  await sharedPage.goto(`${app.config.origin}/personal/upload`);
  await sharedPage.getByText("채널 활성", { exact: false }).waitFor();
  assert.equal(await sharedPage.getByLabel("오늘 보고서의 제목·요약·링크를 Discord 서버 채널에 게시하기", { exact: true }).isChecked(), true);
  await sharedPage.locator('[data-notification-channel-id="300000000000000002"]').waitFor();
  await sharedPage.getByRole("link", { name: "서버·채널 이름 확인", exact: true }).click();
  await sharedPage.getByText("검증용 데일리 스크럼 서버", { exact: true }).waitFor();
  assert.equal(await sharedPage.getByRole("link", { name: "Discord 채널 열기 ↗", exact: true }).getAttribute("href"), "https://discord.com/channels/400000000000000002/300000000000000002");
  for (const width of [320, 390]) {
    await sharedPage.setViewportSize({ width, height: 950 });
    assert.equal(await sharedPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await sharedPage.screenshot({ path: path.join(output, `personal-notification-target-${width}.png`), fullPage: true });
  }
  await sharedContext.close();
  console.log("Browser passed: club workflows, private personal profile, owner settings, reissue history, stale-click safety, Discord-only sharing with two isolated readers and mobile layout. Mock storage/OAuth only; no deployment or real messages.");
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
