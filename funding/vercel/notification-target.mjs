import { reportChannel } from "./access.mjs";

const snowflake = (value) => typeof value === "string" && /^\d{17,20}$/.test(value);
const displayName = (value) => typeof value === "string" ? value.slice(0, 100) : "";

// Names are optional, read-only metadata. Normal page loads need no Discord call.
// The configured ID remains authoritative; a lookup never changes the recipient.
export async function notificationTarget(config, enabled, { lookup = false, fetcher = fetch } = {}) {
  const channelId = reportChannel(config);
  if (!channelId) return null;
  const target = { channelId, enabled, lookup: snowflake(channelId) ? "not_requested" : "invalid" };
  if (!lookup || target.lookup === "invalid") return target;
  target.lookup = "unavailable";
  if (!config.discordBotToken) return target;
  const signal = AbortSignal.timeout(2500);
  const get = async (pathname) => {
    const response = await fetcher(`https://discord.com/api/v10${pathname}`, {
      method: "GET", redirect: "error", cache: "no-store", signal,
      headers: { authorization: `Bot ${config.discordBotToken}` },
    });
    return response.ok ? response.json() : null;
  };
  try {
    const channel = await get(`/channels/${channelId}`);
    if (!channel) return target;
    if (channel.id !== channelId || ![0, 5].includes(channel.type) || !snowflake(channel.guild_id)) {
      target.lookup = "invalid";
      return target;
    }
    Object.assign(target, {
      lookup: "verified", guildId: channel.guild_id, channelName: displayName(channel.name),
      url: `https://discord.com/channels/${channel.guild_id}/${channelId}`,
    });
    const guild = await get(`/guilds/${channel.guild_id}`);
    if (guild?.id === channel.guild_id) target.guildName = displayName(guild.name);
  } catch { /* Keep the configured ID and any verified channel data; never return errors or credentials. */ }
  return target;
}
