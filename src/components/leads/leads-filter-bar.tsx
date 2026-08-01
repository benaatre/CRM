"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LeadStage } from "@prisma/client";
import { stageLabels, stageOrder } from "@/lib/labels";
import { toArabicDigits } from "@/lib/format";
import { DEFAULT_LEAD_SORT, INTEREST_UMBRELLA, VISIT_FILTER_STAGES, collapseStagesParam, dateRangeApplies } from "@/lib/lead-filters";
import type { LeadFilterValues, LeadSort } from "@/lib/lead-filters";
import { stageFilterChip, toneFilterChip, WAITING_TONE, BANK_TONE, STAGE_TONES } from "@/lib/stage-colors";
import { FilterChip } from "./filter-chip";
import { DateRangeChip } from "./date-range-chip";

type Employee = { id: string; name: string };

// خيارات الترتيب (لهجة سعودية) — بترتيب العرض في القائمة.
const SORT_OPTIONS: { value: LeadSort; label: string }[] = [
  { value: "activity", label: "الأحدث نشاطًا" },
  { value: "newest", label: "الأحدث إضافةً" },
  { value: "oldest", label: "الأقدم إضافةً" },
  { value: "name", label: "حسب الاسم" },
];

// مظلّة «مهتم»: المصدر الواحد في lead-filters.ts (type-only على Prisma — آمنة لحزمة العميل).

// عنصر مختار: أخضر هادئ بخلفية أصلب وحد واضح (نفس روح stage-colors). غير مختار: رمادي محايد.
function chip(active: boolean) {
  return `rounded-full border px-3 py-1.5 text-xs transition-colors ${active ? "border-green-400 bg-green-500/25 text-green-200" : "border-border text-muted-foreground hover:text-foreground"}`;
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
  basePath, isManager, employees, filters, preserve = {}, hideUnassignedEmp = false, notContacted, waiting, bankCheck, visitCount, showDateRange = false,
}: {
  basePath: string;
  isManager: boolean;
  employees: Employee[];
  filters: LeadFilterValues;
  preserve?: Record<string, string>;
  hideUnassignedEmp?: boolean;
  notContacted?: number;
  /** عدد «في الانتظار» (آخر متابعة لم يستجب/في الانتظار) — الفلتر للجميع ضمن صلاحيته. */
  waiting?: number;
  /** عدد «حسبة البنك» (آخر متابعة BANK_CHECK) — الفلتر للجميع ضمن صلاحيته. */
  bankCheck?: number;
  /** عدد عملاء مرحلتي الزيارة معًا — رقم شريحة «زيارة» الموحّدة (اختياري). */
  visitCount?: number;
  /** يعرض شريط النطاق الزمني مع فلتر «زيارة»/«موعد لاحق» — قائمة العملاء فقط (لا الكانبان). */
  showDateRange?: boolean;
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
    const wait = next.wait ?? filters.wait;
    if (wait) p.set("wait", "1"); // فلتر «في الانتظار»
    const tr = next.tr ?? filters.tr;
    if (tr) p.set("tr", "1"); // فلتر «محوَّل» (المحوّلون بالبيانات)
    const bank = next.bank ?? filters.bank;
    if (bank) p.set("bank", "1"); // فلتر «حسبة البنك» (آخر متابعة BANK_CHECK)
    // النطاق الزمني — يُحمل فقط ما دام فلتر «زيارة»/«موعد لاحق» مفعّلًا (يتصفّر مع إلغائه).
    if (dateRangeApplies(stages)) {
      const range = next.range ?? filters.range;
      const from = next.from ?? filters.from;
      const to = next.to ?? filters.to;
      if (range) p.set("range", range);
      else { if (from) p.set("from", from); if (to) p.set("to", to); }
    }
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

  const hasFilters = !!filters.q || filters.stages.length > 0 || filters.emps.length > 0 || filters.wait || filters.tr || filters.bank;
  // شريط النطاق الزمني: يظهر مع فلتر «زيارة» (على موعد الزيارة) أو «موعد لاحق» (على موعد المتابعة).
  const dateRangeOn = showDateRange && dateRangeApplies(filters.stages);
  const customRangeActive = !filters.range && (!!filters.from || !!filters.to);
  const notContactedActive = filters.stages.length === 1 && filters.stages[0] === "NEW";

  return (
    <div className="space-y-3">
      {/* فلتر «لم يتم التواصل» — أحمر مع العدد */}
      {notContacted != null && (
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip
            active={notContactedActive}
            onClick={() => go({ stages: notContactedActive ? [] : ["NEW"] })}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${notContactedActive ? "border-destructive bg-destructive/25 text-destructive" : "border-destructive/30 text-destructive/70 hover:bg-destructive/10 hover:text-destructive"}`}
          >
            لم يتم التواصل <span className="font-bold">({toArabicDigits(notContacted)})</span>
          </FilterChip>
          {/* فلتر «محوَّل» — المحوّلون يدويًا «بالبيانات» فقط (كجديد لا يظهر — لا يُميَّز عن الجديد) */}
          <FilterChip
            active={filters.tr}
            onClick={() => go({ tr: !filters.tr })}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${filters.tr ? "border-warning bg-warning/25 text-warning" : "border-warning/30 text-warning/70 hover:bg-warning/10 hover:text-warning"}`}
          >
            ⇄ محوَّل
          </FilterChip>
          {/* فلتر «حسبة البنك» — ذهبي من المصدر الموحّد (للجميع ضمن صلاحيته) */}
          {bankCheck != null && (
            <FilterChip active={filters.bank} onClick={() => go({ bank: !filters.bank })} className={toneFilterChip(BANK_TONE, filters.bank)}>
              حسبة البنك <span className="font-bold">({toArabicDigits(bankCheck)})</span>
            </FilterChip>
          )}
        </div>
      )}

      {/* فلتر المراحل — «زيارة» شريحة واحدة لمرحلتي الزيارة، وكل شريحة بلون مرحلتها (stage-colors) */}
      <div className="flex flex-wrap items-center gap-1.5">
        <FilterChip active={filters.stages.length === 0} onClick={() => go({ stages: [] })} className={chipAll(filters.stages.length === 0)}>كل المراحل</FilterChip>
        {stageOrder.map((s) =>
          s === "INTERESTED" ? (
            // مظلّة شاملة بدل مرحلة حرفية — تفلتر كل المتفاعلين دفعة واحدة.
            <FilterChip key={s} active={interestUmbrellaActive} onClick={toggleInterestUmbrella} className={stageFilterChip("INTERESTED", interestUmbrellaActive)}>{stageLabels.INTERESTED}</FilterChip>
          ) : s === "VIEWING" ? null // مدموجة في شريحة «زيارة» الموحّدة
            : s === "VISIT_SCHEDULED" ? (
              <span key="visit-united" className="contents">
                <FilterChip active={visitFilterActive} onClick={toggleVisitFilter} className={toneFilterChip(STAGE_TONES.VISIT_SCHEDULED, visitFilterActive)}>
                  زيارة{visitCount != null ? ` (${toArabicDigits(visitCount)})` : ""}
                </FilterChip>
                {/* شريحة «في الانتظار (N)» بجانب «زيارة» — برتقالي الحالة من المصدر الموحّد */}
                {waiting != null && (
                  <FilterChip active={filters.wait} onClick={() => go({ wait: !filters.wait })} className={toneFilterChip(WAITING_TONE, filters.wait)}>
                    في الانتظار <span className="font-bold">({toArabicDigits(waiting)})</span>
                  </FilterChip>
                )}
              </span>
            ) : (
              <FilterChip key={s} active={filters.stages.includes(s)} onClick={() => toggleStage(s)} className={stageFilterChip(s as LeadStage, filters.stages.includes(s))}>{stageLabels[s as LeadStage]}</FilterChip>
            )
        )}
      </div>

      {/* النطاق الزمني للمواعيد — مع فلتر «زيارة» (موعد الزيارة) أو «موعد لاحق» (موعد المتابعة).
          يصفّي القائمة نفسها، ينعكس بالرابط، والترتيب داخله: الأقرب موعدًا أولًا. */}
      {dateRangeOn && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border/60 bg-card/40 px-3 py-2">
          <span className="text-xs text-muted-foreground">الموعد:</span>
          <FilterChip active={!filters.range && !customRangeActive} onClick={() => go({ range: "", from: "", to: "" })} className={chipAll(!filters.range && !customRangeActive)}>الكل</FilterChip>
          <FilterChip active={filters.range === "week"} onClick={() => go({ range: "week", from: "", to: "" })} className={chipAll(filters.range === "week")}>هذا الأسبوع</FilterChip>
          <FilterChip active={filters.range === "next"} onClick={() => go({ range: "next", from: "", to: "" })} className={chipAll(filters.range === "next")}>الأسبوع الجاي</FilterChip>
          <DateRangeChip
            from={filters.from}
            to={filters.to}
            active={customRangeActive}
            onChange={(next) => go({ range: "", ...next })}
          />
        </div>
      )}

      {/* فلتر الموظفين (للمدير) */}
      {isManager && (
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip active={filters.emps.length === 0} onClick={() => go({ emps: [] })} className={chipAll(filters.emps.length === 0)}>كل الموظفين</FilterChip>
          {employees.map((e) => (
            <FilterChip key={e.id} active={filters.emps.includes(e.id)} onClick={() => toggleEmp(e.id)} className={chip(filters.emps.includes(e.id))}>{e.name}</FilterChip>
          ))}
          {!hideUnassignedEmp && (
            <FilterChip active={filters.emps.includes("none")} onClick={() => toggleEmp("none")} className={chip(filters.emps.includes("none"))}>غير موزّع</FilterChip>
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
            onClick={() => { setQLocal(""); startTransition(() => router.push(build({ q: "", stages: [], emps: [], wait: false, tr: false, bank: false, range: "", from: "", to: "" }))); }}
            className="rounded-xl border border-border px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground"
          >مسح الكل</button>
        )}
        {pending && <span className="text-xs text-muted-foreground">جارٍ التحديث…</span>}
      </div>
    </div>
  );
}
