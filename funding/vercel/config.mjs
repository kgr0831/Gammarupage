export function briefConfig(request, env = process.env) {
  const requestOrigin = new URL(request.url).origin;
  const local = ["localhost", "127.0.0.1"].includes(new URL(requestOrigin).hostname);
  const value = env.REPORTS_SITE_URL || (local ? requestOrigin : "");
  const origin = value ? new URL(value) : null;
  if (origin && (origin.pathname !== "/" || origin.username || origin.password || origin.search || origin.hash || (origin.protocol !== "https:" && !local))) throw new Error("Invalid REPORTS_SITE_URL");
  const token = env.FUNDING_ADMIN_TOKEN || "";
  const publisherToken = env.FUNDING_PUBLISHER_TOKEN || "";
  return {
    origin: origin?.origin || "", configured: !!origin && token.length >= 32,
    secure: origin?.protocol === "https:", token,
    adminUsername: env.FUNDING_ADMIN_USERNAME || "admin",
    publisherToken: publisherToken.length >= 32 && publisherToken !== token ? publisherToken : "",
    blobToken: env.BLOB_READ_WRITE_TOKEN || "",
    discordApplicationId: env.DISCORD_APPLICATION_ID || "",
    discordClientSecret: env.DISCORD_CLIENT_SECRET || "",
    discordBotToken: env.DISCORD_BOT_TOKEN || "",
    dmEnabled: env.DISCORD_DM_ENABLED === "true",
  };
}
