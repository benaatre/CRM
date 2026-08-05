"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpDown, CheckSquare, CalendarDays } from "lucide-react";
import {
  buildLeadsQuery, INTEREST_UMBRELLA, VISIT_FILTER_STAGES, type LeadFilterValues,
} from "@/lib/lead-filters";
import { MOBILE_COLORS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { MobileFilterSheet, type FilterSection, type FilterSelection } from "@/components/mobile/filter-sheet";

type LeadTab = Parameters<typeof buildLeadsQuery>[0];

const SORTS = [
  { value: "activity", label: "الأحدث نشاطًا" },
  { value: "newest", label: "الأحدث إضافةً" },
  { value: "oldest", label: "الأقدم إضافةً" },
  { value: "name", label: "حسب الاسم" },
] as const;

const DATE_PRESETS = [
  { value: "", label: "الكل" },
  { value: "today", label: "اليوم" },
  { value: "week", label: "هذا الأسبوع" },
  { value: "next", label: "الأسبوع الجاي" },
] as const;

const fieldStyle = {
  boxSizing: "border-box" as const,
  width: "100%", minHeight: 46,
  background: MOBILE_COLORS.bg, border: `1px solid ${MOBILE_COLORS.border}`,
  borderRadius: 11, padding: "0 12px", fontSize: 14, color: MOBILE_COLORS.textPrimary, outline: "none",
};

/**
 * صف أدوات /m/leads: «فلاتر» عريض + ترتيب + تحديد، وتحته صف الموعد الذكي.
 *
 * كل شيء يمرّ عبر `buildLeadsQuery` نفسها — صفر باراميتر جديد وصفر منطق فلترة
 * هنا. الشاشة تمرّر القيم المحلّلة (parseLeadFilters) وتستقبل الرابط الجديد.
 *
 * صف الموعد يظهر فقط مع مرحلة ذات بُعد زمني (زيارة/موعد لاحق) أو «في الانتظار» —
 * وهو نفس شرط سريان النطاق على الخادم (dateRangeApplies)، فما نعرض فلترًا لا يؤثّر.
 *
 * ⚠️ «اليوم» ليس preset على الخادم (DATE_RANGE_PRESETS = week/next فقط) — نكتبه
 * كنطاق from=to=تاريخ اليوم عبر نفس حقلَي from/to، بلا أي إضافة خادمية.
 */
export function MobileLeadsFilters({
  tab, values, sections, selection, dateApplies, todayISO, selectMode, onToggleSelect,
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
}) {
  const router = useRouter();
  const [sortOpen, setSortOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [from, setFrom] = useState(values.from);
  const [to, setTo] = useState(values.to);

  const push = (next: LeadFilterValues) => {
    const qs = buildLeadsQuery(tab, next);
    router.push(qs ? `/m/leads?${qs}` : "/m/leads");
  };

  /**
   * ترجمة اختيار الورقة إلى قيم الرابط — نفس مفاتيح parseLeadFilters.
   * «زيارة» و«مهتم» رمزان مركّبان يُفكّان لمراحلهما (نفس ما تفعله شريحة الديسكتوب)،
   * وbuildLeadsQuery يعيد طيّ زوج الزيارة إلى "visit" في الرابط.
   */
  function applyFilters(next: FilterSelection) {
    const picked = next.stages ?? [];
    const stages = [...new Set(picked.flatMap((s) =>
      s === "visit" ? [...VISIT_FILTER_STAGES]
        : s === "umbrella" ? [...INTEREST_UMBRELLA]
          : [s],
    ))];
    push({
      ...values,
      stages,
      wait: (next.flags ?? []).includes("wait"),
      tr: (next.flags ?? []).includes("tr"),
      bank: (next.flags ?? []).includes("bank"),
    });
  }

  const customActive = !values.range && (!!values.from || !!values.to);
  const todayActive = values.from === todayISO && values.to === todayISO;
  const activeDate = todayActive ? "today" : values.range || (customActive ? "custom" : "");

  return (
    <>
      {/* ===== صف الأدوات ===== */}
      <div className="flex items-center" style={{ gap: 8 }}>
        <MobileFilterSheet sections={sections} selection={selection} onApply={applyFilters} />

        <button
          type="button"
          onClick={() => setSortOpen(true)}
          aria-label="الترتيب"
          className="m-press flex flex-none items-center justify-center"
          style={{
            boxSizing: "border-box", width: 44, height: 44, borderRadius: 13,
            background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
            color: MOBILE_COLORS.textSecondary,
          }}
        >
          <ArrowUpDown size={17} aria-hidden />
        </button>

        <button
          type="button"
          onClick={onToggleSelect}
          aria-label={selectMode ? "إنهاء التحديد" : "تحديد"}
          aria-pressed={selectMode}
          className="m-press flex flex-none items-center justify-center"
          style={{
            boxSizing: "border-box", width: 44, height: 44, borderRadius: 13,
            background: selectMode ? MOBILE_COLORS.goldBg : MOBILE_COLORS.card,
            border: `1px solid ${selectMode ? MOBILE_COLORS.goldBorder : MOBILE_COLORS.border}`,
            color: selectMode ? MOBILE_COLORS.gold : MOBILE_COLORS.textSecondary,
          }}
        >
          <CheckSquare size={17} aria-hidden />
        </button>
      </div>

      {/* ===== صف الموعد الذكي — يظهر فقط مع مرحلة ذات بُعد زمني ===== */}
      {dateApplies && (
        <div className="m-rise m-noscroll flex overflow-x-auto" style={{ gap: 7, paddingBottom: 2 }}>
          {DATE_PRESETS.map((p) => {
            const on = activeDate === p.value;
            return (
              <button
                key={p.value || "all"}
                type="button"
                onClick={() =>
                  push(
                    p.value === "today"
                      ? { ...values, range: "", from: todayISO, to: todayISO }
                      : p.value === ""
                        ? { ...values, range: "", from: "", to: "" }
                        : { ...values, range: p.value as LeadFilterValues["range"], from: "", to: "" },
                  )
                }
                className="m-press flex flex-none items-center whitespace-nowrap"
                style={{
                  boxSizing: "border-box", height: 34, padding: "0 14px", borderRadius: 17,
                  fontSize: 12, fontWeight: 600,
                  ...(on
                    ? { background: MOBILE_COLORS.goldBg, color: MOBILE_COLORS.gold, border: `1px solid ${MOBILE_COLORS.goldBorder}` }
                    : { background: MOBILE_COLORS.card, color: MOBILE_COLORS.textSecondary, border: `1px solid ${MOBILE_COLORS.border}` }),
                }}
              >
                {p.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => { setFrom(values.from); setTo(values.to); setDateOpen(true); }}
            className="m-press flex flex-none items-center whitespace-nowrap"
            style={{
              boxSizing: "border-box", gap: 6, height: 34, padding: "0 14px", borderRadius: 17,
              fontSize: 12, fontWeight: 600,
              ...(activeDate === "custom"
                ? { background: MOBILE_COLORS.goldBg, color: MOBILE_COLORS.gold, border: `1px solid ${MOBILE_COLORS.goldBorder}` }
                : { background: MOBILE_COLORS.card, color: MOBILE_COLORS.textSecondary, border: `1px solid ${MOBILE_COLORS.border}` }),
            }}
          >
            <CalendarDays size={13} aria-hidden /> تاريخ محدد
          </button>
        </div>
      )}

      {/* ===== ورقة الترتيب ===== */}
      <BottomSheet open={sortOpen} onClose={() => setSortOpen(false)} title="الترتيب">
        <div className="flex flex-col" style={{ marginTop: 12 }}>
          {SORTS.map((s) => {
            const on = values.sort === s.value;
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => { setSortOpen(false); push({ ...values, sort: s.value }); }}
                className="m-press flex w-full items-center justify-between"
                style={{
                  boxSizing: "border-box", minHeight: 52, borderRadius: 12, padding: "0 14px",
                  background: on ? MOBILE_COLORS.goldBg : "transparent",
                  border: `1px solid ${on ? MOBILE_COLORS.goldBorder : "transparent"}`,
                  color: on ? MOBILE_COLORS.gold : MOBILE_COLORS.textPrimary,
                  fontSize: 14, fontWeight: on ? 700 : 500,
                }}
              >
                {s.label}
                {on && <span aria-hidden>✓</span>}
              </button>
            );
          })}
        </div>
      </BottomSheet>

      {/* ===== ورقة التاريخ المحدد — منتقي تاريخ الجوال الأصلي ===== */}
      <BottomSheet
        open={dateOpen}
        onClose={() => setDateOpen(false)}
        title="تاريخ محدد"
        subtitle="على موعد المتابعة/الزيارة — الطرفان شاملان"
        footer={
          <div className="flex" style={{ gap: 8 }}>
            {customActive && (
              <button
                type="button"
                onClick={() => { setDateOpen(false); setFrom(""); setTo(""); push({ ...values, range: "", from: "", to: "" }); }}
                className="m-press"
                style={{
                  boxSizing: "border-box", height: 48, padding: "0 18px", borderRadius: 12,
                  border: `1px solid ${MOBILE_COLORS.border}`, background: MOBILE_COLORS.card,
                  color: MOBILE_COLORS.textSecondary, fontSize: 13, fontWeight: 600,
                }}
              >
                امسح
              </button>
            )}
            <button
              type="button"
              disabled={!from && !to}
              onClick={() => { setDateOpen(false); push({ ...values, range: "", from, to }); }}
              className="m-press m-sweep flex-1"
              style={{
                boxSizing: "border-box", height: 48, borderRadius: 12, border: "none",
                background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg, fontSize: 14, fontWeight: 700,
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
            <span className="block" style={{ fontSize: "12.5px", color: MOBILE_COLORS.textSecondary, marginBottom: 7 }}>من تاريخ</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={fieldStyle} />
          </label>
          <label className="block">
            <span className="block" style={{ fontSize: "12.5px", color: MOBILE_COLORS.textSecondary, marginBottom: 7 }}>إلى تاريخ</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={fieldStyle} />
          </label>
        </div>
      </BottomSheet>
    </>
  );
}

export default MobileLeadsFilters;
