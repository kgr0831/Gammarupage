import Link from "next/link";
import { siteConfig } from "@/data/site";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__identity">
        <strong>GAMMARU</strong>
        <p>SOONGSIL UNIVERSITY<br />GAME DEVELOPMENT CLUB</p>
      </div>
      <div className="site-footer__links">
        {siteConfig.social.map((item) => (
          <a key={item.label} href={item.href} target="_blank" rel="noreferrer" title={item.pending ? "공식 주소 연결 예정" : undefined}>
            {item.label}
          </a>
        ))}
      </div>
      <div className="site-footer__meta">
        <span>SINCE 1995</span>
        <Link href="/log">모집 상태</Link>
        <span>© {new Date().getFullYear()} GAMMARU</span>
      </div>
    </footer>
  );
}
