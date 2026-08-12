"use client";

import { useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";
import type { BoardView, BoardViewRow } from "@/lib/data/leaderboard";
import { toArabicDigits } from "@/lib/format";

/**
 * لوحة الأسبوع — «القمم»: برج لكل موظف، ارتفاعه نسبة درجته من درجة المتصدر.
 *
 * عرض خالص فوق `toBoardView` — **الأرقام الخام لغير المستحق غير موجودة في الـprops
 * أصلًا** (سُدّت على الخادم، لا بالإخفاء هنا). هذا المكوّن لا يعرف عنها شيئًا.
 *
 * الحركة: دخول متتابع بـscaleY من الأسفل + تعبئة الأشرطة مرة واحدة، وكلاهما
 * يُلغى مع prefers-reduced-motion، ومؤقّتاتهما مُنظَّفة بالكامل.
 */

const NUM = { fontVariantNumeric: "tabular-nums" as const };

/** ألقاب المراكز — الوسطى بلا لقب إن زاد الفريق، والأخير «خط البداية». */
function tierOf(rank: number, total: number): string | null {
  if (rank === 1) return "الصدارة";
  if (rank === 2) return "المطاردة";
  if (rank === 3) return "منصة التتويج";
  if (rank === total) return "خط البداية";
  if (rank === 4) return "الملاحقة";
  if (rank === 5) return "الانطلاقة";
  return null;
}

/** مقاس الدرجة يتدرّج بالمركز (مرجع القمم). */
function scoreSize(rank: number): number {
  return [46, 37, 32, 28, 24][rank - 1] ?? 21;
}

export function PeaksBoard({ view, zainClass }: { view: BoardView; zainClass: string }) {
  const [entered, setEntered] = useState(false);
  const [filled, setFilled] = useState(false);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced.current) { setEntered(true); setFilled(true); return; }
    const t1 = setTimeout(() => setEntered(true), 60);
    const t2 = setTimeout(() => setFilled(true), 700);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const rows = view.rows;
  if (rows.length === 0) {
    return <p className="text-[13.5px] text-muted-foreground">ما فيه موظفون في الترتيب هذا الأسبوع.</p>;
  }
  const top = Math.max(...rows.map((r) => r.score), 1);
  const total = rows.length;

  return (
    <>
      {/* سطر الخصوصية — نص + أيقونة خطية، بلا حدود */}
      <div className="mb-6 flex items-center gap-2 text-[12px] text-muted-foreground/70">
        <Lock className="size-[13px] shrink-0" strokeWidth={1.6} />
        {view.managerView
          ? "أنت ترى كل الأرقام بحكم دورك — الموظف يرى أرقامه وحده ونِسب زملائه"
          : "تفاصيل النشاط تُعرض نِسبًا من إجمالي الفريق — وكل موظف يرى أرقامه الفعلية وحده"}
      </div>

      {/* الأبراج — محاذاة سفلية، والأول أقصى اليمين (RTL طبيعي) */}
      <div className="flex h-[420px] items-end gap-3.5 overflow-x-auto pb-0.5">
        {rows.map((r, i) => (
          <Peak
            key={r.id}
            r={r}
            heightPct={Math.max(26, Math.round((r.score / top) * 100))}
            tier={tierOf(r.rank, total)}
            context={contextOf(r, rows, view)}
            improved={view.mostImprovedId === r.id}
            entered={entered}
            filled={filled}
            delayMs={reduced.current ? 0 : i * 100}
            zainClass={zainClass}
          />
        ))}
      </div>

      {/* خارج الترتيب — صف هادئ بأسماء بلا درجات */}
      {view.unranked.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-2.5 text-[12.5px] text-muted-foreground/70">
          بلا عملاء مسندين هذا الأسبوع — خارج الترتيب:
          {view.unranked.map((u) => (
            <span key={u.id} className="rounded-[9px] bg-card px-3.5 py-1.5 text-muted-foreground">{u.name}</span>
          ))}
        </div>
      )}
    </>
  );
}

/** سطر السياق — محسوب فعليًا، بلا نص ثابت. */
function contextOf(r: BoardViewRow, rows: BoardViewRow[], view: BoardView): string {
  if (r.score === 0) return "أول تواصل يفتح عدّادك";
  if (r.rank === 1) return "نجمة الأسبوع";
  if (view.topQualityId === r.id) return "أعلى جودة بالفريق";
  const topScore = rows[0]?.score ?? 0;
  const gap = topScore - r.score;
  return gap > 0 ? `يفصلك عن الصدارة ${toArabicDigits(gap)}` : "على القمة";
}

function Peak({ r, heightPct, tier, context, improved, entered, filled, delayMs, zainClass }: {
  r: BoardViewRow;
  heightPct: number;
  tier: string | null;
  context: string;
  improved: boolean;
  entered: boolean;
  filled: boolean;
  delayMs: number;
  zainClass: string;
}) {
  const first = r.rank === 1;
  return (
    <div
      className="flex min-w-[138px] flex-1 flex-col overflow-hidden rounded-t-2xl rounded-b-xl bg-secondary/50 transition-colors hover:bg-secondary"
      style={{
        height: `${heightPct}%`,
        transformOrigin: "bottom",
        opacity: entered ? 1 : 0,
        transform: entered ? "none" : "scaleY(.6)",
        transition: "opacity .55s ease, transform .7s cubic-bezier(.32,.72,0,1), background-color .2s ease",
        transitionDelay: `${delayMs}ms`,
      }}
    >
      {/* قمة البرج — ذهبية للمتصدر وحده */}
      <span aria-hidden className={`h-1 flex-none ${first ? "bg-gold" : "bg-white/10"}`} />

      <div className="flex h-full flex-col p-4 pt-4">
        <div className={`${zainClass} font-extrabold leading-none tracking-tight ${first ? "text-gold" : r.score === 0 ? "text-muted-foreground/70" : "text-foreground"}`} style={{ fontSize: scoreSize(r.rank), ...NUM }}>
          {toArabicDigits(r.score)}
        </div>
        <div className="mt-1 text-[11.5px] text-muted-foreground/70">
          درجة{r.qualityFactor !== 1 && <> · جودة ×{toArabicDigits(r.qualityFactor.toFixed(2))}</>}
        </div>

        {/* الأرقام: الخام لصاحبها والمدير · النِسب لغيرهم */}
        {r.raw ? (
          <>
            <Bar label="تواصلك" value={toArabicDigits(r.raw.contacted)} width={filled ? Math.min(100, r.raw.contacted) : 0} gold={first} />
            <Bar label="مهتمونك" value={toArabicDigits(r.raw.interested)} width={filled ? Math.min(100, r.raw.interested * 2) : 0} gold={first} />
          </>
        ) : r.share ? (
          <>
            <Bar label="من تواصل الفريق" value={`${toArabicDigits(r.share.contactShare)}٪`} width={filled ? r.share.contactShare : 0} gold={first} />
            <Bar label="من المهتمين" value={`${toArabicDigits(r.share.interestedShare)}٪`} width={filled ? r.share.interestedShare : 0} gold={first} />
          </>
        ) : null}

        {/* القاعدة */}
        <div className="mt-auto pt-3">
          <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted-foreground/70" style={NUM}>
            {toArabicDigits(r.rank)}{tier && ` · ${tier}`}
            {r.isSelf && (
              <span className="rounded-md bg-gold/10 px-2 py-0.5 text-[11.5px] font-medium text-gold">أنت</span>
            )}
          </div>
          <div className="mt-0.5 text-[14.5px] font-semibold leading-snug text-foreground">{r.name}</div>
          <div className={`mt-0.5 text-[11.5px] leading-normal ${first ? "text-gold" : "text-muted-foreground/70"}`}>{context}</div>
          {improved && <div className="mt-1 text-[11.5px] text-muted-foreground/70">الأكثر تحسنًا</div>}
        </div>
      </div>
    </div>
  );
}

function Bar({ label, value, width, gold }: { label: string; value: string; width: number; gold: boolean }) {
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-baseline justify-between gap-1.5 text-[11.5px] text-muted-foreground/70">
        <span className="truncate">{label}</span>
        <b className="font-semibold text-muted-foreground" style={NUM}>{value}</b>
      </div>
      <div className="h-1 overflow-hidden rounded-sm bg-card">
        <div
          className={`h-full rounded-sm ${gold ? "bg-gold" : "bg-muted-foreground/60"}`}
          style={{ width: `${width}%`, transition: "width 1s cubic-bezier(.32,.72,0,1)" }}
        />
      </div>
    </div>
  );
}

export default PeaksBoard;
