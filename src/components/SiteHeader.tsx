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

export function SiteHeader() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

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
      <nav id="primary-navigation" className={`site-nav${open ? " site-nav--open" : ""}`} aria-label="주요 메뉴">
        {navigation.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)}>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
