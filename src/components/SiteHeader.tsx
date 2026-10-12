"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { assetPath } from "@/lib/paths";

const navigation = [
  { href: "/games", label: "게임" },
  { href: "/about", label: "겜마루 소개" },
  { href: "/activities", label: "활동" },
  { href: "/log", label: "활동 기록" },
  { href: "/about#faq", label: "자주 묻는 질문" },
];

type MemberSession = {
  authenticated: boolean;
  role?: "member" | "admin" | "publisher";
  subscription?: string | null;
  canRead?: boolean;
};

// Home is a standalone HTML document, so load it using normal anchors.
function HomeBrand({ floating = false }: { floating?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-html-link-for-pages
    <a href="/" className={`brand${floating ? " floating-brand site-brand" : ""}`} aria-label="겜마루 처음으로">
      <Image src={assetPath("/brand/gammaru-mark.png")} alt="" width={39} height={29} priority={floating} />
      <span>GAMMARU</span>
    </a>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const drawer = useRef<HTMLDialogElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<(MemberSession | null)[]>([]);
  const [club, personal] = sessions;

  useEffect(() => {
    let controller: AbortController;
    const refresh = async () => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      const result = await Promise.all(["/reports", "/personal"].map(async (base) => {
        try {
          const response = await fetch(`${base}/session`, { credentials: "same-origin", cache: "no-store", signal: current.signal });
          return response.ok ? await response.json() as MemberSession : null;
        } catch { return null; }
      }));
      if (!current.signal.aborted) setSessions(result);
    };
    const visible = () => { if (!document.hidden) void refresh(); };
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

  useEffect(() => {
    // Includes Back/Forward navigation, where no menu link was clicked.
    drawer.current?.close();
    return () => { document.body.classList.remove("menu-open"); };
  }, [pathname]);

  const openMenu = () => {
    drawer.current?.showModal();
    document.body.classList.add("menu-open");
    setOpen(true);
  };
  const closeMenu = () => drawer.current?.close();
  const closed = () => {
    document.body.classList.remove("menu-open");
    setOpen(false);
    toggle.current?.focus({ preventScroll: true });
  };
  const memberLinks = [];
  if (club?.authenticated) {
    if (club.canRead) memberLinks.push({ href: "/reports", label: "겜마루 일일 보고서" });
    if (club.role === "admin") memberLinks.push({ href: "/reports/admin", label: "겜마루 관리" });
    else if (club.role === "publisher") memberLinks.push({ href: "/reports/upload", label: "겜마루 HTML 업로드" });
    else memberLinks.push({ href: "/reports/account", label: club.subscription === "pending" ? "내 구독 · 승인 대기" : "내 구독" });
  }
  if (personal?.authenticated) {
    if (personal.canRead) memberLinks.push({ href: "/personal", label: "공모전·채용 보고서" });
    if (personal.role === "admin" || personal.role === "publisher") memberLinks.push({ href: "/personal/upload", label: "공모전·채용 HTML 업로드" });
  }

  return (
    <>
      <HomeBrand floating />
      <button ref={toggle} type="button" className="menu-toggle" aria-expanded={open} aria-haspopup="dialog" aria-controls="navigation-drawer" onClick={openMenu}>
        메뉴 <span className="menu-lines" aria-hidden="true" />
      </button>
      <dialog ref={drawer} id="navigation-drawer" className="navigation-drawer" aria-label="페이지 메뉴" onClose={closed} onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeMenu();
      }}>
        <div className="drawer-top"><HomeBrand /><button className="drawer-close" type="button" aria-label="메뉴 닫기" onClick={closeMenu}>×</button></div>
        <nav id="navigation" aria-label="페이지 이동">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" onClick={closeMenu}>처음으로</a>
          {navigation.map((item) => (
            <Link key={item.href} href={item.href} aria-current={pathname === item.href || pathname.startsWith(`${item.href}/`) ? "page" : undefined} onClick={closeMenu}>{item.label}</Link>
          ))}
        </nav>
        <nav id="member-navigation" className="member-navigation" aria-label="내 보고서" hidden={memberLinks.length === 0}>
          {memberLinks.map((item) => <a key={item.href} href={item.href} onClick={closeMenu}>{item.label}</a>)}
        </nav>
        <div className="drawer-links">
          <a href="https://www.instagram.com/ssu_gammaru" target="_blank" rel="noopener noreferrer">모집 안내 ↗</a>
          <Link href="/games" onClick={closeMenu}>게임 아카이브 →</Link>
        </div>
      </dialog>
    </>
  );
}
