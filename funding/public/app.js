const $ = (selector) => document.querySelector(selector);
let state;
let selectedDate = new URLSearchParams(location.search).get("report");
let messageTimer;
const labels = { pending: "승인 대기", approved: "승인됨", executing: "실행 중", completed: "완료", rejected: "거절됨", uncertain: "결과 확인 필요", running: "탐색 중", failed: "실패" };
const kinds = { cash: "현금 지원", in_kind: "현물 지원", prize: "수상 시 지원", sponsorship: "후원", information: "유용한 정보" };

// Every model-controlled value is rendered as text. No model HTML is executed.
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
function message(text) {
  $("#message").textContent = text;
  $("#message").hidden = false;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => { $("#message").hidden = true; }, 10000);
}
async function api(path, method = "GET", data) {
  const response = await fetch(path, { method, headers: data ? { "content-type": "application/json" } : {}, body: data ? JSON.stringify(data) : undefined });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) showLogin();
    throw new Error(result.error || "요청에 실패했습니다.");
  }
  return result;
}
function showLogin() { $("#login").hidden = false; $("#dashboard").hidden = true; $("#logout").hidden = true; }
function tab(name) {
  for (const button of document.querySelectorAll("[data-tab]")) {
    const active = button.dataset.tab === name;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    $(`#${button.dataset.tab}-panel`).hidden = !active;
  }
}
function sourceList(sources) {
  return `<div class="sources">${sources.map((source) => `<div><a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.title)} ↗</a><p>${escape(source.evidence)}</p></div>`).join("")}</div>`;
}
function list(items, ordered = false) { const tag = ordered ? "ol" : "ul"; return `<${tag}>${items.map((item) => `<li>${escape(item)}</li>`).join("")}</${tag}>`; }
function reportView() {
  const report = state.reports.find((item) => item.date === selectedDate) || state.reports[0];
  selectedDate = report?.date;
  $("#report-date").textContent = selectedDate || "첫 리포트 대기";
  $("#report-select").innerHTML = state.reports.map((item) => `<option value="${escape(item.date)}" ${item.date === selectedDate ? "selected" : ""}>${escape(item.date)}</option>`).join("");
  $("#summary").textContent = report?.summary || "아직 리포트가 없습니다. 운영 기록에서 연결 상태를 확인하고 첫 탐색을 시작해 주세요.";
  const opportunities = report?.opportunities || [];
  const pending = state.actions.filter((a) => a.status === "pending").length;
  $("#pending-count").textContent = pending;
  const closing = opportunities.filter((o) => o.deadline && o.deadline >= state.settings.today && (Date.parse(o.deadline) - Date.parse(state.settings.today)) / 86400000 <= 7).length;
  const metrics = [["발견한 기회", opportunities.length, "건"], ["신청 가능성 높음", opportunities.filter((o) => o.eligibility === "likely").length, "건 · 검토 필요"], ["7일 내 마감", closing, "건"], ["승인을 기다리는 제안", pending, "건"]];
  $("#metrics").innerHTML = metrics.map(([title, value, unit]) => `<div class="metric"><p>${title}</p><strong>${value.toString().padStart(2, "0")}</strong><small>${unit}</small></div>`).join("");
  const notices = [...(report?.warnings || [])];
  if (report?.fallbackReason) notices.push(report.fallbackReason);
  if (selectedDate && selectedDate < state.settings.today) notices.push(`${selectedDate}에 조사한 리포트입니다. 현재 모집 상태는 원문에서 다시 확인해 주세요.`);
  $("#warnings").innerHTML = notices.map((notice) => `<p class="warning">${escape(notice)}</p>`).join("");
  $("#opportunities").innerHTML = opportunities.length ? opportunities.map((item, index) => {
    const eligible = { likely: "신청 가능성 높음", uncertain: "자격 확인 필요", ineligible: "신청 대상 아님" }[item.eligibility];
    return `<article class="card"><div class="card-top"><span class="index">OPPORTUNITY / ${String(index + 1).padStart(2, "0")}</span><span class="tag">${kinds[item.kind]}</span><span class="tag ${item.eligibility === "likely" ? "lime" : "pink"}">${eligible}</span></div><h3>${escape(item.title)}</h3><p class="organization">${escape(item.organization)}</p><div class="benefit"><span>지원 내용</span><strong>${escape(item.benefit)}</strong></div><p>${escape(item.fitReason)}</p><h4>겜마루 신청 조건</h4><p>${escape(item.eligibilityReason)}</p>${list(item.requirements)}<h4>추천하는 다음 행동</h4>${list(item.nextSteps, true)}${sourceList(item.sources)}<div class="card-footer"><span>마감 ${escape(item.deadline || "상시 / 원문 확인")}</span><button data-show-actions>실행 제안 보기 ↗</button></div></article>`;
  }).join("") : `<div class="empty">${report ? "이번 조사에서 현재 모집이 확인된 기회를 찾지 못했습니다. 검색 범위와 확인 사항을 검토해 주세요." : "첫 리포트가 도착하면 지원 기회와 추천 행동이 여기에 표시됩니다."}</div>`;
}
function actionsView() {
  $("#actions").innerHTML = state.actions.length ? state.actions.map((action) => {
    const { payload: p } = action;
    const editable = ["pending", "approved"].includes(action.status) && !state.settings.demo;
    const expired = action.deadline && action.deadline < state.settings.today;
    const mailUnavailable = p.kind === "send_email" && !state.settings.emailConfigured;
    return `<article class="card action-card" data-id="${action.id}"><div class="action-title"><div><p class="eyebrow">${p.kind === "send_email" ? "OUTREACH / EMAIL" : "PREPARATION / DOCUMENT"}</p><h3>${escape(p.title)}</h3></div><span class="tag ${action.status === "completed" ? "lime" : "pink"}">${labels[action.status]}</span></div><p class="muted">${escape(p.opportunityTitle)} · ${escape(action.report_date)} 제안${expired ? " · 마감됨" : ""}</p>${p.kind === "send_email" ? `<p class="muted">발신: ${escape(p.from || "메일 계정 설정 필요")}</p><label>받는 사람<input name="recipient" type="email" value="${escape(p.recipient)}" ${editable ? "" : "disabled"}></label><label>제목<input name="subject" maxlength="300" value="${escape(p.subject)}" ${editable ? "" : "disabled"}></label>` : ""}<label>최종 실행 내용<textarea name="body" maxlength="12000" ${editable ? "" : "disabled"}>${escape(p.body)}</textarea></label>${sourceList(p.sources)}${editable ? `<label class="confirmation"><input name="confirm" type="checkbox"><span>원문에서 신청 자격·마감 시각${p.kind === "send_email" ? "·담당자 주소" : ""}를 확인했고, 위 내용을 승인합니다.${p.kind === "send_email" ? " 승인하면 이 내용 그대로 외부에 메일이 발송됩니다." : " 승인하면 다운로드할 문서를 생성합니다."}</span></label><div class="action-buttons"><button class="secondary" data-action="save">수정 저장</button><button class="primary" data-action="approve" disabled ${expired || mailUnavailable ? 'title="마감 또는 메일 연결 상태를 확인하세요"' : ""}>${p.kind === "send_email" ? "승인하고 메일 발송" : "승인하고 문서 생성"} ↗</button><button class="quiet" data-action="reject">거절</button></div>${mailUnavailable ? '<p class="muted">운영 기록에서 메일 연결 상태를 확인해 주세요.</p>' : ""}` : ""}${action.result?.document ? `<a class="download" href="/api/actions/${action.id}/document">완성된 문서 다운로드 ↓</a>` : ""}${action.result?.reference ? `<p class="muted">발송 접수 번호: ${escape(action.result.reference)}</p>` : ""}${action.result?.message ? `<p class="warning">${escape(action.result.message)}</p>` : ""}${action.status === "uncertain" && !state.settings.demo ? '<p class="muted">메일 서비스에서 실제 결과를 확인한 후 선택하세요. 재발송하지 않습니다.</p><div class="action-buttons"><button class="secondary" data-action="resolve-sent">발송 기록 확인 · 완료</button><button class="secondary" data-action="resolve-cancel">미발송 확인 · 취소</button></div>' : ""}</article>`;
  }).join("") : '<div class="empty">아직 실행 제안이 없습니다. 조사된 기회에서 필요한 행동을 제안합니다.</div>';
}
function historyView() {
  const s = state.settings;
  const settings = [["매일 탐색", s.schedule ? `매일 ${s.hour}:00 · 한국시간` : "예약 실행 꺼짐"], ["1순위 · Codex", s.codexConfigured ? "경로 설정됨 · 실제 로그인 확인 필요" : "원격 서버 로그인 필요"], ["2순위 · 팩트챗", s.factchatConfigured ? "설정됨 · 실제 호출 확인 필요" : "API 연결 필요"], ["디스코드 알림", s.discordConfigured ? "연결 설정됨 · 리포트 링크 전송" : "웹훅 연결 필요"], ["승인 후 메일", s.emailConfigured ? "발송 설정됨 · 검토 후 사용" : "발신 계정 연결 필요"], ["운영 방식", "문서·메일은 승인 후 실행"]];
  $("#settings").innerHTML = settings.map(([title, value]) => `<div class="setting"><p>${title}</p><strong>${value}</strong></div>`).join("");
  const notifications = { pending: "알림 대기", sent: "디스코드 전송됨", not_configured: "디스코드 미연결", failed_or_uncertain: "알림 전송 확인 필요" };
  $("#history").innerHTML = state.runs.map((run) => {
    const report = state.reports.find((r) => r.date === run.date);
    return `<div class="history-row"><span>${escape(run.date)}</span><span>${labels[run.status]}</span><p>${escape(run.error || (report ? `${report.provider === "codex" ? "Codex" : "팩트챗"} · ${notifications[report.notification]} · 검색: ${report.searched.join(", ")}` : "조사 중입니다. 잠시 후 새로고침해 주세요."))}</p></div>`;
  }).join("") || '<p class="empty">아직 탐색 기록이 없습니다.</p>';
  $("#audit").innerHTML = state.audit.map((a) => `<div class="audit-row">${escape(a.at)} / ${escape(a.event)} / ${escape(a.action_id)}</div>`).join("") || "기록 없음";
}
async function refresh() {
  state = await api("/api/state");
  $("#login").hidden = true; $("#dashboard").hidden = false;
  $("#logout").hidden = state.settings.demo;
  $("#demo-banner").hidden = !state.settings.demo;
  const todayRun = state.runs.find((run) => run.date === state.settings.today);
  $("#run").disabled = state.settings.demo || (!!todayRun && todayRun.status !== "failed");
  $("#run").textContent = todayRun?.status === "running" ? "탐색 중…" : todayRun?.status === "completed" ? "오늘 탐색 완료" : todayRun?.status === "failed" ? "실패한 탐색 재시도 ↗" : "지금 탐색 ↗";
  reportView(); actionsView(); historyView();
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try { await api("/api/session", "POST", { token: $("#password").value }); $("#password").value = ""; await refresh(); }
  catch (error) { message(error.message); }
});
$("#logout").addEventListener("click", async () => { try { await api("/api/session", "DELETE"); state = null; showLogin(); } catch (error) { message(error.message); } });
document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => tab(button.dataset.tab)));
$("#report-select").addEventListener("change", (event) => { selectedDate = event.target.value; history.replaceState(null, "", `/?report=${selectedDate}`); reportView(); });
$("#opportunities").addEventListener("click", (event) => { if (event.target.closest("[data-show-actions]")) { tab("actions"); $("#actions-panel").scrollIntoView({ behavior: "smooth" }); } });
$("#run").addEventListener("click", async () => {
  $("#run").disabled = true;
  try { await api("/api/run", "POST", { retry: true }); message("탐색을 시작했습니다. 완료 후 리포트와 디스코드 알림을 확인해 주세요."); await refresh(); }
  catch (error) { message(error.message); $("#run").disabled = false; }
});
$("#actions").addEventListener("input", (event) => {
  const card = event.target.closest("[data-id]");
  if (!card) return;
  const action = state.actions.find((a) => a.id === card.dataset.id);
  if (!action) return;
  const confirm = card.querySelector('[name="confirm"]');
  const approve = card.querySelector('[data-action="approve"]');
  if (!confirm || !approve) return;
  if (event.target.name !== "confirm") { confirm.checked = false; card.dataset.dirty = "true"; }
  approve.disabled = !confirm.checked || card.dataset.dirty === "true" || (action.deadline && action.deadline < state.settings.today) || (action.payload.kind === "send_email" && !state.settings.emailConfigured);
});
$("#actions").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const card = button.closest("[data-id]");
  const id = card.dataset.id;
  const action = state.actions.find((a) => a.id === id);
  button.disabled = true;
  try {
    const operation = button.dataset.action;
    if (operation === "save") await api(`/api/actions/${id}`, "PATCH", { hash: action.hash, recipient: card.querySelector('[name="recipient"]')?.value || "", subject: card.querySelector('[name="subject"]')?.value || "", body: card.querySelector('[name="body"]').value });
    else if (operation === "approve") await api(`/api/actions/${id}/approve`, "POST", { hash: action.hash, confirmed: card.querySelector('[name="confirm"]').checked });
    else if (operation === "reject") await api(`/api/actions/${id}/reject`, "POST", {});
    else await api(`/api/actions/${id}/resolve`, "POST", { outcome: operation === "resolve-sent" ? "completed" : "rejected" });
    message(operation === "save" ? "초안을 저장했습니다. 변경한 내용을 다시 확인하고 승인해 주세요." : "처리 결과를 확인해 주세요.");
    await refresh();
  } catch (error) { message(error.message); button.disabled = false; }
});

refresh().catch((error) => { if (!$("#login").hidden) return; message(error.message); });
setInterval(() => {
  // Do not replace unsaved operator edits or reset the approval checkbox while reviewing.
  if (state?.runs.some((r) => r.status === "running") && !$("#report-panel").hidden) refresh().catch((error) => message(error.message));
}, 10000);
