"use client";

import { useEffect, useRef, useState } from "react";
import { toArabicDigits } from "@/lib/format";

/**
 * الخطوة ٤: عدّاد تنازلي حي لسحب «لم يتم الرد» — للموظف فقط.
 * حلقة SVG (~٢٨px) تفرغ بنسبة الوقت المستهلك من المهلة. البيانات محسوبة على الخادم
 * (LeadRow.pull) وتُحسب النسبة محليًا — صفر استعلامات، وتحديث كل دقيقة بمؤقّت واحد مشترك.
 *   grace: ذهبي · warning: أحمر نابض · أقل من ٦ ساعات: نبض أسرع + توهّج ·
 *   noAnswerCount≥3 (سحب فوري): أيقونة ⚠ حمراء ثابتة بدل الحلقة.
 * حركة الإنقاذ: اختفاء العدّاد بعد متابعة → تعبئة خضراء ثم تلاشٍ (CSS فقط).
 */
export type PullInfo = {
  state: "grace" | "warning" | "overdue";
  baselineMs: number;
  deadlineMs: number;
  noAnswerCount: number;
};

// مؤقّت دقيقة واحد مشترك بين كل الحلقات المعروضة — لا مؤقّت لكل بطاقة.
const tickListeners = new Set<() => void>();
let tickTimer: ReturnType<typeof setInterval> | null = null;

function useMinuteNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const cb = () => setNow(Date.now());
    tickListeners.add(cb);
    if (!tickTimer) tickTimer = setInterval(() => tickListeners.forEach((l) => l()), 60_000);
    return () => {
      tickListeners.delete(cb);
      if (tickListeners.size === 0 && tickTimer) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
    };
  }, []);
  return now;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** «يوم و٣ ساعات» / «٥ ساعات» / «أقل من ساعة» — للتلميح. */
function remainingLabel(ms: number): string {
  if (ms <= 0) return "الآن";
  const days = Math.floor(ms / DAY_MS);
  const hours = Math.floor((ms % DAY_MS) / HOUR_MS);
  const dayPart = days === 1 ? "يوم" : days === 2 ? "يومين" : days > 2 ? `${toArabicDigits(days)} أيام` : "";
  const hourPart = hours === 1 ? "ساعة" : hours === 2 ? "ساعتين" : hours > 2 ? `${toArabicDigits(hours)} ساعات` : "";
  if (dayPart && hourPart) return `${dayPart} و${hourPart}`;
  if (dayPart) return dayPart;
  if (hourPart) return hourPart;
  return "أقل من ساعة";
}

const SIZE = 28;
const R = 11;
const CIRC = 2 * Math.PI * R;

export function PullCountdown({ pull }: { pull: PullInfo | null }) {
  const now = useMinuteNow();
  // حركة الإنقاذ: كانت الحلقة ظاهرة واختفت (متابعة أنقذت العميل) → تعبئة خضراء ثم تلاشٍ.
  const [rescue, setRescue] = useState<"fill" | "fade" | null>(null);
  const prev = useRef<PullInfo | null>(pull);
  useEffect(() => {
    if (prev.current && !pull) {
      setRescue("fill");
      const fadeT = setTimeout(() => setRescue("fade"), 650); // بعد اكتمال التعبئة (~600ms)
      const endT = setTimeout(() => setRescue(null), 1300);
      prev.current = pull;
      return () => { clearTimeout(fadeT); clearTimeout(endT); };
    }
    prev.current = pull;
  }, [pull]);

  if (!pull && rescue) {
    // حلقة خضراء تمتلئ ثم تتلاشى — CSS transitions فقط.
    return (
      <span className="inline-flex shrink-0 items-center" style={{ width: SIZE, height: SIZE }} aria-hidden>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="transition-opacity duration-500"
          style={{ opacity: rescue === "fade" ? 0 : 1 }}>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="currentColor" strokeOpacity={0.15} strokeWidth={3} className="text-success" />
          <circle
            cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none"
            stroke="var(--color-success, #22c55e)" strokeWidth={3} strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={rescue === "fill" ? CIRC * 0.02 : 0}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            style={{ transition: "stroke-dashoffset 600ms ease-out" }}
          />
        </svg>
      </span>
    );
  }
  if (!pull) return null;

  // سحب فوري (count ≥ حد السحب — ٣ افتراضيًا): أيقونة ⚠ ثابتة بدل الحلقة.
  if (pull.noAnswerCount >= 3) {
    return (
      <span
        title="سحب فوري: تابعته ٣ مرات وما رد — يُسحب الآن"
        className="inline-flex shrink-0 items-center justify-center text-sm font-bold text-destructive"
        style={{ width: SIZE, height: SIZE }}
      >⚠</span>
    );
  }

  const total = Math.max(1, pull.deadlineMs - pull.baselineMs);
  const consumed = Math.min(1, Math.max(0, (now - pull.baselineMs) / total));
  const remainingMs = pull.deadlineMs - now;
  const urgent = remainingMs > 0 && remainingMs < 6 * HOUR_MS;
  const danger = pull.state !== "grace" || urgent;
  const color = danger ? "var(--color-destructive, #ef4444)" : "#CBA45E";
  const title = remainingMs <= 0 ? "يُسحب الآن" : `يُسحب خلال: ${remainingLabel(remainingMs)}`;

  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center rounded-full ${urgent ? "animate-pull-urgent" : danger ? "animate-pulse" : ""}`}
      style={{
        width: SIZE, height: SIZE,
        ...(urgent ? { boxShadow: "0 0 8px 1px rgba(239,68,68,0.45)" } : {}),
      }}
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke={color} strokeOpacity={0.18} strokeWidth={3} />
        <circle
          cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none"
          stroke={color} strokeWidth={3} strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * consumed}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          style={{ transition: "stroke-dashoffset 600ms ease-out" }}
        />
      </svg>
    </span>
  );
}
