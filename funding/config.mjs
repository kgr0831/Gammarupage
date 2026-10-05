import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../", import.meta.url));

export function configuration(env = process.env) {
  const port = Number(env.FUNDING_PORT || 4310);
  const origin = new URL(env.FUNDING_ORIGIN || `http://127.0.0.1:${port}`);
  if (origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password) throw new Error("FUNDING_ORIGIN must be an origin without a path or credentials.");
  if (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["127.0.0.1", "localhost"].includes(origin.hostname))) throw new Error("A remote FUNDING_ORIGIN requires HTTPS.");
  const token = env.FUNDING_ADMIN_TOKEN || "";
  if (token.length < 32) throw new Error("Set FUNDING_ADMIN_TOKEN to a random value of at least 32 characters.");
  const hour = Number(env.FUNDING_HOUR_KST || 9);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error("FUNDING_HOUR_KST must be 0–23.");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid FUNDING_PORT.");
  return {
    port, origin: origin.origin, secure: origin.protocol === "https:", token, hour,
    host: env.FUNDING_HOST || "127.0.0.1",
    schedule: env.FUNDING_SCHEDULE_ENABLED === "true",
    dataDir: path.resolve(env.FUNDING_DATA_DIR || path.join(root, "funding/data")),
    profilePath: path.resolve(env.GAMMARU_INFO_PATH || path.join(root, "gammaruInfo.md")),
    codexBin: env.FUNDING_CODEX_BIN || "codex",
    codexHome: env.FUNDING_CODEX_HOME ? path.resolve(env.FUNDING_CODEX_HOME) : "",
    codexModel: env.FUNDING_CODEX_MODEL || "",
    factchatKey: env.FACTCHAT_API_KEY || env.BAZE_API_KEY || "",
    factchatModel: env.FACTCHAT_MODEL || "",
    discordWebhook: env.DISCORD_WEBHOOK_URL || "",
    resendKey: env.RESEND_API_KEY || "",
    emailFrom: env.FUNDING_EMAIL_FROM || "",
  };
}

export { seoulClock } from "./clock.mjs";
