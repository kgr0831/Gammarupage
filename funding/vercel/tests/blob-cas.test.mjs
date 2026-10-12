import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PrivateBlobFiles, BriefStore } from "../storage.mjs";
import { setup } from "./helpers.mjs";
import { digest } from "../../schema.mjs";

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

test("worker hints and immutable HTML use CDN cache, but state reads and CAS always bypass it", async () => {
  const previous = getGlobalDispatcher(), agent = new MockAgent();
  agent.disableNetConnect(); setGlobalDispatcher(agent);
  const initial = { version: 1, reports: [], members: {}, sessions: {}, oauth: {}, attempts: {}, deliveries: {} };
  const pool = agent.get("https://teststore.private.blob.vercel-storage.com");
  pool.intercept({ method: "GET", path: "/gammaru/briefs/index-v1.json" }).reply(200, JSON.stringify({ ...initial, workflowVersion: 1 }), { headers: { etag: '"stale"' } });
  pool.intercept({ method: "GET", path: "/gammaru/briefs/index-v1.json?cache=0" }).reply(200, JSON.stringify({ ...initial, workflowVersion: 2 }), { headers: { etag: '"fresh"' } }).times(2);
  pool.intercept({ method: "GET", path: "/gammaru/briefs/html/immutable.html" }).reply(200, "immutable HTML");
  agent.get("https://vercel.com").intercept({ method: "PUT", path: /^\/api\/blob\/\?/ }).reply(options => {
    assert.equal(new Headers(options.headers).get("x-if-match"), '"fresh"');
    assert.equal(JSON.parse(options.body).workflowVersion, 3);
    return { statusCode: 200, data: JSON.stringify({ etag: '"next"' }) };
  });
  try {
    const files = new PrivateBlobFiles("vercel_blob_rw_teststore_test-only"), store = new BriefStore(files);
    assert.equal((await store.readWorkerHint()).workflowVersion, 1);
    assert.equal((await store.read()).workflowVersion, 2);
    await store.update(state => { state.workflowVersion++; });
    assert.equal(await store.html({ path: "gammaru/briefs/html/immutable.html", hash: digest("immutable HTML") }), "immutable HTML");
    agent.assertNoPendingInterceptors();
  } finally { setGlobalDispatcher(previous); await agent.close(); }
});

test("restricted reads and suspended writes show safe storage guidance without losing data", async () => {
  const previous = getGlobalDispatcher(), agent = new MockAgent();
  agent.disableNetConnect(); setGlobalDispatcher(agent);
  const pool = agent.get("https://teststore.private.blob.vercel-storage.com");
  pool.intercept({ method: "GET", path: "/gammaru/briefs/index-v1.json?cache=0" }).reply(403, "Denied").persist();
  agent.get("https://vercel.com").intercept({ method: "PUT", path: /^\/api\/blob\/\?/ }).reply(403, { error: { code: "store_suspended", message: "Provider detail must not be exposed" } });
  try {
    const files = new PrivateBlobFiles("vercel_blob_rw_teststore_test-only");
    await assert.rejects(files.read("gammaru/briefs/index-v1.json"), { status: 503, code: "BLOB_READ_RESTRICTED" });
    await assert.rejects(files.write("gammaru/briefs/index-v1.json", "{}"), { status: 503, code: "BLOB_STORE_SUSPENDED" });
    const app = setup({}, { store: new BriefStore(files) });
    const response = await app.request("/reports/login/publisher");
    assert.equal(response.status, 503);
    const html = await response.text();
    assert.match(html, /사용량 한도/);
    assert.doesNotMatch(html, /vercel_blob_rw_|Provider detail|Token expired/);
  } finally { setGlobalDispatcher(previous); await agent.close(); }
});
