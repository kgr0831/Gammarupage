import { randomBytes } from "node:crypto";
import { check, digest } from "../schema.mjs";
import { seoulClock } from "../clock.mjs";
import { formatBriefMessage, formatMemberNotice } from "./notify.mjs";
import { reportChannel, allowedMember, reportRecipient, isPersonal } from "./access.mjs";
import { currentDeliveryReport } from "./report-versions.mjs";

const leaseMs = 5 * 60 * 1000;
const fields = ["login_notice", "approval_notice"];
const expiresAt = (row) => row.workerExpiresAt ?? (row.claimedAt ?? row.createdAt ?? 0) + leaseMs;
export const workerMode = (config) => config.discordDeliveryMode === "worker";
export const notificationTransportReady = (config) => workerMode(config) ? (config.discordWorkerToken || "").length >= 32 : !!config.discordBotToken;

function* rows(state) {
  for (const [key, row] of Object.entries(state.deliveries)) yield { id: `report/${key}`, row };
  for (const member of Object.values(state.members)) for (const field of fields) {
    const row = member[field];
    if (row) yield { id: `${field}/${member.id}/${row.id}`, row, member, field };
  }
}
function eligible(entry, state, config, now) {
  const { row, member, field } = entry;
  if (member) return allowedMember(member, config, state) && (field !== "approval_notice" || member.status === "approved") && row.createdAt > now - 86400000;
  const report = currentDeliveryReport(state, row);
  if (row.date !== seoulClock(new Date(now)).date || !report) return false;
  if (isPersonal(config) && report.audience !== "personal") return false;
  const channelId = reportChannel(config);
  return channelId ? row.channelId === channelId : !row.channelId && config.dmEnabled && reportRecipient(state.members[row.memberId], config, state);
}
function cleanLease(row) {
  for (const key of ["workerLeaseHash", "workerPhase", "workerExpiresAt"]) delete row[key];
}
function findClaim(state, input) {
  check(typeof input.id === "string" && input.id.length <= 200 && /^[a-f0-9]{64}$/.test(input.lease || ""), "Invalid job claim.", 400);
  const entry = [...rows(state)].find((entry) => entry.id === input.id);
  check(entry?.row.status === "sending" && entry.row.workerLeaseHash === digest(input.lease), "Job is no longer claimed.", 409);
  return entry;
}
export async function claimWorkerJob(store, config, now = Date.now()) {
  const snapshot = await store.read();
  if (snapshot.workerRetryAt > now || ![...rows(snapshot)].some(({ row }) => (row.status === "pending" && !(row.retryAt > now)) || (row.status === "sending" && expiresAt(row) <= now))) return null;
  const lease = randomBytes(32).toString("hex");
  return store.update((state) => {
    for (const entry of rows(state)) {
      const { row } = entry;
      if (row.status === "sending" && expiresAt(row) <= now) {
        // A claim that never reached begin can be safely retried. Once begin is
        // committed, a lost response may mean Discord already sent the message.
        row.status = row.workerPhase === "claimed" ? "pending" : "uncertain";
        cleanLease(row);
      }
      if (row.status === "pending" && !eligible(entry, state, config, now)) row.status = "cancelled";
    }
    if (state.workerRetryAt > now) return null;
    const entry = [...rows(state)].find(({ row }) => row.status === "pending" && !(row.retryAt > now));
    if (!entry) return null;
    const { row, member, field } = entry;
    Object.assign(row, { status: "sending", claimedAt: now, workerExpiresAt: now + leaseMs, workerLeaseHash: digest(lease), workerPhase: "claimed" });
    const report = member ? null : state.reports.find((report) => report.date === row.date);
    return {
      id: entry.id, lease, expiresAt: row.workerExpiresAt,
      target: row.channelId ? { channelId: row.channelId } : { memberId: member?.id || row.memberId },
      message: {
        content: member ? formatMemberNotice(field, config.origin, isPersonal(config), config.basePath) : formatBriefMessage(report, config.origin, config.basePath),
        flags: 4, allowed_mentions: { parse: [] }, enforce_nonce: true,
        nonce: digest(member ? row.id : entry.id.slice("report/".length)).slice(0, 25),
      },
    };
  });
}
export async function beginWorkerJob(store, config, input, now = Date.now()) {
  return store.update((state) => {
    const entry = findClaim(state, input), { row } = entry;
    check(row.workerPhase === "claimed" && row.workerExpiresAt > now, "Job claim expired or already started.", 409);
    if (!eligible(entry, state, config, now)) { row.status = "cancelled"; cleanLease(row); return false; }
    row.workerPhase = "sending";
    return true;
  });
}
export async function finishWorkerJob(store, input, now = Date.now()) {
  return store.update((state) => {
    const { row } = findClaim(state, input);
    check(["sent", "blocked", "failed", "uncertain", "rate_limited"].includes(input.status), "Invalid outcome.");
    check(input.status !== "sent" || (row.workerPhase === "sending" && /^\d{17,20}$/.test(input.reference || "")), "Message confirmation is required.");
    check(input.status !== "uncertain" || row.workerPhase === "sending", "Message was not started.");
    if (input.status === "rate_limited") {
      check(Number.isFinite(input.retryAfter) && input.retryAfter >= 0, "Invalid retry interval.");
      row.status = "pending";
      row.retryAt = now + Math.min(86400, Math.max(1, input.retryAfter)) * 1000 + 1000;
      state.workerRetryAt = Math.max(state.workerRetryAt || 0, row.retryAt);
    } else {
      row.status = input.status;
      if (input.status === "sent") row.reference = input.reference;
    }
    if (Number.isInteger(input.httpStatus) && input.httpStatus >= 400 && input.httpStatus <= 599) row.httpStatus = input.httpStatus;
    if (Number.isSafeInteger(input.errorCode) && input.errorCode >= 0) row.errorCode = input.errorCode;
    cleanLease(row);
  });
}

async function inputJson(request) {
  check(request.headers.get("content-type")?.split(";")[0] === "application/json", "JSON required.", 415);
  const reader = request.body?.getReader(); check(reader, "JSON required.");
  const chunks = []; let bytes = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    bytes += value.byteLength;
    if (bytes > 2048) { await reader.cancel(); check(false, "Request too large.", 413); }
    chunks.push(value);
  }
  let input;
  try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { check(false, "Invalid JSON."); }
  check(input && typeof input === "object" && !Array.isArray(input), "JSON object required.");
  return input;
}
// Authentication is enforced by the report handler before this function runs.
export async function handleWorkerJob(request, store, config) {
  const operation = new URL(request.url).pathname.split("/").at(-1);
  const input = await inputJson(request);
  if (operation === "status") return { mode: workerMode(config) ? "worker" : "direct", ready: workerMode(config) && notificationTransportReady(config), site: config.origin };
  check(workerMode(config), "Enable worker delivery before starting the bot.", 409);
  if (operation === "claim") return { job: await claimWorkerJob(store, config) };
  if (operation === "begin") return { send: await beginWorkerJob(store, config, input) };
  if (operation === "finish") { await finishWorkerJob(store, input); return { ok: true }; }
  check(false, "Unknown worker operation.", 404);
}
