import { randomBytes } from "node:crypto";
import { Store } from "../store.mjs";
import { check, digest, validateReport } from "../schema.mjs";
import { seoulClock } from "../config.mjs";
import { designHash, renderReport } from "./views.mjs";

function contentHash(report) {
  return digest({ summary: report.summary, searched: report.searched, warnings: report.warnings, opportunities: report.opportunities.map((item) => {
    const copy = { ...item }; delete copy.key; return copy;
  }) });
}

export class PortalStore extends Store {
  constructor(directory) {
    super(directory);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS members (
        id TEXT PRIMARY KEY, username TEXT NOT NULL, display_name TEXT NOT NULL, avatar TEXT,
        name TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'new',
        dm_opt_in INTEGER NOT NULL DEFAULT 0, requested_at TEXT, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, role TEXT NOT NULL, subject TEXT NOT NULL, proof TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS oauth_states (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS editions (date TEXT PRIMARY KEY, html TEXT NOT NULL, summary TEXT NOT NULL, content_hash TEXT NOT NULL, design_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS deliveries (
        date TEXT NOT NULL, member_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
        retry_at INTEGER NOT NULL DEFAULT 0, reference TEXT, updated_at TEXT NOT NULL,
        PRIMARY KEY(date,member_id)
      );
    `);
  }
  recover() {
    super.recover();
    this.db.exec("UPDATE deliveries SET status='uncertain' WHERE status='sending'");
    this.cleanup();
  }
  cleanup() {
    this.db.prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now());
    this.db.prepare("DELETE FROM oauth_states WHERE expires < ?").run(Date.now());
  }
  newSession(role, subject, proof, seconds) {
    this.cleanup();
    const token = randomBytes(32).toString("hex");
    this.db.prepare("INSERT INTO sessions VALUES (?,?,?,?,?)").run(digest(token), role, subject, proof, Date.now() + seconds * 1000);
    return token;
  }
  session(token) {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    return this.db.prepare("SELECT role,subject,proof FROM sessions WHERE hash=? AND expires>?").get(digest(token), Date.now()) || null;
  }
  deleteSession(token) { if (token) this.db.prepare("DELETE FROM sessions WHERE hash=?").run(digest(token)); }
  oauthState() {
    this.cleanup();
    const token = randomBytes(32).toString("hex");
    this.db.prepare("INSERT INTO oauth_states VALUES (?,?)").run(digest(token), Date.now() + 600000);
    return token;
  }
  consumeState(token) {
    if (!/^[a-f0-9]{64}$/.test(token || "")) return false;
    const row = this.db.prepare("DELETE FROM oauth_states WHERE hash=? AND expires>? RETURNING hash").get(digest(token), Date.now());
    return !!row;
  }
  upsertDiscord(user) {
    check(user && /^\d{17,20}$/.test(user.id) && typeof user.username === "string" && user.username.length <= 100 && !user.bot, "Discord 프로필을 확인하지 못했습니다.", 502);
    const display = typeof user.global_name === "string" ? user.global_name.slice(0, 100) : user.username;
    const avatar = typeof user.avatar === "string" && /^(a_)?[a-f0-9]{32}$/.test(user.avatar) ? user.avatar : null;
    this.db.prepare("INSERT INTO members(id,username,display_name,avatar,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,display_name=excluded.display_name,avatar=excluded.avatar,updated_at=excluded.updated_at").run(user.id, user.username, display, avatar, new Date().toISOString());
    return this.member(user.id);
  }
  member(id) { return this.db.prepare("SELECT * FROM members WHERE id=?").get(id); }
  members() { return this.db.prepare("SELECT * FROM members WHERE status<>'new' ORDER BY CASE WHEN status='pending' THEN 0 ELSE 1 END, requested_at DESC").all(); }
  subscribe(id, name, dm) {
    const member = this.member(id);
    check(member, "회원이 없습니다.", 404);
    if (["new", "revoked", "rejected"].includes(member.status)) {
      check(typeof name === "string" && name.trim().length >= 2 && name.trim().length <= 60 && !/[\x00-\x1f]/.test(name), "이름은 2~60자로 입력해 주세요.");
      this.db.prepare("UPDATE members SET name=?,status='pending',dm_opt_in=?,requested_at=?,updated_at=? WHERE id=?").run(name.trim(), dm ? 1 : 0, new Date().toISOString(), new Date().toISOString(), id);
    } else this.db.prepare("UPDATE members SET dm_opt_in=?,updated_at=? WHERE id=?").run(dm ? 1 : 0, new Date().toISOString(), id);
    if (!dm) this.db.prepare("UPDATE deliveries SET status='cancelled' WHERE member_id=? AND status='pending'").run(id);
  }
  changeMembership(id, operation) {
    const member = this.member(id);
    check(member, "회원을 찾을 수 없습니다.", 404);
    const transition = { approve: ["pending", "approved"], reject: ["pending", "rejected"], revoke: ["approved", "revoked"] }[operation];
    check(transition && member.status === transition[0], "회원 상태가 변경되었습니다. 새로고침해 주세요.", 409);
    this.transaction(() => {
      this.db.prepare("UPDATE members SET status=?,updated_at=? WHERE id=?").run(transition[1], new Date().toISOString(), id);
      if (operation !== "approve") this.db.prepare("UPDATE deliveries SET status='cancelled' WHERE member_id=? AND status='pending'").run(id);
      this.log(null, `membership ${operation}: ${id}`);
    });
  }
  unsubscribe(id) {
    this.transaction(() => {
      this.db.prepare("UPDATE members SET status='revoked',dm_opt_in=0,updated_at=? WHERE id=?").run(new Date().toISOString(), id);
      this.db.prepare("UPDATE deliveries SET status='cancelled' WHERE member_id=? AND status='pending'").run(id);
    });
  }
  saveReport(report, from) {
    // HTML, recommendations and recipients commit together, before any external notification.
    return super.saveReport(report, from, () => {
      this.db.prepare("INSERT INTO editions VALUES (?,?,?,?,?)").run(report.date, renderReport(report), report.summary, contentHash(report), designHash);
      this.db.prepare("INSERT INTO deliveries(date,member_id,updated_at) SELECT ?,id,? FROM members WHERE status='approved' AND dm_opt_in=1").run(report.date, new Date().toISOString());
      this.db.prepare("UPDATE reports SET notification='dm_queued' WHERE date=?").run(report.date);
    });
  }
  validateSubmission(input, now = new Date()) {
    check(input && typeof input === "object" && !Array.isArray(input), "보고서 객체가 필요합니다.");
    check(Object.keys(input).every((k) => ["date", "checkedAt", "report"].includes(k)), "알 수 없는 입력 필드입니다.");
    const today = seoulClock(now).date;
    check(input.date === today, "한국시간 오늘 날짜의 보고서만 발행할 수 있습니다.");
    const checked = Date.parse(input.checkedAt);
    check(typeof input.checkedAt === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.checkedAt) && Number.isFinite(checked) && checked <= now.getTime() + 60000 && seoulClock(new Date(checked)).date === today, "오늘 실제 확인한 시각(시간대 포함)이 필요합니다.");
    return { ...validateReport(input.report, today), date: today, checkedAt: new Date(checked).toISOString(), generatedAt: now.toISOString(), provider: "dots", fallbackReason: null };
  }
  publish(input, from, now = new Date()) {
    const report = this.validateSubmission(input, now);
    const existing = this.edition(report.date);
    if (existing) {
      check(existing.content_hash === contentHash(report), "오늘 다른 내용의 보고서가 이미 발행되었습니다.", 409);
      return { date: report.date, duplicate: true };
    }
    check(this.startRun(report.date, true), "오늘 조사가 진행 중이거나 발행 기록이 있습니다.", 409);
    try { this.saveReport(report, from); }
    catch (error) { this.failRun(report.date, "보고서 저장 실패. 다시 시도해 주세요."); throw error; }
    return { date: report.date, duplicate: false };
  }
  edition(date) { return this.db.prepare("SELECT * FROM editions WHERE date=?").get(date); }
  editions() { return this.db.prepare("SELECT date,summary FROM editions ORDER BY date DESC LIMIT 90").all(); }
  deliveries() { return this.db.prepare("SELECT d.date,d.status,m.name FROM deliveries d JOIN members m ON m.id=d.member_id ORDER BY d.date DESC,d.rowid DESC LIMIT 100").all(); }
  canNotify(id) { const m = this.member(id); return m?.status === "approved" && m.dm_opt_in === 1; }
  claimDelivery(date) {
    return this.transaction(() => {
      this.db.prepare("UPDATE deliveries SET status='cancelled' WHERE status='pending' AND (date<>? OR member_id NOT IN (SELECT id FROM members WHERE status='approved' AND dm_opt_in=1))").run(date);
      const row = this.db.prepare("SELECT * FROM deliveries WHERE date=? AND status='pending' AND retry_at<=? ORDER BY rowid LIMIT 1").get(date, Date.now());
      if (!row) return null;
      this.db.prepare("UPDATE deliveries SET status='sending',updated_at=? WHERE date=? AND member_id=?").run(new Date().toISOString(), row.date, row.member_id);
      return row;
    });
  }
  finishDelivery(row, state, reference = null, retryAt = 0) {
    this.db.prepare("UPDATE deliveries SET status=?,reference=?,retry_at=?,updated_at=? WHERE date=? AND member_id=? AND status='sending'").run(state, reference, retryAt, new Date().toISOString(), row.date, row.member_id);
  }
}
