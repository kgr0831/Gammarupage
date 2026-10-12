import { check, digest } from "../schema.mjs";
import { briefConfig, personalConfig } from "./config.mjs";
import { PrivateBlobFiles } from "./storage.mjs";
import { S3Files } from "./s3-files.mjs";
import { maintenanceAuthorized } from "./maintenance.mjs";

// Copy server-to-server in memory. Never serialize credentials, sessions or
// private state into console output or local export files. Publish index last.
export async function migrateNamespace(source, destination, namespace) {
  check(["gammaru/briefs", "personal/briefs"].includes(namespace), "Invalid migration namespace.");
  const index = `${namespace}/index-v1.json`, initial = await source.read(index);
  check(initial, "기존 진행 기록을 읽지 못했습니다. 빈 저장소로 전환하지 않습니다.", 503);
  const state = JSON.parse(initial.text);
  check(state.version === 1 && Array.isArray(state.reports) && state.members && state.sessions, "기존 저장소 검증에 실패했습니다.", 503);
  const rows = await source.list(`${namespace}/`), keys = new Set(rows.map(row => row.pathname));
  for (const report of state.reports) for (const version of [report, ...(report.previousVersions || [])]) check(keys.has(version.path), "기존 보고서 파일이 누락되었습니다.", 503);
  let copied = 0, verified = 0;
  async function copy(path, saved) {
    check(path.startsWith(`${namespace}/`) && !path.split("/").some(part => ["", ".", ".."].includes(part)), "Invalid migration key.");
    check(saved, "이전 중 원본 파일이 사라졌습니다.", 409);
    try { await destination.write(path, saved.text); copied++; }
    catch (error) { if (!error.conflict) throw error; }
    const received = await destination.read(path);
    check(received && digest(received.text) === digest(saved.text), "대상 데이터가 다릅니다. 기존 대상을 덮어쓰지 않았습니다.", 409);
    verified++;
  }
  for (const key of keys) if (key !== index) {
    const saved = await source.read(key);
    const version = state.reports.flatMap(report => [report, ...(report.previousVersions || [])]).find(report => report.path === key);
    if (version) check(saved && digest(saved.text) === version.hash, "원본 HTML 무결성 검증에 실패했습니다.", 503);
    await copy(key, saved);
  }
  const latest = await source.read(index);
  check(latest && latest.etag === initial.etag && latest.text === initial.text, "이전 중 원본 상태가 변경되었습니다. 발행·알림·상태 변경을 멈추고 다시 검증해 주세요.", 409);
  await copy(index, initial);
  return { copied, verified, reports: state.reports.length, stateVersion: state.workflowVersion || 0 };
}

export async function handleMigration(request, { env = process.env } = {}) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!maintenanceAuthorized(request, env)) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers });
  if ((env.REPORTS_STORAGE_BACKEND || "blob") !== "blob") return Response.json({ error: "Migration disabled after cutover" }, { status: 409, headers });
  const results = [];
  try {
    for (const [namespace, configure] of [["gammaru/briefs", briefConfig], ["personal/briefs", personalConfig]]) {
      const config = configure(request, env);
      results.push({ namespace, ...await migrateNamespace(new PrivateBlobFiles(config.blobToken), new S3Files(config.s3), namespace) });
    }
    return Response.json({ verified: true, backendSwitched: false, results }, { headers });
  } catch {
    return Response.json({ verified: false, backendSwitched: false, error: "Migration incomplete; source preserved, do not switch backend", results }, { status: 503, headers });
  }
}
