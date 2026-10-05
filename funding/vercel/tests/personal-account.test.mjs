import test from "node:test";
import assert from "node:assert/strict";
import { setup, today } from "./helpers.mjs";
import { claimWorkerJob, beginWorkerJob } from "../worker-jobs.mjs";
import { deliverBriefLinks, deliverLoginNotice } from "../notify.mjs";
import { bindPersonalDiscord } from "../personal-account.mjs";
import { digest } from "../../schema.mjs";

const first = "100000000000000001", second = "100000000000000002", channel = "300000000000000001";
function fixture() {
  let discordId = first;
  const app = setup({ service: "personal", dmEnabled: true, discordReportChannelId: channel, discordDeliveryMode: "worker", discordWorkerToken: "w".repeat(64) }, {
    fetch: async url => String(url).endsWith("/token") ? Response.json({ access_token: "test-only", token_type: "Bearer" }) : Response.json({ id: discordId, username: "test-discord", global_name: "연결 계정" }),
  });
  return { ...app, setDiscord(id) { discordId = id; } };
}
async function start(app, cookie) {
  const response = await app.request("/reports/auth/discord", cookie, {});
  assert.equal(response.status, 303);
  const nonce = new URL(response.headers.get("location")).searchParams.get("state");
  return { pathname: `/reports/auth/callback?state=${nonce}&code=test`, cookie: `${cookie}; ${response.headers.getSetCookie()[0].split(";")[0]}` };
}
async function link(app, cookie, id = first) {
  app.setDiscord(id); const pending = await start(app, cookie);
  const response = await app.request(pending.pathname, pending.cookie);
  assert.equal(response.status, 303);
  return response;
}
async function publish(app) {
  const version = (await app.store.read()).workflowVersion;
  const html = `<html><body><h1>Test daily scrum</h1><script type="application/json" id="gammaru-opportunities">${JSON.stringify({ version: 1, audience: "personal", stateVersion: version, opportunities: [] })}</script></body></html>`;
  const cookie = await app.session("publisher");
  const draft = await app.stage(digest(cookie.split("=")[1]), today, html);
  const response = await app.request("/reports/upload/publish", cookie, { draft: draft.id, confirmed: "yes" });
  assert.equal(response.status, 303);
}

test("personal ID/password login opens overview; Discord alone cannot grant access", async () => {
  const app = fixture();
  const guest = await (await app.request("/reports")).text();
  assert.match(guest, /개인 로그인/); assert.match(guest, /name="username"/);
  assert.equal((await app.request("/reports/login/admin", "", { username: app.config.adminUsername, password: "wrong" })).status, 401);
  const login = await app.request("/reports/login/admin", "", { username: app.config.adminUsername, password: app.config.token });
  assert.equal(login.headers.get("location"), "/reports");
  assert.match(login.headers.getSetCookie()[0], /HttpOnly; SameSite=Lax; Path=\/; Max-Age=2592000/);
  const cookie = login.headers.getSetCookie()[0].split(";")[0];
  assert.match(await (await app.request("/reports", cookie)).text(), /내 데일리 스크럼/);
  assert.equal((await app.request("/reports/auth/discord", "", {})).status, 403);
  assert.equal((await app.request("/reports/auth/discord")).headers.get("location"), "/reports/login/admin");
  const publisher = await app.session("publisher");
  assert.equal((await app.request("/reports/auth/discord", publisher, {})).status, 403);
  await link(app, cookie);
  assert.equal((await (await app.request("/reports/session", cookie)).json()).role, "admin");
  const memberCookie = await app.session("member", first);
  assert.equal((await app.request("/reports", memberCookie)).status, 403);
  assert.equal((await app.store.read()).personalAccount.discordId, first);
});

test("OAuth linking binds to initiating ID/password session and cannot survive logout or revision changes", async () => {
  const app = fixture(), cookie = await app.session("admin"), otherSession = await app.session("admin");
  const pending = await start(app, cookie);
  const oauthCookie = pending.cookie.split("; ")[1];
  assert.equal((await app.request(pending.pathname, `${otherSession}; ${oauthCookie}`)).status, 403);
  await app.request("/reports/logout", cookie, {});
  assert.equal((await app.request(pending.pathname, pending.cookie)).status, 403);
  assert.equal(Object.keys((await app.store.read()).members).length, 0);
  const secondPending = await start(app, otherSession);
  await link(app, otherSession);
  assert.equal((await app.request(secondPending.pathname, secondPending.cookie)).status, 409);
  assert.equal((await app.request("/reports/auth/discord", otherSession, {}, "https://attacker.example")).status, 403);
});

test("unlinked personal reports never fall back to subscribers or configured server channel", async () => {
  const app = fixture(); await app.member(first); await app.member(second);
  await publish(app);
  const data = await app.store.read();
  assert.equal(data.reports[0].audience, "personal");
  assert.deepEqual(data.deliveries, {});
  assert.equal(await claimWorkerJob(app.store, app.config), null);
});

test("personal daily report queues and sends only linked Discord; changing link cancels old jobs", async () => {
  const app = fixture(), cookie = await app.session("admin");
  await app.member(second); await link(app, cookie); await publish(app);
  let state = await app.store.read();
  assert.deepEqual(Object.values(state.deliveries).map(row => row.memberId), [first]);
  const job = await claimWorkerJob(app.store, app.config);
  assert.deepEqual(job.target, { memberId: first });
  await link(app, cookie, second);
  assert.equal(await beginWorkerJob(app.store, app.config, job), false);
  state = await app.store.read();
  assert.equal(state.members[first].status, "revoked");
  assert.equal(state.members[first].dm_opt_in, false);
  assert.equal(state.members[first].login_notice.status, "cancelled");
  const confirmation = await claimWorkerJob(app.store, app.config);
  assert.deepEqual(confirmation.target, { memberId: second });
  assert.match(confirmation.message.content, /Discord 연결이 완료/);
});

test("opt-out survives relinking; stale forms fail and disconnect preserves reports", async () => {
  const app = fixture(), cookie = await app.session("admin");
  await link(app, cookie); await publish(app);
  assert.equal((await app.request("/reports/subscription", cookie, { revision: "1" })).status, 303);
  await link(app, cookie);
  assert.equal((await app.store.read()).members[first].dm_opt_in, false);
  assert.equal((await app.request("/reports/unsubscribe", cookie, { revision: "1" })).status, 409);
  assert.equal((await app.request("/reports/unsubscribe", cookie, { revision: "3" })).status, 303);
  const state = await app.store.read();
  assert.equal(state.personalAccount.discordId, "");
  assert.equal(state.reports.length, 1);
  assert.equal(await claimWorkerJob(app.store, app.config), null);
});

test("direct report and confirmation sends recheck persistent binding after opening DM", async () => {
  for (const notice of [false, true]) {
    const app = fixture(), cookie = await app.session("admin"); await link(app, cookie); await publish(app);
    const requests = [];
    const fetcher = async (url) => {
      requests.push(url);
      await app.store.update(state => bindPersonalDiscord(state, null, digest(cookie.split("=")[1]), digest([app.config.adminUsername, app.config.token]), state.personalAccount.revision));
      return Response.json({ id: channel });
    };
    if (notice) await deliverLoginNotice(app.store, app.config, first, (await app.store.read()).members[first].login_notice.id, fetcher);
    else await deliverBriefLinks(app.store, app.config, fetcher);
    assert.equal(requests.length, 1);
    assert.ok(requests[0].endsWith("/users/@me/channels"));
  }
});
