import test from "node:test";
import assert from "node:assert/strict";
import { setup, today } from "./helpers.mjs";
import { manifestFromHtml, researchState } from "../opportunities.mjs";

const item = (overrides = {}) => ({ id: "club-support-example", title: "테스트 동아리 지원", sourceUrl: "https://example.org/support", benefit: "검증용 현물 혜택", eligibility: "학교 동아리 자격 확인 필요", deadline: "테스트 자료 · 실제 모집 아님", nextAction: "동아리 인정 자료를 확인하세요.", ...overrides });
const manifest = (stateVersion = 0, opportunities = [item()]) => ({ version: 1, stateVersion, opportunities });
const html = (value = manifest()) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>Test</title></head><body><h1>진행 관리 검증</h1><script type="application/json" id="gammaru-opportunities">${JSON.stringify(value)}</script></body></html>`;
const publish = async (app, date, value) => app.store.publish(await app.stage("test-owner", date, html(value)), today);

test("HTML metadata creates a shared persistent item; user progress survives subsequent reports and feeds the next research", async () => {
  const app = setup();
  await publish(app, "2026-10-01", manifest());
  await app.store.setProgress(item().id, { status: "deferred", note: "행사 예산 확정 후 검토", revision: 0 }, "admin");
  const feed = researchState(await app.store.read());
  assert.deepEqual(feed.carryForwardIds, [item().id]);
  assert.equal(feed.known[0].note, "행사 예산 확정 후 검토");
  assert.equal(feed.known[0].history, undefined);
  await publish(app, "2026-10-02", manifest(feed.stateVersion, [item({ nextAction: "확정한 예산을 확인하세요." })]));
  const state = await app.store.read();
  assert.equal(Object.keys(state.opportunities).length, 1);
  assert.equal(state.opportunities[item().id].status, "deferred");
  assert.equal(state.opportunities[item().id].note, "행사 예산 확정 후 검토");
  assert.equal(state.opportunities[item().id].lastReported, "2026-10-02");
  assert.equal(state.opportunities[item().id].history.length, 1);
  assert.equal(state.reports[0].opportunities[0].nextAction, item().nextAction, "Historic report metadata stays intact");
  const admin = await app.session("admin");
  assert.match(await (await app.request("/reports/2026-10-01?progress=1", admin)).text(), /행사 예산 확정 후 검토/);
});

test("completed and dismissed items need a reported change to return, without resetting the user's decision", async () => {
  for (const status of ["completed", "dismissed"]) {
    const app = setup(); await publish(app, "2026-10-01", manifest());
    await app.store.setProgress(item().id, { status, note: "운영진 결정", revision: 0 }, "admin");
    const feed = researchState(await app.store.read());
    assert.deepEqual(feed.carryForwardIds, []);
    assert.deepEqual(feed.excludedUnlessChangedIds, [item().id]);
    await assert.rejects(publish(app, "2026-10-02", manifest(feed.stateVersion)), /변화/);
    await publish(app, "2026-10-02", manifest(feed.stateVersion, [item({ changeNote: "공식 원문에서 다음 모집 일정 변경 확인" })]));
    assert.equal((await app.store.read()).opportunities[item().id].status, status);
  }
});

test("stale daily research and simultaneous status edits cannot overwrite a newer decision", async () => {
  const app = setup(); await publish(app, "2026-10-01", manifest());
  const oldVersion = (await app.store.read()).workflowVersion;
  const edits = await Promise.allSettled([
    app.store.setProgress(item().id, { status: "in_progress", note: "자료 준비", revision: 0 }, "admin"),
    app.store.setProgress(item().id, { status: "deferred", note: "보류", revision: 0 }, "admin"),
  ]);
  assert.equal(edits.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(edits.find((result) => result.status === "rejected").reason.status, 409);
  await assert.rejects(publish(app, "2026-10-02", manifest(oldVersion)), /기록이 변경/);
  assert.equal((await app.store.read()).reports.length, 1);
  assert.equal(Object.keys((await app.store.read()).deliveries).length, 0);
});

test("approved subscribers and admins can change shared progress; publishers and revoked members cannot", async () => {
  const app = setup(); await publish(app, "2026-10-01", manifest());
  const admin = await app.session("admin"), publisher = await app.session("publisher"), member = await app.session("member", await app.member());
  const pathname = `/reports/opportunities/${item().id}/status`;
  const form = { status: "in_progress", note: '<img src=x onerror="alert(1)">', revision: "0", date: "2026-10-01" };
  const pendingId = await app.member("100000000000000003", "pending"), pending = await app.session("member", pendingId);
  for (const cookie of ["", pending, publisher]) assert.equal((await app.request(pathname, cookie, form)).status, 403);
  assert.equal((await app.request(pathname, admin, form, "https://other.example")).status, 403);
  assert.equal((await app.request(pathname, member, form)).status, 303);
  assert.equal((await app.request(pathname, admin, form)).status, 409);
  assert.equal((await app.request("/reports/research-state")).status, 403);
  assert.equal((await app.request("/reports/research-state", member)).status, 403);
  const response = await app.request("/reports/research-state", publisher);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await response.json()).known[0].status, "in_progress");
  const viewer = await (await app.request("/reports/2026-10-01", member)).text();
  assert.match(viewer, /&lt;img src=x/); assert.doesNotMatch(viewer, /<img src=x/);
  assert.match(viewer, /<select name="status"/);
  assert.equal((await app.request(pathname, admin, { ...form, status: "deferred", revision: "1" })).status, 303);
  await app.store.update((state) => { state.members["100000000000000001"].status = "revoked"; });
  assert.equal((await app.request(pathname, member, { ...form, revision: "2" })).status, 403);
  await assert.rejects(app.store.setProgress(item().id, { status: "completed", note: "", revision: 2 }, "100000000000000001", "100000000000000001"), /구독 승인이 변경/);
  assert.equal((await app.request("/reports/progress", publisher)).status, 403);
});

test("malformed or hostile metadata fails staging, while duplicate source identities cannot become new items", async () => {
  const invalid = [
    manifest(0, [item({ id: "constructor" })]), manifest(0, [item({ sourceUrl: "javascript:alert(1)" })]),
    manifest(0, [item({ sourceUrl: "https://user:password@example.org" })]),
    manifest(0, [item({ status: "completed" })]), manifest(0, [item(), item()]),
    manifest(0, [item({ title: "" })]), manifest(-1), { version: 1, opportunities: [] },
  ];
  for (const input of invalid) assert.throws(() => manifestFromHtml(html(input)));
  assert.throws(() => manifestFromHtml(html().replace("application/json", "text/javascript")));
  assert.throws(() => manifestFromHtml(html().replace("</body>", html() + "</body>")));
  assert.equal(manifestFromHtml("<html><body>Legacy</body></html>"), null);
  const app = setup(); await publish(app, "2026-10-01", manifest());
  await assert.rejects(publish(app, "2026-10-02", manifest(1, [item({ id: "another-id", sourceUrl: "https://example.org/support/?utm_source=daily#content" })])), /기존 ID/);
  await assert.rejects(publish(app, "2026-10-02", manifest(1, [item({ sourceUrl: "https://example.org/different" })])), /다른 기회/);
});

test("existing report metadata can be attached once without rewriting HTML or sending another notification", async () => {
  const app = setup(); await app.store.publish(await app.stage("test-owner", "2026-10-01"), today);
  const before = (await app.store.read()).reports[0], original = await app.store.html(before);
  const admin = await app.session("admin"), publisher = await app.session("publisher");
  const input = { manifest: JSON.stringify(manifest()) };
  const endpoint = "/reports/2026-10-01/opportunities";
  assert.equal((await app.request(endpoint, publisher, input)).status, 403);
  assert.equal((await app.request(endpoint, admin, input)).status, 303);
  assert.equal((await app.request(endpoint, admin, input)).status, 409);
  const state = await app.store.read();
  assert.equal(state.reports[0].hash, before.hash);
  assert.equal(await app.store.html(state.reports[0]), original);
  assert.equal(Object.keys(state.deliveries).length, 0);
  assert.equal(state.reports[0].opportunities.length, 1);
});
