import { Role } from "@prisma/client";
import { Zain } from "next/font/google";
import { requireUser, isManager } from "@/lib/auth-guards";
import { getLeaderboard, toBoardView, weekStartKSA } from "@/lib/data/leaderboard";
import { CommandHud } from "@/components/leaderboard/command-hud";

// خط الأرقام العرضية — يُحمَّل هنا وحده فلا يمسّ تخطيط الويب المشترك.
const zain = Zain({ subsets: ["arabic"], weight: ["700", "800"], display: "swap" });

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

function fmtDay(d: Date): string {
  return new Intl.DateTimeFormat("ar-SA-u-nu-arab", { calendar: "gregory", timeZone: "Asia/Riyadh", day: "numeric", month: "short" }).format(d);
}

// لوحة الأسبوع — «غرفة القيادة» (إعادة تصميم 2026-09): الكل يراها (الشفافية مقصودة).
// المنطق والحسابات في getLeaderboard كما هي حرفيًا — هذه الصفحة عرض فقط.
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
  /*
   * سدّ التسريب: الحمولة تمرّ بطبقة الخصوصية **قبل أي إرسال للعميل**. الموظف
   * لا تصل متصفحه أرقام زملائه الخام إطلاقًا — النوع نفسه لا يحملها له.
   */
  const view = toBoardView(board, user.id, isManager(user.role));
  const weekEndShown = new Date(board.weekEnd.getTime() - DAY_MS); // آخر يوم معروض (السبت)

  // تبويبا «هذا الأسبوع / الأسبوع السابق» (للمالك — نفس آلية ?w القائمة؛
  // الأسابيع الأقدم تبقى متاحة بالرابط المباشر ?w=YYYY-MM-DD كما كانت).
  const thisWeek = weekStartKSA(new Date());
  const prevWeek = new Date(thisWeek.getTime() - 7 * DAY_MS);
  const prevKey = new Date(prevWeek.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
  const tabs = user.role === Role.OWNER
    ? [
        { label: "هذا الأسبوع", href: "/leaderboard", active: board.weekStart.getTime() === thisWeek.getTime() },
        { label: "الأسبوع السابق", href: `/leaderboard?w=${prevKey}`, active: board.weekStart.getTime() === prevWeek.getTime() },
      ]
    : null;

  return (
    <div className="mx-auto max-w-[1080px]">
      <CommandHud
        view={view}
        zainClass={zain.className}
        range={`${fmtDay(board.weekStart)} — ${fmtDay(weekEndShown)}`}
        tabs={tabs}
      />
    </div>
  );
}
