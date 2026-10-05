import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { check, digest } from "../schema.mjs";
import { seoulClock } from "../clock.mjs";
import { briefConfig } from "./config.mjs";
import { BriefStore, PrivateBlobFiles } from "./storage.mjs";
import { deliverBriefLinks } from "./notify.mjs";
import * as view from "./views.mjs";

const equal = (a, b) => typeof a === "string" && typeof b === "string" && a.length === b.length && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const security = {
  "Cache-Control": "private, no-store", Vary: "Cookie", "X-Robots-Tag": "noindex, nofollow, noarchive", "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin", "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https://cdn.discordapp.com; frame-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};
export const htmlSecurity = {
  ...security, "X-Frame-Options": "SAMEORIGIN", "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "sandbox allow-popups allow-popups-to-escape-sandbox; default-src 'none'; script-src 'none'; connect-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src https: data:; form-action 'none'; base-uri 'none'; frame-ancestors 'self'",
};
async function formData(request) {
  const type = request.headers.get("content-type") || "";
  check(/^(multipart\/form-data;|application\/x-www-form-urlencoded)/.test(type), "파일 업로드 또는 폼 요청이 필요합니다.", 415);
  const reader = request.body?.getReader(); check(reader, "입력이 필요합니다.");
  let length = 0; const chunks = [];
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > 2300000) { await reader.cancel(); check(false, "HTML 파일은 2MB 이하로 올려 주세요.", 413); }
    chunks.push(value);
  }
  return new Request(request.url, { method: "POST", headers: { "content-type": type }, body: Buffer.concat(chunks) }).formData();
}
const textField = (form, name) => typeof form.get(name) === "string" ? form.get(name) : "";
function userProfile(user) {
  check(user && /^\d{17,20}$/.test(user.id) && typeof user.username === "string" && user.username.length <= 100 && !user.bot, "Discord 프로필 확인에 실패했습니다.", 502);
  return { id: user.id, username: user.username, display_name: (user.global_name || user.username).slice(0, 100), avatar: /^(a_)?[a-f0-9]{32}$/.test(user.avatar || "") ? user.avatar : null };
}

export function createBriefHandler({ config: fixedConfig, store: fixedStore, fetch: fetcher = fetch, after = () => {}, now = () => new Date() } = {}) {
  return async function handle(request) {
    const config = fixedConfig || briefConfig(request);
    const store = fixedStore || new BriefStore(new PrivateBlobFiles(config.blobToken));
    const headers = new Headers(security);
    const send = (html, status = 200, mime = "text/html; charset=utf-8") => { headers.set("Content-Type", mime); return new Response(html, { status, headers }); };
    const redirect = (target) => { headers.set("Location", target); return new Response(null, { status: 303, headers }); };
    const cookieName = config.secure ? "__Host-briefs" : "briefs";
    const stateName = `${cookieName}-oauth`;
    const cookies = Object.fromEntries((request.headers.get("cookie") || "").split(";").map((v) => v.trim().split("=")).filter((a) => a.length === 2));
    const cookie = (name, value, maxAge) => `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${config.secure ? "; Secure" : ""}`;
    const sessionHash = digest(cookies[cookieName] || "");
    const proof = (role) => role === "admin" ? digest([config.adminUsername, config.token]) : role === "publisher" ? digest(config.publisherToken) : "discord";
    async function signIn(role, subject) {
      const token = randomBytes(32).toString("hex");
      const age = role === "publisher" ? 30 * 86400 : role === "admin" ? 43200 : 7 * 86400;
      await store.update((s) => { delete s.sessions[sessionHash]; s.sessions[digest(token)] = { role, subject, proof: proof(role), expires: Date.now() + age * 1000 }; });
      headers.append("Set-Cookie", cookie(cookieName, token, age));
    }
    const scheduleDM = () => after(() => deliverBriefLinks(store, config, fetcher, 210000).catch(() => console.error("Report notifications require review.")));
    try {
      check(config.configured, "보고서 저장소와 로그인 설정을 준비 중입니다.", 503);
      const url = new URL(request.url); const pathname = url.pathname.replace(/\/$/, "");
      check(url.origin === config.origin, "설정된 사이트 주소로 접속해 주세요.", 400);
      check(["GET", "POST"].includes(request.method), "허용되지 않는 요청입니다.", 405);
      if (request.method === "POST") check(request.headers.get("origin") === config.origin, "다른 사이트의 요청은 허용되지 않습니다.", 403);
      const data = await store.read();
      const savedSession = data.sessions[sessionHash];
      const session = savedSession?.expires > Date.now() && savedSession.proof === proof(savedSession.role) ? savedSession : null;
      const member = session?.role === "member" ? data.members[session.subject] : null;
      const admin = session?.role === "admin", publisher = admin || session?.role === "publisher";
      const readable = admin || member?.status === "approved";
      const today = seoulClock(now()).date;
      const oauthConfigured = !!(config.discordApplicationId && config.discordClientSecret);
      if (pathname === "/reports/logout" && request.method === "POST") {
        await store.update((s) => { delete s.sessions[sessionHash]; }); headers.append("Set-Cookie", cookie(cookieName, "", 0)); return redirect("/reports");
      }
      const loginMatch = pathname.match(/^\/reports\/login\/(admin|publisher)$/);
      if (loginMatch) {
        const type = loginMatch[1];
        if (request.method === "GET") return send(view.login(type, type === "admin" || !!config.publisherToken));
        check(type === "admin" || config.publisherToken, "업로드 계정이 설정되지 않았습니다.", 503);
        await store.update((s) => { const row = s.attempts[type] || { count: 0, expires: Date.now() + 900000 }; check(row.count < 15, "로그인 요청이 많습니다. 15분 후 다시 시도해 주세요.", 429); row.count++; s.attempts[type] = row; });
        const input = await formData(request);
        check(type === "admin" ? equal(textField(input, "username"), config.adminUsername) && equal(textField(input, "password"), config.token) : equal(textField(input, "password"), config.publisherToken), "로그인 정보를 확인해 주세요.", 401);
        await signIn(type, type); return redirect(type === "admin" ? "/reports/admin" : "/reports/upload");
      }
      if (pathname === "/reports/auth/discord" && request.method === "GET") {
        check(oauthConfigured, "Discord 로그인을 준비 중입니다.", 503);
        const state = randomBytes(32).toString("hex");
        await store.update((s) => { s.oauth[digest(state)] = { expires: Date.now() + 600000 }; });
        headers.append("Set-Cookie", cookie(stateName, state, 600));
        return redirect(`https://discord.com/oauth2/authorize?${new URLSearchParams({ client_id: config.discordApplicationId, scope: "identify", response_type: "code", state, redirect_uri: `${config.origin}/reports/auth/callback` })}`);
      }
      if (pathname === "/reports/auth/callback" && request.method === "GET") {
        check(oauthConfigured, "Discord 로그인을 준비 중입니다.", 503);
        const state = url.searchParams.get("state"), code = url.searchParams.get("code");
        check(equal(state, cookies[stateName]) && code && code.length <= 1024, "로그인 요청이 일치하지 않습니다.", 403);
        await store.update((s) => { check(s.oauth[digest(state)]?.expires > Date.now(), "로그인이 만료되었습니다. 다시 로그인해 주세요.", 403); delete s.oauth[digest(state)]; });
        headers.append("Set-Cookie", cookie(stateName, "", 0));
        let user;
        try {
          const tokenResponse = await fetcher("https://discord.com/api/oauth2/token", { method: "POST", redirect: "error", signal: AbortSignal.timeout(15000), headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: config.discordApplicationId, client_secret: config.discordClientSecret, code, redirect_uri: `${config.origin}/reports/auth/callback` }) });
          if (!tokenResponse.ok) throw new Error("OAuth failed");
          const token = await tokenResponse.json();
          if (typeof token.access_token !== "string" || token.token_type?.toLowerCase() !== "bearer") throw new Error("Invalid token");
          const response = await fetcher("https://discord.com/api/v10/users/@me", { headers: { authorization: `Bearer ${token.access_token}` }, redirect: "error", signal: AbortSignal.timeout(15000) });
          if (!response.ok) throw new Error("Profile failed");
          user = userProfile(await response.json());
        } catch { check(false, "Discord 로그인에 실패했습니다. 다시 시도해 주세요.", 502); }
        await store.update((s) => { s.members[user.id] = { name: "", status: "new", dm_opt_in: false, ...s.members[user.id], ...user }; });
        await signIn("member", user.id); return redirect("/reports/account");
      }
      if (["/reports/account", "/reports/subscription", "/reports/unsubscribe"].includes(pathname)) {
        if (!member && request.method === "GET") return admin ? redirect("/reports/admin") : send(view.login("member", oauthConfigured));
        check(member, "Discord 로그인이 필요합니다.", 401);
        if (pathname === "/reports/account" && request.method === "GET") return send(view.account(member));
        check(request.method === "POST", "허용되지 않는 요청입니다.", 405);
        const form = await formData(request);
        await store.update((s) => {
          const m = s.members[member.id];
          if (pathname === "/reports/unsubscribe") { m.status = "revoked"; m.dm_opt_in = false; }
          else {
            if (["new", "revoked", "rejected"].includes(m.status)) {
              const name = textField(form, "name").trim(); check(name.length >= 2 && name.length <= 60 && !/[\x00-\x1f]/.test(name), "이름은 2~60자로 입력해 주세요."); m.name = name; m.status = "pending";
            }
            m.dm_opt_in = textField(form, "dm") === "yes";
          }
          for (const d of Object.values(s.deliveries)) if (d.memberId === m.id && d.status === "pending" && (!m.dm_opt_in || m.status !== "approved")) d.status = "cancelled";
        });
        return redirect("/reports/account");
      }
      if (pathname === "/reports/admin" || pathname.startsWith("/reports/admin/")) {
        if (!admin && request.method === "GET") return redirect("/reports/login/admin");
        check(admin, "관리자 권한이 필요합니다.", 403);
        if (pathname === "/reports/admin" && request.method === "GET") return send(view.admin(Object.values(data.members), Object.values(data.deliveries)));
        const match = pathname.match(/^\/reports\/admin\/(\d{17,20})\/(approve|reject|revoke)$/);
        check(match && request.method === "POST", "요청을 찾을 수 없습니다.", 404);
        await store.update((s) => {
          const m = s.members[match[1]], operation = match[2];
          check(m && m.status === (operation === "revoke" ? "approved" : "pending"), "구독 상태가 변경되었습니다. 새로고침해 주세요.", 409);
          m.status = { approve: "approved", reject: "rejected", revoke: "revoked" }[operation];
          if (m.status !== "approved") for (const d of Object.values(s.deliveries)) if (d.memberId === m.id && d.status === "pending") d.status = "cancelled";
        });
        return redirect("/reports/admin");
      }
      if (/^\/reports\/(upload(?:\/|$)|notify$|design$|context$)/.test(pathname)) {
        if (!publisher && request.method === "GET") return redirect("/reports/login/publisher");
        check(publisher, "HTML 업로드 권한이 필요합니다.", 403);
        if (pathname === "/reports/upload" && request.method === "GET") return send(view.upload(today, session.role, data.reports.find((r) => r.date === url.searchParams.get("published")), Object.values(data.deliveries), config.dmEnabled && !!config.discordBotToken));
        if (pathname === "/reports/design" && request.method === "GET") return send(await readFile(path.join(process.cwd(), "Design.md"), "utf8"), 200, "text/plain; charset=utf-8");
        if (pathname === "/reports/context" && request.method === "GET") return send(await readFile(path.join(process.cwd(), "gammaruInfo.md"), "utf8"), 200, "text/plain; charset=utf-8");
        if (pathname === "/reports/notify" && request.method === "POST") { scheduleDM(); return redirect("/reports/upload"); }
        const draftFile = pathname.match(/^\/reports\/upload\/preview\/([a-f0-9-]{36})\/html$/);
        if (draftFile && request.method === "GET") {
          const draft = await store.draft(draftFile[1], sessionHash);
          return new Response(draft.html, { headers: { ...htmlSecurity, "Content-Type": "text/html; charset=utf-8" } });
        }
        if (pathname === "/reports/upload/preview" && request.method === "POST") {
          const form = await formData(request), file = form.get("html");
          check(file && typeof file.arrayBuffer === "function" && /\.html?$/i.test(file.name) && file.size <= 2 * 1024 * 1024, "2MB 이하의 .html 파일을 선택해 주세요.");
          let html;
          try { html = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()); } catch { check(false, "HTML을 UTF-8 인코딩으로 저장한 뒤 올려 주세요."); }
          const draft = await store.stage({ date: textField(form, "date"), title: textField(form, "title"), summary: textField(form, "summary"), html, notify: textField(form, "notify") === "yes" }, sessionHash, today);
          return send(view.preview(draft, session.role));
        }
        if (pathname === "/reports/upload/publish" && request.method === "POST") {
          const form = await formData(request); check(textField(form, "confirmed") === "yes", "보고서 내용을 확인해 주세요.");
          const result = await store.publish(await store.draft(textField(form, "draft"), sessionHash), today);
          // Resume persisted queues after an interrupted upload response, too.
          scheduleDM();
          return redirect(`/reports/upload?published=${result.report.date}`);
        }
        check(false, "페이지를 찾을 수 없습니다.", 404);
      }
      if (!session && request.method === "GET") return send(view.login("member", oauthConfigured));
      check(readable, "승인된 구독자만 보고서를 볼 수 있습니다.", 403);
      if (pathname === "/reports" && request.method === "GET") return send(view.archive(data.reports, session.role, (url.searchParams.get("q") || "").slice(0, 100), Math.floor(Number(url.searchParams.get("page")) || 1)));
      const reportMatch = pathname.match(/^\/reports\/(\d{4}-\d{2}-\d{2})(\/html)?$/);
      check(reportMatch && request.method === "GET", "페이지를 찾을 수 없습니다.", 404);
      const report = data.reports.find((r) => r.date === reportMatch[1]); check(report, "보고서를 찾을 수 없습니다.", 404);
      if (reportMatch[2]) return new Response(await store.html(report), { headers: { ...htmlSecurity, "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `inline; filename="gammaru-${report.date}.html"` } });
      return send(view.viewer(report, session.role));
    } catch (error) {
      return send(view.page("요청 확인", `<section class="panel narrow"><h1>확인이 필요합니다.</h1><p>${escapeError(error.status ? error.message : "요청을 처리하지 못했습니다. 저장소 연결을 확인해 주세요.")}</p><a class="button secondary" href="/reports">보고서 목록</a> <a class="button secondary" href="/reports/upload">HTML 업로드</a></section>`), error.status || 503);
    }
  };
}
const escapeError = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export async function handleBriefRequest(request, options) { return createBriefHandler(options)(request); }
