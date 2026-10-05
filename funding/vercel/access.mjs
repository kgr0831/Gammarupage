export const reportChannel = (config) => config.personalOwnerId ? "" : config.discordReportChannelId || "";
export const allowedMember = (member, config) => !!member && (!config.personalOwnerId || member.id === config.personalOwnerId);
export const reportRecipient = (member, config) => allowedMember(member, config) && member.status === "approved" && member.dm_opt_in;
