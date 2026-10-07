import test from "node:test";
import assert from "node:assert/strict";
import { setup, today, sampleHtml } from "./helpers.mjs";
import { notificationTarget } from "../notification-target.mjs";

const channelId = "300000000000000002", guildId = "400000000000000002";

test("configured target is visible without a Discord lookup in upload, guide and preview", async () => {
  const app = setup({ discordReportChannelId: channelId }, { fetch: async () => assert.fail("Ordinary pages must not call Discord") });
  const publisher = await app.session("publisher");
  for (const pathname of ["/reports/upload", "/reports/upload?guide=1"]) {
    const response = await app.request(pathname, publisher);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes(`data-notification-channel-id="${channelId}"`));
    assert.match(html, /서버·채널 이름 확인/);
  }
  const preview = await app.request("/reports/upload/preview", publisher, { date: today, title: "Target check", htmlText: sampleHtml, notify: "yes" });
  assert.equal(preview.status, 200);
  assert.ok((await preview.text()).includes(`data-notification-channel-id="${channelId}"`));
  assert.deepEqual((await app.store.read()).reports, []);
  assert.deepEqual((await app.store.read()).deliveries, {});
});

test("authorized name lookup displays escaped server/channel names and makes only read requests", async () => {
  const calls = [];
  const app = setup({ discordReportChannelId: channelId }, { fetch: async (url, options) => {
    calls.push(url);
    assert.equal(options.method, "GET"); assert.equal(options.redirect, "error"); assert.equal(options.cache, "no-store");
    assert.equal(options.headers.authorization, `Bot ${app.config.discordBotToken}`);
    assert.ok(options.signal instanceof AbortSignal);
    if (url.endsWith(`/channels/${channelId}`)) return Response.json({ id: channelId, guild_id: guildId, type: 0, name: '<script>channel</script>' });
    assert.ok(url.endsWith(`/guilds/${guildId}`));
    return Response.json({ id: guildId, name: 'Server <name>' });
  } });
  const publisher = await app.session("publisher");
  const before = await app.store.read();
  for (const pathname of ["/reports/upload?destination=1", "/reports/upload?guide=1&destination=1"]) {
    const response = await app.request(pathname, publisher), html = await response.text();
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.ok(html.includes(`https://discord.com/channels/${guildId}/${channelId}`));
    assert.match(html, /Server &lt;name&gt;/); assert.match(html, /&lt;script&gt;channel&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>channel|test-only-bot/);
  }
  assert.equal(calls.length, 4);
  assert.deepEqual(await app.store.read(), before);
  assert.equal(app.work.length, 0);
});

test("guests and readers cannot request private notification metadata", async () => {
  const app = setup({ discordReportChannelId: channelId }, { fetch: async () => assert.fail("Unauthorized lookup") });
  for (const cookie of ["", await app.session("member", await app.member())]) {
    for (const pathname of ["/reports/upload?destination=1", "/reports/upload?guide=1&destination=1"]) {
      const response = await app.request(pathname, cookie);
      assert.equal(response.status, 303);
      assert.equal(response.headers.get("location"), "/reports/login/publisher");
      assert.equal(await response.text(), "");
    }
  }
});

test("lookup failures preserve the configured ID without inventing a target or leaking responses", async () => {
  const config = { discordReportChannelId: channelId, discordBotToken: "fixture-secret" };
  for (const fetcher of [async () => { throw Error("fixture-secret"); }, async () => Response.json({ error: "fixture-secret" }, { status: 403 })]) {
    const target = await notificationTarget(config, true, { lookup: true, fetcher });
    assert.deepEqual(target, { channelId, enabled: true, lookup: "unavailable" });
  }
  for (const channel of [{ id: "300000000000000003", guild_id: guildId, type: 0 }, { id: channelId, type: 1 }, { id: channelId, guild_id: "../escape", type: 0 }]) {
    const target = await notificationTarget(config, true, { lookup: true, fetcher: async () => Response.json(channel) });
    assert.deepEqual(target, { channelId, enabled: true, lookup: "invalid" });
  }
  const target = await notificationTarget(config, true, { lookup: true, fetcher: async url => url.endsWith(`/channels/${channelId}`)
    ? Response.json({ id: channelId, guild_id: guildId, type: 5, name: "announcements" }) : Response.json({}, { status: 403 }) });
  assert.equal(target.guildId, guildId); assert.equal(target.channelName, "announcements"); assert.equal(target.guildName, undefined);
  assert.equal(target.url, `https://discord.com/channels/${guildId}/${channelId}`);
});

test("personal destination never inherits the club channel and malformed IDs are never fetched", async () => {
  const base = { service: "personal", discordReportChannelId: "300000000000000001", discordBotToken: "fixture-secret" };
  const fetcher = async () => assert.fail("Must not fetch absent or malformed channel");
  assert.equal(await notificationTarget(base, true, { lookup: true, fetcher }), null);
  assert.deepEqual(await notificationTarget({ ...base, personalReportChannelId: channelId }, true), { channelId, enabled: true, lookup: "not_requested" });
  assert.deepEqual(await notificationTarget({ ...base, personalReportChannelId: "not-a-channel" }, false, { lookup: true, fetcher }), { channelId: "not-a-channel", enabled: false, lookup: "invalid" });
});
