"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronLeft, ChevronUp, MessageCircle, Phone } from "lucide-react";
import type { DayAppointment } from "@/lib/mobile-agenda";
import { MOBILE_COLORS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";
import { waPhone } from "@/lib/value-normalize";
import { markCall } from "@/lib/mobile-call-tracker";

/**
 * كاروسيل «متابعات اليوم» — هندسة المرجع `.caroz` حرفيًا:
 * مسرح ٢٩٦px ببطاقات مكوّمة (النشطة translateY(64) بحد ذهبي وظل، السابقة
 * أعلى والتالية translateY(232) بـscale(.94) وopacity .35)، تنقّل تلقائي كل
 * ٣.٥ث يتوقف ٩ث عند أي لمسة، سحب عمودي بعتبة ٣٤px، أسهم ٣٦px، نقاط
 * (النشطة شريط ١٦px ذهبي)، عدّاد «X من Y»، وسطر التلميح.
 *
 * البيانات حقيقية: مواعيد اليوم (نفس مصدر الترس السابق) + ملاحظة آخر متابعة
 * (LeadRow.lastNote خريطةً) + doneLeadIds (سُجّلت متابعتهم اليوم). عرض بحت.
 */

const MIN = 60_000;
const ZAIN = { fontFamily: "var(--font-zain), var(--font-sans)", fontVariantNumeric: "tabular-nums" as const };
const EASE = "cubic-bezier(.23,1,.32,1)";

type Status = "done" | "late" | "next" | "upcoming";

/** وقت الرياض بأرقام عربية + الفترة منفصلة. */
function fmtParts(d: Date): { clock: string; period: string } {
  const parts = new Intl.DateTimeFormat("ar-SA-u-nu-arab", { timeZone: "Asia/Riyadh", hour: "numeric", minute: "2-digit" }).formatToParts(d);
  const period = parts.find((p) => p.type === "dayPeriod")?.value ?? "";
  const clock = parts.filter((p) => p.type !== "dayPeriod").map((p) => p.value).join("").trim();
  return { clock, period };
}

function spanLabel(ms: number): string {
  const m = Math.max(1, Math.round(Math.abs(ms) / MIN));
  if (m < 60) return m === 1 ? "دقيقة" : m === 2 ? "دقيقتين" : `${toArabicDigits(m)} دقيقة`;
  const h = Math.round(m / 60);
  return h === 1 ? "ساعة" : h === 2 ? "ساعتين" : `${toArabicDigits(h)} ساعات`;
}

/** شيبة النوع — ألوان المرجع: زيارة سماوي · أول تواصل أزرق · متابعة ذهبي. */
function kindChip(kind: DayAppointment["kind"]): { label: string; color: string } {
  if (kind === "visit") return { label: "زيارة", color: MOBILE_COLORS.dwSky };
  if (kind === "new") return { label: "أول تواصل", color: MOBILE_COLORS.dwBlue };
  return { label: "متابعة", color: MOBILE_COLORS.gold };
}

/** سطر الحالة: تمّت · متعثر (فات بلا إنجاز) · التالي · قادمة. */
function statusText(st: Status, diff: number): { text: string; color: string } {
  if (st === "done") return { text: "تمّت — سجّلت متابعتها اليوم", color: MOBILE_COLORS.dwGreen };
  if (st === "late") return { text: `متعثر — فات من ${spanLabel(diff)}`, color: MOBILE_COLORS.dwAmber };
  if (st === "next") return { text: `التالي — بعد ${spanLabel(diff)}`, color: MOBILE_COLORS.gold };
  return { text: "قادمة", color: MOBILE_COLORS.textMuted };
}

export function DiwanCaroz({ appointments, notes, doneLeadIds }: {
  appointments: DayAppointment[];
  notes: Record<string, string | null>;
  doneLeadIds: string[];
}) {
  const done = useRef(new Set(doneLeadIds)).current;
  const [nowMs, setNowMs] = useState(() => Date.now());
  // يبدأ على «التالي» (أول موعد قادم) — نفس بداية المرجع.
  const [idx, setIdx] = useState(() => {
    const i = appointments.findIndex((a) => a.at.getTime() > Date.now() && !done.has(a.leadId));
    return i >= 0 ? i : Math.max(0, appointments.length - 1);
  });
  const holdRef = useRef(0);
  const startYRef = useRef<number | null>(null);
  const reducedRef = useRef(false);

  useEffect(() => {
    reducedRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // التنقّل التلقائي كل ٣.٥ث — يحترم reduced-motion ويتوقف ٩ث بعد أي لمسة.
  const count = appointments.length;
  useEffect(() => {
    if (count < 2) return;
    const t = setInterval(() => {
      if (reducedRef.current || Date.now() < holdRef.current) return;
      setIdx((i) => (i + 1) % count);
    }, 3500);
    return () => clearInterval(t);
  }, [count]);

  if (count === 0) {
    return (
      <div
        className="m-rise flex flex-col items-center"
        style={{
          boxSizing: "border-box", gap: 6, borderRadius: 20, padding: "26px 14px", marginTop: 4,
          background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.hair}`,
        }}
      >
        <span style={{ fontSize: 13, color: MOBILE_COLORS.textSecondary }}>ما عندك متابعات مجدولة اليوم</span>
      </div>
    );
  }

  const pause = (ms = 9000) => {
    holdRef.current = Date.now() + ms;
  };
  const firstUpcoming = appointments.findIndex((a) => a.at.getTime() > nowMs && !done.has(a.leadId));

  const statusOf = (a: DayAppointment, i: number): Status => {
    if (done.has(a.leadId)) return "done";
    if (a.at.getTime() < nowMs) return "late";
    if (i === firstUpcoming) return "next";
    return "upcoming";
  };

  return (
    <div className="m-rise relative" style={{ marginTop: 4, animationDelay: "140ms" }}>
      {/* ===== المسرح ٢٩٦px ===== */}
      <div
        className="relative overflow-hidden"
        style={{ height: 296, touchAction: "pan-x" }}
        onPointerDown={(e) => {
          startYRef.current = e.clientY;
          pause();
        }}
        onPointerUp={(e) => {
          if (startYRef.current === null) return;
          const dy = e.clientY - startYRef.current;
          startYRef.current = null;
          if (Math.abs(dy) > 34) {
            if (dy < 0 && idx < count - 1) setIdx(idx + 1);
            else if (dy > 0 && idx > 0) setIdx(idx - 1);
          }
        }}
      >
        {appointments.map((a, i) => {
          const off = i - idx;
          const active = off === 0;
          const st = statusOf(a, i);
          const chip = kindChip(a.kind);
          const line = statusText(st, Math.abs(a.at.getTime() - nowMs));
          const t = fmtParts(a.at);
          const note = notes[a.leadId]?.trim() || null;
          const transform =
            off === 0 ? "translateY(64px)"
            : off === -1 ? "translateY(0) scale(.94)"
            : off === 1 ? "translateY(232px) scale(.94)"
            : `translateY(${off < 0 ? -90 : 320}px) scale(.9)`;
          const hidden = Math.abs(off) > 1;
          return (
            <div
              key={a.leadId + a.at.toISOString()}
              onClick={() => {
                if (!active) {
                  pause();
                  setIdx(i);
                }
              }}
              style={{
                boxSizing: "border-box",
                position: "absolute", insetInline: 0,
                background: MOBILE_COLORS.card,
                border: `1px solid ${active ? MOBILE_COLORS.accA32 : MOBILE_COLORS.hair}`,
                borderRadius: 18, padding: "14px 15px",
                transform,
                zIndex: active ? 3 : hidden ? 1 : 2,
                opacity: hidden ? 0 : active ? 1 : 0.35,
                filter: st === "done" ? "saturate(.5)" : active ? "none" : "saturate(.7)",
                pointerEvents: active ? "auto" : hidden ? "none" : "auto",
                boxShadow: active ? `0 0 0 1px ${MOBILE_COLORS.accGlow}, 0 12px 34px rgba(0,0,0,.28)` : "none",
                transition: `transform .38s ${EASE}, opacity .38s ${EASE}, filter .38s ${EASE}`,
                willChange: "transform",
                cursor: active ? "default" : "pointer",
              }}
            >
              <div className="flex items-center" style={{ gap: 11 }}>
                <div className="flex-none text-center" style={{ width: 48 }}>
                  <div style={{ ...ZAIN, fontSize: 15, fontWeight: 800, color: st === "late" ? MOBILE_COLORS.dwAmber : MOBILE_COLORS.textPrimary }}>
                    {t.clock}
                  </div>
                  <div style={{ fontSize: 9, color: MOBILE_COLORS.textMuted, marginTop: 1 }}>{t.period}</div>
                </div>
                <div
                  className="min-w-0 flex-1 truncate"
                  style={{
                    fontSize: 13.5, fontWeight: 600,
                    color: st === "done" ? MOBILE_COLORS.textSecondary : MOBILE_COLORS.textPrimary,
                    textDecoration: st === "done" ? "line-through" : "none",
                  }}
                >
                  {a.name}
                </div>
                <div className="flex flex-none" style={{ gap: 6 }}>
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

              <div style={{ fontSize: 10, fontWeight: 500, color: line.color, marginTop: 2 }}>{line.text}</div>

              {active && note && (
                <p
                  style={{
                    fontSize: 11, color: MOBILE_COLORS.textSecondary, lineHeight: 1.7, marginTop: 9,
                    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
                  }}
                >
                  {note}
                </p>
              )}

              {active && (
                <div className="flex" style={{ gap: 7, marginTop: 11 }}>
                  <a
                    href={`tel:${a.phone}`}
                    onClick={() => markCall(a.leadId)}
                    className="m-press flex flex-1 items-center justify-center"
                    style={{
                      boxSizing: "border-box", borderRadius: 11, padding: "9px 0",
                      background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg,
                      fontSize: 11.5, fontWeight: 600, gap: 6,
                    }}
                  >
                    <Phone size={13} strokeWidth={1.8} aria-hidden />
                    اتصال
                  </a>
                  <a
                    href={`https://wa.me/${waPhone(a.phone)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="m-press flex flex-1 items-center justify-center"
                    style={{
                      boxSizing: "border-box", borderRadius: 11, padding: "9px 0",
                      boxShadow: `inset 0 0 0 1px ${MOBILE_COLORS.hair}`,
                      color: MOBILE_COLORS.textPrimary, fontSize: 11.5, fontWeight: 600, gap: 6,
                    }}
                  >
                    <MessageCircle size={13} strokeWidth={1.8} style={{ color: MOBILE_COLORS.dwGreen }} aria-hidden />
                    واتساب
                  </a>
                  <Link
                    href={`/m/leads/${a.leadId}`}
                    aria-label={`ملف العميل ${a.name}`}
                    className="m-press flex flex-none items-center justify-center"
                    style={{
                      boxSizing: "border-box", width: 42, borderRadius: 11,
                      boxShadow: `inset 0 0 0 1px ${MOBILE_COLORS.hair}`,
                      color: MOBILE_COLORS.textSecondary,
                    }}
                  >
                    <ChevronLeft size={15} strokeWidth={1.8} aria-hidden />
                  </Link>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ===== شريط التحكم: أسهم + نقاط + عدّاد ===== */}
      <div className="flex items-center" style={{ gap: 12, marginTop: 12 }}>
        <div className="flex" style={{ gap: 6 }}>
          <button
            type="button"
            aria-label="السابق"
            className="m-press flex items-center justify-center"
            onClick={() => {
              pause();
              if (idx > 0) setIdx(idx - 1);
            }}
            style={{
              boxSizing: "border-box", width: 36, height: 36, borderRadius: 12,
              border: `1px solid ${MOBILE_COLORS.hair}`, background: MOBILE_COLORS.card, color: MOBILE_COLORS.textSecondary,
            }}
          >
            <ChevronUp size={15} strokeWidth={1.8} aria-hidden />
          </button>
          <button
            type="button"
            aria-label="التالي"
            className="m-press flex items-center justify-center"
            onClick={() => {
              pause();
              if (idx < count - 1) setIdx(idx + 1);
            }}
            style={{
              boxSizing: "border-box", width: 36, height: 36, borderRadius: 12,
              border: `1px solid ${MOBILE_COLORS.hair}`, background: MOBILE_COLORS.card, color: MOBILE_COLORS.textSecondary,
            }}
          >
            <ChevronDown size={15} strokeWidth={1.8} aria-hidden />
          </button>
        </div>
        <div className="flex flex-1 items-center justify-center" style={{ gap: 4 }}>
          {appointments.map((_, i) => (
            <i
              key={i}
              style={{
                width: i === idx ? 16 : 4, height: 4,
                borderRadius: i === idx ? 3 : "50%",
                background: i === idx ? MOBILE_COLORS.gold : MOBILE_COLORS.border,
                transition: `all .3s ${EASE}`,
              }}
            />
          ))}
        </div>
        <span className="flex-none" style={{ fontSize: 10.5, color: MOBILE_COLORS.textMuted }}>
          <b style={{ ...ZAIN, color: MOBILE_COLORS.gold, fontWeight: 700 }}>{toArabicDigits(idx + 1)}</b> من{" "}
          <span style={ZAIN}>{toArabicDigits(count)}</span>
        </span>
      </div>

      <div className="text-center" style={{ fontSize: 9.5, color: MOBILE_COLORS.textMuted, marginTop: 8 }}>
        يتنقّل تلقائيًا كل ثوانٍ — والمسة منك توقفه مؤقتًا
      </div>
    </div>
  );
}

export default DiwanCaroz;
