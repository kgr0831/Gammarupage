import test from "node:test";
import assert from "node:assert/strict";
import { setup, sampleHtml, today } from "./helpers.mjs";
import { researchState } from "../opportunities.mjs";

const channel = "300000000000000001";
const item = { id: "club-support", title: "Club support", sourceUrl: "https://example.org/support", benefit: "Support", eligibility: "Club", deadline: "Verify", nextAction: "Read conditions", changeNote: "" };
const document = stateVersion => `<html><body><h1>Test</h1><script type="application/json" id="gammaru-opportunities">${JSON.stringify({ version: 1, audience: "club", stateVersion, opportunities: [item] })}</script></body></html>`;
const form = html => {
  const data = new FormData();
  data.set("date", today); data.set("title", "Test"); data.set("summary", "Test");
  data.set("htmlText", html); data.set("notify", "yes"); return data;
};

test("pasted club HTML uses the same preview, sandbox, publication and duplicate protection as files", async () => {
  const app = setup({ discordReportChannelId: channel }), cookie = await app.session("publisher");
  const html = document(0);
  const data = form(html);
  data.set("html", new File([], "", { type: "application/octet-stream" }));
  const preview = await app.request("/reports/upload/preview", cookie, data);
  assert.equal(preview.status, 200);
  const id = (await preview.text()).match(/name="draft" value="([a-f0-9-]+)"/)[1];
  const raw = await app.request(`/reports/upload/preview/${id}/html`, cookie);
  assert.equal(await raw.text(), html);
  assert.match(raw.headers.get("content-security-policy"), /script-src 'none'/);
  assert.equal((await app.store.read()).reports.length, 0);
  assert.equal((await app.request("/reports/upload/publish", cookie, { draft: id, confirmed: "yes" })).status, 303);
  assert.equal((await app.request("/reports/upload/publish", cookie, { draft: id, confirmed: "yes" })).status, 303);
  const state = await app.store.read();
  assert.equal(state.reports.length, 1);
  assert.equal(Object.values(state.deliveries).length, 1);
  assert.equal(Object.values(state.deliveries)[0].channelId, channel);
  const upload = await (await app.request("/reports/upload", cookie)).text();
  assert.match(upload, /이 날짜는 이미 발행되었습니다/);
  assert.match(upload, /data-delivery-status="pending"><dt>대기<\/dt><dd>1건/);
});

test("ambiguous, missing, oversized or stale pasted content is rejected before staging", async () => {
  const app = setup(), cookie = await app.session("publisher"), before = app.files.rows.size;
  const both = form(sampleHtml); both.set("html", new File([sampleHtml], "test.html"));
  assert.equal((await app.request("/reports/upload/preview", cookie, both)).status, 400);
  assert.equal((await app.request("/reports/upload/preview", cookie, form(" "))).status, 400);
  assert.equal((await app.request("/reports/upload/preview", cookie, form("<html><body>" + "a".repeat(2100000) + "</body></html>"))).status, 413);
  const stale = await app.request("/reports/upload/preview", cookie, form(document(999)));
  assert.equal(stale.status, 409);
  assert.match(await stale.text(), /최신 조사 자료 확인/);
  assert.equal(app.files.rows.size, before);
  assert.equal((await app.request("/reports/upload/preview", cookie, form(document(0)), "https://wrong.example")).status, 403);
  assert.equal((await app.request("/reports/upload/preview", "", form(document(0)))).status, 403);
});

test("publisher sees actual delivery outcomes without member details; zero pending is not success", async () => {
  const app = setup({ discordReportChannelId: channel }), cookie = await app.session("publisher");
  await app.store.publish(await app.stage(), today, channel);
  for (const status of ["pending", "sending", "sent", "blocked", "failed", "uncertain", "cancelled"]) {
    await app.store.update(s => {
      Object.values(s.deliveries)[0].status = status;
      s.deliveries.other = { date: today, channelId: "300000000000000002", status: "sent" };
      s.deliveries.private = { date: today, memberId: "100000000000000999", status: "sent" };
    });
    const html = await (await app.request("/reports/upload", cookie)).text();
    assert.match(html, new RegExp(`data-delivery-status="${status}"><dt>[^<]+</dt><dd>1건`));
    if (status !== "sent") assert.match(html, /data-delivery-status="sent"><dt>전송 완료<\/dt><dd>0건/);
    assert.doesNotMatch(html, /100000000000000999|300000000000000002/);
  }
  await app.store.update(s => { s.deliveries = {}; });
  const empty = await (await app.request("/reports/upload", cookie)).text();
  assert.match(empty, /알림 기록이 없습니다/);
  assert.doesNotMatch(empty, /<dd>1건/);
});

test("club archive and progress keep support items visible and omit personal categories", async () => {
  const app = setup();
  await app.store.publish(await app.stage("publisher", today, document(0)), today);
  const member = await app.session("member", await app.member());
  for (const url of ["/reports", "/reports/progress"]) {
    const html = await (await app.request(url, member)).text();
    assert.doesNotMatch(html, /공모전·시장 정보·채용|매매 주문/);
  }
  const progress = await (await app.request("/reports/progress", member)).text();
  assert.match(progress, /겜마루 지원 정보 진행 현황/);
  assert.match(progress, /id="progress-club-support"/);
  assert.doesNotMatch(progress, /기존 동아리 정보|category-contest|class="full-report"/);
  assert.deepEqual(Object.keys(researchState(await app.store.read()).categories), ["support"]);
});
