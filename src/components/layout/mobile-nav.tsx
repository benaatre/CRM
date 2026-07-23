"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, SunMoon, LogOut } from "lucide-react";
import { signOutAction } from "@/lib/actions/auth";
import { toArabicDigits } from "@/lib/format";
import { navForRole } from "./nav-items";
import { Brand } from "./brand";

/** زر القائمة (☰) + درج جانبي من اليمين للجوال — يُغلق تلقائيًا عند الضغط على رابط. */
export function MobileNav({
  isManager,
  isOwner = false,
  companyName,
  logoUrl,
  falLicense,
  dupCount = 0,
}: {
  isManager: boolean;
  isOwner?: boolean;
  companyName: string;
  logoUrl?: string | null;
  falLicense: string | null;
  dupCount?: number;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  const nav = navForRole(isManager, isOwner);

  // الدرج يُحقن في <body> عبر portal حتى لا يتأثر بـ backdrop-filter في الهيدر
  // (الذي يكسر fixed ويجعل محتوى الدرج يتسرّب فوق الصفحة).
  useEffect(() => setMounted(true), []);

  function toggleTheme() {
    const isLight = document.documentElement.classList.toggle("light");
    try {
      localStorage.setItem("theme", isLight ? "light" : "dark");
    } catch {}
  }

  return (
    <>
      {/* زر القائمة — على الجوال فقط */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="القائمة"
        className="flex size-11 items-center justify-center rounded-xl border border-border text-foreground md:hidden"
      >
        <Menu className="size-5" />
      </button>

      {mounted && open && createPortal(
        <div className="fixed inset-0 z-[80] md:hidden">
          {/* طبقة معتمة */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />

          {/* الدرج — يغطّي الشاشة كاملة على الجوال */}
          <aside className="absolute inset-0 flex w-full flex-col bg-card p-5 shadow-2xl">
            <div className="mb-6 flex items-start justify-between">
              <div>
                <Brand companyName={companyName} logoUrl={logoUrl} textClassName="text-xl" imgClassName="h-9 w-auto" />
                <p className="mt-0.5 text-xs text-muted-foreground">إدارة المبيعات العقارية</p>
              </div>
              <button onClick={() => setOpen(false)} aria-label="إغلاق" className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary">
                <X className="size-5" />
              </button>
            </div>

            <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
              {nav.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={`flex min-h-14 items-center gap-3 rounded-xl px-3 text-base transition-colors ${
                      active ? "bg-secondary text-gold" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                    }`}
                  >
                    <Icon className="size-5" />
                    <span className="flex-1">{item.label}</span>
                    {item.href === "/leads/duplicates" && dupCount > 0 && (
                      <span className="rounded-full bg-gold/15 px-2 py-0.5 text-xs font-bold text-gold">{toArabicDigits(dupCount)}</span>
                    )}
                  </Link>
                );
              })}
            </nav>

            {/* أدوات + خروج (انتقلت من الهيدر) */}
            <div className="mt-4 space-y-2 border-t border-border pt-4">
              <button
                onClick={toggleTheme}
                className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <SunMoon className="size-5" />
                تبديل الثيم
              </button>
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-sm text-destructive hover:bg-destructive/10"
                >
                  <LogOut className="size-5" />
                  تسجيل الخروج
                </button>
              </form>
              {falLicense && (
                <div className="rounded-xl border border-border bg-background/50 px-3 py-2 text-center">
                  <div className="text-[0.65rem] text-muted-foreground">ترخيص فال (REGA)</div>
                  <div className="text-xs font-medium text-gold" dir="ltr">{falLicense}</div>
                </div>
              )}
            </div>
          </aside>
        </div>,
        document.body,
      )}
    </>
  );
}
