import test from "node:test";
import assert from "node:assert/strict";
import { proxyRequest } from "../router.mjs";

const origin = "https://dexample.cloudfront.net";
const env = { REPORTS_TRUST_PROXY: "true", REPORTS_SITE_URL: origin };
const headers = { host: "dexample.cloudfront.net", "x-forwarded-host": "dexample.cloudfront.net", "x-forwarded-proto": "https" };

test("AWS proxy preserves path, query, body, Origin and cookies while normalizing only the origin", async () => {
  const request = new Request("http://127.0.0.1:3000/personal/upload?guide=1", {
    method: "POST", headers: { ...headers, origin, cookie: "__Host-personal-briefs=test" },
    body: new URLSearchParams({ status: "deferred" }),
  });
  const normalized = proxyRequest(request, env);
  assert.equal(normalized.url, `${origin}/personal/upload?guide=1`);
  assert.equal(normalized.headers.get("origin"), origin);
  assert.equal(normalized.headers.get("cookie"), "__Host-personal-briefs=test");
  assert.equal((await normalized.formData()).get("status"), "deferred");
});

test("forwarded headers are rejected unless all match the configured HTTPS proxy", () => {
  for (const key of ["host", "x-forwarded-host", "x-forwarded-proto"]) {
    for (const value of ["", "attacker.example", "https, http"]) {
      assert.equal(proxyRequest(new Request(`${origin}/reports`, { headers: { ...headers, [key]: value } }), env), null);
    }
  }
  assert.equal(proxyRequest(new Request(`${origin}/reports`, { headers }), { ...env, REPORTS_SITE_URL: "http://dexample.cloudfront.net" }), null);
});

test("Vercel and other deployments never normalize request origin by default", () => {
  const request = new Request("http://127.0.0.1:3000/reports", { headers });
  assert.equal(proxyRequest(request, {}), request);
});
