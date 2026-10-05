import { readFile } from "node:fs/promises";
import { research } from "./providers.mjs";
import { check } from "./schema.mjs";
import { seoulClock } from "./config.mjs";

export async function notifyDiscord(config, date, fetcher = fetch) {
  if (!config.discordWebhook) return "not_configured";
  const url = new URL(config.discordWebhook);
  check(url.protocol === "https:" && url.hostname === "discord.com" && /^\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(url.pathname) && !url.username && !url.password, "Invalid Discord webhook URL");
  url.search = "?wait=true";
  const response = await fetcher(url, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: `${config.origin}/?report=${date}`, flags: 4, allowed_mentions: { parse: [] } }),
  });
  if (!response.ok) throw new Error("Discord notification failed");
  return "sent";
}

export class FundingService {
  constructor(store, config, dependencies = {}) {
    this.store = store; this.config = config;
    this.research = dependencies.research || research;
    this.fetch = dependencies.fetch || fetch;
    this.now = dependencies.now || (() => new Date());
    this.notify = dependencies.notify || ((date) => notifyDiscord(this.config, date, this.fetch));
    this.running = null;
  }
  async start(retry = false) {
    check(!this.running, "검색이 이미 진행 중입니다.", 409);
    const { date } = seoulClock(this.now());
    check(this.store.startRun(date, retry), "오늘 검색 기록이 있습니다. 실패한 검색만 다시 실행할 수 있습니다.", 409);
    this.running = this.run(date).finally(() => { this.running = null; });
    return date;
  }
  async run(date) {
    try {
      const profile = await readFile(this.config.profilePath, "utf8");
      check(profile.trim() && profile.length <= 100000, "Profile is missing or too large");
      const result = await this.research(this.config, profile, date);
      this.store.saveReport({ ...result, date, generatedAt: this.now().toISOString() }, this.config.emailFrom);
    } catch {
      this.store.failRun(date, "조사에 실패했습니다. 프로필 경로, Codex 로그인/한도, 팩트챗 설정을 확인한 뒤 다시 실행해 주세요.");
      return;
    }
    try { this.store.notification(date, await this.notify(date)); }
    catch { this.store.notification(date, "failed_or_uncertain"); }
  }
  async tick() {
    const { date, hour } = seoulClock(this.now());
    if (!this.config.schedule || this.running || hour < this.config.hour || this.store.db.prepare("SELECT date FROM runs WHERE date=?").get(date)) return;
    await this.start();
  }
  canExecute(action) {
    if (action.payload.kind === "send_email") {
      check(this.config.resendKey && this.config.emailFrom, "메일 발송 계정이 설정되지 않았습니다.", 409);
      check(action.payload.from === this.config.emailFrom, "발신 계정이 변경되었습니다. 초안을 저장해 새 발신 정보를 반영하고 다시 승인해 주세요.", 409);
    }
  }
  async execute(id) {
    this.canExecute(this.store.action(id));
    const action = this.store.claim(id, seoulClock(this.now()).date);
    const { payload } = action;
    if (payload.kind === "prepare_brief") {
      this.store.finish(id, "completed", { document: payload.body, completedAt: this.now().toISOString() });
      return;
    }
    // Idempotency plus a persisted claim prevents double clicks from sending twice.
    // Unknown outcomes require manual provider-side confirmation; never auto-retry mail.
    try {
      const response = await this.fetch("https://api.resend.com/emails", {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
        headers: { authorization: `Bearer ${this.config.resendKey}`, "content-type": "application/json", "idempotency-key": `gammaru/${id}/${action.hash}` },
        body: JSON.stringify({ from: payload.from, to: [payload.recipient], subject: payload.subject, text: payload.body }),
      });
      if (!response.ok) throw new Error("Email response was not successful");
      const result = await response.json();
      if (typeof result.id !== "string") throw new Error("Email confirmation missing");
      this.store.finish(id, "completed", { provider: "resend", reference: result.id, completedAt: this.now().toISOString() });
    } catch {
      this.store.finish(id, "uncertain", { message: "발송 결과 확인이 필요합니다. 메일 서비스에서 수신자와 발송 기록을 확인해 주세요. 자동 재발송하지 않습니다." });
    }
  }
}
