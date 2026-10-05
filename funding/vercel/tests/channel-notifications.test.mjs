import test from "node:test";
import assert from "node:assert/strict";
import { setup, today } from "./helpers.mjs";
import { deliverBriefLinks } from "../notify.mjs";
import { BriefStore } from "../storage.mjs";
import { digest } from "../../schema.mjs";

const channelId = "300000000000000001", guildId = "400000000000000001";
const channel = { id: channelId, guild_id: guildId, type: 0 };
const message = { id: "500000000000000001" };

test("a channel report queues one summary regardless of member count and concurrent workers post it once", async () => {
  const app = setup({ discordReportChannelId: channelId, dmEnabled: true });
  await app.member(); await app.member("100000000000000002", "approved", false);
  await app.member("100000000000000003", "pending", true);
  const draft = await app.stage();
  await app.store.publish(draft, today, channelId);
  await app.store.publish(draft, today, channelId);
  assert.equal(Object.values((await app.store.read()).deliveries).length, 1);
  const calls = [];
  const fake = async (url, options) => { calls.push({ url, options }); return Response.json(options.method === "GET" ? channel : message); };
  await Promise.all([deliverBriefLinks(app.store, app.config, fake), deliverBriefLinks(new BriefStore(app.files), app.config, fake)]);
  assert.deepEqual(calls.map((c) => c.url), [`https://discord.com/api/v10/channels/${channelId}`, `https://discord.com/api/v10/channels/${channelId}/messages`]);
  const body = JSON.parse(calls[1].options.body);
  assert.ok(body.content.includes(draft.summary)); assert.ok(body.content.includes(draft.title));
  assert.ok(body.content.endsWith(`${app.config.origin}/reports/${today}`));
  assert.deepEqual(body.allowed_mentions, { parse: [] }); assert.equal(body.enforce_nonce, true);
  assert.equal(Object.values((await app.store.read()).deliveries)[0].status, "sent");
});

test("switching to a channel cancels pending DMs and permits an explicit one-time post of today's existing report", async () => {
  const app = setup({ dmEnabled: true }); await app.member();
  await app.store.publish(await app.stage(), today);
  app.config.discordReportChannelId = channelId;
  await app.store.queueChannelReport(today, channelId);
  let posts = 0;
  await deliverBriefLinks(app.store, app.config, async (url, options) => {
    assert.ok(!url.includes("/users/@me/channels"));
    if (options.method === "POST") posts++;
    return Response.json(options.method === "GET" ? channel : message);
  });
  const rows = Object.values((await app.store.read()).deliveries);
  assert.equal(rows.find((d) => d.memberId).status, "cancelled");
  assert.equal(rows.find((d) => d.channelId).status, "sent");
  await app.store.queueChannelReport(today, channelId);
  await deliverBriefLinks(app.store, app.config, async () => { throw Error("Must not resend"); });
  assert.equal(posts, 1);
});

test("channel publication respects notify opt-out and historical dates; missing or invalid targets cannot become DMs", async () => {
  const app = setup({ dmEnabled: true, discordReportChannelId: channelId }); await app.member();
  await app.store.publish({ ...await app.stage(), notify: false }, today, channelId);
  await app.store.publish(await app.stage("past", "2020-01-01"), today, channelId);
  assert.equal(Object.values((await app.store.read()).deliveries).length, 0);
  await assert.rejects(app.store.queueChannelReport("2020-01-02", channelId), /오늘 등록된 보고서/);
  await assert.rejects(app.store.queueChannelReport(today, "invalid"), /채널 설정/);
  app.config.discordReportChannelId = "invalid";
  await deliverBriefLinks(app.store, app.config, async () => { assert.fail("No fallback DM"); });
});

test("a non-server text channel or missing send permissions stops channel delivery without DM fallback", async () => {
  for (const response of [() => Response.json({ ...channel, type: 1 }), () => Response.json({ ...channel, type: 15 }), () => Response.json({}, { status: 403 })]) {
    const app = setup({ discordReportChannelId: channelId });
    await app.store.publish(await app.stage(), today, channelId);
    let calls = 0;
    await deliverBriefLinks(app.store, app.config, async (url, options) => { calls++; assert.equal(options.method, "GET"); assert.ok(url.endsWith(channelId)); return response(); });
    assert.equal(calls, 1);
    assert.ok(["failed", "blocked"].includes(Object.values((await app.store.read()).deliveries)[0].status));
  }
});

test("channel rate limits persist and uncertain post outcomes cannot be retried into duplicates", async () => {
  const app = setup({ discordReportChannelId: channelId });
  await app.store.publish(await app.stage(), today, channelId);
  await deliverBriefLinks(app.store, app.config, async () => Response.json({ retry_after: 60 }, { status: 429 }));
  let row = Object.values((await app.store.read()).deliveries)[0];
  assert.equal(row.status, "pending"); assert.ok(row.retryAt > Date.now());
  await app.store.update((s) => { Object.values(s.deliveries)[0].retryAt = 0; });
  await deliverBriefLinks(app.store, app.config, async (url, options) => {
    if (options.method === "POST") throw Error("Response lost");
    return Response.json(channel);
  });
  await app.store.queueChannelReport(today, channelId);
  await deliverBriefLinks(app.store, app.config, async () => { assert.fail("Unknown result must not resend"); });
  row = Object.values((await app.store.read()).deliveries)[0]; assert.equal(row.status, "uncertain");
});

test("channel UI and publish route retain member access control and require publisher authority for channel posting", async () => {
  const app = setup({ discordReportChannelId: channelId });
  const publisher = await app.session("publisher"), id = await app.member(), member = await app.session("member", id);
  // The real publish handler must pass the configured channel through to storage.
  const staged = await app.stage(digest(publisher.split("=")[1]));
  assert.equal((await app.request("/reports/upload/publish", publisher, { draft: staged.id, confirmed: "yes" })).status, 303);
  assert.equal(Object.values((await app.store.read()).deliveries)[0].channelId, channelId);
  assert.equal((await app.request("/reports/notify", member, {})).status, 403);
  assert.equal((await app.request("/reports/notify", publisher, {}, "https://other.example")).status, 403);
  assert.equal((await app.request("/reports/notify", publisher, {})).status, 303);
  assert.equal(Object.values((await app.store.read()).deliveries).length, 1);
  const upload = await (await app.request("/reports/upload", publisher)).text();
  assert.match(upload, /채널 활성/); assert.match(upload, /오늘 보고서 채널 게시·대기 처리/);
  const account = await (await app.request("/reports/account", member)).text();
  assert.match(account, /Discord 서버 채널에 게시/); assert.doesNotMatch(account, /name="dm"/);
  assert.equal((await app.request("/reports/subscription", member, { name: "검증 회원" })).status, 303);
  assert.equal((await app.store.read()).members[id].dm_opt_in, true, "Hidden legacy preference is preserved");
  assert.equal((await app.request(`/reports/${today}/html`, member)).status, 200);
  assert.doesNotMatch(await (await app.request(`/reports/${today}/html`)).text(), /가상 보고서 · 실제 공고 아님/);
});
