"use client";

// لوحة الأسبوع — منصة تتويج ثلاثية + بطاقات صفوف بشريط كفاءة متدرّج + عدادات متحركة
// + تلميح يفصّل مكوّنات «الكفاءة» الأربعة (الشفافية تمنع الإحساس بالظلم).
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toArabicDigits } from "@/lib/format";
import type { Leaderboard, LeaderboardRow } from "@/lib/data/leaderboard";

const MEDALS = ["🥇", "🥈", "🥉"];

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

/** تلميح مكوّنات الكفاءة الأربعة — يظهر عند الوقوف على الرقم. */
function EfficiencyTip({ r }: { r: LeaderboardRow }) {
  const p = r.parts;
  return (
    <div className="pointer-events-none absolute bottom-full right-0 z-30 mb-2 hidden w-64 rounded-xl border border-gold/30 bg-card p-3 text-right text-[11px] leading-6 shadow-2xl group-hover:block">
      <div className="mb-1 font-bold text-gold">مكوّنات الكفاءة</div>
      <div className="flex justify-between"><span className="text-muted-foreground">التغطية (تواصل مع عملائه)</span><span className="font-bold text-foreground">{toArabicDigits(p.coverage)}٪ <span className="font-normal text-muted-foreground">({toArabicDigits(p.covered)}/{toArabicDigits(p.assignedActive)})</span></span></div>
      <div className="flex justify-between"><span className="text-muted-foreground">الالتزام بالمواعيد</span><span className="font-bold text-foreground">{toArabicDigits(p.punctuality)}٪ <span className="font-normal text-muted-foreground">({toArabicDigits(p.fulfilled)}/{toArabicDigits(p.dueCount)})</span></span></div>
      <div className="flex justify-between"><span className="text-muted-foreground">سرعة الاستجابة للجديد</span><span className="font-bold text-foreground">{p.speedScore == null ? "—" : `${toArabicDigits(p.speedScore)}٪`}{p.avgFirstResponseH != null && <span className="font-normal text-muted-foreground"> (~{toArabicDigits(p.avgFirstResponseH)}س)</span>}</span></div>
      <div className="flex justify-between"><span className="text-muted-foreground">نظافة «لم يتم الرد»</span><span className="font-bold text-foreground">{toArabicDigits(p.overdueBonus)}٪ {p.overdueCount > 0 && <span className="font-normal text-destructive">({toArabicDigits(p.overdueCount)} متأخر)</span>}</span></div>
    </div>
  );
}

/** شريط تقدم الكفاءة — تدرّج أحمر←ذهبي←أخضر يُكشف بمقدار النسبة. */
function EfficiencyBar({ pct }: { pct: number }) {
  const w = Math.max(2, Math.min(100, pct));
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-secondary">
      <div
        className="h-full rounded-full transition-all"
        style={{
          width: `${w}%`,
          backgroundImage: "linear-gradient(to left, #22c55e, #CBA45E, #ef4444)",
          backgroundSize: `${10000 / w}% 100%`,
          backgroundPosition: "right",
        }}
      />
    </div>
  );
}

function Streak({ days }: { days: number }) {
  if (days <= 0) return <span className="text-xs text-muted-foreground" title="عنده عملاء متأخرون في «لم يتم الرد»">—</span>;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-xs font-bold text-warning" title="أيام متتالية بلا عميل متأخر في «لم يتم الرد»">
      🔥 {toArabicDigits(days)}
    </span>
  );
}

/** بطاقة منصة التتويج — الأول أعلى وأوسط بتوهج ذهبي. */
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
      <div className={`mt-2 font-bold text-gold ${first ? "text-4xl" : "text-2xl"}`} style={{ fontVariantNumeric: "tabular-nums" }}>
        <CountUp value={r.efficiency} suffix="٪" />
      </div>
      <div className="text-[11px] text-muted-foreground">كفاءة</div>
      <div className="mt-2 flex items-center gap-2 text-xs">
        <span className="rounded-full bg-secondary px-2 py-0.5 text-foreground"><CountUp value={r.points} /> نقطة</span>
        <Streak days={r.streakDays} />
      </div>
    </div>
  );
}

export function LeaderboardView({ board }: { board: Leaderboard }) {
  const top3 = board.rows.slice(0, 3);
  const rest = board.rows.slice(3);
  // ترتيب عرض المنصة: الثاني · الأول (مرتفع بالوسط) · الثالث.
  const podiumOrder = [top3[1], top3[0], top3[2]].filter(Boolean) as LeaderboardRow[];
  const placeOf = (r: LeaderboardRow) => top3.indexOf(r);

  return (
    <div className="space-y-6">
      {/* منصة التتويج الثلاثية */}
      {top3.length > 0 && (
        <div className={`grid items-end gap-3 pt-4 ${podiumOrder.length === 3 ? "grid-cols-3" : podiumOrder.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
          {podiumOrder.map((r) => (
            <PodiumCard key={r.id} r={r} place={placeOf(r)} improved={board.mostImprovedId === r.id} />
          ))}
        </div>
      )}

      {/* بقية المرتَّبين — بطاقات صفوف بشريط الكفاءة */}
      {rest.length > 0 && (
        <div className="space-y-2">
          {rest.map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded-2xl border border-border bg-card/60 px-4 py-3">
              <span className="w-7 shrink-0 text-center text-sm font-bold text-muted-foreground">{toArabicDigits(r.rank)}</span>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{r.name}</span>
                  {board.mostImprovedId === r.id && <span className="rounded-full bg-info/10 px-1.5 py-0.5 text-[10px] font-bold text-info" title="الأكثر تحسنًا عن الأسبوع الماضي">📈 الأكثر تحسنًا</span>}
                  <Streak days={r.streakDays} />
                </div>
                <EfficiencyBar pct={r.efficiency} />
              </div>
              <div className="group relative shrink-0 cursor-help text-left">
                <div className="text-lg font-bold text-gold" style={{ fontVariantNumeric: "tabular-nums" }}><CountUp value={r.efficiency} suffix="٪" /></div>
                <EfficiencyTip r={r} />
              </div>
              <div className="w-16 shrink-0 text-left">
                <div className="text-sm font-bold text-foreground" style={{ fontVariantNumeric: "tabular-nums" }}><CountUp value={r.points} /></div>
                <div className="text-[10px] text-muted-foreground">نقطة</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* التلميح للثلاثة الأوائل أيضًا — صف مصغر تحت المنصة */}
      {top3.length > 0 && (
        <div className="flex flex-wrap justify-center gap-4 text-[11px] text-muted-foreground">
          {top3.map((r) => (
            <span key={r.id} className="group relative cursor-help underline decoration-dotted">
              تفاصيل كفاءة {r.name.split(" ")[0]}
              <EfficiencyTip r={r} />
            </span>
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
