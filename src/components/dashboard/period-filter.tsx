"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import type { Period } from "@/lib/data/dashboard";

const options: { value: Period; label: string }[] = [
  { value: "24h", label: "٢٤ ساعة" },
  { value: "48h", label: "٤٨ ساعة" },
  { value: "72h", label: "٧٢ ساعة" },
  { value: "week", label: "أسبوع" },
  { value: "all", label: "الكل" },
];

export function PeriodFilter({ current }: { current: Period }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function select(p: Period) {
    const sp = new URLSearchParams(params);
    sp.set("period", p);
    startTransition(() => router.push(`/dashboard?${sp.toString()}`));
  }

  return (
    <div className={`flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1 ${pending ? "opacity-60" : ""}`}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => select(o.value)}
          className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            current === o.value
              ? "bg-secondary text-gold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
