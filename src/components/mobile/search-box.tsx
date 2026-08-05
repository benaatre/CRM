"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Search } from "lucide-react";
import { MOBILE_COLORS } from "@/lib/mobile-tokens";

/** بحث الاسم/الجوال — يُمرَّر للخادم (getLeads({ q })) لا يُرشَّح محليًا. */
export function MobileSearchBox({
  defaultValue,
  base,
  /** يصل ١ من زر البحث في ترويسة الرئيسية — يفتح لوحة المفاتيح فورًا. */
  autoFocus = false,
}: {
  defaultValue: string;
  base: string;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState(defaultValue);
  const [pending, startTransition] = useTransition();

  const go = (value: string) => {
    const q = value.trim();
    // base قد يحمل استعلامًا أصلًا (?tab=hidden) — ندمج q عليه بدل إلحاق ? ثانية.
    const [path, existing] = base.split("?");
    const p = new URLSearchParams(existing ?? "");
    if (q) p.set("q", q); else p.delete("q");
    const qs = p.toString();
    startTransition(() => router.push(qs ? `${path}?${qs}` : path));
  };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); go(v); }}
      className="flex items-center"
      style={{
        boxSizing: "border-box", flex: 1, height: 44, borderRadius: 13,
        background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
        gap: 9, padding: "0 13px", opacity: pending ? 0.6 : 1,
      }}
    >
      <Search size={17} style={{ color: MOBILE_COLORS.textMuted, flex: "none" }} aria-hidden />
      <input
        autoFocus={autoFocus}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== defaultValue && go(v)}
        placeholder="ابحث باسم أو جوال"
        inputMode="search"
        aria-label="ابحث باسم أو جوال"
        style={{
          boxSizing: "border-box", flex: 1, minWidth: 0, background: "none",
          border: "none", outline: "none", fontSize: "13.5px",
          color: MOBILE_COLORS.textPrimary,
        }}
      />
    </form>
  );
}

export default MobileSearchBox;
