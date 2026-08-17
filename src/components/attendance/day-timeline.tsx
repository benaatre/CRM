"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { EmployeeDayTimeline } from "@/lib/data/attendance";

/**
 * سجل اليوم المنسدل (التصميم الزجاجي/Bento) — مشترك بين لوحة «مداوم الآن»
 * (`--att-*`) وعمود الدوام بلوحة المالك (`--od-*`): يقبل التوكنز فيتلبّس ثيم
 * موضعه. جلب كسول عند فتح السهم فقط فلا يثقل اللوحة.
 *
 * رقيقتا bento (حالة الموقع الحية + الجهاز) + خط زمني مدموج بأيقونات SVG نظيفة
 * (صفر emoji). المصدر: getEmployeeDayTimeline (بصم + انتقالات نبض مجمّعة +
 * نداءات + قرارات + توقفات).
 */

export type TimelineTokens = {
  line: string;
  card: string;
  card2: string;
  muted: string;
  text: string;
  gold: string;
  green: string;
  red: string;
  amber: string;
};

/** أيقونات السجل — SVG نظيف. */
function TimelineIcon({ name }: { name: string }) {
  const c = { width: 13, height: 13, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (name) {
    case "login": return <svg {...c}><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><path d="m10 17 5-5-5-5M15 12H3" /></svg>;
    case "logout": return <svg {...c}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></svg>;
    case "pin": return <svg {...c}><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" /></svg>;
    case "radar": return <svg {...c}><path d="M19.07 4.93A10 10 0 0 0 6.99 3.34" /><path d="M2.29 9.62A10 10 0 1 0 21.31 8.35" /><path d="M16.24 7.76A6 6 0 1 0 8.23 16.67" /><circle cx="12" cy="12" r="2" /><path d="m13.41 10.59 5.66-5.66" /></svg>;
    case "bell": return <svg {...c}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>;
    case "check": return <svg {...c}><path d="M20 6 9 17l-5-5" /></svg>;
    case "x": return <svg {...c}><path d="M18 6 6 18M6 6l12 12" /></svg>;
    case "clock": return <svg {...c}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
    case "pause": return <svg {...c}><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>;
    case "play": return <svg {...c}><path d="m6 3 14 9-14 9V3z" /></svg>;
    default: return <svg {...c}><circle cx="12" cy="12" r="9" /></svg>;
  }
}

export function DayTimeline({ userId, t }: { userId: string; t: TimelineTokens }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<EmployeeDayTimeline | null>(null);
  const [loading, setLoading] = useState(false);

  const toneVar: Record<string, string> = { gold: t.gold, green: t.green, red: t.red, amber: t.amber, muted: t.muted };

  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !open;
    setOpen(next);
    if (next && data === null && !loading) {
      setLoading(true);
      try {
        const res = await fetch(`/api/attendance/timeline/${userId}`, { cache: "no-store" });
        const d = (await res.json()) as { ok: boolean } & EmployeeDayTimeline;
        if (d.ok) setData(d);
      } catch {
        /* يبقى null — إعادة الفتح تعيد المحاولة */
      }
      setLoading(false);
    }
  };

  const radarMeta =
    data?.radar.state === "present" ? { label: `بالموقع${data.radar.locationName ? ` · ${data.radar.locationName}` : ""}`, tone: t.green }
    : data?.radar.state === "out" ? { label: "خارج النطاق", tone: t.red }
    : data?.radar.state === "gap" ? { label: "انقطع إثباته", tone: t.amber }
    : { label: "مو مداوم", tone: t.muted };

  return (
    <div className="relative mt-2">
      <button
        type="button"
        onClick={(e) => void toggle(e)}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border py-1.5 text-[11px] font-bold transition-colors"
        style={{ borderColor: t.line, color: t.muted }}
      >
        سجل اليوم
        <ChevronDown aria-hidden size={13} strokeWidth={2} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.3s" }} />
      </button>

      {open && (
        <div className="mt-2 space-y-2.5" onClick={(e) => e.stopPropagation()}>
          {loading && <p className="py-2 text-center text-[11px]" style={{ color: t.muted }}>جاري التحميل…</p>}
          {data && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border p-2.5" style={{ borderColor: t.line, background: t.card2 }}>
                  <span className="block text-[9px]" style={{ color: t.muted }}>حالة الموقع</span>
                  <span className="mt-1 flex items-center gap-1.5 text-[11.5px] font-bold" style={{ color: radarMeta.tone }}>
                    <span aria-hidden className="size-1.5 rounded-full" style={{ background: radarMeta.tone }} />
                    {radarMeta.label}
                  </span>
                </div>
                <div className="rounded-xl border p-2.5" style={{ borderColor: t.line, background: t.card2 }}>
                  <span className="block text-[9px]" style={{ color: t.muted }}>الجهاز</span>
                  <span className="mt-1 block truncate text-[11.5px] font-bold" style={{ color: t.text }}>
                    {data.devices.map((d) => d.detail).join(" · ")}
                  </span>
                </div>
              </div>

              {data.timeline.length === 0 ? (
                <p className="py-2 text-center text-[11px]" style={{ color: t.muted }}>ما فيه أحداث اليوم بعد</p>
              ) : (
                <ul className="space-y-0 border-r pr-3" style={{ borderColor: t.line }}>
                  {data.timeline.map((tl, i) => (
                    <li key={i} className="relative flex items-center gap-2 py-1.5">
                      <span aria-hidden className="absolute -right-[19px] size-2 rounded-full border-2" style={{ background: toneVar[tl.tone] ?? t.muted, borderColor: t.card }} />
                      <span className="flex-none" style={{ color: toneVar[tl.tone] ?? t.muted }}><TimelineIcon name={tl.icon} /></span>
                      <span className="min-w-0 flex-1 truncate text-[11px]" style={{ color: t.text }}>{tl.text}</span>
                      <span className="flex-none text-[10px]" style={{ color: t.muted }}>{tl.atText}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default DayTimeline;
