import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createSiteHandler } from "../router.mjs";
import { BriefStore } from "../storage.mjs";
import { MemoryFiles, today } from "./helpers.mjs";

const ownerId = "100000000000000001", alice = "100000000000000002", bob = "100000000000000003";
const item = { id: "shared-contest-fixture", category: "contest", title: "Shared contest", sourceUrl: "https://example.org/contest", benefit: "Public benefit", eligibility: "Check eligibility", deadline: "Verify deadline", nextAction: "Read the official page" };
const privateNote = "Owner-only private note", privateProfile = "Owner-only private profile";
async function fixture({ linked = true } = {}) {
  const env = {
    REPORTS_SITE_URL: "https://example.org", FUNDING_ADMIN_TOKEN: randomBytes(32).toString("hex"),
    PERSONAL_ADMIN_USERNAME: "owner", PERSONAL_ADMIN_TOKEN: randomBytes(32).toString("hex"),
    PERSONAL_PUBLISHER_TOKEN: randomBytes(32).toString("hex"), DISCORD_APPLICATION_ID: ownerId, DISCORD_CLIENT_SECRET: "fixture-only",
  };
  const files = new MemoryFiles(), store = new BriefStore(files, "personal/briefs"), club = new BriefStore(files), work = [];
  const handler = createSiteHandler({ env, personalStore: store, clubStore: club, after: task => work.push(task), fetch: async (url, options) => {
    if (String(url).endsWith("/token")) return Response.json({ access_token: options.body.get("code"), token_type: "Bearer" });
    const id = options.headers.authorization.slice("Bearer ".length);
    return Response.json({ id, username: `fixture-${id}`, global_name: `Reader ${id}` });
  } });
  const request = (pathname, cookie = "", input, origin = env.REPORTS_SITE_URL) => handler(new Request(`${env.REPORTS_SITE_URL}${pathname}`, {
    method: input === undefined ? "GET" : "POST", headers: { cookie, ...(input === undefined ? {} : { origin }) },
    ...(input === undefined ? {} : { body: new URLSearchParams(input) }),
  }));
  const start = (cookie = "", linking = false) => request("/personal/auth/discord", cookie, linking ? {} : undefined);
  const finish = async (response, id, cookie = "") => {
    const state = new URL(response.headers.get("location")).searchParams.get("state");
    const nonce = response.headers.getSetCookie()[0].split(";")[0];
    const path = `/reports/auth/callback?state=${state}&code=${id}`;
    const cookies = `${cookie}; ${nonce}`;
    return { response: await request(path, cookies), path, cookies };
  };
  const login = async id => {
    const { response } = await finish(await start(), id);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/personal");
    return response.headers.getSetCookie().find(value => value.startsWith("__Host-personal-briefs=")).split(";")[0];
  };
  const html = `<html><body>Shared report<script type="application/json" id="gammaru-opportunities">${JSON.stringify({ version: 1, audience: "personal", stateVersion: 0, opportunities: [item] })}</script></body></html>`;
  const draft = await store.stage({ date: today, title: "Shared report", summary: "Public summary", html, notify: false }, "fixture", today);
  await store.publish(draft, today, "", "", true);
  await store.setProgress(item.id, { revision: 0, note: privateNote, status: "deferred" }, "admin");
  await store.update(state => {
    state.personalProfile = { revision: 1, skills: privateProfile };
    if (linked) {
      state.personalAccount = { discordId: ownerId, revision: 1 };
      state.members[ownerId] = { id: ownerId, name: "Owner", username: "owner", display_name: "Owner", status: "approved", dm_opt_in: true };
    }
  });
  return { env, store, club, work, request, start, finish, login, html };
}

test("Discord login grants immediate personal reading without approval or changing the owner/DM target", async () => {
  const app = await fixture();
  const guest = await (await app.request("/personal")).text();
  assert.match(guest, /Discord로 로그인/);
  assert.doesNotMatch(guest, /name="password"/);
  const cookie = await app.login(alice);
  const session = await (await app.request("/personal/session", cookie)).json();
  assert.equal(session.canRead, true); assert.equal(session.role, "member");
  const state = await app.store.read();
  assert.equal(state.members[alice].status, "approved"); assert.equal(state.members[alice].dm_opt_in, false);
  assert.equal(state.personalAccount.discordId, ownerId); assert.equal(state.members[ownerId].dm_opt_in, true);
  assert.equal(app.work.length, 0); assert.deepEqual(state.deliveries, {});
  for (const path of ["/personal", "/personal/account", "/personal/progress", `/personal/${today}`, `/personal/${today}/html`]) {
    const response = await app.request(path, cookie); assert.equal(response.status, 200, path);
    const page = await response.text();
    assert.ok(!page.includes(privateNote) && !page.includes(privateProfile), path);
    assert.doesNotMatch(page, /href="\/personal\/(?:profile|upload)"/);
  }
  assert.equal(await (await app.request(`/personal/${today}/html`, cookie)).text(), app.html);
  assert.ok(!(await (await app.request(`/personal/${today}/html`)).text()).includes("Shared report"));
  assert.equal((await (await app.request("/reports/session", cookie)).json()).authenticated, false);
});

test("reader statuses and notes stay isolated across accounts, preserve stale-click safety and do not alter research state", async () => {
  const app = await fixture(), a = await app.login(alice), b = await app.login(bob);
  const before = await app.store.read(), endpoint = `/personal/opportunities/${item.id}/status`;
  assert.equal((await app.request(endpoint, a, { revision: "0", note: "Alice only", date: today, memberId: bob })).status, 303);
  assert.equal((await app.request(endpoint, a, { revision: "0", status: "in_progress", date: today })).status, 303);
  assert.equal((await app.request(endpoint, a, { revision: "0", status: "in_progress", date: today })).status, 303);
  assert.equal((await app.request(endpoint, a, { revision: "0", note: "Stale note", date: today })).status, 409);
  assert.equal((await app.request(endpoint, b, { revision: "0", note: "Bob only", status: "completed", date: today })).status, 303);
  const state = await app.store.read();
  assert.equal(state.workflowVersion, before.workflowVersion);
  assert.deepEqual(state.opportunities, before.opportunities);
  assert.equal(state.memberProgress[alice][item.id].note, "Alice only");
  assert.equal(state.memberProgress[alice][item.id].status, "in_progress");
  assert.equal(state.memberProgress[alice][item.id].revision, 2);
  assert.equal(state.memberProgress[bob][item.id].note, "Bob only");
  const a2 = await app.login(alice);
  for (const path of [`/personal/${today}`, "/personal/progress"]) {
    const pageA = await (await app.request(path, a2)).text(), pageB = await (await app.request(path, b)).text();
    assert.match(pageA, /Alice only/); assert.doesNotMatch(pageA, /Bob only|Owner-only/);
    assert.match(pageB, /Bob only/); assert.doesNotMatch(pageB, /Alice only|Owner-only/);
    assert.match(pageA, /나만 보는 메모/);
  }
  assert.equal((await app.request(endpoint, a, { revision: "2", status: "completed" }, "https://other.example")).status, 403);
  assert.equal((await app.request("/personal/opportunities/unknown-fixture/status", a, { revision: "0", status: "completed" })).status, 404);
});

test("owner and reader records follow their Discord login across fresh sessions and storage instances", async () => {
  const app = await fixture(), owner = await app.login(ownerId), reader = await app.login(alice);
  const endpoint = `/personal/opportunities/${item.id}/status`;
  assert.equal((await app.request(endpoint, owner, { revision: "1", status: "completed", date: today })).status, 303);
  assert.equal((await app.request(endpoint, reader, { revision: "0", status: "in_progress", note: "Reader server note", date: today })).status, 303);
  await app.request("/personal/logout", owner, {}); await app.request("/personal/logout", reader, {});
  const persisted = await new BriefStore(app.store.files, "personal/briefs").read();
  assert.equal(persisted.opportunities[item.id].status, "completed");
  assert.equal(persisted.memberProgress[alice][item.id].status, "in_progress");
  const ownerAgain = await app.login(ownerId), readerAgain = await app.login(alice);
  for (const [cookie, account, status, note, forbidden] of [[ownerAgain, ownerId, "completed", privateNote, "Reader server note"], [readerAgain, alice, "in_progress", "Reader server note", privateNote]]) {
    for (const path of [`/personal/${today}`, "/personal/progress"]) {
      const response = await app.request(path, cookie), page = await response.text();
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.ok(page.includes(`Reader ${account} · 내 진행 기록`));
      assert.match(page, /같은 계정이면 다른 기기에서도/);
      assert.ok(page.includes(`id="progress-${item.id}" data-status="${status}"`));
      assert.ok(page.includes(note)); assert.ok(!page.includes(forbidden));
    }
  }
});

test("readers cannot view or mutate the owner's private research, profile, uploads or Discord binding", async () => {
  const app = await fixture(), cookie = await app.login(alice), before = await app.store.read();
  for (const path of ["/personal/profile", "/personal/research-state", "/personal/context", "/personal/upload?guide=1", "/personal/instructions", "/personal/design"]) {
    const response = await app.request(path, cookie);
    assert.ok([403, 303].includes(response.status), path);
    const text = await response.text(); assert.ok(!text.includes(privateProfile) && !text.includes(privateNote), path);
  }
  for (const path of ["/personal/profile", "/personal/auth/discord", "/personal/unsubscribe", "/personal/subscription", "/personal/account/confirmation", "/personal/upload/preview", "/personal/notify", `/personal/${today}/opportunities`]) {
    assert.equal((await app.request(path, cookie, { revision: "1", skills: "Overwritten", dm: "yes" })).status, 403, path);
  }
  const after = await app.store.read();
  assert.deepEqual(after.personalProfile, before.personalProfile); assert.deepEqual(after.personalAccount, before.personalAccount);
  assert.equal(after.members[ownerId].dm_opt_in, true); assert.equal(after.workflowVersion, before.workflowVersion);
});

test("only the already-linked owner receives Discord management rights; changing the binding revokes old owner sessions", async () => {
  const app = await fixture(), owner = await app.login(ownerId);
  assert.equal((await (await app.request("/personal/session", owner)).json()).role, "admin");
  assert.match(await (await app.request("/personal/profile", owner)).text(), /Owner-only private profile/);
  assert.match(await (await app.request(`/personal/${today}`, owner)).text(), /Owner-only private note/);
  assert.equal((await app.request("/personal/subscription", owner, { revision: "1" })).status, 303);
  assert.equal((await (await app.request("/personal/session", owner)).json()).authenticated, true);
  const linked = await app.finish(await app.start(owner, true), bob, owner);
  assert.equal(linked.response.status, 303);
  assert.equal((await (await app.request("/personal/session", owner)).json()).authenticated, false);
  const newOwner = await app.login(bob);
  assert.equal((await (await app.request("/personal/session", newOwner)).json()).role, "admin");
  const oldOwnerReader = await app.login(ownerId);
  assert.equal((await (await app.request("/personal/session", oldOwnerReader)).json()).role, "member");
  assert.doesNotMatch(await (await app.request(`/personal/${today}`, oldOwnerReader)).text(), /Owner-only private note/);
  const unlinked = await fixture({ linked: false }), firstReader = await unlinked.login(alice);
  assert.equal((await (await unlinked.request("/personal/session", firstReader)).json()).role, "member");
  assert.equal((await unlinked.store.read()).personalAccount, undefined);
});

test("public OAuth remains cookie-bound, single-use and independent of club approval", async () => {
  const app = await fixture(), start = await app.start();
  const state = new URL(start.headers.get("location")).searchParams.get("state");
  assert.equal((await app.request(`/reports/auth/callback?state=${state}&code=${alice}`)).status, 403);
  const result = await app.finish(start, alice);
  assert.equal(result.response.status, 303);
  assert.equal((await app.request(result.path, result.cookies)).status, 403);
  const clubStart = await app.request("/reports/auth/discord");
  const clubCallback = await app.finish(clubStart, alice);
  assert.equal(clubCallback.response.status, 303);
  assert.equal((await app.club.read()).members[alice].status, "pending");
  assert.equal((await app.store.read()).members[alice].status, "approved");
});
