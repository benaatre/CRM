"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { toArabicDigits } from "@/lib/format";
import { LEAD_SORTS, type LeadFilterValues, type LeadSort } from "@/lib/lead-filters";
import { buildLeadsHref } from "./filters-url";

type Tab = "working" | "archived" | "hidden" | "unassigned";

const SORT_LABELS: Record<LeadSort, string> = {
  activity: "الأحدث نشاطًا",
  newest: "الأحدث إضافةً",
  oldest: "الأقدم إضافةً",
  name: "حسب الاسم",
};

const NUM: React.CSSProperties = { fontFamily: "var(--font-zain), var(--font-sans)", fontVariantNumeric: "tabular-nums", fontWeight: 700 };

/**
 * شريط أدوات الجدول (سطح المكتب): بحث بالاسم/الجوال (Ctrl K) + فرز + سطر التحديد.
 * البحث والفرز يمرّان بالرابط كما هما اليوم (نفس مفاتيح lead-filters).
 */
export function LeadsToolbar({
  basePath, tab, filters, total, selected, allSelected, onToggleAll, onClearSel,
}: {
  basePath: string;
  tab: Tab;
  filters: LeadFilterValues;
  /** عدد الصفوف المطابقة (بعد فلتر طريقة الشراء المحلي). */
  total: number;
  selected: number;
  allSelected: boolean;
  onToggleAll: () => void;
  onClearSel: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(filters.q);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setQ(filters.q); }, [filters.q]);

  // بحث بتأخير ٤٠٠ms — نفس سلوك شريط الفلاتر (لا طلب مع كل حرف).
  useEffect(() => {
    const t = setTimeout(() => {
      if (q !== filters.q) startTransition(() => router.push(buildLeadsHref(basePath, tab, filters, { q })));
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  /**
   * Ctrl/⌘+K على هذه الصفحة يركّز بحث العملاء نفسه لا بحث الترويسة (نفس النية،
   * لكن بلا انتقال). المستمع في **طور الالتقاط** فيسبق مستمع الترويسة العام
   * ويوقفه، ويُنظَّف بنفس الخيارات عند التفكيك.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || !(e.ctrlKey || e.metaKey)) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if ((tag === "INPUT" && el !== inputRef.current) || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="relative min-w-[230px] flex-1">
        <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70" strokeWidth={1.6} />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ابحث بالاسم أو الجوال…"
          aria-label="بحث بالاسم أو الجوال"
          className="w-full rounded-xl bg-[var(--elev)] py-2.5 pr-9 pl-16 text-[13.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:bg-[var(--elev-hover)]"
        />
        {!q && (
          <kbd aria-hidden dir="ltr" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 rounded-md bg-[var(--elev-hover)] px-1.5 py-0.5 text-[12.5px] font-medium text-muted-foreground/70">
            Ctrl K
          </kbd>
        )}
      </div>

      <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
        الفرز
        <select
          value={filters.sort}
          onChange={(e) => startTransition(() => router.push(buildLeadsHref(basePath, tab, filters, { sort: e.target.value as LeadSort })))}
          aria-label="ترتيب القائمة"
          className="rounded-lg bg-[var(--elev)] px-2.5 py-2 text-[13.5px] text-foreground outline-none transition-colors hover:bg-[var(--elev-hover)]"
        >
          {LEAD_SORTS.map((s) => <option key={s} value={s}>{SORT_LABELS[s]}</option>)}
        </select>
      </label>

      {/* سطر التحديد: «تحديد الكل» + «محدَّد ٠ من ٢٥٧» */}
      <div className="flex items-center gap-2.5 text-[13px]">
        <button
          type="button"
          onClick={onToggleAll}
          className={`rounded-lg px-2.5 py-1.5 transition-colors ${allSelected ? "bg-gold/10 font-semibold text-gold" : "bg-[var(--elev)] text-muted-foreground hover:bg-[var(--elev-hover)] hover:text-foreground"}`}
        >
          {allSelected ? "إلغاء تحديد الكل" : "تحديد الكل"}
        </button>
        <span className="text-muted-foreground">
          محدَّد <span style={NUM} className={selected > 0 ? "text-foreground" : ""}>{toArabicDigits(selected)}</span>
          {" "}من <span style={NUM}>{toArabicDigits(total)}</span>
        </span>
        {selected > 0 && (
          <button type="button" onClick={onClearSel} className="text-muted-foreground/70 transition-colors hover:text-foreground">
            إلغاء التحديد
          </button>
        )}
        {pending && <span className="text-[12.5px] text-muted-foreground/70">جارٍ التحديث…</span>}
      </div>
    </div>
  );
}
