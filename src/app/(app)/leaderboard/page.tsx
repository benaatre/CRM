import { Role } from "@prisma/client";
import { Trophy } from "lucide-react";
import Link from "next/link";
import { requireUser } from "@/lib/auth-guards";
import { getLeaderboard, weekStartKSA, WEIGHTS, DAILY_FOLLOWUP_CAP } from "@/lib/data/leaderboard";
import { toArabicDigits } from "@/lib/format";
import { LeaderboardView } from "@/components/leaderboard/leaderboard-view";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

function fmtDay(d: Date): string {
  return new Intl.DateTimeFormat("ar-SA-u-nu-arab", { timeZone: "Asia/Riyadh", day: "numeric", month: "short" }).format(d);
}

// لوحة الأسبوع — الكل يراها (الشفافية مقصودة). الترتيب بالكفاءة والنقاط عمود ثانٍ.
// لا مكافآت مالية في النظام — عرض وترتيب فقط.
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
  const weekEndShown = new Date(board.weekEnd.getTime() - DAY_MS); // آخر يوم معروض (السبت)

  // خيارات فلتر الأسابيع (المالك): الأسبوع الحالي + ٧ سابقة — حساب حي بلا تخزين.
  const thisWeek = weekStartKSA(new Date());
  const weekOptions = Array.from({ length: 8 }, (_, i) => {
    const start = new Date(thisWeek.getTime() - i * 7 * DAY_MS);
    const key = new Date(start.getTime() + 3 * 3_600_000).toISOString().slice(0, 10); // تاريخ الأحد (بتوقيت الرياض)
    return { key, start, current: i === 0 };
  });

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Trophy className="size-6 text-gold" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">لوحة الأسبوع</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {fmtDay(board.weekStart)} — {fmtDay(weekEndShown)} · الاجتهاد الفعلي يحكم — والجودة تكمّل
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

      <LeaderboardView board={board} isOwner={user.role === Role.OWNER} weights={{ ...WEIGHTS }} />

      {/* المعادلة — شفافية كاملة */}
      <div className="space-y-1 text-[11px] leading-5 text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">الدرجة</span> = الإنجاز × معامل الجودة (٠٫٨–١٫٢). <span className="font-medium text-foreground">الإنجاز</span>: عميل تواصلت معه ×{toArabicDigits(WEIGHTS.contacted)} · متابعة ×{toArabicDigits(WEIGHTS.followup)} <span className="text-warning">(بسقف {toArabicDigits(DAILY_FOLLOWUP_CAP)}/يوم)</span> · نقل لمهتم ×{toArabicDigits(WEIGHTS.interested)} · موعد زيارة ×{toArabicDigits(WEIGHTS.visitAppt)} · زيارة تمّت ×{toArabicDigits(WEIGHTS.visitDone)} · حجز ×{toArabicDigits(WEIGHTS.booking)} · بيع ×{toArabicDigits(WEIGHTS.win)}.
        </p>
        <p>
          <span className="font-medium text-foreground">الجودة</span> (التغطية + الالتزام + السرعة + نظافة «لم يتم الرد») ترفع درجتك حتى +٢٠٪ أو تخصم حتى −٢٠٪ — ومن لم يعمل لا يسبق من عمل: صفر إنجاز = صفر درجة. قف على أي درجة تشوف تفاصيلها.
        </p>
        <p>عرض وترتيب فقط — بلا مكافآت مالية. · رخصة فال {toArabicDigits(1200021029)}</p>
      </div>
    </div>
  );
}
