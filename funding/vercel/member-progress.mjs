import { check } from "../schema.mjs";
import { changeProgress } from "./opportunities.mjs";

// Only report facts are shared. Never copy the owner's notes or history into a
// reader's record, including when that reader has not saved anything yet.
function readerItem(item, saved) {
  const { id, category, title, sourceUrl, benefit, eligibility, deadline, nextAction, changeNote, firstReported, lastReported } = item;
  return {
    id, category, title, sourceUrl, benefit, eligibility, deadline, nextAction, changeNote, firstReported, lastReported,
    status: saved?.status || "new", note: saved?.note || "", revision: saved?.revision || 0,
    updatedAt: saved?.updatedAt || null, history: saved?.history || [],
  };
}

export function memberOpportunities(state, memberId) {
  const saved = state.memberProgress?.[memberId] || {};
  return Object.fromEntries(Object.values(state.opportunities).map(item => [item.id, readerItem(item, saved[item.id])]));
}

export function changeMemberProgress(state, memberId, id, input) {
  check(/^\d{17,20}$/.test(memberId) && state.members[memberId]?.status === "approved", "Discord로 다시 로그인해 주세요.", 403);
  check(Object.hasOwn(state.opportunities, id), "진행 항목을 찾을 수 없습니다.", 404);
  const item = readerItem(state.opportunities[id], state.memberProgress?.[memberId]?.[id]);
  const scoped = { opportunities: { [id]: item }, workflowVersion: 0 };
  changeProgress(scoped, id, input, memberId, { allowStaleStatus: true });
  if (!scoped.workflowVersion) return;
  state.memberProgress ??= {};
  state.memberProgress[memberId] ??= {};
  const { status, note, revision, updatedAt, history } = item;
  state.memberProgress[memberId][id] = { status, note, revision, updatedAt, history };
  // Reader changes must not alter the owner's next research run or stateVersion.
}
