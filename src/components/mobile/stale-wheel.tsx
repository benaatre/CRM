"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import type { LeadStage } from "@prisma/client";
import { stageLabels } from "@/lib/labels";
import { SOP } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";
import type { StaleTier, StaleReason } from "@/lib/stale-leads";

/**
 * القائمة الدوّارة العمودية لراكدي الموظف — مطابقة حرفية للمعاينة
 * (docs/design/stale-leads-preview.html):
 * نافذة ٤٦٦px ≈ ٦ صفوف · scroll-snap-type: y mandatory · لفّة صفٍّ كل ٢٠٠٠ms ·
 * توقف فوري عند pointerdown/touchstart/wheel/focusin · prefers-reduced-motion =
 * بلا حركة تلقائية · ترجع للأول عند النهاية · النقاط تتولّد حسب عدد الصفوف ·
 * زر واحد «ملف العميل» (لا اتصال ولا واتساب — كل شيء من الملف فتُسجَّل المتابعة
 * فيخرج تلقائيًا) · الشريط الجانبي يقيس العمر (حارّ أحمر · عادي كهرماني · مهجور
 * رمادي) والحرارة رقم مستقل · آخر صف ذهبي «باقي الراكدين عندك — N».
 */

export type StaleWheelRow = {
  id: string;
  name: string;
  stage: LeadStage;
  days: number;
  tier: StaleTier;
  reason: StaleReason;
  isHot: boolean;
  lastNote: string | null;
  /** اسم الموظف المسؤول — يُعرض «عند فلان» في قائمة المالك فقط (غائب للموظف). */
  employeeName?: string | null;
};

const WINDOW_H = 466;
const ROLL_MS = 2000;

/** لون الشريط الجانبي: الحارّ أحمر (أسبق)، ثم المهجور رمادي، وغيرهما كهرماني. */
function edgeColor(r: StaleWheelRow): string {
  if (r.isHot) return SOP.red;
  if (r.tier === "DORMANT") return SOP.neutral;
  return SOP.amber;
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ maxWidth: 14, maxHeight: 14 }}>
      <path d="M6.5 3h6.8L18 7.7V21H6.5z" />
      <path d="M13 3v5h5" />
      <path d="M9.5 13h5M9.5 16.8h3.2" />
    </svg>
  );
}

export function StaleWheel({
  rows, restCount, restLabel = "باقي الراكدين عندك", restHref = "/m/leads?stale=1",
}: {
  rows: StaleWheelRow[];
  restCount: number;
  restLabel?: string;
  restHref?: string;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const pagerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const strip = stripRef.current;
    const pager = pagerRef.current;
    if (!strip) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cards = Array.from(strip.querySelectorAll<HTMLElement>("[data-mini]"));
    if (!cards.length) return;

    let idx = 0;
    let paused = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const dots = () => {
      if (!pager) return;
      pager.querySelectorAll<HTMLElement>("i").forEach((d, i) => {
        const on = i === idx;
        d.style.width = on ? "14px" : "5px";
        d.style.borderRadius = on ? "3px" : "50%";
        d.style.background = on ? SOP.gold : SOP.edge2;
      });
    };
    const go = (i: number) => {
      idx = (i + cards.length) % cards.length;
      const c = cards[idx].getBoundingClientRect();
      const s = strip.getBoundingClientRect();
      strip.scrollBy({ top: c.top - s.top, behavior: reduce ? "auto" : "smooth" });
      dots();
    };
    const step = () => {
      if (paused) return;
      const atEnd = strip.scrollTop + strip.clientHeight >= strip.scrollHeight - 2;
      go(atEnd ? 0 : idx + 1);
    };

    // مزامنة النقطة عند السحب اليدوي.
    let settle: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      clearTimeout(settle);
      settle = setTimeout(() => {
        const s = strip.getBoundingClientRect();
        let best = 0, bd = Infinity;
        cards.forEach((c, i) => {
          const d = Math.abs(c.getBoundingClientRect().top - s.top);
          if (d < bd) { bd = d; best = i; }
        });
        idx = best; dots();
      }, 120);
    };
    strip.addEventListener("scroll", onScroll, { passive: true });

    const pause = () => { paused = true; if (timer) { clearInterval(timer); timer = null; } };
    const evs: (keyof HTMLElementEventMap)[] = ["pointerdown", "touchstart", "wheel", "focusin"];
    evs.forEach((e) => strip.addEventListener(e, pause, { passive: true }));

    if (!reduce) timer = setInterval(step, ROLL_MS);
    dots();

    return () => {
      if (timer) clearInterval(timer);
      clearTimeout(settle);
      strip.removeEventListener("scroll", onScroll);
      evs.forEach((e) => strip.removeEventListener(e, pause));
    };
  }, [rows]);

  const total = rows.length + (restCount > 0 ? 1 : 0);

  return (
    <div>
      <div className="flex items-center" style={{ gap: 8, margin: "6px 2px 10px", fontSize: 11.5, color: SOP.mut }}>
        <span>أول اللي يحتاجونك</span>
        <div ref={pagerRef} className="flex items-center" style={{ marginInlineStart: "auto", gap: 4 }}>
          {Array.from({ length: total }).map((_, i) => (
            <i key={i} style={{ display: "block", width: 5, height: 5, borderRadius: "50%", background: SOP.edge2, transition: "background .3s, width .3s" }} />
          ))}
        </div>
      </div>

      <div
        ref={stripRef}
        className="m-noscroll flex flex-col"
        style={{
          gap: 10, height: WINDOW_H, overflowY: "auto",
          scrollSnapType: "y mandatory", scrollBehavior: "smooth", padding: 2,
          WebkitMaskImage: "linear-gradient(to bottom, #000 0, #000 90%, transparent 100%)",
          maskImage: "linear-gradient(to bottom, #000 0, #000 90%, transparent 100%)",
        }}
      >
        {rows.map((r) => {
          const edge = edgeColor(r);
          return (
            <article
              key={r.id}
              data-mini
              className="m-raise flex flex-wrap items-center"
              style={{
                flex: "none", scrollSnapAlign: "start", borderRadius: 14, padding: "12px 13px",
                borderInlineStart: `3px solid ${edge}`, gap: "9px 10px",
              }}
            >
              <div className="flex min-w-0 items-center" style={{ flex: "1 1 100%", gap: 8 }}>
                <span className="truncate" style={{ fontSize: 13, fontWeight: 600, color: SOP.tx }}>{r.name}</span>
                <span style={{ marginInlineStart: "auto", flex: "none", fontSize: 11, fontWeight: 700, color: r.isHot ? SOP.red : SOP.amber, whiteSpace: "nowrap", fontFamily: "var(--font-zain), var(--font-sans)" }}>
                  راكد {toArabicDigits(r.days)} يوم
                </span>
              </div>
              <span style={{ order: 2, flex: "none", fontSize: 10, padding: "3px 9px", borderRadius: 6, border: `1px solid ${SOP.edge2}`, color: SOP.tx2, background: SOP.planeHi, whiteSpace: "nowrap" }}>
                {stageLabels[r.stage]}
              </span>
              <span className="truncate" style={{ order: 3, flex: "1 1 90px", minWidth: 0, fontSize: 11, color: SOP.mut }}>
                {r.employeeName ? `عند ${r.employeeName} · ` : ""}{r.reason === "NO_DATE" ? "بلا موعد قادم" : "فات موعده"}{r.lastNote ? ` · ${r.lastNote}` : ""}
              </span>
              <Link
                href={`/m/leads/${r.id}`}
                className="m-press flex items-center"
                style={{ order: 4, flex: "none", gap: 6, padding: "8px 13px", borderRadius: 10, border: `1px solid ${SOP.edge}`, background: SOP.plane, color: SOP.tx2, fontSize: 11.5, fontWeight: 600 }}
              >
                <FileIcon /> ملف العميل
              </Link>
            </article>
          );
        })}

        {restCount > 0 && (
          <Link
            href={restHref}
            data-mini
            className="flex flex-wrap items-center m-press"
            style={{
              flex: "none", scrollSnapAlign: "start", borderRadius: 14, padding: "12px 13px",
              background: SOP.planeHi, border: `1px solid ${SOP.edge}`,
              borderInlineStart: `3px solid ${SOP.gold}`, gap: "9px 10px",
            }}
          >
            <div className="flex min-w-0 items-center" style={{ flex: "1 1 100%", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: SOP.gold }}>{restLabel}</span>
              <span style={{ marginInlineStart: "auto", fontSize: 11, color: SOP.tx2, fontFamily: "var(--font-zain), var(--font-sans)" }}>{toArabicDigits(restCount)} عميل</span>
            </div>
            <span style={{ order: 3, fontSize: 11, color: SOP.mut }}>افتح القائمة الكاملة</span>
          </Link>
        )}
      </div>
    </div>
  );
}

export default StaleWheel;
