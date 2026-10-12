import { check } from "../schema.mjs";

export const REPORT_RETENTION_DAYS = 7;
export function retentionCutoff(today) {
  const date = new Date(`${today}T00:00:00Z`);
  check(/^\d{4}-\d{2}-\d{2}$/.test(today) && Number.isFinite(+date) && date.toISOString().slice(0, 10) === today, "Invalid retention date.");
  date.setUTCDate(date.getUTCDate() - (REPORT_RETENTION_DAYS - 1));
  return date.toISOString().slice(0, 10);
}
export const retainedReports = (reports, today) => reports.filter(report => report.date >= retentionCutoff(today));
export function requireRetainedDate(date, today) {
  check(date >= retentionCutoff(today), "보고서는 오늘을 포함한 최근 7일 날짜로만 등록할 수 있습니다.", 400);
}
function oldHtmlPath(path, namespace, cutoff) {
  const match = new RegExp(`^${namespace}/html/(\\d{4}-\\d{2}-\\d{2})/[a-f0-9]{64}\\.html$`).exec(path);
  check(match && match[1] < cutoff, "보관 기간 삭제 대상 경로를 확인해야 합니다.", 503);
  return path;
}

// Commit removal from the index BEFORE deleting HTML. A persistent deletion
// queue survives interrupted calls; immutable paths and age checks make retries
// and concurrent cleanup safe. Opportunities, member progress and notes survive.
export async function pruneReports(store, today) {
  const cutoff = retentionCutoff(today), snapshot = await store.read();
  const expired = snapshot.reports.some(report => report.date < cutoff);
  const staleDeliveries = Object.values(snapshot.deliveries).some(row => row.date < cutoff);
  if (!expired && !staleDeliveries && !Object.keys(snapshot.retentionDeletes || {}).length) return { cutoff, removedReports: 0, deletedHtml: 0, pendingDeletes: 0 };
  const plan = await store.update(state => {
    const old = state.reports.filter(report => report.date < cutoff);
    state.retentionDeletes ||= {};
    for (const report of old) for (const version of [report, ...(report.previousVersions || [])]) {
      state.retentionDeletes[oldHtmlPath(version.path, store.namespace, cutoff)] = true;
    }
    state.reports = state.reports.filter(report => report.date >= cutoff);
    for (const [key, row] of Object.entries(state.deliveries)) if (row.date < cutoff) delete state.deliveries[key];
    if (old.length) state.workflowVersion++;
    return { removedReports: old.length, paths: Object.keys(state.retentionDeletes).slice(0, 200) };
  });
  const removed = [];
  for (const path of plan.paths) {
    oldHtmlPath(path, store.namespace, cutoff);
    try { await store.files.remove(path); removed.push(path); }
    catch { /* Keep the key queued for the next run; do not log private paths or provider errors. */ }
  }
  const pendingDeletes = await store.update(state => {
    for (const path of removed) delete state.retentionDeletes[path];
    return Object.keys(state.retentionDeletes).length;
  });
  return { cutoff, removedReports: plan.removedReports, deletedHtml: removed.length, pendingDeletes };
}
