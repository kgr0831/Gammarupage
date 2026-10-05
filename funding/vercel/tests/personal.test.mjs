import test from "node:test";
import assert from "node:assert/strict";
import { setup, today, sampleHtml } from "./helpers.mjs";
import { briefConfig } from "../config.mjs";
import { claimWorkerJob, beginWorkerJob, finishWorkerJob } from "../worker-jobs.mjs";
import { deliverBriefLinks } from "../notify.mjs";
import { validateManifest, researchState } from "../opportunities.mjs";
import { digest } from "../../schema.mjs";

const owner = "100000000000000001", other = "100000000000000002", channel = "300000000000000001";
const item = (category = "contest") => ({ id: `personal-${category}`, category, title: `Test ${category}`, sourceUrl: `https://example.org/${category}`, benefit: "Test summary", eligibility: "Requirements unconfirmed", deadline: "Unconfirmed", nextAction: "Read the official source", changeNote: "" });
const html = (stateVersion = 0) => `<html><body><h1>Personal test</h1><script type="application/json" id="gammaru-opportunities">${JSON.stringify({ version: 1, audience: "personal", stateVersion, opportunities: [item(), item("trading"), item("job")] })}</script></body></html>`;
const fixture = () => setup({ personalOwnerId: owner, discordReportChannelId: channel, dmEnabled: true, discordDeliveryMode: "worker", discordWorkerToken: "a".repeat(64) });
async function publish(app, stateVersion = 0) {
  await app.member(owner); await app.member(other);
  const cookie = await app.session("publisher");
  const draft = await app.stage(digest(cookie.split("=")[1]), today, html(stateVersion));
  const response = await app.request("/reports/upload/publish", cookie, { draft: draft.id, confirmed: "yes" });
  assert.equal(response.status, 303);
  return cookie;
}

test("personal config fails closed for malformed IDs and disables the existing channel target", () => {
  const request = new Request("https://example.org/reports");
  const env = { REPORTS_SITE_URL: "https://example.org", REPORTS_PERSONAL_OWNER_ID: owner, DISCORD_REPORT_CHANNEL_ID: channel };
  assert.equal(briefConfig(request, env).discordReportChannelId, "");
  assert.throws(() => briefConfig(request, { ...env, REPORTS_PERSONAL_OWNER_ID: "invalid" }));
});

test("previously approved subscribers cannot read personal HTML, mutate progress, or request notices", async () => {
  const app = fixture(), publisher = await publish(app);
  const own = await app.session("member", owner), stranger = await app.session("member", other), admin = await app.session("admin");
  for (const path of [`/reports/${today}`, `/reports/${today}/html`, `/reports/${today}/html?reading=1`, "/reports/progress", "/reports/account"]) {
    assert.equal((await app.request(path, stranger)).status, 403);
    assert.equal((await app.request(path, own)).status, 200);
  }
  assert.equal((await app.request(`/reports/${today}`, admin)).status, 200);
  assert.equal((await app.request(`/reports/${today}`, publisher)).status, 403);
  assert.equal((await app.request("/reports/account/confirmation", stranger, {})).status, 403);
  assert.equal((await app.request(`/reports/admin/${other}/notify`, admin, {})).status, 403);
  assert.equal((await (await app.request("/reports/session", stranger)).json()).canRead, false);
  assert.equal((await (await app.request("/reports/session", own)).json()).canRead, true);
  const update = { status: "deferred", revision: "0", note: "Review later" };
  assert.equal((await app.request("/reports/opportunities/personal-contest/status", stranger, update)).status, 403);
  assert.equal((await app.request("/reports/opportunities/personal-contest/status", own, update)).status, 303);
  const guide = await (await app.request("/reports/upload?guide=1", publisher)).text();
  assert.match(guide, /개발·AI·IT/);
  assert.match(guide, /Review later/);
  assert.ok(!guide.includes(owner) && !guide.includes(other));
});

test("personal publishing queues only the opted-in owner and rejects earlier club drafts", async () => {
  const app = fixture(), publisher = await publish(app);
  const state = await app.store.read();
  assert.equal(state.reports[0].audience, "personal");
  assert.deepEqual(Object.values(state.deliveries).map(row => row.memberId), [owner]);
  assert.equal(Object.values(state.deliveries)[0].channelId, undefined);
  const upload = await (await app.request("/reports/upload", publisher)).text();
  assert.match(upload, /DM 활성/);
  assert.doesNotMatch(upload, /서버 채널에 게시하기/);
  const app2 = fixture(), cookie = await app2.session("publisher");
  const old = await app2.stage(digest(cookie.split("=")[1]), today, sampleHtml);
  assert.equal((await app2.request("/reports/upload/publish", cookie, { draft: old.id, confirmed: "yes" })).status, 409);
  assert.equal((await app2.store.read()).reports.length, 0);
  await app.store.update(s => { s.members[owner].dm_opt_in = false; });
  assert.equal(await claimWorkerJob(app.store, app.config), null);
});

test("worker cancels old channel/member queues and only sends the personal owner summary", async () => {
  const app = fixture(); await publish(app);
  await app.store.update(s => {
    s.deliveries.badMember = { date: today, memberId: other, status: "pending", retryAt: 0 };
    s.deliveries.badChannel = { date: today, channelId: channel, status: "pending", retryAt: 0 };
    s.members[other].login_notice = { id: "old-notice", createdAt: Date.now(), status: "pending" };
  });
  const job = await claimWorkerJob(app.store, app.config);
  assert.deepEqual(job.target, { memberId: owner });
  assert.match(job.message.content, /개인 데일리 브리핑/);
  assert.equal(await beginWorkerJob(app.store, app.config, job), true);
  await finishWorkerJob(app.store, { ...job, status: "sent", reference: "500000000000000001" });
  assert.equal(await claimWorkerJob(app.store, app.config), null);
  const state = await app.store.read();
  assert.equal(state.deliveries.badMember.status, "cancelled");
  assert.equal(state.deliveries.badChannel.status, "cancelled");
  assert.equal(state.members[other].login_notice.status, "cancelled");
});

test("personal owner and approval are checked again immediately before a worker send", async () => {
  const app = fixture(); await publish(app);
  const job = await claimWorkerJob(app.store, app.config);
  app.config.personalOwnerId = other;
  assert.equal(await beginWorkerJob(app.store, app.config, job), false);
});

test("direct transport also honors owner restriction with a stale configured channel", async () => {
  const app = fixture(); await publish(app);
  app.config.discordDeliveryMode = "direct";
  const requests = [];
  await deliverBriefLinks(app.store, app.config, async (url, options) => {
    const body = JSON.parse(options.body); requests.push({ url, body });
    return Response.json({ id: url.endsWith("/users/@me/channels") ? channel : "500000000000000001" });
  });
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].body, { recipient_id: owner });
  assert.match(requests[1].body.content, /個人|개인/);
});

test("personal categories round-trip; legacy club items stay stored but leave the carry-forward list", async () => {
  const app = fixture(); await publish(app);
  await app.store.update(s => { s.opportunities.legacy = { ...item(), id: "legacy", category: "support", status: "deferred", note: "Club archive", lastReported: "2026-10-01", history: [{ actor: "private" }] }; });
  const feed = researchState(await app.store.read(), true);
  assert.deepEqual(feed.legacyIds, ["legacy"]);
  assert.ok(!feed.carryForwardIds.includes("legacy"));
  assert.equal(feed.known.find(i => i.id === "legacy").note, "Club archive");
  assert.equal(feed.known.find(i => i.id === "legacy").history, undefined);
  assert.deepEqual(feed.known.filter(i => i.id !== "legacy").map(i => i.category).sort(), ["contest", "job", "trading"]);
  for (const category of ["invalid", "support", undefined]) assert.throws(() => validateManifest({ version: 1, stateVersion: 0, audience: "personal", opportunities: [{ ...item(), category }] }));
});

test("OAuth rejects other accounts before creating a member, session, or login notice", async () => {
  const app = setup({ personalOwnerId: owner }, { fetch: async url => String(url).endsWith("token") ? Response.json({ access_token: "test-token", token_type: "Bearer" }) : Response.json({ id: other, username: "another-account", bot: false }) });
  const start = await app.request("/reports/auth/discord");
  const state = new URL(start.headers.get("location")).searchParams.get("state");
  const result = await app.request(`/reports/auth/callback?state=${state}&code=test`, start.headers.getSetCookie()[0].split(";")[0]);
  assert.equal(result.status, 403);
  assert.equal(Object.keys((await app.store.read()).members).length, 0);
  assert.equal(Object.keys((await app.store.read()).sessions).length, 0);
});
