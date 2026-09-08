"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { OwnerPeriod } from "@/lib/data/owner-dashboard";

const PRESETS: { key: OwnerPeriod; label: string }[] = [
  { key: "all", label: "الكل" },
  { key: "today", label: "اليوم" },
  { key: "yesterday", label: "أمس" },
  { key: "week", label: "أسبوع" },
  { key: "month", label: "شهر" },
  { key: "custom", label: "من ← إلى" },
];

/**
 * فلتر فترة موحّد — حبوب `.tf` من المرجع: خلفية raised مدوّرة والزر الفعّال ذهبي.
 * «من ← إلى» يكشف حقلَي تاريخ؛ التطبيق بزر صريح حتى لا نطلق تنقّلًا ناقص الطرفين.
 * كل قسم له ثلاثية مفاتيحه (keys) على مسار /dashboard نفسه، والتحديث يحافظ على
 * بقية البارامترات فلا يُصفّر فلتر قسم آخر.
 */
export function OwnerDateFilter({ period, fromKey, toKey, keys = ["dp", "df", "dt"], compact = false, allowAll = false }: {
  period: OwnerPeriod;
  fromKey: string | null;
  toKey: string | null;
  /** [فترة، من، إلى] — افتراضيًا فلتر الأرقام dp/df/dt. */
  keys?: [string, string, string];
  /** نسخة أصغر (رأس متابعات اليوم). */
  compact?: boolean;
  /** «الكل» يظهر فقط بفلتر الأرقام — بقية الأقسام قوائمها اليومية لا تحتمل «كل التاريخ». */
  allowAll?: boolean;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [open, setOpen] = useState(period === "custom");
  const [from, setFrom] = useState(fromKey ?? "");
  const [to, setTo] = useState(toKey ?? "");
  const [pKey, fKey, tKey] = keys;

  function pushWith(mutate: (q: URLSearchParams) => void) {
    const q = new URLSearchParams(search.toString());
    mutate(q);
    router.push(`/dashboard?${q.toString()}`);
  }

  function go(p: OwnerPeriod) {
    if (p === "custom") { setOpen(true); return; }
    setOpen(false);
    pushWith((q) => { q.set(pKey, p); q.delete(fKey); q.delete(tKey); });
  }

  function applyCustom() {
    if (!from || !to) return;
    pushWith((q) => { q.set(pKey, "custom"); q.set(fKey, from); q.set(tKey, to); });
  }

  return (
    <div className="flex flex-wrap items-center gap-2" style={{ marginInlineStart: "auto" }}>
      <div className={`sop-inset flex gap-1 ${compact ? "p-1" : "p-[5px]"}`}>
        {PRESETS.filter((x) => allowAll || x.key !== "all").map((x) => {
          const on = x.key === period && !(x.key !== "custom" && open);
          return (
            <button
              key={x.key}
              type="button"
              onClick={() => go(x.key)}
              className={`n-press whitespace-nowrap rounded-[9px] transition-colors ${compact ? "px-3.5 py-2 text-[12.5px]" : "px-[18px] py-2.5 text-sm"} ${on || (x.key === "custom" && open) ? "gold-on" : ""}`}
              style={on || (x.key === "custom" && open) ? undefined : { color: "var(--tx2)" }}
            >
              {x.label}
            </button>
          );
        })}
      </div>
      {open && (
        <div className="sop-raise-sm flex items-center gap-1.5 px-2 py-1.5">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="من تاريخ"
            className="rounded-lg bg-transparent px-2 py-1 text-xs text-foreground outline-none"
          />
          <span className="text-xs" style={{ color: "var(--mut)" }}>←</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="إلى تاريخ"
            className="rounded-lg bg-transparent px-2 py-1 text-xs text-foreground outline-none"
          />
          <button
            type="button"
            onClick={applyCustom}
            disabled={!from || !to}
            className="gold-on n-press rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
          >
            طبّق
          </button>
        </div>
      )}
    </div>
  );
}
