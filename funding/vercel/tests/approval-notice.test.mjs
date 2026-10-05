import test from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.mjs";

function fixture(fetcher) {
  const requests = [];
  const app = setup({}, { fetch: async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return fetcher ? fetcher(url, options, app) : Response.json({ id: "200000000000000001" });
  } });
  return { ...app, requests };
}

test("approval commits access and queues exactly one confirmation despite duplicate submissions/workers", async () => {
  const app = fixture(), id = await app.member("100000000000000001", "pending", false);
  const admin = await app.session("admin");
  assert.equal((await app.request(`/reports/admin/${id}/approve`, admin, {})).status, 303);
  assert.equal((await app.store.read()).members[id].status, "approved");
  assert.equal(app.requests.length, 0);
  assert.equal((await app.request(`/reports/admin/${id}/approve`, admin, {})).status, 409);
  assert.equal(app.work.length, 1);
  await Promise.all([app.work[0](), app.work[0]()]);
  assert.equal(app.requests.length, 2);
  assert.deepEqual(app.requests[0].body, { recipient_id: id });
  assert.match(app.requests[1].body.content, /구독이 승인되었습니다/);
  assert.ok(app.requests[1].body.content.includes(`${app.config.origin}/reports`));
  assert.deepEqual(app.requests[1].body.allowed_mentions, { parse: [] });
  assert.equal((await app.store.read()).members[id].approval_notice.status, "sent");
  assert.equal((await app.store.read()).members[id].dm_opt_in, false, "Transactional confirmation must not change newsletter consent");
});

test("existing approved subscribers can request confirmation for themselves with CSRF, role and cooldown checks", async () => {
  const app = fixture(), id = await app.member(), member = await app.session("member", id), admin = await app.session("admin");
  const publisher = await app.session("publisher");
  for (const cookie of ["", publisher, admin]) assert.equal((await app.request("/reports/account/confirmation", cookie, {})).status, 403);
  assert.equal((await app.request(`/reports/admin/${id}/notify`, member, {})).status, 403);
  assert.equal((await app.request("/reports/account/confirmation", member, {}, "https://other.example")).status, 403);
  const result = await app.request("/reports/account/confirmation", member, { memberId: "100000000000000099" });
  assert.equal(result.status, 303);
  assert.equal(result.headers.get("location"), "/reports/account?confirmation=1");
  assert.equal((await app.request("/reports/account/confirmation", member, {})).status, 429);
  assert.equal((await app.request(`/reports/admin/${id}/notify`, admin, {})).status, 429);
  await app.work[0](); assert.equal(app.requests[0].body.recipient_id, id);
  await app.store.update((s) => { s.members[id].approval_notice.createdAt = 0; });
  assert.equal((await app.request(`/reports/admin/${id}/notify`, admin, {})).status, 303);
  await app.work[1](); assert.equal(app.requests.length, 4);
  await app.request(`/reports/admin/${id}/revoke`, admin, {});
  assert.equal((await app.request("/reports/account/confirmation", member, {})).status, 403);
});

test("Discord rejection records a safe code, keeps approval and offers recovery; rate limits are honored", async () => {
  const app = fixture(async () => Response.json({ code: 50007, message: "Untrusted response is not persisted" }, { status: 403 }));
  const id = await app.member(), member = await app.session("member", id);
  await app.request("/reports/account/confirmation", member, {}); await app.work[0]();
  let current = (await app.store.read()).members[id];
  assert.equal(current.status, "approved");
  assert.equal(current.approval_notice.status, "blocked");
  assert.equal(current.approval_notice.errorCode, 50007);
  assert.doesNotMatch(JSON.stringify(current), /Untrusted response/);
  const page = await (await app.request("/reports/account", member)).text();
  assert.match(page, /확인 DM 다시 받기/); assert.match(page, /봇을 서버에 추가/);
  assert.match(page, /전송 상태 새로고침/);
  const limited = fixture(async () => Response.json({ retry_after: 120 }, { status: 429 }));
  const otherId = await limited.member(), cookie = await limited.session("member", otherId);
  await limited.request("/reports/account/confirmation", cookie, {}); await limited.work[0]();
  await limited.store.update((s) => { s.members[otherId].approval_notice.createdAt = 0; });
  assert.equal((await limited.request("/reports/account/confirmation", cookie, {})).status, 429);
});

test("approval cancellation before sending prevents stale confirmation DMs", async () => {
  for (const duringChannel of [false, true]) {
    const app = fixture(async (url, options, current) => {
      if (duringChannel && url.endsWith("/users/@me/channels")) await current.store.update((s) => { Object.values(s.members)[0].status = "revoked"; });
      return Response.json({ id: "200000000000000001" });
    });
    const id = await app.member(), member = await app.session("member", id);
    await app.request("/reports/account/confirmation", member, {});
    if (!duringChannel) await app.store.update((s) => { s.members[id].status = "revoked"; });
    await app.work[0]();
    assert.equal(app.requests.length, duringChannel ? 1 : 0);
    assert.equal((await app.store.read()).members[id].approval_notice.status, "cancelled");
  }
});
