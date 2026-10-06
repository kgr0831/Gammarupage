import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { BriefStore } from "../storage.mjs";
import { createSiteHandler, personalRequest } from "../router.mjs";
import { personalConfig } from "../config.mjs";
import { MemoryFiles, today } from "./helpers.mjs";
import { digest } from "../../schema.mjs";
import { deliverBriefLinks } from "../notify.mjs";

const id = "100000000000000001", origin = "https://example.org";
export function mountedFixture() {
  const env = {
    REPORTS_SITE_URL: origin, FUNDING_ADMIN_USERNAME: "club-admin", FUNDING_ADMIN_TOKEN: randomBytes(32).toString("hex"),
    FUNDING_PUBLISHER_TOKEN: randomBytes(32).toString("hex"), PERSONAL_ADMIN_USERNAME: "personal-owner", PERSONAL_ADMIN_TOKEN: randomBytes(32).toString("hex"),
    PERSONAL_PUBLISHER_TOKEN: randomBytes(32).toString("hex"), DISCORD_APPLICATION_ID: "100000000000000099", DISCORD_CLIENT_SECRET: "test-secret",
    DISCORD_BOT_TOKEN: "test-bot", DISCORD_DELIVERY_MODE: "worker", DISCORD_WORKER_TOKEN: "a".repeat(64), DISCORD_REPORT_CHANNEL_ID: "300000000000000001",
  };
  const files = new MemoryFiles(), clubStore = new BriefStore(files), personalStore = new BriefStore(files, "personal/briefs"), pendingWork = [];
  const handler = createSiteHandler({ env, clubStore, personalStore, after: task => pendingWork.push(task), fetch: async (url, options) => {
    if (String(url).endsWith("/token")) {
      assert.equal(options.body.get("redirect_uri"), `${env.REPORTS_SITE_URL}/reports/auth/callback`);
      return Response.json({ access_token: "test-token", token_type: "Bearer" });
    }
    return Response.json({ id, username: "test-linked-owner", global_name: "검증 계정" });
  } });
  const request = (pathname, cookie = "", input) => handler(new Request(`${env.REPORTS_SITE_URL}${pathname}`, { method: input === undefined ? "GET" : "POST", headers: { cookie, ...(input === undefined ? {} : { origin: env.REPORTS_SITE_URL }) }, ...(input === undefined ? {} : { body: new URLSearchParams(input) }) }));
  const login = async (personal, publisher = false) => {
    const response = await request(`/${personal ? "personal" : "reports"}/login/${publisher ? "publisher" : "admin"}`, "", { username: env[personal ? "PERSONAL_ADMIN_USERNAME" : "FUNDING_ADMIN_USERNAME"], password: env[`${personal ? "PERSONAL" : "FUNDING"}_${publisher ? "PUBLISHER" : "ADMIN"}_TOKEN`] });
    assert.equal(response.status, 303);
    return response.headers.getSetCookie()[0].split(";")[0];
  };
  return { env, files, clubStore, personalStore, pendingWork, handler, request, login };
}

test("personal status clicks from an older page preserve the latest note and repeated clicks are idempotent", async () => {
  const app = mountedFixture(), owner = await app.login(true);
  const item = { id: "personal-status-fixture", category: "contest", title: "Fixture", sourceUrl: "https://example.org/contest", benefit: "Fixture", eligibility: "Verify", deadline: "Verify", nextAction: "Check" };
  const html = `<html><body><script type="application/json" id="gammaru-opportunities">${JSON.stringify({ version: 1, audience: "personal", stateVersion: 0, opportunities: [item] })}</script></body></html>`;
  const draft = await app.personalStore.stage({ date: today, title: "Fixture", summary: "", html, notify: false }, "fixture", today);
  await app.personalStore.publish(draft, today, "", "", true);
  const page = await (await app.request(`/personal/${today}`, owner)).text();
  assert.match(page, /name="revision" value="0"/);
  const endpoint = `/personal/opportunities/${item.id}/status`;
  await app.personalStore.setProgress(item.id, { revision: 0, note: "New note from another tab" }, "admin");
  const input = { revision: "0", status: "deferred", date: today };
  const first = await app.request(endpoint, owner, input);
  assert.equal(first.status, 303);
  assert.equal(first.headers.get("location"), `/personal/${today}?progress=${item.id}#progress-${item.id}`);
  let state = await app.personalStore.read();
  assert.equal(state.opportunities[item.id].status, "deferred");
  assert.equal(state.opportunities[item.id].note, "New note from another tab");
  const previous = structuredClone(state.opportunities[item.id]), workflowVersion = state.workflowVersion;
  const duplicate = await Promise.all([app.request(endpoint, owner, input), app.request(endpoint, owner, input)]);
  assert.ok(duplicate.every(response => response.status === 303));
  state = await app.personalStore.read();
  assert.deepEqual(state.opportunities[item.id], previous);
  assert.equal(state.workflowVersion, workflowVersion);
  assert.equal((await app.request(endpoint, owner, { ...input, status: "in_progress" })).status, 303);
  assert.equal((await app.personalStore.read()).opportunities[item.id].status, "in_progress");
  assert.equal((await app.request(endpoint, owner, { ...input, revision: "999" })).status, 409);
  assert.equal((await app.request(endpoint, owner, { revision: "0", note: "Old note" })).status, 409);
  assert.equal((await app.request(endpoint, owner, { ...input, note: "Old mixed update" })).status, 409);
  assert.equal((await app.personalStore.read()).opportunities[item.id].note, "New note from another tab");
  const publisher = await app.login(true, true), club = await app.login(false);
  assert.equal((await app.request(endpoint, publisher, input)).status, 403);
  assert.equal((await app.request(endpoint, club, input)).status, 403);
  assert.equal((await app.request(endpoint, "", input)).status, 403);
});

test("same-origin personal mount has separate credentials, cookies, archive and navigation", async () => {
  const app = mountedFixture(), own = await app.login(true), club = await app.login(false);
  assert.match(own, /^__Host-personal-briefs=/); assert.match(club, /^__Host-briefs=/);
  assert.equal((await app.request("/personal/login/admin", "", { username: app.env.FUNDING_ADMIN_USERNAME, password: app.env.FUNDING_ADMIN_TOKEN })).status, 401);
  assert.equal((await app.request("/personal/profile", club)).status, 403);
  assert.equal((await (await app.request("/reports/session", own)).json()).authenticated, false);
  const both = `${own}; ${club}`;
  const page = await (await app.request("/personal", both)).text();
  assert.match(page, /href="\/personal\/account"/); assert.match(page, /action="\/personal\/logout"/);
  assert.doesNotMatch(page, /(?:href|action|src)="\/reports/);
  const guest = await (await app.request("/personal")).text();
  assert.match(guest, /action="\/personal\/login\/admin"/);
  await app.request("/personal/logout", both, {});
  assert.equal((await (await app.request("/reports/session", both)).json()).authenticated, true);
  assert.equal((await (await app.request("/personal/session", both)).json()).authenticated, false);
});

test("shared Discord callback selects the matching nonce and retains club and personal sessions", async () => {
  const app = mountedFixture(), own = await app.login(true), club = await app.login(false), both = `${own}; ${club}`;
  const personalStart = await app.request("/personal/auth/discord", both, {});
  const clubStart = await app.request("/reports/auth/discord", both);
  const auth = new URL(personalStart.headers.get("location"));
  assert.equal(auth.searchParams.get("redirect_uri"), `${origin}/reports/auth/callback`);
  const personalNonce = personalStart.headers.getSetCookie()[0].split(";")[0];
  const clubNonce = clubStart.headers.getSetCookie()[0].split(";")[0];
  const callbackPath = `/reports/auth/callback?state=${auth.searchParams.get("state")}&code=test`;
  const allCookies = `${both}; ${personalNonce}; ${clubNonce}`;
  const callback = await app.request(callbackPath, allCookies);
  assert.equal(callback.headers.get("location"), "/personal/account?welcome=1");
  assert.equal((await app.personalStore.read()).personalAccount.discordId, id);
  assert.equal(Object.keys((await app.clubStore.read()).members).length, 0);
  assert.equal((await (await app.request("/reports/session", both)).json()).role, "admin");
  assert.equal((await (await app.request("/personal/session", both)).json()).role, "admin");
  const clubAuth = new URL(clubStart.headers.get("location"));
  const clubCallback = await app.request(`/reports/auth/callback?state=${clubAuth.searchParams.get("state")}&code=test`, allCookies);
  assert.equal(clubCallback.headers.get("location"), "/reports/account?welcome=1");
  assert.equal((await app.clubStore.read()).members[id].status, "pending");
  assert.equal((await app.request(callbackPath, allCookies)).status, 403);
  assert.equal(personalRequest(new Request(`${origin}${callbackPath}`, { headers: { cookie: both } })), false);
});

test("mounted publishing keeps raw HTML intact, exposes private personal guide and sends personal URLs only", async () => {
  const app = mountedFixture(), own = await app.login(true), pub = await app.login(true, true), clubPub = await app.login(false, true);
  await app.request("/personal/profile", own, { revision: "0", skills: "Private fixture skill" });
  assert.equal((await app.request("/personal/context", clubPub)).headers.get("location"), "/personal/login/publisher");
  const guide = await (await app.request("/personal/upload?guide=1", pub)).text();
  assert.match(guide, /Private fixture skill/); assert.match(guide, /https:\/\/example.org\/personal\/upload/);
  assert.doesNotMatch(guide, /\{\{REPORTS_BASE_URL\}\}/);
  assert.doesNotMatch(await (await app.request("/reports/upload?guide=1", clubPub)).text(), /Private fixture skill/);
  const stateVersion = (await app.personalStore.read()).workflowVersion;
  const raw = `<html><body><a href="/reports">Original external club reference</a><script type="application/json" id="gammaru-opportunities">${JSON.stringify({ version: 1, audience: "personal", stateVersion, opportunities: [] })}</script></body></html>`;
  const preview = await app.request("/personal/upload/preview", pub, { date: today, title: "Private report", summary: "Private summary", htmlText: raw, notify: "yes" });
  assert.equal(preview.status, 200);
  const previewHtml = await preview.text();
  assert.match(previewHtml, /action="\/personal\/upload\/publish"/);
  assert.match(previewHtml, /src="\/personal\/upload\/preview\//);
  const draft = previewHtml.match(/name="draft" value="([a-f0-9-]+)"/)[1];
  await app.personalStore.update(state => {
    state.personalAccount = { discordId: id, revision: 1 };
    state.members[id] = { id, status: "approved", dm_opt_in: true };
  });
  assert.equal((await app.request("/personal/upload/publish", pub, { draft, confirmed: "yes" })).status, 303);
  assert.equal((await app.clubStore.read()).reports.length, 0);
  assert.equal(await (await app.request(`/personal/${today}/html`, own)).text(), raw);
  assert.match(await (await app.request(`/personal/${today}/html`, clubPub)).text(), /개인 로그인/);
  const viewer = await (await app.request(`/personal/${today}`, own)).text();
  assert.doesNotMatch(viewer, /(?:href|action|src)="\/reports/);
  const sent = [];
  await deliverBriefLinks(app.personalStore, personalConfig(new Request(`${origin}/personal`), app.env), async (url, options) => {
    sent.push({ url, body: JSON.parse(options.body) });
    return Response.json({ id: "300000000000000005" });
  });
  assert.equal(sent.length, 2); assert.deepEqual(sent[0].body, { recipient_id: id });
  assert.ok(sent[1].body.content.includes(`${origin}/personal/${today}`));
  assert.ok(!sent[1].body.content.includes(`${origin}/reports`));
  assert.equal((await app.personalStore.read()).deliveries[`${today}:${id}`].status, "sent");
  assert.equal((await app.personalStore.read()).reports[0].hash, digest(raw));
});

test("missing personal credentials fail closed even when the club is configured", async () => {
  const app = mountedFixture(); delete app.env.PERSONAL_ADMIN_TOKEN;
  assert.equal((await app.request("/personal")).status, 503);
  assert.equal((await app.request("/reports")).status, 200);
});

test("only the personal account page permits OAuth form redirects to Discord", async () => {
  const app = mountedFixture(), own = await app.login(true), club = await app.login(false);
  const policy = response => response.headers.get("content-security-policy").match(/(?:^|; )form-action ([^;]+)/)[1];
  assert.equal(policy(await app.request("/personal/account", own)), "'self' https://discord.com");
  for (const path of ["/personal", "/personal/login/admin", "/personal/profile", "/personal/upload"]) assert.equal(policy(await app.request(path, own)), "'self'");
  assert.equal(policy(await app.request("/reports/account", club)), "'self'");
  const cookie = own.split("=")[1];
  const raw = "<html><body>Private raw HTML</body></html>";
  const draft = await app.personalStore.stage({ date: today, title: "Policy fixture", summary: "", html: raw }, digest(cookie), today);
  assert.equal(policy(await app.request(`/personal/upload/preview/${draft.id}/html`, own)), "'none'");
});
