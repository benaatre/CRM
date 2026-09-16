import Link from "next/link";
import { Clock, ChevronLeft, FileText } from "lucide-react";
import { stageLabels } from "@/lib/labels";
import { toArabicDigits } from "@/lib/format";
import type { StaleCounts, StaleRow } from "@/lib/stale-leads";

/**
 * قسم «العملاء الراكدين» — نظير سطح المكتب لكرت الجوال + قائمته (المرحلة ٥).
 * كرت (الإجمالي + الحارّ رقم مستقل + ثلاث خانات تقيس **العمر فقط**: حتى ١٤ يوم ·
 * متروك ١٥–٣٠ · مهجور +٣٠) ثم قائمة بترتيب الإنقاذ (الحارّ أولًا فالأحدث ركودًا).
 * زر واحد «ملف العميل» لكل صف — لا اتصال ولا واتساب (المتابعة تُسجَّل من الملف
 * فيخرج تلقائيًا). ألوان الشارة: حارّ أحمر · عادي كهرماني · مهجور رمادي.
 * عرض خالص بتوكنات الواجهة (Tailwind الدلالية).
 */

const NUM = { fontVariantNumeric: "tabular-nums" as const };

function badgeClass(r: { isHot: boolean; tier: StaleRow["tier"] }): string {
  if (r.isHot) return "bg-destructive/12 text-destructive";
  if (r.tier === "DORMANT") return "bg-muted text-muted-foreground";
  return "bg-warning/12 text-warning";
}

export function EmployeeStale({
  counts, rows, restCount,
}: {
  counts: StaleCounts;
  rows: StaleRow[];
  restCount: number;
}) {
  if (counts.total === 0) return null;
  const cells = [
    { v: counts.tiers.stale, k: "حتى ١٤ يوم", c: "text-warning" },
    { v: counts.tiers.abandoned, k: "متروك ١٥–٣٠", c: "text-gold" },
    { v: counts.tiers.dormant, k: "مهجور +٣٠", c: "text-muted-foreground" },
  ];
  return (
    <section>
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-lg font-semibold text-foreground">العملاء الراكدين</h2>
        <Link href="/leads?stale=1" className="mr-auto flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
          القائمة الكاملة <ChevronLeft className="size-3.5" strokeWidth={1.8} />
        </Link>
      </div>

      {/* الكرت */}
      <div className="rounded-3xl border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-warning/12 text-warning">
            <Clock className="size-5" strokeWidth={1.7} />
          </span>
          <div className="min-w-0">
            <div className="text-sm text-muted-foreground">عملاء راكدين عندك</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {counts.hot > 0
                ? <><b className="font-bold text-destructive" style={NUM}>{toArabicDigits(counts.hot)} حارّ</b> محتاجينك اليوم</>
                : "محتاجين متابعة وانقطعت"}
            </div>
          </div>
          <div className="mr-auto text-center">
            <div className="text-[34px] font-black leading-none text-warning" style={NUM}>{toArabicDigits(counts.total)}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">عميل</div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {cells.map((cell) => (
            <div key={cell.k} className="rounded-2xl bg-muted/40 p-3 text-center">
              <div className={`text-xl font-extrabold ${cell.c}`} style={NUM}>{toArabicDigits(cell.v)}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">{cell.k}</div>
            </div>
          ))}
        </div>
      </div>

      {/* القائمة (ترتيب الإنقاذ) */}
      <div className="mt-3 space-y-2.5">
        {rows.map((r) => {
          const edge = r.isHot ? "var(--destructive)" : r.tier === "DORMANT" ? "var(--muted-foreground)" : "var(--warning)";
          return (
            <div
              key={r.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-border bg-card px-4 py-3"
              style={{ borderInlineStartWidth: 3, borderInlineStartColor: edge }}
            >
              <span className="truncate text-sm font-semibold text-foreground">{r.name}</span>
              <span className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">{stageLabels[r.stage]}</span>
              <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${badgeClass(r)}`} style={NUM}>راكد {toArabicDigits(r.days)} يوم</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {r.reason === "NO_DATE" ? "بلا موعد قادم" : "فات موعده"}{r.lastNote ? ` · ${r.lastNote}` : ""}
              </span>
              <Link
                href={`/leads/${r.id}`}
                className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
              >
                <FileText className="size-3.5" strokeWidth={1.7} /> ملف العميل
              </Link>
            </div>
          );
        })}
        {restCount > 0 && (
          <Link
            href="/leads?stale=1"
            className="flex items-center gap-2 rounded-2xl border border-gold/30 bg-gold/[0.06] px-4 py-3 text-sm font-semibold text-gold hover:bg-gold/10"
          >
            باقي الراكدين عندك
            <span className="mr-auto text-xs font-normal text-muted-foreground" style={NUM}>{toArabicDigits(restCount)} عميل ←</span>
          </Link>
        )}
      </div>
    </section>
  );
}
