import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { check, digest, reportSchema, validateReport } from "../schema.mjs";
import { seoulClock } from "../config.mjs";
import { FundingService } from "../service.mjs";
import { factchatResearch, researchPrompt } from "../providers.mjs";
import { PortalStore } from "./store.mjs";
import { DiscordNotifier } from "./discord.mjs";
import { layout, hero, loginPage, memberPage, archivePage, adminPage, publisherPage, previewPage, actionsPage } from "./views.mjs";

const equal = (a, b) => typeof a === "string" && typeof b === "string" && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function body(request) {
  check(request.headers["content-type"]?.split(";")[0] === "application/x-www-form-urlencoded", "폼 요청이 필요합니다.", 415);
  let length = 0; const chunks = [];
  for await (const chunk of request) {
    length += chunk.length; check(length <= 1024 * 1024, "입력 크기를 줄여 주세요.", 413); chunks.push(chunk);
  }
  // Browsers serialize textarea newlines as CRLF. Compare and store a canonical form.
  return Object.fromEntries([...new URLSearchParams(Buffer.concat(chunks).toString("utf8"))].map(([key, value]) => [key, value.replace(/\r\n?/g, "\n")]));
}
function submission(raw) {
  check(typeof raw === "string" && raw.length <= 250000, "보고서 JSON이 필요합니다.");
  try { return JSON.parse(raw); } catch { check(false, "보고서 JSON 형식을 확인해 주세요."); }
}

export function createPortal(config, dependencies = {}) {
  const store = dependencies.store || new PortalStore(config.dataDir);
  const fetcher = dependencies.fetch || fetch;
  const now = dependencies.now || (() => new Date());
  const notifier = new DiscordNotifier(store, config, fetcher);
  const service = new FundingService(store, config, {
    ...dependencies,
    research: dependencies.research || (async (settings, profile, date) => ({
      ...validateReport(await factchatResearch(settings, researchPrompt(profile, date), fetcher), date),
      provider: "factchat", fallbackReason: "예약 시각까지 dots 보고서가 도착하지 않아 팩트챗으로 대체했습니다.",
    })),
    notify: async () => { await notifier.drain(); return "dm_queued"; },
  });
  const cookieName = config.secure ? "__Host-gammaru" : "gammaru";
  const stateName = config.secure ? "__Host-gammaru-oauth" : "gammaru-oauth";
  const cookie = (name, value, age) => `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${config.secure ? "; Secure" : ""}`;
  const cookies = (req) => Object.fromEntries((req.headers.cookie || "").split(";").map((s) => s.trim().split("=")).filter((s) => s.length === 2));
  const proof = (role) => role === "admin" ? digest([config.adminUsername, config.token]) : role === "publisher" ? digest(config.publisherToken) : "discord";
  const getSession = (req) => {
    const session = store.session(cookies(req)[cookieName]);
    return session && session.proof === proof(session.role) ? session : null;
  };
  function signIn(req, res, role, subject) {
    store.deleteSession(cookies(req)[cookieName]);
    const age = role === "publisher" ? 30 * 86400 : role === "member" ? 7 * 86400 : 43200;
    const token = store.newSession(role, subject, proof(role), age);
    res.setHeader("Set-Cookie", cookie(cookieName, token, age));
  }
  const attempts = new Map();
  function limit(req, kind, maximum = 10) {
    const timestamp = Date.now();
    for (const [key, item] of attempts) if (timestamp - item.since > 900000) attempts.delete(key);
    const key = `${req.socket.remoteAddress}:${kind}`;
    const item = attempts.get(key) || { since: timestamp, count: 0 };
    check(item.count < maximum, "요청이 많습니다. 15분 후 다시 시도해 주세요.", 429);
    item.count++; attempts.set(key, item);
  }
  async function tick() {
    await notifier.drain();
    const { date, hour } = seoulClock(now());
    if (config.fallbackEnabled && config.factchatKey && config.factchatModel && hour >= config.fallbackHour && !service.running && !store.edition(date) && !store.db.prepare("SELECT date FROM runs WHERE date=?").get(date)) await service.start();
  }
  async function handle(request, response) {
    let url;
    try { url = new URL(request.url, config.origin); } catch { response.writeHead(400); response.end(); return true; }
    const path = url.pathname.replace(/\/$/, "") || "/";
    if (!/^\/(members|admin|publisher)(\/|$)/.test(path)) return false;
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Vary", "Cookie");
    response.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    response.setHeader("X-Content-Type-Options", "nosniff");
    // no-referrer makes native form POSTs carry Origin: null in Chromium.
    // Keep only the origin (never the private report path or OAuth query).
    response.setHeader("Referrer-Policy", "strict-origin");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https://cdn.discordapp.com; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    const send = (code, content, type = "text/html; charset=utf-8") => { response.writeHead(code, { "content-type": type }); response.end(content); };
    const redirect = (target) => { response.writeHead(303, { location: target }); response.end(); };
    try {
      check(url.origin === config.origin, "잘못된 요청 주소입니다.");
      check(["GET", "POST"].includes(request.method), "허용되지 않는 요청입니다.", 405);
      if (request.method === "POST") check(request.headers.origin === config.origin, "다른 사이트의 요청은 허용되지 않습니다.", 403);
      const session = getSession(request);
      const member = session?.role === "member" ? store.member(session.subject) : null;
      const admin = session?.role === "admin";
      const publisher = admin || session?.role === "publisher";
      const oauthConfigured = !!(config.discordApplicationId && config.discordClientSecret);
      if (path === "/members/logout" && request.method === "POST") {
        store.deleteSession(cookies(request)[cookieName]);
        response.setHeader("Set-Cookie", cookie(cookieName, "", 0)); redirect("/members"); return true;
      }
      if (path === "/members/auth/discord" && request.method === "GET") {
        check(oauthConfigured, "Discord 로그인 연결이 아직 설정되지 않았습니다.", 503);
        limit(request, "oauth", 30);
        const state = store.oauthState();
        response.setHeader("Set-Cookie", cookie(stateName, state, 600));
        const auth = new URL("https://discord.com/oauth2/authorize");
        auth.search = new URLSearchParams({ client_id: config.discordApplicationId, response_type: "code", scope: "identify", state, redirect_uri: `${config.origin}/members/auth/callback` }).toString();
        redirect(auth.href); return true;
      }
      if (path === "/members/auth/callback" && request.method === "GET") {
        check(oauthConfigured, "Discord 로그인이 설정되지 않았습니다.", 503);
        const state = url.searchParams.get("state");
        check(equal(state, cookies(request)[stateName]) && store.consumeState(state), "로그인 요청이 만료되었거나 일치하지 않습니다. 다시 로그인해 주세요.", 403);
        response.setHeader("Set-Cookie", cookie(stateName, "", 0));
        const code = url.searchParams.get("code");
        check(code && code.length <= 1024 && !url.searchParams.has("error"), "Discord 로그인이 취소되었습니다.");
        let user;
        try {
          const tokenResponse = await fetcher("https://discord.com/api/oauth2/token", {
            method: "POST", redirect: "error", signal: AbortSignal.timeout(15000), headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ client_id: config.discordApplicationId, client_secret: config.discordClientSecret, grant_type: "authorization_code", code, redirect_uri: `${config.origin}/members/auth/callback` }),
          });
          if (!tokenResponse.ok) throw new Error("OAuth exchange failed");
          const token = await tokenResponse.json();
          if (typeof token.access_token !== "string" || token.token_type?.toLowerCase() !== "bearer") throw new Error("Missing bearer token");
          const profile = await fetcher("https://discord.com/api/v10/users/@me", { headers: { authorization: `Bearer ${token.access_token}` }, redirect: "error", signal: AbortSignal.timeout(15000) });
          if (!profile.ok) throw new Error("Profile failed");
          user = await profile.json();
        } catch { check(false, "Discord 로그인에 실패했습니다. 다시 시도해 주세요.", 502); }
        const signed = store.upsertDiscord(user);
        signIn(request, response, "member", signed.id);
        response.setHeader("Set-Cookie", [response.getHeader("Set-Cookie"), cookie(stateName, "", 0)]);
        redirect("/members"); return true;
      }
      if (["/admin/login", "/publisher/login"].includes(path)) {
        const type = path.startsWith("/admin") ? "admin" : "publisher";
        const configured = type === "admin" || !!config.publisherToken;
        if (request.method === "GET") { send(200, loginPage(type, configured)); return true; }
        check(configured, "보고서 등록 계정이 설정되지 않았습니다.", 503);
        limit(request, "password");
        const input = await body(request);
        check(type === "admin" ? equal(input.username, config.adminUsername) && equal(input.password, config.token) : equal(input.password, config.publisherToken), "로그인 정보를 확인해 주세요.", 401);
        signIn(request, response, type, type); redirect(`/${type}`); return true;
      }
      if (path === "/members" && request.method === "GET") {
        if (admin) redirect("/admin");
        else send(200, member ? memberPage(member) : loginPage("member", oauthConfigured));
        return true;
      }
      if (["/members/subscription", "/members/unsubscribe"].includes(path) && request.method === "POST") {
        check(member, "Discord 로그인이 필요합니다.", 401);
        if (path.endsWith("unsubscribe")) store.unsubscribe(member.id);
        else { const input = await body(request); store.subscribe(member.id, input.name, input.dm === "yes"); }
        redirect("/members"); return true;
      }
      if (path.startsWith("/members/reports") && request.method === "GET") {
        if (!session) { redirect("/members"); return true; }
        check(admin || member?.status === "approved", "승인된 구독자만 보고서를 열람할 수 있습니다.", 403);
        if (path === "/members/reports") send(200, archivePage(store.editions(), admin ? "admin" : "member", seoulClock(now()).date));
        else {
          const match = path.match(/^\/members\/reports\/(\d{4}-\d{2}-\d{2})$/);
          const edition = match && store.edition(match[1]);
          check(edition, "보고서를 찾을 수 없습니다.", 404); send(200, edition.html);
        }
        return true;
      }
      if (path === "/publisher" || path.startsWith("/publisher/")) {
        if (!publisher && request.method === "GET") { redirect("/publisher/login"); return true; }
        check(publisher, "보고서 등록 권한이 필요합니다.", 403);
        const today = seoulClock(now()).date;
        if (request.method === "GET") {
          if (path === "/publisher") send(200, publisherPage(today, !!store.edition(today)));
          else if (path === "/publisher/context") send(200, await readFile(config.profilePath, "utf8"), "text/plain; charset=utf-8");
          else if (path === "/publisher/design") send(200, await readFile(new URL("../../Design.md", import.meta.url), "utf8"), "text/plain; charset=utf-8");
          else if (path === "/publisher/instructions") send(200, `${researchPrompt(await readFile(config.profilePath, "utf8"), today)}\n\n발행 대상: ${today}\n입력: {"date":"${today}","checkedAt":"원문 확인 시각 ISO 8601 (예: ${now().toISOString()})","report": 조사 결과}\nreport JSON Schema:\n${JSON.stringify(reportSchema, null, 2)}\n\n미리보기에서 검증 후 발행. 코드 작업/외부 신청/연락처 추측 금지. 발행 완료 후 이 화면에서 오늘 발행됨 상태를 확인.`, "text/plain; charset=utf-8");
          else check(false, "페이지를 찾을 수 없습니다.", 404);
          return true;
        }
        const input = await body(request);
        if (path === "/publisher/preview") send(200, previewPage(store.validateSubmission(submission(input.report), now()), input.report));
        else if (path === "/publisher/publish") {
          check(input.confirmed === "yes", "오늘 원문 확인과 발행 동의가 필요합니다.");
          store.publish(submission(input.report), config.emailFrom, now());
          notifier.drain().catch(() => console.error("DM worker needs review."));
          redirect("/publisher");
        } else check(false, "요청을 찾을 수 없습니다.", 404);
        return true;
      }
      if (path === "/admin" || path.startsWith("/admin/")) {
        if (!admin && request.method === "GET") { redirect("/admin/login"); return true; }
        check(admin, "운영자 권한이 필요합니다.", 403);
        if (path === "/admin" && request.method === "GET") { send(200, adminPage(store.members(), store.deliveries(), config, !!store.edition(seoulClock(now()).date))); return true; }
        if (path === "/admin/actions" && request.method === "GET") { send(200, actionsPage(store.state().actions)); return true; }
        const membership = path.match(/^\/admin\/members\/(\d{17,20})\/(approve|reject|revoke)$/);
        if (membership && request.method === "POST") { store.changeMembership(membership[1], membership[2]); redirect("/admin"); return true; }
        const actionMatch = path.match(/^\/admin\/actions\/([a-f0-9-]{36})\/(save|approve|reject|resolve|document)$/);
        if (actionMatch) {
          const [, id, operation] = actionMatch;
          if (operation === "document" && request.method === "GET") {
            const action = store.action(id);
            check(action.status === "completed" && action.result?.document, "완성 문서가 없습니다.", 404);
            response.setHeader("Content-Disposition", `attachment; filename="gammaru-${id}.md"`); send(200, action.result.document, "text/markdown; charset=utf-8"); return true;
          }
          check(request.method === "POST", "허용되지 않는 요청입니다.", 405);
          const input = await body(request);
          if (operation === "save") store.edit(id, input.hash, input, config.emailFrom);
          else if (operation === "approve") {
            check(input.confirmed === "yes", "저장된 원문과 실행 내용을 확인해 주세요.");
            const action = store.action(id);
            check(["recipient", "subject", "body"].every((key) => input[key] === action.payload[key].replace(/\r\n?/g, "\n")), "수정한 내용을 먼저 저장한 뒤 다시 승인해 주세요.", 409);
            service.canExecute(action); store.approve(id, input.hash, seoulClock(now()).date); await service.execute(id);
          } else if (operation === "reject") store.reject(id);
          else if (operation === "resolve") store.resolve(id, input.outcome);
          else check(false, "요청을 찾을 수 없습니다.", 404);
          redirect("/admin/actions"); return true;
        }
      }
      check(false, "페이지를 찾을 수 없습니다.", 404);
    } catch (error) {
      send(error.status || 500, layout("요청 확인", `${hero('PLEASE <span>CHECK.</span>', error.status ? error.message : "요청을 처리하지 못했습니다. 운영진에게 알려 주세요.")}<p><a class="button secondary" href="/members">구독 설정</a> <a class="button secondary" href="/admin">관리자 페이지</a> <a class="button secondary" href="/publisher">보고서 등록</a></p>`, "guest"));
    }
    return true;
  }
  return { handle, store, service, notifier, tick, getSession };
}
