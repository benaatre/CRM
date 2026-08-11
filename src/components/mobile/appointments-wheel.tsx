"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import type { DayAppointment } from "@/lib/mobile-agenda";
import { MOBILE_COLORS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";
import { avatarColor, avatarInitials } from "@/lib/mobile-avatar";
import { waPhone } from "@/lib/value-normalize";
import { markCall } from "@/lib/mobile-call-tracker";

/**
 * ترس «مواعيد اليوم» — قصاصة السابق فوق، الكرت الحالي كامل، قصاصة التالي تحت.
 * client بمؤقّت ٣٠ ثانية (نفس إيقاع البانر، مع cleanup) لحالات فاتت/الآن/قادمة.
 * التنقل: سحب عمودي (عتبة ٤٥px) + أسهم + نقاط + نقر القصاصة + عجلة الماوس.
 * القياس ديناميكي: ارتفاع الحاوية يُقاس من الكرت المركزي (فورًا + 240ms + 480ms).
 */

const MIN = 60_000;
const CLIP_H = 64;
const GAP = 10;
const ZAIN = { fontFamily: "var(--font-zain), var(--font-sans)" };
const EASE = "cubic-bezier(.3,1.15,.35,1)";

type Status = "past" | "now" | "upcoming";

function statusOf(a: DayAppointment, nowMs: number): Status {
  const d = a.at.getTime() - nowMs;
  if (d < 0) return "past";
  if (d <= 60 * MIN) return "now";
  return "upcoming";
}

/** لون النوع: زيارة كهرماني · متابعة ذهبي · عميل جديد أزرق — والفائت أحمر دائمًا. */
function toneOf(a: DayAppointment, st: Status): { base: string; bg: string } {
  if (st === "past") return { base: MOBILE_COLORS.rose, bg: MOBILE_COLORS.roseBg };
  if (a.kind === "visit") return { base: MOBILE_COLORS.amber, bg: MOBILE_COLORS.amberBg };
  if (a.kind === "new") return { base: MOBILE_COLORS.sky, bg: MOBILE_COLORS.skyBg };
  return { base: MOBILE_COLORS.gold, bg: MOBILE_COLORS.goldBg };
}

function fmtParts(d: Date): { clock: string; period: string } {
  const parts = new Intl.DateTimeFormat("ar-SA-u-nu-arab", { timeZone: "Asia/Riyadh", hour: "numeric", minute: "2-digit" }).formatToParts(d);
  const period = parts.find((p) => p.type === "dayPeriod")?.value ?? "";
  const clock = parts.filter((p) => p.type !== "dayPeriod").map((p) => p.value).join("").trim();
  return { clock, period };
}

function minsOrHours(ms: number): string {
  const m = Math.max(1, Math.round(Math.abs(ms) / MIN));
  if (m < 60) return m === 1 ? "دقيقة" : m === 2 ? "دقيقتين" : `${toArabicDigits(m)} ${m <= 10 ? "دقائق" : "دقيقة"}`;
  const h = Math.round(m / 60);
  return h === 1 ? "ساعة" : h === 2 ? "ساعتين" : `${toArabicDigits(h)} ساعات`;
}

/** صف مصغّر (قصاصة): أفاتار ٤٦ + اسم ١٧ + جوال + صندوق وقت — سطر واحد. */
function ClipRow({ a, st, onPick }: { a: DayAppointment; st: Status; onPick: () => void }) {
  const tone = toneOf(a, st);
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex w-full items-center"
      style={{
        boxSizing: "border-box", height: CLIP_H, gap: 10, padding: "0 12px",
        background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
        borderRadius: 14, opacity: 0.5, transform: "scale(.93)", filter: "blur(1.2px)",
        transition: `opacity .5s ${EASE}, transform .5s ${EASE}`,
      }}
    >
      <span
        className="flex flex-none items-center justify-center"
        style={{
          width: 46, height: 46, borderRadius: 23, fontSize: 15, fontWeight: 700,
          background: avatarColor(a.name), color: "var(--m-bg)",
        }}
      >
        {avatarInitials(a.name)}
      </span>
      <span className="min-w-0 flex-1 text-right">
        <span className="block truncate" style={{ fontSize: 17, fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>{a.name}</span>
        <span dir="ltr" className="block truncate text-right" style={{ fontSize: 11.5, color: MOBILE_COLORS.textMuted }}>{a.phone}</span>
      </span>
      <span
        className="flex-none"
        style={{
          boxSizing: "border-box", borderRadius: 10, padding: "5px 9px",
          background: tone.bg, color: tone.base, fontSize: 13, fontWeight: 700, ...ZAIN,
        }}
      >
        {fmtParts(a.at).clock}
      </span>
    </button>
  );
}

export function AppointmentsWheel({ appointments }: { appointments: DayAppointment[] }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // الفتح التلقائي على أول موعد لم يفت — كلها فاتت → أولها.
  const [idx, setIdx] = useState(() => {
    const n = Date.now();
    const i = appointments.findIndex((a) => a.at.getTime() >= n);
    return i === -1 ? 0 : i;
  });
  const clamped = Math.min(idx, appointments.length - 1);

  // القياس الديناميكي: فورًا + إعادة قياس بعد 240ms و480ms (تتابع المحتوى الداخلي).
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(0);
  useLayoutEffect(() => {
    const measure = () => { if (cardRef.current) setCardH(cardRef.current.offsetHeight); };
    measure();
    const t1 = setTimeout(measure, 240);
    const t2 = setTimeout(measure, 480);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [clamped, appointments.length]);

  // سحب عمودي بعتبة ٤٥px.
  const touchStart = useRef<number | null>(null);
  const go = (dir: 1 | -1) => setIdx((i) => Math.max(0, Math.min(appointments.length - 1, Math.min(i, appointments.length - 1) + dir)));

  if (appointments.length === 0) return null;

  const a = appointments[clamped];
  const st = statusOf(a, nowMs);
  const tone = toneOf(a, st);
  const prev = clamped > 0 ? appointments[clamped - 1] : null;
  const next = clamped < appointments.length - 1 ? appointments[clamped + 1] : null;
  const containerH = (prev ? CLIP_H + GAP : 0) + (cardH || 0) + (next ? GAP + CLIP_H : 0);
  const diff = a.at.getTime() - nowMs;

  return (
    <div className="flex flex-col" style={{ gap: 10 }}>
      {/* الحاوية — ارتفاع مقيس + سحب/عجلة */}
      <div
        style={{
          height: containerH || undefined,
          transition: `height .5s ${EASE}`,
          touchAction: "none",
          overflow: "hidden",
        }}
        onTouchStart={(e) => { touchStart.current = e.touches[0].clientY; }}
        onTouchEnd={(e) => {
          if (touchStart.current == null) return;
          const d = e.changedTouches[0].clientY - touchStart.current;
          touchStart.current = null;
          if (d <= -45) go(1);       // سحب لأعلى → التالي
          else if (d >= 45) go(-1);  // سحب لأسفل → السابق
        }}
        onWheel={(e) => { if (Math.abs(e.deltaY) > 8) go(e.deltaY > 0 ? 1 : -1); }}
      >
        <div className="flex flex-col" style={{ gap: GAP }}>
          {prev && <ClipRow a={prev} st={statusOf(prev, nowMs)} onPick={() => go(-1)} />}

          {/* الكرت المركزي — key يعيد الدخول المتتابع عند تغيير الفهرس */}
          <div
            key={clamped}
            ref={cardRef}
            className={`m-rise relative overflow-hidden${st === "now" ? " m-breathe" : ""}`}
            style={{
              boxSizing: "border-box",
              background: MOBILE_COLORS.card,
              border: `1px solid ${st === "past" ? MOBILE_COLORS.rose : MOBILE_COLORS.border}`,
              borderRadius: 18, padding: "13px 14px",
            }}
          >
            {/* الخط الجانبي المتوهّج بلون النوع/الحالة */}
            <span
              aria-hidden
              style={{
                position: "absolute", insetInlineStart: 0, top: 10, bottom: 10, width: 4,
                borderRadius: 3, background: tone.base, boxShadow: `0 0 12px ${tone.base}`,
              }}
            />

            <div className="flex items-center" style={{ gap: 11 }}>
              <span
                className="flex flex-none items-center justify-center"
                style={{
                  width: 48, height: 48, borderRadius: 24, fontSize: 16, fontWeight: 700,
                  background: avatarColor(a.name), color: "var(--m-bg)",
                }}
              >
                {avatarInitials(a.name)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center" style={{ gap: 7 }}>
                  <span className="truncate" style={{ fontSize: 17.5, fontWeight: 800, color: MOBILE_COLORS.textPrimary }}>{a.name}</span>
                  {st === "past" && (
                    <span style={{ boxSizing: "border-box", flexShrink: 0, borderRadius: 7, padding: "2px 8px", fontSize: 10.5, fontWeight: 700, background: MOBILE_COLORS.roseBg, color: MOBILE_COLORS.rose }}>فاتت</span>
                  )}
                  {st === "now" && (
                    <span style={{ boxSizing: "border-box", flexShrink: 0, borderRadius: 7, padding: "2px 8px", fontSize: 10.5, fontWeight: 700, background: MOBILE_COLORS.amberBg, color: MOBILE_COLORS.amber }}>الآن</span>
                  )}
                </div>
                <div dir="ltr" className="truncate text-right" style={{ fontSize: 13, color: MOBILE_COLORS.textMuted, marginTop: 3 }}>{a.phone}</div>
              </div>
              <div
                className="flex-none text-center"
                style={{
                  boxSizing: "border-box", borderRadius: 12, padding: "7px 11px",
                  background: tone.bg, border: `1px solid ${MOBILE_COLORS.border}`,
                }}
              >
                <div style={{ ...ZAIN, fontSize: 18, fontWeight: 800, lineHeight: 1, color: tone.base }}>{fmtParts(a.at).clock}</div>
                <div style={{ fontSize: 10.5, color: MOBILE_COLORS.textMuted, marginTop: 3 }}>{fmtParts(a.at).period}</div>
              </div>
            </div>

            {/* سطر السبب — متتابع (.14s) */}
            <div
              className="m-rise"
              style={{
                boxSizing: "border-box", marginTop: 11, borderRadius: 11, padding: "8px 11px",
                background: MOBILE_COLORS.bg, border: `1px solid ${MOBILE_COLORS.line2}`,
                fontSize: 12.5, color: MOBILE_COLORS.textSecondary, lineHeight: 1.6,
                animationDelay: ".14s",
              }}
            >
              {a.reason}
            </div>

            {/* سطر الحالة الزمنية */}
            {st !== "upcoming" && (
              <div
                className="m-rise"
                style={{ fontSize: 12, fontWeight: 600, marginTop: 8, color: st === "past" ? MOBILE_COLORS.rose : MOBILE_COLORS.amber, animationDelay: ".18s" }}
              >
                {st === "past" ? `⚠️ فات الموعد من ${minsOrHours(diff)} — اتصل الحين` : `🔥 بعد ${minsOrHours(diff)} — جهّز نفسك`}
              </div>
            )}

            {/* الأزرار — متتابعة (.22s) */}
            <div className="m-rise flex" style={{ gap: 8, marginTop: 11, animationDelay: ".22s" }}>
              <a
                href={`tel:${a.phone}`}
                onClick={() => markCall(a.leadId)}
                className="m-press flex flex-1 items-center justify-center"
                style={{
                  boxSizing: "border-box", height: 44, borderRadius: 12, border: "none",
                  background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg, fontSize: 13.5, fontWeight: 700, gap: 6,
                }}
              >
                📞 اتصال
              </a>
              <a
                href={`https://wa.me/${waPhone(a.phone)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="m-press flex flex-1 items-center justify-center"
                style={{
                  boxSizing: "border-box", height: 44, borderRadius: 12,
                  background: MOBILE_COLORS.sheet, border: `1px solid ${MOBILE_COLORS.border}`,
                  color: MOBILE_COLORS.textPrimary, fontSize: 13.5, fontWeight: 600, gap: 6,
                }}
              >
                💬 واتساب
              </a>
              <Link
                href={`/m/leads/${a.leadId}`}
                aria-label={`ملف العميل ${a.name}`}
                className="m-press flex flex-none items-center justify-center"
                style={{
                  boxSizing: "border-box", width: 46, height: 44, borderRadius: 12,
                  background: MOBILE_COLORS.sheet, border: `1px solid ${MOBILE_COLORS.border}`,
                  color: MOBILE_COLORS.textSecondary, fontSize: 16,
                }}
              >
                ←
              </Link>
            </div>
          </div>

          {next && <ClipRow a={next} st={statusOf(next, nowMs)} onPick={() => go(1)} />}
        </div>
      </div>

      {/* التحكم: أسهم + نقاط تقدّم */}
      <div className="flex items-center justify-between">
        <div className="flex" style={{ gap: 7 }}>
          <button
            type="button" aria-label="الموعد السابق" onClick={() => go(-1)} disabled={clamped === 0}
            className="m-press flex items-center justify-center"
            style={{
              boxSizing: "border-box", width: 48, height: 48, borderRadius: 13,
              background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
              color: MOBILE_COLORS.textSecondary, fontSize: 17, opacity: clamped === 0 ? 0.35 : 1,
            }}
          >↑</button>
          <button
            type="button" aria-label="الموعد التالي" onClick={() => go(1)} disabled={clamped === appointments.length - 1}
            className="m-press flex items-center justify-center"
            style={{
              boxSizing: "border-box", width: 48, height: 48, borderRadius: 13,
              background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
              color: MOBILE_COLORS.textSecondary, fontSize: 17, opacity: clamped === appointments.length - 1 ? 0.35 : 1,
            }}
          >↓</button>
        </div>
        {/* عدّاد «X من Y» — يتبع الفهرس الحي */}
        <span style={{ fontSize: 11.5, color: MOBILE_COLORS.textMuted }}>
          {toArabicDigits(clamped + 1)} من {toArabicDigits(appointments.length)}
        </span>
        <div className="flex items-center" style={{ gap: 5 }}>
          {appointments.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`الموعد ${toArabicDigits(i + 1)}`}
              onClick={() => setIdx(i)}
              style={{
                boxSizing: "border-box", height: 8, borderRadius: 4, border: "none", padding: 0,
                width: i === clamped ? 24 : 8,
                background: i === clamped ? MOBILE_COLORS.gold : MOBILE_COLORS.dim2,
                boxShadow: i === clamped ? `0 0 10px ${MOBILE_COLORS.goldBg}` : undefined,
                transition: `width .3s ${EASE}, background .3s`,
              }}
            />
          ))}
        </div>
      </div>
      <div style={{ fontSize: 11, color: MOBILE_COLORS.textMuted, textAlign: "center" }}>
        اسحب لأعلى/أسفل — أو اضغط الكرت الظاهر
      </div>
    </div>
  );
}

export default AppointmentsWheel;
