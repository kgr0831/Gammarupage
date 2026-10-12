import { timingSafeEqual } from "node:crypto";
import { briefConfig, personalConfig } from "./config.mjs";
import { createReportStore } from "./store-factory.mjs";
import { pruneReports } from "./retention.mjs";
import { seoulClock } from "../clock.mjs";

export function maintenanceAuthorized(request, env) {
  const expected = `Bearer ${env.CRON_SECRET || ""}`, actual = request.headers.get("authorization") || "";
  return (env.CRON_SECRET || "").length >= 32 && Buffer.byteLength(expected) === Buffer.byteLength(actual) && timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}
export async function handleRetention(request, { env = process.env, stores, now = new Date() } = {}) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!maintenanceAuthorized(request, env)) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  if (request.method !== "GET") return Response.json({ error: "Method not allowed" }, { status: 405, headers });
  const results = [];
  for (const [name, configure] of [["club", briefConfig], ["personal", personalConfig]]) {
    try {
      const store = stores?.[name] || createReportStore(configure(request, env));
      results.push({ service: name, ...await pruneReports(store, seoulClock(now).date) });
    } catch { results.push({ service: name, error: "Storage maintenance requires review" }); }
  }
  return Response.json({ results }, { status: results.some(result => result.error || result.pendingDeletes) ? 503 : 200, headers });
}
