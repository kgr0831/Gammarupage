import { get, put, BlobPreconditionFailedError } from "@vercel/blob";
import { randomUUID } from "node:crypto";
import { check, digest } from "../schema.mjs";
import { manifestFromHtml, registerOpportunities, changeProgress, validateManifest } from "./opportunities.mjs";
import { changeMemberProgress } from "./member-progress.mjs";
import { reportRevision, deliveryKey } from "./report-versions.mjs";

const empty = () => ({ version: 1, reports: [], members: {}, sessions: {}, oauth: {}, attempts: {}, deliveries: {} });
function queueChannel(state, date, channelId) {
  check(/^\d{17,20}$/.test(channelId), "보고서 채널 설정을 확인해 주세요.", 503);
  const report = state.reports.find((r) => r.date === date);
  check(report, "오늘 등록된 보고서가 없습니다.", 404);
  // One notification per edition and target, including retries after publication.
  const key = deliveryKey(report, `channel:${channelId}`);
  state.deliveries[key] ||= { date, revision: reportRevision(report), channelId, status: "pending", retryAt: 0, claimedAt: null };
  return state.deliveries[key];
}
export class PrivateBlobFiles {
  constructor(token) { this.token = token; }
  async read(path) {
    check(this.token, "Vercel의 비공개 파일 저장소 연결이 필요합니다.", 503);
    // Compressed delivery can weaken the ETag. CAS needs the original object's
    // strong ETag from the same response as the bytes being edited.
    const result = await get(path, { access: "private", token: this.token, useCache: false, headers: { "accept-encoding": "identity" }, abortSignal: AbortSignal.timeout(15000) });
    if (!result) return null;
    check(result.statusCode === 200 && result.stream, "파일을 읽지 못했습니다.", 502);
    return { text: await new Response(result.stream).text(), etag: result.blob.etag };
  }
  async write(path, text, etag = null) {
    check(this.token, "Vercel의 비공개 파일 저장소 연결이 필요합니다.", 503);
    try {
      return await put(path, text, {
        token: this.token, access: "private", addRandomSuffix: false,
        allowOverwrite: etag !== null, ...(etag !== null ? { ifMatch: etag } : {}),
        contentType: path.endsWith(".html") ? "text/html; charset=utf-8" : "application/json",
        abortSignal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      // First-writer races also fail atomically when allowOverwrite is false.
      if (error instanceof BlobPreconditionFailedError || /already exists/i.test(error.message || "")) throw Object.assign(new Error("Storage conflict"), { conflict: true });
      throw error;
    }
  }
}

export class BriefStore {
  constructor(files, namespace = "gammaru/briefs") {
    if (!["gammaru/briefs", "personal/briefs"].includes(namespace)) throw new Error("Invalid report namespace");
    this.files = files;
    this.namespace = namespace;
    this.index = `${namespace}/index-v1.json`;
  }
  async snapshot() {
    const saved = await this.files.read(this.index);
    const state = saved ? JSON.parse(saved.text) : empty();
    check(state.version === 1 && Array.isArray(state.reports), "저장소 형식을 확인해 주세요.", 503);
    state.opportunities ??= {};
    state.workflowVersion ??= 0;
    return { state, etag: saved?.etag ?? null };
  }
  async read() { return (await this.snapshot()).state; }
  async update(change) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const { state, etag } = await this.snapshot();
      const now = Date.now();
      for (const table of [state.sessions, state.oauth, state.attempts]) for (const [key, row] of Object.entries(table)) if (row.expires < now) delete table[key];
      const result = change(state); // Pure synchronous changes: no network effects inside retries.
      try { await this.files.write(this.index, JSON.stringify(state), etag); return result; }
      catch (error) { if (!error.conflict) throw error; }
    }
    check(false, "다른 변경이 처리 중입니다. 잠시 후 다시 시도해 주세요.", 409);
  }
  async stage(input, owner, today) {
    check(/^\d{4}-\d{2}-\d{2}$/.test(input.date) && Number.isFinite(Date.parse(input.date)) && new Date(input.date).toISOString().slice(0, 10) === input.date && input.date <= today, "유효한 발행일을 입력해 주세요. 미래 날짜는 사용할 수 없습니다.");
    check(typeof input.title === "string" && input.title.trim().length > 0 && input.title.length <= 150, "제목은 1~150자로 입력해 주세요.");
    check(typeof input.summary === "string" && input.summary.length <= 500, "요약은 500자까지 입력할 수 있습니다.");
    check(typeof input.html === "string" && Buffer.byteLength(input.html) <= 2 * 1024 * 1024 && /<html[\s>]/i.test(input.html) && /<body[\s>]/i.test(input.html), "UTF-8 형식의 완성된 HTML 파일(최대 2MB)이 필요합니다.");
    const id = randomUUID();
    const manifest = manifestFromHtml(input.html);
    let baseRevision = 0;
    if (input.reissue === true) {
      check(typeof input.changeReason === "string" && input.changeReason.trim().length > 0 && input.changeReason.length <= 300, "재발행 사유를 1~300자로 입력해 주세요.");
      check(manifest, "수정본에는 최신 stateVersion을 담은 진행 항목 JSON이 필요합니다.");
      const existing = (await this.read()).reports.find((r) => r.date === input.date);
      check(existing, "아직 발행된 보고서가 없습니다. 재발행 선택을 해제하고 새 보고서로 등록해 주세요.", 409);
      baseRevision = reportRevision(existing);
    }
    const draft = { ...input, reissue: input.reissue === true, baseRevision, changeReason: input.reissue === true ? input.changeReason.trim() : "", title: input.title.trim(), manifest, id, owner, hash: digest(input.html), expires: Date.now() + 1800000 };
    await this.files.write(`${this.namespace}/drafts/${id}.json`, JSON.stringify(draft));
    return draft;
  }
  async draft(id, owner) {
    check(/^[a-f0-9-]{36}$/.test(id || ""), "미리보기를 찾을 수 없습니다.", 404);
    const saved = await this.files.read(`${this.namespace}/drafts/${id}.json`);
    check(saved, "미리보기를 찾을 수 없습니다.", 404);
    const draft = JSON.parse(saved.text);
    check(draft.owner === owner && draft.expires > Date.now(), "이 로그인에서 만든 미리보기가 아니거나 만료되었습니다.", 403);
    return draft;
  }
  async publish(draft, today, channelId = "", personalOwnerId = "", personalAccountMode = false, { allowPersonalChannel = false } = {}) {
    const personal = personalAccountMode || !!personalOwnerId;
    const manifest = manifestFromHtml(draft.html);
    check(!personal || manifest?.audience === "personal", "최신 개인 보고서 지침에 맞게 audience: personal과 분야 정보를 넣어 다시 미리보기해 주세요.", 409);
    check(personal || manifest?.audience !== "personal", "개인 보고서는 별도 개인 사이트에서 업로드해 주세요.", 409);
    if (personal && !allowPersonalChannel) channelId = "";
    if (channelId) check(/^\d{17,20}$/.test(channelId), "보고서 채널 설정을 확인해 주세요.", 503);
    const htmlPath = `${this.namespace}/html/${draft.date}/${draft.hash}.html`;
    // Immutable content first; only a committed index entry makes it visible or queues notifications.
    try { await this.files.write(htmlPath, draft.html); }
    catch (error) { if (!error.conflict) throw error; }
    return this.update((state) => {
      const existing = state.reports.find((r) => r.date === draft.date);
      if (existing) {
        if (existing.hash === draft.hash && existing.title === draft.title && existing.summary === draft.summary) return { report: existing, duplicate: true };
        check(draft.reissue === true, "해당 날짜에 다른 보고서가 이미 있습니다. 수정하려면 ‘수정본으로 재발행’을 선택하고 사유를 입력해 주세요.", 409);
        check(draft.baseRevision === reportRevision(existing), "미리보기 이후 다른 수정본이 발행되었습니다. 최신 조사 자료를 읽고 다시 미리보기 해 주세요.", 409);
        check(manifest && draft.changeReason, "최신 진행 항목과 재발행 사유가 필요합니다.", 409);
      } else {
        check(!draft.reissue, "재발행할 기존 보고서를 찾을 수 없습니다.", 409);
      }
      const recipient = personalAccountMode ? state.personalAccount?.discordId || "" : personalOwnerId;
      const at = new Date().toISOString();
      const report = { date: draft.date, title: draft.title, summary: draft.summary, hash: draft.hash, path: htmlPath, createdAt: existing?.createdAt || at, revision: existing ? reportRevision(existing) + 1 : 1, ...(personal ? { audience: "personal" } : {}) };
      if (existing) {
        const { previousVersions = [], ...prior } = existing;
        report.previousVersions = [...previousVersions, prior];
        report.updatedAt = at;
        report.changeReason = draft.changeReason;
      }
      registerOpportunities(state, report, manifest);
      if (existing) {
        state.reports[state.reports.indexOf(existing)] = report;
        for (const row of Object.values(state.deliveries)) if (row.date === draft.date && row.status === "pending") row.status = "cancelled";
      } else state.reports.push(report);
      if (draft.date === today && draft.notify) {
        if (channelId) queueChannel(state, draft.date, channelId);
        else for (const member of Object.values(state.members)) {
          if (member.status === "approved" && member.dm_opt_in && (!personal || member.id === recipient)) state.deliveries[deliveryKey(report, member.id)] = { date: draft.date, revision: reportRevision(report), memberId: member.id, status: "pending", retryAt: 0, claimedAt: null };
        }
      }
      return { report, duplicate: false };
    });
  }
  async queueChannelReport(today, channelId) {
    return this.update((state) => queueChannel(state, today, channelId));
  }
  async setProgress(id, input, actor, memberId = null, options = {}) {
    return this.update((state) => {
      check(!memberId || state.members[memberId]?.status === "approved", "구독 승인이 변경되어 진행 기록을 저장할 수 없습니다.", 403);
      return changeProgress(state, id, input, actor, options);
    });
  }
  async setMemberProgress(memberId, id, input) {
    return this.update(state => changeMemberProgress(state, memberId, id, input));
  }
  async attachOpportunities(date, input) {
    const manifest = validateManifest(input);
    return this.update((state) => {
      const report = state.reports.find((entry) => entry.date === date);
      check(report, "보고서를 찾을 수 없습니다.", 404);
      check(!report.opportunities, "이미 진행 항목이 연결된 보고서입니다.", 409);
      registerOpportunities(state, report, manifest);
    });
  }
  async html(report) {
    check(report.path.startsWith(`${this.namespace}/html/`) && !report.path.includes(".."), "다른 서비스의 보고서는 읽을 수 없습니다.", 403);
    const saved = await this.files.read(report.path);
    check(saved && digest(saved.text) === report.hash, "보고서 파일을 확인하지 못했습니다.", 502);
    return saved.text;
  }
}
