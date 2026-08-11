"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";

/**
 * «سجل التدقيق» برئيسية المالك v3 — عرض خالص فوق صفوف جاهزة من الخادم
 * (getAuditLog + resolveAuditNames + inferFollowupLeads — نفس دوال /m/audit):
 * ٥ رقائق فلترة محلية + توسيع الصف بالضغط (النص الكامل + الوقت المطلق) +
 * زر ← لملف العميل (للأحداث المرتبطة بعميل واحد، بلا توسيع الصف) +
 * «تحميل المزيد» ترقيم محلي فوق المجلوب — لا أي API جديد.
 */

export type AuditFeedRow = {
  id: string;
  kind: "fup" | "adm" | "sys" | "crit";
  actor: string;
  /** شارة الفعل (متابعة/زيارة/توزيع/سحب/دفعة…). */
  badge: string;
  /** الجملة المعرّبة بعد حلّ الأسماء وتنظيف الأنماط الخام. */
  head: string;
  leadId: string | null;
  /** «قبل ٣ د» — نسبي مختصر بجانب الصف. */
  whenText: string;
  /** الوقت المطلق الكامل — يظهر عند التوسيع. */
  fullWhen: string;
  /** عنوان يوم المجموعة (بيوم الرياض). */
  group: string;
};

const PAGE = 15;

const FILTERS: { key: "all" | AuditFeedRow["kind"]; label: string }[] = [
  { key: "all", label: "✓ الكل" },
  { key: "fup", label: "📞 متابعات" },
  { key: "adm", label: "⚙️ إداري" },
  { key: "sys", label: "🤖 النظام" },
  { key: "crit", label: "⚠️ حرِج" },
];

/** لون كل نوع — من التوكنز حصرًا (لا بنفسجي بالتوكنز: «النظام» محايد خافت). */
function tone(kind: AuditFeedRow["kind"]) {
  if (kind === "fup") return { base: MOBILE_STATUS.info.base, bg: MOBILE_STATUS.info.bg };
  if (kind === "crit") return { base: MOBILE_STATUS.danger.base, bg: MOBILE_STATUS.danger.bg };
  if (kind === "sys") return { base: MOBILE_COLORS.textMuted, bg: MOBILE_COLORS.sheet };
  return { base: MOBILE_COLORS.gold, bg: MOBILE_COLORS.goldBg };
}

export function AuditFeed({ rows }: { rows: AuditFeedRow[] }) {
  const [filter, setFilter] = useState<"all" | AuditFeedRow["kind"]>("all");
  const [shown, setShown] = useState(PAGE);
  const [openId, setOpenId] = useState<string | null>(null);

  const visible = useMemo(
    () => rows.filter((r) => filter === "all" || r.kind === filter).slice(0, shown),
    [rows, filter, shown],
  );
  const filteredTotal = useMemo(
    () => rows.filter((r) => filter === "all" || r.kind === filter).length,
    [rows, filter],
  );

  return (
    <div className="overflow-hidden" style={{ borderRadius: 18, background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}` }}>
      {/* الفلاتر الخمسة */}
      <div className="m-noscroll flex overflow-x-auto" style={{ gap: 6, padding: "11px 12px", borderBottom: `1px solid ${MOBILE_COLORS.border}` }}>
        {FILTERS.map((f) => {
          const on = filter === f.key;
          const c = f.key === "all" || f.key === "adm" ? MOBILE_COLORS.gold : tone(f.key as AuditFeedRow["kind"]).base;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => { setFilter(f.key); setShown(PAGE); setOpenId(null); }}
              className="m-press flex-none"
              style={{
                boxSizing: "border-box", padding: "7px 12px", borderRadius: 16,
                fontSize: "10.5px", fontWeight: 800,
                background: on ? c : "transparent",
                color: on ? MOBILE_COLORS.bg : MOBILE_COLORS.textMuted,
                border: `1px solid ${on ? "transparent" : MOBILE_COLORS.border}`,
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {visible.length === 0 && (
        <div className="text-center" style={{ padding: 18, fontSize: 12, color: MOBILE_COLORS.textMuted }}>
          ما فيه أحداث بهذا الفلتر
        </div>
      )}

      {visible.map((r, i) => {
        const c = tone(r.kind);
        const open = openId === r.id;
        const showDay = i === 0 || visible[i - 1].group !== r.group;
        return (
          <div key={r.id}>
            {showDay && (
              <div style={{ padding: "9px 14px", fontSize: "10.5px", color: MOBILE_COLORS.textMuted, fontWeight: 800, background: MOBILE_COLORS.sheet, borderBottom: `1px solid ${MOBILE_COLORS.border}` }}>
                {r.group}
              </div>
            )}
            <div
              role="button"
              tabIndex={0}
              onClick={() => setOpenId(open ? null : r.id)}
              onKeyDown={(e) => { if (e.key === "Enter") setOpenId(open ? null : r.id); }}
              className="relative flex cursor-pointer"
              style={{ gap: 10, padding: "11px 14px", borderBottom: `1px solid ${MOBILE_COLORS.border}` }}
            >
              {/* الخط الجانبي بلون النوع */}
              <span aria-hidden style={{ position: "absolute", top: 11, bottom: 11, insetInlineEnd: 0, width: 3, borderRadius: 3, background: c.base }} />
              <span
                className="flex flex-none items-center justify-center"
                style={{ boxSizing: "border-box", width: 32, height: 32, borderRadius: 10, background: c.bg, color: c.base, fontSize: 13, fontWeight: 800 }}
              >
                {r.kind === "sys" ? "🤖" : r.kind === "crit" ? "⚠️" : r.actor.trim().charAt(0)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center" style={{ gap: 6 }}>
                  <span style={{ fontSize: "12.5px", fontWeight: 800, color: MOBILE_COLORS.textPrimary }}>{r.actor}</span>
                  <span style={{ boxSizing: "border-box", fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 7, background: c.bg, color: c.base }}>{r.badge}</span>
                </div>
                <div
                  className={open ? "" : "truncate"}
                  style={{ fontSize: 12, color: MOBILE_COLORS.textSecondary, marginTop: 4, lineHeight: 1.6, fontWeight: 600, whiteSpace: open ? "normal" : undefined }}
                >
                  {r.head}
                </div>
                {open && (
                  <div style={{ boxSizing: "border-box", marginTop: 8, padding: "9px 11px", borderRadius: 10, background: MOBILE_COLORS.sheet, border: `1px solid ${MOBILE_COLORS.border}`, fontSize: 11, color: MOBILE_COLORS.textMuted, fontWeight: 600, lineHeight: 1.8 }}>
                    الوقت: <b style={{ color: MOBILE_COLORS.textSecondary }}>{r.fullWhen}</b>
                    <br />النص الكامل: <b style={{ color: MOBILE_COLORS.textSecondary }}>{r.head}</b>
                  </div>
                )}
              </div>
              <div className="flex flex-none flex-col items-center" style={{ gap: 7 }}>
                <span style={{ fontSize: 10, color: MOBILE_COLORS.textMuted, fontWeight: 700 }}>{r.whenText}</span>
                {r.leadId && (
                  <Link
                    href={`/m/leads/${r.leadId}`}
                    aria-label="ملف العميل"
                    onClick={(e) => e.stopPropagation()}
                    className="m-press flex items-center justify-center"
                    style={{ boxSizing: "border-box", width: 30, height: 30, borderRadius: 10, background: MOBILE_COLORS.sheet, border: `1px solid ${MOBILE_COLORS.border}`, color: MOBILE_COLORS.textSecondary, fontSize: 12 }}
                  >
                    ←
                  </Link>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {shown < filteredTotal && (
        <button
          type="button"
          onClick={() => setShown((n) => n + PAGE)}
          className="m-press w-full text-center"
          style={{ padding: 12, fontSize: 12, fontWeight: 800, color: MOBILE_COLORS.gold, background: "none", border: "none" }}
        >
          تحميل المزيد ({toArabicDigits(filteredTotal - shown)}) ↓
        </button>
      )}
    </div>
  );
}

export default AuditFeed;
