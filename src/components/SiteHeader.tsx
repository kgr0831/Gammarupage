"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { assetPath } from "@/lib/paths";

const navigation = [
  { href: "/games", label: "GAMES" },
  { href: "/activities", label: "ACTIVITIES" },
  { href: "/about", label: "ABOUT" },
  { href: "/log", label: "LOG" },
];

type MemberSession = {
  authenticated: boolean;
  role?: "member" | "admin" | "publisher";
  name?: string;
  subscription?: string | null;
  canRead?: boolean;
};

export function SiteHeader() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<MemberSession>({ authenticated: false });

  useEffect(() => {
    let controller: AbortController;
    const refresh = async () => {
      controller?.abort();
      const currentController = new AbortController();
      controller = currentController;
      try {
        const response = await fetch("/reports/session", { credentials: "same-origin", cache: "no-store", signal: currentController.signal });
        const current: MemberSession = response.ok ? await response.json() : { authenticated: false };
        if (!currentController.signal.aborted) setSession(current);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setSession({ authenticated: false });
      }
    };
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    void refresh();
    window.addEventListener("focus", visible);
    window.addEventListener("pageshow", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      controller?.abort();
      window.removeEventListener("focus", visible);
      window.removeEventListener("pageshow", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [pathname]);

  const memberLabel = session.role === "admin" ? "관리자" : session.role === "publisher" ? "HTML 업로드" : session.subscription === "approved" ? "내 구독 · 승인됨" : session.subscription === "pending" ? "내 구독 · 승인 대기" : "내 구독";
  const accountHref = session.role === "admin" ? "/reports/admin" : session.role === "publisher" ? "/reports/upload" : "/reports/account";

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 64);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`site-header${scrolled ? " site-header--solid" : ""}`}>
      <Link href="/" className="site-brand" aria-label="겜마루 홈">
        <Image src={assetPath("/brand/gammaru-mark.png")} alt="" width={38} height={30} priority />
        <span>GAMMARU</span>
      </Link>
      <button
        type="button"
        className="menu-toggle"
        aria-expanded={open}
        aria-controls="primary-navigation"
        onClick={() => setOpen((value) => !value)}
      >
        <span>{open ? "CLOSE" : "MENU"}</span>
      </button>
      <nav id="primary-navigation" className={`site-nav${open ? " site-nav--open" : ""}${session.authenticated ? " site-nav--member" : ""}`} aria-label="주요 메뉴">
        {navigation.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)}>
              {item.label}
            </Link>
          );
        })}
        {session.authenticated && <>
          {session.canRead && (
            // eslint-disable-next-line @next/next/no-html-link-for-pages -- Reports serves standalone HTML, so use a full navigation.
            <a className="member-link" href="/reports">일일 보고서</a>
          )}
          <a className="member-link" href={accountHref} title={`${session.name || "회원"}님 로그인됨`}>{memberLabel}</a>
        </>}
      </nav>
    </header>
  );
}
