import test from "node:test";
import assert from "node:assert/strict";
import { migrateNamespace, handleMigration } from "../migration.mjs";
import { MemoryFiles, setup, today } from "./helpers.mjs";

async function fixture() {
  const app = setup(); await app.member();
  await app.store.publish(await app.stage(), today);
  await app.store.update(state => {
    state.personalProfile = { bio: "Private fixture" };
    state.members["100000000000000001"].progress = { item: { note: "Keep private note" } };
  });
  app.files.list = async prefix => [...app.files.rows.keys()].filter(path => path.startsWith(prefix)).map(pathname => ({ pathname }));
  return app;
}

test("migration verifies every file, preserves exact state, and safely resumes without overwrites", async () => {
  const app = await fixture(), target = new MemoryFiles();
  const before = await app.store.read(), index = app.store.index;
  let completed = false;
  const write = target.write.bind(target);
  target.write = async (path, ...args) => {
    if (path === index) {
      for (const report of before.reports) assert.ok(await target.read(report.path), "Index must be committed after its HTML");
      completed = true;
    }
    return write(path, ...args);
  };
  const result = await migrateNamespace(app.files, target, app.store.namespace);
  assert.equal(result.reports, 1); assert.equal(result.verified, app.files.rows.size); assert.ok(completed);
  assert.equal((await target.read(index)).text, (await app.files.read(index)).text);
  assert.deepEqual(await app.store.read(), before);
  assert.equal((await migrateNamespace(app.files, target, app.store.namespace)).copied, 0);
});

test("unreadable source and corrupted HTML cannot publish an empty or incomplete target index", async () => {
  const app = await fixture(), target = new MemoryFiles();
  await assert.rejects(migrateNamespace(new MemoryFiles(), target, app.store.namespace), /빈 저장소/);
  const report = (await app.store.read()).reports[0], saved = app.files.rows.get(report.path);
  app.files.rows.set(report.path, { ...saved, text: "corrupted" });
  await assert.rejects(migrateNamespace(app.files, target, app.store.namespace), /무결성/);
  assert.equal(await target.read(app.store.index), null);
});

test("source changes during transfer abort and an existing different destination is never replaced", async () => {
  const app = await fixture(), target = new MemoryFiles(), read = app.files.read.bind(app.files);
  let indexReads = 0;
  app.files.read = async path => {
    const result = await read(path);
    if (path === app.store.index && ++indexReads === 2) return { ...result, etag: "new-version" };
    return result;
  };
  await assert.rejects(migrateNamespace(app.files, target, app.store.namespace), /원본 상태가 변경/);
  assert.equal(await target.read(app.store.index), null);
  app.files.read = read;
  const newer = JSON.stringify({ current: "Do not overwrite" });
  await target.write(app.store.index, newer);
  await assert.rejects(migrateNamespace(app.files, target, app.store.namespace), /덮어쓰지/);
  assert.equal((await target.read(app.store.index)).text, newer);
});

test("migration endpoint requires the maintenance credential and is disabled after S3 cutover", async () => {
  const env = { CRON_SECRET: "test-migration-secret-".repeat(3), REPORTS_STORAGE_BACKEND: "s3" };
  const url = "https://example.org/api/maintenance/report-migration";
  assert.equal((await handleMigration(new Request(url, { method: "POST" }), { env })).status, 401);
  const response = await handleMigration(new Request(url, { method: "POST", headers: { authorization: `Bearer ${env.CRON_SECRET}` } }), { env });
  assert.equal(response.status, 409);
});
