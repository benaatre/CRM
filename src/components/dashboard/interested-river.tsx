"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Phone, MessageCircle, ChevronLeft } from "lucide-react";
import type { LeadStage } from "@prisma/client";
import { stageLabels } from "@/lib/labels";
import { STAGE_HEX } from "@/lib/stage-colors";
import { waPhone } from "@/lib/value-normalize";
import { toArabicDigits } from "@/lib/format";

/**
 * «عملاء مهتمون» — النهر الحي: قائمة تمرّ عموديًا بلا توقف، الأنشط أولًا.
 *
 * عرض خالص: الصفوف تصل props من المكوّن الخادمي (getLeads بمظلة «مهتم»
 * وفرز activity) — صفر استعلام وصفر فعل خادم. الفلترة بالمرحلة محلية على
 * المحمّل، والعدّادات محسوبة على الخادم ضمن نفس المصفوفة.
 *
 * الحركة عبر Web Animations API لا keyframes في ملف مشترك: تتوقف بالمرور،
 * وتُلغى بالكامل عند التفكيك أو تغيّر الفلتر، ولا تعمل إطلاقًا مع
 * prefers-reduced-motion أو حين تكون العناصر خمسة فأقل.
 */

export type RiverLead = {
  id: string;
  name: string;
  phone: string;
  stage: LeadStage;
  /** نص آخر متابعة مرئية — يُعرض كنص خام (React تهرّبه تلقائيًا). */
  lastNote: string | null;
  /** الزمن النسبي جاهزًا من الخادم (بتوقيت الرياض). */
  agoText: string;
};

/**
 * سرعة النهر بالبكسل/الثانية — **لا مدة ثابتة**.
 * المدة الثابتة (٤٤ث للدورة) تجعل السرعة تتضاعف مع طول القائمة: عشرة صفوف تمرّ
 * هادئة، ومئة صف تمرّ كالبرق لأن المسافة عشرة أضعاف في نفس الزمن. بتثبيت السرعة
 * يبقى الإيقاع واحدًا مهما كان عدد العملاء، وتُحسب المدة من ارتفاع المحتوى.
 */
const SPEED_PX_PER_SEC = 16;
const MIN_CYCLE_MS = 30_000;
const LOOP_MIN = 6; // أقل من ٦ (أي ٥ فأقل) = قائمة ثابتة بلا حركة
const NUM = { fontVariantNumeric: "tabular-nums" as const };

/** شرائح المرحلة — «الكل» + مراحل المظلة بترتيب القمع. */
const CHIP_STAGES: LeadStage[] = ["INTERESTED", "VISIT_SCHEDULED", "VIEWING", "NEGOTIATION", "FOLLOW_UP_LATER"];

function Row({ l }: { l: RiverLead }) {
  const tone = STAGE_HEX[l.stage];
  return (
    <div className="group relative flex items-stretch rounded-2xl p-4 transition-colors hover:bg-secondary/40">
      {/* شعرة الفصل — تختفي عند المرور (بلا حدود حول العنصر) */}
      <span aria-hidden className="absolute inset-x-3.5 bottom-0 h-px bg-[var(--hairline)] transition-opacity group-hover:opacity-0" />
      {/* الخط الجانبي = لون مرحلة العميل */}
      <span aria-hidden className="me-3.5 w-[3px] flex-none rounded-sm" style={{ background: tone }} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <Link href={`/leads/${l.id}`} className="truncate text-[16px] font-semibold text-foreground transition-colors hover:text-gold">
            {l.name}
          </Link>
          <span className="ms-auto flex-none text-[12.5px] text-muted-foreground/70">{l.agoText}</span>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
          <span className="text-[13.5px] text-muted-foreground" dir="ltr" style={NUM}>{l.phone}</span>
          <span
            className="inline-flex items-center rounded-lg px-2.5 py-1 text-[12.5px] font-medium"
            style={{ color: tone, background: `${tone}17` }}
          >
            {stageLabels[l.stage]}
          </span>
        </div>

        {/* آخر ملاحظة كتبها الموظف — سطران كحد أقصى، نص خام */}
        <p
          className={`mt-2 text-[13.5px] leading-6 ${l.lastNote ? "text-muted-foreground" : "text-muted-foreground/60"}`}
          style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
        >
          {l.lastNote ?? "بلا ملاحظات"}
        </p>
      </div>

      {/* أزرار دائمة الظهور — لا تنتظر المرور */}
      <div className="ms-3 flex flex-none flex-col justify-center gap-[7px]">
        <a
          href={`tel:${l.phone}`}
          aria-label={`اتصال بـ${l.name}`}
          className="grid size-[38px] place-items-center rounded-xl bg-[var(--elev)] text-info transition-colors hover:bg-secondary"
        >
          <Phone className="size-[15px]" strokeWidth={1.6} />
        </a>
        <a
          href={`https://wa.me/${waPhone(l.phone)}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`واتساب ${l.name}`}
          className="grid size-[38px] place-items-center rounded-xl bg-[var(--elev)] text-success transition-colors hover:bg-secondary"
        >
          <MessageCircle className="size-[15px]" strokeWidth={1.6} />
        </a>
      </div>
    </div>
  );
}

export function InterestedRiver({ leads, umbrellaHref, zainClass }: {
  leads: RiverLead[];
  umbrellaHref: string;
  /** صنف خط Zain — يُحمَّل في المكوّن الخادمي فلا يمسّ تخطيط الويب المشترك. */
  zainClass: string;
}) {
  const [stage, setStage] = useState<LeadStage | "all">("all");
  const [reduced, setReduced] = useState(false);
  const flowRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<Animation | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const counts = useMemo(() => {
    const m = new Map<LeadStage, number>();
    for (const l of leads) m.set(l.stage, (m.get(l.stage) ?? 0) + 1);
    return m;
  }, [leads]);

  const list = useMemo(
    () => (stage === "all" ? leads : leads.filter((l) => l.stage === stage)),
    [leads, stage],
  );
  const loop = list.length >= LOOP_MIN && !reduced;

  // النهر: نسختان متتاليتان وتحريك −٥٠٪ فيبدو التمرير متصلًا.
  useEffect(() => {
    const el = flowRef.current;
    if (!el || !loop || typeof el.animate !== "function") return;
    // المسافة = ارتفاع نسخة واحدة (النسختان معًا هما scrollHeight)، والمدة منها بالسرعة الثابتة.
    const distance = el.scrollHeight / 2;
    const duration = Math.max(MIN_CYCLE_MS, (distance / SPEED_PX_PER_SEC) * 1000);
    const anim = el.animate(
      [{ transform: "translateY(0)" }, { transform: "translateY(-50%)" }],
      { duration, iterations: Infinity, easing: "linear" },
    );
    animRef.current = anim;
    return () => {
      anim.cancel();
      animRef.current = null;
    };
  }, [loop, list.length]);

  if (leads.length === 0) {
    return (
      <section className="rounded-3xl bg-card p-7">
        <Head total={0} href={umbrellaHref} zainClass={zainClass} />
        <p className="mt-5 text-[13.5px] text-muted-foreground/70">ما عندك عملاء مهتمون حاليًا.</p>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-3xl bg-card p-7">
      <Head total={leads.length} href={umbrellaHref} zainClass={zainClass} />
      <p className="mb-4 mt-1 text-[13px] text-muted-foreground/70">الخط الجانبي يعكس مرحلة العميل — الأنشط أولًا</p>

      {/* شرائح المرحلة بعدّاداتها — الذهبي للفعّالة وحدها */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="me-0.5 self-center text-[11.5px] font-medium text-muted-foreground/70">المرحلة</span>
        <Chip on={stage === "all"} n={leads.length} onClick={() => setStage("all")}>الكل</Chip>
        {CHIP_STAGES.map((s) => {
          const n = counts.get(s) ?? 0;
          if (n === 0) return null;
          return (
            <Chip key={s} on={stage === s} n={n} onClick={() => setStage(s)}>{stageLabels[s]}</Chip>
          );
        })}
      </div>

      {list.length === 0 ? (
        <p className="text-[13.5px] text-muted-foreground/70">ما فيه عملاء في هذي المرحلة.</p>
      ) : (
        <div
          className={`relative -mx-2 h-[460px] ${reduced ? "overflow-y-auto" : "overflow-hidden"}`}
          onMouseEnter={() => animRef.current?.pause()}
          onMouseLeave={() => animRef.current?.play()}
        >
          {/* قناعا التلاشي أعلى وأسفل — بلون البطاقة نفسه */}
          <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[52px] bg-gradient-to-b from-card to-transparent" />
          <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[52px] bg-gradient-to-t from-card to-transparent" />
          <div ref={flowRef}>
            {list.map((l) => <Row key={l.id} l={l} />)}
            {/* النسخة الثانية للتتابع — لا تُقرأ للقارئ الشاشي */}
            {loop && <div aria-hidden>{list.map((l) => <Row key={`${l.id}-loop`} l={l} />)}</div>}
          </div>
        </div>
      )}
    </section>
  );
}

function Head({ total, href, zainClass }: { total: number; href: string; zainClass: string }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <span className={`${zainClass} text-[34px] font-extrabold leading-none tracking-tight text-foreground`} style={NUM}>
        {toArabicDigits(total)}
      </span>
      <span className="text-[16.5px] font-semibold text-foreground">عميل مهتم</span>
      <Link href={href} className="ms-auto inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground">
        عرض الكل <ChevronLeft className="size-[13px]" strokeWidth={1.6} />
      </Link>
    </div>
  );
}

function Chip({ on, n, onClick, children }: { on: boolean; n: number; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`inline-flex items-center gap-1.5 rounded-[10px] px-3.5 py-[7px] text-[12.5px] font-medium transition-colors ${
        on ? "bg-gold text-background" : "bg-[var(--elev)] text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
      <span className={`text-[13px] font-bold ${on ? "opacity-80" : "text-muted-foreground/70"}`} style={NUM}>
        {toArabicDigits(n)}
      </span>
    </button>
  );
}

export default InterestedRiver;

