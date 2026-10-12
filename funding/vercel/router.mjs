import { briefConfig, personalConfig } from "./config.mjs";
import { createBriefHandler } from "./handler.mjs";
import { reportCookieName } from "./paths.mjs";

// next start/standalone can retain its internal origin in Request.url. Only the
// loopback nginx deployment opts in, and nginx overwrites these three headers.
// Never trust an arbitrary forwarded host or relax the POST Origin check.
export function proxyRequest(request, env) {
  if (env.REPORTS_TRUST_PROXY !== "true") return request;
  let origin;
  try { origin = new URL(env.REPORTS_SITE_URL); } catch { return null; }
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.username || origin.password || origin.search || origin.hash
      || request.headers.get("host") !== origin.host
      || request.headers.get("x-forwarded-host") !== origin.host
      || request.headers.get("x-forwarded-proto") !== "https") return null;
  const url = new URL(request.url);
  return new Request(`${origin.origin}${url.pathname}${url.search}`, {
    method: request.method, headers: request.headers, signal: request.signal,
    ...(request.body ? { body: request.body, duplex: "half" } : {}),
  });
}

export function personalRequest(request) {
  const url = new URL(request.url), pathname = url.pathname.replace(/\/$/, "");
  if (pathname === "/personal" || pathname.startsWith("/personal/")) return true;
  if (pathname !== "/reports/auth/callback" || request.method !== "GET") return false;
  const state = url.searchParams.get("state");
  const cookieName = `${reportCookieName({ basePath: "/personal", secure: url.protocol === "https:" })}-oauth`;
  const cookies = Object.fromEntries((request.headers.get("cookie") || "").split(";").map(value => value.trim().split("=")).filter(parts => parts.length === 2));
  // Select only the flow whose nonce matches. The handler then validates the
  // one-time server record, and the initiating owner session for link changes.
  return /^[a-f0-9]{64}$/.test(state || "") && cookies[cookieName] === state;
}

export function createSiteHandler({ env = process.env, clubStore, personalStore, ...options } = {}) {
  return request => {
    request = proxyRequest(request, env);
    if (!request) return new Response("Invalid proxy origin", { status: 400, headers: { "Cache-Control": "private, no-store" } });
    const personal = personalRequest(request);
    return createBriefHandler({ ...options, config: personal ? personalConfig(request, env) : briefConfig(request, env), store: personal ? personalStore : clubStore })(request);
  };
}

export const handleSiteRequest = (request, options) => createSiteHandler(options)(request);
