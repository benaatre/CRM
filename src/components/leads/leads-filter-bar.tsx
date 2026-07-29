"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LeadStage } from "@prisma/client";
import { stageLabels, stageOrder } from "@/lib/labels";
import { toArabicDigits } from "@/lib/format";
import { DEFAULT_LEAD_SORT, INTEREST_UMBRELLA, VISIT_FILTER_STAGES, collapseStagesParam } from "@/lib/lead-filters";
import type { LeadFilterValues, LeadSort } from "@/lib/lead-filters";

type Employee = { id: string; name: string };

// خيارات الترتيب (لهجة سعودية) — بترتيب العرض في القائمة.
const SORT_OPTIONS: { value: LeadSort; label: string }[] = [
  { value: "activity", label: "الأحدث نشاطًا" },
  { value: "newest", label: "الأحدث إضافةً" },
  { value: "oldest", label: "الأقدم إضافةً" },
  { value: "name", label: "حسب الاسم" },
];

// مظلّة «مهتم»: المصدر الواحد في lead-filters.ts (type-only على Prisma — آمنة لحزمة العميل).

// عنصر مختار: أخضر #22c55e بخلفية خضراء شفافة. غير مختار: رمادي محايد.
function chip(active: boolean) {
  return `rounded-full border px-3 py-1.5 text-xs transition-colors ${active ? "border-[#22c55e] bg-[#22c55e]/15 text-[#22c55e]" : "border-border text-muted-foreground hover:text-foreground"}`;
}
// زر «الكل»: ذهبي #CBA45E عند تفعيله (لا فلتر محدّد).
function chipAll(active: boolean) {
  return `rounded-full border px-3 py-1.5 text-xs transition-colors ${active ? "border-gold bg-gold/15 text-gold" : "border-border text-muted-foreground hover:text-foreground"}`;
}

/**
 * شريط فلاتر العملاء المشترك (المراحل + الموظفين + البحث + مسح الكل) — server-side عبر الرابط.
 * يُستخدم في جدول العملاء والكانبان بنفس المنطق تمامًا.
 * preserve: بارامترات تُحفظ في الرابط (مثل tab).
 */
export function LeadsFilterBar({
  basePath, isManager, employees, filters, preserve = {}, hideUnassignedEmp = false, notContacted, unresponsive, bankCheck, visitCount,
}: {
  basePath: string;
  isManager: boolean;
  employees: Employee[];
  filters: LeadFilterValues;
  preserve?: Record<string, string>;
  hideUnassignedEmp?: boolean;
  notContacted?: number;
  /** عدد «لم يستجب ×N» — يظهر الفلتر للمالك/المدير فقط عند تمريره. */
  unresponsive?: number;
  /** عدد «حسبة البنك» (آخر متابعة BANK_CHECK) — الفلتر للجميع ضمن صلاحيته. */
  bankCheck?: number;
  /** عدد عملاء مرحلتي الزيارة معًا — رقم شريحة «زيارة» الموحّدة (اختياري). */
  visitCount?: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [qLocal, setQLocal] = useState(filters.q);

  useEffect(() => { setQLocal(filters.q); }, [filters.q]);

  function build(next: Partial<LeadFilterValues>) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(preserve)) if (v) p.set(k, v);
    const q = next.q ?? filters.q;
    if (q) p.set("q", q);
    const stages = next.stages ?? filters.stages;
    if (stages.length) p.set("stages", collapseStagesParam(stages).join(",")); // زوج الزيارة ⟵ "visit"
    const emps = next.emps ?? filters.emps;
    if (emps.length) p.set("emps", emps.join(","));
    const sort = next.sort ?? filters.sort;
    if (sort && sort !== DEFAULT_LEAD_SORT) p.set("sort", sort); // نظافة الرابط
    const nr = next.nr ?? filters.nr;
    if (nr) p.set("nr", "1"); // فلتر «لم يستجب»
    const tr = next.tr ?? filters.tr;
    if (tr) p.set("tr", "1"); // فلتر «محوَّل» (المحوّلون بالبيانات)
    const bank = next.bank ?? filters.bank;
    if (bank) p.set("bank", "1"); // فلتر «حسبة البنك» (آخر متابعة BANK_CHECK)
    const s = p.toString();
    return s ? `${basePath}?${s}` : basePath;
  }
  function go(next: Partial<LeadFilterValues>) {
    startTransition(() => router.push(build(next)));
  }

  useEffect(() => {
    const t = setTimeout(() => { if (qLocal !== filters.q) go({ q: qLocal }); }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qLocal]);

  function toggleStage(s: string) {
    go({ stages: filters.stages.includes(s) ? filters.stages.filter((x) => x !== s) : [...filters.stages, s] });
  }
  // مظلّة «مهتم» نشطة فقط لمّا تكون المراحل الأربع كلها محدّدة (يميّزها عن ضغط زر فرعي واحد).
  const interestUmbrellaActive = INTEREST_UMBRELLA.every((s) => filters.stages.includes(s));
  // فلتر «زيارة» الموحّد: المرحلتان تُضافان وتُزالان معًا دائمًا (الرابط يحملهما كـ"visit").
  const visitFilterActive = VISIT_FILTER_STAGES.every((s) => filters.stages.includes(s));
  function toggleVisitFilter() {
    go({
      stages: visitFilterActive
        ? filters.stages.filter((x) => !(VISIT_FILTER_STAGES as string[]).includes(x))
        : [...new Set([...filters.stages, ...VISIT_FILTER_STAGES])],
    });
  }
  function toggleInterestUmbrella() {
    // نشطة → أزل الأربع؛ غير نشطة → أضفها للمحدّد الحالي (بلا تكرار، يحفظ أي مراحل أخرى).
    go({
      stages: interestUmbrellaActive
        ? filters.stages.filter((x) => !(INTEREST_UMBRELLA as string[]).includes(x))
        : [...new Set([...filters.stages, ...INTEREST_UMBRELLA])],
    });
  }
  function toggleEmp(t: string) {
    go({ emps: filters.emps.includes(t) ? filters.emps.filter((x) => x !== t) : [...filters.emps, t] });
  }

  const hasFilters = !!filters.q || filters.stages.length > 0 || filters.emps.length > 0 || filters.nr || filters.tr || filters.bank;
  const notContactedActive = filters.stages.length === 1 && filters.stages[0] === "NEW";

  return (
    <div className="space-y-3">
      {/* فلتر «لم يتم التواصل» — أحمر مع العدد */}
      {notContacted != null && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => go({ stages: notContactedActive ? [] : ["NEW"] })}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${notContactedActive ? "border-destructive bg-destructive/20 text-destructive" : "border-destructive/40 text-destructive hover:bg-destructive/10"}`}
          >
            لم يتم التواصل <span className="font-bold">({toArabicDigits(notContacted)})</span>
          </button>
          {/* فلتر «لم يستجب ×N» — مهتمون تراكمت عليهم متابعات «لم يستجب» (مالك/مدير فقط) */}
          {isManager && unresponsive != null && (
            <button
              onClick={() => go({ nr: !filters.nr })}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${filters.nr ? "border-warning bg-warning/20 text-warning" : "border-warning/40 text-warning hover:bg-warning/10"}`}
            >
              لم يستجب <span className="font-bold">×{toArabicDigits(unresponsive)}</span>
            </button>
          )}
          {/* فلتر «محوَّل» — المحوّلون يدويًا «بالبيانات» فقط (كجديد لا يظهر — لا يُميَّز عن الجديد) */}
          <button
            onClick={() => go({ tr: !filters.tr })}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${filters.tr ? "border-warning bg-warning/20 text-warning" : "border-warning/40 text-warning hover:bg-warning/10"}`}
          >
            ⇄ محوَّل
          </button>
          {/* فلتر «حسبة البنك» — آخر متابعة BANK_CHECK (للجميع ضمن صلاحيته) */}
          {bankCheck != null && (
            <button
              onClick={() => go({ bank: !filters.bank })}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${filters.bank ? "border-info bg-info/20 text-info" : "border-info/40 text-info hover:bg-info/10"}`}
            >
              حسبة البنك <span className="font-bold">({toArabicDigits(bankCheck)})</span>
            </button>
          )}
        </div>
      )}

      {/* فلتر المراحل — «زيارة» شريحة واحدة لمرحلتي الزيارة (كل صف يعرض مرحلته الفعلية) */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={() => go({ stages: [] })} className={chipAll(filters.stages.length === 0)}>كل المراحل</button>
        {stageOrder.map((s) =>
          s === "INTERESTED" ? (
            // مظلّة شاملة بدل مرحلة حرفية — تفلتر كل المتفاعلين دفعة واحدة.
            <button key={s} onClick={toggleInterestUmbrella} className={chip(interestUmbrellaActive)}>{stageLabels.INTERESTED}</button>
          ) : s === "VIEWING" ? null // مدموجة في شريحة «زيارة» الموحّدة
            : s === "VISIT_SCHEDULED" ? (
              <button key="visit-united" onClick={toggleVisitFilter} className={chip(visitFilterActive)}>
                زيارة{visitCount != null ? ` (${toArabicDigits(visitCount)})` : ""}
              </button>
            ) : (
              <button key={s} onClick={() => toggleStage(s)} className={chip(filters.stages.includes(s))}>{stageLabels[s as LeadStage]}</button>
            )
        )}
      </div>

      {/* فلتر الموظفين (للمدير) */}
      {isManager && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={() => go({ emps: [] })} className={chipAll(filters.emps.length === 0)}>كل الموظفين</button>
          {employees.map((e) => (
            <button key={e.id} onClick={() => toggleEmp(e.id)} className={chip(filters.emps.includes(e.id))}>{e.name}</button>
          ))}
          {!hideUnassignedEmp && (
            <button onClick={() => toggleEmp("none")} className={chip(filters.emps.includes("none"))}>غير موزّع</button>
          )}
        </div>
      )}

      {/* البحث + مسح الكل */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <input value={qLocal} onChange={(e) => setQLocal(e.target.value)} placeholder="ابحث بالاسم أو الجوال…" className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none focus:border-gold" />
        </div>
        {/* الترتيب */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">الترتيب:</span>
          <select value={filters.sort} onChange={(e) => go({ sort: e.target.value as LeadSort })} className="select-base w-auto" aria-label="ترتيب القائمة">
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        {hasFilters && (
          <button
            onClick={() => { setQLocal(""); startTransition(() => router.push(build({ q: "", stages: [], emps: [], nr: false, tr: false, bank: false }))); }}
            className="rounded-xl border border-border px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground"
          >مسح الكل</button>
        )}
        {pending && <span className="text-xs text-muted-foreground">جارٍ التحديث…</span>}
      </div>
    </div>
  );
}
