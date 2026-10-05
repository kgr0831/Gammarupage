import test from "node:test";
import assert from "node:assert/strict";
import { setup, today } from "./helpers.mjs";
import { savePersonalProfile } from "../personal-profile.mjs";

const owner = "100000000000000001", other = "100000000000000002";
const mockDiscord = async (url) => url.endsWith("/token") ? Response.json({ access_token: "test", token_type: "Bearer" }) : Response.json({ id: owner, username: "owner", global_name: "Owner" });
async function login(app) {
  const start = await app.request("/reports/auth/discord");
  const state = new URL(start.headers.get("location")).searchParams.get("state");
  return app.request(`/reports/auth/callback?state=${state}&code=test`, start.headers.getSetCookie()[0].split(";")[0]);
}

test("only the configured personal owner is approved on first Discord login; revocation survives re-login", async () => {
  const app = setup({ personalOwnerId: owner }, { fetch: mockDiscord });
  const response = await login(app);
  assert.equal(response.status, 303);
  assert.equal((await app.store.read()).members[owner].status, "approved");
  await app.store.update(s => { s.members[owner].status = "revoked"; s.members[owner].dm_opt_in = false; });
  await login(app);
  assert.equal((await app.store.read()).members[owner].status, "revoked");
  assert.equal((await app.store.read()).members[owner].dm_opt_in, false);
  const wrong = setup({ personalOwnerId: other }, { fetch: mockDiscord });
  assert.equal((await login(wrong)).status, 403);
  assert.deepEqual((await wrong.store.read()).members, {});
});

test("private profile is editable only by the approved owner/admin, readable by the publisher, and escaped in HTML", async () => {
  const app = setup({ personalOwnerId: owner });
  const own = await app.session("member", await app.member(owner));
  const outsider = await app.session("member", await app.member(other));
  const publisher = await app.session("publisher"), admin = await app.session("admin");
  const profile = { revision: "0", education: "PRIVATE_TEST_EDUCATION", skills: '</textarea><img src=x onerror="alert(1)">' };
  for (const cookie of ["", outsider, publisher]) {
    assert.equal((await app.request("/reports/profile", cookie)).status, 403);
    assert.equal((await app.request("/reports/profile", cookie, profile)).status, 403);
  }
  assert.equal((await app.request("/reports/profile", own, profile, "https://foreign.test")).status, 403);
  assert.equal((await app.request("/reports/profile", own, profile)).status, 303);
  const stored = await app.store.read();
  assert.equal(stored.personalProfile.education, profile.education);
  assert.equal(stored.workflowVersion, 1);
  for (const cookie of [own, admin]) {
    const html = await (await app.request("/reports/profile", cookie)).text();
    assert.ok(html.includes("PRIVATE_TEST_EDUCATION"));
    assert.ok(!html.includes(profile.skills));
    assert.match(html, /&lt;\/textarea&gt;/);
    assert.match(html, /PERSONAL BRIEF/);
  }
  const context = await (await app.request("/reports/context", publisher)).text();
  assert.ok(context.includes("PRIVATE_TEST_EDUCATION"));
  const guide = await (await app.request("/reports/upload?guide=1", publisher)).text();
  assert.ok(guide.includes("PRIVATE_TEST_EDUCATION"));
  assert.ok(!guide.includes(profile.skills));
  assert.equal((await app.request("/reports/context", outsider)).status, 303);
  assert.ok(!(await (await app.request("/reports")).text()).includes("PRIVATE_TEST_EDUCATION"));
  assert.equal((await app.request("/reports/profile", admin, { ...profile, revision: "0" })).status, 409);
  const club = setup();
  assert.equal((await club.request("/reports/profile", await club.session("admin"), profile)).status, 404);
  assert.equal((await club.store.read()).personalProfile, undefined);
});

test("changing personal conditions invalidates stale report drafts and preserves existing profile on bad input", async () => {
  const app = setup({ personalOwnerId: owner });
  const publisher = await app.session("publisher");
  const html = '<html><body><script type="application/json" id="gammaru-opportunities">' + JSON.stringify({ version: 1, audience: "personal", stateVersion: 0, opportunities: [] }) + '</script></body></html>';
  const draft = await app.stage("publisher", today, html);
  await app.store.update(s => savePersonalProfile(s, { revision: 0, roles: "Intern" }));
  const form = { date: today, title: "Stale research", htmlText: html };
  assert.equal((await app.request("/reports/upload/preview", publisher, form)).status, 409);
  await assert.rejects(app.store.publish(draft, today, "", owner), { status: 409 });
  await assert.rejects(app.store.update(s => savePersonalProfile(s, { revision: 1, roles: "x".repeat(301) })), { status: 400 });
  await app.store.update(s => savePersonalProfile(s, { revision: 1, roles: "Intern" }));
  assert.equal((await app.store.read()).personalProfile.revision, 1);
  await app.member(owner, "revoked");
  await assert.rejects(app.store.update(s => savePersonalProfile(s, { revision: 1, roles: "Changed" }, owner)), { status: 403 });
});
