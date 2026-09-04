import type { Metadata, Viewport } from "next";
import { Noto_Sans_KR, Oxanium } from "next/font/google";
import "./globals.css";
import { MotionLayer } from "@/components/MotionLayer";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { siteConfig } from "@/data/site";
import { assetPath, publicSiteUrl } from "@/lib/paths";

const bodyFont = Noto_Sans_KR({
  variable: "--font-body",
  display: "swap",
  preload: false,
});

const displayFont = Oxanium({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(publicSiteUrl),
  title: {
    default: "GAMMARU — 숭실대학교 게임 제작 중앙동아리",
    template: "%s — GAMMARU",
  },
  description: siteConfig.description,
  icons: {
    icon: assetPath("/brand/gammaru-mark.png"),
    apple: assetPath("/brand/gammaru-mark.png"),
  },
  openGraph: {
    title: "GAMMARU — THE BUILD IS OUR INTRODUCTION.",
    description: siteConfig.description,
    images: [`${publicSiteUrl}/brand/hero-end-frame.png`],
    locale: "ko_KR",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#080918",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className={`${bodyFont.variable} ${displayFont.variable}`}>
      <body>
        <a className="skip-link" href="#main-content">본문 바로가기</a>
        <div className="site-noise" aria-hidden="true" />
        <MotionLayer />
        <SiteHeader />
        <main id="main-content">{children}</main>
        <SiteFooter />
        <div className="hero-reel__wipe">
          <div className="hero-loader" role="status" aria-live="polite" aria-label="로딩 중">
            <span className="hero-loader__label" aria-hidden="true">
              <span className="hero-loader__typing">로딩 중</span>
              <i className="hero-loader__cursor" />
            </span>
            <span className="hero-loader__dots" aria-hidden="true">
              <i>.</i><i>.</i><i>.</i><i>.</i>
            </span>
          </div>
        </div>
      </body>
    </html>
  );
}
