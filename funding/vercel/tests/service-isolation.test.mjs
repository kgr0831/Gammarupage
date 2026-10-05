import test from "node:test";
import assert from "node:assert/strict";
import { BriefStore } from "../storage.mjs";
import { createBriefHandler } from "../handler.mjs";
import { MemoryFiles, setup, today, sampleHtml } from "./helpers.mjs";

const owner = "100000000000000001";
const personalHtml = '<html><body><h1>Private test</h1><script type="application/json" id="gammaru-opportunities">{"version":1,"audience":"personal","stateVersion":0,"opportunities":[]}</script></body></html>';

test("club and personal archives, sessions, drafts and dates stay independent even on a shared backing store", async () => {
  const app = setup(), files = new MemoryFiles();
  const club = new BriefStore(files), personal = new BriefStore(files, "personal/briefs");
  const input = { date: today, title: "Test", summary: "Test", notify: false };
  const clubDraft = await club.stage({ ...input, html: sampleHtml }, "publisher", today);
  const personalDraft = await personal.stage({ ...input, html: personalHtml }, "publisher", today);
  await club.publish(clubDraft, today);
  await personal.publish(personalDraft, today, "", owner);
  assert.equal((await club.read()).reports.length, 1);
  assert.equal((await personal.read()).reports.length, 1);
  await assert.rejects(personal.draft(clubDraft.id, "publisher"), { status: 404 });
  await assert.rejects(club.draft(personalDraft.id, "publisher"), { status: 404 });
  await assert.rejects(club.html((await personal.read()).reports[0]), { status: 403 });
  const cookie = await app.session("publisher");
  const { sessions } = await app.store.read();
  await club.update(s => { s.sessions = sessions; s.opportunities.clubOnly = { note: "Club review" }; });
  const handle = createBriefHandler({ config: { ...app.config, personalOwnerId: owner }, store: personal });
  assert.equal((await handle(new Request(app.config.origin + "/reports/research-state", { headers: { cookie } }))).status, 403);
  assert.deepEqual((await personal.read()).opportunities, {});
  assert.equal((await personal.read()).workflowVersion, 1);
  assert.equal((await club.read()).workflowVersion, 0);
});

test("club publishing accepts existing club drafts without personal fields and rejects personal drafts before writing HTML", async () => {
  const app = setup({ discordReportChannelId: "300000000000000001" });
  const clubDraft = await app.stage();
  await app.store.publish(clubDraft, today, app.config.discordReportChannelId);
  assert.equal(Object.values((await app.store.read()).deliveries)[0].channelId, app.config.discordReportChannelId);
  const wrong = await app.stage("publisher", today, personalHtml);
  const before = app.files.rows.size;
  await assert.rejects(app.store.publish(wrong, today), { status: 409 });
  assert.equal(app.files.rows.size, before);
  const form = new FormData();
  form.set("date", today); form.set("title", "Private"); form.set("summary", "Private");
  form.set("html", new Blob([personalHtml], { type: "text/html" }), "private.html");
  assert.equal((await app.request("/reports/upload/preview", await app.session("publisher"), form)).status, 400);
});

test("each service serves its own complete guide and personal guide uses its own deployment origin", async () => {
  const club = setup(), personal = setup({ personalOwnerId: owner, origin: "https://personal.example.org" });
  const clubCookie = await club.session("publisher"), personalCookie = await personal.session("publisher");
  const clubGuide = await (await club.request("/reports/upload?guide=1", clubCookie)).text();
  const personalGuide = await (await personal.request("/reports/upload?guide=1", personalCookie)).text();
  assert.match(clubGuide, /동아리가 직접 확보할 운영비/);
  assert.match(clubGuide, /문서 버전: 3/);
  assert.doesNotMatch(clubGuide, /동아리 운영자금 조사는 종료/);
  assert.match(personalGuide, /개발·AI·IT 공모전/);
  assert.match(personalGuide, /동아리 작업과 별도로/);
  assert.match(personalGuide, /문서 버전: 4/);
  assert.match(personalGuide, /https:\/\/personal.example.org\/reports\/upload/);
  assert.doesNotMatch(personalGuide, /https:\/\/gammarupage.vercel.app|\{\{REPORTS_SITE_URL\}\}/);
  for (const part of ["instructions", "design", "context"]) {
    const a = await (await club.request(`/reports/${part}`, clubCookie)).text();
    const b = await (await personal.request(`/reports/${part}`, personalCookie)).text();
    assert.notEqual(a, b);
  }
});
