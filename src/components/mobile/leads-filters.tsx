"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpDown, CheckSquare, X } from "lucide-react";
import type { LeadStage } from "@prisma/client";
import {
  buildLeadsQuery, INTEREST_UMBRELLA, VISIT_FILTER_STAGES, type LeadFilterValues,
} from "@/lib/lead-filters";
import { stageLabels, purchaseMethodLabels } from "@/lib/labels";
import { SOP } from "@/lib/mobile-tokens";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { MobileFilterSheet, type FilterSection, type FilterSelection } from "@/components/mobile/filter-sheet";

type LeadTab = Parameters<typeof buildLeadsQuery>[0];

const SORTS = [
  { value: "activity", label: "الأحدث نشاطًا" },
  { value: "newest", label: "الأحدث إضافةً" },
  { value: "oldest", label: "الأقدم إضافةً" },
  { value: "name", label: "حسب الاسم" },
] as const;

/** مفتاح المحفوظات على هذا الجهاز (عميل فقط). */
export const LEADS_SAVED_KEY = "m-leads-saved";

const fieldStyle = {
  boxSizing: "border-box" as const,
  width: "100%", minHeight: 46,
  background: SOP.page, border: `1px solid ${SOP.edge}`,
  borderRadius: 11, padding: "0 12px", fontSize: 14, color: SOP.tx, outline: "none",
};

/**
 * صف أدوات /m/leads: ترتيب (باسم الترتيب الحالي) + «الفلاتر» المتقدمة + تحديد،
 * وتحته رقائق المختارات القابلة للحذف (✕).
 *
 * كل ما يخصّ الخادم يمرّ عبر `buildLeadsQuery` نفسها — صفر باراميتر جديد وصفر
 * منطق فلترة خادمي هنا. الشاشة تمرّر القيم المحلّلة (parseLeadFilters) وتستقبل الرابط.
 *
 * ⚠️ استثناءان **عميل فقط** (لا يمرّان بالرابط ولا بالعدّادات):
 *   - «طريقة الشراء» (pm/onPm): getLeads لا يدعمها؛ تُطبَّق محليًا على الصفوف المحمّلة
 *     في MobileLeadsList قبل التقسيم.
 *   - «الفلاتر المحفوظة»: localStorage تحت LEADS_SAVED_KEY، تطبيقها = تنقّل بالرابط المحفوظ.
 *
 * ⚠️ «اليوم» ليس preset على الخادم (DATE_RANGE_PRESETS = week/next فقط) — نكتبه
 * كنطاق from=to=تاريخ اليوم عبر نفس حقلَي from/to، بلا أي إضافة خادمية.
 */
export function MobileLeadsFilters({
  tab, values, sections, selection, dateApplies, todayISO, selectMode, onToggleSelect,
  employees = [], pm, onPm,
}: {
  tab: LeadTab;
  values: LeadFilterValues;
  sections: FilterSection[];
  selection: FilterSelection;
  /** يُحسب على الخادم (نفس شرط الديسكتوب) — لا نكرّره هنا. */
  dateApplies: boolean;
  /** تاريخ اليوم بتوقيت الرياض (YYYY-MM-DD) — يُحسب على الخادم. */
  todayISO: string;
  selectMode: boolean;
  onToggleSelect: () => void;
  /** أسماء الموظفين — لرقاقة فلتر الموظف (المدير). */
  employees?: { id: string; name: string }[];
  /** فلتر طريقة الشراء — عميل فقط (حالة القائمة). */
  pm: string[];
  onPm: (next: string[]) => void;
}) {
  const router = useRouter();
  const [sortOpen, setSortOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [from, setFrom] = useState(values.from);
  const [to, setTo] = useState(values.to);

  const queryOf = (next: LeadFilterValues) => buildLeadsQuery(tab, next);
  const push = (next: LeadFilterValues) => {
    const qs = queryOf(next);
    router.push(qs ? `/m/leads?${qs}` : "/m/leads");
  };

  /**
   * ترجمة اختيار الورقة إلى قيم الرابط — نفس مفاتيح parseLeadFilters.
   * «زيارة» و«مهتم» رمزان مركّبان يُفكّان لمراحلهما (نفس ما تفعله شريحة الديسكتوب)،
   * وbuildLeadsQuery يعيد طيّ زوج الزيارة إلى "visit" في الرابط.
   * قسم «الموعد» مفرد: today ⟵ from=to=اليوم · week/next ⟵ range · custom ⟵ يفتح ورقة التاريخ.
   * قسم «طريقة الشراء» عميل فقط ⟵ onPm.
   */
  function applyFilters(next: FilterSelection) {
    const picked = next.stages ?? [];
    const stages = [...new Set(picked.flatMap((s) =>
      s === "visit" ? [...VISIT_FILTER_STAGES]
        : s === "umbrella" ? [...INTEREST_UMBRELLA]
          : [s],
    ))];
    const date = (next.date ?? [])[0] ?? "";
    const dateVals: Pick<LeadFilterValues, "range" | "from" | "to"> =
      date === "today" ? { range: "", from: todayISO, to: todayISO }
        : date === "week" || date === "next" ? { range: date, from: "", to: "" }
          : date === "custom" ? { range: "", from: values.from, to: values.to }
            : { range: "", from: "", to: "" };
    onPm(next.pm ?? []);
    push({
      ...values,
      stages,
      wait: (next.flags ?? []).includes("wait"),
      tr: (next.flags ?? []).includes("tr"),
      bank: (next.flags ?? []).includes("bank"),
      ...dateVals,
    });
    if (date === "custom") { setFrom(values.from); setTo(values.to); setDateOpen(true); }
  }

  const customActive = !values.range && (!!values.from || !!values.to);
  const todayActive = values.from === todayISO && values.to === todayISO;
  const sortLabel = SORTS.find((s) => s.value === values.sort)?.label ?? SORTS[0].label;

  // ===== رقائق المختارات (✕) — كل واحدة تعيد بناء الرابط بلا قيمتها =====
  const visitOn = VISIT_FILTER_STAGES.every((s) => values.stages.includes(s));
  const chips: { key: string; label: string; onRemove: () => void; tone?: "green" | "red" }[] = [];
  if (values.q) chips.push({ key: "q", label: `بحث: ${values.q}`, onRemove: () => push({ ...values, q: "" }) });
  if (visitOn) chips.push({ key: "visit", label: "زيارة", onRemove: () => push({ ...values, stages: values.stages.filter((s) => !(VISIT_FILTER_STAGES as string[]).includes(s)) }) });
  for (const s of values.stages) {
    if (visitOn && (VISIT_FILTER_STAGES as string[]).includes(s)) continue;
    chips.push({
      key: `st-${s}`, label: stageLabels[s as LeadStage] ?? s, tone: s === "NEW" ? "green" : undefined,
      onRemove: () => push({ ...values, stages: values.stages.filter((x) => x !== s) }),
    });
  }
  if (values.wait) chips.push({ key: "wait", label: "في الانتظار", onRemove: () => push({ ...values, wait: false }) });
  if (values.bank) chips.push({ key: "bank", label: "حسبة البنك", onRemove: () => push({ ...values, bank: false }) });
  if (values.tr) chips.push({ key: "tr", label: "محوَّل", onRemove: () => push({ ...values, tr: false }) });
  for (const id of values.emps) {
    const name = id === "none" ? "غير موزّع" : employees.find((e) => e.id === id)?.name ?? "موظف";
    chips.push({ key: `emp-${id}`, label: name, onRemove: () => push({ ...values, emps: values.emps.filter((x) => x !== id) }) });
  }
  if (todayActive) chips.push({ key: "d-today", label: "الموعد: اليوم", onRemove: () => push({ ...values, range: "", from: "", to: "" }) });
  else if (values.range) chips.push({ key: "d-range", label: values.range === "week" ? "الموعد: هذا الأسبوع" : "الموعد: الأسبوع الجاي", onRemove: () => push({ ...values, range: "", from: "", to: "" }) });
  else if (customActive) chips.push({ key: "d-custom", label: `الموعد: ${values.from || "…"} → ${values.to || "…"}`, onRemove: () => push({ ...values, range: "", from: "", to: "" }) });
  for (const p of pm) {
    chips.push({ key: `pm-${p}`, label: purchaseMethodLabels[p as keyof typeof purchaseMethodLabels] ?? p, onRemove: () => onPm(pm.filter((x) => x !== p)) });
  }

  const iconBtn = (on: boolean) => ({
    boxSizing: "border-box" as const, width: 44, height: 44, borderRadius: 13,
    ...(on ? { background: `color-mix(in srgb, ${SOP.gold} 16%, ${SOP.plane})`, border: `1px solid ${SOP.gold}`, color: SOP.gold } : { color: SOP.tx2 }),
  });

  return (
    <>
      {/* ===== صف الأدوات: ترتيب · الفلاتر · تحديد ===== */}
      <div className="flex items-center" style={{ gap: 8 }}>
        <button
          type="button"
          onClick={() => setSortOpen(true)}
          aria-label="الترتيب"
          className="m-raise m-press-sc flex flex-none items-center"
          style={{ boxSizing: "border-box", gap: 6, height: 44, padding: "0 12px", borderRadius: 13, color: SOP.tx2, fontSize: 12.5, fontWeight: 600, maxWidth: "42%" }}
        >
          <ArrowUpDown size={16} strokeWidth={2} aria-hidden />
          <span className="min-w-0 truncate">{sortLabel}</span>
        </button>

        <MobileFilterSheet
          sections={sections}
          selection={{ ...selection, pm }}
          onApply={applyFilters}
          savedKey={LEADS_SAVED_KEY}
          currentQuery={queryOf(values) || "tab=working"}
          onApplySaved={(q) => router.push(q && q !== "tab=working" ? `/m/leads?${q}` : "/m/leads")}
        />

        <button
          type="button"
          onClick={onToggleSelect}
          aria-label={selectMode ? "إنهاء التحديد" : "تحديد"}
          aria-pressed={selectMode}
          className={`${selectMode ? "" : "m-raise"} m-press-sc flex flex-none items-center justify-center`}
          style={iconBtn(selectMode)}
        >
          <CheckSquare size={17} strokeWidth={2} aria-hidden />
        </button>
      </div>

      {/* ===== رقائق المختارات — قابلة للحذف ===== */}
      {chips.length > 0 && (
        <div className="m-noscroll flex overflow-x-auto" style={{ gap: 6, paddingBottom: 2 }}>
          {chips.map((c) => {
            const color = c.tone === "green" ? SOP.green : c.tone === "red" ? SOP.red : SOP.gold;
            return (
              <button
                key={c.key}
                type="button"
                onClick={c.onRemove}
                aria-label={`إزالة فلتر ${c.label}`}
                className="m-press-sc flex flex-none items-center whitespace-nowrap"
                style={{
                  boxSizing: "border-box", gap: 5, height: 30, padding: "0 9px 0 7px", borderRadius: 10,
                  background: `color-mix(in srgb, ${color} 14%, ${SOP.plane})`, border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
                  color, fontSize: 11.5, fontWeight: 700,
                }}
              >
                {c.label}
                <X size={12} strokeWidth={2.5} aria-hidden />
              </button>
            );
          })}
        </div>
      )}

      {/* ===== ورقة الترتيب ===== */}
      <BottomSheet open={sortOpen} onClose={() => setSortOpen(false)} title="الترتيب">
        <div className="flex flex-col" style={{ marginTop: 12, gap: 6 }}>
          {SORTS.map((s) => {
            const on = values.sort === s.value;
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => { setSortOpen(false); push({ ...values, sort: s.value }); }}
                className={`${on ? "m-inset" : ""} m-press-sc flex w-full items-center justify-between`}
                style={{
                  boxSizing: "border-box", minHeight: 50, borderRadius: 12, padding: "0 14px",
                  ...(on ? { color: SOP.gold } : { background: "transparent", border: `1px solid transparent`, color: SOP.tx }),
                  fontSize: 14, fontWeight: on ? 700 : 500,
                }}
              >
                {s.label}
                {on && <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: SOP.gold }} />}
              </button>
            );
          })}
        </div>
      </BottomSheet>

      {/* ===== ورقة التاريخ المحدد — منتقي تاريخ الجوال الأصلي (يسري مع زيارة/موعد لاحق) ===== */}
      <BottomSheet
        open={dateOpen}
        onClose={() => setDateOpen(false)}
        title="تاريخ محدد"
        subtitle={dateApplies ? "على موعد المتابعة/الزيارة — الطرفان شاملان" : "يسري فقط مع فلتر «زيارة» أو «موعد لاحق»"}
        footer={
          <div className="flex" style={{ gap: 8 }}>
            {customActive && (
              <button
                type="button"
                onClick={() => { setDateOpen(false); setFrom(""); setTo(""); push({ ...values, range: "", from: "", to: "" }); }}
                className="m-raise m-press-sc"
                style={{ boxSizing: "border-box", height: 48, padding: "0 18px", borderRadius: 12, color: SOP.tx2, fontSize: 13, fontWeight: 600 }}
              >
                امسح
              </button>
            )}
            <button
              type="button"
              disabled={!from && !to}
              onClick={() => { setDateOpen(false); push({ ...values, range: "", from, to }); }}
              className="m-press-sc m-sweep flex-1"
              style={{
                boxSizing: "border-box", height: 48, borderRadius: 12, border: "none",
                background: `linear-gradient(135deg, ${SOP.gold2}, ${SOP.gold})`, color: SOP.onGold, fontSize: 14, fontWeight: 700,
                opacity: !from && !to ? 0.5 : 1,
              }}
            >
              طبّق
            </button>
          </div>
        }
      >
        <div className="flex flex-col" style={{ gap: 12, marginTop: 16 }}>
          <label className="block">
            <span className="block" style={{ fontSize: 12.5, color: SOP.tx2, marginBottom: 7 }}>من تاريخ</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={fieldStyle} />
          </label>
          <label className="block">
            <span className="block" style={{ fontSize: 12.5, color: SOP.tx2, marginBottom: 7 }}>إلى تاريخ</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={fieldStyle} />
          </label>
        </div>
      </BottomSheet>
    </>
  );
}

export default MobileLeadsFilters;
