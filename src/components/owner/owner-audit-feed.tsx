"use client";

import { useRouter } from "next/navigation";
import type { OwnerAuditKind, OwnerAuditRow } from "@/lib/data/owner-dashboard";

/**
 * «سجل التدقيق» الحي — بطاقة acard من المرجع: صفوف بحافة يمنى ملوّنة بنوع
 * العملية، شارة + الموظف ثم العميل وجواله ثم الوصف، والوقت النسبي يسارًا.
 * النقر (بمعرّف مؤكد فقط) يفتح ملف العميل. البث عبر AutoRefresh في اللوحة الأم.
 */

const KIND_COLOR: Record<OwnerAuditKind, string> = {
  visit: "var(--od-visit)",
  nego: "var(--od-nego)",
  call: "var(--od-later)",
  won: "var(--od-won)",
  pull: "var(--od-red)",
  crit: "var(--od-red)",
  newlead: "var(--gold)",
  booking: "var(--od-try)",
  interested: "var(--od-int)",
  followup: "var(--gold)",
  admin: "var(--od-new)",
  other: "var(--od-new)",
};

function KindIcon({ kind }: { kind: OwnerAuditKind }) {
  const p: Record<OwnerAuditKind, string> = {
    visit: "M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0M12 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4",
    nego: "M17 8h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h2M9 8V6a3 3 0 0 1 6 0v2M9 13h6",
    call: "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.5 2.8.7a2 2 0 0 1 1.8 2z",
    won: "M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4L12 14l-3-3",
    pull: "M12 5v14M19 12l-7 7-7-7",
    crit: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0M12 9v4M12 17h.01",
    newlead: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M19 8v6M22 11h-6",
    booking: "M20 7h-9M14 17H5M17 3l3 3-3 3M7 21l-3-3 3-3",
    interested: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.3l7.8-7.8 1-1.1a5.5 5.5 0 0 0 0-7.8z",
    followup: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
    admin: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
    other: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z",
  };
  return (
    <svg viewBox="0 0 24 24" className="size-[21px]" fill="none" stroke="currentColor"
      strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={p[kind]} />
    </svg>
  );
}

export function OwnerAuditFeed({ rows }: { rows: OwnerAuditRow[] }) {
  const router = useRouter();
  return (
    <div className="rounded-[28px] p-[22px]" style={{ background: "var(--od-raised)" }}>
      <div className="mb-[3px] flex items-center gap-2 text-lg font-bold text-foreground">
        سجل التدقيق
        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold" style={{ background: "rgba(52,212,148,.13)", color: "var(--od-won)" }}>
          <span className="size-1.5 animate-pulse rounded-full" style={{ background: "var(--od-won)" }} aria-hidden />
          مباشر
        </span>
      </div>
      <div className="mb-[18px] text-[13px]" style={{ color: "var(--od-t3)" }}>
        آخر العمليات · اضغط لفتح ملف العميل
      </div>

      <div className="flex max-h-[660px] flex-col gap-[9px] overflow-y-auto pe-1">
        {rows.length === 0 && (
          <div className="grid h-28 place-items-center text-sm" style={{ color: "var(--od-t3)" }}>ما فيه عمليات مسجّلة</div>
        )}
        {rows.map((r) => {
          const c = KIND_COLOR[r.kind];
          const clickable = r.leadId !== null;
          return (
            <button
              key={r.id}
              type="button"
              disabled={!clickable}
              onClick={() => clickable && router.push(`/leads/${r.leadId}`)}
              className="flex items-start gap-[13px] rounded-3xl px-4 py-[15px] text-start transition-colors enabled:hover:-translate-x-0.5 disabled:cursor-default"
              style={{ background: "var(--od-raised2)", borderInlineStart: `3px solid ${c}` }}
            >
              <span className="flex size-[42px] flex-none items-center justify-center rounded-[20px]" style={{ background: `color-mix(in srgb, ${c} 14%, transparent)`, color: c }}>
                <KindIcon kind={r.kind} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="whitespace-nowrap rounded-[14px] px-2.5 py-[3px] text-[11.5px] font-semibold" style={{ background: `color-mix(in srgb, ${c} 14%, transparent)`, color: c }}>
                    {r.badge}
                  </span>
                  {r.employeeName && <span className="text-[13px] font-semibold" style={{ color: "var(--od-t1)" }}>{r.employeeName}</span>}
                </span>
                {r.clientName && (
                  <span className="mt-[5px] block text-[14.5px] font-semibold" style={{ color: "var(--od-t1)" }}>
                    {r.clientName}
                    {r.clientPhone && (
                      <span className="ms-2 text-[11px] font-normal" style={{ color: "var(--od-t3)", fontVariantNumeric: "tabular-nums" }} dir="ltr">
                        {r.clientPhone}
                      </span>
                    )}
                  </span>
                )}
                <span className="mt-1 block text-[12.5px] leading-relaxed" style={{ color: "var(--od-t2)" }}>{r.desc}</span>
              </span>
              <span className="flex flex-none flex-col items-end gap-1.5 text-[11px]" style={{ color: "var(--od-t3)" }}>
                {r.whenText}
                {clickable && (
                  <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" aria-hidden>
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
