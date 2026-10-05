import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import path from "node:path";
import { LocalFiles } from "../local-files.mjs";
import { BriefStore } from "../storage.mjs";

test("local private storage persists restart state and concurrent updates without path escape", async () => {
  await mkdir(path.resolve("test-results"), { recursive: true });
  const root = await mkdtemp(path.resolve("test-results/personal-storage-"));
  const files = new LocalFiles(root), store = new BriefStore(files, "personal/briefs");
  await Promise.all([store.update(s => { s.testA = "A"; }), store.update(s => { s.testB = "B"; })]);
  const reopened = new BriefStore(new LocalFiles(root), "personal/briefs");
  const state = await reopened.read();
  assert.equal(state.testA, "A"); assert.equal(state.testB, "B");
  for (const key of ["../outside", "personal/briefs/../../outside", "C:/outside", "gammaru/briefs/index-v1.json"]) {
    await assert.rejects(files.read(key), /Invalid/);
    await assert.rejects(files.write(key, "test"), /Invalid/);
  }
});
