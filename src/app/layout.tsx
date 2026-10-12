import type { Metadata, Viewport } from "next";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import Script from "next/script";
import { Noto_Sans_KR, Manrope } from "next/font/google";
import "./globals.css";
import "./interior.css";
import "../../public/landing/chrome.css";
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

const displayFont = Manrope({
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
  themeColor: "#09090c",
  colorScheme: "dark",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const pixelScript = await readFile(path.join(process.cwd(), "public/landing/illustrations.js"));
  const pixelVersion = createHash("sha256").update(pixelScript).digest("hex").slice(0, 12);
  return (
    <html lang="ko" className={`${bodyFont.variable} ${displayFont.variable}`}>
      <body>
        <a className="skip-link" href="#main-content">본문 바로가기</a>
        <MotionLayer />
        <SiteHeader />
        <main id="main-content">{children}</main>
        <SiteFooter />
        <Script src={`/landing/illustrations.js?v=${pixelVersion}`} strategy="afterInteractive" />
      </body>
    </html>
  );
}
