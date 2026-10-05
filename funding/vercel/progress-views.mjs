import { esc, hidden } from "../portal/views.mjs";
import { progressLabels, categoryLabels } from "./opportunities.mjs";

const buttonLabels = { deferred: "보류", in_progress: "진행 중", completed: "완료", dismissed: "안함" };
const editable = (role) => ["admin", "member"].includes(role);
const fields = (item, date) => hidden("revision", item.revision) + hidden("date", date);
const endpoint = (item) => `/reports/opportunities/${esc(item.id)}/status`;

export function statusFilters(items, base, selected = "") {
  const options = [["", "전체"], ...Object.entries(progressLabels)];
  return `<nav class="status-filters" aria-label="상태별 보기">${options.map(([status, label]) => {
    const count = items.filter((item) => !status || item.status === status).length;
    const href = status ? `${base}?status=${status}` : base;
    return `<a href="${href}" ${status === selected ? 'aria-current="page"' : ""}><span>${label}</span><strong>${count}</strong></a>`;
  }).join("")}</nav>`;
}

export function opportunityRows(items, role, date = "", focused = "") {
  return items.map((item, index) => {
    const state = item.status || "new";
    const trading = item.category === "trading";
    const buttons = editable(role) ? `<form class="quick-status" method="post" action="${endpoint(item)}" aria-label="${esc(item.title)} 상태 변경">${fields(item, date)}${Object.entries(buttonLabels).map(([value, label]) => `<button type="submit" name="status" value="${value}" data-status="${value}" aria-pressed="${value === state}" ${value === state ? "disabled" : ""}>${label}</button>`).join("")}</form>` : "";
    const note = editable(role) ? `<details class="note-editor"><summary>${item.note ? "메모 보기·수정" : "메모 추가"}</summary><form method="post" action="${endpoint(item)}">${fields(item, date)}<label>다음 조사에 반영할 메모<textarea name="note" maxlength="1000" rows="3" placeholder="보류 이유나 이미 진행한 일을 남겨 주세요.">${esc(item.note)}</textarea></label><button class="button small">메모 저장</button></form></details>` : "";
    const reset = editable(role) && state !== "new" ? `<form method="post" action="${endpoint(item)}">${fields(item, date)}<button class="reset-status" name="status" value="new">검토 전으로 되돌리기</button></form>` : "";
    return `<article class="opportunity-row" id="progress-${esc(item.id)}" data-status="${state}">
      <div class="opportunity-main">
        <div class="opportunity-copy"><div class="opportunity-heading"><span class="opportunity-index">${String(index + 1).padStart(2, "0")}</span><h2>${esc(item.title)}</h2><span class="status-badge" data-status="${state}">${esc(progressLabels[state])}</span></div><p class="glance-benefit">${esc(item.benefit)}</p></div>
        <div class="opportunity-action"><span class="field-label">다음 할 일</span><p>${esc(item.nextAction)}</p></div>
        <div class="opportunity-controls">${buttons}${focused === item.id ? `<p class="save-result" role="status">현재 상태 · ${esc(progressLabels[state])}</p>` : ""}</div>
      </div>
      <div class="opportunity-more"><details class="opportunity-detail"><summary>${trading ? "일정·변동 요인·위험 자세히" : "혜택·조건·마감 자세히"}</summary><dl><div><dt>${trading ? "확인한 사실·주요 영향" : "지원 내용"}</dt><dd>${esc(item.benefit)}</dd></div><div><dt>${trading ? "전제·위험·확인 조건" : "신청 자격"}</dt><dd>${esc(item.eligibility)}</dd></div><div><dt>${trading ? "발표 일정·정보 기준 시각" : "마감·접수 상태"}</dt><dd>${esc(item.deadline)}</dd></div><div><dt>다음 할 일</dt><dd>${esc(item.nextAction)}</dd></div>${item.changeNote ? `<div><dt>이전 보고 이후 변화</dt><dd>${esc(item.changeNote)}</dd></div>` : ""}</dl><a class="source-link" href="${esc(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">공식 안내 확인 ↗</a>${item.note ? `<p class="saved-note"><strong>진행 메모</strong><br>${esc(item.note)}</p>` : ""}${reset}</details>${note}</div>
    </article>`;
  }).join("");
}

function categoryRows(items, role, date = "", focused = "") {
  const sections = ["contest", "trading", "job"].map((category) => {
    const entries = items.filter((item) => item.category === category);
    return `<section class="category-section" id="category-${category}"><div class="list-heading"><h2>${categoryLabels[category]} <span>${entries.length}건</span></h2></div>${opportunityRows(entries, role, date, focused) || '<p class="empty">현재 선택한 상태에 등록된 항목이 없습니다.</p>'}</section>`;
  }).join("");
  const legacy = items.filter((item) => !item.category || item.category === "support");
  return `<nav class="status-filters" aria-label="분야 바로가기">${["contest", "trading", "job"].map((category) => `<a href="#category-${category}">${categoryLabels[category]}</a>`).join("")}</nav>${sections}${legacy.length ? `<details class="full-report"><summary>기존 동아리 정보 ${legacy.length}건</summary>${opportunityRows(legacy, role, date, focused)}</details>` : ""}`;
}

export function reportOverview(report, role, opportunities, focused, filter) {
  // Historic report facts stay tied to the edition; only progress is current.
  const items = (report.opportunities || []).map((item) => {
    const progress = opportunities[item.id] || {};
    return { ...item, status: progress.status || "new", note: progress.note || "", revision: progress.revision || 0 };
  });
  const visible = items.filter((item) => !filter || item.status === filter);
  const emptyMessage = Array.isArray(report.opportunities) ? "이번 보고서에는 등록된 기회가 없습니다. 전체 보고서에서 조사 결과를 확인하세요." : "이전 형식의 보고서입니다. 아래에서 전체 내용을 읽을 수 있습니다.";
  const fullReport = `<details class="full-report" id="full-report" ${items.length ? "" : "open"}><summary>전체 보고서 읽기 <span>조사 범위와 근거까지 자세히</span></summary><p><a href="/reports/${report.date}/html?reading=1" target="_blank" rel="noopener noreferrer">본문만 새 탭에서 열기 ↗</a> · <a href="/reports/${report.date}/html" target="_blank" rel="noopener noreferrer">원본 보기 ↗</a></p><iframe class="reader-frame" loading="lazy" title="${esc(report.title)}" src="/reports/${report.date}/html?reading=1" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer"></iframe></details>`;
  return `<header class="overview-nav"><a href="/reports">← 전체 보고서 목록</a><a href="/reports/progress">전체 진행 현황 ↗</a><span>GAMMARU</span></header>
    <section class="overview-heading"><p class="overview-date"><time datetime="${report.date}">${report.date.replaceAll("-", ".")}</time> · 데일리 브리핑</p><h1>${esc(report.title)}</h1>${report.summary ? `<details class="edition-summary"><summary>오늘의 요약 보기</summary><p class="overview-summary">${esc(report.summary)}</p></details>` : ""}</section>
    ${items.length ? `${statusFilters(items, `/reports/${report.date}`, filter)}<div class="list-heading"><h2>오늘의 기회 <span>${visible.length}건</span></h2><p>${report.audience === "personal" ? "개인 기록" : "동아리 공유"} · 상태 버튼을 누르면 바로 저장됩니다.</p></div><section class="opportunities" aria-label="오늘의 기회">${report.audience === "personal" ? categoryRows(visible, role, report.date, focused) : opportunityRows(visible, role, report.date, focused) || '<p class="empty">이 상태의 항목이 없습니다. 다른 상태를 눌러 보세요.</p>'}</section>` : `<p class="reader-empty">${emptyMessage}</p>`}
    ${fullReport}`;
}

export function progressOverview(opportunities, role, filter) {
  const all = Object.values(opportunities).sort((a, b) => b.lastReported.localeCompare(a.lastReported));
  const visible = all.filter((item) => !filter || item.status === filter);
  return `<header class="overview-nav"><a href="/reports">← 전체 보고서 목록</a><span>DAILY BRIEF</span></header><section class="overview-heading"><p class="overview-date">진행 기록</p><h1>공모전·시장 정보·채용 진행 현황</h1><p class="overview-summary">상태와 메모는 다음 조사에 반영됩니다. 지원서 제출이나 매매 주문은 실행되지 않습니다.</p></section>${statusFilters(all, "/reports/progress", filter)}<section class="opportunities" aria-label="진행 항목">${categoryRows(visible, role)}</section>`;
}
