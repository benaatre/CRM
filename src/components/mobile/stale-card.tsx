import { SOP } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";
import type { StaleCounts } from "@/lib/stale-leads";

/**
 * كرت «العملاء الراكدين» المشترك (رئيسية الموظف والمالك) — مطابق للمعاينة:
 * أيقونة ساعة + عنوان + سطر فرعي (الحارّ رقم أحمر مستقل) + الإجمالي الكبير +
 * ثلاث خانات غائرة تقيس **العمر فقط** (حتى ١٤ يوم · متروك ١٥–٣٠ · مهجور +٣٠)
 * ومجموعها = الإجمالي. الحرارة محور مستقل في السطر الفرعي لا شريحة في الخانات.
 * server component عرض خالص.
 */

const ZAIN = { fontFamily: "var(--font-zain), var(--font-sans)", fontVariantNumeric: "tabular-nums" as const };

export function StaleCard({ label, sub, counts }: { label: string; sub: React.ReactNode; counts: StaleCounts }) {
  const cells = [
    { v: counts.tiers.stale, k: "حتى ١٤ يوم", c: SOP.amber },
    { v: counts.tiers.abandoned, k: "متروك ١٥–٣٠", c: SOP.gold },
    { v: counts.tiers.dormant, k: "مهجور +٣٠", c: SOP.neutral },
  ];
  return (
    <div className="m-raise m-rise" style={{ boxSizing: "border-box", padding: "17px 18px", borderRadius: 20 }}>
      <div className="flex items-start" style={{ gap: 12 }}>
        <span className="m-inset flex flex-none items-center justify-center" style={{ width: 38, height: 38, borderRadius: 12, color: SOP.amber }}>
          <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ maxWidth: 20, maxHeight: 20 }}>
            <circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" />
          </svg>
        </span>
        <div className="min-w-0">
          <div style={{ fontSize: 13, color: SOP.tx2 }}>{label}</div>
          <div style={{ fontSize: 11.5, color: SOP.mut, marginTop: 3 }}>{sub}</div>
        </div>
        <div className="flex-none text-center" style={{ marginInlineStart: "auto" }}>
          <div style={{ ...ZAIN, fontSize: 40, fontWeight: 800, lineHeight: 1, color: SOP.amber }}>{toArabicDigits(counts.total)}</div>
          <div style={{ fontSize: 10.5, color: SOP.mut, marginTop: 5 }}>عميل</div>
        </div>
      </div>
      <div className="flex" style={{ gap: 9, marginTop: 15 }}>
        {cells.map((cell) => (
          <div key={cell.k} className="m-inset flex-1 text-center" style={{ boxSizing: "border-box", borderRadius: 12, padding: "10px 6px" }}>
            <div style={{ ...ZAIN, fontSize: 20, fontWeight: 800, lineHeight: 1.2, color: cell.c }}>{toArabicDigits(cell.v)}</div>
            <div style={{ fontSize: 10.5, color: SOP.mut, marginTop: 3 }}>{cell.k}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
