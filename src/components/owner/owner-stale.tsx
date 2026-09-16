import Link from "next/link";
import { stageLabels } from "@/lib/labels";
import { toArabicDigits } from "@/lib/format";
import { SecHeader } from "./owner-dashboard";
import type { StaleCounts, StaleRow, StaleEmployeeRow } from "@/lib/stale-leads";

/**
 * قسم «العملاء الراكدين» بلوحة المالك (سطح المكتب — المرحلة ٥): كرت الفريق +
 * قائمة أقدم الحارّ (مع اسم الموظف) + شيت التوزيع على الموظفين. عرض فقط — بلا
 * سحب ولا إعادة توزيع. بتوكنات od-scope (SOP v2): الشريط يقيس **العمر فقط**
 * (حتى ١٤ · متروك · مهجور) والحارّ رقم أحمر مستقل. زر واحد «ملف العميل».
 */

const ZNUM: React.CSSProperties = { fontFamily: "var(--font-zain), var(--font-sans)", fontVariantNumeric: "tabular-nums" };

function heat(r: { isHot: boolean; tier: StaleRow["tier"] }): string {
  return r.isHot ? "var(--red)" : r.tier === "DORMANT" ? "var(--neutral)" : "var(--amber)";
}
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

export function OwnerStale({
  counts, rows, restCount, dist, activeTotal,
}: {
  counts: StaleCounts;
  rows: StaleRow[];
  restCount: number;
  dist: StaleEmployeeRow[];
  activeTotal: number;
}) {
  if (counts.total === 0) return null;
  const cells = [
    { v: counts.tiers.stale, k: "حتى ١٤ يوم", c: "var(--amber)" },
    { v: counts.tiers.abandoned, k: "متروك ١٥–٣٠", c: "var(--gold)" },
    { v: counts.tiers.dormant, k: "مهجور +٣٠", c: "var(--neutral)" },
  ];
  return (
    <div className="od-su" style={{ animationDelay: "195ms" }}>
      <SecHeader title="العملاء الراكدين">
        <Link href="/leads?stale=1" className="mr-auto text-xs font-normal" style={{ color: "var(--mut)" }}>القائمة الكاملة ←</Link>
      </SecHeader>

      {/* الكرت */}
      <div className="sop-raise rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <span className="sop-inset flex size-10 items-center justify-center rounded-xl" style={{ color: "var(--amber)" }}>
            <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ maxWidth: 20, maxHeight: 20 }}>
              <circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" />
            </svg>
          </span>
          <div className="min-w-0">
            <div className="text-sm" style={{ color: "var(--tx2)" }}>عملاء راكدين</div>
            <div className="mt-0.5 text-xs" style={{ color: "var(--mut)" }}>
              <b style={{ ...ZNUM, color: "var(--red)", fontWeight: 700 }}>{toArabicDigits(counts.hot)} حارّ</b>
              {" "}· <span style={ZNUM}>{toArabicDigits(pct(counts.total, activeTotal))}٪</span> من الخط النشط
            </div>
          </div>
          <div className="mr-auto text-center">
            <div className="text-[34px] font-black leading-none" style={{ ...ZNUM, color: "var(--amber)" }}>{toArabicDigits(counts.total)}</div>
            <div className="mt-1 text-[11px]" style={{ color: "var(--mut)" }}>عميل</div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {cells.map((cell) => (
            <div key={cell.k} className="sop-inset rounded-xl p-3 text-center">
              <div className="text-xl font-extrabold" style={{ ...ZNUM, color: cell.c }}>{toArabicDigits(cell.v)}</div>
              <div className="mt-1 text-[11px]" style={{ color: "var(--mut)" }}>{cell.k}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 grid items-start gap-4 2xl:grid-cols-2">
        {/* أقدم الحارّ في الفريق (مع اسم الموظف) */}
        <div>
          <div className="mb-2 px-1 text-xs font-semibold" style={{ color: "var(--tx2)" }}>أقدم الحارّ في الفريق</div>
          <div className="space-y-2.5">
            {rows.map((r) => (
              <div
                key={r.id}
                className="sop-raise-sm flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl px-4 py-3"
                style={{ borderInlineStart: `3px solid ${heat(r)}` }}
              >
                <span className="truncate text-sm font-semibold" style={{ color: "var(--tx)" }}>{r.name}</span>
                <span className="rounded-md px-2 py-0.5 text-[11px]" style={{ border: "1px solid var(--edge-2)", background: "var(--plane-hi)", color: "var(--tx2)" }}>{stageLabels[r.stage]}</span>
                <span className="rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ ...ZNUM, background: "color-mix(in srgb, " + heat(r) + " 14%, transparent)", color: heat(r) }}>راكد {toArabicDigits(r.days)} يوم</span>
                <span className="min-w-0 flex-1 truncate text-xs" style={{ color: "var(--mut)" }}>
                  {r.employeeName ? `عند ${r.employeeName}` : ""}{r.lastNote ? ` · ${r.lastNote}` : ""}
                </span>
                <Link href={`/leads/${r.id}`} className="n-btn rounded-xl px-3 py-1.5 text-xs font-semibold" style={{ color: "var(--tx2)" }}>ملف العميل</Link>
              </div>
            ))}
            {restCount > 0 && (
              <Link href="/leads?stale=1" className="flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold" style={{ border: "1px solid var(--gold-a25)", background: "var(--gold-glow)", color: "var(--gold)" }}>
                باقي الراكدين في الفريق
                <span className="mr-auto text-xs font-normal" style={{ ...ZNUM, color: "var(--tx2)" }}>{toArabicDigits(restCount)} عميل ←</span>
              </Link>
            )}
          </div>
        </div>

        {/* شيت التوزيع على الموظفين — مرتّب بالحارّ، عرض فقط */}
        <div>
          <div className="mb-2 flex items-baseline gap-2 px-1">
            <span className="text-xs font-semibold" style={{ color: "var(--tx2)" }}>الراكد حسب الموظف</span>
            <span className="text-[11px]" style={{ color: "var(--mut)" }}>اضغط الموظف تشوف قائمته</span>
          </div>
          <div className="space-y-2.5">
            {dist.map((e) => {
              const segs = [
                { v: e.tiers.stale, c: "var(--amber)" },
                { v: e.tiers.abandoned, c: "var(--gold)" },
                { v: e.tiers.dormant, c: "var(--neutral)" },
              ].filter((s) => s.v > 0);
              return (
                <Link key={e.employeeId} href={`/leads?stale=1&emps=${e.employeeId}`} className="sop-raise-sm n-btn block rounded-2xl px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold" style={{ color: "var(--tx)" }}>{e.employeeName}</div>
                      <div className="mt-0.5 text-[11px]" style={{ color: "var(--mut)" }}>
                        <span style={ZNUM}>{toArabicDigits(e.total)}</span> راكد من <span style={ZNUM}>{toArabicDigits(e.activeCount)}</span> نشط · <span style={ZNUM}>{toArabicDigits(pct(e.total, e.activeCount))}٪</span> · أقدم <span style={ZNUM}>{toArabicDigits(e.oldest)}</span> يوم
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-extrabold leading-none" style={{ ...ZNUM, color: "var(--red)" }}>{toArabicDigits(e.hot)}</div>
                      <div className="mt-1 text-[10px]" style={{ color: "var(--mut)" }}>حارّ</div>
                    </div>
                  </div>
                  <div className="sop-inset mt-3 flex h-1.5 gap-0.5 overflow-hidden rounded-full">
                    {segs.map((s, i) => <span key={i} style={{ display: "block", height: "100%", width: `${pct(s.v, e.total)}%`, background: s.c }} />)}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
