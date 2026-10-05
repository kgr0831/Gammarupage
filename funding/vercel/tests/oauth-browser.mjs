import { createServer } from "node:http";
import { once } from "node:events";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { setup } from "./helpers.mjs";

// Use a second origin for the provider. A same-origin mock hides form-action
// violations and incorrectly passes when the browser cannot leave the account page.
let providerVisits = 0;
const provider = createServer((req, res) => {
  const url = new URL(req.url, "http://provider.invalid");
  if (req.method !== "GET" || url.pathname !== "/oauth2/authorize" || req.headers["content-length"]) { res.writeHead(400); res.end(); return; }
  providerVisits++;
  const callback = new URL(url.searchParams.get("redirect_uri"));
  callback.searchParams.set("state", url.searchParams.get("state")); callback.searchParams.set("code", "mock");
  res.setHeader("Content-Type", "text/html");
  res.end(`<h1>Discord authorization fixture</h1><a href="${callback}">Authorize fixture</a>`);
});
provider.listen(0, "127.0.0.1"); await once(provider, "listening");
const providerOrigin = `http://127.0.0.1:${provider.address().port}`;
const app = setup({ service: "personal", basePath: "/personal", oauthCallbackPath: "/personal/auth/callback" }, {
  fetch: async url => String(url).endsWith("/token") ? Response.json({ access_token: "mock-token", token_type: "Bearer" }) : Response.json({ id: "100000000000000001", username: "browser-owner" }),
});
const server = createServer(async (req, res) => {
  try {
    const response = await app.handler(new Request(`${app.config.origin}${req.url}`, { method: req.method, headers: req.headers, ...(req.method === "POST" ? { body: req, duplex: "half" } : {}) }));
    const headers = { ...Object.fromEntries(response.headers), "set-cookie": response.headers.getSetCookie() };
    // Translate only the provider origin, in both Location and CSP. If the
    // production policy omits Discord, the browser will still block this flow.
    if (headers.location?.startsWith("https://discord.com/")) headers.location = headers.location.replace("https://discord.com", providerOrigin);
    headers["content-security-policy"] = headers["content-security-policy"].replaceAll("https://discord.com", providerOrigin);
    res.writeHead(response.status, headers);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500); res.end("Test bridge failure"); }
});
server.listen(0, "127.0.0.1"); await once(server, "listening"); app.config.origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
try {
  const context = await browser.newContext();
  await context.route("https://discord.com/**", route => route.abort());
  const login = await context.request.post(`${app.config.origin}/personal/login/admin`, { headers: { origin: app.config.origin }, form: { username: app.config.adminUsername, password: app.config.token } });
  assert.equal(login.status(), 200);
  const page = await context.newPage();
  const cspFailures = [];
  page.on("console", msg => { if (msg.type() === "error" && msg.text().includes("form-action")) cspFailures.push("form-action blocked"); });
  await page.goto(`${app.config.origin}/personal/account`);
  await page.getByRole("button", { name: "Discord로 로그인하고 연결", exact: true }).click();
  await page.waitForURL(`${providerOrigin}/**`, { timeout: 7000 });
  await page.getByRole("heading", { name: "Discord authorization fixture" }).waitFor();
  assert.equal(providerVisits, 1); assert.deepEqual(cspFailures, []);
  await page.getByRole("link", { name: "Authorize fixture" }).click();
  await page.waitForURL("**/personal/account?welcome=1");
  assert.equal((await app.store.read()).personalAccount.discordId, "100000000000000001");
  // Relinking uses the same form policy and cross-origin path.
  await page.getByRole("button", { name: "다른 Discord 계정 연결", exact: true }).click();
  await page.waitForURL(`${providerOrigin}/**`, { timeout: 7000 });
  assert.equal(providerVisits, 2); assert.deepEqual(cspFailures, []);
  console.log("Passed: real cross-origin OAuth navigation, session-bound callback and relinking. Discord responses mocked; no real messages.");
} finally { await browser.close(); await Promise.all([server, provider].map(listener => new Promise(resolve => listener.close(resolve)))); }
