"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Sun,
  Moon,
  Plus,
  LogOut,
  Smartphone,
  Monitor,
} from "lucide-react";
import { signOutAction } from "@/lib/actions/auth";
import { NewLeadDialog } from "@/components/leads/new-lead-dialog";

type Employee = { id: string; name: string };

export function Topbar({
  userName,
  roleLabel,
  companyName,
  isManager,
  employees,
}: {
  userName: string;
  roleLabel: string;
  companyName: string;
  isManager: boolean;
  employees: Employee[];
}) {
  const router = useRouter();
  const [dark, setDark] = useState(true);
  const [lang, setLang] = useState<"ar" | "en">("ar");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
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
      {/* يمين: المستخدم + خروج */}
      <div className="flex items-center gap-3">
        <span className="font-logo text-lg font-bold text-gold md:hidden">{companyName}</span>
        <div className="hidden text-left sm:block">
          <div className="text-sm font-medium text-foreground">{userName}</div>
          <div className="text-xs text-gold">{roleLabel}</div>
        </div>
        <form action={signOutAction}>
          <button
            type="submit"
            title="خروج"
            className="flex items-center gap-1.5 rounded-xl border border-border px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
          >
            <LogOut className="size-4" />
            <span className="hidden md:inline">خروج</span>
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

        {/* معاينة جوال/سطح مكتب */}
        <Segmented
          className="hidden md:flex"
          options={[
            { v: "desktop", icon: Monitor },
            { v: "mobile", icon: Smartphone },
          ]}
          value={device}
          onChange={(v) => setDevice(v as "desktop" | "mobile")}
        />

        {/* EN / ع */}
        <div className="hidden items-center rounded-xl border border-border p-0.5 text-xs sm:flex">
          <button onClick={() => setLang("ar")} className={`rounded-lg px-2 py-1 ${lang === "ar" ? "bg-secondary text-gold" : "text-muted-foreground"}`}>ع</button>
          <button onClick={() => setLang("en")} className={`rounded-lg px-2 py-1 ${lang === "en" ? "bg-secondary text-gold" : "text-muted-foreground"}`}>EN</button>
        </div>

        {/* ليل / نهار */}
        <button
          onClick={toggleTheme}
          title={dark ? "الوضع النهاري" : "الوضع الليلي"}
          className="rounded-xl border border-border p-2 text-muted-foreground transition-colors hover:text-gold"
        >
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>

        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          <Plus className="size-4" />
          <span className="hidden sm:inline">عميل جديد</span>
        </button>
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

function Segmented({
  options,
  value,
  onChange,
  className = "",
}: {
  options: { v: string; icon: typeof Monitor }[];
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={`items-center rounded-xl border border-border p-0.5 ${className}`}>
      {options.map((o) => {
        const Icon = o.icon;
        return (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            className={`rounded-lg p-1.5 ${value === o.v ? "bg-secondary text-gold" : "text-muted-foreground"}`}
          >
            <Icon className="size-4" />
          </button>
        );
      })}
    </div>
  );
}
