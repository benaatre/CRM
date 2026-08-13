"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { PauseCircle } from "lucide-react";
import { toArabicDigits } from "@/lib/format";
import type { LeadFilterValues } from "@/lib/lead-filters";
import { avatarColor } from "@/lib/mobile-avatar";
import { buildLeadsHref } from "./filters-url";

type Tab = "working" | "archived" | "hidden" | "unassigned";
type Employee = { id: string; name: string };
/** حمل الموظف من getEmployeeLoads — الموقوف عن الاستقبال غائب عن هذه القائمة أصلًا. */
export type EmployeeLoad = { id: string; count: number };

const NUM: React.CSSProperties = { fontFamily: "var(--font-zain), var(--font-sans)", fontVariantNumeric: "tabular-nums", fontWeight: 700 };

/**
 * شريط الفريق الأفقي فوق جدول المالك — كل موظف بنقطة لونه وعدد عملائه، ونقرة
 * تفلتر عملاءه. يفلتر بنفس بارامتر `emps` القائم في الرابط (لا مفتاح جديد).
 *
 * للمالك/المدير وحده: الصفحة لا تمرّر قائمة الموظفين ولا أحمالهم للموظف أصلًا
 * (كلاهما خلف شرط الدور على الخادم) — فالشريط لا يُبنى له.
 *
 * «موقوف الاستقبال»: getEmployeeLoads يستثني الموقوفين من قائمته، فالموظف
 * الموجود في الروستر والغائب عن الأحمال = موقوف — علامة هادئة بلا رقم، حتى
 * يعرف المالك من لا يستقبل توزيعًا. اشتقاق من استدعاءين قائمين بلا أي استعلام.
 */
export function EmployeeStrip({
  basePath, tab, employees, loads, filters, total, showCounts,
}: {
  basePath: string;
  tab: Tab;
  employees: Employee[];
  loads: EmployeeLoad[];
  filters: LeadFilterValues;
  /** عدد عملاء التبويب كله — رقم شريحة «كل الموظفين». */
  total?: number;
  /**
   * الأرقام في «جاري العمل» فقط: حمل الموظف يقيس عملاءه غير المؤرشفين، فلا
   * يصف تبويبي «محجوز» و«مؤرشف» — والقاعدة المعتمدة: رقم كاذب أسوأ من لا رقم.
   * (علامة «موقوف الاستقبال» تبقى في كل التبويبات — صفة موظف لا عدّاد تبويب.)
   */
  showCounts: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const loadById = new Map(loads.map((l) => [l.id, l.count]));

  function go(next: Partial<LeadFilterValues>) {
    startTransition(() => router.push(buildLeadsHref(basePath, tab, filters, next)));
  }
  function toggle(id: string) {
    go({ emps: filters.emps.includes(id) ? filters.emps.filter((x) => x !== id) : [...filters.emps, id] });
  }

  if (employees.length === 0) return null;
  const allActive = filters.emps.length === 0;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => go({ emps: [] })}
        aria-pressed={allActive}
        className={`flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] transition-colors ${
          allActive ? "bg-gold/10 font-semibold text-gold" : "bg-[var(--elev)] text-muted-foreground hover:bg-[var(--elev-hover)] hover:text-foreground"
        }`}
      >
        كل الموظفين
        {showCounts && total !== undefined && <span className="text-[12.5px] opacity-80" style={NUM}>{toArabicDigits(total)}</span>}
      </button>

      {employees.map((e) => {
        const on = filters.emps.includes(e.id);
        const count = loadById.get(e.id);
        const paused = count === undefined; // غائب عن الأحمال ⟵ موقوف عن الاستقبال
        return (
          <button
            key={e.id}
            type="button"
            onClick={() => toggle(e.id)}
            aria-pressed={on}
            title={paused ? `${e.name} — موقوف عن استقبال التوزيع` : e.name}
            className={`flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] transition-colors ${
              on ? "bg-gold/10 font-semibold text-gold" : "bg-[var(--elev)] text-muted-foreground hover:bg-[var(--elev-hover)] hover:text-foreground"
            }`}
          >
            <span aria-hidden className="size-2 flex-none rounded-full" style={{ background: avatarColor(e.id), opacity: on ? 1 : 0.75 }} />
            <span className="max-w-[9rem] truncate">{e.name}</span>
            {paused ? (
              <PauseCircle className="size-3.5 flex-none opacity-70" strokeWidth={1.6} aria-label="موقوف عن الاستقبال" />
            ) : showCounts ? (
              <span className="text-[12.5px] opacity-80" style={NUM}>{toArabicDigits(count)}</span>
            ) : null}
          </button>
        );
      })}

      {pending && <span className="text-[12.5px] text-muted-foreground/70">جارٍ التحديث…</span>}
    </div>
  );
}
