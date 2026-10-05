import test from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.mjs";
import { deliverLoginNotice } from "../notify.mjs";

const id = "100000000000000002";
const calls = (requests, outcome = 200) => async (url, options) => {
  if (url.endsWith("/token")) return Response.json({ access_token: "test-only-transient", token_type: "Bearer" });
  if (url.endsWith("/users/@me")) return Response.json({ id, username: "member", global_name: "검증 회원", avatar: null });
  requests.push({ url, body: JSON.parse(options.body) });
  return Response.json({ id: "200000000000000001" }, { status: outcome });
};
async function login(app) {
  const start = await app.request("/reports/auth/discord");
  const auth = new URL(start.headers.get("location"));
  const callback = `/reports/auth/callback?state=${auth.searchParams.get("state")}&code=fake`;
  const result = await app.request(callback, start.headers.getSetCookie()[0].split(";")[0]);
  assert.equal(result.status, 303);
  assert.equal(result.headers.get("location"), "/reports/account?welcome=1");
  const cookies = result.headers.getSetCookie();
  assert.equal(cookies.length, 2, "OAuth state clearing must not overwrite the login cookie");
  const session = cookies.find((c) => /^(?:__Host-)?briefs=/.test(c));
  assert.match(session, /HttpOnly; SameSite=Lax; Path=\/; Max-Age=2592000/);
  return { cookie: session.split(";")[0], session };
}

test("Discord login creates a pending subscription, persists a secure session and sends one login DM with daily DMs disabled", async () => {
  const requests = [];
  const fake = calls(requests);
  const app = setup({ secure: true, origin: "https://example.test" }, { fetch: fake });
  assert.deepEqual(await (await app.request("/reports/session")).json(), { authenticated: false });
  const { cookie, session } = await login(app);
  assert.match(session, /^__Host-briefs=/); assert.match(session, /; Secure$/);
  const member = (await app.store.read()).members[id];
  assert.equal(member.status, "pending"); assert.equal(member.dm_opt_in, true); assert.equal(member.name, "검증 회원");
  const response = await app.request("/reports/session", cookie);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { authenticated: true, role: "member", name: "검증 회원", subscription: "pending", canRead: false });
  assert.equal((await app.request("/reports", cookie)).headers.get("location"), "/reports/account");
  assert.equal((await app.request("/reports/2026-01-01/html", cookie)).status, 403);
  assert.match(await (await app.request("/reports/account?welcome=1", cookie)).text(), /Discord 로그인이 완료되었습니다/);
  assert.equal(requests.length, 0, "Login redirect is not blocked by Discord messages");
  await Promise.all([app.work[0](), deliverLoginNotice(app.store, app.config, id, member.login_notice.id, fake)]);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].body, { recipient_id: id });
  assert.match(requests[1].body.content, /로그인이 완료되었습니다/);
  assert.ok(requests[1].body.content.endsWith("https://example.test/reports/account"));
  assert.deepEqual(requests[1].body.allowed_mentions, { parse: [] });
  assert.equal(requests[1].body.enforce_nonce, true);
  assert.equal((await app.store.read()).members[id].login_notice.status, "sent");
  await login(app);
  assert.equal(app.work.length, 1, "Rapid repeated logins do not spam DMs");
  await app.request("/reports/logout", cookie, {});
  assert.deepEqual(await (await app.request("/reports/session", cookie)).json(), { authenticated: false });
});

test("existing revocation and notification choices survive re-login; approval is reflected in session UI", async () => {
  const app = setup({}, { fetch: calls([]) });
  for (const status of ["revoked", "rejected", "approved", "pending"]) {
    await app.member(id, status, false);
    const { cookie } = await login(app);
    const current = (await app.store.read()).members[id];
    assert.equal(current.status, status); assert.equal(current.dm_opt_in, false);
    const state = await (await app.request("/reports/session", cookie)).json();
    assert.equal(state.canRead, status === "approved");
  }
  const cookie = (await login(app)).cookie;
  await app.request("/reports/subscription", cookie, { name: "수정 이름" });
  assert.equal((await app.store.read()).members[id].name, "수정 이름");
  assert.equal((await app.store.read()).members[id].status, "pending");
  await app.request(`/reports/admin/${id}/approve`, await app.session("admin"), {});
  assert.equal((await (await app.request("/reports/session", cookie)).json()).canRead, true);
  assert.match(await (await app.request("/reports/account", cookie)).text(), /보고서 목록 열기/);
  await app.request("/reports/unsubscribe", cookie, {});
  assert.equal((await (await app.request("/reports/session", cookie)).json()).canRead, false);
});

test("blocked and ambiguous login DMs never revoke login or auto-retry", async () => {
  for (const outcome of ["blocked", "uncertain", "failed"]) {
    const requests = [];
    const fake = async (url, options) => {
      if (url.endsWith("messages")) {
        if (outcome === "uncertain") throw new Error("lost response");
        return Response.json({}, { status: outcome === "blocked" ? 403 : 429 });
      }
      return calls(requests)(url, options);
    };
    const app = setup({}, { fetch: fake });
    const { cookie } = await login(app);
    await app.work[0](); await app.work[0]();
    assert.equal((await app.store.read()).members[id].login_notice.status, outcome);
    assert.equal(requests.length, 1);
    assert.equal((await (await app.request("/reports/session", cookie)).json()).authenticated, true);
  }
});
