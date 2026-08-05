"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ScrollText, ChevronLeft, User, Clock, Tag, Contact } from "lucide-react";
import { MOBILE_COLORS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { MobileFilterSheet, type FilterSection, type FilterSelection } from "@/components/mobile/filter-sheet";

export type AuditRow = {
  id: string;
  /** مفتاح الحدث الخام (lead.transferred…) — يظهر في التفاصيل فقط. */
  action: string;
  /** الملخّص بعد استبدال المعرّفات بالأسماء. */
  head: string;
  actor: string;
  /** العميل المرتبط (مصرّح أو مستدلّ) — رابط داخلي لملفه. */
  leadId: string | null;
  leadName: string | null;
  /** «اليوم ٣:٤٥ م» للقائمة · التاريخ الكامل للتفاصيل. */
  whenText: string;
  fullWhen: string;
  dot: string;
  group: string;
};

/**
 * سجل التدقيق — قائمة بفلاتر مضغوطة، وكل سطر يفتح تفاصيله في ورقة سفلية
 * **داخل التطبيق** (لا فتح متصفح): الملخّص الكامل · الفاعل · الوقت الدقيق ·
 * مفتاح الحدث · ورابط داخلي لملف العميل المرتبط.
 *
 * كل البيانات جاهزة من الخادم (getAuditLog + resolveAuditNames + inferFollowupLeads)
 * — هذا المكوّن عرض بحت بلا أي استدعاء.
 */
export function MobileAuditLog({
  rows, categories, actors, currentType, currentActor,
}: {
  rows: AuditRow[];
  categories: { value: string; label: string }[];
  actors: { id: string; name: string }[];
  currentType: string | null;
  currentActor: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<AuditRow | null>(null);

  const sections: FilterSection[] = [
    { key: "type", title: "نوع العملية", multi: false, options: categories.map((c) => ({ value: c.value, label: c.label })) },
    ...(actors.length > 0
      ? [{ key: "emp", title: "الفاعل", multi: false, options: actors.map((a) => ({ value: a.id, label: a.name })) } as FilterSection]
      : []),
  ];
  const selection: FilterSelection = {
    type: currentType ? [currentType] : [],
    emp: currentActor ? [currentActor] : [],
  };

  function apply(next: FilterSelection) {
    const p = new URLSearchParams();
    const t = (next.type ?? [])[0];
    const e = (next.emp ?? [])[0];
    if (t) p.set("type", t);
    if (e) p.set("emp", e);
    const qs = p.toString();
    router.push(qs ? `/m/audit?${qs}` : "/m/audit");
  }

  // تجميع بعناوين اليوم/أمس/الأقدم — الترتيب محفوظ من الخادم.
  const groups: { title: string; items: AuditRow[] }[] = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last.title === r.group) last.items.push(r);
    else groups.push({ title: r.group, items: [r] });
  }

  return (
    <>
      {/* ===== ٧) نفس نمط الفلاتر المضغوطة ===== */}
      <div className="flex items-center" style={{ gap: 8 }}>
        <MobileFilterSheet sections={sections} selection={selection} onApply={apply} />
      </div>

      <div style={{ fontSize: "11.5px", color: MOBILE_COLORS.textMuted, padding: "0 2px" }}>
        {toArabicDigits(rows.length)} عملية
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center text-center"
          style={{
            boxSizing: "border-box", gap: 9, padding: "34px 16px",
            background: MOBILE_COLORS.card, borderRadius: 16, border: `1px solid ${MOBILE_COLORS.border}`,
          }}>
          <ScrollText size={34} style={{ color: MOBILE_COLORS.textMuted }} aria-hidden />
          <p style={{ fontSize: "12.5px", color: MOBILE_COLORS.textSecondary }}>ما فيه عمليات بهذا الفلتر</p>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.title} className="flex flex-col" style={{ gap: 9, marginTop: 6 }}>
            <h2 style={{ fontSize: "12.5px", fontWeight: 700, color: MOBILE_COLORS.textMuted }}>
              {g.title} ({toArabicDigits(g.items.length)})
            </h2>
            {g.items.map((e, i) => (
              <button
                key={e.id}
                type="button"
                onClick={() => setOpen(e)}
                className="m-rise m-press flex w-full items-start text-start"
                style={{
                  boxSizing: "border-box", gap: 10,
                  background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
                  borderRadius: 15, padding: "12px 13px",
                  animationDelay: `${Math.min(i, 8) * 35}ms`,
                }}
              >
                <span className="flex-none" style={{ width: 8, height: 8, borderRadius: 5, marginTop: 6, background: e.dot }} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block" style={{ fontSize: 13, color: MOBILE_COLORS.textPrimary, lineHeight: 1.6 }}>
                    {e.head}
                  </span>
                  <span className="block" style={{ fontSize: 12, color: MOBILE_COLORS.textSecondary, marginTop: 5, lineHeight: 1.6 }}>
                    {e.actor}
                    {e.leadName ? ` · العميل: ${e.leadName}` : ""}
                  </span>
                  <span className="block" style={{ fontSize: 11, color: MOBILE_COLORS.textMuted, marginTop: 5 }}>
                    {e.whenText}
                  </span>
                </span>
                <ChevronLeft size={16} style={{ color: MOBILE_COLORS.dim1, flex: "none", marginTop: 4 }} aria-hidden />
              </button>
            ))}
          </section>
        ))
      )}

      {/* ===== ٥) تفاصيل الحدث — داخل التطبيق ===== */}
      <BottomSheet
        open={open !== null}
        onClose={() => setOpen(null)}
        title="تفاصيل العملية"
        footer={
          open?.leadId ? (
            <Link
              href={`/m/leads/${open.leadId}`}
              onClick={() => setOpen(null)}
              className="m-press flex items-center"
              style={{
                boxSizing: "border-box", gap: 10, minHeight: 56, borderRadius: 12, padding: "0 13px",
                background: MOBILE_COLORS.goldBg, border: `1px solid ${MOBILE_COLORS.goldBorder}`,
              }}
            >
              <span className="flex flex-none items-center justify-center"
                style={{ width: 32, height: 32, borderRadius: 10, background: MOBILE_COLORS.card }}>
                <Contact size={16} style={{ color: MOBILE_COLORS.gold }} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block" style={{ fontSize: 10.5, color: MOBILE_COLORS.textMuted }}>العميل المرتبط — افتح ملفه</span>
                <span className="block truncate" style={{ fontSize: 13, fontWeight: 700, color: MOBILE_COLORS.gold, marginTop: 2 }}>
                  {open.leadName ?? "افتح الملف"}
                </span>
              </span>
              <ChevronLeft size={16} style={{ color: MOBILE_COLORS.gold, flex: "none" }} aria-hidden />
            </Link>
          ) : (
            <p style={{ fontSize: 11.5, color: MOBILE_COLORS.textMuted, lineHeight: 1.8, textAlign: "center" }}>
              ما فيه عميل مرتبط بهذي العملية.
            </p>
          )
        }
      >
        {open && (
          <div className="flex flex-col" style={{ gap: 12, marginTop: 16 }}>
            <p
              style={{
                boxSizing: "border-box", borderRadius: 12, padding: "13px 14px", lineHeight: 1.8,
                background: MOBILE_COLORS.bg, border: `1px solid ${MOBILE_COLORS.border}`,
                fontSize: "13.5px", color: MOBILE_COLORS.textPrimary,
              }}
            >
              {open.head}
            </p>

            <DetailRow icon={User} label="الفاعل" value={open.actor} />
            <DetailRow icon={Clock} label="الوقت" value={open.fullWhen} />
            <DetailRow icon={Tag} label="مفتاح الحدث" value={open.action} ltr />

          </div>
        )}
      </BottomSheet>
    </>
  );
}

function DetailRow({ icon: Icon, label, value, ltr = false }: {
  icon: typeof User; label: string; value: string; ltr?: boolean;
}) {
  return (
    <div className="flex items-center" style={{ gap: 10 }}>
      <span className="flex flex-none items-center justify-center"
        style={{ width: 30, height: 30, borderRadius: 9, background: MOBILE_COLORS.bg, border: `1px solid ${MOBILE_COLORS.border}` }}>
        <Icon size={14} style={{ color: MOBILE_COLORS.textMuted }} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block" style={{ fontSize: 10.5, color: MOBILE_COLORS.textMuted }}>{label}</span>
        <span className="block truncate" style={{ fontSize: 12.5, color: MOBILE_COLORS.textPrimary, marginTop: 2 }} dir={ltr ? "ltr" : undefined}>
          {value}
        </span>
      </span>
    </div>
  );
}

export default MobileAuditLog;
