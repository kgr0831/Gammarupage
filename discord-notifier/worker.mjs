const snowflake = (value) => typeof value === "string" && /^\d{17,20}$/.test(value);
export class WorkerError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}
export function workerConfig(env = process.env) {
  let origin;
  try { origin = new URL(env.REPORTS_SITE_URL || "https://gammarupage.vercel.app"); } catch { throw new WorkerError("REPORTS_SITE_URL 설정을 확인하세요."); }
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password) throw new WorkerError("REPORTS_SITE_URL에는 HTTPS 사이트 주소만 입력하세요.");
  const botToken = env.DISCORD_BOT_TOKEN || env.DISCORD_TOKEN || "", workerToken = env.DISCORD_WORKER_TOKEN || "";
  if (!botToken || workerToken.length < 32 || botToken === workerToken) throw new WorkerError("봇 토큰과 별도의 32자 이상 DISCORD_WORKER_TOKEN이 필요합니다.");
  const seconds = Number(env.DISCORD_POLL_SECONDS || 60);
  if (!Number.isInteger(seconds) || seconds < 30 || seconds > 3600) throw new WorkerError("DISCORD_POLL_SECONDS는 30~3600초여야 합니다.");
  return { origin: origin.origin, botToken, workerToken, pollMs: seconds * 1000 };
}
export function createWorker(config, { fetch: fetcher = fetch } = {}) {
  async function site(operation, body = {}) {
    let response;
    try {
      response = await fetcher(`${config.origin}/reports/worker/${operation}`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
        headers: { authorization: `Bearer ${config.workerToken}`, "content-type": "application/json" }, body: JSON.stringify(body),
      });
    } catch { throw new WorkerError("보고서 사이트 연결 실패. 다음 확인 때 다시 시도합니다."); }
    if (!response.ok) throw new WorkerError(`보고서 사이트 요청 실패 (HTTP ${response.status}).`, response.status);
    try { return await response.json(); } catch { throw new WorkerError("사이트 응답 형식을 확인하세요."); }
  }
  const discord = (path, body) => fetcher(`https://discord.com/api/v10${path}`, {
    method: body === undefined ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(10000),
    headers: { authorization: `Bot ${config.botToken}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  async function outcome(response, started) {
    let data; try { data = await response.json(); } catch { /* Never log a remote error body. */ }
    const details = { httpStatus: response.status, ...(Number.isInteger(data?.code) ? { errorCode: data.code } : {}) };
    if (response.status === 429) return { ...details, status: "rate_limited", retryAfter: Number.isFinite(data?.retry_after) ? Math.min(86400, Math.max(1, data.retry_after)) : 60 };
    return { ...details, status: response.status === 403 ? "blocked" : started && response.status >= 500 ? "uncertain" : "failed" };
  }
  async function runOne() {
    const { job } = await site("claim");
    if (!job) return null;
    const channelId = job.target?.channelId, memberId = job.target?.memberId;
    if (typeof job.id !== "string" || !/^[a-f0-9]{64}$/.test(job.lease || "") || (!snowflake(channelId) && !snowflake(memberId)) || typeof job.message?.content !== "string" || !job.message.content.length || job.message.content.length > 2000 || !/^[a-f0-9]{25}$/.test(job.message.nonce || "")) throw new WorkerError("알림 작업 형식을 확인하세요.");
    const claim = { id: job.id, lease: job.lease };
    const finish = async (result) => { await site("finish", { ...claim, ...result }); return result.status; };
    let channel;
    try {
      const response = channelId ? await discord(`/channels/${channelId}`) : await discord("/users/@me/channels", { recipient_id: memberId });
      if (!response.ok) return await finish(await outcome(response, false));
      channel = await response.json();
    } catch (error) {
      if (error instanceof WorkerError) throw error;
      return finish({ status: "failed" });
    }
    if (!snowflake(channel?.id) || (channelId && (channel.id !== channelId || ![0, 5].includes(channel.type) || !snowflake(channel.guild_id)))) return finish({ status: "failed" });
    // Do not send if membership changed, this lease expired, or begin's response
    // was lost. A second begin on the same lease is rejected by the site.
    const permission = await site("begin", claim);
    if (!permission.send) return "cancelled";
    let result;
    try {
      const response = await discord(`/channels/${channel.id}/messages`, {
        content: job.message.content, flags: 4, allowed_mentions: { parse: [] }, nonce: job.message.nonce, enforce_nonce: true,
      });
      if (!response.ok) result = await outcome(response, true);
      else { const data = await response.json(); result = snowflake(data?.id) ? { status: "sent", reference: data.id } : { status: "uncertain" }; }
    } catch { result = { status: "uncertain" }; }
    // A failed acknowledgement never repeats the Discord POST. The persisted
    // sending claim becomes uncertain if the result cannot be recorded.
    return finish(result);
  }
  async function checkConnection() {
    const status = await site("status");
    let response;
    try { response = await discord("/users/@me"); } catch { throw new WorkerError("Discord 연결 실패."); }
    if (!response.ok) throw new WorkerError(`Discord 봇 인증 실패 (HTTP ${response.status}).`, response.status);
    const user = await response.json();
    if (!snowflake(user.id) || !user.bot) throw new WorkerError("Discord 봇 계정을 확인하세요.");
    return { ready: status.ready === true, mode: status.mode };
  }
  return { runOne, checkConnection };
}
