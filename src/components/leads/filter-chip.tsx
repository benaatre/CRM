"use client";

import { cn } from "@/lib/utils";

/**
 * شريحة فلتر موحّدة — علامة ✓ تسبق النص تلقائيًا عند التفعيل.
 * القاعدة عامة من هنا (مو شريحة شريحة): أي شريحة فلتر بالنظام تمرّ من هذا المكوّن،
 * والألوان تبقى من دوال stage-colors (chip/toneFilterChip/stageFilterChip…).
 */
export function FilterChip({
  active, onClick, className, title, children,
}: {
  active: boolean;
  onClick: () => void;
  className: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} title={title} aria-pressed={active} className={cn("inline-flex items-center gap-1", className)}>
      {active && <span aria-hidden className="text-[0.85em] font-bold leading-none">✓</span>}
      {children}
    </button>
  );
}
