"use client";

import { toArabicDigits } from "@/lib/format";

/**
 * منتقي وقت 12 ساعة بـ«ص/م» — المكوّن الموحّد للنظام (قرار 2026-08-20):
 * يُمنع ظهور 17:00 وأمثالها في أي إدخال وقت. القيمة الداخلية تبقى "HH:mm"
 * (24س) حفاظًا على كل مسارات الحفظ القائمة (parseRiyadhLocal وأخواتها).
 */

const H12 = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

function split(v: string): { h24: number; m: number } {
  const [h, m] = v.split(":").map(Number);
  return { h24: Number.isFinite(h) ? h! : 9, m: Number.isFinite(m) ? m! : 0 };
}
function join(h12: number, m: number, pm: boolean): string {
  const h24 = pm ? (h12 % 12) + 12 : h12 % 12;
  return `${String(h24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const selCls =
  "rounded-lg border border-border bg-background px-2 py-2 text-sm text-foreground outline-none focus:border-gold";

/** وقت فقط — value/onChange بصيغة "HH:mm" (24س داخليًا، عرض ١٢س). */
export function Time12({
  value,
  onChange,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const { h24, m } = split(value || "09:00");
  const pm = h24 >= 12;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const minutes = [...new Set([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, m])].sort((a, b) => a - b);
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`} dir="rtl">
      <select className={selCls} value={h12} onChange={(e) => onChange(join(Number(e.target.value), m, pm))} aria-label="الساعة">
        {H12.map((h) => (
          <option key={h} value={h}>{toArabicDigits(h)}</option>
        ))}
      </select>
      <span className="text-muted-foreground">:</span>
      <select className={selCls} value={m} onChange={(e) => onChange(join(h12, Number(e.target.value), pm))} aria-label="الدقائق">
        {minutes.map((mm) => (
          <option key={mm} value={mm}>{toArabicDigits(String(mm).padStart(2, "0"))}</option>
        ))}
      </select>
      <span className="inline-flex overflow-hidden rounded-lg border border-border">
        {([["ص", false], ["م", true]] as const).map(([label, isPm]) => (
          <button
            key={label}
            type="button"
            onClick={() => onChange(join(h12, m, isPm))}
            className={`px-2.5 py-2 text-xs font-bold transition-colors ${pm === isPm ? "bg-gold text-background" : "bg-background text-muted-foreground"}`}
          >
            {label}
          </button>
        ))}
      </span>
    </span>
  );
}

/** تاريخ + وقت ١٢س — بديل datetime-local، القيمة "YYYY-MM-DDTHH:mm" كما هي. */
export function DateTime12({
  value,
  onChange,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const [d = "", t = ""] = (value || "").split("T");
  const today = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
  return (
    <span className={`flex flex-wrap items-center gap-2 ${className}`} dir="rtl">
      <input
        type="date"
        value={d}
        onChange={(e) => onChange(`${e.target.value}T${t || "09:00"}`)}
        dir="ltr"
        className={selCls}
      />
      <Time12 value={t || "09:00"} onChange={(nt) => onChange(`${d || today()}T${nt}`)} />
    </span>
  );
}
