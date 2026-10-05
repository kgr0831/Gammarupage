import { createServer } from "node:http";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { configuration, seoulClock } from "./config.mjs";
import { Store } from "./store.mjs";
import { FundingService } from "./service.mjs";
import { check } from "./schema.mjs";

function equal(left, right) {
  return typeof left === "string" && Buffer.byteLength(left) === Buffer.byteLength(right) && timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

async function body(request) {
  check(request.headers["content-type"]?.split(";")[0] === "application/json", "JSON 요청이 필요합니다.", 415);
  let bytes = 0; const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    check(bytes <= 65536, "요청이 너무 큽니다.", 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { check(false, "JSON 형식이 올바르지 않습니다."); }
}

export function createFundingServer(config, dependencies = {}) {
  const store = dependencies.store || new Store(config.dataDir);
  const service = new FundingService(store, config, dependencies);
  const sessionSecret = randomBytes(32); // Restart invalidates existing sessions.
  const signature = (value) => createHmac("sha256", sessionSecret).update(value).digest("hex");
  const cookieName = config.secure ? "__Host-funding" : "funding";
  const cookie = (value, age) => `${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${config.secure ? "; Secure" : ""}`;
  const authenticated = (request) => {
    const value = request.headers.cookie?.split(";").map((v) => v.trim()).find((v) => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    if (!value) return false;
    const [expires, nonce, mac] = value.split(".");
    return Number(expires) > Date.now() && equal(mac, signature(`${expires}.${nonce}`));
  };
  const attempts = new Map();
  const assets = new Map([
    ["/", ["index.html", "text/html; charset=utf-8"]],
    ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
    ["/style.css", ["style.css", "text/css; charset=utf-8"]],
  ]);
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const json = (status, value) => { response.writeHead(status, { "content-type": "application/json; charset=utf-8" }); response.end(JSON.stringify(value)); };
    try {
      const url = new URL(request.url, config.origin);
      check(url.origin === config.origin, "잘못된 요청 주소입니다.", 400);
      if (request.method === "GET" && assets.has(url.pathname)) {
        const [name, contentType] = assets.get(url.pathname);
        response.writeHead(200, { "content-type": contentType });
        response.end(await readFile(new URL(`./public/${name}`, import.meta.url)));
        return;
      }
      check(url.pathname.startsWith("/api/"), "페이지를 찾을 수 없습니다.", 404);
      if (request.method !== "GET") {
        check(!config.demo, "미리보기에서는 실행할 수 없습니다.", 403);
        check(request.headers.origin === config.origin, "다른 사이트의 요청은 허용되지 않습니다.", 403);
      }
      if (url.pathname === "/api/session" && request.method === "POST") {
        const now = Date.now();
        // Use the socket identity, never an untrusted forwarded header.
        const address = request.socket.remoteAddress || "unknown";
        for (const [key, value] of attempts) if (now - value.start > 15 * 60 * 1000) attempts.delete(key);
        const attempt = attempts.get(address) || { start: now, count: 0 };
        check(attempt.count < 10, "잠시 후 다시 로그인해 주세요.", 429);
        attempts.set(address, { ...attempt, count: attempt.count + 1 });
        const input = await body(request);
        check(equal(input.token, config.token), "운영자 암호가 맞지 않습니다.", 401);
        attempts.delete(address);
        const value = `${now + 12 * 60 * 60 * 1000}.${randomBytes(16).toString("hex")}`;
        response.setHeader("Set-Cookie", cookie(`${value}.${signature(value)}`, 43200));
        json(200, { ok: true }); return;
      }
      check(config.demo || authenticated(request), "운영자 로그인이 필요합니다.", 401);
      if (url.pathname === "/api/session" && request.method === "DELETE") {
        response.setHeader("Set-Cookie", cookie("", 0)); json(200, { ok: true }); return;
      }
      if (url.pathname === "/api/state" && request.method === "GET") {
        json(200, { ...store.state(), settings: {
          demo: !!config.demo, schedule: config.schedule, hour: config.hour, today: seoulClock().date,
          codexConfigured: !!config.codexHome, factchatConfigured: !!(config.factchatKey && config.factchatModel),
          discordConfigured: !!config.discordWebhook, emailConfigured: !!(config.resendKey && config.emailFrom),
        } }); return;
      }
      if (url.pathname === "/api/run" && request.method === "POST") {
        const input = await body(request);
        json(202, { date: await service.start(input.retry === true) }); return;
      }
      const match = url.pathname.match(/^\/api\/actions\/([a-f0-9-]{36})(?:\/(approve|reject|resolve|document))?$/);
      check(match, "요청을 찾을 수 없습니다.", 404);
      const [, id, operation] = match;
      if (operation === "document" && request.method === "GET") {
        const action = store.action(id);
        check(action.status === "completed" && typeof action.result?.document === "string", "완성된 문서가 없습니다.", 404);
        response.writeHead(200, { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="gammaru-${id}.md"` });
        response.end(action.result.document); return;
      }
      const input = await body(request);
      if (!operation && request.method === "PATCH") store.edit(id, input.hash, input, config.emailFrom);
      else if (operation === "approve" && request.method === "POST") {
        check(input.confirmed === true, "원문과 실행 내용을 확인해 주세요.");
        service.canExecute(store.action(id));
        store.approve(id, input.hash, seoulClock().date);
        await service.execute(id);
      } else if (operation === "reject" && request.method === "POST") store.reject(id);
      else if (operation === "resolve" && request.method === "POST") store.resolve(id, input.outcome);
      else check(false, "허용되지 않는 요청입니다.", 405);
      json(200, { action: store.action(id) });
    } catch (error) {
      if (!response.headersSent) json(error.status || 500, { error: error.status ? error.message : "서버에서 요청을 처리하지 못했습니다." });
      else response.end();
    }
  });
  server.requestTimeout = 35000;
  server.headersTimeout = 10000;
  return { server, store, service };
}

export async function listen(config, dependencies) {
  const app = createFundingServer(config, dependencies);
  await new Promise((resolve, reject) => { app.server.once("error", reject); app.server.listen(config.port, config.host, resolve); });
  app.store.recover();
  const tick = () => app.service.tick().catch(() => console.error("Scheduled research could not start; review the dashboard."));
  const timer = setInterval(tick, 60000);
  timer.unref();
  await tick();
  app.server.on("close", () => clearInterval(timer));
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = configuration();
    await listen(config);
    console.log(`GAMMARU funding dashboard: ${config.origin}`);
  } catch (error) {
    console.error(error.message.startsWith("Set FUNDING_") ? error.message : "Funding server could not start. Check configuration, runtime and port.");
    process.exitCode = 1;
  }
}
