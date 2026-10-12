import Image from "next/image";
import { siteConfig } from "@/data/site";
import { assetPath } from "@/lib/paths";

export function SiteFooter() {
  return (
    <footer className="site-footer wrap">
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a className="brand" href="/"><Image src={assetPath("/brand/gammaru-mark.png")} alt="" width={33} height={25} /><span>GAMMARU</span></a>
      <p>숭실대학교 게임 제작 중앙동아리</p>
      <div className="footer-links">
        {siteConfig.social.filter((item) => !item.pending).map((item) => (
          <a key={item.label} href={item.href} target="_blank" rel="noopener noreferrer">{item.label === "INSTAGRAM" ? "Instagram" : "YouTube"} ↗</a>
        ))}
        <a href={siteConfig.archiveSource} target="_blank" rel="noopener noreferrer">게임 아카이브 ↗</a>
      </div>
      <small>© {new Date().getFullYear()} GAMMARU</small>
    </footer>
  );
}
