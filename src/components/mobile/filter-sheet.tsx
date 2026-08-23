"use client";

import { useEffect, useState } from "react";
import { Bookmark, Check, SlidersHorizontal, Trash2 } from "lucide-react";
import { MOBILE_COLORS, SOP } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";
import { BottomSheet } from "@/components/mobile/bottom-sheet";

export type FilterOption = {
  value: string;
  label: string;
  /** عدّاد حقيقي — يُخفى إن كان undefined أو صفرًا. */
  count?: number;
  tone?: "danger" | "warning" | "success";
};

export type FilterSection = {
  key: string;
  title: string;
  /** true = عدّة خيارات معًا (المراحل) · false = خيار واحد (الموعد). */
  multi: boolean;
  options: FilterOption[];
  /** قسم معطّل (مثل «الموعد» بلا مرحلة ذات بُعد زمني) — يُعرض باهتًا مع تلميح. */
  disabled?: boolean;
  /** تلميح صغير تحت العنوان (سبب التعطيل أو ملاحظة: «عميل فقط»). */
  hint?: string;
};

/** الاختيار الحالي لكل قسم — مفتاح القسم ⟵ قيم مختارة. */
export type FilterSelection = Record<string, string[]>;

/** فلتر محفوظ — اسم + سلسلة الاستعلام كما تبنيها الشاشة (buildLeadsQuery). */
export type SavedFilter = { name: string; query: string; savedAt: number };

/**
 * «الفلاتر المضغوطة + الورقة السفلية» — النمط الموحّد لأي شاشة فيها أكثر من صفّي
 * شرائح. الزر يختصر الحالة (اسم الفلتر وعدده إن كان واحدًا، وإلا شارة بالعدد)،
 * والورقة تعرضها مقسّمة بعناوين مع «مسح الكل» و«تطبيق (N)».
 *
 * قشرة عرض بحتة: لا تعرف شيئًا عن مصدر البيانات ولا عن بناء الرابط — الشاشة
 * تعطيها الأقسام وتستقبل الاختيار في onApply فتبني رابطها بدالتها الموجودة.
 *
 * الفلاتر المحفوظة (اختيارية): **عميل فقط** — تُخزَّن في localStorage تحت `savedKey`
 * كأزواج {اسم، استعلام}؛ لا تمرّ بالخادم ولا بالعدّادات. الشاشة تمرّر `currentQuery`
 * (استعلام حالتها الحالية) و`onApplySaved(query)` لتطبيق المحفوظ بالتنقّل.
 */
export function MobileFilterSheet({
  sections,
  selection,
  onApply,
  label = "فلاتر",
  savedKey,
  currentQuery,
  onApplySaved,
}: {
  sections: FilterSection[];
  selection: FilterSelection;
  onApply: (next: FilterSelection) => void;
  label?: string;
  savedKey?: string;
  currentQuery?: string;
  onApplySaved?: (query: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FilterSelection>(selection);
  const [saved, setSaved] = useState<SavedFilter[]>([]);
  const [saveName, setSaveName] = useState("");

  // كل فتح يبدأ من الحالة المطبَّقة فعلًا (لا يورّث مسودّة ملغاة) + قراءة المحفوظات.
  useEffect(() => {
    if (!open) return;
    setDraft(selection);
    setSaveName("");
    if (savedKey) {
      try {
        const raw = window.localStorage.getItem(savedKey);
        const list = raw ? (JSON.parse(raw) as SavedFilter[]) : [];
        setSaved(Array.isArray(list) ? list.filter((s) => s && typeof s.name === "string" && typeof s.query === "string") : []);
      } catch {
        setSaved([]);
      }
    }
  }, [open, selection, savedKey]);

  const persist = (list: SavedFilter[]) => {
    setSaved(list);
    if (!savedKey) return;
    try { window.localStorage.setItem(savedKey, JSON.stringify(list)); } catch { /* تخزين غير متاح — تجاهل بصمت */ }
  };

  const chosen = sections.flatMap((s) =>
    (selection[s.key] ?? []).map((v) => ({ section: s, opt: s.options.find((o) => o.value === v) })),
  ).filter((c): c is { section: FilterSection; opt: FilterOption } => !!c.opt);

  // فلتر واحد مفعّل ⟵ اسمه وعدده مباشرة بدل كلمة «فلاتر».
  const single = chosen.length === 1 ? chosen[0].opt : null;
  const buttonText = single
    ? `${single.label}${single.count ? ` ${toArabicDigits(single.count)}` : ""}`
    : label;
  const active = chosen.length > 0;
  const draftCount = sections.reduce((n, s) => n + (draft[s.key]?.length ?? 0), 0);

  function toggle(section: FilterSection, value: string) {
    if (section.disabled) return;
    setDraft((d) => {
      const cur = d[section.key] ?? [];
      if (!section.multi) return { ...d, [section.key]: cur.includes(value) ? [] : [value] };
      return { ...d, [section.key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] };
    });
  }

  const toneOf = (t?: FilterOption["tone"]) =>
    t === "danger" ? { fg: SOP.red, bg: MOBILE_COLORS.roseBg }
      : t === "warning" ? { fg: SOP.amber, bg: MOBILE_COLORS.amberBg }
        : t === "success" ? { fg: SOP.green, bg: MOBILE_COLORS.mintBg }
          : { fg: SOP.gold, bg: MOBILE_COLORS.goldBg };

  const canSave = !!savedKey && !!currentQuery && !!saveName.trim();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${active ? "" : "m-raise"} m-press-sc flex min-w-0 flex-1 items-center justify-center`}
        style={{
          boxSizing: "border-box", gap: 7, minHeight: 44, borderRadius: 13, padding: "0 14px",
          fontSize: 13, fontWeight: 600,
          ...(active
            ? { background: MOBILE_COLORS.goldBg, border: `1px solid ${SOP.gold}`, color: SOP.gold }
            : { color: SOP.tx2 }),
        }}
      >
        <SlidersHorizontal size={15} strokeWidth={2} aria-hidden />
        <span className="min-w-0 truncate">{buttonText}</span>
        {chosen.length > 1 && (
          <span
            className="flex flex-none items-center justify-center"
            style={{
              boxSizing: "border-box", minWidth: 20, height: 20, borderRadius: 10, padding: "0 5px",
              background: SOP.gold, color: SOP.onGold, fontSize: 10, fontWeight: 700,
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
              className="m-raise m-press-sc"
              style={{ boxSizing: "border-box", height: 48, padding: "0 18px", borderRadius: 12, color: SOP.tx2, fontSize: 13, fontWeight: 600 }}
            >
              مسح الكل
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); onApply(draft); }}
              className="m-press-sc m-sweep flex-1"
              style={{
                boxSizing: "border-box", height: 48, borderRadius: 12, border: "none",
                background: `linear-gradient(135deg, ${SOP.gold2}, ${SOP.gold})`, color: SOP.onGold, fontSize: 14, fontWeight: 700,
              }}
            >
              تطبيق{draftCount > 0 ? ` (${toArabicDigits(draftCount)})` : ""}
            </button>
          </div>
        }
      >
        {sections.map((s) => (
          <section key={s.key} style={{ marginTop: 18, opacity: s.disabled ? 0.45 : 1 }} data-disabled={s.disabled || undefined}>
            <h3 style={{ fontSize: 12.5, fontWeight: 700, color: SOP.mut, marginBottom: s.hint ? 3 : 9 }}>
              {s.title}
            </h3>
            {s.hint && <p style={{ fontSize: 11, color: SOP.mut, marginBottom: 9, lineHeight: 1.6 }}>{s.hint}</p>}
            <div className="flex flex-wrap" style={{ gap: 7 }}>
              {s.options.map((o) => {
                const on = (draft[s.key] ?? []).includes(o.value);
                const t = toneOf(o.tone);
                return (
                  <button
                    key={o.value}
                    type="button"
                    disabled={s.disabled}
                    onClick={() => toggle(s, o.value)}
                    className={`${on ? "" : "m-raise"} m-press-sc flex items-center whitespace-nowrap`}
                    style={{
                      boxSizing: "border-box", gap: 5, minHeight: 38, padding: "0 13px", borderRadius: 12,
                      fontSize: 12.5, fontWeight: 600,
                      ...(on
                        ? { background: t.bg, color: t.fg, border: `1px solid ${t.fg}` }
                        : { color: SOP.tx2 }),
                    }}
                  >
                    {on && <Check size={13} strokeWidth={2.5} aria-hidden />}
                    {o.label}
                    {o.count ? ` (${toArabicDigits(o.count)})` : ""}
                  </button>
                );
              })}
            </div>
          </section>
        ))}

        {/* ===== الفلاتر المحفوظة — عميل فقط (localStorage)، لا تمرّ بالخادم ولا بالعدّادات ===== */}
        {savedKey && (
          <section style={{ marginTop: 22 }}>
            <h3 className="flex items-center" style={{ gap: 6, fontSize: 12.5, fontWeight: 700, color: SOP.mut, marginBottom: 3 }}>
              <Bookmark size={13} strokeWidth={2} aria-hidden /> فلاتر محفوظة
            </h3>
            <p style={{ fontSize: 11, color: SOP.mut, marginBottom: 9, lineHeight: 1.6 }}>تُحفظ على هذا الجهاز فقط.</p>
            {saved.length > 0 && (
              <div className="flex flex-col" style={{ gap: 7, marginBottom: 10 }}>
                {saved.map((sf) => (
                  <div key={`${sf.name}-${sf.savedAt}`} className="m-raise flex items-center" style={{ boxSizing: "border-box", borderRadius: 12, padding: "6px 6px 6px 10px", gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => { setOpen(false); onApplySaved?.(sf.query); }}
                      className="m-press-sc min-w-0 flex-1 truncate text-start"
                      style={{ border: "none", background: "none", minHeight: 36, fontSize: 13, fontWeight: 600, color: SOP.tx, padding: 0 }}
                    >
                      {sf.name}
                    </button>
                    <button
                      type="button"
                      aria-label={`حذف ${sf.name}`}
                      onClick={() => persist(saved.filter((x) => !(x.name === sf.name && x.savedAt === sf.savedAt)))}
                      className="m-press-sc flex flex-none items-center justify-center"
                      style={{ boxSizing: "border-box", width: 34, height: 34, borderRadius: 9, border: "none", background: MOBILE_COLORS.roseBg, color: SOP.red }}
                    >
                      <Trash2 size={15} strokeWidth={2} aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex" style={{ gap: 8 }}>
              <input
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="اسم الفلتر الحالي…"
                maxLength={40}
                style={{
                  boxSizing: "border-box", flex: 1, minHeight: 42, background: SOP.page, border: `1px solid ${SOP.edge}`,
                  borderRadius: 11, padding: "0 12px", fontSize: 13, color: SOP.tx, outline: "none",
                }}
              />
              <button
                type="button"
                disabled={!canSave}
                onClick={() => {
                  if (!canSave || !currentQuery) return;
                  const name = saveName.trim();
                  persist([{ name, query: currentQuery, savedAt: Date.now() }, ...saved.filter((x) => x.name !== name)].slice(0, 12));
                  setSaveName("");
                }}
                className="m-press-sc flex flex-none items-center"
                style={{
                  boxSizing: "border-box", gap: 6, minHeight: 42, padding: "0 13px", borderRadius: 11, border: "none",
                  background: MOBILE_COLORS.goldBg, color: SOP.gold, fontSize: 12.5, fontWeight: 700, opacity: canSave ? 1 : 0.5,
                }}
              >
                <Bookmark size={14} strokeWidth={2} aria-hidden /> احفظ الحالي
              </button>
            </div>
          </section>
        )}
      </BottomSheet>
    </>
  );
}

export default MobileFilterSheet;
