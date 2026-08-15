"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { OwnerFollowupRow, OwnerFuStatus } from "@/lib/data/owner-dashboard";
import { toArabicDigits } from "@/lib/format";

/**
 * «متابعات اليوم — كل العملاء» — نهر بطاقات fucard من المرجع:
 * حافة يمنى ملوّنة بالحالة، تمرير تلقائي بطيء (يتوقف بالمرور)، وفلتر حالة بعدّادات.
 * الحالة محسوبة على الخادم؛ هنا عرض وترشيح فقط. النقر يفتح ملف العميل.
 */

const STATUS_META: Record<OwnerFuStatus, { label: string; color: string }> = {
  late: { label: "متأخّر", color: "var(--od-red)" },
  soon: { label: "قرب موعده", color: "var(--od-try)" },
  next: { label: "قادمة", color: "var(--od-visit)" },
  done: { label: "تمّت", color: "var(--od-won)" },
};

const FILTERS: (OwnerFuStatus | "all")[] = ["all", "late", "soon", "next", "done"];

// لوحة ألوان حتمية لنقطة الموظف وحرف العميل — من ألوان المرجع نفسها.
const AV_COLORS = ["#e8a54d", "#5b9def", "#a98edb", "#34d494", "#5bbccb", "#ff7a8a", "#cba45e"];
function colorFor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
}

/** «متأخّر ساعتين» — صياغة المدة بالعربي. */
function lateText(min: number): string {
  if (min < 60) return `متأخّر ${toArabicDigits(min)}د`;
  const h = Math.floor(min / 60);
  if (h === 1) return "متأخّر ساعة";
  if (h === 2) return "متأخّر ساعتين";
  if (h <= 10) return `متأخّر ${toArabicDigits(h)} ساعات`;
  return `متأخّر ${toArabicDigits(h)}س`;
}

function StatusIcon({ s }: { s: OwnerFuStatus }) {
  const common = { className: "size-3", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (s === "late") return <svg viewBox="0 0 24 24" {...common}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0M12 9v4M12 17h.01" /></svg>;
  if (s === "soon") return <svg viewBox="0 0 24 24" {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
  if (s === "done") return <svg viewBox="0 0 24 24" {...common}><path d="M20 6 9 17l-5-5" /></svg>;
  return <svg viewBox="0 0 24 24" {...common}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
}

function Card({ r, onOpen }: { r: OwnerFollowupRow; onOpen: () => void }) {
  const meta = STATUS_META[r.status];
  const c = colorFor(r.employeeName ?? r.name);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-4 rounded-3xl px-[19px] py-[17px] text-start transition-colors"
      style={{
        background: r.status === "late" ? "linear-gradient(160deg,rgba(255,122,138,.09),var(--od-raised2))" : "var(--od-raised2)",
        borderInlineStart: `3px solid ${meta.color}`,
        opacity: r.status === "done" ? 0.75 : 1,
      }}
    >
      <span className="w-16 flex-none text-center">
        <span className="block text-xl font-extrabold leading-none text-foreground" style={{ fontFamily: "var(--font-zain), var(--font-sans)" }}>
          {r.timeText}
        </span>
        {r.dayText && <span className="mt-0.5 block text-[10px]" style={{ color: "var(--od-t3)" }}>{r.dayText}</span>}
      </span>
      <span className="flex size-[52px] flex-none items-center justify-center rounded-3xl text-[19px] font-bold text-white" style={{ background: c, fontFamily: "var(--font-zain), var(--font-sans)" }}>
        {r.name.trim().charAt(0)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2.5">
          <span className="text-[16.5px] font-semibold" style={{ color: "var(--od-t1)" }}>{r.name}</span>
          <span className="text-[12.5px]" style={{ color: "var(--od-t2)", fontVariantNumeric: "tabular-nums" }} dir="ltr">{r.phone}</span>
          {r.kind === "visit" && (
            <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "rgba(91,157,239,.14)", color: "var(--od-visit)" }}>زيارة</span>
          )}
        </span>
        {r.note && <span className="mt-[5px] block truncate text-[13.5px] leading-normal" style={{ color: "var(--od-t2)" }}>{r.note}</span>}
        <span className="mt-1.5 flex items-center gap-2">
          {r.employeeName && (
            <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: "var(--od-t3)" }}>
              <span className="size-[7px] rounded-full" style={{ background: c }} aria-hidden />
              {r.employeeName}
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: meta.color }}>
            <StatusIcon s={r.status} />
            {r.status === "late" && r.lateMinutes != null
              ? lateText(r.lateMinutes)
              : r.status === "done" && r.doneTimeText
                ? `تمّت ${r.doneTimeText}`
                : meta.label}
          </span>
        </span>
      </span>
    </button>
  );
}

export function OwnerFollowups({ rows }: { rows: OwnerFollowupRow[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<OwnerFuStatus | "all">("all");

  const counts = useMemo(() => {
    const c: Record<OwnerFuStatus | "all", number> = { all: rows.length, late: 0, soon: 0, next: 0, done: 0 };
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);

  const shown = filter === "all" ? rows : rows.filter((r) => r.status === filter);
  // النهر يتحرك فقط حين توجد كتلة تستحق (٥+) — القليل يُعرض ساكنًا.
  const flowing = shown.length >= 5;

  return (
    <div>
      <div className="mb-3.5 flex flex-wrap gap-[7px]">
        {FILTERS.map((f) => {
          const on = f === filter;
          const meta = f === "all" ? null : STATUS_META[f];
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className="inline-flex items-center gap-1.5 rounded-[18px] px-4 py-2.5 text-[13px] transition-colors"
              style={on
                ? { background: "var(--gold)", color: "#fff" }
                : { background: "var(--od-raised2)", color: meta?.color ?? "var(--od-t2)" }}
            >
              {meta && <StatusIcon s={f as OwnerFuStatus} />}
              {meta?.label ?? "الكل"}
              <span className="font-extrabold" style={{ fontFamily: "var(--font-zain), var(--font-sans)" }}>{toArabicDigits(counts[f])}</span>
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <div className="grid h-40 place-items-center rounded-3xl text-sm" style={{ background: "var(--od-raised2)", color: "var(--od-t3)" }}>
          ما فيه مواعيد بهالفترة
        </div>
      ) : (
        <div
          className="relative overflow-hidden pe-1"
          style={{
            height: flowing ? 660 : "auto",
            maskImage: flowing ? "linear-gradient(to bottom,transparent,#000 6%,#000 94%,transparent)" : undefined,
            WebkitMaskImage: flowing ? "linear-gradient(to bottom,transparent,#000 6%,#000 94%,transparent)" : undefined,
          }}
        >
          <div
            className={flowing ? "od-river absolute inset-x-0 top-0 flex flex-col gap-2.5" : "flex flex-col gap-2.5"}
            style={flowing ? { animationDuration: `${Math.max(30, shown.length * 5)}s` } : undefined}
          >
            {shown.map((r) => (
              <Card key={`${r.leadId}-${r.kind}`} r={r} onOpen={() => router.push(`/leads/${r.leadId}`)} />
            ))}
            {/* نسخة ثانية للحلقة المتصلة — تمرير لا نهائي بلا قفزة. */}
            {flowing && (
              <div className="flex flex-col gap-2.5" aria-hidden>
                {shown.map((r) => (
                  <Card key={`${r.leadId}-${r.kind}-b`} r={r} onOpen={() => router.push(`/leads/${r.leadId}`)} />
                ))}
              </div>
            )}
          </div>
          {/* حركة النهر — تصعد نصف المسافة (طول النسخة الأولى) ثم تلتف */}
          <style>{`
            .od-river{animation-name:odRiverUp;animation-timing-function:linear;animation-iteration-count:infinite}
            .od-river:hover{animation-play-state:paused}
            @keyframes odRiverUp{from{transform:translateY(0)}to{transform:translateY(-50%)}}
            @media (prefers-reduced-motion: reduce){.od-river{animation:none;position:static}}
          `}</style>
        </div>
      )}
    </div>
  );
}
