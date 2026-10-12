// Run after REPORTS_DEPLOY_TARGET=aws npm run build. Uses only fake local S3,
// temporary random credentials and a local child; no AWS/Discord writes.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, readdir } from "node:fs/promises";
import path from "node:path";

const standalone = path.resolve(".next/standalone");
for (const entry of await readdir(standalone)) assert.ok(!entry.startsWith(".env"), "No environment files in standalone");
await cp("public", path.join(standalone, "public"), { recursive: true });
await cp(".next/static", path.join(standalone, ".next/static"), { recursive: true });
const rows = new Map(); let sequence = 0;
const s3 = createServer(async (req, res) => {
  const key = req.url.split("?")[0], row = rows.get(key);
  const fail = (status, code) => { res.writeHead(status, { "content-type": "application/xml" }); res.end(`<Error><Code>${code}</Code></Error>`); };
  if (req.method === "GET") {
    if (!row) return fail(404, "NoSuchKey");
    res.writeHead(200, { etag: row.etag }); return res.end(row.body);
  }
  if (req.method === "PUT") {
    if ((req.headers["if-none-match"] === "*" && row) || (req.headers["if-match"] && req.headers["if-match"] !== row?.etag)) return fail(412, "PreconditionFailed");
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const next = { body: Buffer.concat(chunks), etag: `"${++sequence}"` };
    rows.set(key, next); res.writeHead(200, { etag: next.etag }); return res.end();
  }
  fail(405, "MethodNotAllowed");
});
s3.listen(0, "127.0.0.1"); await once(s3, "listening");
const probe = createServer(); probe.listen(0, "127.0.0.1"); await once(probe, "listening");
const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const origin = "https://dexample.cloudfront.net", secret = randomBytes(32).toString("hex");
const child = spawn(process.execPath, ["server.js"], {
  cwd: standalone, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, PORT: String(port), HOSTNAME: "127.0.0.1", NODE_ENV: "production",
    REPORTS_SITE_URL: origin, REPORTS_SERVICE: "club", REPORTS_STORAGE_BACKEND: "s3", REPORTS_TRUST_PROXY: "true",
    REPORTS_S3_BUCKET: "test-report-bucket", REPORTS_S3_REGION: "ap-northeast-2", REPORTS_S3_ACCOUNT_ID: "123456789012",
    AWS_ACCESS_KEY_ID: "local-test-key", AWS_SECRET_ACCESS_KEY: "local-test-secret", AWS_SESSION_TOKEN: "",
    AWS_ENDPOINT_URL_S3: `http://127.0.0.1:${s3.address().port}`, AWS_EC2_METADATA_DISABLED: "true",
    VERCEL: "", REPORTS_AWS_ROLE_ARN: "", FUNDING_ADMIN_TOKEN: secret, FUNDING_PUBLISHER_TOKEN: secret + "a",
    PERSONAL_ADMIN_TOKEN: secret + "b", PERSONAL_PUBLISHER_TOKEN: secret + "c",
    DISCORD_BOT_TOKEN: "", DISCORD_DM_ENABLED: "false", DISCORD_APPLICATION_ID: "", DISCORD_CLIENT_SECRET: "" },
});
child.stdout.resume(); child.stderr.resume();
const closed = once(child, "exit");
// Node fetch can replace Host with its URL's host. Use HTTP directly to match
// nginx's actual forwarded Host (and preserve multiple Set-Cookie headers).
const request = (route, options = {}) => new Promise((resolve, reject) => {
  const body = options.body?.toString();
  const outgoing = httpRequest(`http://127.0.0.1:${port}${route}`, {
    method: options.method || "GET", signal: AbortSignal.timeout(10000),
    headers: { host: "dexample.cloudfront.net", "x-forwarded-host": "dexample.cloudfront.net",
      "x-forwarded-proto": "https", ...(body ? { "content-type": "application/x-www-form-urlencoded", "content-length": Buffer.byteLength(body) } : {}), ...options.headers },
  }, async incoming => {
    try {
      const chunks = []; for await (const chunk of incoming) chunks.push(chunk);
      const responseHeaders = new Headers();
      for (let i = 0; i < incoming.rawHeaders.length; i += 2) responseHeaders.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1]);
      resolve(new Response(Buffer.concat(chunks), { status: incoming.statusCode, headers: responseHeaders }));
    } catch (error) { reject(error); }
  });
  outgoing.on("error", reject); outgoing.end(body);
});
try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try { ready = (await request("/")).status === 200; if (ready) break; } catch { /* process is starting */ }
    if (child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, "standalone server starts");
  assert.equal((await request("/brand/gammaru-mark.png")).status, 200);
  assert.ok((await (await request("/sitemap.xml")).text()).includes(origin));
  for (const base of ["/reports", "/personal"]) {
    const login = await request(`${base}/login/publisher`);
    assert.equal(login.status, 200, `${base} accepts the proxy's HTTPS host: ${(await login.text()).slice(-180)}`);
    assert.match(login.headers.get("cache-control"), /no-store/);
    const badOrigin = await request(`${base}/login/publisher`, { method: "POST", headers: { origin: "https://attacker.example" }, body: new URLSearchParams({ password: secret }) });
    assert.equal(badOrigin.status, 403);
    const auth = await request(`${base}/login/publisher`, { method: "POST", headers: { origin }, body: new URLSearchParams({ password: secret + (base === "/reports" ? "a" : "c") }) });
    assert.equal(auth.status, 303);
    assert.equal(auth.headers.get("location"), `${base}/upload`);
    const cookie = auth.headers.getSetCookie()[0];
    assert.match(cookie, /__Host-.*; HttpOnly; SameSite=Lax; Path=\/; Max-Age=\d+; Secure/);
    const guide = await request(`${base}/upload?guide=1`, { headers: { cookie: cookie.split(";")[0] } });
    assert.equal(guide.status, 200);
    const html = await guide.text();
    assert.ok(html.includes(`${origin}${base}/upload`));
    assert.ok(html.includes("stateVersion: 0"), "fresh report state");
    assert.doesNotMatch(html, /\{\{REPORTS_SITE_URL\}\}|\{\{REPORTS_BASE_URL\}\}/);
    const other = base === "/reports" ? "/personal" : "/reports";
    assert.equal((await request(`${other}/upload`, { headers: { cookie: cookie.split(";")[0] } })).status, 303);
  }
  console.log("AWS standalone: static assets, HTTPS proxy, both publisher logins, secure isolated cookies, private guides and CSRF passed (local S3 only).");
} finally {
  child.kill("SIGTERM");
  await closed;
  s3.closeAllConnections();
  await new Promise(resolve => s3.close(resolve));
}
