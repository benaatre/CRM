"use client";

import Link from "next/link";
import type { TodayAppointment } from "@/lib/data/dashboard";

/**
 * شريط مواعيد اليوم المتحرك — لوحة الموظف فقط (المدير لا يراه إطلاقًا):
 * يلف من اليمين لليسار (CSS marquee)، يتوقف عند hover، والنقر يفتح ملف العميل.
 * القادم ذهبي #CBA45E · الفائت أحمر. يختفي إن لا مواعيد اليوم.
 */
const RIYADH_TZ = "Asia/Riyadh";

function timeLabel(at: Date): string {
  return new Intl.DateTimeFormat("ar-SA-u-nu-arab", { timeZone: RIYADH_TZ, hour: "numeric", minute: "2-digit" }).format(at);
}

export function TodayMarquee({ items }: { items: TodayAppointment[] }) {
  if (items.length === 0) return null;
  const now = Date.now();

  const chips = items.map((a, i) => {
    const past = new Date(a.at).getTime() < now;
    return (
      <Link
        key={`${a.leadId}-${a.kind}-${i}`}
        href={`/leads/${a.leadId}`}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
          past
            ? "border-destructive/40 bg-destructive/10 text-destructive"
            : "border-gold/40 bg-gold/10 text-gold"
        }`}
        dir="rtl"
        title={past ? "فات وقته — بادر الآن" : "موعد اليوم"}
      >
        <span>{a.kind === "visit" ? "🏠 زيارة" : "📅 موعد لاحق"}: {a.name} {timeLabel(new Date(a.at))}</span>
      </Link>
    );
  });

  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-border bg-card/60 py-2" aria-label="مواعيد اليوم">
      {/* المسار LTR ثابت للحركة السلسة (النسخة المكررة = لفة بلا فجوة)، والنص داخل الشرائح RTL. */}
      <div className="marquee-track inline-flex items-center gap-3 pr-3" style={{ direction: "ltr" }}>
        {chips}
        {chips.map((c, i) => <span key={`dup-${i}`} className="inline-flex">{c}</span>)}
      </div>
    </div>
  );
}
