import { configuration } from "../config.mjs";

export function portalConfiguration(env = process.env) {
  const config = configuration(env);
  const publisherToken = env.FUNDING_PUBLISHER_TOKEN || "";
  if (publisherToken && publisherToken.length < 32) throw new Error("Set FUNDING_PUBLISHER_TOKEN to at least 32 characters.");
  if (publisherToken && publisherToken === config.token) throw new Error("Publisher and administrator credentials must differ.");
  const fallbackHour = Number(env.FUNDING_FALLBACK_HOUR_KST || 10);
  if (!Number.isInteger(fallbackHour) || fallbackHour < 0 || fallbackHour > 23) throw new Error("Invalid fallback hour.");
  return {
    ...config,
    // The cloud dot is the primary scheduler. Do not also start the legacy local schedule.
    schedule: false,
    adminUsername: env.FUNDING_ADMIN_USERNAME || "admin",
    publisherToken,
    discordApplicationId: env.DISCORD_APPLICATION_ID || "",
    discordClientSecret: env.DISCORD_CLIENT_SECRET || "",
    discordBotToken: env.DISCORD_BOT_TOKEN || "",
    dmEnabled: env.DISCORD_DM_ENABLED === "true",
    fallbackEnabled: env.FUNDING_FALLBACK_ENABLED === "true",
    fallbackHour,
  };
}
