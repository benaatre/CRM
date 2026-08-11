"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";

/**
 * شريط «الفريق الآن» الأفقي (رئيسية المالك v3) — بلاطات 112px بأربع حالات:
 * متصل (أخضر) · قريب (كهرماني) · بعيد (محايد) · راكد (أحمر خلف شريط قابل للطي).
 * عرض خالص: كل النصوص والحالات تصل جاهزة من الخادم؛ العميل للتمرير والمؤشرات
 * والدوران التلقائي فقط (بلاطة كل ٤٫٢ث، يتوقف ٩ث عند اللمس، معطّل مع
 * prefers-reduced-motion، ولا يدور والصفحة مخفية) — cleanup كامل للمؤقتات والمستمعات.
 */

export type StripTile = {
  id: string;
  name: string;
  state: "on" | "soon" | "away" | "dorm";
  /** شارة المدة البارزة: الرقم الكبير (أو كلمة «متصل») + الوصف تحته. */
  sinceNum: string;
  sinceUnit: string;
  fu: number;
  visits: number;
  bookings: number;
};

const ZAIN = { fontFamily: "var(--font-zain), var(--font-sans)" };
const STEP = 121; // عرض البلاطة 112 + الفجوة 9

/** رباعية ألوان كل حالة — من التوكنز حصرًا. */
function tone(state: StripTile["state"]) {
  if (state === "on") return { base: MOBILE_STATUS.success.base, bg: MOBILE_STATUS.success.bg, border: MOBILE_STATUS.success.border };
  if (state === "soon") return { base: MOBILE_STATUS.warning.base, bg: MOBILE_STATUS.warning.bg, border: MOBILE_STATUS.warning.border };
  if (state === "dorm") return { base: MOBILE_STATUS.danger.base, bg: MOBILE_STATUS.danger.bg, border: MOBILE_STATUS.danger.border };
  return { base: MOBILE_COLORS.textMuted, bg: MOBILE_COLORS.card, border: MOBILE_COLORS.border };
}

function Tile({ t }: { t: StripTile }) {
  const c = tone(t.state);
  const sub = [
    t.visits > 0 ? `${toArabicDigits(t.visits)} ${t.visits === 1 ? "زيارة" : "زيارات"}` : null,
    t.bookings > 0 ? `${toArabicDigits(t.bookings)} حجز` : null,
  ].filter(Boolean).join(" · ") || "—";
  return (
    <div
      className="m-press relative flex-none overflow-hidden text-center"
      style={{
        boxSizing: "border-box", width: 112, borderRadius: 16, padding: "12px 10px 12px",
        background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
      }}
    >
      {/* الخط العلوي المضيء بلون الحالة */}
      <span aria-hidden style={{ position: "absolute", top: 0, insetInline: 8, height: 2, borderRadius: 2, background: c.base, boxShadow: t.state === "away" ? "none" : `0 0 10px ${c.base}` }} />
      <div className="truncate" style={{ fontSize: "12.5px", fontWeight: 800, color: MOBILE_COLORS.textPrimary }}>{t.name}</div>
      {/* شارة المدة البارزة — نفس الحجم البصري لكل الحالات */}
      <div style={{ boxSizing: "border-box", marginTop: 7, borderRadius: 10, padding: "6px 4px", background: c.bg, border: `1px solid ${c.border}`, color: c.base }}>
        <span className="block" style={{ ...ZAIN, fontSize: 19, fontWeight: 800, lineHeight: 1.15 }}>{t.sinceNum}</span>
        <span className="block" style={{ fontSize: 9, fontWeight: 700, opacity: 0.9, marginTop: 1, lineHeight: 1.4 }}>{t.sinceUnit}</span>
      </div>
      {/* صندوق إنتاج اليوم */}
      <div style={{ boxSizing: "border-box", marginTop: 9, borderRadius: 12, padding: "9px 5px 8px", background: MOBILE_COLORS.sheet, border: `1px solid ${MOBILE_COLORS.border}` }}>
        <div style={{ ...ZAIN, fontSize: 22, fontWeight: 800, lineHeight: 1, color: t.fu > 0 ? MOBILE_COLORS.textPrimary : MOBILE_COLORS.textMuted }}>{toArabicDigits(t.fu)}</div>
        <div style={{ fontSize: 9, fontWeight: 700, color: MOBILE_COLORS.textMuted, marginTop: 3 }}>متابعة اليوم</div>
        <div style={{ fontSize: 9, fontWeight: 700, color: MOBILE_COLORS.textSecondary, marginTop: 5 }}>{sub}</div>
      </div>
    </div>
  );
}

export function TeamStrip({ tiles, dorm, onlineCount }: {
  /** المتصلون أولًا ثم البقية بالأحدث ظهورًا (ترتيب الخادم). */
  tiles: StripTile[];
  /** الراكدون (≥ ١٥ يوم أو ما دخلوا) — خلف شريط قابل للطي. */
  dorm: StripTile[];
  onlineCount: number;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [first, setFirst] = useState(0);
  const [perView, setPerView] = useState(3);
  const [dormOpen, setDormOpen] = useState(false);
  const pausedRef = useRef(false);
  const total = tiles.length + dorm.length;
  const sepIdx = tiles.filter((t) => t.state === "on").length;

  const upd = useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    setPerView(Math.max(1, Math.floor(el.clientWidth / STEP)));
    setFirst(Math.min(tiles.length - 1, Math.round(Math.abs(el.scrollLeft) / STEP)));
  }, [tiles.length]);

  const go = useCallback((dir: 1 | -1) => {
    const el = stripRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    // نهاية الشريط والدوران للأمام → العودة للبداية (اللف).
    if (dir > 0 && Math.abs(el.scrollLeft) >= max - 6) { el.scrollTo({ left: 0, behavior: "smooth" }); return; }
    el.scrollBy({ left: dir > 0 ? -STEP : STEP, behavior: "smooth" }); // RTL: الأمام = يسار سالب
  }, []);

  // الدوران التلقائي + إيقاف اللمس — كل مؤقّت ومستمع له cleanup.
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    upd();
    el.addEventListener("scroll", upd, { passive: true });
    window.addEventListener("resize", upd);

    let auto: ReturnType<typeof setInterval> | null = null;
    let resume: ReturnType<typeof setTimeout> | null = null;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = () => {
      if (reduced || auto) return;
      auto = setInterval(() => {
        if (!pausedRef.current && document.visibilityState === "visible") go(1);
      }, 4200);
    };
    const pause = () => {
      pausedRef.current = true;
      if (resume) clearTimeout(resume);
      resume = setTimeout(() => { pausedRef.current = false; }, 9000);
    };
    el.addEventListener("touchstart", pause, { passive: true });
    el.addEventListener("pointerdown", pause, { passive: true });
    start();

    return () => {
      el.removeEventListener("scroll", upd);
      el.removeEventListener("touchstart", pause);
      el.removeEventListener("pointerdown", pause);
      window.removeEventListener("resize", upd);
      if (auto) clearInterval(auto);
      if (resume) clearTimeout(resume);
    };
  }, [upd, go]);

  const pauseByArrow = () => {
    pausedRef.current = true;
    setTimeout(() => { pausedRef.current = false; }, 9000);
  };

  const dotCount = Math.max(1, Math.ceil(tiles.length / Math.max(1, perView)));
  const dotOn = Math.min(dotCount - 1, Math.floor(first / Math.max(1, perView)));
  const last = Math.min(tiles.length, first + perView);

  return (
    <div className="overflow-hidden" style={{ borderRadius: 20, background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}` }}>
      {/* الترويسة */}
      <div className="flex items-center" style={{ gap: 9, padding: "13px 15px", borderBottom: `1px solid ${MOBILE_COLORS.border}` }}>
        <span className="flex-1" style={{ fontSize: "13.5px", fontWeight: 800, color: MOBILE_COLORS.textPrimary }}>
          {toArabicDigits(total)} موظفين
        </span>
        <span className="flex items-center" style={{ gap: 6, fontSize: 11, fontWeight: 800, color: MOBILE_STATUS.success.base }}>
          <i className="m-pulse" style={{ width: 7, height: 7, borderRadius: 4, background: MOBILE_STATUS.success.base, boxShadow: `0 0 7px ${MOBILE_STATUS.success.base}` }} />
          {toArabicDigits(onlineCount)} متصلين
        </span>
      </div>

      {/* الشريط */}
      <div ref={stripRef} className="m-noscroll flex overflow-x-auto" style={{ gap: 9, padding: 14, scrollBehavior: "smooth" }}>
        {tiles.map((t, i) => (
          <span key={t.id} className="flex" style={{ gap: 9 }}>
            {i === sepIdx && sepIdx > 0 && <span aria-hidden className="flex-none" style={{ width: 1, background: MOBILE_COLORS.border, margin: "8px 1px" }} />}
            <Tile t={t} />
          </span>
        ))}
        {tiles.length === 0 && (
          <span style={{ fontSize: 12, color: MOBILE_COLORS.textMuted, padding: "8px 4px" }}>ما فيه موظفون نشطون</span>
        )}
      </div>

      {/* سطر المؤشرات — تحت الشريط، لا يغطي البلاطات */}
      {tiles.length > perView && (
        <div className="flex items-center justify-center" style={{ gap: 6, padding: "0 14px 13px" }}>
          <span style={{ fontSize: 10, color: MOBILE_COLORS.textMuted, fontWeight: 700, marginInlineEnd: "auto" }}>
            {toArabicDigits(first + 1)}–{toArabicDigits(last)} من {toArabicDigits(tiles.length)}
          </span>
          {Array.from({ length: dotCount }, (_, i) => (
            <span
              key={i}
              aria-hidden
              style={{
                height: 6, borderRadius: 4,
                width: i === dotOn ? 20 : 6,
                background: i === dotOn ? MOBILE_COLORS.gold : MOBILE_COLORS.line2,
                boxShadow: i === dotOn ? `0 0 10px ${MOBILE_COLORS.goldBg}` : "none",
                transition: "width .35s cubic-bezier(.3,1.2,.4,1)",
              }}
            />
          ))}
          <button type="button" aria-label="السابق" onClick={() => { go(-1); pauseByArrow(); }} className="m-press flex items-center justify-center"
            style={{ boxSizing: "border-box", width: 26, height: 26, borderRadius: 9, background: MOBILE_COLORS.sheet, border: `1px solid ${MOBILE_COLORS.border}`, color: MOBILE_COLORS.textSecondary, fontSize: 11, marginInlineStart: 6 }}>
            →
          </button>
          <button type="button" aria-label="التالي" onClick={() => { go(1); pauseByArrow(); }} className="m-press flex items-center justify-center"
            style={{ boxSizing: "border-box", width: 26, height: 26, borderRadius: 9, background: MOBILE_COLORS.sheet, border: `1px solid ${MOBILE_COLORS.border}`, color: MOBILE_COLORS.textSecondary, fontSize: 11 }}>
            ←
          </button>
        </div>
      )}

      {/* الراكدون — شريط قابل للطي */}
      {dorm.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setDormOpen((o) => !o)}
            className="flex w-full items-center text-start"
            style={{ gap: 9, padding: "11px 14px", borderTop: `1px solid ${MOBILE_COLORS.border}`, background: MOBILE_STATUS.danger.bg, border: "none", borderRadius: 0 }}
          >
            <span className="flex-1" style={{ fontSize: "11.5px", fontWeight: 800, color: MOBILE_STATUS.danger.base }}>
              {toArabicDigits(dorm.length)} راكدون — أكثر من ١٥ يوم
              <span className="block truncate" style={{ fontSize: "10.5px", color: MOBILE_COLORS.textMuted, fontWeight: 600, marginTop: 2 }}>
                {dorm.map((d) => d.name.split(/\s+/)[0]).join(" · ")}
              </span>
            </span>
            <span aria-hidden style={{ fontSize: 12, color: MOBILE_STATUS.danger.base, transition: "transform .3s", transform: dormOpen ? "rotate(-90deg)" : "none" }}>←</span>
          </button>
          {dormOpen && (
            <div className="m-noscroll flex overflow-x-auto" style={{ gap: 9, padding: 14, borderTop: `1px solid ${MOBILE_COLORS.border}` }}>
              {dorm.map((t) => <Tile key={t.id} t={t} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default TeamStrip;
