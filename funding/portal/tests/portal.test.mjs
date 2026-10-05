import test from "node:test";
import assert from "node:assert/strict";
import { setup, input, identity, date } from "./helpers.mjs";
import { DiscordNotifier } from "../discord.mjs";
import { PortalStore } from "../store.mjs";
import { digest } from "../../schema.mjs";

test("direct report requests require current membership; revoke/logout invalidate access", async (t) => {
  const app = await setup(); t.after(app.close);
  const user = app.store.upsertDiscord(identity()); app.store.subscribe(user.id, "신청자", true);
  app.store.publish(input(), "");
  const cookie = app.session("member", user.id), admin = app.session("admin");
  const target = `/members/reports/${date}`;
  assert.equal((await app.request(target)).status, 303);
  assert.equal((await app.request(target, cookie)).status, 403);
  assert.equal((await app.request(target, app.session("publisher"))).status, 403);
  assert.equal((await app.request(`/admin/members/${user.id}/approve`, cookie, {})).status, 403);
  assert.equal((await app.request(`/admin/members/${user.id}/approve`, admin, {}, "https://other.example")).status, 403);
  assert.equal((await app.request(`/admin/members/${user.id}/approve`, admin, {})).status, 303);
  const report = await app.request(target, cookie);
  assert.equal(report.status, 200); assert.equal(report.headers.get("cache-control"), "private, no-store");
  assert.match(report.headers.get("x-robots-tag"), /noindex/);
  assert.match(await report.text(), /DAILY/);
  await app.request(`/admin/members/${user.id}/revoke`, admin, {});
  assert.equal((await app.request(target, cookie)).status, 403);
  await app.request("/members/logout", admin, {});
  assert.equal((await app.request(target, admin)).status, 303);
});

test("admin password login, credential rotation, publisher scope and CSRF", async (t) => {
  const app = await setup(); t.after(app.close);
  assert.equal((await app.request("/admin/login", "", { username: "admin", password: "wrong" })).status, 401);
  const login = await app.request("/admin/login", "", { username: "admin", password: app.config.token });
  assert.equal(login.status, 303);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  assert.match(login.headers.get("set-cookie"), /HttpOnly; SameSite=Lax/);
  assert.equal((await app.request("/admin", cookie)).status, 200);
  app.config.token = "changed-to-a-new-unrelated-secret-value";
  assert.equal((await app.request("/admin", cookie)).status, 303);
  const publisher = app.session("publisher");
  assert.equal((await app.request("/publisher/context", publisher)).status, 200);
  assert.equal((await app.request("/admin", publisher)).status, 303);
  assert.equal((await app.request("/admin/actions/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/approve", publisher, {})).status, 403);
  assert.equal((await app.request("/publisher/publish", publisher, { report: JSON.stringify(input()), confirmed: "yes" }, "https://other.example")).status, 403);
  const forged = `gammaru=${"a".repeat(64)}`;
  assert.equal((await app.request("/publisher", forged)).status, 303);
});

test("OAuth state is cookie-bound, expiring and one-use; identify uses real provider profile", async (t) => {
  const calls = [];
  const app = await setup({ discordApplicationId: "100000000000000099", discordClientSecret: "test-only-oauth-secret" }, { fetch: async (url, options) => {
    calls.push(String(url));
    if (String(url).endsWith("/oauth2/token")) {
      assert.equal(options.body.get("redirect_uri"), `${app.config.origin}/members/auth/callback`);
      return Response.json({ token_type: "Bearer", access_token: "test-only-transient-token" });
    }
    return Response.json(identity());
  } }); t.after(app.close);
  const start = await app.request("/members/auth/discord");
  const auth = new URL(start.headers.get("location"));
  assert.equal(auth.searchParams.get("scope"), "identify");
  const state = auth.searchParams.get("state"), cookie = start.headers.get("set-cookie").split(";")[0];
  const callback = `/members/auth/callback?state=${state}&code=fake-code`;
  assert.equal((await app.request(callback)).status, 403); assert.equal(calls.length, 0);
  const completed = await app.request(callback, cookie);
  assert.equal(completed.status, 303); assert.equal(calls.length, 2);
  assert.equal(app.store.member(identity().id).status, "new");
  assert.equal((await app.request(callback, cookie)).status, 403); assert.equal(calls.length, 2);
  const expired = app.store.oauthState();
  app.store.db.prepare("UPDATE oauth_states SET expires=0 WHERE hash=?").run(digest(expired));
  assert.equal(app.store.consumeState(expired), false);
  assert.equal(app.store.db.prepare("SELECT proof FROM sessions").get().proof, "discord");
});

test("publication persists escaped date-specific HTML, excludes private drafts and is idempotent", async (t) => {
  const app = await setup(); t.after(app.close);
  const user = app.store.upsertDiscord(identity()); app.store.subscribe(user.id, "테스터", true); app.store.changeMembership(user.id, "approve");
  const report = input(); report.report.summary = '<script>alert("bad")</script>';
  report.report.opportunities[0].actions[0].body = "PRIVATE ACTION DRAFT SHOULD NOT APPEAR";
  const publisher = app.session("publisher");
  const preview = await app.request("/publisher/preview", publisher, { report: JSON.stringify(report) });
  assert.equal(preview.status, 200); assert.equal(app.store.editions().length, 0);
  assert.equal((await app.request("/publisher/publish", publisher, { report: JSON.stringify(report) })).status, 400);
  const result = await app.request("/publisher/publish", publisher, { report: JSON.stringify(report), confirmed: "yes" });
  assert.equal(result.status, 303);
  const edition = app.store.edition(date);
  assert.match(edition.html, /&lt;script&gt;/); assert.doesNotMatch(edition.html, /<script>|PRIVATE ACTION DRAFT/);
  assert.match(edition.html, /#080918/); assert.ok(edition.design_hash);
  assert.equal(app.store.deliveries().length, 1);
  assert.equal(app.store.publish(report, "").duplicate, true);
  assert.equal(app.store.deliveries().length, 1);
  report.report.summary = "changed";
  assert.throws(() => app.store.publish(report, ""), /이미 발행/);
  assert.equal(app.store.edition(date).html, edition.html);
  const second = new PortalStore(app.directory);
  assert.equal(second.edition(date).html, edition.html); second.close();
});

test("stale research, invalid URLs, future timestamps and expired opportunities cannot publish", async (t) => {
  const app = await setup(); t.after(app.close);
  for (const change of [
    (r) => { r.date = "2000-01-01"; },
    (r) => { r.checkedAt = "2000-01-01T01:00:00Z"; },
    (r) => { r.checkedAt = "2099-01-01T01:00:00Z"; },
    (r) => { r.checkedAt = date; },
    (r) => { r.report.opportunities[0].sources[0].url = "javascript:alert(1)"; },
    (r) => { r.report.opportunities[0].deadline = "2000-01-01"; },
  ]) { const report = input(); change(report); assert.throws(() => app.store.publish(report, "")); }
  assert.equal(app.store.editions().length, 0);
  const empty = input(); empty.report.opportunities = []; empty.report.summary = "오늘 확인된 공고 없음";
  app.store.publish(empty, ""); assert.match(app.store.edition(date).html, /오늘 확인된 지원 기회가 없습니다/);
});

function approve(store, id, dm = true) {
  const m = store.upsertDiscord(identity(id)); store.subscribe(m.id, "테스트", dm); store.changeMembership(m.id, "approve"); return m;
}
test("DM sends only the private link to approved opted-in subscribers and deduplicates", async (t) => {
  const app = await setup({ dmEnabled: true, discordBotToken: "test-only-bot-token" }); t.after(app.close);
  approve(app.store, "100000000000000001"); approve(app.store, "100000000000000002", false);
  const revoked = approve(app.store, "100000000000000003");
  const pending = app.store.upsertDiscord(identity("100000000000000004")); app.store.subscribe(pending.id, "대기자", true);
  app.store.publish(input(), ""); app.store.changeMembership(revoked.id, "revoke");
  const sent = [];
  const notifier = new DiscordNotifier(app.store, app.config, async (url, options) => {
    const body = JSON.parse(options.body); sent.push({ url, body });
    return Response.json({ id: String(url).endsWith("messages") ? "200000000000000099" : "200000000000000001" });
  });
  await Promise.all([notifier.drain(), notifier.drain()]); await notifier.drain();
  assert.equal(sent.length, 2); assert.equal(sent[0].body.recipient_id, "100000000000000001");
  assert.equal(sent[1].body.content, `${app.config.origin}/members/reports/${date}`);
  assert.deepEqual(sent[1].body.allowed_mentions, { parse: [] }); assert.equal(sent[1].body.flags, 4);
  assert.equal(sent[1].body.enforce_nonce, true);
  assert.deepEqual(app.store.deliveries().map((d) => d.status).sort(), ["cancelled", "sent"]);
});

test("DM withdrawal during channel creation prevents a send", async (t) => {
  const app = await setup({ dmEnabled: true, discordBotToken: "test-only-bot-token" }); t.after(app.close);
  const m = approve(app.store, "100000000000000001"); app.store.publish(input(), "");
  let calls = 0;
  const notifier = new DiscordNotifier(app.store, app.config, async () => { calls++; app.store.unsubscribe(m.id); return Response.json({ id: "200000000000000001" }); });
  await notifier.drain(); assert.equal(calls, 1); assert.equal(app.store.deliveries()[0].status, "cancelled");
});

test("Discord 429 persists a retry; ambiguous send and restart never resend", async (t) => {
  const app = await setup({ dmEnabled: true, discordBotToken: "test-only-bot-token" }); t.after(app.close);
  approve(app.store, "100000000000000001"); app.store.publish(input(), "");
  let calls = 0;
  const notifier = new DiscordNotifier(app.store, app.config, async () => {
    calls++;
    if (calls === 1) return Response.json({ retry_after: 10, global: true }, { status: 429 });
    if (calls === 2) return Response.json({ id: "200000000000000001" });
    throw new Error("Ambiguous transport failure");
  });
  await notifier.drain(); assert.equal(calls, 1); assert.equal(app.store.deliveries()[0].status, "pending");
  assert.ok(app.store.db.prepare("SELECT retry_at FROM deliveries").get().retry_at > Date.now());
  await notifier.drain(); assert.equal(calls, 1);
  notifier.resumeAt = 0; app.store.db.exec("UPDATE deliveries SET retry_at=0");
  await notifier.drain(); assert.equal(calls, 3); assert.equal(app.store.deliveries()[0].status, "uncertain");
  app.store.recover(); await notifier.drain(); assert.equal(calls, 3);
  app.store.db.exec("UPDATE deliveries SET status='sending'"); app.store.recover();
  assert.equal(app.store.deliveries()[0].status, "uncertain");
});

test("FactChat fallback runs only after grace hour and missing report; defaults make no calls", async (t) => {
  let researches = 0;
  const app = await setup({ fallbackHour: 10, factchatKey: "test-only-key", factchatModel: "test-only-model" }, {
    now: () => new Date(`${date}T10:30:00+09:00`),
    research: async () => { researches++; return { ...input().report, provider: "factchat" }; },
  }); t.after(app.close);
  await app.tick(); assert.equal(researches, 0);
  app.config.fallbackEnabled = true;
  await app.tick(); await app.service.running;
  assert.equal(researches, 1); assert.ok(app.store.edition(date));
  await app.tick(); assert.equal(researches, 1);
});

test("saved HTML never exposes admin mutation or member records, and publisher cannot execute", async (t) => {
  const app = await setup(); t.after(app.close);
  app.store.publish(input(), "");
  const html = app.store.edition(date).html;
  assert.doesNotMatch(html, /\/admin\/actions|member_id|recipient|approve/);
  const action = app.store.state().actions[0];
  assert.equal((await app.request(`/admin/actions/${action.id}/approve`, app.session("publisher"), { hash: action.hash, confirmed: "yes" })).status, 403);
  assert.equal(app.store.action(action.id).status, "pending");
});
