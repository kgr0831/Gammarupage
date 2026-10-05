import { digest } from "../schema.mjs";
import { seoulClock } from "../clock.mjs";

// A transactional login notice is independent of the daily newsletter switch.
// Claim once in Blob so duplicate callbacks/workers cannot send the same notice twice.
export async function deliverLoginNotice(store, config, memberId, noticeId, fetcher = fetch) {
  if (!config.discordBotToken) return;
  const claimed = await store.update((state) => {
    const notice = state.members[memberId]?.login_notice;
    if (notice?.id !== noticeId || notice.status !== "pending") return false;
    notice.status = "sending"; return true;
  });
  if (!claimed) return;
  const finish = (status) => store.update((state) => {
    const notice = state.members[memberId]?.login_notice;
    if (notice?.id === noticeId) notice.status = status;
  });
  const api = (path, body) => fetcher(`https://discord.com/api/v10${path}`, {
    method: "POST", signal: AbortSignal.timeout(10000), redirect: "error",
    headers: { authorization: `Bot ${config.discordBotToken}`, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  let messageStarted = false;
  try {
    const opened = await api("/users/@me/channels", { recipient_id: memberId });
    if (!opened.ok) { await finish(opened.status === 403 ? "blocked" : "failed"); return; }
    const channel = await opened.json();
    if (!/^\d{17,20}$/.test(channel.id || "")) { await finish("failed"); return; }
    messageStarted = true;
    const sent = await api(`/channels/${channel.id}/messages`, {
      content: `겜마루 로그인이 완료되었습니다.\n구독 상태와 보고서 확인: ${config.origin}/reports/account`,
      flags: 4, allowed_mentions: { parse: [] }, nonce: digest(noticeId).slice(0, 25), enforce_nonce: true,
    });
    if (!sent.ok) { await finish(sent.status === 403 ? "blocked" : sent.status >= 500 ? "uncertain" : "failed"); return; }
    const result = await sent.json();
    await finish(/^\d{17,20}$/.test(result.id || "") ? "sent" : "uncertain");
  } catch { await finish(messageStarted ? "uncertain" : "failed"); }
}

export async function deliverBriefLinks(store, config, fetcher = fetch, budgetMs = 45000) {
  if (!config.dmEnabled || !config.discordBotToken) return;
  const end = Date.now() + budgetMs;
  const api = (path, body) => fetcher(`https://discord.com/api/v10${path}`, {
    method: "POST", signal: AbortSignal.timeout(10000), redirect: "error",
    headers: { authorization: `Bot ${config.discordBotToken}`, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  while (Date.now() < end - 25000) {
    const today = seoulClock().date;
    const claimedAt = Date.now();
    const claimed = await store.update((state) => {
      for (const d of Object.values(state.deliveries)) {
        if (d.status === "sending" && d.claimedAt < Date.now() - 300000) d.status = "uncertain";
        if (d.status === "pending" && (d.date !== today || state.members[d.memberId]?.status !== "approved" || !state.members[d.memberId]?.dm_opt_in)) d.status = "cancelled";
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
      const opened = await api("/users/@me/channels", { recipient_id: claimed.memberId });
      if (await rateLimited(opened)) return;
      if (!opened.ok) { await finish(opened.status === 403 ? "blocked" : "failed"); continue; }
      const channel = await opened.json();
      if (!/^\d{17,20}$/.test(channel.id || "")) { await finish("failed"); continue; }
      const current = (await store.read()).members[claimed.memberId];
      if (current?.status !== "approved" || !current.dm_opt_in || today !== seoulClock().date) { await finish("cancelled"); continue; }
      messageStarted = true;
      const sent = await api(`/channels/${channel.id}/messages`, {
        content: `${config.origin}/reports/${today}`, flags: 4, allowed_mentions: { parse: [] }, nonce: digest(claimed.key).slice(0, 25), enforce_nonce: true,
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
