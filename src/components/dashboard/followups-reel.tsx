"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Phone, MessageCircle, ChevronLeft, ChevronUp, ChevronDown, Building2, AlertTriangle } from "lucide-react";
import type { TodayAppointment } from "@/lib/data/dashboard";
import { stageLabels } from "@/lib/labels";
import { waPhone } from "@/lib/value-normalize";
import { formatTime, toArabicDigits } from "@/lib/format";
import { DAY_MS } from "@/lib/ksa-time";

/**
 * بكرة «باقي اليوم» — متابعات اليوم على محور رأسي ثلاثي الأبعاد (perspective +
 * rotateX + translateZ). الوسطى مكبّرة بتدرّج ذهبي وأزرارها ظاهرة، والمجاورتان
 * تميلان وتبهتان، والأبعدان يصغران ويتضببان، مع قناع تلاشٍ أعلى وأسفل.
 *
 * عرض خالص: البيانات تصل props من المكوّن الخادمي (نفس todayAppointments) —
 * صفر استعلامات وصفر أفعال خادم.
 *
 * ⚠️ إدارة المؤقّتات: التشغيل التلقائي مشتقّ من حالة واحدة (`running`) يملكها
 * useEffect واحد — فأي تغيّر ينظّف الفاصل السابق قبل إنشاء غيره، ويستحيل وجود
 * أكثر من setInterval واحد. قفل العجلة بطابع زمني لا بمؤقّت (فلا مؤقّت معلّق).
 */

const STEP_MS = 4200;
const HOLD_MS = 9000;
const WHEEL_LOCK_MS = 420;
const DRAG_PX = 50;

/** موضع البطاقة على المحور: 0 الوسطى · ±1 المجاورة · ±2 البعيدة · غيرها مخفية. */
function slotStyle(d: number): React.CSSProperties {
  if (d === 0) return { transform: "translateY(0) translateZ(50px)", opacity: 1, zIndex: 10, marginTop: -56 };
  if (d === 1) return { transform: "translateY(94px) translateZ(-70px) rotateX(-26deg) scale(.93)", opacity: 0.5 };
  if (d === -1) return { transform: "translateY(-94px) translateZ(-70px) rotateX(26deg) scale(.93)", opacity: 0.5 };
  if (d === 2) return { transform: "translateY(172px) translateZ(-200px) rotateX(-40deg) scale(.84)", opacity: 0.2, filter: "blur(1px)" };
  if (d === -2) return { transform: "translateY(-172px) translateZ(-200px) rotateX(40deg) scale(.84)", opacity: 0.2, filter: "blur(1px)" };
  return { transform: "translateZ(-360px) scale(.6)", opacity: 0, pointerEvents: "none" };
}

function timeParts(at: Date) {
  const t = formatTime(at);
  return { clock: t.replace(/\s*[صم]$/, ""), mer: /\sص$/.test(t) ? "صباحًا" : "مساءً" };
}

function subtitleOf(a: TodayAppointment): string {
  const head = a.projectName ? `${stageLabels[a.stage]} · ${a.projectName}` : stageLabels[a.stage];
  return a.lastNote ? `${head} — ${a.lastNote.text}` : head;
}

/** «فات من X» — دقائق تحت الساعة، ثم ساعات، ثم أيام (صياغة عربية دقيقة). */
function lateLabel(ms: number): string {
  const mins = Math.max(1, Math.floor(ms / 60_000));
  if (mins < 60) return `فات من ${toArabicDigits(mins)} ${mins <= 10 ? "دقائق" : "دقيقة"}`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 24) {
    return `فات من ${hours === 1 ? "ساعة" : hours === 2 ? "ساعتين" : `${toArabicDigits(hours)} ${hours <= 10 ? "ساعات" : "ساعة"}`}`;
  }
  const days = Math.floor(ms / DAY_MS);
  return `فات من ${days === 1 ? "يوم" : days === 2 ? "يومين" : `${toArabicDigits(days)} ${days <= 10 ? "أيام" : "يومًا"}`}`;
}

export function FollowupsReel({ items, zainClass }: { items: TodayAppointment[]; zainClass: string }) {
  const count = items.length;
  const [cur, setCur] = useState(0);
  // ساعة حيّة لحساب «فات من X» — مؤقّت مستقل بتنظيفه (لا يتوقف مع الدوران).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const [hovering, setHovering] = useState(false);
  const [held, setHeld] = useState(false);
  const [inView, setInView] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);
  const [reduced, setReduced] = useState(false);

  const reelRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // البكرة بلا معنى لأقل من ٣ عناصر — تُعرض قائمة عادية (انظر أسفل الملف).
  const isReel = count >= 3;

  /** الحالات الخمس للإيقاف مجتمعة في مشتقّ واحد — مصدر الحقيقة للتشغيل. */
  const running = isReel && !reduced && !hovering && !held && inView && tabVisible;

  const goTo = useCallback((i: number) => {
    setCur(((i % count) + count) % count);
  }, [count]);
  const go = useCallback((d: number) => setCur((c) => ((c + d) % count + count) % count), [count]);

  /** أي تفاعل يُجمّد الدوران ٩ ثوانٍ ثم يستأنف. */
  const bump = useCallback(() => {
    setHeld(true);
    if (holdRef.current) clearTimeout(holdRef.current);
    holdRef.current = setTimeout(() => setHeld(false), HOLD_MS);
  }, []);
  useEffect(() => () => { if (holdRef.current) clearTimeout(holdRef.current); }, []);

  // ===== الدوران التلقائي: فاصل واحد يملكه هذا الأثر وحده =====
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setCur((c) => (c + 1) % count), STEP_MS);
    return () => clearInterval(id);
  }, [running, count]);

  // ===== شريط التقدّم — Web Animations API (بلا keyframes في ملف مشترك) =====
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || !running || typeof bar.animate !== "function") return;
    const anim = bar.animate(
      [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
      { duration: STEP_MS, iterations: Infinity, easing: "linear" },
    );
    return () => anim.cancel();
  }, [running, cur]);

  // ===== تفضيل تقليل الحركة =====
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // ===== إخفاء التبويب =====
  useEffect(() => {
    const on = () => setTabVisible(!document.hidden);
    on();
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);

  // ===== خروج القسم من الشاشة =====
  useEffect(() => {
    const el = reelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const ob = new IntersectionObserver((es) => setInView(es[0]?.isIntersecting ?? true), { threshold: 0.35 });
    ob.observe(el);
    return () => ob.disconnect();
  }, [isReel]);

  // ===== العجلة (قفل بطابع زمني — بلا مؤقّت معلّق) + السحب العمودي =====
  useEffect(() => {
    const el = reelRef.current;
    if (!el) return;
    let lastWheel = 0;
    let startY: number | null = null;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const now = e.timeStamp;
      if (now - lastWheel < WHEEL_LOCK_MS) return;
      lastWheel = now;
      go(e.deltaY > 0 ? 1 : -1);
      bump();
    };
    const onDown = (e: PointerEvent) => { startY = e.clientY; bump(); };
    const onUp = (e: PointerEvent) => {
      if (startY === null) return;
      const dy = e.clientY - startY;
      startY = null;
      if (Math.abs(dy) > DRAG_PX) go(dy < 0 ? 1 : -1);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
    };
  }, [go, bump]);

  if (count === 0) {
    return (
      <section className="rounded-3xl bg-card p-7">
        <Head />
        <p className="mt-5 text-[13.5px] text-muted-foreground">ما فيه متابعات ثانية اليوم.</p>
      </section>
    );
  }

  // أقل من ٣: قائمة عادية — البكرة بلا معنى لعنصر أو عنصرين.
  if (!isReel) {
    return (
      <section className="rounded-3xl bg-card p-7">
        <Head />
        <div className="mt-5 space-y-3">
          {items.map((a) => <Flat key={`${a.leadId}-${a.kind}-${a.at.getTime()}`} a={a} zainClass={zainClass} nowMs={nowMs} />)}
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-3xl bg-card p-7">
      <div className="flex items-center gap-3">
        <Head />
        <div className="flex shrink-0 gap-2">
          <button
            type="button" aria-label="المتابعة السابقة"
            onClick={() => { go(-1); bump(); }}
            className="grid size-[34px] place-items-center rounded-xl bg-secondary/60 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronUp className="size-4" strokeWidth={1.6} />
          </button>
          <button
            type="button" aria-label="المتابعة التالية"
            onClick={() => { go(1); bump(); }}
            className="grid size-[34px] place-items-center rounded-xl bg-secondary/60 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDown className="size-4" strokeWidth={1.6} />
          </button>
        </div>
      </div>

      {/* البكرة — ↑↓ تعملان حين تكون مركّزة */}
      <div
        ref={reelRef}
        tabIndex={0}
        role="listbox"
        aria-label="متابعات اليوم"
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") { e.preventDefault(); go(-1); bump(); }
          else if (e.key === "ArrowDown") { e.preventDefault(); go(1); bump(); }
        }}
        className="relative mt-4 h-[340px] overflow-hidden outline-none"
        style={{
          perspective: "1200px",
          perspectiveOrigin: "50% 50%",
          // قناع تلاشٍ: الأسود هنا «معتم» في قناع الشفافية لا لون لوحة.
          WebkitMaskImage: "linear-gradient(transparent, black 22%, black 78%, transparent)",
          maskImage: "linear-gradient(transparent, black 22%, black 78%, transparent)",
        }}
      >
        <div className="absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
          {items.map((a, i) => {
            const d = i - cur;
            const active = d === 0;
            const { clock, mer } = timeParts(a.at);
            const isVisit = a.kind === "visit";
            // المدة بين لحظتين مطلقتين لا تتأثر بالمنطقة الزمنية — فهي صحيحة بتوقيت الرياض بحكم التعريف.
            const lateMs = nowMs - a.at.getTime();
            const late = lateMs > 0;
            return (
              <div
                key={`${a.leadId}-${a.kind}-${a.at.getTime()}`}
                role="option"
                aria-selected={active}
                aria-live={active ? "polite" : undefined}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("a,button")) return;
                  goTo(i); bump();
                }}
                className={`absolute inset-x-5 top-1/2 flex cursor-pointer items-center gap-[15px] rounded-[18px] border ${
                  active
                    ? `p-[22px_18px] shadow-2xl bg-gradient-to-br to-secondary ${late ? "border-destructive/45 from-destructive/15" : "border-gold/35 from-gold/15"}`
                    : `p-[16px_18px] bg-secondary ${late ? "border-destructive/40" : "border-white/[.06]"}`
                }`}
                style={{
                  marginTop: -46,
                  transition: "transform .6s cubic-bezier(.28,.85,.32,1), opacity .48s, filter .48s",
                  backfaceVisibility: "hidden",
                  ...slotStyle(d),
                }}
              >
                <span
                  className={`${zainClass} w-[66px] shrink-0 font-extrabold leading-none tracking-tight ${
                    late ? "text-destructive" : active ? "text-gold" : "text-muted-foreground"
                  } ${active ? "text-[23px]" : "text-[20px]"}`}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {clock}
                  <small className="mt-[3px] block font-sans text-[10.5px] font-normal tracking-normal text-muted-foreground/80">{mer}</small>
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-y-1">
                    <span className={`truncate font-semibold text-foreground ${active ? "text-[17px]" : "text-[15.5px]"}`}>{a.name}</span>
                    {/* شارة النوع: زيارة كهرماني · متابعة أزرق — نص + أيقونة معًا */}
                    <span className={`ms-2 inline-flex items-center gap-[5px] rounded-md px-2 py-[3px] text-[10px] font-semibold ${isVisit ? "bg-warning/15 text-warning" : "bg-info/15 text-info"}`}>
                      {isVisit ? <Building2 className="size-[11px]" strokeWidth={1.6} /> : <Phone className="size-[11px]" strokeWidth={1.6} />}
                      {isVisit ? "زيارة" : "متابعة"}
                    </span>
                    {late && (
                      <span className="ms-2 inline-flex items-center gap-[5px] rounded-[7px] bg-destructive/15 px-[9px] py-[3px] text-[10.5px] font-semibold text-destructive">
                        <AlertTriangle className="size-[11px]" strokeWidth={1.6} />
                        {lateLabel(lateMs)}
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 truncate text-[12px] text-muted-foreground">{subtitleOf(a)}</div>
                </div>

                {/* أزرار الوسطى فقط — الشاشة ساكنة حتى تُحتاج */}
                <div className={`flex shrink-0 gap-[7px] transition-opacity duration-300 ${active ? "opacity-100" : "pointer-events-none opacity-0"}`}>
                  <a
                    href={`tel:${a.phone}`}
                    aria-label={`اتصال بـ${a.name}`}
                    onClick={bump}
                    tabIndex={active ? 0 : -1}
                    className="inline-flex h-9 items-center gap-[7px] rounded-[11px] bg-gold px-3.5 text-[12px] font-semibold text-background"
                  >
                    <Phone className="size-[14px]" strokeWidth={1.6} /> اتصال
                  </a>
                  <a
                    href={`https://wa.me/${waPhone(a.phone)}`}
                    target="_blank" rel="noopener noreferrer"
                    aria-label={`واتساب ${a.name}`}
                    onClick={bump}
                    tabIndex={active ? 0 : -1}
                    className="grid size-9 place-items-center rounded-[11px] bg-success/15 text-success"
                  >
                    <MessageCircle className="size-[14px]" strokeWidth={1.6} />
                  </a>
                  <Link
                    href={`/leads/${a.leadId}`}
                    aria-label={`ملف العميل ${a.name}`}
                    onClick={bump}
                    tabIndex={active ? 0 : -1}
                    className="grid size-9 place-items-center rounded-[11px] bg-white/[.06] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <ChevronLeft className="size-[14px]" strokeWidth={1.6} />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* شريط التقدّم */}
      <div className="mt-3.5 h-0.5 overflow-hidden rounded-sm bg-white/[.07]">
        <span ref={barRef} className="block h-full origin-right rounded-sm bg-gold" style={{ transform: "scaleX(0)" }} />
      </div>

      {/* النقاط المؤشرة */}
      <div className="mt-4 flex items-center gap-[7px]">
        {items.map((a, i) => (
          <button
            key={`${a.leadId}-${a.kind}-dot`}
            type="button"
            aria-label={`المتابعة ${toArabicDigits(i + 1)}`}
            aria-current={i === cur}
            onClick={() => { goTo(i); bump(); }}
            className={`h-1.5 rounded-full transition-all duration-300 ${i === cur ? "w-[26px] bg-gold" : "w-1.5 bg-white/[.16]"}`}
          />
        ))}
        <span className="ms-auto text-[11.5px] text-muted-foreground" style={{ fontVariantNumeric: "tabular-nums" }}>
          {toArabicDigits(cur + 1)} من {toArabicDigits(count)}
        </span>
      </div>
    </section>
  );
}

function Head() {
  return (
    <div className="flex-1">
      <h3 className="text-[15.5px] font-semibold text-foreground">باقي اليوم</h3>
      <p className="mt-1.5 text-[12px] text-muted-foreground">متابعاتك القادمة — الأقرب أولًا</p>
    </div>
  );
}

/** صف مسطّح — للحالة الحدّية (متابعة أو اثنتان) حيث البكرة بلا معنى. */
function Flat({ a, zainClass, nowMs }: { a: TodayAppointment; zainClass: string; nowMs: number }) {
  const { clock, mer } = timeParts(a.at);
  const isVisit = a.kind === "visit";
  const lateMs = nowMs - a.at.getTime();
  const late = lateMs > 0;
  return (
    <div className={`flex items-center gap-[15px] rounded-[18px] border bg-secondary p-[16px_18px] ${late ? "border-destructive/40" : "border-white/[.06]"}`}>
      <span className={`${zainClass} w-[66px] shrink-0 text-[20px] font-extrabold leading-none tracking-tight ${late ? "text-destructive" : "text-muted-foreground"}`} style={{ fontVariantNumeric: "tabular-nums" }}>
        {clock}
        <small className="mt-[3px] block font-sans text-[10.5px] font-normal tracking-normal text-muted-foreground/80">{mer}</small>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-y-1">
          <span className="truncate text-[15.5px] font-semibold text-foreground">{a.name}</span>
          <span className={`ms-2 inline-flex items-center gap-[5px] rounded-md px-2 py-[3px] text-[10px] font-semibold ${isVisit ? "bg-warning/15 text-warning" : "bg-info/15 text-info"}`}>
            {isVisit ? <Building2 className="size-[11px]" strokeWidth={1.6} /> : <Phone className="size-[11px]" strokeWidth={1.6} />}
            {isVisit ? "زيارة" : "متابعة"}
          </span>
          {late && (
            <span className="ms-2 inline-flex items-center gap-[5px] rounded-[7px] bg-destructive/15 px-[9px] py-[3px] text-[10.5px] font-semibold text-destructive">
              <AlertTriangle className="size-[11px]" strokeWidth={1.6} />
              {lateLabel(lateMs)}
            </span>
          )}
        </div>
        <div className="mt-1.5 truncate text-[12px] text-muted-foreground">{subtitleOf(a)}</div>
      </div>
      <div className="flex shrink-0 gap-[7px]">
        <a href={`tel:${a.phone}`} aria-label={`اتصال بـ${a.name}`} className="inline-flex h-9 items-center gap-[7px] rounded-[11px] bg-gold px-3.5 text-[12px] font-semibold text-background">
          <Phone className="size-[14px]" strokeWidth={1.6} /> اتصال
        </a>
        <a href={`https://wa.me/${waPhone(a.phone)}`} target="_blank" rel="noopener noreferrer" aria-label={`واتساب ${a.name}`} className="grid size-9 place-items-center rounded-[11px] bg-success/15 text-success">
          <MessageCircle className="size-[14px]" strokeWidth={1.6} />
        </a>
        <Link href={`/leads/${a.leadId}`} aria-label={`ملف العميل ${a.name}`} className="grid size-9 place-items-center rounded-[11px] bg-white/[.06] text-muted-foreground transition-colors hover:text-foreground">
          <ChevronLeft className="size-[14px]" strokeWidth={1.6} />
        </Link>
      </div>
    </div>
  );
}

export default FollowupsReel;
