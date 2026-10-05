import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { briefConfig } from "../config.mjs";
import { setup, today, sampleHtml } from "./helpers.mjs";
import { BriefStore, PrivateBlobFiles } from "../storage.mjs";
import { digest } from "../../schema.mjs";
import { deliverBriefLinks } from "../notify.mjs";
import { archive } from "../views.mjs";

test("configured eight-character admin passwords work and rotation invalidates old credentials and sessions", async () => {
  const app = setup();
  const oldPassword = app.config.token;
  const initial = await app.request("/reports/login/admin", "", { username: "admin", password: oldPassword });
  assert.equal(initial.status, 303);
  const oldSession = initial.headers.get("set-cookie").split(";")[0];
  const password = randomBytes(4).toString("hex");
  const request = new Request(`${app.config.origin}/reports`);
  const env = { FUNDING_ADMIN_USERNAME: "admin", FUNDING_ADMIN_TOKEN: password, FUNDING_PUBLISHER_TOKEN: app.config.publisherToken };
  const updated = briefConfig(request, env);
  assert.equal(updated.configured, true);
  assert.equal(briefConfig(request, { ...env, FUNDING_ADMIN_TOKEN: "" }).configured, false);
  assert.equal(briefConfig(request, { ...env, FUNDING_ADMIN_TOKEN: password.slice(1) }).configured, false);
  Object.assign(app.config, updated);
  assert.equal((await app.request("/reports/admin", oldSession)).status, 303);
  assert.equal((await app.request("/reports/login/admin", "", { username: "admin", password: oldPassword })).status, 401);
  const login = await app.request("/reports/login/admin", "", { username: "admin", password });
  assert.equal(login.status, 303);
  assert.equal((await app.request("/reports/admin", login.headers.get("set-cookie").split(";")[0])).status, 200);
});

test("HTML upload, preview, publication and archive preserve original file behind authentication", async () => {
  const app = setup(); const cookie = await app.session("publisher");
  const form = new FormData(); form.set("date", today); form.set("title", "오늘의 후원 정보"); form.set("summary", "검증용"); form.set("notify", "yes"); form.set("html", new File([sampleHtml], "daily.html", { type: "text/html" }));
  const response = await app.request("/reports/upload/preview", cookie, form);
  assert.equal(response.status, 200);
  const previewHtml = await response.text(); const id = previewHtml.match(/name="draft" value="([a-f0-9-]+)"/)[1];
  assert.equal((await app.store.read()).reports.length, 0);
  const frame = await app.request(`/reports/upload/preview/${id}/html`, cookie);
  assert.equal(await frame.text(), sampleHtml); assert.match(frame.headers.get("content-security-policy"), /sandbox/);
  assert.equal((await app.request(`/reports/upload/preview/${id}/html`, await app.session("publisher"))).status, 403);
  assert.equal((await app.request("/reports/upload/publish", cookie, { draft: id, confirmed: "yes" }, "https://other.example")).status, 403);
  assert.equal((await app.request("/reports/upload/publish", cookie, { draft: id, confirmed: "yes" })).status, 303);
  assert.equal((await app.store.read()).reports.length, 1);
  const memberCookie = await app.session("member", await app.member());
  const raw = await app.request(`/reports/${today}/html`, memberCookie);
  assert.equal(raw.headers.get("cache-control"), "private, no-store"); assert.equal(await raw.text(), sampleHtml);
  const listing = await app.request("/reports", memberCookie); assert.match(await listing.text(), /오늘의 후원 정보/);
  assert.match(await (await app.request(`/reports/${today}`, memberCookie)).text(), /전체 보고서 목록/);
});

test("revocation protects both wrapper and raw HTML; publisher cannot read member data or approve", async () => {
  const app = setup(); const id = await app.member(), member = await app.session("member", id), admin = await app.session("admin"), publisher = await app.session("publisher");
  await app.store.publish(await app.stage(), today);
  assert.equal((await app.request(`/reports/${today}`, member)).status, 200);
  assert.equal((await app.request(`/reports/admin/${id}/revoke`, publisher, {})).status, 403);
  assert.equal((await app.request(`/reports/${today}/html`, publisher)).status, 403);
  assert.equal((await app.request(`/reports/admin/${id}/revoke`, admin, {})).status, 303);
  assert.equal((await app.request(`/reports/${today}/html`, member)).status, 403);
  assert.equal((await app.request(`/reports/${today}`, member)).status, 403);
  assert.doesNotMatch(await (await app.request(`/reports/${today}/html`)).text(), /가상 보고서 · 실제 공고 아님/);
  await app.request("/reports/logout", admin, {});
  assert.equal((await app.request("/reports/admin", admin)).status, 303);
});

test("conditional writes across serverless instances preserve both updates and deduplicate publication", async () => {
  const app = setup(); await app.member();
  const second = new BriefStore(app.files);
  await Promise.all([app.store.update((s) => { s.attempts.a = { expires: Date.now() + 100000 }; }), second.update((s) => { s.attempts.b = { expires: Date.now() + 100000 }; })]);
  assert.deepEqual(Object.keys((await app.store.read()).attempts).sort(), ["a", "b"]);
  const draft = await app.stage();
  const results = await Promise.all([app.store.publish(draft, today), second.publish(draft, today)]);
  assert.equal(results.filter((r) => r.duplicate).length, 1);
  assert.equal((await app.store.read()).reports.length, 1);
  assert.equal(Object.keys((await app.store.read()).deliveries).length, 1);
  await assert.rejects(app.store.publish({ ...draft, html: sampleHtml + "different", hash: digest(sampleHtml + "different") }, today), /이미 있습니다/);
  assert.equal(await app.store.html((await app.store.read()).reports[0]), sampleHtml);
});

test("all previous reports remain reachable through paginated searchable archive; backfills do not DM", async () => {
  const app = setup(); await app.member();
  await app.store.publish(await app.stage("owner", "2020-01-01"), today);
  await app.store.publish(await app.stage(), today);
  assert.equal(Object.keys((await app.store.read()).deliveries).length, 1);
  const reports = Array.from({ length: 95 }, (_, i) => ({ date: new Date(Date.UTC(2020, 0, i + 1)).toISOString().slice(0, 10), title: `보고서 ${i}`, summary: "검색 대상" }));
  assert.match(archive(reports, "member", "", 1), /누적 보고서 95개/);
  assert.match(archive(reports, "member", "", 4), /2020-01-01/);
  assert.match(archive(reports, "member", "2020-01-01", 1), /누적 보고서 1개/);
});

test("invalid and oversized files, future dates, missing title and expired previews are rejected", async () => {
  const app = setup();
  for (const fields of [
    { date: "2026-02-30" }, { date: "2099-01-01" }, { title: "" }, { html: "not html" }, { html: `<html><body>${"a".repeat(2100000)}</body></html>` },
  ]) await assert.rejects(app.store.stage({ date: today, title: "valid", summary: "", html: sampleHtml, ...fields }, "owner", today));
  const draft = await app.stage();
  const path = `gammaru/briefs/drafts/${draft.id}.json`, row = app.files.rows.get(path);
  app.files.rows.set(path, { ...row, text: JSON.stringify({ ...draft, expires: 0 }) });
  await assert.rejects(app.store.draft(draft.id, "test-owner"), /만료/);
  await assert.rejects(new PrivateBlobFiles("").read("anything"), /연결/);
});

test("OAuth state is cookie-bound and consumed once; admin password sessions rotate", async () => {
  let calls = 0;
  const app = setup({}, { fetch: async (url) => {
    calls++;
    return String(url).endsWith("token") ? Response.json({ access_token: "test-only-transient", token_type: "Bearer" }) : Response.json({ id: "100000000000000002", username: "member", avatar: null });
  } });
  const start = await app.request("/reports/auth/discord"), auth = new URL(start.headers.get("location"));
  const cookie = start.headers.get("set-cookie").split(";")[0];
  const callback = `/reports/auth/callback?state=${auth.searchParams.get("state")}&code=fake`;
  assert.equal((await app.request(callback)).status, 403); assert.equal(calls, 0);
  assert.equal((await app.request(callback, cookie)).status, 303); assert.equal(calls, 2);
  assert.equal((await app.request(callback, cookie)).status, 403); assert.equal(calls, 2);
  const login = await app.request("/reports/login/admin", "", { username: "admin", password: app.config.token });
  assert.equal(login.status, 303); const admin = login.headers.get("set-cookie").split(";")[0];
  app.config.token = "rotated-to-a-new-admin-password-value";
  assert.equal((await app.request("/reports/admin", admin)).status, 303);
});

test("DM delivery uses only the report URL, skips opt-outs, persists ambiguous outcomes and rate limits", async () => {
  const app = setup({ dmEnabled: true }); await app.member(); await app.member("100000000000000002", "approved", false);
  await app.store.publish(await app.stage(), today);
  let calls = 0; const requests = [];
  const fake = async (url, options) => {
    calls++; requests.push({ url, body: JSON.parse(options.body) });
    return Response.json({ id: "200000000000000001" });
  };
  await deliverBriefLinks(app.store, app.config, fake);
  await deliverBriefLinks(app.store, app.config, fake);
  assert.equal(calls, 2); assert.equal(requests[1].body.content, `${app.config.origin}/reports/${today}`); assert.equal(requests[1].body.flags, 4);
  await app.store.update((s) => { Object.values(s.deliveries)[0].status = "pending"; });
  await deliverBriefLinks(app.store, app.config, async (url) => { if (String(url).endsWith("messages")) throw Error("lost response"); return Response.json({ id: "200000000000000001" }); });
  assert.equal(Object.values((await app.store.read()).deliveries)[0].status, "uncertain");
  await app.store.update((s) => { Object.values(s.deliveries)[0].status = "pending"; });
  await deliverBriefLinks(app.store, app.config, async () => Response.json({ retry_after: 10 }, { status: 429 }));
  const d = Object.values((await app.store.read()).deliveries)[0]; assert.equal(d.status, "pending"); assert.ok(d.retryAt > Date.now());
});
