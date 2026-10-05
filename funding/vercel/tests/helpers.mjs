import { randomBytes } from "node:crypto";
import { BriefStore } from "../storage.mjs";
import { createBriefHandler } from "../handler.mjs";
import { digest } from "../../schema.mjs";
import { seoulClock } from "../../clock.mjs";

export const today = seoulClock().date;
export const sampleHtml = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>검증용 보고서</title><style>body{background:#080918;color:#f4f0e8;font:18px sans-serif;padding:30px}h1{color:#ef62bd}</style></head><body><h1>가상 보고서 · 실제 공고 아님</h1><p>겜마루의 외부 후원과 운영자금 정보</p><a href="https://example.org" target="_blank">공식 원문 예시</a></body></html>';
export class MemoryFiles {
  constructor() { this.rows = new Map(); this.sequence = 0; }
  async read(key) { return this.rows.get(key) ? { ...this.rows.get(key) } : null; }
  async write(key, text, etag = null) {
    const old = this.rows.get(key);
    if ((etag === null && old) || (etag !== null && old?.etag !== etag)) throw Object.assign(new Error("conflict"), { conflict: true });
    const row = { text, etag: String(++this.sequence) }; this.rows.set(key, row); return row;
  }
}
export function setup(overrides = {}, dependencies = {}) {
  const files = new MemoryFiles(), store = new BriefStore(files), work = [];
  const config = { origin: "http://127.0.0.1:4319", configured: true, secure: false, token: randomBytes(32).toString("hex"), adminUsername: "admin", publisherToken: randomBytes(32).toString("hex"), discordApplicationId: "100000000000000099", discordClientSecret: "test-only-secret", discordBotToken: "test-only-bot", dmEnabled: false, ...overrides };
  const handler = createBriefHandler({ config, store, after: (task) => work.push(task), ...dependencies });
  const request = (pathname, cookie = "", input, origin = config.origin) => {
    const headers = { cookie, ...(input === undefined ? {} : { origin }) };
    const body = input instanceof FormData ? input : input === undefined ? undefined : new URLSearchParams(input);
    return handler(new Request(`${config.origin}${pathname}`, { method: body ? "POST" : "GET", headers, body }));
  };
  const session = async (role, subject = role) => {
    const token = randomBytes(32).toString("hex");
    await store.update((s) => { s.sessions[digest(token)] = { role, subject, expires: Date.now() + 3600000, proof: role === "admin" ? digest([config.adminUsername, config.token]) : role === "publisher" ? digest(config.publisherToken) : "discord" }; });
    return `briefs=${token}`;
  };
  const member = async (id = "100000000000000001", status = "approved", dm = true) => {
    await store.update((s) => { s.members[id] = { id, username: "test-member", display_name: "검증 회원", name: "검증 회원", avatar: null, status, dm_opt_in: dm }; });
    return id;
  };
  const stage = async (owner = "test-owner", date = today, html = sampleHtml) => store.stage({ date, title: `${date} 검증용 보고서`, summary: "실제 지원 공고가 아닌 테스트 자료입니다.", html, notify: true }, owner, today);
  return { files, store, config, handler, work, request, session, member, stage };
}
