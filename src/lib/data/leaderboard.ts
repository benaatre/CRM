import "server-only";

// لوحة النقاط والترتيب الأسبوعية — حساب حي بلا تخزين:
//   نقاط = (موعد زيارة مؤكّد ×٥) + (زيارة تمّت ×١٠) + (حجز ×٥٠) + (متابعة مسجّلة ×١)
// المصادر: FollowUp (النتائج) + Booking — استعلامات groupBy مجمّعة، لا N+1.
// الأسبوع ميلادي بتوقيت الرياض: ينقلب الأحد 00:00.
import { FollowUpResult } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getPendingPullByEmployee } from "@/lib/data/no-response";

export const POINTS = { visitAppt: 5, visitDone: 10, booking: 50, followup: 1 } as const;

const KSA_OFFSET_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;

/** بداية الأسبوع (الأحد 00:00 بتوقيت الرياض) للتاريخ المرجعي. */
export function weekStartKSA(ref: Date): Date {
  const k = new Date(ref.getTime() + KSA_OFFSET_MS);
  const startUtcMs = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() - k.getUTCDay(), 0, 0, 0) - KSA_OFFSET_MS;
  return new Date(startUtcMs);
}

export type LeaderboardRow = {
  id: string;
  name: string;
  rank: number;
  points: number;
  visitAppts: number;  // مواعيد زيارة مؤكّدة (×٥) — الجديدة فقط، إعادة الجدولة ما تكسب نقاطًا
  visitsDone: number;  // زيارات تمّت (×١٠) — زار وكمّل أو زار وما ناسبه
  bookings: number;    // حجوزات (×٥٠)
  followups: number;   // متابعات مسجّلة (×١)
  /** سلسلة الانضباط 🔥: أيام متتالية بلا عميل متأخر — صفر لو عنده «يُسحب الآن» حاليًا، وإلا أيام منذ آخر سحب منه. */
  streakDays: number;
};

export type Leaderboard = {
  weekStart: Date;
  weekEnd: Date;
  isCurrentWeek: boolean;
  rows: LeaderboardRow[];
};

// زيارة تمّت = الحضور تحقق (كمّل أو ما ناسبه) — نفس تعريف مؤشر الحضور في التحليلات.
const VISIT_DONE_RESULTS: FollowUpResult[] = [FollowUpResult.INTERESTED_VISITED, FollowUpResult.NOT_INTERESTED_VISITED];

/**
 * لوحة الأسبوع: كل الموظفين النشطين (من بلا نشاط يظهر صفرًا لا يختفي)، مرتّبين بالنقاط.
 * ref يحدّد الأسبوع (فلتر الأسابيع السابقة للمالك — حساب حي بلا تخزين).
 */
export async function getLeaderboard(ref: Date = new Date()): Promise<Leaderboard> {
  const weekStart = weekStartKSA(ref);
  const weekEnd = new Date(weekStart.getTime() + 7 * DAY_MS);
  const now = new Date();
  const inWeek = { gte: weekStart, lt: weekEnd };

  const [emps, fuGrp, apptGrp, visitGrp, bookGrp, pullRows, pending] = await Promise.all([
    prisma.user.findMany({
      where: { role: "EMPLOYEE", active: true },
      select: { id: true, name: true, createdAt: true },
      orderBy: { name: "asc" },
    }),
    prisma.followUp.groupBy({ by: ["createdBy"], where: { createdAt: inWeek }, _count: { _all: true } }),
    prisma.followUp.groupBy({ by: ["createdBy"], where: { createdAt: inWeek, result: FollowUpResult.INTERESTED_VISIT_SCHEDULED }, _count: { _all: true } }),
    prisma.followUp.groupBy({ by: ["createdBy"], where: { createdAt: inWeek, result: { in: VISIT_DONE_RESULTS } }, _count: { _all: true } }),
    prisma.booking.groupBy({ by: ["sellerId"], where: { createdAt: inWeek }, _count: { _all: true } }),
    // آخر سحب «لعدم الرد» من كل موظف (لسلسلة الانضباط) — استعلام واحد ثم أول ظهور لكل موظف.
    prisma.reassignment.findMany({
      where: { toUserId: null, OR: [{ reason: { startsWith: "no_response" } }, { reason: "manual_pull" }] },
      orderBy: { createdAt: "desc" },
      select: { fromUserId: true, createdAt: true },
      take: 500,
    }),
    // «متأخر حاليًا» (يُسحب الآن) — نفس مصدر لوحة «لم يتم الرد» حرفيًا.
    getPendingPullByEmployee(now),
  ]);

  const fuMap = new Map(fuGrp.map((g) => [g.createdBy, g._count._all]));
  const apptMap = new Map(apptGrp.map((g) => [g.createdBy, g._count._all]));
  const visitMap = new Map(visitGrp.map((g) => [g.createdBy, g._count._all]));
  const bookMap = new Map(bookGrp.map((g) => [g.sellerId, g._count._all]));

  const lastPullByEmp = new Map<string, Date>();
  for (const r of pullRows) {
    if (r.fromUserId && !lastPullByEmp.has(r.fromUserId)) lastPullByEmp.set(r.fromUserId, r.createdAt);
  }
  const overdueByEmp = new Map(pending.employees.map((e) => [e.id, e.totalOverdue]));

  const rows: LeaderboardRow[] = emps.map((e) => {
    const followups = fuMap.get(e.id) ?? 0;
    const visitAppts = apptMap.get(e.id) ?? 0;
    const visitsDone = visitMap.get(e.id) ?? 0;
    const bookings = bookMap.get(e.id) ?? 0;
    const points = visitAppts * POINTS.visitAppt + visitsDone * POINTS.visitDone + bookings * POINTS.booking + followups * POINTS.followup;
    // السلسلة: متأخر الآن → صفر؛ وإلا أيام منذ آخر سحب منه (أو منذ انضمامه لو ما سُحب منه قط).
    const streakBase = (overdueByEmp.get(e.id) ?? 0) > 0
      ? null
      : lastPullByEmp.get(e.id) ?? e.createdAt;
    const streakDays = streakBase ? Math.min(Math.floor((now.getTime() - streakBase.getTime()) / DAY_MS), 365) : 0;
    return { id: e.id, name: e.name, rank: 0, points, visitAppts, visitsDone, bookings, followups, streakDays };
  });

  rows.sort((a, b) => b.points - a.points || b.bookings - a.bookings || a.name.localeCompare(b.name, "ar"));
  rows.forEach((r, i) => { r.rank = i + 1; });

  return { weekStart, weekEnd, isCurrentWeek: weekStartKSA(now).getTime() === weekStart.getTime(), rows };
}

export type MyRank = {
  rank: number;
  total: number;
  points: number;
  /** الفارق عن اللي قدّامه + اسمه («تحتاج ١٥ نقطة تعدّي أسماء») — null لو هو الأول. */
  gapToNext: { points: number; name: string } | null;
};

/** بطاقة الموظف المصغّرة: ترتيبه + نقاطه + الفارق عن اللي قدامه. */
export async function getMyRank(userId: string): Promise<MyRank | null> {
  const board = await getLeaderboard();
  const me = board.rows.find((r) => r.id === userId);
  if (!me) return null;
  const ahead = board.rows.find((r) => r.rank === me.rank - 1) ?? null;
  return {
    rank: me.rank,
    total: board.rows.length,
    points: me.points,
    gapToNext: ahead ? { points: ahead.points - me.points + 1, name: ahead.name } : null,
  };
}
