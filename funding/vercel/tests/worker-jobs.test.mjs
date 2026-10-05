import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { setup, today } from "./helpers.mjs";
import { digest } from "../../schema.mjs";
import { claimWorkerJob, beginWorkerJob, finishWorkerJob } from "../worker-jobs.mjs";
import { createWorker, workerConfig } from "../../../discord-notifier/worker.mjs";

const channelId = "300000000000000001", memberId = "100000000000000001";
const channel = { id: channelId, guild_id: "400000000000000001", type: 0 };
const messageId = "500000000000000001";
function fixture() {
  return setup({ origin: "https://example.test", discordDeliveryMode: "worker", discordWorkerToken: randomBytes(32).toString("hex"), discordBotToken: "", discordReportChannelId: channelId });
}
const request = (app, operation, input = {}, token = app.config.discordWorkerToken) => app.handler(new Request(`${app.config.origin}/reports/worker/${operation}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(input) }));
const publish = async (app) => app.store.publish(await app.stage(), today, channelId);
function worker(app, discord, site) {
  return createWorker({ origin: app.config.origin, workerToken: app.config.discordWorkerToken, botToken: "isolated-test-bot" }, {
    fetch: (url, options) => url.startsWith(app.config.origin) ? site ? site(url, options) : app.handler(new Request(url, options)) : discord(url, options),
  });
}

test("worker API requires a distinct machine key, not a member session; reports still require user auth", async () => {
  const app = fixture(); await publish(app);
  for (const token of ["", "invalid", app.config.publisherToken]) assert.equal((await request(app, "claim", {}, token)).status, 403);
  const member = await app.session("member", await app.member());
  assert.equal((await app.request("/reports/worker/claim", member, {})).status, 403);
  const response = await request(app, "claim"); assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const { job } = await response.json();
  assert.equal(job.target.channelId, channelId);
  assert.deepEqual(Object.keys(job).sort(), ["expiresAt", "id", "lease", "message", "target"]);
  assert.ok(!JSON.stringify(job).includes(app.config.discordWorkerToken));
  assert.equal((await app.handler(new Request(app.config.origin + "/reports/research-state", { headers: { authorization: `Bearer ${app.config.discordWorkerToken}` } }))).status, 403);
  assert.equal((await request(app, "claim", { oversized: "a".repeat(3000) })).status, 413);
  assert.equal((await request(app, "unknown")).status, 404);
});

test("worker mode queues publish, login and approval without running Discord requests in Vercel", async () => {
  const app = fixture(), publisher = await app.session("publisher");
  const draft = await app.stage(digest(publisher.split("=")[1]));
  assert.equal((await app.request("/reports/upload/publish", publisher, { draft: draft.id, confirmed: "yes" })).status, 303);
  await app.member(memberId, "pending");
  await app.request(`/reports/admin/${memberId}/approve`, await app.session("admin"), {});
  assert.equal(app.work.length, 0);
  assert.equal((await app.store.read()).members[memberId].approval_notice.status, "pending");
  assert.match(await (await app.request("/reports/upload", publisher)).text(), /채널 활성/);
  const oauth = setup({ ...app.config }, { fetch: async (url) => url.endsWith("/token") ? Response.json({ access_token: "test", token_type: "Bearer" }) : Response.json({ id: memberId, username: "member", avatar: null }) });
  const start = await oauth.request("/reports/auth/discord");
  const state = new URL(start.headers.get("location")).searchParams.get("state");
  await oauth.request(`/reports/auth/callback?state=${state}&code=test`, start.headers.getSetCookie()[0].split(";")[0]);
  assert.equal(oauth.work.length, 0);
  assert.equal((await oauth.store.read()).members[memberId].login_notice.status, "pending");
});

test("multiple Dishost workers claim atomically, send once, and restart without reposting", async () => {
  const app = fixture(); await publish(app); let sent = 0;
  const discord = async (url, options) => { if (options.method === "POST") sent++; return Response.json(options.method === "GET" ? channel : { id: messageId }); };
  const results = await Promise.all([worker(app, discord).runOne(), worker(app, discord).runOne()]);
  assert.deepEqual(results.sort(), ["sent", null].sort()); assert.equal(sent, 1);
  assert.equal(await worker(app, discord).runOne(), null);
  const deliveries = Object.values((await app.store.read()).deliveries);
  assert.equal(deliveries[0].status, "sent"); assert.equal(deliveries[0].reference, messageId);
});

test("approval revocation while opening a DM cancels before the message is sent", async () => {
  const app = fixture(); await app.member(memberId, "pending");
  await app.request(`/reports/admin/${memberId}/approve`, await app.session("admin"), {});
  let calls = 0;
  const bot = worker(app, async (url) => {
    calls++; assert.ok(url.endsWith("/users/@me/channels"));
    await app.store.update((state) => { state.members[memberId].status = "revoked"; });
    return Response.json({ id: channelId });
  });
  assert.equal(await bot.runOne(), "cancelled"); assert.equal(calls, 1);
  assert.equal((await app.store.read()).members[memberId].approval_notice.status, "cancelled");
});

test("rate limits defer jobs and block immediate retries across worker restarts", async () => {
  const app = fixture(); await publish(app);
  const bot = worker(app, async () => Response.json({ retry_after: 120 }, { status: 429 }));
  assert.equal(await bot.runOne(), "rate_limited");
  const state = await app.store.read();
  assert.equal(Object.values(state.deliveries)[0].status, "pending");
  assert.ok(state.workerRetryAt > Date.now() + 119000);
  assert.equal(await worker(app, () => assert.fail("Must wait for the rate limit")).runOne(), null);
});

test("expired unstarted leases are recoverable but started or uncertain sends never automatically repeat", async () => {
  const app = fixture(); await publish(app);
  const old = await claimWorkerJob(app.store, app.config);
  const later = Date.now() + 301000;
  const replacement = await claimWorkerJob(app.store, app.config, later);
  assert.notEqual(replacement.lease, old.lease);
  await assert.rejects(beginWorkerJob(app.store, app.config, old, later), { status: 409 });
  assert.equal(await beginWorkerJob(app.store, app.config, replacement, later), true);
  await assert.rejects(beginWorkerJob(app.store, app.config, replacement, later), { status: 409 });
  assert.equal(await claimWorkerJob(app.store, app.config, later + 301000), null);
  assert.equal(Object.values((await app.store.read()).deliveries)[0].status, "uncertain");
});

test("lost begin response prevents Discord POST; lost Discord response persists uncertain", async () => {
  for (const at of ["begin", "discord"]) {
    const app = fixture(); await publish(app); let posts = 0;
    const bot = worker(app, async (url, options) => {
      if (options.method === "POST") { posts++; throw new Error("Lost Discord response"); }
      return Response.json(channel);
    }, async (url, options) => {
      const response = await app.handler(new Request(url, options));
      if (at === "begin" && url.endsWith("/begin")) throw new Error("Lost begin response");
      return response;
    });
    if (at === "begin") await assert.rejects(bot.runOne()); else assert.equal(await bot.runOne(), "uncertain");
    assert.equal(posts, at === "begin" ? 0 : 1);
    assert.equal(await worker(app, () => assert.fail("No duplicate send")).runOne(), null);
  }
});

test("idle polling does not write Blob and direct mode cannot be consumed by a remote worker", async () => {
  const app = fixture();
  const before = app.files.sequence;
  assert.equal(await claimWorkerJob(app.store, app.config), null);
  assert.equal(app.files.sequence, before);
  app.config.discordDeliveryMode = "direct";
  assert.equal((await request(app, "claim")).status, 409);
  assert.equal((await (await request(app, "status")).json()).ready, false);
});

test("a lost finish acknowledgement cannot resend a successfully recorded message", async () => {
  const app = fixture(); await publish(app); let posts = 0;
  const bot = worker(app, async (url, options) => {
    if (options.method === "POST") posts++;
    return Response.json(options.method === "GET" ? channel : { id: messageId });
  }, async (url, options) => {
    const response = await app.handler(new Request(url, options));
    if (url.endsWith("/finish")) throw new Error("Lost acknowledgement");
    return response;
  });
  await assert.rejects(bot.runOne());
  assert.equal(Object.values((await app.store.read()).deliveries)[0].status, "sent");
  assert.equal(await bot.runOne(), null); assert.equal(posts, 1);
});

test("old direct-mode login claims become uncertain instead of being resent on cutover", async () => {
  const app = fixture(); await app.member();
  await app.store.update((state) => { state.members[memberId].login_notice = { id: "a".repeat(32), status: "sending", createdAt: Date.now() - 301000 }; });
  assert.equal(await claimWorkerJob(app.store, app.config), null);
  assert.equal((await app.store.read()).members[memberId].login_notice.status, "uncertain");
});

test("connection check sends no messages and rejects leaking credentials through unsafe site URLs", async () => {
  const env = { DISCORD_TOKEN: "test-bot", DISCORD_WORKER_TOKEN: "w".repeat(32) };
  assert.equal(workerConfig(env).botToken, "test-bot");
  for (const url of ["http://example.org", "https://user:secret@example.org", "https://example.org/path", "https://example.org/?token=test"]) assert.throws(() => workerConfig({ ...env, REPORTS_SITE_URL: url }));
  const app = fixture(); let calls = 0;
  const bot = worker(app, async (url, options) => { calls++; assert.equal(options.method, "GET"); assert.ok(url.endsWith("/users/@me")); return Response.json({ id: memberId, bot: true }); });
  assert.equal((await bot.checkConnection()).ready, true); assert.equal(calls, 1);
  await publish(app); const claim = await claimWorkerJob(app.store, app.config);
  await assert.rejects(finishWorkerJob(app.store, { ...claim, status: "sent", reference: messageId }), /confirmation/);
});
