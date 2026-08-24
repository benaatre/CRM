"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Phone, Settings2, Bot, TriangleAlert, ChevronLeft } from "lucide-react";
import { SOP } from "@/lib/mobile-tokens";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { fetchLeadPreview, type LeadPreview } from "@/components/mobile/owner-audit-action";

/**
 * «سجل التدقيق» التفاعلي (رئيسية المالك — owner-home-final §٤): بطاقات بحد
 * جانبي ملوّن + أيقونة نوع + وسم، والحدث المرتبط بعميل مؤكّد يفتح ورقة معاينة
 * (fetchLeadPreview فوق getLeadDetail) بزرّي «افتح الملف كامل» و«اتصال».
 * الصفوف تصل جاهزة من الخادم (getOwnerAudit) — هنا فلترة وعرض فقط.
 */

export type OwnerAuditItem = {
  id: string;
  /** مجموعة الفلترة — مشتقة على الخادم من نوع getOwnerAudit والفاعل. */
  group: "fup" | "adm" | "sys" | "crit";
  badge: string;
  actor: string;
  /** الجملة المعرّبة بعد حلّ الأسماء (getOwnerAudit.desc). */
  desc: string;
  whenText: string;
  /** معرّف مؤكد فقط (حُلّ لعميل قائم) — غيره null فلا ضغط ولا سهم. */
  leadId: string | null;
  clientName: string | null;
};

const ZAIN = { fontFamily: "var(--font-zain), var(--font-sans)", fontVariantNumeric: "tabular-nums" as const };

/** الرئيسية تعرض آخر ١٥ بعد الفلترة — السجل الكامل في /m/audit. */
const SHOWN = 15;

const FILTERS: { key: "all" | OwnerAuditItem["group"]; label: string }[] = [
  { key: "all", label: "الكل" },
  { key: "fup", label: "متابعات" },
  { key: "adm", label: "إداري" },
  { key: "sys", label: "النظام" },
  { key: "crit", label: "حرِج" },
];

/** لون وأيقونة كل مجموعة — من توكنز SOP حصرًا. */
function meta(group: OwnerAuditItem["group"]) {
  if (group === "fup") return { color: SOP.blue, Icon: Phone };
  if (group === "crit") return { color: SOP.red, Icon: TriangleAlert };
  if (group === "sys") return { color: SOP.neutral, Icon: Bot };
  return { color: SOP.gold2, Icon: Settings2 };
}

/** صف معلومة داخل ورقة المعاينة. */
function InfoRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between" style={{ gap: 10, minHeight: 34, padding: "7px 0", borderBottom: `1px solid ${SOP.edge}` }}>
      <span className="flex-none" style={{ fontSize: 11, color: SOP.mut, fontWeight: 600 }}>{k}</span>
      <span className="min-w-0 text-left" style={{ fontSize: 12, color: SOP.tx, fontWeight: 600 }}>{v}</span>
    </div>
  );
}

export function OwnerAuditSection({ rows }: { rows: OwnerAuditItem[] }) {
  const [filter, setFilter] = useState<"all" | OwnerAuditItem["group"]>("all");
  const [openLead, setOpenLead] = useState<{ id: string; name: string } | null>(null);
  const [preview, setPreview] = useState<LeadPreview | null>(null);
  const [pending, startTransition] = useTransition();

  const visible = useMemo(
    () => rows.filter((r) => filter === "all" || r.group === filter).slice(0, SHOWN),
    [rows, filter],
  );

  const openSheet = (leadId: string, name: string) => {
    setOpenLead({ id: leadId, name });
    setPreview(null);
    startTransition(async () => {
      setPreview(await fetchLeadPreview(leadId));
    });
  };

  return (
    <>
      {/* الفلاتر */}
      <div className="m-noscroll flex overflow-x-auto" style={{ gap: 6 }}>
        {FILTERS.map((f) => {
          const on = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`${on ? "" : "m-raise"} m-press-sc flex-none`}
              style={{
                boxSizing: "border-box", padding: "7px 12px", borderRadius: 10,
                fontSize: 10, fontWeight: on ? 700 : 600, border: "none", cursor: "pointer",
                ...(on
                  ? { color: SOP.onGold, background: `linear-gradient(135deg, ${SOP.gold2}, ${SOP.gold})`, boxShadow: `0 3px 9px color-mix(in srgb, ${SOP.gold} 32%, transparent)` }
                  : { color: SOP.tx2, background: "transparent" }),
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* البطاقة */}
      <div className="m-raise" style={{ borderRadius: 16, padding: "3px 13px" }}>
        {visible.length === 0 && (
          <div className="text-center" style={{ padding: 16, fontSize: 12, color: SOP.mut }}>
            ما فيه أحداث بهذا الفلتر
          </div>
        )}
        {visible.map((r) => {
          const { color, Icon } = meta(r.group);
          const pressable = !!r.leadId;
          const Row = (
            <>
              {/* الحد الجانبي الملوّن */}
              <span aria-hidden className="flex-none" style={{ width: 3, alignSelf: "stretch", borderRadius: 3, background: color, marginBlock: 2 }} />
              <span
                className="flex flex-none items-center justify-center"
                style={{ boxSizing: "border-box", width: 28, height: 28, borderRadius: 8, background: `color-mix(in srgb, ${color} 15%, transparent)` }}
              >
                <Icon size={14} strokeWidth={1.8} style={{ color, maxWidth: 22, maxHeight: 22 }} aria-hidden />
              </span>
              <span className="min-w-0 flex-1 text-start">
                <span className="flex flex-wrap items-center" style={{ gap: 6 }}>
                  <b style={{ fontSize: "10.5px", fontWeight: 700, color: SOP.tx }}>{r.actor}</b>
                  <span style={{ boxSizing: "border-box", fontSize: 8.5, fontWeight: 700, padding: "2px 7px", borderRadius: 6, color, background: `color-mix(in srgb, ${color} 13%, transparent)` }}>
                    {r.badge}
                  </span>
                </span>
                <span className="block" style={{ fontSize: "10.5px", color: SOP.tx2, marginTop: 3, lineHeight: 1.5 }}>
                  {r.desc}
                  {pressable && r.clientName && (
                    <b style={{ color: SOP.gold2, fontWeight: 700 }}> · {r.clientName}</b>
                  )}
                </span>
              </span>
              <span className="flex flex-none flex-col items-center" style={{ gap: 5 }}>
                <span style={{ fontSize: "8.5px", color: SOP.mut }}>{r.whenText}</span>
                {pressable && <ChevronLeft size={13} strokeWidth={2} style={{ color: SOP.gold2, maxWidth: 22, maxHeight: 22 }} aria-hidden />}
              </span>
            </>
          );
          const rowStyle = {
            boxSizing: "border-box" as const, gap: 10, padding: "9px 0",
            borderBottom: `1px solid ${SOP.edge}`, width: "100%",
          };
          return pressable ? (
            <button
              key={r.id}
              type="button"
              onClick={() => openSheet(r.leadId as string, r.clientName ?? "")}
              className="m-press-sc flex items-center"
              style={{ ...rowStyle, background: "none", border: "none", borderBottom: `1px solid ${SOP.edge}`, cursor: "pointer" }}
            >
              {Row}
            </button>
          ) : (
            <div key={r.id} className="flex items-center" style={rowStyle}>
              {Row}
            </div>
          );
        })}
        <Link href="/m/audit" className="m-press-sc block text-center" style={{ padding: 11, fontSize: 11, fontWeight: 700, color: SOP.gold2 }}>
          السجل الكامل ←
        </Link>
      </div>

      {/* ورقة معاينة العميل */}
      <BottomSheet
        open={!!openLead}
        onClose={() => setOpenLead(null)}
        title={openLead?.name || "معاينة العميل"}
        subtitle={preview ? preview.phone : pending ? "جارٍ التحميل…" : undefined}
        footer={
          openLead && (
            <div className="flex" style={{ gap: 9 }}>
              <Link
                href={`/m/leads/${openLead.id}`}
                className="m-press-sc flex flex-1 items-center justify-center"
                style={{
                  boxSizing: "border-box", minHeight: 44, borderRadius: 12,
                  background: `linear-gradient(135deg, ${SOP.gold2}, ${SOP.gold})`,
                  color: SOP.onGold, fontSize: 13, fontWeight: 800,
                }}
              >
                افتح الملف كامل
              </Link>
              {preview && (
                <a
                  href={`tel:${preview.phone}`}
                  className="m-raise m-press-sc flex items-center justify-center"
                  style={{ boxSizing: "border-box", minHeight: 44, minWidth: 92, borderRadius: 12, gap: 6, color: SOP.green, fontSize: 13, fontWeight: 800 }}
                >
                  <Phone size={15} strokeWidth={2} style={{ maxWidth: 22, maxHeight: 22 }} aria-hidden />
                  اتصال
                </a>
              )}
            </div>
          )
        }
      >
        {!preview ? (
          <div className="text-center" style={{ padding: 22, fontSize: 12, color: SOP.mut }}>
            {pending ? "جارٍ تحميل بيانات العميل…" : "تعذّر تحميل العميل — ربما حُذف أو خارج نطاقك."}
          </div>
        ) : (
          <div style={{ padding: "2px 2px 8px" }}>
            <InfoRow k="الجوال" v={<span dir="ltr" style={ZAIN}>{preview.phone}</span>} />
            <InfoRow
              k="المرحلة"
              v={
                <span
                  className="inline-flex items-center"
                  style={{
                    boxSizing: "border-box", gap: 5, padding: "3px 9px", borderRadius: 8,
                    fontSize: 11, fontWeight: 700, color: preview.stageHex,
                    background: `color-mix(in srgb, ${preview.stageHex} 14%, transparent)`,
                  }}
                >
                  <i aria-hidden style={{ width: 6, height: 6, borderRadius: 3, background: preview.stageHex }} />
                  {preview.stageLabel}
                </span>
              }
            />
            <InfoRow k="المصدر" v={preview.sourceText} />
            <InfoRow k="الموظف" v={preview.employeeName ?? "غير موزّع"} />
            <InfoRow k="آخر تواصل" v={preview.lastContactText ?? "—"} />
            {preview.lastFu && (
              <div style={{ boxSizing: "border-box", marginTop: 10, padding: "10px 12px", borderRadius: 12, background: SOP.page, border: `1px solid ${SOP.edge}` }}>
                <div style={{ fontSize: 10, color: SOP.mut, fontWeight: 700 }}>آخر متابعة · {preview.lastFu.when}</div>
                <div style={{ fontSize: 12, color: SOP.tx, fontWeight: 700, marginTop: 4 }}>{preview.lastFu.result}</div>
                {preview.lastFu.note && (
                  <div style={{ fontSize: 11, color: SOP.tx2, marginTop: 4, lineHeight: 1.7 }}>{preview.lastFu.note}</div>
                )}
              </div>
            )}
          </div>
        )}
      </BottomSheet>
    </>
  );
}

export default OwnerAuditSection;
