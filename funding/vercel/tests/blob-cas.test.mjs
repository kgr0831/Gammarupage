import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PrivateBlobFiles, BriefStore } from "../storage.mjs";

// Exercise the actual Blob SDK HTTP boundary, including delivery ETags.
const { MockAgent, getGlobalDispatcher, setGlobalDispatcher } = createRequire(import.meta.resolve("@vercel/blob"))("undici");
test("private JSON edits retain strong object ETags across repeated conditional writes", async () => {
  const previous = getGlobalDispatcher(), agent = new MockAgent();
  agent.disableNetConnect(); setGlobalDispatcher(agent);
  let version = 1;
  let text = JSON.stringify({ version: 1, reports: [], members: {}, sessions: {}, oauth: {}, attempts: {}, deliveries: {} });
  agent.get("https://teststore.private.blob.vercel-storage.com").intercept({ method: "GET", path: "/gammaru/briefs/index-v1.json?cache=0" }).reply((options) => {
    const encoding = new Headers(options.headers).get("accept-encoding");
    return { statusCode: 200, data: text, responseOptions: { headers: { etag: `${encoding === "identity" ? "" : "W/"}"version-${version}"` } } };
  }).persist();
  agent.get("https://vercel.com").intercept({ method: "PUT", path: /^\/api\/blob\/\?/ }).reply((options) => {
    assert.equal(new Headers(options.headers).get("x-if-match"), `"version-${version}"`, "Compressed response validators cannot protect object updates");
    text = String(options.body); version++;
    return { statusCode: 200, data: JSON.stringify({ etag: `"version-${version}"` }) };
  }).persist();
  try {
    const store = new BriefStore(new PrivateBlobFiles("vercel_blob_rw_teststore_test-only"));
    await store.update((s) => { s.members.first = { status: "pending" }; });
    await store.update((s) => { s.members.first.status = "approved"; });
    assert.equal((await store.read()).members.first.status, "approved");
    assert.equal(version, 3);
  } finally { setGlobalDispatcher(previous); await agent.close(); }
});
