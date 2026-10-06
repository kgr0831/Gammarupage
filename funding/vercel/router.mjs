import { briefConfig, personalConfig } from "./config.mjs";
import { createBriefHandler } from "./handler.mjs";
import { reportCookieName } from "./paths.mjs";

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
    const personal = personalRequest(request);
    return createBriefHandler({ ...options, config: personal ? personalConfig(request, env) : briefConfig(request, env), store: personal ? personalStore : clubStore })(request);
  };
}

export const handleSiteRequest = (request, options) => createSiteHandler(options)(request);
