import test from "node:test";
import assert from "node:assert/strict";
import { setup, today } from "./helpers.mjs";
import { BriefStore } from "../storage.mjs";
import { researchState } from "../opportunities.mjs";
import { deliverBriefLinks } from "../notify.mjs";
import { claimWorkerJob, beginWorkerJob, finishWorkerJob } from "../worker-jobs.mjs";

const channel = "300000000000000001";
const owner = "100000000000000001", other = "100000000000000002";
const opportunity = { id: "resource-one", title: "Fixture opportunity", sourceUrl: "https://example.org/resource", benefit: "Fixture benefit", eligibility: "Verify", deadline: "Verify", nextAction: "Read conditions", changeNote: "" };
const html = (stateVersion, personal = false, text = "Initial") => `<html><body><h1>${text}</h1><script type="application/json" id="gammaru-opportunities">${JSON.stringify({ version: 1, stateVersion, audience: personal ? "personal" : "club", opportunities: [{ ...opportunity, category: personal ? "contest" : "support" }] })}</script></body></html>`;
const input = (stateVersion, options = {}) => ({ date: today, title: "Fixture report", summary: "Fixture summary", html: html(stateVersion), notify: true, ...options });
const revised = (stateVersion, options = {}) => input(stateVersion, { html: html(stateVersion, false, "Updated"), reissue: true, changeReason: "Updated requirements", ...options });
const draftId = async response => {
  assert.equal(response.status, 200);
  return (await response.text()).match(/name="draft" value="([a-f0-9-]+)"/)[1];
};
const upload = (data) => ({ date: data.date, title: data.title, summary: data.summary, htmlText: data.html, notify: data.notify ? "yes" : "", reissue: data.reissue ? "yes" : "", changeReason: data.changeReason || "" });

for (const personal of [false, true]) test(`${personal ? "personal DM" : "club channel"}: explicit same-day reissue preserves history, progress, permissions and revision-specific receipts`, async () => {
  const base = personal ? "/personal" : "/reports";
  const app = setup(personal ? { service: "personal", basePath: base, dmEnabled: true } : { discordReportChannelId: channel });
  const publisher = (await app.session("publisher")).replace(/^briefs=/, personal ? "personal-briefs=" : "briefs=");
  const admin = (await app.session("admin")).replace(/^briefs=/, personal ? "personal-briefs=" : "briefs=");
  await app.member(owner); await app.member(other);
  if (personal) await app.store.update(s => { s.personalAccount = { discordId: owner, revision: 1 }; });
  const initial = input(0, { html: html(0, personal) });
  const firstId = await draftId(await app.request(`${base}/upload/preview`, publisher, upload(initial)));
  assert.equal((await app.request(`${base}/upload/publish`, publisher, { draft: firstId, confirmed: "yes" })).status, 303);
  await app.store.setProgress(opportunity.id, { status: "deferred", note: "Keep my note", revision: 0 }, "admin");
  const progress = structuredClone((await app.store.read()).opportunities[opportunity.id]);
  await app.store.update(s => { Object.values(s.deliveries)[0].status = "sent"; });
  const updated = revised(2, { html: html(2, personal, "Updated conditions") });
  const preview = await app.request(`${base}/upload/preview`, publisher, upload(updated));
  assert.equal(preview.status, 200);
  const markup = await preview.text();
  assert.match(markup, /수정본 v2/); assert.match(markup, /이 수정본 재발행하기/);
  const id = markup.match(/name="draft" value="([a-f0-9-]+)"/)[1];
  assert.equal((await app.request(`${base}/upload/publish`, publisher, { draft: id, confirmed: "yes" })).status, 303);
  assert.equal((await app.request(`${base}/upload/publish`, publisher, { draft: id, confirmed: "yes" })).status, 303);
  const state = await app.store.read(), report = state.reports[0];
  assert.equal(state.reports.length, 1); assert.equal(report.revision, 2);
  assert.equal(report.previousVersions.length, 1);
  assert.equal(await app.store.html(report.previousVersions[0]), initial.html);
  assert.equal(await app.store.html(report), updated.html);
  assert.equal(state.opportunities[opportunity.id].status, progress.status);
  assert.equal(state.opportunities[opportunity.id].note, progress.note);
  assert.deepEqual(state.opportunities[opportunity.id].history, progress.history);
  assert.equal(state.opportunities[opportunity.id].revision, progress.revision);
  const notices = Object.values(state.deliveries);
  assert.equal(notices.length, 2);
  assert.deepEqual(notices.map(row => row.status), ["sent", "pending"]);
  assert.equal(notices[1].revision, 2);
  if (personal) { assert.equal(notices[1].memberId, owner); assert.equal(notices[1].channelId, undefined); }
  else assert.equal(notices[1].channelId, channel);
  const receipt = await (await app.request(`${base}/upload`, publisher)).text();
  assert.match(receipt, /현재 v2/);
  assert.ok(receipt.includes(`href="${base}/${today}">${base}/${today}</a>`));
  assert.match(receipt, /data-delivery-status="sent"><dt>전송 완료<\/dt><dd>0건/);
  assert.match(receipt, /data-delivery-status="pending"><dt>대기<\/dt><dd>1건/);
  const research = researchState(state, personal).previousReports[0];
  assert.equal(research.revision, 2); assert.equal(research.changeReason, updated.changeReason);
  assert.equal(await (await app.request(`${base}/${today}/html`, admin)).text(), updated.html);
  const old = await app.request(`${base}/${today}/html?revision=1`, admin);
  assert.equal(await old.text(), initial.html); assert.match(old.headers.get("content-security-policy"), /script-src 'none'/);
  assert.equal((await app.request(`${base}/${today}/html?revision=3`, admin)).status, 404);
  assert.equal((await app.request(`${base}/${today}/html?revision=1`, publisher)).status, 403);
  assert.doesNotMatch(await (await app.request(`${base}/${today}/html?revision=1`)).text(), /<h1>Initial/);
  const viewer = await (await app.request(`${base}/${today}`, admin)).text();
  assert.match(viewer, new RegExp(`${base}/${today}/html\\?revision=1`));
  assert.match(viewer, /이전 v1 원문 보기/);
});

test("reissue requires explicit selection, existing date, a reason and current research metadata", async () => {
  const app = setup(), publisher = await app.session("publisher");
  await assert.rejects(app.store.stage(revised(0), "owner", today), { status: 409 });
  await app.store.publish(await app.store.stage(input(0), "owner", today), today);
  for (const changeReason of ["", " ", "a".repeat(301)]) await assert.rejects(app.store.stage(revised(1, { changeReason }), "owner", today), { status: 400 });
  await assert.rejects(app.store.stage(revised(1, { html: "<html><body>No metadata</body></html>" }), "owner", today), { status: 400 });
  const ordinary = await app.store.stage(input(1), "owner", today);
  await assert.rejects(app.store.publish(ordinary, today), /수정본으로 재발행/);
  const stale = await app.store.stage(revised(0), "owner", today);
  await assert.rejects(app.store.publish(stale, today), { status: 409 });
  const pending = await app.store.stage(revised(1), "owner", today);
  await app.store.setProgress(opportunity.id, { status: "in_progress", revision: 0 }, "admin");
  await assert.rejects(app.store.publish(pending, today), { status: 409 });
  const member = await app.session("member", await app.member());
  assert.equal((await app.request("/reports/upload/preview", member, upload(revised(2)))).status, 403);
  assert.equal((await app.request("/reports/upload/preview", publisher, upload(revised(2)), "https://wrong.example")).status, 403);
  assert.equal((await app.store.read()).reports[0].revision, 1);
});

test("concurrent reissues commit one version; stale previews cannot roll back a newer edition", async () => {
  const app = setup({ discordReportChannelId: channel }), second = new BriefStore(app.files);
  await app.store.publish(await app.store.stage(input(0), "owner", today), today, channel);
  const draft = await app.store.stage(revised(1), "owner", today);
  const competing = await second.stage(revised(1, { title: "Competing revision" }), "owner", today);
  const results = await Promise.all([app.store.publish(draft, today, channel), second.publish(draft, today, channel)]);
  assert.equal(results.filter(result => result.duplicate).length, 1);
  await assert.rejects(second.publish(competing, today, channel), /다른 수정본/);
  assert.equal((await app.store.read()).reports[0].previousVersions.length, 1);
  await app.store.publish(await app.store.stage(revised(2, { title: "Third edition" }), "owner", today), today, channel);
  await assert.rejects(app.store.publish(draft, today, channel), /다른 수정본/);
  const state = await app.store.read();
  assert.equal(state.reports[0].revision, 3);
  assert.equal(state.reports[0].previousVersions.length, 2);
  assert.deepEqual(Object.values(state.deliveries).map(row => row.status), ["cancelled", "cancelled", "pending"]);
});

test("legacy reports and deliveries count as v1; past-date and opt-out revisions do not notify", async () => {
  const app = setup(); await app.member();
  await app.store.publish(await app.store.stage(input(0), "owner", today), today);
  await app.store.update(s => { delete s.reports[0].revision; delete Object.values(s.deliveries)[0].revision; });
  const draft = await app.store.stage(revised(1, { notify: false }), "owner", today);
  assert.equal(draft.baseRevision, 1);
  await app.store.publish(draft, today);
  let state = await app.store.read();
  assert.equal(state.reports[0].revision, 2);
  assert.equal(Object.values(state.deliveries).length, 1);
  assert.equal(Object.values(state.deliveries)[0].status, "cancelled");
  const past = "2020-01-01";
  await app.store.publish(await app.store.stage(input(2, { date: past }), "owner", today), today);
  await app.store.publish(await app.store.stage(revised(3, { date: past }), "owner", today), today);
  state = await app.store.read();
  assert.equal(Object.values(state.deliveries).length, 1);
});

test("a worker holding an old edition cannot begin it after reissue; the new edition has its own nonce", async () => {
  const app = setup({ discordDeliveryMode: "worker", discordReportChannelId: channel });
  await app.store.publish(await app.store.stage(input(0), "owner", today), today, channel);
  const old = await claimWorkerJob(app.store, app.config);
  await app.store.publish(await app.store.stage(revised(1), "owner", today), today, channel);
  assert.equal(await beginWorkerJob(app.store, app.config, old), false);
  const current = await claimWorkerJob(app.store, app.config);
  assert.match(current.message.content, /수정본 v2/);
  assert.notEqual(current.message.nonce, old.message.nonce);
  assert.equal(current.target.channelId, channel);
  assert.equal(await beginWorkerJob(app.store, app.config, current), true);
  await finishWorkerJob(app.store, { ...current, status: "sent", reference: "400000000000000001" });
  await app.store.queueChannelReport(today, channel);
  assert.equal(await claimWorkerJob(app.store, app.config), null);
});

test("direct notification rechecks revision after opening Discord and sends only the revised personal DM", async () => {
  const app = setup({ service: "personal", basePath: "/personal", dmEnabled: true });
  await app.member(owner); await app.member(other);
  await app.store.update(s => { s.personalAccount = { discordId: owner, revision: 1 }; });
  await app.store.publish(await app.store.stage(input(0, { html: html(0, true) }), "owner", today), today, "", "", true);
  const draft = await app.store.stage(revised(1, { html: html(1, true, "Revised") }), "owner", today);
  let changed = false;
  const messages = [];
  await deliverBriefLinks(app.store, app.config, async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith("/users/@me/channels")) {
      assert.equal(body.recipient_id, owner);
      if (!changed) { changed = true; await app.store.publish(draft, today, "", "", true); }
      return Response.json({ id: channel });
    }
    messages.push(body);
    return Response.json({ id: "400000000000000001" });
  });
  assert.equal(messages.length, 1);
  assert.match(messages[0].content, /개인.*수정본 v2/);
  assert.match(messages[0].content, /\/personal\//);
  assert.deepEqual(Object.values((await app.store.read()).deliveries).map(row => row.status), ["cancelled", "sent"]);
});
