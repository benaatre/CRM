"use client";

// لوحة الأسبوع — الاجتهاد الفعلي يحكم: الدرجة = الإنجاز المطلق × معامل الجودة (٠٫٨–١٫٢).
// منصة تتويج ثلاثية + بطاقات صفوف بعدادات الاجتهاد الظاهرة + عدادات متحركة + تلميح
// يفصّل (إنجاز × جودة = درجة) ومكوّنات الجودة الأربعة — الشفافية تمنع الإحساس بالظلم.
import { useEffect, useRef, useState } from "react";
import { toArabicDigits } from "@/lib/format";
import type { Leaderboard, LeaderboardRow } from "@/lib/data/leaderboard";

const MEDALS = ["🥇", "🥈", "🥉"];

/** أوزان الإنجاز — تُمرَّر من الخادم (data/leaderboard خادمي فقط). */
export type Weights = { contacted: number; followup: number; interested: number; visitAppt: number; visitDone: number; booking: number; win: number };

/** تفكيك الدرجة الكامل (زر «تفاصيل» للمالك): كل مكوّن إنجاز بعدده ونقاطه + معامل الجودة بمكوناته. */
function ScoreBreakdown({ r, w }: { r: LeaderboardRow; w: Weights }) {
  const p = r.parts;
  const lines: [string, number, number][] = [
    ["عملاء تواصل معهم", r.contacted, w.contacted],
    ["متابعات (بعد السقف اليومي)", r.cappedFollowups, w.followup],
    ["نقلهم لمهتم", r.interested, w.interested],
    ["مواعيد زيارة أكّدها", r.visitAppts, w.visitAppt],
    ["زيارات تمّت", r.visitsDone, w.visitDone],
    ["حجوزات", r.bookings, w.booking],
    ["مبيعات", r.wins, w.win],
  ];
  return (
    <div className="mt-2 rounded-xl border border-gold/20 bg-background/50 p-3 text-right text-[11px] leading-6">
      <div className="mb-1 font-bold text-gold">تفكيك درجة {r.name}</div>
      <div className="grid gap-x-6 sm:grid-cols-2">
        <div>
          <div className="mb-0.5 font-medium text-foreground">الإنجاز:</div>
          {lines.map(([label, n, weight]) => (
            <div key={label} className="flex justify-between">
              <span className="text-muted-foreground">{label}</span>
              <span className="text-foreground" style={{ fontVariantNumeric: "tabular-nums" }}>{toArabicDigits(n)} ×{toArabicDigits(weight)} = <span className="font-bold">{toArabicDigits(n * weight)}</span></span>
            </div>
          ))}
          <div className="mt-0.5 flex justify-between border-t border-border pt-0.5 font-bold">
            <span className="text-foreground">مجموع الإنجاز</span>
            <span className="text-gold">{toArabicDigits(r.achievement)}</span>
          </div>
        </div>
        <div>
          <div className="mb-0.5 font-medium text-foreground">معامل الجودة ×{r.qualityFactor.toFixed(2).replace(".", "٫")} (من {toArabicDigits(r.qualityPct)}٪):</div>
          <div className="flex justify-between"><span className="text-muted-foreground">التغطية</span><span className="text-foreground">{toArabicDigits(p.coverage)}٪ ({toArabicDigits(p.covered)}/{toArabicDigits(p.assignedActive)})</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">الالتزام بالمواعيد</span><span className="text-foreground">{toArabicDigits(p.punctuality)}٪ ({toArabicDigits(p.fulfilled)}/{toArabicDigits(p.dueCount)})</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">سرعة الاستجابة</span><span className="text-foreground">{p.speedScore == null ? "— (ما استلم جددًا)" : `${toArabicDigits(p.speedScore)}٪${p.avgFirstResponseH != null ? ` (~${toArabicDigits(p.avgFirstResponseH)}س)` : ""}`}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">نظافة «لم يتم الرد»</span><span className="text-foreground">{toArabicDigits(p.overdueBonus)}٪{p.overdueCount > 0 ? ` (${toArabicDigits(p.overdueCount)} متأخر)` : ""}</span></div>
          <div className="mt-0.5 flex justify-between border-t border-border pt-0.5 font-bold">
            <span className="text-foreground">الدرجة النهائية</span>
            <span className="text-gold">{toArabicDigits(r.achievement)} ×{r.qualityFactor.toFixed(2).replace(".", "٫")} = {toArabicDigits(r.score)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** عدّاد متحرك (count-up) عند فتح الصفحة — rAF بمنحنى تباطؤ. */
function CountUp({ value, suffix = "" }: { value: number; suffix?: string }) {
  const [n, setN] = useState(0);
  const done = useRef(false);
  useEffect(() => {
    if (done.current) { setN(value); return; }
    done.current = true;
    const t0 = performance.now();
    const dur = 900;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      setN(Math.round(value * (1 - Math.pow(1 - p, 3)))); // ease-out
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{toArabicDigits(n)}{suffix}</>;
}

/** تلميح التفصيل: إنجاز × معامل الجودة = الدرجة + مكوّنات الجودة الأربعة. */
function ScoreTip({ r }: { r: LeaderboardRow }) {
  const p = r.parts;
  return (
    <div className="pointer-events-none absolute bottom-full right-0 z-30 mb-2 hidden w-72 rounded-xl border border-gold/30 bg-card p-3 text-right text-[11px] leading-6 shadow-2xl group-hover:block">
      <div className="mb-1 flex justify-between font-bold">
        <span className="text-gold">الدرجة</span>
        <span className="text-foreground">إنجاز {toArabicDigits(r.achievement)} × جودة ×{r.qualityFactor.toFixed(2).replace(".", "٫")} = {toArabicDigits(r.score)}</span>
      </div>
      <div className="mb-1 border-t border-border pt-1 text-muted-foreground">مكوّنات الجودة ({toArabicDigits(r.qualityPct)}٪ → المعامل):</div>
      <div className="flex justify-between"><span className="text-muted-foreground">التغطية (تواصل مع عملائه)</span><span className="font-bold text-foreground">{toArabicDigits(p.coverage)}٪ <span className="font-normal text-muted-foreground">({toArabicDigits(p.covered)}/{toArabicDigits(p.assignedActive)})</span></span></div>
      <div className="flex justify-between"><span className="text-muted-foreground">الالتزام بالمواعيد</span><span className="font-bold text-foreground">{toArabicDigits(p.punctuality)}٪ <span className="font-normal text-muted-foreground">({toArabicDigits(p.fulfilled)}/{toArabicDigits(p.dueCount)})</span></span></div>
      <div className="flex justify-between"><span className="text-muted-foreground">سرعة الاستجابة للجديد</span><span className="font-bold text-foreground">{p.speedScore == null ? "—" : `${toArabicDigits(p.speedScore)}٪`}{p.avgFirstResponseH != null && <span className="font-normal text-muted-foreground"> (~{toArabicDigits(p.avgFirstResponseH)}س)</span>}</span></div>
      <div className="flex justify-between"><span className="text-muted-foreground">نظافة «لم يتم الرد»</span><span className="font-bold text-foreground">{toArabicDigits(p.overdueBonus)}٪ {p.overdueCount > 0 && <span className="font-normal text-destructive">({toArabicDigits(p.overdueCount)} متأخر)</span>}</span></div>
    </div>
  );
}

/** صف عدادات الاجتهاد المطلقة — ظاهرة لا مخفية. */
function Counters({ r, compact = false }: { r: LeaderboardRow; compact?: boolean }) {
  const items = [
    { icon: "📞", label: "تواصل", v: r.contacted },
    { icon: "💚", label: "مهتمون", v: r.interested },
    { icon: "🏠", label: "زيارات", v: r.visitsDone },
    { icon: "📋", label: "حجوزات", v: r.bookings },
    { icon: "💰", label: "مبيعات", v: r.wins },
  ];
  return (
    <div className={`flex flex-wrap items-center ${compact ? "justify-center gap-x-2.5 gap-y-1" : "gap-x-3 gap-y-1"} text-[11px] text-muted-foreground`}>
      {items.map((it) => (
        <span key={it.label} className="whitespace-nowrap">
          {it.icon} {it.label} <span className={`font-bold ${it.v > 0 ? "text-foreground" : "text-muted-foreground/60"}`}>{toArabicDigits(it.v)}</span>
        </span>
      ))}
      <Streak days={r.streakDays} />
    </div>
  );
}

function Streak({ days }: { days: number }) {
  if (days <= 0) return <span className="text-[11px] text-muted-foreground/60" title="عنده عملاء متأخرون في «لم يتم الرد»">🔥 —</span>;
  return (
    <span className="whitespace-nowrap text-[11px] font-bold text-warning" title="أيام متتالية بلا عميل متأخر في «لم يتم الرد»">
      🔥 {toArabicDigits(days)}
    </span>
  );
}

/** بطاقة منصة التتويج — الأول أعلى وأوسط بتوهج ذهبي، والدرجة رقم كبير. */
function PodiumCard({ r, place, improved }: { r: LeaderboardRow; place: number; improved: boolean }) {
  const first = place === 0;
  return (
    <div
      className={`relative flex flex-col items-center rounded-2xl border p-4 text-center ${
        first
          ? "z-10 -mt-4 border-gold/60 bg-gold/[0.07] shadow-[0_0_35px_rgba(203,164,94,0.25)]"
          : "border-gold/25 bg-card/60"
      }`}
    >
      {first && <div className="absolute -top-3 rounded-full bg-gold px-3 py-0.5 text-[11px] font-bold text-primary-foreground">نجمة الأسبوع ⭐</div>}
      <div className={first ? "text-4xl" : "text-3xl"}>{MEDALS[place]}</div>
      <div className={`mt-1 font-bold text-foreground ${first ? "text-lg" : "text-sm"}`}>{r.name}{improved && <span title="الأكثر تحسنًا عن الأسبوع الماضي"> 📈</span>}</div>
      <div className="group relative cursor-help">
        <div className={`mt-2 font-bold text-gold ${first ? "text-5xl" : "text-3xl"}`} style={{ fontVariantNumeric: "tabular-nums" }}>
          <CountUp value={r.score} />
        </div>
        <ScoreTip r={r} />
      </div>
      <div className="text-[11px] text-muted-foreground">درجة</div>
      <div className="mt-2.5">
        <Counters r={r} compact />
      </div>
    </div>
  );
}

export function LeaderboardView({ board, isOwner = false, weights }: { board: Leaderboard; isOwner?: boolean; weights?: Weights }) {
  const top3 = board.rows.slice(0, 3);
  const rest = board.rows.slice(3);
  // ترتيب عرض المنصة: الثاني · الأول (مرتفع بالوسط) · الثالث.
  const podiumOrder = [top3[1], top3[0], top3[2]].filter(Boolean) as LeaderboardRow[];
  const placeOf = (r: LeaderboardRow) => top3.indexOf(r);
  // زر «تفاصيل» (المالك): تفكيك درجة موظف واحد مفتوح في كل مرة.
  const [detailId, setDetailId] = useState<string | null>(null);
  const canDetail = isOwner && !!weights;
  const DetailBtn = ({ r }: { r: LeaderboardRow }) => canDetail ? (
    <button
      type="button"
      onClick={() => setDetailId(detailId === r.id ? null : r.id)}
      className={`rounded-lg border px-2 py-0.5 text-[10px] transition-colors ${detailId === r.id ? "border-gold bg-gold/15 text-gold" : "border-border text-muted-foreground hover:text-gold"}`}
    >تفاصيل</button>
  ) : null;

  return (
    <div className="space-y-6">
      {/* منصة التتويج الثلاثية */}
      {top3.length > 0 && (
        <div className={`grid items-end gap-3 pt-4 ${podiumOrder.length === 3 ? "grid-cols-3" : podiumOrder.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
          {podiumOrder.map((r) => (
            <div key={r.id} className="flex flex-col">
              <PodiumCard r={r} place={placeOf(r)} improved={board.mostImprovedId === r.id} />
              {canDetail && <div className="mt-1.5 text-center"><DetailBtn r={r} /></div>}
            </div>
          ))}
        </div>
      )}
      {/* تفكيك أحد الثلاثة الأوائل */}
      {canDetail && detailId && top3.some((r) => r.id === detailId) && (
        <ScoreBreakdown r={top3.find((r) => r.id === detailId)!} w={weights!} />
      )}

      {/* بقية المرتَّبين — بطاقات صفوف بعدادات الاجتهاد الظاهرة */}
      {rest.length > 0 && (
        <div className="space-y-2">
          {rest.map((r) => (
            <div key={r.id} className="rounded-2xl border border-border bg-card/60 px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="w-7 shrink-0 text-center text-sm font-bold text-muted-foreground">{toArabicDigits(r.rank)}</span>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{r.name}</span>
                    {board.mostImprovedId === r.id && <span className="rounded-full bg-info/10 px-1.5 py-0.5 text-[10px] font-bold text-info" title="الأكثر تحسنًا عن الأسبوع الماضي">📈 الأكثر تحسنًا</span>}
                    <DetailBtn r={r} />
                  </div>
                  <Counters r={r} />
                </div>
                <div className="group relative shrink-0 cursor-help text-left">
                  <div className="text-2xl font-bold text-gold" style={{ fontVariantNumeric: "tabular-nums" }}><CountUp value={r.score} /></div>
                  <div className="text-[10px] text-muted-foreground">درجة</div>
                  <ScoreTip r={r} />
                </div>
              </div>
              {canDetail && detailId === r.id && <ScoreBreakdown r={r} w={weights!} />}
            </div>
          ))}
        </div>
      )}

      {/* بلا عملاء مسندين — خارج الترتيب، لا صفر مخزٍ */}
      {board.unranked.length > 0 && (
        <div className="rounded-2xl border border-border/60 bg-secondary/20 p-4">
          <div className="mb-2 text-xs font-medium text-muted-foreground">بلا عملاء مسندين هذا الأسبوع — خارج الترتيب</div>
          <div className="flex flex-wrap gap-2">
            {board.unranked.map((r) => (
              <span key={r.id} className="rounded-full bg-secondary/60 px-3 py-1 text-xs text-muted-foreground/80">{r.name}</span>
            ))}
          </div>
        </div>
      )}

      {board.rows.length === 0 && board.unranked.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">ما فيه موظفون نشطون.</p>
      )}
    </div>
  );
}
