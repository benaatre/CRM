"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Phone, MessageCircle, ChevronLeft, ChevronUp, ChevronDown } from "lucide-react";
import type { TodayAppointment } from "@/lib/data/dashboard";
import { stageLabels } from "@/lib/labels";
import { waPhone } from "@/lib/value-normalize";
import { formatTime, toArabicDigits } from "@/lib/format";

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

export function FollowupsReel({ items, zainClass }: { items: TodayAppointment[]; zainClass: string }) {
  const count = items.length;
  const [cur, setCur] = useState(0);
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
          {items.map((a) => <Flat key={`${a.leadId}-${a.kind}-${a.at.getTime()}`} a={a} zainClass={zainClass} />)}
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
                className={`absolute inset-x-5 top-1/2 flex cursor-pointer items-center gap-[15px] rounded-[18px] border backface-hidden ${
                  active
                    ? "border-gold/35 bg-gradient-to-br from-gold/15 to-secondary p-[22px_18px] shadow-2xl"
                    : "border-white/[.06] bg-secondary p-[16px_18px]"
                }`}
                style={{
                  marginTop: -46,
                  transition: "transform .6s cubic-bezier(.28,.85,.32,1), opacity .48s, filter .48s",
                  backfaceVisibility: "hidden",
                  ...slotStyle(d),
                }}
              >
                <span className={`${zainClass} w-[66px] shrink-0 font-extrabold leading-none tracking-tight ${active ? "text-[23px] text-gold" : "text-[20px] text-muted-foreground"}`} style={{ fontVariantNumeric: "tabular-nums" }}>
                  {clock}
                  <small className="mt-[3px] block font-sans text-[10.5px] font-normal tracking-normal text-muted-foreground/80">{mer}</small>
                </span>

                <div className="min-w-0 flex-1">
                  <div className={`truncate font-semibold text-foreground ${active ? "text-[17px]" : "text-[15.5px]"}`}>{a.name}</div>
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
function Flat({ a, zainClass }: { a: TodayAppointment; zainClass: string }) {
  const { clock, mer } = timeParts(a.at);
  return (
    <div className="flex items-center gap-[15px] rounded-[18px] border border-white/[.06] bg-secondary p-[16px_18px]">
      <span className={`${zainClass} w-[66px] shrink-0 text-[20px] font-extrabold leading-none tracking-tight text-muted-foreground`} style={{ fontVariantNumeric: "tabular-nums" }}>
        {clock}
        <small className="mt-[3px] block font-sans text-[10.5px] font-normal tracking-normal text-muted-foreground/80">{mer}</small>
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15.5px] font-semibold text-foreground">{a.name}</div>
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
