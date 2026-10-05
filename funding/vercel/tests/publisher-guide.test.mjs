import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setup, today } from "./helpers.mjs";
import { esc } from "../../portal/views.mjs";

const endpoint = "/reports/upload?guide=1";

test("browser research guide is private and available only to publishers and admins", async () => {
  const app = setup();
  for (const status of ["approved", "pending", "revoked"]) {
    const member = await app.session("member", await app.member("100000000000000001", status));
    const response = await app.request(endpoint, member);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/reports/login/publisher");
    assert.equal(await response.text(), "");
  }
  assert.equal((await app.request(endpoint)).status, 303);
  for (const role of ["publisher", "admin"]) {
    const response = await app.request(endpoint, await app.session(role));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("vary"), "Cookie");
    assert.equal(response.headers.get("content-disposition"), null);
    const html = await response.text();
    for (const value of [app.config.token, app.config.publisherToken, "test-member", "100000000000000001"]) assert.ok(!html.includes(value));
  }
});

test("guide includes full escaped sources and changing research data without mutating or exposing history", async () => {
  const app = setup(), cookie = await app.session("publisher");
  const item = { id: "guide-test", title: "Guide test", sourceUrl: "https://example.org/support", benefit: "Benefit", eligibility: "Eligibility", deadline: "Verify", nextAction: "Check eligibility", changeNote: "" };
  const manifest = { version: 1, stateVersion: 0, opportunities: [item] };
  const html = `<!doctype html><html><body><h1>Test</h1><script type="application/json" id="gammaru-opportunities">${JSON.stringify(manifest)}</script></body></html>`;
  await app.store.publish(await app.stage("test-owner", today, html), today);
  const note = '</pre><img src=x onerror="alert(1)"> & review';
  await app.store.setProgress(item.id, { status: "deferred", note, revision: 0 }, "private-actor");
  const before = await app.store.read();
  const first = await (await app.request(endpoint, cookie)).text();
  assert.ok(first.includes("&lt;/pre&gt;&lt;img"));
  assert.ok(!first.includes(note));
  assert.ok(!first.includes("private-actor"));
  assert.match(first, /오늘 보고서 <strong>등록됨/);
  const feed = await (await app.request("/reports/research-state", cookie)).json();
  delete feed.generatedAt;
  const decode = (text) => text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const embedded = JSON.parse(decode(first.match(/<pre id="research-state-json">([\s\S]*?)<\/pre>/)[1]));
  delete embedded.generatedAt;
  assert.deepEqual(embedded, feed);
  for (const file of ["docs/dots-daily-brief.md", "Design.md", "gammaruInfo.md"]) assert.ok(first.includes(esc(await readFile(file, "utf8"))));
  assert.deepEqual(await app.store.read(), before, "Reading the guide does not change shared state");
  await app.store.setProgress(item.id, { status: "in_progress", note: "Updated review", revision: 1 }, "private-actor");
  const refreshed = await (await app.request(endpoint, cookie)).text();
  assert.match(refreshed, /stateVersion: 3/);
  assert.match(refreshed, /Updated review/);
  assert.ok(!refreshed.includes("&lt;/pre&gt;&lt;img"));
});

test("upload navigation uses the HTML guide while existing data endpoints retain their formats", async () => {
  const app = setup(), cookie = await app.session("publisher");
  const upload = await (await app.request("/reports/upload", cookie)).text();
  for (const name of ["instructions", "design", "context", "research-state"]) {
    assert.ok(upload.includes(`href="/reports/upload?guide=1#${name}"`));
    const response = await app.request(`/reports/${name}`, cookie);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), name === "research-state" ? "application/json; charset=utf-8" : "text/plain; charset=utf-8");
  }
});
