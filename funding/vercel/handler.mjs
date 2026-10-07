import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { check, digest } from "../schema.mjs";
import { seoulClock } from "../clock.mjs";
import { briefConfig } from "./config.mjs";
import { BriefStore, PrivateBlobFiles } from "./storage.mjs";
import { deliverBriefLinks, deliverLoginNotice, deliverApprovalNotice } from "./notify.mjs";
import * as view from "./views.mjs";
import { readableReport } from "./reader.mjs";
import { researchState, parseManifest, manifestFromHtml, progressLabels, validateResearchState } from "./opportunities.mjs";
import { handleWorkerJob, notificationTransportReady, workerMode } from "./worker-jobs.mjs";
import { reportChannel, allowedMember, isPersonal } from "./access.mjs";
import { profileFields, profileForm, personalContext, savePersonalProfile } from "./personal-profile.mjs";
import { requirePersonalSession, requireLinkRevision, bindPersonalDiscord, cancelPersonalNotices, validDiscordOwnerSession } from "./personal-account.mjs";
import { memberOpportunities } from "./member-progress.mjs";
import { reportBasePath, reportCookieName, reportLink, mountedPage, mountedTarget } from "./paths.mjs";
import { reportRevision } from "./report-versions.mjs";
import { notificationTarget } from "./notification-target.mjs";

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
    const store = fixedStore || new BriefStore(new PrivateBlobFiles(config.blobToken), isPersonal(config) ? "personal/briefs" : "gammaru/briefs");
    const headers = new Headers(security);
    const send = (html, status = 200, mime = "text/html; charset=utf-8") => { headers.set("Content-Type", mime); return new Response(mime.startsWith("text/html") ? mountedPage(html, config) : html, { status, headers }); };
    const redirect = (target) => { headers.set("Location", mountedTarget(target, config)); return new Response(null, { status: 303, headers }); };
    const cookieName = reportCookieName(config);
    const callbackUrl = `${config.origin}${config.oauthCallbackPath || `${reportBasePath(config)}/auth/callback`}`;
    const stateName = `${cookieName}-oauth`;
    const cookies = Object.fromEntries((request.headers.get("cookie") || "").split(";").map((v) => v.trim().split("=")).filter((a) => a.length === 2));
    const cookie = (name, value, maxAge) => `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${config.secure ? "; Secure" : ""}`;
    const sessionHash = digest(cookies[cookieName] || "");
    const proof = (role) => role === "admin" ? digest([config.adminUsername, config.token]) : role === "publisher" ? digest(config.publisherToken) : "discord";
    async function signIn(role, subject, discordLogin = false) {
      const token = randomBytes(32).toString("hex");
      const age = role === "admin" && config.service !== "personal" ? 43200 : 30 * 86400;
      await store.update((s) => {
        const owner = discordLogin && s.personalAccount?.discordId === subject;
        const grantedRole = owner ? "admin" : role;
        delete s.sessions[sessionHash];
        s.sessions[digest(token)] = { role: grantedRole, subject, proof: proof(grantedRole), expires: Date.now() + age * 1000,
          ...(owner ? { discordOwnerId: subject } : {}) };
      });
      headers.append("Set-Cookie", cookie(cookieName, token, age));
    }
    const personal = isPersonal(config), personalAccountMode = config.service === "personal";
    const sharedPersonal = personalAccountMode && config.discordLoginReaders;
    const sourceFiles = {
      instructions: () => personal ? readFile(path.join(process.cwd(), "docs/dots-personal-brief.md"), "utf8") : readFile(path.join(process.cwd(), "docs/dots-daily-brief.md"), "utf8"),
      design: () => personal ? readFile(path.join(process.cwd(), "docs/personal-Design.md"), "utf8") : readFile(path.join(process.cwd(), "Design.md"), "utf8"),
      context: () => personal ? readFile(path.join(process.cwd(), "docs/personal-brief-profile.md"), "utf8") : readFile(path.join(process.cwd(), "gammaruInfo.md"), "utf8"),
    };
    const source = async (name, data) => (await sourceFiles[name]()).replaceAll("{{REPORTS_BASE_URL}}", reportLink(config)).replaceAll("{{REPORTS_SITE_URL}}", config.origin) + (personal && name === "context" ? personalContext(data.personalProfile) : "");
    const channelId = reportChannel(config);
    const transportReady = notificationTransportReady(config);
    const notificationsEnabled = transportReady && (channelId ? /^\d{17,20}$/.test(channelId) : config.dmEnabled);
    const scheduleNotifications = () => { if (!workerMode(config)) after(() => deliverBriefLinks(store, config, fetcher, 210000).catch(() => console.error("Report notifications require review."))); };
    const scheduleApproval = (id, noticeId) => { if (!workerMode(config)) after(() => deliverApprovalNotice(store, config, id, noticeId, fetcher).catch(() => console.error("Approval notification requires review."))); };
    const approvalNotice = (m, id, retry = false) => {
      const prior = m.approval_notice;
      if (retry) check(!prior || Date.now() >= Math.max(prior.createdAt + 60000, prior.retryAt || 0), "확인 DM을 요청한 지 얼마 되지 않았습니다. 잠시 후 다시 시도해 주세요.", 429);
      m.approval_notice = { id, createdAt: Date.now(), status: transportReady ? "pending" : "unavailable" };
    };
    try {
      check(config.configured, "보고서 저장소와 로그인 설정을 준비 중입니다.", 503);
      const url = new URL(request.url);
      const incomingPath = url.pathname.replace(/\/$/, ""), basePath = reportBasePath(config);
      check(incomingPath === basePath || incomingPath.startsWith(`${basePath}/`) || incomingPath === config.oauthCallbackPath, "페이지를 찾을 수 없습니다.", 404);
      const pathname = incomingPath === config.oauthCallbackPath ? "/reports/auth/callback" : `/reports${incomingPath.slice(basePath.length)}`;
      check(url.origin === config.origin, "설정된 사이트 주소로 접속해 주세요.", 400);
      check(["GET", "POST"].includes(request.method), "허용되지 않는 요청입니다.", 405);
      if (pathname.startsWith("/reports/worker/")) {
        check(request.method === "POST", "POST required.", 405);
        check((config.discordWorkerToken || "").length >= 32 && equal(request.headers.get("authorization"), `Bearer ${config.discordWorkerToken}`), "Worker authentication required.", 403);
        return send(JSON.stringify(await handleWorkerJob(request, store, config)), 200, "application/json; charset=utf-8");
      }
      if (request.method === "POST") check(request.headers.get("origin") === config.origin, "다른 사이트의 요청은 허용되지 않습니다.", 403);
      // Public pages check this endpoint too; guests need no Blob read.
      if (pathname === "/reports/session" && request.method === "GET" && !cookies[cookieName]) return send(JSON.stringify({ authenticated: false }), 200, "application/json; charset=utf-8");
      const data = await store.read();
      const savedSession = data.sessions[sessionHash];
      const session = savedSession?.expires > Date.now() && savedSession.proof === proof(savedSession.role) && validDiscordOwnerSession(data, savedSession) ? savedSession : null;
      const member = session?.role === "member" ? data.members[session.subject] : null;
      const admin = session?.role === "admin", publisher = admin || session?.role === "publisher";
      const readable = admin || (member?.status === "approved" && (sharedPersonal || (!personalAccountMode && allowedMember(member, config, data))));
      const linkedMember = personalAccountMode ? data.members[data.personalAccount?.discordId] : null;
      const today = seoulClock(now()).date;
      const oauthConfigured = !!(config.discordApplicationId && config.discordClientSecret);
      if (pathname === "/reports/session" && request.method === "GET") {
        const visible = session && (session.role !== "member" || member);
        return send(JSON.stringify(visible ? { authenticated: true, role: session.role, name: member?.name || member?.display_name || config.adminUsername, subscription: member?.status ?? null, canRead: readable } : { authenticated: false }), 200, "application/json; charset=utf-8");
      }
      if (pathname === "/reports/logout" && request.method === "POST") {
        await store.update((s) => { delete s.sessions[sessionHash]; }); headers.append("Set-Cookie", cookie(cookieName, "", 0)); return redirect("/reports");
      }
      const loginMatch = pathname.match(/^\/reports\/login\/(admin|publisher)$/);
      if (loginMatch) {
        const type = loginMatch[1];
        if (request.method === "GET") return send(view.login(type, type === "admin" || !!config.publisherToken, false, personal));
        check(type === "admin" || config.publisherToken, "업로드 계정이 설정되지 않았습니다.", 503);
        await store.update((s) => { const row = s.attempts[type] || { count: 0, expires: Date.now() + 900000 }; check(row.count < 15, "로그인 요청이 많습니다. 15분 후 다시 시도해 주세요.", 429); row.count++; s.attempts[type] = row; });
        const input = await formData(request);
        check(type === "admin" ? equal(textField(input, "username"), config.adminUsername) && equal(textField(input, "password"), config.token) : equal(textField(input, "password"), config.publisherToken), "로그인 정보를 확인해 주세요.", 401);
        await signIn(type, type); return redirect(type === "admin" ? personalAccountMode ? "/reports" : "/reports/admin" : "/reports/upload");
      }
      if (pathname === "/reports/auth/discord") {
        const readerLogin = sharedPersonal && request.method === "GET";
        if (personalAccountMode) {
          if (!readerLogin && request.method === "GET") return redirect(admin ? "/reports/account" : "/reports/login/admin");
          check(readerLogin || admin, "개인 계정으로 먼저 로그인해 주세요.", 403);
        } else check(request.method === "GET", "GET required.", 405);
        check(oauthConfigured, "Discord 로그인을 준비 중입니다.", 503);
        const state = randomBytes(32).toString("hex");
        await store.update((s) => {
          if (personalAccountMode && !readerLogin) requirePersonalSession(s, sessionHash, proof("admin"));
          s.oauth[digest(state)] = { expires: Date.now() + 600000, ...(readerLogin ? { purpose: "reader-login" } : personalAccountMode ? { sessionHash, proof: proof("admin"), revision: s.personalAccount?.revision || 0 } : {}) };
        });
        headers.append("Set-Cookie", cookie(stateName, state, 600));
        return redirect(`https://discord.com/oauth2/authorize?${new URLSearchParams({ client_id: config.discordApplicationId, scope: "identify", response_type: "code", state, redirect_uri: callbackUrl })}`);
      }
      if (pathname === "/reports/auth/callback" && request.method === "GET") {
        check(oauthConfigured, "Discord 로그인을 준비 중입니다.", 503);
        const state = url.searchParams.get("state"), code = url.searchParams.get("code");
        check(equal(state, cookies[stateName]) && code && code.length <= 1024, "로그인 요청이 일치하지 않습니다.", 403);
        const linkRequest = await store.update((s) => {
          const pending = s.oauth[digest(state)];
          check(pending?.expires > Date.now(), "로그인이 만료되었습니다. 다시 로그인해 주세요.", 403);
          if (personalAccountMode && !(sharedPersonal && pending.purpose === "reader-login")) {
            requirePersonalSession(s, sessionHash, proof("admin"));
            check(pending.sessionHash === sessionHash && pending.proof === proof("admin"), "연결을 시작한 개인 로그인에서 다시 시도해 주세요.", 403);
            requireLinkRevision(s, pending.revision);
          }
          delete s.oauth[digest(state)]; return pending;
        });
        const readerLogin = sharedPersonal && linkRequest.purpose === "reader-login";
        headers.append("Set-Cookie", cookie(stateName, "", 0));
        let user;
        try {
          const tokenResponse = await fetcher("https://discord.com/api/oauth2/token", { method: "POST", redirect: "error", signal: AbortSignal.timeout(15000), headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: config.discordApplicationId, client_secret: config.discordClientSecret, code, redirect_uri: callbackUrl }) });
          if (!tokenResponse.ok) throw new Error("OAuth failed");
          const token = await tokenResponse.json();
          if (typeof token.access_token !== "string" || token.token_type?.toLowerCase() !== "bearer") throw new Error("Invalid token");
          const response = await fetcher("https://discord.com/api/v10/users/@me", { headers: { authorization: `Bearer ${token.access_token}` }, redirect: "error", signal: AbortSignal.timeout(15000) });
          if (!response.ok) throw new Error("Profile failed");
          user = userProfile(await response.json());
        } catch { check(false, "Discord 로그인에 실패했습니다. 다시 시도해 주세요.", 502); }
        check(personalAccountMode || allowedMember(user, config, data), "이 보고서는 소유자 전용입니다. 등록된 Discord 계정으로 로그인해 주세요.", 403);
        const noticeId = randomBytes(16).toString("hex");
        const notice = await store.update((s) => {
          const m = personalAccountMode && !readerLogin ? bindPersonalDiscord(s, user, sessionHash, proof("admin"), linkRequest.revision) : (s.members[user.id] = { name: "", status: "new", dm_opt_in: false, ...s.members[user.id], ...user });
          if (readerLogin) {
            m.name ||= user.display_name.replace(/[\x00-\x1f]/g, "").trim().slice(0, 60) || user.username;
            m.status = "approved";
            if (s.personalAccount?.discordId !== user.id) m.dm_opt_in = false;
            return null;
          }
          if (m.status === "new") {
            m.name ||= user.display_name.replace(/[\x00-\x1f]/g, "").trim().slice(0, 60) || user.username;
            m.status = personal ? "approved" : "pending"; m.dm_opt_in = true;
          }
          // Re-login must not undo an opt-out, rejection or administrator revocation.
          if (personal && channelId) { cancelPersonalNotices(s, user.id); return null; }
          if (m.login_notice?.createdAt > Date.now() - 60000) return null;
          m.login_notice = { id: noticeId, createdAt: Date.now(), status: transportReady ? "pending" : "unavailable" };
          return transportReady ? noticeId : null;
        });
        if (!personalAccountMode || readerLogin) await signIn("member", user.id, readerLogin);
        if (notice && !workerMode(config)) after(() => deliverLoginNotice(store, config, user.id, notice, fetcher).catch(() => console.error("Login notification requires review.")));
        return redirect(readerLogin ? "/reports" : "/reports/account?welcome=1");
      }
      if (sharedPersonal && !admin && ["/reports/account", "/reports/subscription", "/reports/unsubscribe", "/reports/account/confirmation"].includes(pathname)) {
        if (!member && request.method === "GET") return send(view.sharedLogin(oauthConfigured));
        check(readable, "Discord로 로그인해 주세요.", 403);
        check(pathname === "/reports/account" && request.method === "GET", "개인 알림 연결은 운영자만 관리할 수 있습니다.", 403);
        return send(view.readerAccount(member, !!channelId));
      }
      if (personalAccountMode && ["/reports/account", "/reports/subscription", "/reports/unsubscribe", "/reports/account/confirmation"].includes(pathname)) {
        if (!admin && request.method === "GET") return redirect("/reports/login/admin");
        check(admin, "개인 계정으로 먼저 로그인해 주세요.", 403);
        if (pathname === "/reports/account" && request.method === "GET") {
          // Browsers enforce form-action on the POST's redirect to Discord too.
          // Only this account page needs an external form navigation destination.
          headers.set("Content-Security-Policy", security["Content-Security-Policy"].replace("form-action 'self';", "form-action 'self' https://discord.com;"));
          return send(view.personalAccount(linkedMember, data.personalAccount?.revision || 0, oauthConfigured, url.searchParams, config.discordApplicationId, !!channelId));
        }
        check(request.method === "POST" && pathname !== "/reports/account", "요청을 확인해 주세요.", 405);
        check(!channelId || pathname === "/reports/unsubscribe", "보고서 알림은 서버 채널에서 확인해 주세요.", 409);
        const form = await formData(request), revision = Number(textField(form, "revision"));
        check(/^\d+$/.test(textField(form, "revision")), "연결 버전을 확인해 주세요.");
        const noticeId = randomBytes(16).toString("hex");
        const recipient = await store.update((s) => {
          requirePersonalSession(s, sessionHash, proof("admin")); requireLinkRevision(s, revision);
          const id = s.personalAccount?.discordId, m = s.members[id];
          check(m, "Discord를 먼저 연결해 주세요.", 409);
          if (pathname === "/reports/unsubscribe") bindPersonalDiscord(s, null, sessionHash, proof("admin"), revision);
          else if (pathname === "/reports/account/confirmation") approvalNotice(m, noticeId, true);
          else { m.dm_opt_in = textField(form, "dm") === "yes"; s.personalAccount.revision++; if (!m.dm_opt_in) cancelPersonalNotices(s, id); }
          return id;
        });
        if (pathname.endsWith("/confirmation")) scheduleApproval(recipient, noticeId);
        return redirect(`/reports/account?${pathname.endsWith("/confirmation") ? "confirmation" : "saved"}=1`);
      }
      if (pathname === "/reports/account/confirmation" && request.method === "POST") {
        check(member?.status === "approved" && allowedMember(member, config), "승인된 구독자만 확인 DM을 받을 수 있습니다.", 403);
        const noticeId = randomBytes(16).toString("hex");
        await store.update((s) => { const m = s.members[member.id]; check(m?.status === "approved", "구독 상태가 변경되었습니다.", 409); approvalNotice(m, noticeId, true); });
        scheduleApproval(member.id, noticeId);
        return redirect("/reports/account?confirmation=1");
      }
      if (["/reports/account", "/reports/subscription", "/reports/unsubscribe"].includes(pathname)) {
        if (!member && request.method === "GET") return admin ? redirect("/reports/admin") : send(view.login("member", oauthConfigured, !!channelId, personal));
        check(member, "Discord 로그인이 필요합니다.", 401);
        check(allowedMember(member, config), "이 보고서는 소유자 전용입니다.", 403);
        if (pathname === "/reports/account" && request.method === "GET") return send(view.account(member, url.searchParams.get("welcome") === "1", url.searchParams.get("saved") === "1", config.discordApplicationId, url.searchParams.get("confirmation") === "1", !!channelId, personal));
        check(request.method === "POST", "허용되지 않는 요청입니다.", 405);
        const form = await formData(request);
        await store.update((s) => {
          const m = s.members[member.id];
          if (pathname === "/reports/unsubscribe") { m.status = "revoked"; m.dm_opt_in = false; }
          else {
            const name = textField(form, "name").trim(); check(name.length >= 1 && name.length <= 60 && !/[\x00-\x1f]/.test(name), "이름은 1~60자로 입력해 주세요."); m.name = name;
            if (["new", "revoked", "rejected"].includes(m.status)) m.status = "pending";
            if (!channelId) m.dm_opt_in = textField(form, "dm") === "yes";
          }
          for (const d of Object.values(s.deliveries)) if (d.memberId === m.id && d.status === "pending" && (!m.dm_opt_in || m.status !== "approved")) d.status = "cancelled";
        });
        return redirect("/reports/account?saved=1");
      }
      if (pathname === "/reports/admin" || pathname.startsWith("/reports/admin/")) {
        if (personalAccountMode) { check(request.method === "GET", "개인 알림은 Discord 연결 설정에서 관리해 주세요.", 404); return redirect(admin ? "/reports/account" : "/reports/login/admin"); }
        if (!admin && request.method === "GET") return redirect("/reports/login/admin");
        check(admin, "관리자 권한이 필요합니다.", 403);
        if (pathname === "/reports/admin" && request.method === "GET") return send(view.admin(Object.values(data.members).filter((m) => allowedMember(m, config)), Object.values(data.deliveries), !!channelId, personal));
        const match = pathname.match(/^\/reports\/admin\/(\d{17,20})\/(approve|reject|revoke|notify)$/);
        check(match && request.method === "POST", "요청을 찾을 수 없습니다.", 404);
        const noticeId = randomBytes(16).toString("hex");
        await store.update((s) => {
          const m = s.members[match[1]], operation = match[2];
          check(allowedMember(m, config), "개인 보고서는 소유자 계정만 관리할 수 있습니다.", 403);
          check(m && m.status === (["revoke", "notify"].includes(operation) ? "approved" : "pending"), "구독 상태가 변경되었습니다. 새로고침해 주세요.", 409);
          if (operation !== "notify") m.status = { approve: "approved", reject: "rejected", revoke: "revoked" }[operation];
          if (["approve", "notify"].includes(operation)) approvalNotice(m, noticeId, operation === "notify");
          if (m.status !== "approved") for (const d of Object.values(s.deliveries)) if (d.memberId === m.id && d.status === "pending") d.status = "cancelled";
        });
        if (["approve", "notify"].includes(match[2])) scheduleApproval(match[1], noticeId);
        return redirect("/reports/admin");
      }
      if (pathname === "/reports/research-state" && request.method === "GET") {
        check(publisher, "조사용 진행 기록에는 업로드 권한이 필요합니다.", 403);
        return send(JSON.stringify(researchState(data, personal), null, 2), 200, "application/json; charset=utf-8");
      }
      if (pathname === "/reports/profile") {
        check(personal, "개인 서비스에서만 조사 조건을 저장할 수 있습니다.", 404);
        check(sharedPersonal ? admin : readable, "소유자 또는 관리자만 조사 조건을 변경할 수 있습니다.", 403);
        if (request.method === "GET") return send(view.page("내 조사 조건", profileForm(data.personalProfile, url.searchParams.get("saved") === "1"), session.role, true));
        const form = await formData(request), revision = textField(form, "revision");
        check(/^\d+$/.test(revision), "조사 조건 버전을 확인해 주세요.");
        const input = { revision: Number(revision), ...Object.fromEntries(profileFields.map(([key]) => [key, textField(form, key)])) };
        await store.update((s) => savePersonalProfile(s, input, admin ? null : member.id));
        return redirect("/reports/profile?saved=1");
      }
      if (/^\/reports\/(upload(?:\/|$)|notify$|design$|context$|instructions$)/.test(pathname)) {
        if (!publisher && request.method === "GET") return redirect("/reports/login/publisher");
        check(publisher, "HTML 업로드 권한이 필요합니다.", 403);
        if (pathname === "/reports/upload" && request.method === "GET") {
          const destination = await notificationTarget(config, notificationsEnabled, { lookup: url.searchParams.get("destination") === "1", fetcher });
          if (url.searchParams.get("guide") === "1") {
            const [instructions, design, context] = await Promise.all([
              source("instructions", data), source("design", data), source("context", data),
            ]);
            return send(view.publisherGuide({ instructions, design, context, research: researchState(data, personal), today, destination }, session.role, !!channelId));
          }
          return send(view.upload(today, session.role, data.reports.find((r) => r.date === (url.searchParams.get("published") || today)), Object.values(data.deliveries), notificationsEnabled && (!!channelId || !personalAccountMode || !!linkedMember?.dm_opt_in), channelId, personal, basePath, destination));
        }
        if (Object.hasOwn(sourceFiles, pathname.slice("/reports/".length)) && request.method === "GET") return send(await source(pathname.slice("/reports/".length), data), 200, "text/plain; charset=utf-8");
        if (pathname === "/reports/notify" && request.method === "POST") {
          if (channelId) await store.queueChannelReport(today, channelId);
          scheduleNotifications(); return redirect("/reports/upload");
        }
        const draftFile = pathname.match(/^\/reports\/upload\/preview\/([a-f0-9-]{36})\/html$/);
        if (draftFile && request.method === "GET") {
          const draft = await store.draft(draftFile[1], sessionHash);
          return new Response(url.searchParams.get("reading") === "1" ? readableReport(draft.html) : draft.html, { headers: { ...htmlSecurity, "Content-Type": "text/html; charset=utf-8" } });
        }
        if (pathname === "/reports/upload/preview" && request.method === "POST") {
          const form = await formData(request), file = form.get("html");
          const pasted = textField(form, "htmlText"), hasText = !!pasted.trim();
          const hasFile = file && typeof file.arrayBuffer === "function" && !!file.name;
          check(hasFile || hasText, "HTML 파일을 선택하거나 HTML 전체 내용을 붙여넣어 주세요.");
          check(!(hasFile && hasText), "파일 선택과 HTML 붙여넣기 중 하나만 사용해 주세요.");
          let html = pasted;
          if (hasFile) {
            check(/\.html?$/i.test(file.name) && file.size > 0 && file.size <= 2 * 1024 * 1024, "2MB 이하의 .html 파일을 선택해 주세요.");
            try { html = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()); } catch { check(false, "HTML을 UTF-8 인코딩으로 저장한 뒤 올려 주세요."); }
          }
          check(Buffer.byteLength(html) <= 2 * 1024 * 1024, "HTML은 2MB 이하여야 합니다.", 413);
          const manifest = manifestFromHtml(html);
          check(!personal || manifest?.audience === "personal", "개인 보고서 지침의 audience: personal과 category를 포함해 주세요.");
          check(personal || manifest?.audience !== "personal", "개인 보고서는 별도 개인 사이트에서 업로드해 주세요.");
          validateResearchState(data, manifest);
          const draft = await store.stage({ date: textField(form, "date"), title: textField(form, "title"), summary: textField(form, "summary"), html, notify: textField(form, "notify") === "yes", reissue: textField(form, "reissue") === "yes", changeReason: textField(form, "changeReason") }, sessionHash, today);
          return send(view.preview(draft, session.role, personal, await notificationTarget(config, notificationsEnabled)));
        }
        if (pathname === "/reports/upload/publish" && request.method === "POST") {
          const form = await formData(request); check(textField(form, "confirmed") === "yes", "보고서 내용을 확인해 주세요.");
          const result = await store.publish(await store.draft(textField(form, "draft"), sessionHash), today, channelId, config.personalOwnerId || "", personalAccountMode, { allowPersonalChannel: sharedPersonal && !!channelId });
          // Resume persisted queues after an interrupted upload response, too.
          scheduleNotifications();
          return redirect(`/reports/upload?published=${result.report.date}`);
        }
        check(false, "페이지를 찾을 수 없습니다.", 404);
      }
      if (!session && request.method === "GET") return send(sharedPersonal ? view.sharedLogin(oauthConfigured) : view.login(personalAccountMode ? "admin" : "member", personalAccountMode || oauthConfigured, !!channelId, personal));
      if (!personalAccountMode && member && !readable && pathname === "/reports" && request.method === "GET") return redirect("/reports/account");
      check(readable, "승인된 구독자만 보고서를 볼 수 있습니다.", 403);
      const privateReader = sharedPersonal && !admin;
      const viewRole = privateReader ? "reader" : session.role;
      const opportunities = privateReader ? memberOpportunities(data, member.id) : data.opportunities;
      const progressAccount = personal ? member || linkedMember : null;
      if (pathname === "/reports/progress" && request.method === "GET") {
        const filter = url.searchParams.get("status") || "";
        check(!filter || Object.hasOwn(progressLabels, filter), "진행 상태를 확인해 주세요.");
        return send(view.progressPage(opportunities, viewRole, filter, personal, progressAccount));
      }
      const progressMatch = pathname.match(/^\/reports\/opportunities\/([a-z0-9-]{3,80})\/status$/);
      if (progressMatch && request.method === "POST") {
        check(readable, "승인된 구독자와 관리자만 진행 상태를 변경할 수 있습니다.", 403);
        const form = await formData(request), date = textField(form, "date");
        check(!date || data.reports.some((report) => report.date === date && report.opportunities?.some((item) => item.id === progressMatch[1])), "해당 보고서의 진행 항목이 아닙니다.");
        const revision = textField(form, "revision");
        check(/^\d+$/.test(revision), "진행 기록 버전을 확인해 주세요.");
        check(form.has("status") || form.has("note"), "변경할 상태나 메모가 필요합니다.");
        const input = { status: form.has("status") ? textField(form, "status") : undefined, note: form.has("note") ? textField(form, "note") : undefined, revision: Number(revision) };
        if (privateReader) await store.setMemberProgress(member.id, progressMatch[1], input);
        else await store.setProgress(progressMatch[1], input, session.subject, admin ? null : member.id, { allowStaleStatus: personalAccountMode });
        return redirect(date ? `/reports/${date}?progress=${progressMatch[1]}#progress-${progressMatch[1]}` : `/reports/progress#progress-${progressMatch[1]}`);
      }
      const attachMatch = pathname.match(/^\/reports\/(\d{4}-\d{2}-\d{2})\/opportunities$/);
      if (attachMatch && request.method === "POST") {
        check(admin, "기존 보고서의 진행 항목은 관리자만 연결할 수 있습니다.", 403);
        const form = await formData(request);
        await store.attachOpportunities(attachMatch[1], parseManifest(textField(form, "manifest")));
        return redirect(`/reports/${attachMatch[1]}?progress=1`);
      }
      if (pathname === "/reports" && request.method === "GET") return send(view.archive(data.reports, viewRole, (url.searchParams.get("q") || "").slice(0, 100), Math.floor(Number(url.searchParams.get("page")) || 1), personal, privateReader ? view.readerOverview(!!channelId) : personalAccountMode ? view.personalOverview(linkedMember, !!channelId) : ""));
      const reportMatch = pathname.match(/^\/reports\/(\d{4}-\d{2}-\d{2})(\/html)?$/);
      check(reportMatch && request.method === "GET", "페이지를 찾을 수 없습니다.", 404);
      let report = data.reports.find((r) => r.date === reportMatch[1]); check(report, "보고서를 찾을 수 없습니다.", 404);
      if (reportMatch[2]) {
        if (url.searchParams.has("revision")) {
          const requested = url.searchParams.get("revision");
          check(/^[1-9]\d*$/.test(requested), "보고서 버전을 확인해 주세요.");
          report = [report, ...(report.previousVersions || [])].find((entry) => reportRevision(entry) === Number(requested));
          check(report, "해당 보고서 버전을 찾을 수 없습니다.", 404);
        }
        const html = await store.html(report);
        return new Response(url.searchParams.get("reading") === "1" ? readableReport(html) : html, { headers: { ...htmlSecurity, "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `inline; filename="gammaru-${report.date}.html"` } });
      }
      const filter = url.searchParams.get("status") || "";
      check(!filter || Object.hasOwn(progressLabels, filter), "진행 상태를 확인해 주세요.");
      return send(view.viewer(report, viewRole, opportunities, url.searchParams.get("progress") || "", filter, progressAccount));
    } catch (error) {
      return send(view.page("요청 확인", `<section class="panel narrow"><h1>확인이 필요합니다.</h1><p>${escapeError(error.status ? error.message : "요청을 처리하지 못했습니다. 저장소 연결을 확인해 주세요.")}</p><a class="button secondary" href="/reports/upload?guide=1">최신 조사 자료 확인</a> <a class="button secondary" href="/reports/upload">HTML 업로드</a> <a class="button secondary" href="/reports">보고서 목록</a></section>`, "guest", personal), error.status || 503);
    }
  };
}
const escapeError = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export async function handleBriefRequest(request, options) { return createBriefHandler(options)(request); }
