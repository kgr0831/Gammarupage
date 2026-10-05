import assert from "node:assert/strict";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { setup, input, identity, date } from "./helpers.mjs";

const app = await setup({ discordApplicationId: "100000000000000099", discordClientSecret: "test-only-client-secret" });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
const output = path.resolve("test-results/portal"); await mkdir(output, { recursive: true });
const errors = [];
try {
  const subscriberContext = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
  const member = app.store.upsertDiscord(identity());
  await subscriberContext.addCookies([{ name: "gammaru", value: app.session("member", member.id).split("=")[1], url: app.config.origin }]);
  const subscriber = await subscriberContext.newPage(); subscriber.on("pageerror", (e) => errors.push(e.message));
  await subscriber.goto(`${app.config.origin}/members`);
  await subscriber.getByLabel("신청자 이름").fill("겜마루 테스트 회원");
  await subscriber.getByLabel("새 보고서 링크를 Discord DM으로 받겠습니다.").check();
  await subscriber.getByRole("button", { name: "구독 승인 요청" }).click();
  await subscriber.getByText("승인 대기", { exact: true }).waitFor();

  const admin = await browser.newPage({ viewport: { width: 1440, height: 1080 } }); admin.on("pageerror", (e) => errors.push(e.message));
  await admin.goto(`${app.config.origin}/admin`);
  await admin.getByLabel("아이디").fill("admin"); await admin.getByLabel("비밀번호").fill(app.config.token);
  await admin.getByRole("button", { name: "로그인", exact: true }).click();
  await admin.getByRole("button", { name: "구독 승인", exact: true }).waitFor();
  await admin.screenshot({ path: path.join(output, "admin-approval.png"), fullPage: true });
  await admin.getByRole("button", { name: "구독 승인", exact: true }).click();
  assert.equal(app.store.member(member.id).status, "approved");

  const publisher = await browser.newPage(); publisher.on("pageerror", (e) => errors.push(e.message));
  await publisher.goto(`${app.config.origin}/publisher`);
  await publisher.getByLabel("등록 키").fill(app.config.publisherToken);
  await publisher.getByRole("button", { name: "로그인", exact: true }).click();
  await publisher.getByLabel("조사 결과 JSON").fill(JSON.stringify(input()));
  await publisher.getByRole("button", { name: "검증하고 HTML 미리보기" }).click();
  await publisher.getByLabel("오늘 공식 원문을 확인했고, 구독자 대상 보고서 발행에 동의합니다.").check();
  await publisher.getByRole("button", { name: "오늘 보고서 발행" }).click();
  await publisher.getByText("오늘 보고서가 이미 발행되었습니다.", { exact: false }).waitFor();
  assert.equal(app.store.deliveries().length, 1);

  await subscriber.goto(`${app.config.origin}/members/reports/${date}`);
  await subscriber.getByRole("heading", { name: "DAILY BRIEF." }).waitFor();
  await subscriber.evaluate(() => document.fonts.ready);
  assert.equal(await subscriber.locator("article.card").count(), 2);
  assert.equal(await subscriber.locator('a[href^="/admin/actions"]').count(), 0);
  await subscriber.screenshot({ path: path.join(output, "report-desktop.png"), fullPage: true });
  await subscriber.setViewportSize({ width: 390, height: 844 });
  await subscriber.screenshot({ path: path.join(output, "report-mobile.png"), fullPage: true });
  assert.equal(await subscriber.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await subscriber.getByRole("link", { name: "보고서", exact: true }).click();
  await subscriber.locator(".archive-row").waitFor();
  await subscriber.screenshot({ path: path.join(output, "archive-mobile.png"), fullPage: true });

  await admin.goto(`${app.config.origin}/admin/actions`);
  await admin.getByRole("textbox", { name: "본문", exact: true }).fill("# 변경된 소개서\n검토 완료된 문서입니다.");
  await admin.getByLabel("저장된 수신자·제목·본문과 원문을 확인했습니다.").check();
  await admin.getByRole("button", { name: "저장된 내용 승인 후 실행" }).click();
  await admin.getByText("수정한 내용을 먼저 저장한 뒤 다시 승인해 주세요.").waitFor();
  assert.equal(app.store.state().actions[0].status, "pending");
  await admin.goto(`${app.config.origin}/admin/actions`);
  await admin.getByRole("textbox", { name: "본문", exact: true }).fill("# 변경된 소개서\n검토 완료된 문서입니다.");
  await admin.getByRole("button", { name: "초안 저장 · 기존 승인 취소" }).click();
  await admin.getByLabel("저장된 수신자·제목·본문과 원문을 확인했습니다.").check();
  await admin.getByRole("button", { name: "저장된 내용 승인 후 실행" }).click();
  await admin.getByRole("link", { name: "완성 문서 다운로드" }).waitFor();
  assert.equal(app.store.state().actions[0].result.document, "# 변경된 소개서\n검토 완료된 문서입니다.");

  await admin.goto(`${app.config.origin}/admin`);
  await admin.getByRole("button", { name: "승인 취소", exact: true }).click();
  const denied = await subscriber.goto(`${app.config.origin}/members/reports/${date}`);
  assert.equal(denied.status(), 403);
  assert.equal(await subscriber.locator("article.card").count(), 0);
  assert.deepEqual(errors, []);
  console.log("Browser passed: subscription request, admin approval, dots publisher preview/publication, private HTML, archive, mobile, immutable action approval, revocation. All data and credentials were ephemeral test fixtures; no Discord/AI/email requests.");
} finally { await browser.close(); await app.close(); }
