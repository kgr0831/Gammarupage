import test from "node:test";
import assert from "node:assert/strict";
import { BriefStore } from "../storage.mjs";
import { retentionCutoff, pruneReports } from "../retention.mjs";
import { handleRetention } from "../maintenance.mjs";
import { MemoryFiles, setup, sampleHtml } from "./helpers.mjs";
import { digest } from "../../schema.mjs";
import { researchState } from "../opportunities.mjs";

const today = "2026-10-12", now = new Date("2026-10-11T15:00:00Z");
async function seed(store, date, html = sampleHtml) {
  const hash = digest(html), path = `${store.namespace}/html/${date}/${hash}.html`;
  await store.files.write(path, html);
  const report = { date, path, hash, title: date, summary: "Fixture", revision: 1 };
  await store.update(state => { state.reports.push(report); });
  return report;
}

test("seven calendar days use Korea's date, including month and leap-year boundaries", () => {
  assert.equal(retentionCutoff(today), "2026-10-06");
  assert.equal(retentionCutoff("2024-03-01"), "2024-02-24");
  assert.throws(() => retentionCutoff("2026-02-30"));
});

test("pruning deletes all expired HTML editions and receipts but preserves decisions, identity and private notes", async () => {
  const files = new MemoryFiles(), store = new BriefStore(files), other = new BriefStore(files, "personal/briefs");
  const old = await seed(store, "2026-10-05"), keep = await seed(store, "2026-10-06");
  const otherOld = await seed(other, "2026-10-05");
  const priorHtml = sampleHtml + "prior", priorPath = `${store.namespace}/html/${old.date}/${digest(priorHtml)}.html`;
  await files.write(priorPath, priorHtml);
  await store.update(state => {
    state.reports[0].previousVersions = [{ ...old, path: priorPath, hash: digest(priorHtml) }];
    state.members.reader = { status: "approved", progress: { item: { status: "deferred", note: "Private note" } } };
    state.opportunities.item = { id: "item", sourceUrl: "https://example.org/old", lastReported: old.date, status: "deferred", note: "Keep for next research" };
    state.deliveries.old = { date: old.date, status: "sent" };
    state.deliveries.keep = { date: keep.date, status: "sent" };
    state.personalProfile = { biography: "Private profile" };
  });
  const before = await store.read(), result = await pruneReports(store, today), after = await store.read();
  assert.deepEqual(result, { cutoff: "2026-10-06", removedReports: 1, deletedHtml: 2, pendingDeletes: 0 });
  assert.deepEqual(after.members, before.members);
  assert.deepEqual(after.opportunities, before.opportunities);
  assert.deepEqual(after.personalProfile, before.personalProfile);
  assert.equal(after.workflowVersion, before.workflowVersion + 1);
  assert.deepEqual(Object.keys(after.deliveries), ["keep"]);
  assert.deepEqual(researchState(after).carryForwardIds, ["item"]);
  assert.equal(await files.read(old.path), null);
  assert.equal(await files.read(priorPath), null);
  assert.ok(await files.read(keep.path));
  assert.ok(await files.read(otherOld.path));
  const writes = files.sequence;
  await pruneReports(store, today);
  assert.equal(files.sequence, writes, "An idle cleanup must not rewrite the index");
});

test("an interrupted deletion remains queued and resumes without resetting workflow state", async () => {
  const store = new BriefStore(new MemoryFiles());
  const old = await seed(store, "2026-10-05");
  const remove = store.files.remove.bind(store.files);
  store.files.remove = async () => { throw new Error("Temporary failure"); };
  assert.equal((await pruneReports(store, today)).pendingDeletes, 1);
  assert.equal((await store.read()).reports.length, 0);
  assert.ok(await store.files.read(old.path));
  const version = (await store.read()).workflowVersion;
  store.files.remove = remove;
  const result = await pruneReports(store, today);
  assert.equal(result.deletedHtml, 1);
  assert.equal(result.pendingDeletes, 0);
  assert.equal((await store.read()).workflowVersion, version);
});

test("cleanup refuses to delete another namespace, current HTML or the state index", async () => {
  for (const path of ["personal/briefs/html/2026-10-05/" + "a".repeat(64) + ".html", "gammaru/briefs/index-v1.json", "gammaru/briefs/html/2026-10-12/" + "a".repeat(64) + ".html"]) {
    const store = new BriefStore(new MemoryFiles());
    await store.update(state => { state.reports = [{ date: "2026-10-05", path }]; });
    await assert.rejects(pruneReports(store, today), { status: 503 });
    assert.equal((await store.read()).reports.length, 1);
  }
});

test("expired URLs disappear before cron; staging and delayed publication cannot resurrect them", async () => {
  const app = setup({}, { now: () => now }), admin = await app.session("admin");
  const old = await seed(app.store, "2026-10-05");
  await seed(app.store, "2026-10-06");
  assert.equal((await app.request(`/reports/${old.date}`, admin)).status, 404);
  assert.equal((await app.request(`/reports/${old.date}/html`, admin)).status, 404);
  assert.equal((await app.request("/reports/2026-10-06", admin)).status, 200);
  assert.doesNotMatch(await (await app.request("/reports", admin)).text(), /2026-10-05/);
  await assert.rejects(app.store.stage({ date: old.date, title: "Old", html: sampleHtml, summary: "" }, "owner", today), /최근 7일/);
  const draft = await app.store.stage({ date: old.date, title: "Old", html: sampleHtml, summary: "" }, "owner", "2026-10-11");
  await assert.rejects(app.store.publish(draft, today), /최근 7일/);
});

test("daily cleanup requires a machine secret, runs both services, and reports partial failure", async () => {
  const env = { CRON_SECRET: "test-retention-secret-".repeat(3) };
  const stores = { club: new BriefStore(new MemoryFiles()), personal: new BriefStore(new MemoryFiles(), "personal/briefs") };
  await seed(stores.club, "2026-10-05"); await seed(stores.personal, "2026-10-05");
  const request = auth => new Request("https://example.org/api/maintenance/report-retention", { headers: { authorization: auth } });
  assert.equal((await handleRetention(request(""), { env, stores, now })).status, 401);
  stores.personal.files.remove = async () => { throw Error("Unavailable"); };
  const response = await handleRetention(request(`Bearer ${env.CRON_SECRET}`), { env, stores, now });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const { results } = await response.json();
  assert.equal(results[0].deletedHtml, 1); assert.equal(results[1].pendingDeletes, 1);
});
