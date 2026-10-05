export function briefConfig(request, env = process.env) {
  const requestOrigin = new URL(request.url).origin;
  const local = ["localhost", "127.0.0.1"].includes(new URL(requestOrigin).hostname);
  const value = env.REPORTS_SITE_URL || (local ? requestOrigin : "");
  const origin = value ? new URL(value) : null;
  if (origin && (origin.pathname !== "/" || origin.username || origin.password || origin.search || origin.hash || (origin.protocol !== "https:" && !local))) throw new Error("Invalid REPORTS_SITE_URL");
  const token = env.FUNDING_ADMIN_TOKEN || "";
  const publisherToken = env.FUNDING_PUBLISHER_TOKEN || "";
  const service = env.REPORTS_SERVICE || "club";
  if (!["club", "personal"].includes(service)) throw new Error("Invalid REPORTS_SERVICE");
  const personalOwnerId = service === "personal" ? (env.REPORTS_PERSONAL_OWNER_ID || "").trim() : "";
  if (personalOwnerId && !/^\d{17,20}$/.test(personalOwnerId)) throw new Error("Invalid REPORTS_PERSONAL_OWNER_ID");
  return {
    origin: origin?.origin || "", configured: !!origin && token.length >= 8 && (service !== "personal" || !!personalOwnerId),
    service,
    secure: origin?.protocol === "https:", token,
    adminUsername: env.FUNDING_ADMIN_USERNAME || "admin",
    publisherToken: publisherToken.length >= 32 && publisherToken !== token ? publisherToken : "",
    blobToken: env.BLOB_READ_WRITE_TOKEN || "",
    discordApplicationId: env.DISCORD_APPLICATION_ID || "",
    discordClientSecret: env.DISCORD_CLIENT_SECRET || "",
    discordBotToken: env.DISCORD_BOT_TOKEN || "",
    discordDeliveryMode: env.DISCORD_DELIVERY_MODE || "direct",
    discordWorkerToken: env.DISCORD_WORKER_TOKEN || "",
    personalOwnerId,
    discordReportChannelId: personalOwnerId ? "" : (env.DISCORD_REPORT_CHANNEL_ID || "").trim(),
    dmEnabled: env.DISCORD_DM_ENABLED === "true",
  };
}
