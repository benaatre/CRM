"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Phone, MessageCircle, UserRound, PenLine, ChevronRight, ChevronLeft } from "lucide-react";
import type { DayAppointment } from "@/lib/mobile-agenda";
import { SOP } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";
import { waPhone } from "@/lib/value-normalize";
import { markCall } from "@/lib/mobile-call-tracker";
import { actionBtn, BTN_ICON, ACTION_BTN_CLASS } from "@/components/mobile/action-buttons";

/**
 * بطاقة «موعدك القادم» — «أوبسيديان ناعم Pro»:
 * نافذة «عليه الدور» = ±٦٠ دقيقة من الآن (WINDOW): ما قبلها لم يدخل بعد، وما بعدها
 * ينزل لكاروسيل «متابعات اليوم» (يعرض كل مواعيد اليوم أصلًا). المنجز (doneLeadIds)
 * مستبعد. أكثر من موعد ضمن النافذة ⟵ دوران تلقائي كل ٨ ثوانٍ (يتوقف مع
 * prefers-reduced-motion) + مؤشر يدوي (نقاط/سهمان). شارة الحالة: متأخر أحمر / باقي ذهبي.
 * الوقت Zain ذهبي، ملاحظة آخر متابعة (LeadRow.lastNote)، وأزرار action-buttons
 * (اتصال · واتساب · الملف). لا «سجّل النتيجة» — يُسجَّل من ملف العميل.
 */

const MIN = 60_000;
/** نصف نافذة «عليه الدور» — ساعة قبل وساعة بعد. */
const WINDOW = 60 * MIN;
/** إيقاع الدوران التلقائي بين المواعيد ضمن النافذة. */
const ROTATE_MS = 8_000;
const ZAIN = { fontFamily: "var(--font-zain), var(--font-sans)", fontVariantNumeric: "tabular-nums" as const };

/** وقت الرياض بأرقام عربية مع الفترة (ظهرًا/مساءً…) منفصلة. */
function fmtParts(d: Date): { clock: string; period: string } {
  const parts = new Intl.DateTimeFormat("ar-SA-u-nu-arab", { timeZone: "Asia/Riyadh", hour: "numeric", minute: "2-digit" }).formatToParts(d);
  const period = parts.find((p) => p.type === "dayPeriod")?.value ?? "";
  const clock = parts.filter((p) => p.type !== "dayPeriod").map((p) => p.value).join("").trim();
  return { clock, period };
}

/** «باقي ٢٥ دقيقة» / «باقي ساعة» — وبعد الوقت: «متأخر ٥ د». */
function statusLabel(ms: number): string {
  const m = Math.max(1, Math.round(Math.abs(ms) / MIN));
  if (ms < 0) return `متأخر ${toArabicDigits(m)} د`;
  if (m < 60) return m === 1 ? "باقي دقيقة" : m === 2 ? "باقي دقيقتين" : `باقي ${toArabicDigits(m)} دقيقة`;
  return "باقي ساعة";
}

/** شيبة النوع — تتبع النوع لا الحالة: زيارة أزرق · أول تواصل تركوازي · متابعة ذهبي. */
function kindChip(kind: DayAppointment["kind"]): { label: string; color: string } {
  if (kind === "visit") return { label: "زيارة", color: SOP.blue };
  if (kind === "new") return { label: "أول تواصل", color: SOP.teal };
  return { label: "متابعة", color: SOP.gold2 };
}

export function DiwanInvite({ appointments, notes, doneLeadIds = [] }: {
  appointments: DayAppointment[];
  /** leadId ← نص آخر متابعة مرئية (LeadRow.lastNote) — تُبنى في الصفحة. */
  notes: Record<string, string | null>;
  /** مواعيد اليوم التي سُجّلت لعميلها متابعة اليوم — تُستبعد من «عليه الدور». */
  doneLeadIds?: string[];
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [index, setIndex] = useState(0);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // احترام prefers-reduced-motion: لا دوران تلقائي (المؤشر اليدوي يبقى).
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // المرشّحون: داخل ±ساعة، غير منجزين، بترتيب الوقت (الأقرب أولًا).
  const candidates = useMemo(() => {
    const done = new Set(doneLeadIds);
    return appointments
      .filter((a) => Math.abs(a.at.getTime() - nowMs) <= WINDOW && !done.has(a.leadId))
      .sort((a, b) => a.at.getTime() - b.at.getTime());
  }, [appointments, doneLeadIds, nowMs]);

  // الدوران التلقائي فقط إن كان هناك أكثر من موعد.
  useEffect(() => {
    if (reduced || candidates.length <= 1) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % candidates.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [reduced, candidates.length]);

  if (candidates.length === 0) return null;
  const hit = candidates[index % candidates.length];
  const diff = hit.at.getTime() - nowMs;
  const passed = diff < 0;
  const chip = kindChip(hit.kind);
  const note = notes[hit.leadId]?.trim() || null;
  const t = fmtParts(hit.at);
  const statusColor = passed ? SOP.red : SOP.gold;

  return (
    <div
      className="m-raise m-rise relative overflow-hidden"
      style={{
        boxSizing: "border-box",
        borderRadius: 20,
        padding: "15px 16px",
        marginTop: 16,
        animationDelay: "100ms",
        borderInlineStart: `3px solid ${statusColor}`,
      }}
    >
      {/* العنوان + شارة الحالة */}
      <div className="flex items-center justify-between" style={{ gap: 8 }}>
        <span style={{ fontSize: 9.5, letterSpacing: "0.22em", color: SOP.gold, fontWeight: 600 }}>
          موعدك القادم
        </span>
        <span
          style={{
            ...ZAIN, boxSizing: "border-box", fontSize: 10.5, fontWeight: 700, borderRadius: 8, padding: "4px 10px",
            color: statusColor, background: `color-mix(in srgb, ${statusColor} 14%, transparent)`,
            border: `1px solid color-mix(in srgb, ${statusColor} 35%, transparent)`,
          }}
        >
          {statusLabel(diff)}
        </span>
      </div>

      {/* الاسم + شيبة النوع + الوقت */}
      <div className="flex items-center" style={{ gap: 12, marginTop: 12 }}>
        <div className="min-w-0 flex-1">
          <h3 className="truncate" style={{ fontSize: 16.5, fontWeight: 700, letterSpacing: "-0.01em", color: SOP.tx }}>
            {hit.name}
          </h3>
          <div className="flex flex-wrap items-center" style={{ gap: 6, marginTop: 6 }}>
            <span
              style={{
                boxSizing: "border-box", display: "inline-flex", alignItems: "center",
                fontSize: 10.5, fontWeight: 600, borderRadius: 7, padding: "3.5px 8px",
                background: `color-mix(in srgb, ${chip.color} 14%, transparent)`, color: chip.color,
              }}
            >
              {chip.label}
            </span>
            <span dir="ltr" style={{ ...ZAIN, fontSize: 11, color: SOP.mut }}>{hit.phone}</span>
          </div>
        </div>
        <div className="flex-none text-center">
          <div style={{ ...ZAIN, fontSize: 22, fontWeight: 800, lineHeight: 1, color: SOP.gold }}>{t.clock}</div>
          <div style={{ fontSize: 9.5, color: SOP.mut, marginTop: 2 }}>{t.period}</div>
        </div>
      </div>

      {/* ملاحظة آخر متابعة — تظهر فقط إن وُجد نصّها */}
      {note && (
        <div
          className="m-inset"
          style={{
            boxSizing: "border-box", marginTop: 12, borderRadius: 13, padding: "10px 12px",
            background: `color-mix(in srgb, ${SOP.tx} 5%, transparent)`, borderInlineStart: `2px solid ${SOP.edge2}`,
          }}
        >
          <div className="flex items-center" style={{ gap: 6, fontSize: 9.5, color: SOP.mut, letterSpacing: "0.06em" }}>
            <PenLine size={11} strokeWidth={1.7} aria-hidden />
            ملاحظتك من آخر متابعة
          </div>
          <p
            style={{
              fontSize: 11.5, color: SOP.tx2, lineHeight: 1.8, marginTop: 6,
              display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden",
            }}
          >
            {note}
          </p>
        </div>
      )}

      {/* أزرار الفعل الموحّدة — اتصال · واتساب · الملف */}
      <div className="flex" style={{ gap: 8, marginTop: 12 }}>
        <a href={`tel:${hit.phone}`} onClick={() => markCall(hit.leadId)} className={ACTION_BTN_CLASS} style={{ ...actionBtn("gold"), flex: 1.3 }}>
          <Phone {...BTN_ICON} aria-hidden />
          {passed ? "اتصل الحين" : "اتصال"}
        </a>
        <a href={`https://wa.me/${waPhone(hit.phone)}`} target="_blank" rel="noopener noreferrer" className={ACTION_BTN_CLASS} style={{ ...actionBtn("wa"), flex: 1 }}>
          <MessageCircle {...BTN_ICON} aria-hidden />
          واتساب
        </a>
        <Link href={`/m/leads/${hit.leadId}`} aria-label={`ملف العميل ${hit.name}`} className={ACTION_BTN_CLASS} style={{ ...actionBtn("file"), flex: 1 }}>
          <UserRound {...BTN_ICON} aria-hidden />
          الملف
        </Link>
      </div>

      {/* المؤشر اليدوي — يظهر فقط مع أكثر من موعد ضمن النافذة */}
      {candidates.length > 1 && (
        <div className="flex items-center justify-between" style={{ marginTop: 10 }}>
          <button
            type="button"
            aria-label="الموعد السابق"
            onClick={() => setIndex((i) => (i - 1 + candidates.length) % candidates.length)}
            className="m-press-sc flex items-center justify-center"
            style={{ boxSizing: "border-box", width: 30, height: 30, borderRadius: 9, border: "none", background: "transparent", color: SOP.tx2 }}
          >
            <ChevronRight size={16} strokeWidth={2} aria-hidden />
          </button>
          <div className="flex items-center" style={{ gap: 6 }} role="tablist" aria-label="المواعيد ضمن الساعة">
            {candidates.map((c, i) => {
              const on = i === index % candidates.length;
              return (
                <button
                  key={`${c.leadId}-${c.kind}-${c.at.getTime()}`}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  aria-label={`${c.name} — ${fmtParts(c.at).clock}`}
                  onClick={() => setIndex(i)}
                  style={{
                    boxSizing: "border-box", width: on ? 18 : 7, height: 7, borderRadius: 4, border: "none", padding: 0,
                    background: on ? SOP.gold : SOP.edge2, transition: "width .25s",
                  }}
                />
              );
            })}
          </div>
          <button
            type="button"
            aria-label="الموعد التالي"
            onClick={() => setIndex((i) => (i + 1) % candidates.length)}
            className="m-press-sc flex items-center justify-center"
            style={{ boxSizing: "border-box", width: 30, height: 30, borderRadius: 9, border: "none", background: "transparent", color: SOP.tx2 }}
          >
            <ChevronLeft size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}

export default DiwanInvite;
