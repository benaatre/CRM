import Link from "next/link";
import { SOP } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";
import { avatarInitials } from "@/lib/mobile-avatar";
import type { StaleEmployeeRow } from "@/lib/stale-leads";

/**
 * شيت توزيع الراكد على الموظفين (رئيسية المالك) — مطابق للمعاينة: مرتّب بعدد
 * الحارّ تنازليًا، لكل موظف شريط مقسوم **يقيس العمر فقط** (حتى ١٤ · متروك · مهجور،
 * مجموعه = الإجمالي) + الحارّ رقم أحمر مستقل + النسبة من نشطه + أقدم راكد.
 * الضغط يفتح قائمة راكدي ذلك الموظف. **عرض فقط — بلا سحب ولا إعادة توزيع.**
 * server component عرض خالص.
 */

const ZAIN = { fontFamily: "var(--font-zain), var(--font-sans)", fontVariantNumeric: "tabular-nums" as const };

function pct(a: number, b: number): number {
  return b > 0 ? Math.round((a / b) * 100) : 0;
}

export function StaleDistribution({ rows }: { rows: StaleEmployeeRow[] }) {
  if (!rows.length) return null;
  return (
    <div className="flex flex-col" style={{ gap: 10 }}>
      {rows.map((e) => {
        const segs = [
          { v: e.tiers.stale, c: SOP.amber },
          { v: e.tiers.abandoned, c: SOP.gold },
          { v: e.tiers.dormant, c: SOP.neutral },
        ].filter((s) => s.v > 0);
        return (
          <Link
            key={e.employeeId}
            href={`/m/leads?stale=1&emps=${e.employeeId}`}
            className="m-raise m-press-sc"
            style={{ boxSizing: "border-box", display: "block", borderRadius: 16, padding: "13px 14px" }}
          >
            <div className="flex items-center" style={{ gap: 11 }}>
              <span className="m-inset flex flex-none items-center justify-center" style={{ width: 36, height: 36, borderRadius: 11, ...ZAIN, fontSize: 15, fontWeight: 800, color: SOP.gold }}>
                {avatarInitials(e.employeeName)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate" style={{ fontSize: 13.5, fontWeight: 600, color: SOP.tx }}>{e.employeeName}</div>
                <div style={{ fontSize: 11, color: SOP.mut, marginTop: 2 }}>
                  <span style={ZAIN}>{toArabicDigits(e.total)}</span> راكد من <span style={ZAIN}>{toArabicDigits(e.activeCount)}</span> نشط · <span style={ZAIN}>{toArabicDigits(pct(e.total, e.activeCount))}٪</span> · أقدم <span style={ZAIN}>{toArabicDigits(e.oldest)}</span> يوم
                </div>
              </div>
              <div className="flex-none text-center" style={{ paddingInlineStart: 8 }}>
                <div style={{ ...ZAIN, fontSize: 23, lineHeight: 1, fontWeight: 800, color: SOP.red }}>{toArabicDigits(e.hot)}</div>
                <div style={{ fontSize: 10, color: SOP.mut, marginTop: 3 }}>حارّ</div>
              </div>
            </div>
            {/* الشريط: العمر فقط (مجموع الشرائح = الإجمالي) — الحارّ خارجه */}
            <div className="m-inset flex" style={{ height: 6, borderRadius: 4, marginTop: 12, overflow: "hidden", gap: 2 }}>
              {segs.map((s, i) => (
                <span key={i} style={{ display: "block", height: "100%", width: `${pct(s.v, e.total)}%`, background: s.c }} />
              ))}
            </div>
            <div className="flex flex-wrap" style={{ gap: 13, marginTop: 9, fontSize: 10.5, color: SOP.mut }}>
              <span className="flex items-center" style={{ gap: 5 }}><i style={{ width: 7, height: 7, borderRadius: "50%", background: SOP.amber }} />حتى ١٤ {toArabicDigits(e.tiers.stale)}</span>
              <span className="flex items-center" style={{ gap: 5 }}><i style={{ width: 7, height: 7, borderRadius: "50%", background: SOP.gold }} />متروك {toArabicDigits(e.tiers.abandoned)}</span>
              <span className="flex items-center" style={{ gap: 5 }}><i style={{ width: 7, height: 7, borderRadius: "50%", background: SOP.neutral }} />مهجور {toArabicDigits(e.tiers.dormant)}</span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
