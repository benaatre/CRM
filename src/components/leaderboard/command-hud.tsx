"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import type { BoardView, BoardViewRow } from "@/lib/data/leaderboard";
import { toArabicDigits } from "@/lib/format";

/**
 * لوحة الأسبوع — «غرفة القيادة» (Command HUD): المتصدر في برج القمة يمينًا،
 * والبقية صفوف HUD بمؤشرات ليزرية طولها نسبة الدرجة من درجة المتصدر.
 *
 * عرض خالص فوق `toBoardView` — المنطق والحسابات في getLeaderboard لا تُلمس،
 * والأرقام الخام لغير المستحق غير موجودة في الـprops أصلًا (سُدّت على الخادم).
 * الهوية: توكنات CSS حصرًا (شفافيات الذهب --gold-aXX من globals) — صفر hex هنا.
 * الحركة كلها تحترم prefers-reduced-motion (نمط matchMedia القائم بالمشروع).
 */

const NUM = { fontVariantNumeric: "tabular-nums" as const };

/** ألقاب المراكز — نفس سلّم «القمم» القائم حرفيًا (الوسطى بلا لقب إن زاد الفريق). */
function tierOf(rank: number, total: number): string | null {
  if (rank === 1) return "الصدارة";
  if (rank === 2) return "المطاردة";
  if (rank === 3) return "منصة التتويج";
  if (rank === total) return "خط البداية";
  if (rank === 4) return "الملاحقة";
  if (rank === 5) return "الانطلاقة";
  return null;
}

/** تاج المتصدر — SVG خطي بحجم مقيّد (لا إيموجي). */
function CrownIcon() {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" aria-hidden="true" style={{ maxWidth: 20, maxHeight: 20 }}>
      <path d="M4 17h16M5 17 3.5 8.5 8 12l4-6 4 6 4.5-3.5L19 17H5Z" />
    </svg>
  );
}

export function CommandHud({ view, zainClass, range, tabs }: {
  view: BoardView;
  zainClass: string;
  /** نطاق التاريخ المعروض (الأحد → السبت) — يُحسب على الخادم. */
  range: string;
  /** تبويبا هذا الأسبوع/الأسبوع السابق (للمالك) — null لغيره. */
  tabs: { label: string; href: string; active: boolean }[] | null;
}) {
  const [entered, setEntered] = useState(false);
  const [filled, setFilled] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced.current) { setEntered(true); setFilled(true); return; }
    const t1 = setTimeout(() => setEntered(true), 40);
    const t2 = setTimeout(() => setFilled(true), 550);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const rows = view.rows;
  const leader = rows[0] ?? null;
  const rest = rows.slice(1);
  const topScore = Math.max(leader?.score ?? 0, 1);
  const total = rows.length;

  return (
    <section
      className="rounded-2xl p-px"
      style={{
        // الحد المتدرج الذهبي الخفيف — طبقتا خلفية padding-box/border-box.
        background: "linear-gradient(var(--background), var(--background)) padding-box, linear-gradient(160deg, var(--gold-a35), var(--gold-a06) 38%, var(--gold-a03) 62%, var(--gold-a20)) border-box",
        border: "1px solid transparent",
      }}
    >
      <div className="relative overflow-hidden rounded-[15px] p-5 sm:p-6" style={{ background: "var(--background)" }}>
        {/* شبكة النبض الخافتة — زخرفة خالصة */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: "linear-gradient(var(--gold-a03) 1px, transparent 1px), linear-gradient(90deg, var(--gold-a03) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
        />

        {/* حركات الغرفة — نبض النقطة الحية وbreathe للتوهج، تُلغى مع تقليل الحركة */}
        <style>{`
          @keyframes hud-breathe { 0%, 100% { opacity: .55; transform: scale(1); } 50% { opacity: 1; transform: scale(1.3); } }
          @keyframes hud-glow { 0%, 100% { opacity: .5; } 50% { opacity: 1; } }
          .hud-pulse { animation: hud-breathe 2.4s ease-in-out infinite; }
          .hud-glowpulse { animation: hud-glow 4.5s ease-in-out infinite; }
          @media (prefers-reduced-motion: reduce) { .hud-pulse, .hud-glowpulse { animation: none !important; } }
        `}</style>

        <div className="relative">
          {/* ===== الرأس: النقطة الحية + العنوان + شارة النطاق + التبويبان ===== */}
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span aria-hidden className="hud-pulse size-2.5 rounded-full" style={{ background: "var(--gold)", boxShadow: "0 0 10px var(--gold-a60), 0 0 22px var(--gold-a35)" }} />
              <h1 className="text-[22px] font-bold tracking-tight text-foreground">لوحة الأسبوع — سباق حي</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`${zainClass} rounded-full border px-3.5 py-1.5 text-[13px] font-bold text-muted-foreground`} style={{ borderColor: "var(--gold-a20)", ...NUM }}>
                {range}{!view.isCurrentWeek && <span className="mr-1.5 font-normal text-muted-foreground/70">· أسبوع سابق</span>}
              </span>
              {tabs?.map((t) => (
                <Link
                  key={t.href}
                  href={t.href}
                  className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${t.active ? "text-gold" : "text-muted-foreground hover:text-foreground"}`}
                  style={t.active ? { borderColor: "var(--gold-a60)", background: "var(--gold-a12)" } : { borderColor: "var(--hairline)" }}
                >
                  {t.label}
                </Link>
              ))}
            </div>
          </div>

          {/* سطر الخصوصية — كما كان (سلوك قائم) */}
          <div className="mb-5 flex items-center gap-2 text-[12px] text-muted-foreground/70">
            <Lock className="size-[13px] shrink-0" strokeWidth={1.6} />
            {view.managerView
              ? "أنت ترى كل الأرقام بحكم دورك — الموظف يرى أرقامه وحده ونِسب زملائه"
              : "تفاصيل النشاط تُعرض نِسبًا من إجمالي الفريق — وكل موظف يرى أرقامه الفعلية وحده"}
          </div>

          {rows.length === 0 ? (
            <p className="text-[13.5px] text-muted-foreground">ما فيه موظفون في الترتيب هذا الأسبوع.</p>
          ) : (
            <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-[220px_1fr]">
              {/* ===== القمة — عمود يمين ثابت ===== */}
              {leader && (
                <div
                  className="relative rounded-2xl px-4 py-5 text-center"
                  style={{
                    background: "var(--gold-a06)",
                    border: "1px solid var(--gold-a35)",
                    boxShadow: "inset 0 0 34px var(--gold-a06), inset 0 1px 0 var(--gold-a12)",
                    opacity: entered ? 1 : 0,
                    transform: entered ? "none" : "translateY(8px)",
                    transition: "opacity .5s ease, transform .6s cubic-bezier(.32,.72,0,1)",
                  }}
                >
                  {/* توهج يتنفس — زخرفة خالصة تحترم تقليل الحركة */}
                  <div aria-hidden className="hud-glowpulse pointer-events-none absolute inset-0 rounded-2xl" style={{ boxShadow: "inset 0 0 44px var(--gold-a12)" }} />
                  <div className="flex items-center justify-center gap-2 text-[11px] font-medium text-gold" style={{ letterSpacing: "0.35em" }}>
                    — القمة —
                  </div>
                  <div className="mt-2 flex items-center justify-center gap-1.5 text-gold"><CrownIcon /></div>
                  <div className="mt-1.5 text-[16px] font-bold leading-snug text-foreground">
                    {leader.name}
                    {leader.isSelf && <span className="mr-1.5 rounded-md px-1.5 py-0.5 align-middle text-[10.5px] font-medium text-gold" style={{ background: "var(--gold-a12)" }}>أنت</span>}
                  </div>
                  <div
                    className={`${zainClass} font-extrabold leading-none`}
                    style={{ fontSize: 58, color: "var(--gold-light)", textShadow: "0 0 22px var(--gold-a60), 0 0 60px var(--gold-a20)", ...NUM }}
                  >
                    {toArabicDigits(leader.score)}
                  </div>
                  <div className="mt-1 text-[11.5px] text-muted-foreground/70" style={NUM}>
                    درجة{leader.qualityFactor !== 1 && <> · جودة ×{toArabicDigits(leader.qualityFactor.toFixed(2))}</>}
                  </div>

                  {/* سطرا النِسب/الأرقام — من بيانات اللوحة القائمة كما تصل المشاهد */}
                  <div className="mt-3 space-y-1 text-[11.5px] text-muted-foreground" style={NUM}>
                    {leader.raw ? (
                      <>
                        <div>تواصل مع <b className="text-foreground">{toArabicDigits(leader.raw.contacted)}</b> عميلًا</div>
                        <div>نقل <b className="text-foreground">{toArabicDigits(leader.raw.interested)}</b> لمهتم</div>
                      </>
                    ) : leader.share ? (
                      <>
                        <div>من تواصل الفريق <b className="text-foreground">{toArabicDigits(leader.share.contactShare)}٪</b></div>
                        <div>من المهتمين <b className="text-foreground">{toArabicDigits(leader.share.interestedShare)}٪</b></div>
                      </>
                    ) : null}
                  </div>

                  <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--gold-a20)" }}>
                    <span className="rounded-full px-3 py-1 text-[11.5px] font-medium text-gold" style={{ background: "var(--gold-a12)", border: "1px solid var(--gold-a35)" }}>
                      نجمة الأسبوع
                    </span>
                    {view.mostImprovedId === leader.id && <Medal>الأكثر تحسنًا</Medal>}
                    {view.topQualityId === leader.id && <Medal>أعلى جودة</Medal>}
                  </div>
                </div>
              )}

              {/* ===== بقية المرتَّبين — صفوف HUD ===== */}
              <div className="min-w-0 space-y-2">
                {rest.length === 0 && (
                  <p className="text-[12.5px] text-muted-foreground/70">متصدر وحيد هذا الأسبوع.</p>
                )}
                {rest.map((r, i) => (
                  <HudRow
                    key={r.id}
                    r={r}
                    tier={tierOf(r.rank, total)}
                    improved={view.mostImprovedId === r.id}
                    topQuality={view.topQualityId === r.id}
                    pct={r.score > 0 ? Math.max(4, Math.round((r.score / topScore) * 100)) : 0}
                    entered={entered}
                    filled={filled}
                    delayMs={reduced.current ? 0 : i * 65}
                    zainClass={zainClass}
                  />
                ))}
              </div>
            </div>
          )}

          {/* خارج الترتيب — أسماء بلا أرقام كما تعيدهم الدالة */}
          {view.unranked.length > 0 && (
            <div className="relative mt-5 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground/70">
              بلا عملاء مسندين هذا الأسبوع — خارج الترتيب:
              {view.unranked.map((u) => (
                <span key={u.id} className="rounded-lg bg-card px-3 py-1 text-muted-foreground">{u.name}</span>
              ))}
            </div>
          )}

          {/* ===== التذييل ===== */}
          <div className="relative mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-[11.5px] text-muted-foreground/70" style={{ borderColor: "var(--hairline)" }}>
            <span>الأسبوع يبدأ الأحد ٠٠:٠٠ بتوقيت الرياض · الدرجة = الإنجاز × الجودة · عرض وترتيب فقط · رخصة فال {toArabicDigits(1200021029)}</span>
            <button
              onClick={() => setHowOpen((v) => !v)}
              className="rounded-full border px-3 py-1 text-[11.5px] font-medium text-gold transition-colors hover:bg-[var(--gold-a06)]"
              style={{ borderColor: "var(--gold-a35)" }}
              aria-expanded={howOpen}
            >
              كيف تُحسب درجتك؟
            </button>
          </div>

          {/* الشرح المعتمد ثلاثي الأسطر — لوحة منسدلة */}
          {howOpen && (
            <div className="relative mt-3 space-y-1.5 rounded-xl p-4 text-[12.5px] leading-6 text-muted-foreground" style={{ background: "var(--gold-a03)", border: "1px solid var(--gold-a20)" }}>
              <p>درجتك = <b className="text-foreground">شغلك الفعلي × جودته</b>. كل فعل له نقاط: تواصل مع عميل ٢ · متابعة ١ (بحد ١٥ باليوم) · نقلته لمهتم ٥ · موعد زيارة ٥ · زيارة تمت ١٠ · حجز ٥٠ · بيع ٨٠.</p>
              <p>جودتك ترفع مجموعك حتى +٢٠٪ أو تنزّله حتى −٢٠٪ — تُقاس بأربعة: تغطيتك لعملائك، التزامك بمواعيدك، سرعة ردّك على الجديد، وصفر متأخرين عندك في «لم يتم الرد».</p>
              <p>الأسبوع يبدأ الأحد صباحًا، ومن لم يعمل شيئًا درجته صفر مهما كانت نسبه — الاجتهاد يحكم والجودة تكمّل.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** وسام صغير (الأكثر تحسنًا / أعلى جودة) — نفس مصدري getLeaderboard القائمين. */
function Medal({ children }: { children: React.ReactNode }) {
  return (
    <span className="mr-1.5 rounded-full px-2.5 py-1 text-[10.5px] text-muted-foreground" style={{ background: "var(--gold-a03)", border: "1px solid var(--gold-a20)" }}>
      {children}
    </span>
  );
}

/** صف HUD لمرتَّب غير المتصدر — الذهب يخفت مع نزول الترتيب. */
function HudRow({ r, tier, improved, topQuality, pct, entered, filled, delayMs, zainClass }: {
  r: BoardViewRow;
  tier: string | null;
  improved: boolean;
  topQuality: boolean;
  pct: number;
  entered: boolean;
  filled: boolean;
  delayMs: number;
  zainClass: string;
}) {
  const zero = r.score === 0;
  const second = r.rank === 2;
  // شدة الذهب تخفت مع الترتيب: الثاني كامل التوهج ثم تدرّج نازل بأرضية هادئة.
  const glow = Math.max(0.35, 1 - (r.rank - 2) * 0.16);

  return (
    <div
      className="grid grid-cols-[34px_minmax(0,1fr)_minmax(90px,1.2fr)_66px] items-center gap-3 rounded-xl px-3.5 py-2.5"
      style={{
        background: zero ? "transparent" : "var(--card)",
        border: zero ? "1px dashed var(--hairline)" : "1px solid var(--hairline)",
        borderRight: second ? "3px solid var(--gold)" : undefined,
        opacity: entered ? (zero ? 0.6 : 1) : 0,
        transform: entered ? "none" : "translateY(6px)",
        transition: "opacity .45s ease, transform .5s cubic-bezier(.32,.72,0,1)",
        transitionDelay: `${delayMs}ms`,
      }}
    >
      {/* الترتيب */}
      <div className={`${zainClass} text-center text-[19px] font-bold`} style={{ color: second ? "var(--gold)" : "var(--muted-foreground)", ...NUM }}>
        {toArabicDigits(r.rank)}
      </div>

      {/* الاسم + اللقب + الأوسمة */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-[13.5px] font-semibold text-foreground">{r.name}</span>
          {r.isSelf && <span className="rounded-md px-1.5 py-0.5 text-[10.5px] font-medium text-gold" style={{ background: "var(--gold-a12)" }}>أنت</span>}
          {improved && <Medal>الأكثر تحسنًا</Medal>}
          {topQuality && <Medal>أعلى جودة</Medal>}
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground/70" style={NUM}>
          {zero ? "صفر إنجاز هذا الأسبوع" : tier ?? (r.qualityFactor !== 1 ? `جودة ×${toArabicDigits(r.qualityFactor.toFixed(2))}` : " ")}
        </div>
      </div>

      {/* المؤشر الليزري — طوله نسبة درجته من المتصدر، بنقطة متوهجة بطرفه */}
      <div className="relative h-1 rounded-full" style={{ background: zero ? "transparent" : "var(--secondary)" }}>
        {!zero && (
          <div
            className="relative h-full rounded-full"
            style={{
              width: filled ? `${pct}%` : "0%",
              background: `linear-gradient(270deg, var(--gold), var(--gold-a12))`,
              opacity: glow,
              transition: "width .9s cubic-bezier(.32,.72,0,1)",
              transitionDelay: `${delayMs}ms`,
            }}
          >
            <span
              aria-hidden
              className="absolute left-0 top-1/2 size-[7px] -translate-y-1/2 rounded-full"
              style={{ background: "var(--gold-light)", boxShadow: "0 0 8px var(--gold-a60), 0 0 18px var(--gold-a35)" }}
            />
          </div>
        )}
      </div>

      {/* الدرجة */}
      <div className={`${zainClass} text-left text-[21px] font-extrabold leading-none`} style={{ color: zero ? "var(--muted-foreground)" : second ? "var(--gold)" : "var(--foreground)", opacity: zero ? 1 : Math.max(0.72, glow), ...NUM }}>
        {toArabicDigits(r.score)}
      </div>
    </div>
  );
}

export default CommandHud;
