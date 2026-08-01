"use client";

/**
 * شريحة النطاق الزمني الحر «من — إلى» — مصدر واحد لكل النظام.
 *
 * كانت مبنية داخل شريط فلاتر العملاء (فلتر الزيارة/الموعد اللاحق) فقط. استُخرجت هنا
 * حتى تُعاد نفس الشريحة حرفيًا في أي فلتر زمني آخر (المكررون…) بدل بناء نظير موازٍ
 * ينحرف عنها بالمظهر والسلوك. تتبع نفس معاملة بقية الشرائح: علامة ✓ عند التفعيل.
 */
export function DateRangeChip({
  from, to, active, onChange, fromLabel = "من تاريخ", toLabel = "إلى تاريخ",
}: {
  from: string;
  to: string;
  /** النطاق المخصّص مفعّل (يظهر الإطار الذهبي وعلامة ✓). */
  active: boolean;
  onChange: (next: { from?: string; to?: string }) => void;
  fromLabel?: string;
  toLabel?: string;
}) {
  return (
    <span className={`flex items-center gap-1 rounded-full border px-2 py-1 text-xs transition-colors ${active ? "border-gold bg-gold/15" : "border-border"}`}>
      {/* نفس معاملة الشرائح: ✓ عند تفعيل النطاق المخصّص (المكوّن للأزرار — هذا حقلا تاريخ) */}
      {active && <span aria-hidden className="text-[0.85em] font-bold leading-none text-gold">✓</span>}
      <span className="text-muted-foreground">من</span>
      <input
        type="date" value={from} dir="ltr" aria-label={fromLabel}
        onChange={(e) => onChange({ from: e.target.value })}
        className="bg-transparent text-xs text-foreground outline-none [color-scheme:dark]"
      />
      <span className="text-muted-foreground">إلى</span>
      <input
        type="date" value={to} dir="ltr" aria-label={toLabel}
        onChange={(e) => onChange({ to: e.target.value })}
        className="bg-transparent text-xs text-foreground outline-none [color-scheme:dark]"
      />
    </span>
  );
}
