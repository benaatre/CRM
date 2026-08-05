"use client";

import { useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";
import { BottomSheet } from "@/components/mobile/bottom-sheet";

export type FilterOption = {
  value: string;
  label: string;
  /** عدّاد حقيقي — يُخفى إن كان undefined أو صفرًا. */
  count?: number;
  tone?: "danger" | "warning";
};

export type FilterSection = {
  key: string;
  title: string;
  /** true = عدّة خيارات معًا (المراحل) · false = خيار واحد (نوع الحدث). */
  multi: boolean;
  options: FilterOption[];
};

/** الاختيار الحالي لكل قسم — مفتاح القسم ⟵ قيم مختارة. */
export type FilterSelection = Record<string, string[]>;

/**
 * «الفلاتر المضغوطة + الورقة السفلية» — النمط الموحّد لأي شاشة فيها أكثر من صفّي
 * شرائح. الزر يختصر الحالة (اسم الفلتر وعدده إن كان واحدًا، وإلا شارة بالعدد)،
 * والورقة تعرضها مقسّمة بعناوين مع «مسح الكل» و«تطبيق».
 *
 * قشرة عرض بحتة: لا تعرف شيئًا عن مصدر البيانات ولا عن بناء الرابط — الشاشة
 * تعطيها الأقسام وتستقبل الاختيار في onApply فتبني رابطها بدالتها الموجودة.
 */
export function MobileFilterSheet({
  sections,
  selection,
  onApply,
  label = "فلاتر",
}: {
  sections: FilterSection[];
  selection: FilterSelection;
  onApply: (next: FilterSelection) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FilterSelection>(selection);

  // كل فتح يبدأ من الحالة المطبَّقة فعلًا (لا يورّث مسودّة ملغاة).
  useEffect(() => { if (open) setDraft(selection); }, [open, selection]);

  const chosen = sections.flatMap((s) =>
    (selection[s.key] ?? []).map((v) => ({ section: s, opt: s.options.find((o) => o.value === v) })),
  ).filter((c): c is { section: FilterSection; opt: FilterOption } => !!c.opt);

  // فلتر واحد مفعّل ⟵ اسمه وعدده مباشرة بدل كلمة «فلاتر».
  const single = chosen.length === 1 ? chosen[0].opt : null;
  const buttonText = single
    ? `${single.label}${single.count ? ` ${toArabicDigits(single.count)}` : ""}`
    : label;
  const active = chosen.length > 0;

  function toggle(section: FilterSection, value: string) {
    setDraft((d) => {
      const cur = d[section.key] ?? [];
      if (!section.multi) return { ...d, [section.key]: cur.includes(value) ? [] : [value] };
      return { ...d, [section.key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] };
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="m-press flex min-w-0 flex-1 items-center justify-center"
        style={{
          boxSizing: "border-box", gap: 7, minHeight: 44, borderRadius: 13, padding: "0 14px",
          ...(active
            ? { background: MOBILE_COLORS.goldBg, border: `1px solid ${MOBILE_COLORS.goldBorder}`, color: MOBILE_COLORS.gold }
            : { background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`, color: MOBILE_COLORS.textSecondary }),
          fontSize: 13, fontWeight: 600,
        }}
      >
        <SlidersHorizontal size={15} aria-hidden />
        <span className="min-w-0 truncate">{buttonText}</span>
        {chosen.length > 1 && (
          <span
            className="flex flex-none items-center justify-center"
            style={{
              boxSizing: "border-box", minWidth: 20, height: 20, borderRadius: 10, padding: "0 5px",
              background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg, fontSize: 10, fontWeight: 700,
            }}
          >
            {toArabicDigits(chosen.length)}
          </span>
        )}
      </button>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title="الفلاتر"
        subtitle="اختر ثم طبّق"
        tall
        footer={
          <div className="flex" style={{ gap: 8 }}>
            <button
              type="button"
              onClick={() => setDraft({})}
              className="m-press"
              style={{
                boxSizing: "border-box", height: 48, padding: "0 18px", borderRadius: 12,
                border: `1px solid ${MOBILE_COLORS.border}`, background: MOBILE_COLORS.card,
                color: MOBILE_COLORS.textSecondary, fontSize: 13, fontWeight: 600,
              }}
            >
              مسح الكل
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); onApply(draft); }}
              className="m-press m-sweep flex-1"
              style={{
                boxSizing: "border-box", height: 48, borderRadius: 12, border: "none",
                background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg, fontSize: 14, fontWeight: 700,
              }}
            >
              تطبيق
            </button>
          </div>
        }
      >
        {sections.map((s) => (
          <section key={s.key} style={{ marginTop: 18 }}>
            <h3 style={{ fontSize: "12.5px", fontWeight: 700, color: MOBILE_COLORS.textMuted, marginBottom: 9 }}>
              {s.title}
            </h3>
            <div className="flex flex-wrap" style={{ gap: 7 }}>
              {s.options.map((o) => {
                const on = (draft[s.key] ?? []).includes(o.value);
                const tone =
                  o.tone === "danger" ? { bg: MOBILE_STATUS.danger.bg, fg: MOBILE_STATUS.danger.fg, bd: MOBILE_STATUS.danger.border }
                    : o.tone === "warning" ? { bg: MOBILE_STATUS.warning.bg, fg: MOBILE_STATUS.warning.fg, bd: MOBILE_STATUS.warning.border }
                      : { bg: MOBILE_COLORS.goldBg, fg: MOBILE_COLORS.gold, bd: MOBILE_COLORS.goldBorder };
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => toggle(s, o.value)}
                    className="m-press flex items-center whitespace-nowrap"
                    style={{
                      boxSizing: "border-box", minHeight: 38, padding: "0 13px", borderRadius: 19,
                      fontSize: "12.5px", fontWeight: 600,
                      ...(on
                        ? { background: tone.bg, color: tone.fg, border: `1px solid ${tone.bd}` }
                        : { background: MOBILE_COLORS.bg, color: MOBILE_COLORS.textSecondary, border: `1px solid ${MOBILE_COLORS.border}` }),
                    }}
                  >
                    {o.label}
                    {o.count ? ` (${toArabicDigits(o.count)})` : ""}
                  </button>
                );
              })}
            </div>
          </section>
        ))}

      </BottomSheet>
    </>
  );
}

export default MobileFilterSheet;
