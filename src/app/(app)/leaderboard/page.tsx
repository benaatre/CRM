import { Role } from "@prisma/client";
import { Trophy } from "lucide-react";
import Link from "next/link";
import { requireUser } from "@/lib/auth-guards";
import { getLeaderboard, weekStartKSA, POINTS } from "@/lib/data/leaderboard";
import { toArabicDigits } from "@/lib/format";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;
const MEDALS = ["🥇", "🥈", "🥉"];

function fmtDay(d: Date): string {
  return new Intl.DateTimeFormat("ar-SA-u-nu-arab", { timeZone: "Asia/Riyadh", day: "numeric", month: "short" }).format(d);
}

// لوحة الأسبوع — الكل يراها (الشفافية مقصودة). لا مكافآت مالية — عرض وترتيب فقط.
export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;

  // فلتر الأسابيع السابقة للمالك فقط — الصلاحية على الخادم (غير المالك يتجاهل البارامتر).
  let ref = new Date();
  if (user.role === Role.OWNER && sp.w && /^\d{4}-\d{2}-\d{2}$/.test(sp.w)) {
    const parsed = new Date(`${sp.w}T12:00:00+03:00`);
    if (!Number.isNaN(parsed.getTime()) && parsed <= new Date()) ref = parsed;
  }

  const board = await getLeaderboard(ref);
  const star = board.rows.find((r) => r.rank === 1 && r.points > 0) ?? null;
  const weekEndShown = new Date(board.weekEnd.getTime() - DAY_MS); // آخر يوم معروض (السبت)

  // خيارات فلتر الأسابيع (المالك): الأسبوع الحالي + ٧ سابقة — حساب حي بلا تخزين.
  const thisWeek = weekStartKSA(new Date());
  const weekOptions = Array.from({ length: 8 }, (_, i) => {
    const start = new Date(thisWeek.getTime() - i * 7 * DAY_MS);
    const key = new Date(start.getTime() + 3 * 3_600_000).toISOString().slice(0, 10); // تاريخ الأحد (بتوقيت الرياض)
    return { key, start, current: i === 0 };
  });

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Trophy className="size-6 text-gold" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">لوحة الأسبوع</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {fmtDay(board.weekStart)} — {fmtDay(weekEndShown)} · ينقلب الأسبوع الأحد ١٢ بالليل بتوقيت الرياض
            </p>
          </div>
        </div>
        {/* فلتر الأسابيع السابقة — للمالك فقط */}
        {user.role === Role.OWNER && (
          <div className="flex flex-wrap items-center gap-1.5">
            {weekOptions.map((w) => {
              const active = w.start.getTime() === board.weekStart.getTime();
              return (
                <Link
                  key={w.key}
                  href={w.current ? "/leaderboard" : `/leaderboard?w=${w.key}`}
                  className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${active ? "border-gold bg-gold/15 text-gold" : "border-border text-muted-foreground hover:text-foreground"}`}
                >
                  {w.current ? "هذا الأسبوع" : fmtDay(w.start)}
                </Link>
              );
            })}
          </div>
        )}
      </header>

      {/* نجمة الأسبوع */}
      {star && (
        <section className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gold/40 bg-gold/5 p-5">
          <div className="flex items-center gap-3">
            <div className="flex size-14 items-center justify-center rounded-full bg-gold/15 text-3xl">⭐</div>
            <div>
              <div className="text-xs text-muted-foreground">نجمة الأسبوع</div>
              <div className="text-xl font-bold text-gold">{star.name}</div>
            </div>
          </div>
          <div className="text-left">
            <div className="text-3xl font-bold text-gold" style={{ fontVariantNumeric: "tabular-nums" }}>{toArabicDigits(star.points)}</div>
            <div className="text-xs text-muted-foreground">نقطة</div>
          </div>
        </section>
      )}

      {/* معادلة النقاط */}
      <p className="text-xs text-muted-foreground">
        النقاط: موعد زيارة مؤكّد ×{toArabicDigits(POINTS.visitAppt)} · زيارة تمّت ×{toArabicDigits(POINTS.visitDone)} · حجز ×{toArabicDigits(POINTS.booking)} · متابعة مسجّلة ×{toArabicDigits(POINTS.followup)} — عرض وترتيب فقط، بلا مكافآت مالية.
      </p>

      {/* الترتيب */}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[760px] text-right text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
          <thead className="bg-secondary/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">#</th>
              <th className="px-4 py-3 font-medium">الموظف</th>
              <th className="px-3 py-3 text-center font-medium">🔥 انضباط</th>
              <th className="px-3 py-3 text-center font-medium">مواعيد زيارات</th>
              <th className="px-3 py-3 text-center font-medium">زيارات تمّت</th>
              <th className="px-3 py-3 text-center font-medium">حجوزات</th>
              <th className="px-3 py-3 text-center font-medium">متابعات</th>
              <th className="px-3 py-3 text-center font-medium">النقاط</th>
            </tr>
          </thead>
          <tbody>
            {board.rows.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">ما فيه موظفون نشطون.</td></tr>
            ) : board.rows.map((r) => (
              <tr key={r.id} className={`border-t border-border ${r.rank <= 3 && r.points > 0 ? "bg-gold/[0.04]" : ""}`}>
                <td className="px-4 py-3 text-lg">{r.points > 0 && r.rank <= 3 ? MEDALS[r.rank - 1] : <span className="text-sm text-muted-foreground">{toArabicDigits(r.rank)}</span>}</td>
                <td className="px-4 py-3 font-medium text-foreground">{r.name}</td>
                <td className="px-3 py-3 text-center">
                  {r.streakDays > 0
                    ? <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-bold text-warning" title="أيام متتالية بلا عميل متأخر في «لم يتم الرد»">🔥 {toArabicDigits(r.streakDays)}</span>
                    : <span className="text-xs text-muted-foreground" title="عنده عملاء متأخرون حاليًا">—</span>}
                </td>
                <td className="px-3 py-3 text-center text-sky-300">{toArabicDigits(r.visitAppts)}</td>
                <td className="px-3 py-3 text-center text-info">{toArabicDigits(r.visitsDone)}</td>
                <td className="px-3 py-3 text-center text-success">{toArabicDigits(r.bookings)}</td>
                <td className="px-3 py-3 text-center text-muted-foreground">{toArabicDigits(r.followups)}</td>
                <td className="px-3 py-3 text-center text-base font-bold text-gold" style={{ fontVariantNumeric: "tabular-nums" }}>{toArabicDigits(r.points)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
