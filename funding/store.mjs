import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { digest, check, validateAction } from "./schema.mjs";

export class Store {
  constructor(directory) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path.join(directory, "funding.sqlite"));
    this.db.exec(`
      PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS runs (date TEXT PRIMARY KEY, status TEXT NOT NULL, started TEXT NOT NULL, finished TEXT, error TEXT);
      CREATE TABLE IF NOT EXISTS reports (date TEXT PRIMARY KEY, body TEXT NOT NULL, notification TEXT NOT NULL DEFAULT 'pending');
      CREATE TABLE IF NOT EXISTS actions (id TEXT PRIMARY KEY, fingerprint TEXT UNIQUE NOT NULL, report_date TEXT NOT NULL, deadline TEXT, payload TEXT NOT NULL, hash TEXT NOT NULL, status TEXT NOT NULL, approved_hash TEXT, approved_at TEXT, result TEXT);
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, at TEXT NOT NULL, action_id TEXT, event TEXT NOT NULL);
    `);
  }
  close() { this.db.close(); }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  log(id, event) { this.db.prepare("INSERT INTO audit(at, action_id, event) VALUES (?, ?, ?)").run(new Date().toISOString(), id, event); }
  recover() {
    // A crash during an external send has an unknown outcome. Never resend automatically.
    this.db.exec("UPDATE runs SET status='failed', error='서버가 재시작되어 검색이 중단되었습니다.' WHERE status='running'; UPDATE actions SET status='uncertain' WHERE status='executing'; UPDATE reports SET notification='failed_or_uncertain' WHERE notification='pending'");
  }
  startRun(date, retry = false) {
    return this.transaction(() => {
      const previous = this.db.prepare("SELECT * FROM runs WHERE date=?").get(date);
      if (previous && !(retry && previous.status === "failed")) return false;
      this.db.prepare("INSERT INTO runs(date,status,started) VALUES (?,'running',?) ON CONFLICT(date) DO UPDATE SET status='running',started=excluded.started,finished=NULL,error=NULL").run(date, new Date().toISOString());
      return true;
    });
  }
  failRun(date, message) { this.db.prepare("UPDATE runs SET status='failed', finished=?, error=? WHERE date=?").run(new Date().toISOString(), message, date); }
  saveReport(report, from, onSaved = () => {}) {
    return this.transaction(() => {
      for (const opportunity of report.opportunities) {
        for (const action of opportunity.actions) {
          const payload = { ...action, from: action.kind === "send_email" ? from : "", opportunityTitle: opportunity.title, sources: opportunity.sources };
          this.db.prepare("INSERT OR IGNORE INTO actions(id,fingerprint,report_date,deadline,payload,hash,status) VALUES (?,?,?,?,?,?,'pending')").run(randomUUID(), digest([opportunity.key, action.kind]), report.date, opportunity.deadline, JSON.stringify(payload), digest(payload));
        }
      }
      this.db.prepare("INSERT INTO reports(date,body) VALUES (?,?)").run(report.date, JSON.stringify(report));
      this.db.prepare("UPDATE runs SET status='completed',finished=? WHERE date=?").run(new Date().toISOString(), report.date);
      onSaved(report);
    });
  }
  state() {
    return {
      reports: this.db.prepare("SELECT body,notification FROM reports ORDER BY date DESC LIMIT 90").all().map((r) => ({ ...JSON.parse(r.body), notification: r.notification })),
      runs: this.db.prepare("SELECT * FROM runs ORDER BY date DESC LIMIT 30").all(),
      actions: this.db.prepare("SELECT * FROM actions ORDER BY rowid DESC").all().map((a) => this.decode(a)),
      audit: this.db.prepare("SELECT * FROM audit ORDER BY id DESC LIMIT 100").all(),
    };
  }
  decode(row) { return row ? { ...row, payload: JSON.parse(row.payload), result: row.result ? JSON.parse(row.result) : null } : null; }
  action(id) {
    const row = this.decode(this.db.prepare("SELECT * FROM actions WHERE id=?").get(id));
    check(row, "작업을 찾을 수 없습니다.", 404);
    return row;
  }
  edit(id, hash, changes, emailFrom) {
    return this.transaction(() => {
      const action = this.action(id);
      check(["pending", "approved"].includes(action.status), "진행한 작업은 수정할 수 없습니다.", 409);
      check(action.hash === hash, "다른 곳에서 수정되었습니다. 새로고침해 주세요.", 409);
      const payload = { ...action.payload, recipient: changes.recipient, subject: changes.subject, body: changes.body };
      if (payload.kind === "send_email" && emailFrom !== undefined) payload.from = emailFrom;
      validateAction(payload);
      this.db.prepare("UPDATE actions SET payload=?,hash=?,status='pending',approved_hash=NULL,approved_at=NULL WHERE id=?").run(JSON.stringify(payload), digest(payload), id);
      this.log(id, "edited; approval cleared");
      return this.action(id);
    });
  }
  approve(id, hash, today) {
    return this.transaction(() => {
      const action = this.action(id);
      check(action.status === "pending", "승인 대기 중인 작업만 승인할 수 있습니다.", 409);
      check(action.hash === hash, "수정된 내용으로 다시 검토해 주세요.", 409);
      check(!action.deadline || action.deadline >= today, "마감된 작업입니다.", 409);
      this.db.prepare("UPDATE actions SET status='approved',approved_hash=hash,approved_at=? WHERE id=?").run(new Date().toISOString(), id);
      this.log(id, "approved by operator");
    });
  }
  claim(id, today) {
    return this.transaction(() => {
      const action = this.action(id);
      check(action.status === "approved" && action.hash === action.approved_hash, "현재 내용에 대한 승인이 필요합니다.", 409);
      check(Date.now() - Date.parse(action.approved_at) < 24 * 60 * 60 * 1000, "승인이 만료되었습니다. 초안을 저장하고 다시 승인해 주세요.", 409);
      check(!action.deadline || action.deadline >= today, "마감된 작업입니다.", 409);
      this.db.prepare("UPDATE actions SET status='executing' WHERE id=?").run(id);
      this.log(id, "execution started");
      return action;
    });
  }
  finish(id, status, result) {
    this.transaction(() => {
      this.db.prepare("UPDATE actions SET status=?,result=? WHERE id=? AND status='executing'").run(status, JSON.stringify(result), id);
      this.log(id, status);
    });
  }
  reject(id) {
    const result = this.db.prepare("UPDATE actions SET status='rejected',approved_hash=NULL WHERE id=? AND status IN ('pending','approved')").run(id);
    check(result.changes === 1, "거절할 수 없는 상태입니다.", 409);
    this.log(id, "rejected by operator");
  }
  resolve(id, outcome) {
    check(["completed", "rejected"].includes(outcome), "Invalid outcome");
    const result = this.db.prepare("UPDATE actions SET status=? WHERE id=? AND status='uncertain'").run(outcome, id);
    check(result.changes === 1, "확인이 필요한 작업만 처리할 수 있습니다.", 409);
    this.log(id, `operator checked provider: ${outcome}`);
  }
  notification(date, status) { this.db.prepare("UPDATE reports SET notification=? WHERE date=?").run(status, date); }
}
