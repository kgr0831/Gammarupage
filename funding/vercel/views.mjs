import { layout, hero, esc, hidden, profile, formButton } from "../portal/views.mjs";
import { readerShellStyles } from "./reader.mjs";
import { reportOverview, progressOverview } from "./progress-views.mjs";
import { reportRevision } from "./report-versions.mjs";
export function page(title, content, role = "guest", personal = false) {
  const nav = role === "admin" ? `<a href="/reports">${personal ? "개인 개요" : "보고서 목록"}</a><a href="/reports/progress">진행 관리</a><a href="/reports/upload">HTML 업로드</a>${personal ? '<a href="/reports/account">Discord 연결</a>' : '<a href="/reports/admin">구독 승인</a>'}` : role === "publisher" ? '<a href="/reports/upload">HTML 업로드</a>' : `<a href="/reports">보고서 목록</a><a href="/reports/progress">진행 현황</a><a href="/reports/account">${role === "reader" || (personal && role === "guest") ? "내 계정" : "구독 설정"}</a>`;
  return layout(title, content, role, nav + (personal && ["admin", "member"].includes(role) ? '<a href="/reports/profile">내 조사 조건</a>' : ""), personal).replace('action="/members/logout"', 'action="/reports/logout"').replace("</head>", "<style>.topbar nav{flex-wrap:wrap;min-width:0}</style></head>");
}
export function sharedLogin(configured) {
  return page("데일리 브리핑 로그인", `${hero('DAILY <span>BRIEF.</span>', "개발·AI·IT 공모전과 채용공고를 매일 확인하세요.", "", true)}<section class="panel narrow"><h2>Discord로 바로 시작하기</h2><p>별도 승인 없이 Discord 로그인만 하면 오늘 보고서와 지난 보고서를 볼 수 있습니다.</p><p>진행 상태와 메모는 내 계정에만 저장됩니다.</p>${configured ? '<a class="button" href="/reports/auth/discord">Discord로 로그인 →</a>' : '<p class="notice">Discord 로그인을 준비 중입니다.</p>'}</section>`, "guest", true);
}
export function readerOverview(channelMode = false) {
  return (channelMode ? channelNotice() : "") + '<section class="panel"><h2>함께 보는 데일리 스크럼</h2><p>공모전·채용 보고서를 함께 보고, 진행 상태와 메모는 나만의 기록으로 관리합니다.</p><p class="hint">보고서는 운영자의 조사 기준으로 작성됩니다. 내 기록은 다른 사람의 화면이나 운영자의 다음 조사에 반영되지 않습니다.</p><a class="button secondary" href="/reports/progress">내 진행 현황 →</a></section>';
}
export function readerAccount(member, channelMode = false) {
  return page("내 계정", `${channelMode ? channelNotice() : ""}<section class="panel narrow"><h1>내 Discord 계정</h1>${profile(member)}<p class="notice">로그인되었습니다. 별도 승인 없이 보고서를 볼 수 있습니다.</p><p>진행 상태와 메모는 이 Discord 계정에 저장되며 다른 사람에게 보이지 않습니다.</p><p class="hint">로그인은 이 브라우저에서 30일간 유지됩니다.</p><a class="button" href="/reports">보고서 목록 열기 →</a></section>`, "reader", true);
}
export function login(type, configured, channelMode = false, personal = false) {
  const heading = hero('DAILY <span>ARCHIVE.</span>', personal ? "개발·AI·IT 공모전과 채용공고를 모아 보는 개인 보고서입니다." : "겜마루의 외부 후원·운영자금·유용한 정보를 모아 둔 보고서 보관함입니다.", "", personal);
  if (type === "member" && personal) return page("개인 보고서 로그인", `${heading}<div class="panel narrow"><h2>나만 보는 데일리 브리핑</h2><p>등록된 소유자의 Discord 계정으로 로그인하세요. 새 보고서의 요약과 링크는 본인 DM으로 받습니다.</p>${configured ? '<a class="button" href="/reports/auth/discord">Discord로 로그인 →</a>' : '<p class="notice">로그인 연결을 준비 중입니다.</p>'}</div>`, "guest", personal);
  if (type === "member") return page("보고서 로그인", `${heading}<div class="panel narrow"><h2>구독자 전용 보고서</h2><p>처음 로그인하면 Discord 이름으로 구독 신청이 접수됩니다. ${channelMode ? "관리자 승인 후 보고서를 열람할 수 있습니다. 새 보고서의 요약과 링크는 Discord 서버 채널에 게시됩니다." : "관리자 승인 후 보고서를 열람하고 새 보고서 링크를 DM으로 받습니다."}</p>${configured ? '<a class="button" href="/reports/auth/discord">Discord로 로그인하고 구독 신청 →</a><p class="hint">로그인 완료 안내를 DM으로 보내드립니다. 로그인은 이 브라우저에서 30일간 유지되며, 구독과 보고서 알림은 언제든 해제할 수 있습니다.</p>' : '<p class="notice">Discord 로그인 연결을 준비 중입니다.</p>'}</div>`);
  return page(personal ? "개인 보고서 로그인" : "보고서 관리 로그인", `${heading}<div class="panel narrow"><h2>${type === "admin" ? personal ? "개인 로그인" : "관리자 로그인" : "업로드 전용 로그인"}</h2>${personal && type === "admin" ? '<p>운영자 계정으로 로그인해 보고서와 조사 조건을 관리하세요.</p>' : ""}${configured ? `<form action="/reports/login/${type}" method="post">${type === "admin" ? '<label>아이디<input name="username" required autocomplete="username"></label>' : ""}<label>${type === "admin" ? "비밀번호" : "업로드 키"}<input type="password" name="password" required autocomplete="current-password"></label><button class="button">로그인</button></form>` : '<p class="notice">운영자 설정이 필요합니다.</p>'}</div>`, "guest", personal);
}
export function archive(reports, role, search, currentPage, personal = false, overview = "") {
  const all = reports.filter((r) => `${r.date} ${r.title} ${r.summary}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => b.date.localeCompare(a.date));
  const count = Math.max(1, Math.ceil(all.length / 30));
  const number = Math.min(Math.max(1, currentPage), count);
  const visible = all.slice((number - 1) * 30, number * 30);
  const pageUrl = (n) => `/reports?${new URLSearchParams({ q: search, page: String(n) })}`;
  return page("보고서 보관함", `${hero('DAILY <span>ARCHIVE.</span>', personal ? "오늘의 기회부터 지난 기록까지. 공모전·채용을 날짜별로 확인하세요." : "겜마루의 외부 후원·운영자금·유용한 정보를 날짜별로 확인하세요.", "", personal)}${overview}<form method="get" action="/reports" class="panel"><label>보고서 검색<input type="search" name="q" value="${esc(search)}" placeholder="날짜, 제목 또는 요약" maxlength="100"></label><button class="button secondary small">검색</button></form><div class="section-heading"><h2>누적 보고서 ${all.length}개</h2><small>LATEST FIRST / ${number} OF ${count}</small></div>${visible.map((r) => `<a class="archive-row" href="/reports/${r.date}"><div><span class="meta">${r.date}</span><h2>${esc(r.title)}</h2><p>${esc(r.summary)}</p></div><span class="tag accent">HTML 보고서 열기 ↗</span></a>`).join("") || '<p class="empty">등록된 보고서가 없습니다.</p>'}<div class="row">${number > 1 ? `<a class="button secondary" href="${esc(pageUrl(number - 1))}">이전 목록</a>` : ""}${number < count ? `<a class="button secondary" href="${esc(pageUrl(number + 1))}">다음 목록</a>` : ""}</div>`, role, personal);
}
export function personalOverview(member, channelMode = false) {
  if (channelMode) return channelNotice() + '<section class="panel"><h2>내 데일리 스크럼</h2><p>공모전·채용 보고서와 내 조사 조건을 관리합니다.</p><div class="row"><a class="button secondary" href="/reports/profile">내 조사 조건</a><a class="button secondary" href="/reports/progress">진행 현황</a></div></section>';
  return `<section class="panel"><h2>내 데일리 스크럼</h2><p>개발·AI·IT 공모전과 채용공고를 내 조건에 맞춰 살펴봅니다. 보류한 항목과 진행 기록은 다음 보고서에 이어집니다.</p><p class="notice">${member ? `${esc(member.display_name)} · DM ${member.dm_opt_in ? "수신 켜짐" : "수신 꺼짐"}` : "Discord를 연결하면 새 보고서의 요약과 링크를 DM으로 받습니다."}</p><div class="row"><a class="button" href="/reports/account">${member ? "Discord 연결·알림 설정" : "Discord 연결하기"}</a><a class="button secondary" href="/reports/profile">내 조사 조건</a><a class="button secondary" href="/reports/progress">진행 현황</a></div></section>`;
}
export function personalAccount(member, revision, configured, search, applicationId, channelMode = false) {
  if (channelMode) return readingPage("Discord 알림", channelNotice() + `<section class="panel narrow"><h1>관리자 Discord 계정</h1>${member ? profile(member) : "<p>아직 연결된 계정이 없습니다.</p>"}<p>이 연결은 관리자 로그인에 사용됩니다. 보고서 알림은 서버 채널에 게시됩니다.</p>${configured ? formButton("/reports/auth/discord", member ? "다른 관리자 Discord 계정 연결" : "관리자 Discord 계정 연결", "", "secondary") : ""}<a href="/reports">보고서 목록 →</a></section>`, "admin", true);
  const revisionField = hidden("revision", revision);
  const status = search.has("welcome") ? "Discord 연결을 완료했습니다." : search.has("confirmation") ? "확인 DM을 요청했습니다." : search.has("saved") ? "연결·알림 설정을 저장했습니다." : "";
  return readingPage("Discord 연결", `<section class="panel narrow"><h1>내 Discord 알림</h1><p>새 데일리 스크럼의 요약과 링크를 연결한 계정의 DM으로 받습니다.</p>${status ? `<p class="notice" role="status">${status}</p>` : ""}${member ? `${profile(member)}<p>연결된 Discord: ${esc(member.username)}</p><form action="/reports/subscription" method="post">${revisionField}<label><input type="checkbox" name="dm" value="yes" ${member.dm_opt_in ? "checked" : ""}>새 보고서 요약과 링크를 DM으로 받기</label><button class="button">알림 설정 저장</button></form><h2>확인 DM</h2><p role="status">${esc(noticeStatus(member.approval_notice || member.login_notice))}</p><div class="row">${formButton("/reports/account/confirmation", "확인 DM 보내기", revisionField, "secondary small")}<a class="button secondary small" href="/reports/account">전송 상태 새로고침</a></div>${(member.approval_notice || member.login_notice)?.status === "blocked" && /^\d{17,20}$/.test(applicationId || "") ? `<p><a href="https://discord.com/oauth2/authorize?${esc(new URLSearchParams({ client_id: applicationId, scope: "bot", permissions: "0" }).toString())}" target="_blank" rel="noopener noreferrer">봇을 내 서버에 추가하기</a></p>` : ""}` : '<p class="notice">아직 연결된 Discord 계정이 없습니다.</p>'}<div class="row">${configured ? formButton("/reports/auth/discord", member ? "다른 Discord 계정 연결" : "Discord로 로그인하고 연결", "", "secondary") : '<p class="notice">Discord OAuth 설정 후 연결할 수 있습니다.</p>'}${member ? formButton("/reports/unsubscribe", "Discord 연결 해제", revisionField, "danger") : ""}</div><p class="hint">개인 로그인은 이 브라우저에서 30일간 유지됩니다. Discord 연결을 해제해도 보고서와 진행 기록은 보관됩니다.</p><a href="/reports">개인 개요로 돌아가기 →</a></section>`, "admin", true);
}
function readingPage(title, content, role, personal = false) {
  return page(title, content, role, personal).replace("</head>", '<style>' + readerShellStyles + '</style></head>').replace("<body>", '<body class="report-reader">');
}
export function viewer(report, role, opportunities = {}, focused = "", filter = "") {
  return readingPage(report.title, reportOverview(report, role, opportunities, focused, filter), role, report.audience === "personal");
}
export function progressPage(opportunities, role, filter = "", personal = false) {
  return readingPage("진행 현황", progressOverview(opportunities, role, filter, personal), role, personal);
}
export function publisherGuide({ instructions, design, context, research, today }, role, channelMode = false) {
  const source = (id, title, text) => `<section class="panel guide-section" id="${id}"><h2>${title}</h2><pre>${esc(text)}</pre></section>`;
  const publishedToday = research.previousReports.find((report) => report.date === today);
  const content = `<div class="publisher-guide"><header class="panel"><h1>조사 자료</h1>
    <p class="notice">${research.audience === "personal" ? channelMode ? "공모전·채용 데일리 브리핑 · 서버 채널 알림" : "개인 데일리 브리핑 · 본인 DM" : "겜마루 동아리 보고서 · 외부 후원·운영자금·도움되는 정보"}</p>
    <p>작업 지침, 조사 대상 정보, 디자인 기준과 현재 진행 기록을 이 페이지에서 읽을 수 있습니다.</p>
    <p>한국시간 <strong>${esc(today)}</strong> · <strong>stateVersion: ${research.stateVersion}</strong> · 오늘 보고서 <strong>${publishedToday ? `등록됨 · v${reportRevision(publishedToday)}` : "미등록"}</strong></p>
    <p>정기 실행은 오늘 보고서가 있으면 중복 발행하지 않습니다. 사용자가 변경 사항 반영·재발행을 요청했다면 최신 자료로 HTML을 고친 뒤 업로드 화면에서 ‘수정본으로 재발행’을 선택하고 사유를 입력하세요. 기존 버전과 진행 기록은 보관됩니다.</p>
    <p class="hint">진행 기록은 이 페이지를 열었을 때의 값입니다. 발행 직전에 새로고침하고 변경된 상태와 메모를 반영하세요.</p>
    <div class="row"><a class="button secondary small" href="/reports/upload?guide=1">최신 자료 새로고침</a><a class="button small" href="/reports/upload">HTML 업로드로 돌아가기</a></div>
    <nav class="row" aria-label="조사 자료 목차"><a href="#research-state">이전 보고·진행 기록</a><a href="#instructions">dots 운영 지침</a><a href="#context">조사 대상 정보</a><a href="#design">Design.md</a></nav></header>
    <section class="panel guide-section" id="research-state"><h2>이전 보고·진행 기록</h2><p>stateVersion, 기존 항목의 ID·상태·메모와 이전 보고서 목록이 포함된 전체 JSON입니다.</p><pre id="research-state-json">${esc(JSON.stringify(research, null, 2))}</pre></section>
    ${source("instructions", "dots 운영 지침", instructions)}${source("context", "조사 대상 정보", context)}${source("design", "Design.md", design)}</div>`;
  return readingPage("조사 자료", content, role, research.audience === "personal").replace("</head>", `<style>.publisher-guide{min-width:0}.publisher-guide .guide-section{scroll-margin-top:24px;min-width:0}.publisher-guide pre{white-space:pre-wrap;overflow-wrap:anywhere;word-break:normal;font:inherit;line-height:1.8;margin:0;max-width:100%}.publisher-guide h1{font-size:clamp(26px,5vw,38px)}.publisher-guide nav{margin-top:24px;gap:18px}.publisher-guide nav a{text-decoration:underline}</style></head>`);
}
export function upload(today, role, published, deliveries, enabled, channelId = "", personal = false, basePath = "/reports") {
  const target = channelId ? "채널" : "DM";
  const pending = deliveries.filter((d) => d.date === today && d.status === "pending" && (channelId ? d.channelId === channelId : !d.channelId)).length;
  const date = published?.date || today;
  const revision = reportRevision(published);
  const rows = deliveries.filter((d) => d.date === date && reportRevision(d) === revision && (channelId ? d.channelId === channelId : !d.channelId));
  const labels = { pending: "대기", sending: "전송 중", sent: "전송 완료", blocked: "전송 권한 없음", failed: "실패", uncertain: "결과 불명", cancelled: "취소" };
  const counts = Object.fromEntries(Object.keys(labels).map((key) => [key, rows.filter((row) => row.status === key).length]));
  const result = rows.length
    ? `<dl class="notification-counts">${Object.entries(labels).map(([key, label]) => `<div data-delivery-status="${key}"><dt>${label}</dt><dd>${counts[key]}건</dd></div>`).join("")}</dl>`
    : '<p class="notice">알림 기록이 없습니다. 보고서 발행과 알림 신청 여부를 확인해 주세요.</p>';
  return readingPage("HTML 업로드", `<header class="overview-heading"><p class="overview-date">보고서 등록</p><h1>HTML 업로드</h1><p class="overview-summary">최신 자료 확인 → HTML 미리보기 → 발행 → 알림 확인</p><a class="button secondary small" href="/reports/upload?guide=1">조사 자료·최신 진행 상태 열기</a></header>
    ${published ? `<section class="panel"><p class="notice">${esc(published.date)} 보고서를 등록했습니다. 현재 v${revision} · 주소: <a href="/reports/${published.date}">${esc(basePath)}/${published.date}</a></p><p>이 날짜는 이미 발행되었습니다. 변경 사항이 있으면 아래 ‘수정본으로 재발행’을 선택하세요. 기존 버전과 진행 상태·메모는 유지됩니다.</p>${published.changeReason ? `<p>재발행 사유: ${esc(published.changeReason)}</p>` : ""}</section>` : ""}
    <section class="panel" id="delivery-result"><h2>${esc(date)} · v${revision} 알림 결과</h2><p>오늘 대기 ${pending}건 · ${target} ${enabled ? "활성" : "꺼짐"}</p>${result}
    <p class="hint">전송 완료는 Discord가 메시지 생성을 확인한 건수입니다. 대기 0건만으로 전송 성공을 뜻하지 않습니다. 결과 불명·실패가 있으면 운영자가 확인해야 합니다.</p>
    <div class="row"><a class="button secondary small" href="/reports/upload${published ? `?published=${published.date}` : ""}#delivery-result">알림 결과 새로고침</a>${formButton("/reports/notify", channelId ? "오늘 보고서 채널 게시·대기 처리" : "남은 알림 처리", "", "secondary small")}</div>
    <p class="hint">각 버전의 알림은 수신 대상별로 한 번 보냅니다. 수정본의 알림은 이전 버전과 별도로 집계됩니다. ${channelId ? personal ? "전체 보고서는 Discord 로그인 후 열람할 수 있습니다. " : "전체 보고서는 구독 승인이 필요합니다. " : ""}전송 결과가 불확실한 메시지는 중복 발송하지 않습니다. 과거 보고서는 업로드해도 알림을 보내지 않습니다.</p></section>
    <section class="panel"><h2>보고서 입력</h2><form action="/reports/upload/preview" method="post" enctype="multipart/form-data">
    <label>발행일<input type="date" name="date" required value="${today}" max="${today}"></label>
    <label>보고서 제목<input name="title" required maxlength="150" placeholder="${personal ? "개인 데일리 브리핑" : "겜마루 일일 지원 정보"}"></label>
    <label>목록과 ${target}에 표시할 요약<input name="summary" maxlength="500" placeholder="핵심 기회와 추천 행동을 2~3문장으로 적어 주세요"></label><p class="hint">${target} 알림에는 제목과 이 요약을 함께 보냅니다. 요약이 길면 300자까지 표시합니다.</p>
    <label>HTML 파일<input name="html" type="file" accept=".html,.htm,text/html"></label>
    <details class="html-paste"><summary>파일 대신 HTML 내용 붙여넣기</summary><label>HTML 전체 내용<textarea name="htmlText" rows="12" spellcheck="false" placeholder="&lt;!doctype html&gt;부터 문서 끝까지 붙여넣으세요."></textarea></label></details>
    <p class="hint">파일과 붙여넣기 중 하나만 사용하세요. UTF-8 HTML, 최대 2MB. Design.md 스타일을 포함해 주세요.</p>
    <label><input name="reissue" type="checkbox" value="yes">이미 발행한 날짜의 수정본으로 재발행</label>
    <label>재발행 사유 (수정본일 때 필수)<input name="changeReason" maxlength="300" placeholder="변경된 조사 조건·지침 반영, 잘못된 정보 정정 등"></label>
    <p class="hint">재발행하면 같은 URL에서 최신 내용을 봅니다. 이전 HTML과 진행 기록은 보관하며, 알림을 켜면 수정본 안내를 한 번 더 보냅니다. 정기 실행에서는 임의로 재발행하지 마세요.</p>
    <label><input name="notify" type="checkbox" value="yes" checked>${channelId ? "오늘 보고서의 제목·요약·링크를 Discord 서버 채널에 게시하기" : personal ? "오늘 보고서의 요약·링크를 내 Discord DM으로 받기" : "오늘 보고서라면 승인·알림 동의한 구독자에게 요약·링크 DM 보내기"}</label><button class="button">HTML 미리보기</button></form></section>
    <div class="row"><a class="button secondary small" href="/reports/upload?guide=1#context">조사 대상 정보</a><a class="button secondary small" href="/reports/upload?guide=1#design">Design.md</a><a class="button secondary small" href="/reports/upload?guide=1#research-state">이전 보고·진행 기록</a><a class="button secondary small" href="/reports/upload?guide=1#instructions">dots 운영 지침</a></div>`, role, personal)
    .replace("</head>", "<style>.report-reader>.topbar{display:flex}.notification-counts{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin:24px 0}.notification-counts div{padding:12px;background:var(--navy);border:1px solid var(--line)}.notification-counts dt{font-size:14px}.notification-counts dd{margin:4px 0 0;font-size:22px;font-weight:700}.html-paste{margin:20px 0}.html-paste summary{cursor:pointer;text-decoration:underline}.html-paste textarea{font-family:monospace;font-size:16px;min-width:0;max-width:100%}</style></head>");
}
export function preview(draft, role, personal = false) {
  const manifestNotice = draft.manifest ? `<p>진행 관리에 연결할 항목 ${draft.manifest.opportunities.length}개 · 조사 기준 버전 ${draft.manifest.stateVersion}</p><ul>${draft.manifest.opportunities.map((item) => `<li>${esc(item.title)} · ${esc(item.id)}</li>`).join("")}</ul>` : '<p class="notice">진행 항목 데이터가 없는 HTML입니다. 본문은 발행되지만 상태·메모 관리에는 연결되지 않습니다.</p>';
  const controls = `<section class="panel"><p class="notice">아직 발행하지 않았습니다. 아래 HTML의 내용과 원문 링크를 검토해 주세요. 미리보기는 30분간 유효합니다.</p>${draft.reissue ? `<p class="notice">수정본 v${draft.baseRevision + 1}로 재발행합니다. 기존 v${draft.baseRevision}와 진행 기록은 보관합니다.</p><p>사유: ${esc(draft.changeReason)}</p><p>수정본 알림: ${draft.notify ? "신청됨" : "보내지 않음"}</p>` : ""}${manifestNotice}<form method="post" action="/reports/upload/publish">${hidden("draft", draft.id)}<label><input type="checkbox" name="confirmed" value="yes" required>내용을 확인했고 보고서 등록에 동의합니다.</label><button class="button">${draft.reissue ? "이 수정본 재발행하기" : "이 HTML 등록하기"}</button></form></section>`;
  const frame = `<iframe title="업로드한 HTML 미리보기" src="/reports/upload/preview/${draft.id}/html?reading=1" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" style="display:block;width:100%;height:65vh;border:1px solid var(--line)"></iframe>`;
  return page("HTML 미리보기", hero('PREVIEW <span>BRIEF.</span>', draft.title, draft.date, personal) + controls + frame, role, personal);
}

const statuses = { new: "신청 전", pending: "승인 대기", approved: "승인됨", revoked: "구독 해제", rejected: "반려" };
function noticeStatus(notice) {
  if (!notice) return "아직 보내지 않았습니다.";
  if (["pending", "sending"].includes(notice.status)) return notice.createdAt < Date.now() - 60000 ? "전송 결과를 확인하지 못했습니다." : "전송 중입니다. 잠시 후 전송 상태를 새로고침해 주세요.";
  return ({ sent: "전송했습니다. Discord DM을 확인해 주세요.", blocked: "Discord가 DM 전송을 거절했습니다. 봇이 같은 서버에 있는지와 서버의 DM 허용 설정을 확인해 주세요.", failed: "전송하지 못했습니다. 잠시 후 다시 요청해 주세요.", uncertain: "전송 결과를 확인하지 못했습니다. 받은 DM을 먼저 확인해 주세요.", unavailable: "봇 연결 설정이 필요합니다. 운영자에게 문의해 주세요.", cancelled: "구독 상태가 변경되어 전송을 취소했습니다." })[notice.status] || "전송 결과를 확인하지 못했습니다.";
}
function memberNotifications(member, applicationId) {
  const notice = member.approval_notice || member.login_notice;
  const invite = /^\d{17,20}$/.test(applicationId || "") ? `https://discord.com/oauth2/authorize?${new URLSearchParams({ client_id: applicationId, scope: "bot", permissions: "0" })}` : "";
  return `<section class="panel" aria-label="Discord 알림"><h2>Discord 확인 DM</h2><p role="status">${member.approval_notice ? "구독 승인 안내: " : member.login_notice ? "로그인 안내: " : ""}${esc(noticeStatus(notice))}</p>${notice?.status === "blocked" && invite ? `<p class="hint">사이트 로그인만으로 봇이 서버에 추가되지는 않습니다. 서버 관리자는 아래 링크로 봇을 추가할 수 있습니다.</p><p><a class="button secondary small" href="${esc(invite)}" target="_blank" rel="noopener noreferrer">봇을 서버에 추가 ↗</a></p>` : ""}<div class="row">${member.status === "approved" ? formButton("/reports/account/confirmation", "확인 DM 다시 받기", "", "secondary small") : ""}<a class="button secondary small" href="/reports/account">전송 상태 새로고침</a></div><p class="hint">승인 완료 시 확인 DM을 보냅니다. 수신 설정을 바꾼 뒤에는 재로그인 없이 다시 받을 수 있습니다.</p></section>`;
}
export function account(member, welcome = false, saved = false, applicationId = "", confirmation = false, channelMode = false, personal = false) {
  const request = ["new", "rejected", "revoked"].includes(member.status);
  const approved = member.status === "approved";
  const explanation = approved ? "구독이 승인되었습니다. 일일 보고서와 지난 보고서를 열람할 수 있습니다." : member.status === "pending" ? "구독 신청이 접수되었습니다. 관리자가 승인하면 보고서를 열람할 수 있습니다." : member.status === "rejected" ? "구독 신청이 반려되었습니다. 이름을 확인하고 다시 신청할 수 있습니다." : member.status === "revoked" ? "현재 구독이 해제되어 있습니다. 다시 구독하려면 승인을 요청해 주세요." : "이름을 확인하고 구독 승인을 요청해 주세요.";
  return page("내 구독", `${hero('YOUR <span>BRIEF.</span>', `${member.name || member.display_name}님, 로그인되어 있습니다.`, "", personal)}${welcome ? '<p class="notice" role="status">Discord 로그인이 완료되었습니다. 아래에서 구독 상태와 보고서를 확인하세요.</p>' : ""}${saved ? '<p class="notice" role="status">구독 설정을 저장했습니다.</p>' : ""}${confirmation ? '<p class="notice" role="status">확인 DM을 요청했습니다. 잠시 후 전송 상태를 새로고침해 주세요.</p>' : ""}<div class="panel narrow">${profile(member)}<p class="tag accent">${esc(statuses[member.status])}</p><p>${explanation}</p><div class="row">${approved ? '<a class="button" href="/reports">보고서 목록 열기 →</a>' : '<a class="button secondary" href="/reports/account">승인 상태 새로고침</a>'}<a class="button secondary" href="/">${personal ? "개인 보고서 홈" : "겜마루 홈"}</a></div>${memberNotifications(member, applicationId)}<form action="/reports/subscription" method="post"><label>신청자 이름<input name="name" required minlength="1" maxlength="60" value="${esc(member.name || member.display_name)}" autocomplete="name"></label>${channelMode ? '<p class="hint">일일 보고서의 제목·요약·링크는 Discord 서버 채널에 게시됩니다. 채널 알림은 Discord에서 설정해 주세요.</p>' : `<label><input type="checkbox" name="dm" value="yes" ${member.dm_opt_in ? "checked" : ""}>새 보고서 링크를 Discord DM으로 받겠습니다.</label>`}<button class="button">${request ? "구독 승인 요청" : "구독 설정 저장"}</button></form>${["pending", "approved"].includes(member.status) ? formButton("/reports/unsubscribe", member.status === "pending" ? "구독 신청 취소" : "구독 해제", "", "danger") : ""}<p class="hint">로그인은 이 브라우저에서 30일간 유지됩니다. DM 전송 여부와 관계없이 사이트를 이용할 수 있습니다.</p></div>`, "member", personal);
}
export function admin(members, deliveries, channelMode = false, personal = false) {
  const cards = members.filter((m) => m.status !== "new").map((m) => `<section class="card">${profile(m)}<p class="tag">${esc(statuses[m.status])}</p>${channelMode ? '<p class="hint">일일 보고서: 서버 채널 게시</p>' : `<p class="hint">보고서 DM ${m.dm_opt_in ? "동의" : "미동의"}</p>`}<p>승인 확인 DM: ${esc(noticeStatus(m.approval_notice))}</p>${m.approval_notice?.errorCode ? `<p class="hint">Discord 오류 코드: ${esc(m.approval_notice.errorCode)}</p>` : ""}<a href="https://discord.com/users/${m.id}" target="_blank" rel="noopener noreferrer">Discord 프로필 ↗</a><div class="row">${m.status === "pending" ? formButton(`/reports/admin/${m.id}/approve`, "구독 승인", "", "small") + formButton(`/reports/admin/${m.id}/reject`, "반려") : ""}${m.status === "approved" ? formButton(`/reports/admin/${m.id}/notify`, "승인 확인 DM 보내기") + formButton(`/reports/admin/${m.id}/revoke`, "승인 취소") : ""}</div></section>`).join("");
  return page("구독 승인", `${hero('CONTROL <span>ROOM.</span>', "보고서 구독을 승인하고 링크 알림 상태를 확인합니다.", "", personal)}<div class="grid">${cards || '<p class="empty">구독 신청이 아직 없습니다.</p>'}</div><div class="section-heading"><h2>알림 기록</h2></div><div class="table-wrap"><table><thead><tr><th>날짜</th><th>전송 대상</th><th>상태</th></tr></thead><tbody>${deliveries.slice(-100).reverse().map((d) => `<tr><td>${esc(d.date)}</td><td>${esc(d.channelId ? `Discord 채널 ${d.channelId}` : members.find((m) => m.id === d.memberId)?.name || "")}</td><td>${esc(d.status)}</td></tr>`).join("")}</tbody></table></div><p class="hint">pending: 대기, sent: 전송됨, blocked: 전송 권한 없음, failed: 실패, uncertain: 수신 여부 불명, cancelled: 취소. uncertain은 자동 재발송하지 않습니다.</p>`, "admin", personal);
}

function channelNotice() {
  return '<section class="panel"><h2>서버 채널 알림</h2><p>새 공모전·채용 보고서의 제목·요약·링크는 Discord 서버 채널에 게시됩니다. 개인 DM은 보내지 않습니다.</p><p class="hint">알림을 받을지는 Discord에서 해당 채널의 알림 설정으로 조절하세요.</p></section>';
}
