import type { Metadata } from "next";
import { logEntries, siteConfig } from "@/data/site";

export const metadata: Metadata = {
  title: "Log",
  description: "겜마루의 공개 활동 기록과 현재 모집 상태",
};

export default function LogPage() {
  return (
    <div className="page-shell log-page">
      <header className="page-hero">
        <h1>LOG<span>.</span></h1>
        <div className="page-hero__aside page-hero__aside--copy"><p>활동 기록과 모집 안내</p></div>
      </header>

      <section className="log-status reveal">
        <div className="log-status__indicator" aria-hidden="true"><span /></div>
        <div><h2>PARTY FORMATION COMPLETE</h2></div>
        <p>이번 시즌의 파티 구성이 완료되었습니다.<br />다음 합류 기회를 노려보세요.</p>
      </section>

      <section className="log-archive">
        <div className="log-archive__header"><p>날짜</p><p>분류</p><p>기록</p><p>내용</p></div>
        {logEntries.map((entry, index) => (
          <article className="log-row log-row--full reveal" key={`${entry.date}-${entry.title}`}>
            <time>{entry.date}</time>
            <span>{entry.type}</span>
            <h2>{entry.title}</h2>
            <p>{entry.description}</p>
            <i aria-hidden="true">{String(index + 1).padStart(2, "0")}</i>
          </article>
        ))}
      </section>

      <section className="social-terminal reveal">
        <div><p className="eyebrow">SOCIAL</p><h2>공식 채널.</h2></div>
        <div className="social-terminal__links">
          {siteConfig.social.map((item) => (
            <a key={item.label} href={item.href} target="_blank" rel="noreferrer">
              <span>{item.label}</span><small>주소 연결 예정</small>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
