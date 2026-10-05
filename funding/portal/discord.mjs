import { digest } from "../schema.mjs";
import { seoulClock } from "../config.mjs";

export class DiscordNotifier {
  constructor(store, config, fetcher = fetch) {
    this.store = store; this.config = config; this.fetch = fetcher; this.running = false; this.resumeAt = 0;
  }
  async request(path, body) {
    return this.fetch(`https://discord.com/api/v10${path}`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { authorization: `Bot ${this.config.discordBotToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  async limited(response, row) {
    if (response.status !== 429) return false;
    let seconds = 60;
    try { const body = await response.json(); if (Number.isFinite(body.retry_after)) seconds = Math.min(86400, Math.max(1, body.retry_after)); } catch { /* Fall back to a quiet retry. */ }
    this.resumeAt = Date.now() + seconds * 1000 + 1000;
    this.store.finishDelivery(row, "pending", null, this.resumeAt);
    return true;
  }
  async drain() {
    if (this.running || Date.now() < this.resumeAt || !this.config.dmEnabled || !this.config.discordBotToken) return;
    this.running = true;
    try {
      // Small sequential batches respect Discord limits and keep the worker responsive.
      for (let i = 0; i < 10; i++) {
        const row = this.store.claimDelivery(seoulClock().date);
        if (!row) break;
        let messageStarted = false;
        try {
          const dm = await this.request("/users/@me/channels", { recipient_id: row.member_id });
          if (await this.limited(dm, row)) break;
          if (!dm.ok) { this.store.finishDelivery(row, dm.status === 403 ? "blocked" : "failed"); continue; }
          const channel = await dm.json();
          if (!/^\d{17,20}$/.test(channel.id || "")) { this.store.finishDelivery(row, "failed"); continue; }
          // Recheck after the network wait, in case consent/approval was withdrawn.
          if (!this.store.canNotify(row.member_id)) { this.store.finishDelivery(row, "cancelled"); continue; }
          messageStarted = true;
          const sent = await this.request(`/channels/${channel.id}/messages`, {
            content: `${this.config.origin}/members/reports/${row.date}`,
            flags: 4, allowed_mentions: { parse: [] },
            nonce: digest([row.date, row.member_id]).slice(0, 25), enforce_nonce: true,
          });
          if (await this.limited(sent, row)) break;
          if (!sent.ok) {
            this.store.finishDelivery(row, sent.status === 403 ? "blocked" : sent.status >= 500 ? "uncertain" : "failed");
            continue;
          }
          const result = await sent.json();
          if (!/^\d{17,20}$/.test(result.id || "")) throw new Error("Missing delivery confirmation");
          this.store.finishDelivery(row, "sent", result.id);
        } catch {
          // Discord's nonce window is short; never blindly resend an ambiguous delivery.
          this.store.finishDelivery(row, messageStarted ? "uncertain" : "failed");
        }
      }
    } finally { this.running = false; }
  }
}
