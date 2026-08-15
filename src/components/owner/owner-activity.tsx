import Link from "next/link";
import type { OwnerActivityRow } from "@/lib/data/owner-dashboard";

/**
 * «معدّل النشاط» — act-block من المرجع، تحت الدوام بالعمود الجانبي.
 * العنوان بشرطة زرقاء (يميّزه عن الدوام الذهبي). بيانات حقيقية من نبضة
 * `User.lastSeenAt`: متصل الآن (≤٥ دقائق) · قريب (≤ساعة) · خامل.
 * الشريط تمثيل بصري لحداثة آخر نبضة — لا مقياس «وقت استخدام» بالنظام.
 */

const DOT: Record<OwnerActivityRow["state"], { color: string; glow: boolean }> = {
  online: { color: "var(--od-int)", glow: true },
  recent: { color: "var(--od-try)", glow: false },
  idle: { color: "var(--od-t3)", glow: false },
};

export function OwnerActivity({ rows }: { rows: OwnerActivityRow[] }) {
  return (
    <div className="mt-3.5 rounded-[18px] border p-3.5" style={{ background: "var(--od-raised)", borderColor: "var(--od-hair)" }}>
      <div className="mb-[3px] flex items-center gap-2">
        <span className="h-[18px] w-1 rounded-sm" style={{ background: "var(--od-visit)" }} aria-hidden />
        <span className="text-[15px] font-bold text-foreground">معدّل النشاط</span>
      </div>
      <div className="mb-3.5 ms-3 text-[11px]" style={{ color: "var(--od-t3)" }}>
        نشاط الموظف داخل النظام — متصل = نبضة خلال ٥ دقائق
      </div>

      {rows.map((r) => {
        const dot = DOT[r.state];
        return (
          <div key={r.id} className="flex items-center gap-2.5 border-b px-1.5 py-2.5 last:border-b-0" style={{ borderColor: "var(--od-hair)" }}>
            <span
              className="size-[9px] flex-none rounded-full"
              style={{ background: dot.color, boxShadow: dot.glow ? `0 0 7px ${dot.color}` : undefined }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{r.name}</span>
            <span className="h-[5px] w-[52px] flex-none overflow-hidden rounded-[3px]" style={{ background: "var(--od-raised2)" }}>
              <span className="block h-full rounded-[3px]" style={{ width: `${r.recencyPct}%`, background: dot.color }} />
            </span>
            <span className="w-14 flex-none text-left text-[9.5px]" style={{ color: "var(--od-t3)" }}>{r.agoText}</span>
          </div>
        );
      })}

      <Link href="/admin" className="mt-3 block text-center text-[11.5px] transition-opacity hover:opacity-80" style={{ color: "var(--od-visit)" }}>
        تفاصيل النشاط ←
      </Link>
    </div>
  );
}
