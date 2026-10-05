export const isPersonal = (config) => config.service === "personal" || !!config.personalOwnerId;
export const personalRecipient = (config, state) => config.service === "personal" ? state?.personalAccount?.discordId || "" : config.personalOwnerId || "";
export const reportChannel = (config) => isPersonal(config) ? "" : config.discordReportChannelId || "";
export const allowedMember = (member, config, state) => !!member && (!isPersonal(config) || member.id === personalRecipient(config, state));
export const reportRecipient = (member, config, state) => allowedMember(member, config, state) && member.status === "approved" && member.dm_opt_in;
