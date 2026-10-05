import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { configuration, seoulClock } from "../config.mjs";
import { validateReport } from "../schema.mjs";
import { Store } from "../store.mjs";
import { research, factchatResearch, codexEnvironment } from "../providers.mjs";
import { FundingService, notifyDiscord } from "../service.mjs";
import { createFundingServer } from "../server.mjs";
import { exampleReport } from "./fixtures.mjs";

const today = seoulClock().date;
const fixture = () => structuredClone(exampleReport);
const config = (overrides = {}) => ({ ...configuration({ FUNDING_ADMIN_TOKEN: "test-only-operator-password-32-characters", FUNDING_PORT: "0" }), ...overrides });
async function setup(t, options = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "gammaru-test-"));
  const store = new Store(dir);
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  const report = fixture();
  if (options.email) report.opportunities[0].actions = [{ kind: "send_email", title: "후원 문의", recipient: "recipient@example.org", subject: "겜마루 후원 문의", body: "운영자가 검토할 완성된 예시 이메일입니다." }];
  store.startRun(today);
  store.saveReport({ ...validateReport(report, today), date: today, provider: "codex", generatedAt: new Date().toISOString() }, "GAMMARU <sender@example.org>");
  return { store, action: store.state().actions[0], dir };
}

test("report validation rejects expired, malformed, duplicate and executable model output", () => {
  assert.equal(validateReport(fixture(), today).opportunities.length, 2);
  for (const mutate of [
    (r) => { r.opportunities[0].deadline = "2020-01-01"; },
    (r) => { r.opportunities[0].deadline = "2099-02-31"; },
    (r) => { r.opportunities[0].sources[0].url = "javascript:alert(1)"; },
    (r) => { r.opportunities[0].sources[0].url = "https://127.0.0.1/secrets"; },
    (r) => { r.opportunities[0].sources = []; },
    (r) => { r.opportunities[0].actions[0].kind = "run_command"; },
    (r) => { r.opportunities[0].actions[0].command = "anything"; },
    (r) => { r.opportunities[0].eligibility = "ineligible"; },
    (r) => { r.opportunities.push(r.opportunities[0]); },
  ]) { const input = fixture(); mutate(input); assert.throws(() => validateReport(input, today)); }
});

test("Codex has priority; an empty successful search does not consume fallback credits", async () => {
  const empty = { summary: "확인된 공고 없음", searched: ["학생 동아리 지원"], warnings: [], opportunities: [] };
  let fallbackCalls = 0;
  const result = await research(config(), "profile", today, { codex: async () => empty, factchat: async () => { fallbackCalls++; return fixture(); } });
  assert.equal(result.provider, "codex"); assert.equal(fallbackCalls, 0);
});

test("invalid Codex output falls back and failure never becomes a fabricated report", async () => {
  const result = await research(config(), "profile", today, { codex: async () => ({}), factchat: async () => fixture() });
  assert.equal(result.provider, "factchat"); assert.ok(result.fallbackReason);
  await assert.rejects(research(config(), "profile", today, { codex: async () => { throw Error("private provider detail"); }, factchat: async () => { throw Error("failure"); } }));
});

test("FactChat requests real web search and rejects ungrounded or incomplete answers", async () => {
  const fc = config({ factchatKey: "test-only-key", factchatModel: "configured-model" });
  let request;
  const response = { status: "completed", output: [{ type: "web_search_call", status: "completed" }, { type: "message", content: [{ type: "output_text", text: JSON.stringify(fixture()) }] }] };
  const result = await factchatResearch(fc, "prompt", async (url, options) => { request = { url, body: JSON.parse(options.body) }; return Response.json(response); });
  assert.equal(result.summary, exampleReport.summary);
  assert.ok(request.url.endsWith("/responses/")); assert.equal(request.body.tools[0].type, "web_search"); assert.equal(request.body.tool_choice, "required");
  await assert.rejects(factchatResearch(fc, "prompt", async () => Response.json({ ...response, output: response.output.slice(1) })));
  await assert.rejects(factchatResearch(fc, "prompt", async () => Response.json({ ...response, status: "incomplete" })));
});

test("model process does not inherit application secrets", () => {
  const result = codexEnvironment(config({ codexHome: "/dedicated/auth" }), { PATH: "/bin", HOME: "/service-user", DISCORD_WEBHOOK_URL: "test-secret", FACTCHAT_API_KEY: "test-secret", FUNDING_ADMIN_TOKEN: "test-secret", OPENAI_API_KEY: "test-secret", RESEND_API_KEY: "test-secret" });
  assert.deepEqual(Object.keys(result).sort(), ["CODEX_HOME", "HOME", "PATH"]);
});

test("daily reports deduplicate recurring action proposals", async (t) => {
  const { store } = await setup(t);
  const date = "2099-01-02";
  const report = fixture(); report.opportunities[0].sources[0].url += "?utm_source=newsletter";
  store.startRun(date);
  store.saveReport({ ...validateReport(report, date), date, provider: "codex" }, "GAMMARU <sender@example.org>");
  assert.equal(store.state().actions.length, 1); assert.equal(store.state().reports.length, 2);
});

test("execution requires the exact approved revision; editing invalidates approval", async (t) => {
  const { store, action } = await setup(t);
  assert.throws(() => store.claim(action.id, today));
  assert.throws(() => store.approve(action.id, "stale-hash", today));
  store.approve(action.id, action.hash, today);
  store.edit(action.id, action.hash, { recipient: "", subject: "", body: "변경한 내용" });
  assert.throws(() => store.claim(action.id, today));
  assert.throws(() => store.approve(action.id, action.hash, today));
  const edited = store.action(action.id);
  store.approve(action.id, edited.hash, today);
  const service = new FundingService(store, config());
  await service.execute(action.id);
  assert.equal(store.action(action.id).result.document, "변경한 내용");
  await assert.rejects(service.execute(action.id));
});

test("expired approvals and deadlines cannot execute", async (t) => {
  const { store, action } = await setup(t);
  store.approve(action.id, action.hash, today);
  store.db.prepare("UPDATE actions SET approved_at=? WHERE id=?").run("2020-01-01T00:00:00Z", action.id);
  assert.throws(() => store.claim(action.id, today));
  store.db.prepare("UPDATE actions SET status='pending',deadline='2020-01-01' WHERE id=?").run(action.id);
  assert.throws(() => store.approve(action.id, action.hash, today));
});

test("concurrent email execution sends one immutable payload with an idempotency key", async (t) => {
  const { store, action } = await setup(t, { email: true });
  store.approve(action.id, action.hash, today);
  let count = 0; let request;
  const service = new FundingService(store, config({ resendKey: "test-key", emailFrom: action.payload.from }), { fetch: async (_url, options) => { count++; request = options; return Response.json({ id: "email-example-id" }); } });
  const results = await Promise.allSettled([service.execute(action.id), service.execute(action.id)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(count, 1);
  assert.deepEqual(JSON.parse(request.body), { from: action.payload.from, to: [action.payload.recipient], subject: action.payload.subject, text: action.payload.body });
  assert.ok(request.headers["idempotency-key"].includes(action.hash));
});

test("ambiguous external outcomes and crash recovery never automatically resend", async (t) => {
  const { store, action } = await setup(t, { email: true });
  store.approve(action.id, action.hash, today);
  let calls = 0;
  const service = new FundingService(store, config({ resendKey: "test-key", emailFrom: action.payload.from }), { fetch: async () => { calls++; throw Error("timeout"); } });
  await service.execute(action.id);
  assert.equal(store.action(action.id).status, "uncertain");
  await assert.rejects(service.execute(action.id)); assert.equal(calls, 1);
  store.db.prepare("UPDATE actions SET status='executing' WHERE id=?").run(action.id);
  store.recover(); assert.equal(store.action(action.id).status, "uncertain");
  store.resolve(action.id, "completed"); assert.equal(store.action(action.id).status, "completed");
});

test("Seoul schedule catches up once after startup and does not retry failed research on every tick", async (t) => {
  const { store, dir } = await setup(t);
  const profilePath = path.join(dir, "profile.md"); await writeFile(profilePath, "겜마루");
  let calls = 0;
  const service = new FundingService(store, config({ schedule: true, profilePath }), { now: () => new Date("2090-01-01T00:05:00Z"), research: async () => { calls++; throw Error("provider unavailable"); } });
  assert.deepEqual(seoulClock(new Date("2090-01-01T15:01:00Z")), { date: "2090-01-02", hour: 0 });
  await service.tick(); await service.running;
  await service.tick(); assert.equal(calls, 1);
  const run = store.state().runs.find((r) => r.date === "2090-01-01"); assert.equal(run.status, "failed");
});

test("Discord gets only the report URL with mentions and embeds disabled", async () => {
  let request;
  const result = await notifyDiscord(config({ origin: "https://funding.example.org", discordWebhook: "https://discord.com/api/webhooks/123/test-only-token" }), today, async (_url, options) => { request = JSON.parse(options.body); return Response.json({ id: "notification" }); });
  assert.equal(result, "sent"); assert.equal(request.content, `https://funding.example.org/?report=${today}`);
  assert.deepEqual(request.allowed_mentions, { parse: [] }); assert.equal(request.flags, 4);
});

test("HTTP API protects private reports, enforces CSRF and executes only reviewed content", async (t) => {
  const { store, action } = await setup(t);
  const c = config();
  const app = createFundingServer(c, { store });
  app.server.listen(0, "127.0.0.1"); await once(app.server, "listening");
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  c.origin = origin;
  t.after(() => new Promise((resolve) => app.server.close(resolve)));
  assert.equal((await fetch(`${origin}/api/state`)).status, 401);
  const login = await fetch(`${origin}/api/session`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ token: c.token }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  assert.match(login.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
  const data = await fetch(`${origin}/api/state`, { headers: { cookie } });
  assert.equal(data.status, 200); assert.ok(!JSON.stringify(await data.json()).includes(c.token));
  const send = (host, input) => fetch(`${origin}/api/actions/${action.id}/approve`, { method: "POST", headers: { origin: host, cookie, "content-type": "application/json" }, body: JSON.stringify(input) });
  assert.equal((await send("https://attacker.example", { hash: action.hash, confirmed: true })).status, 403);
  assert.equal((await send(origin, { hash: action.hash, confirmed: false })).status, 400);
  assert.equal((await send(origin, { hash: "stale", confirmed: true })).status, 409);
  assert.equal((await send(origin, { hash: action.hash, confirmed: true })).status, 200);
  assert.equal((await send(origin, { hash: action.hash, confirmed: true })).status, 409);
  const document = await fetch(`${origin}/api/actions/${action.id}/document`, { headers: { cookie } });
  assert.equal(document.status, 200); assert.equal(await document.text(), action.payload.body);
});
