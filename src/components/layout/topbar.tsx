"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Sun,
  Moon,
  Plus,
  LogOut,
  MonitorSmartphone,
} from "lucide-react";
import { signOutAction, signOutAllDevicesAction } from "@/lib/actions/auth";
import { NewLeadDialog } from "@/components/leads/new-lead-dialog";
import { NotificationBell } from "@/components/layout/notification-bell";
import { MobileNav } from "@/components/layout/mobile-nav";
import { Brand } from "@/components/layout/brand";
import { SelfAvailabilityToggle } from "@/components/availability/self-availability";
import type { MyAvailability } from "@/lib/actions/availability";

type Employee = { id: string; name: string };

export function Topbar({
  userName,
  roleLabel,
  companyName,
  logoUrl,
  falLicense,
  isManager,
  isOwner = false,
  employees,
  availability,
  dupCount = 0,
}: {
  userName: string;
  roleLabel: string;
  companyName: string;
  logoUrl?: string | null;
  falLicense: string | null;
  isManager: boolean;
  isOwner?: boolean;
  employees: Employee[];
  availability: MyAvailability | null;
  dupCount?: number;
}) {
  const router = useRouter();
  const [dark, setDark] = useState(true);
  const [lang, setLang] = useState<"ar" | "en">("ar");
  const [q, setQ] = useState("");
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    setDark(!document.documentElement.classList.contains("light"));
  }, []);

  function toggleTheme() {
    const isLight = document.documentElement.classList.toggle("light");
    try {
      localStorage.setItem("theme", isLight ? "light" : "dark");
    } catch {}
    setDark(!isLight);
  }

  function search(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim()) router.push(`/leads?q=${encodeURIComponent(q.trim())}`);
  }

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-card/70 px-4 py-3 backdrop-blur-md md:px-6">
      {/* يمين: اللوجو فقط (جوال) · المستخدم + خروج (سطح المكتب) */}
      <div className="flex items-center gap-3">
        <span className="md:hidden"><Brand companyName={companyName} logoUrl={logoUrl} textClassName="text-lg" imgClassName="h-7 w-auto" /></span>
        <div className="hidden text-left sm:block">
          <div className="text-sm font-medium text-foreground">{userName}</div>
          <div className="text-xs text-gold">{roleLabel}</div>
        </div>
        <form action={signOutAction} className="hidden md:block">
          <button
            type="submit"
            title="خروج"
            className="flex items-center gap-1.5 rounded-xl border border-border px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
          >
            <LogOut className="size-4" />
            <span className="hidden md:inline">خروج</span>
          </button>
        </form>
        <form
          action={signOutAllDevicesAction}
          className="hidden md:block"
          onSubmit={(e) => {
            if (!confirm("تسجيل الخروج من كل الأجهزة؟ ستحتاج تسجيل الدخول من جديد على كل جهاز.")) {
              e.preventDefault();
            }
          }}
        >
          <button
            type="submit"
            title="خروج من كل الأجهزة"
            className="flex items-center gap-1.5 rounded-xl border border-border px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
          >
            <MonitorSmartphone className="size-4" />
            <span className="hidden lg:inline">كل الأجهزة</span>
          </button>
        </form>
      </div>

      {/* يسار: أدوات */}
      <div className="flex items-center gap-2">
        <form onSubmit={search} className="relative hidden lg:block">
          <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="بحث…"
            className="w-44 rounded-xl border border-border bg-background py-2 pr-9 pl-3 text-sm outline-none focus:border-gold"
          />
        </form>

        {/* EN / ع */}
        <div className="hidden items-center rounded-xl border border-border p-0.5 text-xs md:flex">
          <button onClick={() => setLang("ar")} className={`rounded-lg px-2 py-1 ${lang === "ar" ? "bg-secondary text-gold" : "text-muted-foreground"}`}>ع</button>
          <button onClick={() => setLang("en")} className={`rounded-lg px-2 py-1 ${lang === "en" ? "bg-secondary text-gold" : "text-muted-foreground"}`}>EN</button>
        </div>

        <span className="hidden md:inline-flex"><NotificationBell /></span>

        {/* ليل / نهار */}
        <button
          onClick={toggleTheme}
          title={dark ? "الوضع النهاري" : "الوضع الليلي"}
          className="hidden rounded-xl border border-border p-2 text-muted-foreground transition-colors hover:text-gold md:block"
        >
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>

        {availability && <SelfAvailabilityToggle initial={availability} />}

        <button
          onClick={() => setShowNew(true)}
          className="hidden min-h-11 items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 md:flex"
        >
          <Plus className="size-4" />
          <span>عميل جديد</span>
        </button>

        {/* أدوات الجوال: إشعارات + تبديل ثيم + زر القائمة ☰ */}
        <span className="md:hidden"><NotificationBell /></span>
        <button
          onClick={toggleTheme}
          title={dark ? "الوضع النهاري" : "الوضع الليلي"}
          aria-label="تبديل الثيم"
          className="flex size-11 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:text-gold md:hidden"
        >
          {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
        </button>
        <MobileNav isManager={isManager} isOwner={isOwner} companyName={companyName} logoUrl={logoUrl} falLicense={falLicense} dupCount={dupCount} />
      </div>

      <NewLeadDialog
        open={showNew}
        onClose={() => setShowNew(false)}
        isManager={isManager}
        employees={employees}
      />
    </header>
  );
}
