"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { OwnerPeriod } from "@/lib/data/owner-dashboard";

const PRESETS: { key: OwnerPeriod; label: string }[] = [
  { key: "today", label: "اليوم" },
  { key: "yesterday", label: "أمس" },
  { key: "week", label: "أسبوع" },
  { key: "month", label: "شهر" },
  { key: "custom", label: "من ← إلى" },
];

/**
 * فلتر فترة الأرقام — حبوب `.tf` من المرجع: خلفية raised مدوّرة والزر الفعّال ذهبي.
 * «من ← إلى» يكشف حقلَي تاريخ؛ التطبيق بزر صريح حتى لا نطلق تنقّلًا ناقص الطرفين.
 * البارامترات على المسار نفسه: `dp` + `df`/`dt` — تُقرأ على الخادم.
 */
export function OwnerDateFilter({ period, fromKey, toKey }: {
  period: OwnerPeriod;
  fromKey: string | null;
  toKey: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(period === "custom");
  const [from, setFrom] = useState(fromKey ?? "");
  const [to, setTo] = useState(toKey ?? "");

  function go(p: OwnerPeriod) {
    if (p === "custom") { setOpen(true); return; }
    setOpen(false);
    router.push(`/dashboard?dp=${p}`);
  }

  function applyCustom() {
    if (!from || !to) return;
    router.push(`/dashboard?dp=custom&df=${from}&dt=${to}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2" style={{ marginInlineStart: "auto" }}>
      <div className="flex gap-1 rounded-[20px] p-[5px]" style={{ background: "var(--od-raised)" }}>
        {PRESETS.map((x) => {
          const on = x.key === period && !(x.key !== "custom" && open);
          return (
            <button
              key={x.key}
              type="button"
              onClick={() => go(x.key)}
              className="whitespace-nowrap rounded-[18px] px-[18px] py-2.5 text-sm transition-colors"
              style={on || (x.key === "custom" && open)
                ? { background: "var(--gold)", color: "#fff", fontWeight: 600 }
                : { color: "var(--od-t2)" }}
            >
              {x.label}
            </button>
          );
        })}
      </div>
      {open && (
        <div className="flex items-center gap-1.5 rounded-[14px] px-2 py-1.5" style={{ background: "var(--od-raised)" }}>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="من تاريخ"
            className="rounded-lg bg-transparent px-2 py-1 text-xs text-foreground outline-none [color-scheme:dark]"
          />
          <span className="text-xs" style={{ color: "var(--od-t3)" }}>←</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="إلى تاريخ"
            className="rounded-lg bg-transparent px-2 py-1 text-xs text-foreground outline-none [color-scheme:dark]"
          />
          <button
            type="button"
            onClick={applyCustom}
            disabled={!from || !to}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
            style={{ background: "var(--gold)", color: "#fff" }}
          >
            طبّق
          </button>
        </div>
      )}
    </div>
  );
}
