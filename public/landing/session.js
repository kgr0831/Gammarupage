// Only expose report navigation after the existing server session is confirmed.
// Session cookies remain HttpOnly; identity is never written to browser storage.
(() => {
  "use strict";
  const navigation = document.querySelector("#member-navigation");
  let controller;
  const link = (label, href) => {
    const anchor = document.createElement("a");
    anchor.textContent = label;
    anchor.href = href;
    return anchor;
  };
  async function refresh() {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    const sessions = await Promise.all(["/reports", "/personal"].map(async (base) => {
      try {
        const response = await fetch(`${base}/session`, { credentials: "same-origin", cache: "no-store", signal: current.signal });
        return response.ok ? await response.json() : null;
      } catch { return null; }
    }));
    if (current.signal.aborted) return;
    const [club, personal] = sessions;
    const links = [];
    if (club?.authenticated) {
      if (club.canRead) links.push(link("겜마루 일일 보고서", "/reports"));
      if (club.role === "admin") links.push(link("겜마루 관리", "/reports/admin"));
      else if (club.role === "publisher") links.push(link("겜마루 HTML 업로드", "/reports/upload"));
      else links.push(link(club.subscription === "pending" ? "내 구독 · 승인 대기" : "내 구독", "/reports/account"));
    }
    if (personal?.authenticated) {
      if (personal.canRead) links.push(link("공모전·채용 보고서", "/personal"));
      if (["admin", "publisher"].includes(personal.role)) links.push(link("공모전·채용 HTML 업로드", "/personal/upload"));
    }
    navigation.replaceChildren(...links);
    navigation.hidden = links.length === 0;
  }
  const visible = () => { if (!document.hidden) void refresh(); };
  window.addEventListener("pageshow", visible);
  window.addEventListener("focus", visible);
  document.addEventListener("visibilitychange", visible);
  void refresh();
})();
