import { digest } from "../schema.mjs";
import { seoulClock } from "../clock.mjs";
import { reportRevision, currentDeliveryReport } from "./report-versions.mjs";
import { reportChannel, allowedMember, reportRecipient, isPersonal } from "./access.mjs";

function briefText(value, limit) {
  const chars = Array.from(value.trim().replace(/\s+/g, " "));
  const clipped = chars.length > limit ? `${chars.slice(0, limit - 1).join("")}…` : chars.join("");
  return clipped.replace(/[\\`*_~|\[\]()<>#]/g, "\\$&");
}

export function formatBriefMessage(report, origin, basePath = "/reports") {
  const title = briefText(report.title, 150);
  const personal = report.audience === "personal";
  const summary = briefText(report.summary || "", 300) || (personal ? "오늘의 개발·AI·IT 공모전과 채용 정보를 확인하세요." : "오늘 확인한 외부 후원·운영자금·유용한 정보를 보고서에서 확인하세요.");
  return `📰 ${personal ? "개인" : "겜마루"} 데일리 브리핑 · ${report.date.replaceAll("-", ".")}${reportRevision(report) > 1 ? ` · 수정본 v${reportRevision(report)}` : ""}\n\n**${title}**\n\n${summary}\n\n전체 보고서 보기\n${origin}${basePath}/${report.date}`;
}

export function formatMemberNotice(field, origin, personal = false, basePath = "/reports") {
  if (personal) return `개인 데일리 스크럼 ${field === "approval_notice" ? "확인 DM입니다" : "Discord 연결이 완료되었습니다"}.\n새 보고서의 요약과 링크는 이 계정의 DM으로 받습니다.\n보고서: ${origin}${basePath}\nDM 수신 설정: ${origin}${basePath}/account`;
  return field === "approval_notice" ? `겜마루 보고서 구독이 승인되었습니다!\n외부 후원·운영자금·도움되는 정보를 여기에서 확인하세요.\n보고서 목록: ${origin}${basePath}\n구독·알림 설정: ${origin}${basePath}/account` : `겜마루 로그인이 완료되었습니다.\n구독 상태와 보고서 확인: ${origin}${basePath}/account`;
}

// A transactional login notice is independent of the daily newsletter switch.
// Claim once in Blob so duplicate callbacks/workers cannot send the same notice twice.
export async function deliverLoginNotice(store, config, memberId, noticeId, fetcher = fetch) {
  return deliverMemberNotice(store, config, memberId, noticeId, "login_notice", fetcher);
}

export async function deliverApprovalNotice(store, config, memberId, noticeId, fetcher = fetch) {
  return deliverMemberNotice(store, config, memberId, noticeId, "approval_notice", fetcher);
}

async function deliverMemberNotice(store, config, memberId, noticeId, field, fetcher) {
  if (!config.discordBotToken) return;
  const claimed = await store.update((state) => {
    const member = state.members[memberId], notice = member?.[field];
    if (!allowedMember(member, config, state)) return false;
    if (notice?.id !== noticeId || notice.status !== "pending") return false;
    if (field === "approval_notice" && member.status !== "approved") { notice.status = "cancelled"; return false; }
    notice.status = "sending"; return true;
  });
  if (!claimed) return;
  const finish = (status, details = {}) => store.update((state) => {
    const notice = state.members[memberId]?.[field];
    if (notice?.id === noticeId) Object.assign(notice, { status }, details);
  });
  const failed = async (response) => {
    let data; try { data = await response.json(); } catch { /* Do not store raw Discord responses. */ }
    const details = { httpStatus: response.status, ...(Number.isInteger(data?.code) ? { errorCode: data.code } : {}) };
    if (response.status === 429) details.retryAt = Date.now() + Math.min(86400, Math.max(1, Number(data?.retry_after) || 60)) * 1000;
    await finish(response.status === 403 ? "blocked" : messageStarted && response.status >= 500 ? "uncertain" : "failed", details);
  };
  const api = (path, body) => fetcher(`https://discord.com/api/v10${path}`, {
    method: "POST", signal: AbortSignal.timeout(10000), redirect: "error",
    headers: { authorization: `Bot ${config.discordBotToken}`, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  let messageStarted = false;
  try {
    const opened = await api("/users/@me/channels", { recipient_id: memberId });
    if (!opened.ok) { await failed(opened); return; }
    const channel = await opened.json();
    if (!/^\d{17,20}$/.test(channel.id || "")) { await finish("failed"); return; }
    const currentState = await store.read();
    const current = currentState.members[memberId];
    if (!allowedMember(current, config, currentState) || current?.[field]?.id !== noticeId || (field === "approval_notice" && current.status !== "approved")) { await finish("cancelled"); return; }
    messageStarted = true;
    const sent = await api(`/channels/${channel.id}/messages`, {
      content: formatMemberNotice(field, config.origin, isPersonal(config), config.basePath),
      flags: 4, allowed_mentions: { parse: [] }, nonce: digest(noticeId).slice(0, 25), enforce_nonce: true,
    });
    if (!sent.ok) { await failed(sent); return; }
    const result = await sent.json();
    await finish(/^\d{17,20}$/.test(result.id || "") ? "sent" : "uncertain");
  } catch { await finish(messageStarted ? "uncertain" : "failed"); }
}

export async function deliverBriefLinks(store, config, fetcher = fetch, budgetMs = 45000) {
  const channelId = reportChannel(config);
  if (!config.discordBotToken || (channelId ? !/^\d{17,20}$/.test(channelId) : !config.dmEnabled)) return;
  const eligible = (row, state) => !!currentDeliveryReport(state, row) && (!isPersonal(config) || currentDeliveryReport(state, row).audience === "personal") && (channelId ? row.channelId === channelId : !row.channelId && reportRecipient(state.members[row.memberId], config, state));
  const end = Date.now() + budgetMs;
  const api = (path, body) => fetcher(`https://discord.com/api/v10${path}`, {
    method: body === undefined ? "GET" : "POST", signal: AbortSignal.timeout(10000), redirect: "error",
    headers: { authorization: `Bot ${config.discordBotToken}`, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  while (Date.now() < end - 25000) {
    const today = seoulClock().date;
    const claimedAt = Date.now();
    const claimed = await store.update((state) => {
      for (const d of Object.values(state.deliveries)) {
        if (d.status === "sending" && d.claimedAt < Date.now() - 300000) d.status = "uncertain";
        if (d.status === "pending" && (d.date !== today || !eligible(d, state))) d.status = "cancelled";
      }
      const entry = Object.entries(state.deliveries).find(([, d]) => d.status === "pending" && d.retryAt <= Date.now());
      if (!entry) return null;
      const [key, row] = entry; row.status = "sending"; row.claimedAt = claimedAt;
      return { key, ...row };
    });
    if (!claimed) return;
    const finish = (status, extra = {}) => store.update((state) => {
      const row = state.deliveries[claimed.key];
      if (row?.status === "sending" && row.claimedAt === claimedAt) Object.assign(row, { status }, extra);
    });
    async function rateLimited(response) {
      if (response.status !== 429) return false;
      let seconds = 60;
      try { const data = await response.json(); if (Number.isFinite(data.retry_after)) seconds = Math.min(86400, Math.max(1, data.retry_after)); } catch { /* Retry later. */ }
      const retryAt = Date.now() + seconds * 1000 + 1000;
      await finish("pending", { retryAt });
      await store.update((state) => { for (const d of Object.values(state.deliveries)) if (d.status === "pending") d.retryAt = Math.max(d.retryAt, retryAt); });
      return true;
    }
    let messageStarted = false;
    try {
      const opened = channelId ? await api(`/channels/${channelId}`) : await api("/users/@me/channels", { recipient_id: claimed.memberId });
      if (await rateLimited(opened)) return;
      if (!opened.ok) { await finish(opened.status === 403 ? "blocked" : "failed"); continue; }
      const channel = await opened.json();
      if (!/^\d{17,20}$/.test(channel.id || "")) { await finish("failed"); continue; }
      if (channelId && (channel.id !== channelId || ![0, 5].includes(channel.type) || !/^\d{17,20}$/.test(channel.guild_id || ""))) { await finish("failed"); continue; }
      const data = await store.read();
      const report = currentDeliveryReport(data, claimed);
      if (!report || !eligible(claimed, data) || today !== seoulClock().date) { await finish("cancelled"); continue; }
      messageStarted = true;
      const sent = await api(`/channels/${channel.id}/messages`, {
        content: formatBriefMessage(report, config.origin, config.basePath), flags: 4, allowed_mentions: { parse: [] }, nonce: digest(claimed.key).slice(0, 25), enforce_nonce: true,
      });
      if (await rateLimited(sent)) return;
      if (!sent.ok) { await finish(sent.status === 403 ? "blocked" : sent.status >= 500 ? "uncertain" : "failed"); continue; }
      const result = await sent.json();
      if (!/^\d{17,20}$/.test(result.id || "")) throw new Error("Missing confirmation");
      await finish("sent", { reference: result.id });
    } catch {
      // Claims persist across serverless instances. Unknown outcomes never auto-retry.
      await finish(messageStarted ? "uncertain" : "failed");
    }
  }
}
