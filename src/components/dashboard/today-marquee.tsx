"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toArabicDigits } from "@/lib/format";
import type { TodayAppointment } from "@/lib/data/dashboard";

/**
 * شريط مواعيد اليوم — لوحة الموظف فقط:
 * حلقة لا نهائية سلسة (rAF + translateX، المحتوى مكرر مرتين — لا قفزة عند الالتفاف)،
 * hover يبطّئ الحركة ولا يوقفها (سرعة تنساب نحو هدفها)، والنقر يفتح ملف العميل.
 * السرعة ثابتة بالبكسل/ثانية — فمدة اللفة تتناسب طبيعيًا مع عدد العناصر.
 * الفائت: نبض أحمر + «فات موعده» · القادم خلال ساعة: توهج ذهبي · تلاشٍ على الطرفين.
 * موعد واحد فقط: بطاقة ثابتة وسط الشريط بلا لف.
 */
const RIYADH_TZ = "Asia/Riyadh";
const SPEED = 32;        // بكسل/ثانية — هادئة مريحة
const HOVER_SPEED = 9;   // hover: تبطئة لا توقّف
const HOUR_MS = 3_600_000;

function timeLabel(at: Date): string {
  return new Intl.DateTimeFormat("ar-SA-u-nu-arab", { timeZone: RIYADH_TZ, hour: "numeric", minute: "2-digit" }).format(at);
}

/** بطاقة موعد واحدة — أيقونة النوع + الاسم + الوقت، بحدود ذهبية خفيفة وخلفية داكنة شفافة. */
function Chip({ a, now }: { a: TodayAppointment; now: number }) {
  const at = new Date(a.at).getTime();
  const past = at < now;
  const soon = !past && at - now <= HOUR_MS;
  return (
    <Link
      href={`/leads/${a.leadId}`}
      dir="rtl"
      title={past ? "فات وقته — بادر الآن" : soon ? "خلال ساعة — استعد" : "موعد اليوم"}
      className={`inline-flex shrink-0 items-center gap-2 rounded-xl border bg-card/70 px-3 py-1.5 text-xs transition-colors hover:bg-secondary/70 ${
        past
          ? "border-destructive/40"
          : soon
            ? "border-gold/60 shadow-[0_0_14px_rgba(203,164,94,0.35)]"
            : "border-gold/30"
      }`}
    >
      <span className="text-sm">{a.kind === "visit" ? "🏠" : "📅"}</span>
      <span className="font-medium text-foreground">{a.name}</span>
      <span className={soon ? "font-semibold text-gold" : "text-muted-foreground"}>{timeLabel(new Date(a.at))}</span>
      {past && (
        <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-bold text-destructive">
          <span className="size-1.5 animate-pulse rounded-full bg-destructive" /> فات موعده
        </span>
      )}
    </Link>
  );
}

export function TodayMarquee({ items }: { items: TodayAppointment[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const speedRef = useRef(SPEED);
  const targetSpeedRef = useRef(SPEED);
  const [now, setNow] = useState(() => Date.now());

  // تحديث «الفائت/القادم» كل دقيقة بلا إعادة بناء الحلقة.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const loop = items.length > 1; // موعد واحد: ثابت بلا لف

  // الجوال بلا hover: اللمس يوقف الشريط تمامًا (٦ ثوانٍ) عشان يُقرأ ويُنقر بلا مطاردة،
  // ثم يستأنف وحده. واحترام «تقليل الحركة» في إعدادات الجهاز: بلا لف إطلاقًا.
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function holdForTouch() {
    targetSpeedRef.current = 0;
    speedRef.current = 0;
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => { targetSpeedRef.current = SPEED; }, 6000);
  }
  useEffect(() => () => { if (resumeTimer.current) clearTimeout(resumeTimer.current); }, []);

  useEffect(() => {
    if (!loop) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = Math.min((t - last) / 1000, 0.1);
      last = t;
      // انسياب السرعة نحو هدفها (تبطئة hover ناعمة بلا اهتزاز).
      speedRef.current += (targetSpeedRef.current - speedRef.current) * Math.min(1, dt * 6);
      const el = trackRef.current;
      if (el) {
        const half = el.scrollWidth / 2; // المحتوى مكرر مرتين — الالتفاف عند النصف = بلا قفزة
        offsetRef.current = (offsetRef.current + speedRef.current * dt) % (half || 1);
        el.style.transform = `translateX(${offsetRef.current}px)`; // RTL: يلف نحو اليمين
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [loop, items.length]);

  if (items.length === 0) return null;

  const chips = (dup: string) => items.map((a, i) => <Chip key={`${dup}-${a.leadId}-${i}`} a={a} now={now} />);

  return (
    <div
      className="relative mb-4 overflow-hidden rounded-xl border border-border bg-card/60 py-2"
      aria-label="مواعيد اليوم"
      onMouseEnter={() => { targetSpeedRef.current = HOVER_SPEED; }}
      onMouseLeave={() => { targetSpeedRef.current = SPEED; }}
      onTouchStart={holdForTouch}
    >
      <div className="flex items-center">
        {/* عدّاد ثابت في بداية الشريط — مختصر على الجوال حتى يبقى عرض كافٍ للبطاقات */}
        <div className="z-10 flex shrink-0 items-center gap-1.5 border-l border-gold/20 bg-card/90 px-2 py-1 text-xs font-semibold text-gold sm:px-3">
          <span className="hidden sm:inline">مواعيد اليوم:</span>
          <span className="sm:hidden">📅</span>
          {toArabicDigits(items.length)}
        </div>

        {loop ? (
          <div className="relative flex-1 overflow-hidden">
            {/* تدرّج تلاشٍ على الطرفين — مدخل ومخرج ناعمان */}
            <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10" style={{ background: "linear-gradient(to left, var(--card), transparent)" }} />
            <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10" style={{ background: "linear-gradient(to right, var(--card), transparent)" }} />
            {/* المسار: المحتوى مكرر مرتين — الحلقة تلتف عند نصف العرض فلا تُرى أي قفزة */}
            <div ref={trackRef} className="inline-flex w-max items-center gap-3 pr-3 will-change-transform" style={{ direction: "ltr" }}>
              {chips("a")}
              {chips("b")}
            </div>
          </div>
        ) : (
          /* موعد واحد فقط — ثابت وسط الشريط بلا لف */
          <div className="flex flex-1 justify-center py-0.5">{chips("solo")}</div>
        )}
      </div>
    </div>
  );
}
