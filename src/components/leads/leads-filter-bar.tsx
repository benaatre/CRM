"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LeadStage } from "@prisma/client";
import { stageLabels, stageOrder } from "@/lib/labels";
import { toArabicDigits } from "@/lib/format";
import type { LeadFilterValues } from "@/lib/lead-filters";

type Employee = { id: string; name: string };

// مظلّة «مهتم»: كل المتفاعلين (مهتم + زار + تفاوض + موعد لاحق) — الاستعلام يدعم stage IN أصلاً.
const INTEREST_UMBRELLA = ["INTERESTED", "VIEWING", "NEGOTIATION", "FOLLOW_UP_LATER"];

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
  basePath, isManager, employees, filters, preserve = {}, hideUnassignedEmp = false, notContacted,
}: {
  basePath: string;
  isManager: boolean;
  employees: Employee[];
  filters: LeadFilterValues;
  preserve?: Record<string, string>;
  hideUnassignedEmp?: boolean;
  notContacted?: number;
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
    if (stages.length) p.set("stages", stages.join(","));
    const emps = next.emps ?? filters.emps;
    if (emps.length) p.set("emps", emps.join(","));
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
  function toggleInterestUmbrella() {
    // نشطة → أزل الأربع؛ غير نشطة → أضفها للمحدّد الحالي (بلا تكرار، يحفظ أي مراحل أخرى).
    go({
      stages: interestUmbrellaActive
        ? filters.stages.filter((x) => !INTEREST_UMBRELLA.includes(x))
        : [...new Set([...filters.stages, ...INTEREST_UMBRELLA])],
    });
  }
  function toggleEmp(t: string) {
    go({ emps: filters.emps.includes(t) ? filters.emps.filter((x) => x !== t) : [...filters.emps, t] });
  }

  const hasFilters = !!filters.q || filters.stages.length > 0 || filters.emps.length > 0;
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
        </div>
      )}

      {/* فلتر المراحل */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={() => go({ stages: [] })} className={chipAll(filters.stages.length === 0)}>كل المراحل</button>
        {stageOrder.map((s) =>
          s === "INTERESTED" ? (
            // مظلّة شاملة بدل مرحلة حرفية — تفلتر كل المتفاعلين دفعة واحدة.
            <button key={s} onClick={toggleInterestUmbrella} className={chip(interestUmbrellaActive)}>{stageLabels.INTERESTED}</button>
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
        {hasFilters && (
          <button
            onClick={() => { setQLocal(""); startTransition(() => router.push(build({ q: "", stages: [], emps: [] }))); }}
            className="rounded-xl border border-border px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground"
          >مسح الكل</button>
        )}
        {pending && <span className="text-xs text-muted-foreground">جارٍ التحديث…</span>}
      </div>
    </div>
  );
}
