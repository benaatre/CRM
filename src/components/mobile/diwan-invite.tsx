"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Phone, MessageCircle, ChevronLeft, PenLine } from "lucide-react";
import type { DayAppointment } from "@/lib/mobile-agenda";
import { MOBILE_COLORS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";
import { waPhone } from "@/lib/value-normalize";
import { markCall } from "@/lib/mobile-call-tracker";

/**
 * بطاقة «موعدك القادم» — المرجع `.invite` حرفيًا: label متباعد + شارة العدّاد،
 * الاسم ١٦.٥ + شيبة النوع، الوقت ٢١ ذهبي، صندوق «ملاحظتك من آخر متابعة»،
 * وثلاثة أزرار (اتصال ذهبي / واتساب / سهم الملف ٤٦px).
 *
 * تعرض أول موعد لم يفت (أو فات بأقل من ١٠ دقائق) وتحل محل NextAppointmentBanner.
 * الملاحظة من LeadRow.lastNote (خريطة من الصفحة). الأرقام عربية (قرار معتمد).
 */

const MIN = 60_000;
const ZAIN = { fontFamily: "var(--font-zain), var(--font-sans)", fontVariantNumeric: "tabular-nums" as const };

/** وقت الرياض بأرقام عربية مع الفترة (ظهرًا/مساءً…) منفصلة. */
function fmtParts(d: Date): { clock: string; period: string } {
  const parts = new Intl.DateTimeFormat("ar-SA-u-nu-arab", { timeZone: "Asia/Riyadh", hour: "numeric", minute: "2-digit" }).formatToParts(d);
  const period = parts.find((p) => p.type === "dayPeriod")?.value ?? "";
  const clock = parts.filter((p) => p.type !== "dayPeriod").map((p) => p.value).join("").trim();
  return { clock, period };
}

/** «بعد ٢٥ دقيقة» / «بعد ساعتين» — وبعد الوقت: «فات من ٥ د». */
function untilLabel(ms: number): string {
  const m = Math.max(1, Math.round(Math.abs(ms) / MIN));
  if (ms < 0) return `فات من ${toArabicDigits(m)} د`;
  if (m < 60) return m === 1 ? "بعد دقيقة" : m === 2 ? "بعد دقيقتين" : `بعد ${toArabicDigits(m)} دقيقة`;
  const h = Math.round(m / 60);
  return h === 1 ? "بعد ساعة" : h === 2 ? "بعد ساعتين" : `بعد ${toArabicDigits(h)} ساعات`;
}

/** شيبة النوع — ألوان المرجع: زيارة سماوي · أول تواصل أزرق · متابعة ذهبي. */
function kindChip(kind: DayAppointment["kind"]): { label: string; color: string } {
  if (kind === "visit") return { label: "زيارة", color: MOBILE_COLORS.dwSky };
  if (kind === "new") return { label: "أول تواصل", color: MOBILE_COLORS.dwBlue };
  return { label: "متابعة", color: MOBILE_COLORS.gold };
}

export function DiwanInvite({ appointments, notes }: {
  appointments: DayAppointment[];
  /** leadId ← نص آخر متابعة مرئية (LeadRow.lastNote) — تُبنى في الصفحة. */
  notes: Record<string, string | null>;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // أول موعد لم يمضِ على فواته أكثر من ١٠ دقائق — ما فيه → البطاقة تختفي.
  const hit = appointments.find((a) => a.at.getTime() - nowMs >= -10 * MIN);
  if (!hit) return null;

  const diff = hit.at.getTime() - nowMs;
  const passed = diff < 0;
  const chip = kindChip(hit.kind);
  const note = notes[hit.leadId]?.trim() || null;
  const t = fmtParts(hit.at);

  return (
    <div
      className="m-rise relative overflow-hidden"
      style={{
        boxSizing: "border-box",
        background: MOBILE_COLORS.card,
        border: `1px solid ${MOBILE_COLORS.hair}`,
        borderRadius: 20,
        padding: "15px 16px",
        marginTop: 16,
        animationDelay: "100ms",
      }}
    >
      <div className="flex items-center justify-between">
        <span style={{ fontSize: 9.5, letterSpacing: "0.22em", color: MOBILE_COLORS.gold, fontWeight: 600 }}>
          موعدك القادم
        </span>
        <span
          style={{
            boxSizing: "border-box", fontSize: 10.5, fontWeight: 600, borderRadius: 8, padding: "4px 10px",
            color: passed ? MOBILE_COLORS.dwAmber : MOBILE_COLORS.gold,
            background: passed ? MOBILE_COLORS.dwAmberDim : MOBILE_COLORS.accDim,
            boxShadow: `inset 0 0 0 1px ${MOBILE_COLORS.accA20}`,
            ...ZAIN,
          }}
        >
          {untilLabel(diff)}
        </span>
      </div>

      <div className="flex items-center" style={{ gap: 12, marginTop: 12 }}>
        <div className="min-w-0 flex-1">
          <h3 className="truncate" style={{ fontSize: 16.5, fontWeight: 600, letterSpacing: "-0.01em", color: MOBILE_COLORS.textPrimary }}>
            {hit.name}
          </h3>
          <div className="flex flex-wrap items-center" style={{ gap: 6, marginTop: 6 }}>
            <span
              style={{
                boxSizing: "border-box", display: "inline-flex", alignItems: "center",
                fontSize: 10.5, fontWeight: 600, borderRadius: 7, padding: "3.5px 8px",
                background: MOBILE_COLORS.sheet, color: chip.color,
              }}
            >
              {chip.label}
            </span>
          </div>
        </div>
        <div className="flex-none text-center">
          <div style={{ ...ZAIN, fontSize: 21, fontWeight: 800, lineHeight: 1, color: MOBILE_COLORS.gold }}>{t.clock}</div>
          <div style={{ fontSize: 9.5, color: MOBILE_COLORS.textMuted, marginTop: 2 }}>{t.period}</div>
        </div>
      </div>

      {/* ملاحظة آخر متابعة — تظهر فقط إن وُجد نصّها */}
      {note && (
        <div
          style={{
            boxSizing: "border-box", marginTop: 12, borderRadius: 13, padding: "11px 12px",
            background: MOBILE_COLORS.sheet, border: `1px solid ${MOBILE_COLORS.hair}`,
          }}
        >
          <div className="flex items-center" style={{ gap: 6, fontSize: 9.5, color: MOBILE_COLORS.textMuted, letterSpacing: "0.06em" }}>
            <PenLine size={11} strokeWidth={1.7} aria-hidden />
            ملاحظتك من آخر متابعة
          </div>
          <p
            style={{
              fontSize: 11.5, color: MOBILE_COLORS.textSecondary, lineHeight: 1.8, marginTop: 6,
              display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden",
            }}
          >
            {note}
          </p>
        </div>
      )}

      <div className="flex" style={{ gap: 8, marginTop: 12 }}>
        <a
          href={`tel:${hit.phone}`}
          onClick={() => markCall(hit.leadId)}
          className="m-press flex flex-1 items-center justify-center"
          style={{
            boxSizing: "border-box", borderRadius: 12, padding: "11px 0", border: "none",
            background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg, fontSize: 12, fontWeight: 600, gap: 7,
            boxShadow: "inset 0 1px 0 rgba(255,255,255,.25)",
          }}
        >
          <Phone size={14} strokeWidth={1.8} aria-hidden />
          {passed ? "اتصل الحين" : "اتصال الآن"}
        </a>
        <a
          href={`https://wa.me/${waPhone(hit.phone)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="m-press flex flex-1 items-center justify-center"
          style={{
            boxSizing: "border-box", borderRadius: 12, padding: "11px 0",
            boxShadow: `inset 0 0 0 1px ${MOBILE_COLORS.hair}`,
            color: MOBILE_COLORS.textPrimary, fontSize: 12, fontWeight: 600, gap: 7,
          }}
        >
          <MessageCircle size={14} strokeWidth={1.8} style={{ color: MOBILE_COLORS.dwGreen }} aria-hidden />
          واتساب
        </a>
        <Link
          href={`/m/leads/${hit.leadId}`}
          aria-label={`ملف العميل ${hit.name}`}
          className="m-press flex flex-none items-center justify-center"
          style={{
            boxSizing: "border-box", width: 46, borderRadius: 12,
            boxShadow: `inset 0 0 0 1px ${MOBILE_COLORS.hair}`,
            color: MOBILE_COLORS.textSecondary,
          }}
        >
          <ChevronLeft size={16} strokeWidth={1.8} aria-hidden />
        </Link>
      </div>
    </div>
  );
}

export default DiwanInvite;
