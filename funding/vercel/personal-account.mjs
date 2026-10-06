import { check } from "../schema.mjs";

export function validDiscordOwnerSession(state, session) {
  return !session.discordOwnerId || state.personalAccount?.discordId === session.discordOwnerId;
}

export function requirePersonalSession(state, sessionHash, proof) {
  const session = state.sessions[sessionHash];
  check(session?.role === "admin" && session.expires > Date.now() && session.proof === proof && validDiscordOwnerSession(state, session), "개인 계정으로 다시 로그인해 주세요.", 403);
}

export function requireLinkRevision(state, revision) {
  check(Number.isSafeInteger(revision) && revision === (state.personalAccount?.revision || 0), "Discord 연결이 변경되었습니다. 페이지를 새로고침해 주세요.", 409);
}

export function cancelPersonalNotices(state, id) {
  if (!id) return;
  const member = state.members[id];
  if (member) {
    for (const field of ["login_notice", "approval_notice"]) if (member[field]?.status === "pending") member[field].status = "cancelled";
  }
  for (const row of Object.values(state.deliveries)) if (row.memberId === id && row.status === "pending") row.status = "cancelled";
}

export function bindPersonalDiscord(state, user, sessionHash, proof, revision) {
  requirePersonalSession(state, sessionHash, proof);
  requireLinkRevision(state, revision);
  const previous = state.personalAccount?.discordId;
  if (previous && previous !== user?.id) {
    for (const [hash, session] of Object.entries(state.sessions)) if (session.discordOwnerId) delete state.sessions[hash];
    const old = state.members[previous];
    if (old) { old.status = "revoked"; old.dm_opt_in = false; }
    cancelPersonalNotices(state, previous);
  }
  state.personalAccount = { discordId: user?.id || "", revision: revision + 1, linkedAt: user ? new Date().toISOString() : null };
  if (!user) return null;
  const member = state.members[user.id] = { name: "", ...state.members[user.id], ...user };
  member.name ||= user.display_name.replace(/[\x00-\x1f]/g, "").trim().slice(0, 60) || user.username;
  member.status = "approved";
  // Reauthorizing the same Discord account must preserve an explicit opt-out.
  if (previous !== user.id) member.dm_opt_in = true;
  return member;
}
