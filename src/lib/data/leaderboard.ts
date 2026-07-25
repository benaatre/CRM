import "server-only";

// لوحة الأسبوع — عمودان من القياس (عدالة لا حجمًا خامًا):
//   «النقاط» (الحجم المطلق بأوزان معدلة): متابعة ×١ بسقف ١٥/يوم (يمنع التضخم الكمي —
//   من استقبل ٢٤٤ متابعة لا يكتسح بالكم وحده) + موعد زيارة مؤكد ×٥ + زيارة تمّت ×١٠ + حجز ×٥٠.
//   «الكفاءة ٪» (الجودة المركّبة): التغطية + الالتزام بالمواعيد + سرعة الاستجابة + نظافة
//   «لم يتم الرد» — الترتيب الأساسي بها، ومن لم يُسند له عملاء = خارج الترتيب (لا صفر مخزٍ).
// كل النسب من مصادرها القائمة (FollowUp · Lead.assignedAt/firstContactAt · Reassignment) —
// استعلامات مجمّعة، لا N+1. الأسبوع ميلادي ينقلب الأحد 00:00 بتوقيت الرياض.
import { FollowUpResult } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getPendingPullByEmployee } from "@/lib/data/no-response";

export const POINTS = { visitAppt: 5, visitDone: 10, booking: 50, followup: 1 } as const;
/** سقف متابعات تُحتسب نقاطًا في اليوم الواحد — يمنع اكتساح الكم الخام. */
export const DAILY_FOLLOWUP_CAP = 15;

const KSA_OFFSET_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;

/** بداية الأسبوع (الأحد 00:00 بتوقيت الرياض) للتاريخ المرجعي. */
export function weekStartKSA(ref: Date): Date {
  const k = new Date(ref.getTime() + KSA_OFFSET_MS);
  const startUtcMs = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() - k.getUTCDay(), 0, 0, 0) - KSA_OFFSET_MS;
  return new Date(startUtcMs);
}

/** مكوّنات «الكفاءة» — تُعرض في التلميح (الشفافية تمنع الإحساس بالظلم). */
export type EfficiencyParts = {
  /** التغطية ٪: عملاء تواصل معهم هذا الأسبوع ÷ عملاؤه المسندون النشطون. */
  coverage: number;
  covered: number;
  assignedActive: number;
  /** الالتزام ٪: مواعيد أُنجزت في وقتها ÷ مواعيد الأسبوع المستحقة. */
  punctuality: number;
  dueCount: number;
  fulfilled: number;
  /** سرعة الاستجابة ٪ (متوسط ساعات أول تواصل — الأسرع أعلى) · null = ما استلم عملاء جدد. */
  speedScore: number | null;
  avgFirstResponseH: number | null;
  /** نظافة «لم يتم الرد» ٪: صفر متأخرين = ١٠٠. */
  overdueBonus: number;
  overdueCount: number;
};

export type LeaderboardRow = {
  id: string;
  name: string;
  rank: number;          // 0 = خارج الترتيب (بلا عملاء مسندين)
  ranked: boolean;
  efficiency: number;    // المؤشر المركّب — الترتيب الأساسي
  parts: EfficiencyParts;
  points: number;        // الحجم المطلق (بأوزان معدلة وسقف يومي)
  visitAppts: number;
  visitsDone: number;
  bookings: number;
  followups: number;     // الخام (للعرض) — النقاط تحتسب المسقوف
  cappedFollowups: number;
  prevPoints: number;    // الأسبوع السابق — لوسام «الأكثر تحسنًا»
  delta: number;
  streakDays: number;    // سلسلة الانضباط 🔥
};

export type Leaderboard = {
  weekStart: Date;
  weekEnd: Date;
  isCurrentWeek: boolean;
  rows: LeaderboardRow[];      // المرتَّبون (بالكفاءة)
  unranked: LeaderboardRow[];  // بلا عملاء مسندين — خارج الترتيب
  mostImprovedId: string | null;
};

const VISIT_DONE_RESULTS: FollowUpResult[] = [FollowUpResult.INTERESTED_VISITED, FollowUpResult.NOT_INTERESTED_VISITED];

type FuRow = { createdBy: string; createdAt: Date; result: FollowUpResult; leadId: string; nextDate: Date | null };

/** نقاط أسبوع من صفوف متابعاته + حجوزاته — المتابعات بسقف يومي (توقيت الرياض). */
function computePoints(fus: FuRow[], bookings: number) {
  const byDay = new Map<string, number>();
  let visitAppts = 0, visitsDone = 0;
  for (const f of fus) {
    const dayKey = new Date(f.createdAt.getTime() + KSA_OFFSET_MS).toISOString().slice(0, 10);
    byDay.set(dayKey, (byDay.get(dayKey) ?? 0) + 1);
    if (f.result === FollowUpResult.INTERESTED_VISIT_SCHEDULED) visitAppts++;
    if (VISIT_DONE_RESULTS.includes(f.result)) visitsDone++;
  }
  const cappedFollowups = [...byDay.values()].reduce((s, n) => s + Math.min(n, DAILY_FOLLOWUP_CAP), 0);
  const points = cappedFollowups * POINTS.followup + visitAppts * POINTS.visitAppt + visitsDone * POINTS.visitDone + bookings * POINTS.booking;
  return { points, cappedFollowups, visitAppts, visitsDone };
}

export async function getLeaderboard(ref: Date = new Date()): Promise<Leaderboard> {
  const weekStart = weekStartKSA(ref);
  const weekEnd = new Date(weekStart.getTime() + 7 * DAY_MS);
  const prevStart = new Date(weekStart.getTime() - 7 * DAY_MS);
  const now = new Date();
  const inWeek = { gte: weekStart, lt: weekEnd };

  const [emps, weekFus, prevFus, bookGrp, prevBookGrp, assignedActiveGrp, weekAssigned, pullRows, pending] = await Promise.all([
    prisma.user.findMany({
      where: { role: "EMPLOYEE", active: true },
      select: { id: true, name: true, createdAt: true },
      orderBy: { name: "asc" },
    }),
    prisma.followUp.findMany({ where: { createdAt: inWeek }, select: { createdBy: true, createdAt: true, result: true, leadId: true, nextDate: true } }),
    prisma.followUp.findMany({ where: { createdAt: { gte: prevStart, lt: weekStart } }, select: { createdBy: true, createdAt: true, result: true, leadId: true, nextDate: true } }),
    prisma.booking.groupBy({ by: ["sellerId"], where: { createdAt: inWeek }, _count: { _all: true } }),
    prisma.booking.groupBy({ by: ["sellerId"], where: { createdAt: { gte: prevStart, lt: weekStart } }, _count: { _all: true } }),
    // العملاء المسندون النشطون (مقام التغطية) — غير مؤرشفين وغير مقفولين.
    prisma.lead.groupBy({
      by: ["assignedToId"],
      where: { assignedToId: { not: null }, isArchived: false, stage: { notIn: ["CLOSED_WON", "CLOSED_LOST"] } },
      _count: { _all: true },
    }),
    // المستلمون هذا الأسبوع — لسرعة الاستجابة (أول تواصل منذ الإسناد).
    prisma.lead.findMany({
      where: { assignedAt: inWeek, assignedToId: { not: null } },
      select: { assignedToId: true, assignedAt: true, firstContactAt: true },
    }),
    // آخر سحب «لعدم الرد» لكل موظف — سلسلة الانضباط.
    prisma.reassignment.findMany({
      where: { toUserId: null, OR: [{ reason: { startsWith: "no_response" } }, { reason: "manual_pull" }] },
      orderBy: { createdAt: "desc" },
      select: { fromUserId: true, createdAt: true },
      take: 500,
    }),
    getPendingPullByEmployee(now),
  ]);

  // انتساب عملاء متابعات الأسبوع (بسط التغطية) — دفعة واحدة.
  const fuLeadIds = [...new Set(weekFus.map((f) => f.leadId))];
  const fuLeads = fuLeadIds.length
    ? await prisma.lead.findMany({ where: { id: { in: fuLeadIds } }, select: { id: true, assignedToId: true } })
    : [];
  const leadOwner = new Map(fuLeads.map((l) => [l.id, l.assignedToId]));

  const bookMap = new Map(bookGrp.map((g) => [g.sellerId, g._count._all]));
  const prevBookMap = new Map(prevBookGrp.map((g) => [g.sellerId, g._count._all]));
  const assignedActiveMap = new Map(assignedActiveGrp.map((g) => [g.assignedToId, g._count._all]));
  const overdueByEmp = new Map(pending.employees.map((e) => [e.id, e.totalOverdue]));
  const lastPullByEmp = new Map<string, Date>();
  for (const r of pullRows) if (r.fromUserId && !lastPullByEmp.has(r.fromUserId)) lastPullByEmp.set(r.fromUserId, r.createdAt);

  const fusByEmp = new Map<string, FuRow[]>();
  for (const f of weekFus) {
    const arr = fusByEmp.get(f.createdBy);
    if (arr) arr.push(f); else fusByEmp.set(f.createdBy, [f]);
  }
  const prevByEmp = new Map<string, FuRow[]>();
  for (const f of prevFus) {
    const arr = prevByEmp.get(f.createdBy);
    if (arr) arr.push(f); else prevByEmp.set(f.createdBy, [f]);
  }
  const weekAssignedByEmp = new Map<string, { assignedAt: Date; firstContactAt: Date | null }[]>();
  for (const l of weekAssigned) {
    const id = l.assignedToId as string;
    const arr = weekAssignedByEmp.get(id);
    const row = { assignedAt: l.assignedAt as Date, firstContactAt: l.firstContactAt };
    if (arr) arr.push(row); else weekAssignedByEmp.set(id, [row]);
  }

  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  const rows: LeaderboardRow[] = emps.map((e) => {
    const fus = fusByEmp.get(e.id) ?? [];
    const bookings = bookMap.get(e.id) ?? 0;
    const { points, cappedFollowups, visitAppts, visitsDone } = computePoints(fus, bookings);
    const prev = computePoints(prevByEmp.get(e.id) ?? [], prevBookMap.get(e.id) ?? 0);

    // ١) التغطية: عملاء (مسندون له) تواصل معهم هذا الأسبوع ÷ عملاؤه النشطون.
    const assignedActive = assignedActiveMap.get(e.id) ?? 0;
    const covered = new Set(fus.filter((f) => leadOwner.get(f.leadId) === e.id).map((f) => f.leadId)).size;
    const coverage = assignedActive > 0 ? clamp((covered / assignedActive) * 100) : 0;

    // ٢) الالتزام: مواعيد جدولها واستحقت هذا الأسبوع، وأنجز متابعةً حولها (±ساعة → +٢٤س).
    const dueList = fus.filter((f) => f.nextDate && f.nextDate >= weekStart && f.nextDate <= now && f.nextDate < weekEnd);
    const byLead = new Map<string, Date[]>();
    for (const f of fus) {
      const arr = byLead.get(f.leadId);
      if (arr) arr.push(f.createdAt); else byLead.set(f.leadId, [f.createdAt]);
    }
    const fulfilled = dueList.filter((d) => {
      const due = (d.nextDate as Date).getTime();
      return (byLead.get(d.leadId) ?? []).some((c) => c.getTime() >= due - HOUR(1) && c.getTime() <= due + HOUR(24));
    }).length;
    const dueCount = dueList.length;
    const punctuality = dueCount > 0 ? clamp((fulfilled / dueCount) * 100) : 100; // بلا مواعيد مستحقة = بلا إخلال

    // ٣) سرعة الاستجابة: متوسط ساعات أول تواصل للمستلَمين هذا الأسبوع (≤١س=١٠٠ · ٢٤س+=٠).
    const newLeads = weekAssignedByEmp.get(e.id) ?? [];
    const responded = newLeads.filter((l) => l.firstContactAt && l.firstContactAt >= l.assignedAt);
    let speedScore: number | null = null;
    let avgFirstResponseH: number | null = null;
    if (newLeads.length > 0) {
      if (responded.length === 0) speedScore = 0; // استلم وما تواصل مع أحد بعد
      else {
        const avgMs = responded.reduce((s, l) => s + ((l.firstContactAt as Date).getTime() - l.assignedAt.getTime()), 0) / responded.length;
        avgFirstResponseH = Math.round((avgMs / HOUR(1)) * 10) / 10;
        speedScore = clamp(100 - ((avgMs / HOUR(1) - 1) * (100 / 23)));
        // من لم يتواصل معهم بعد يسحبون النسبة نزولًا (وزن المتجاهَلين).
        speedScore = clamp(speedScore * (responded.length / newLeads.length));
      }
    }

    // ٤) نظافة «لم يتم الرد»: صفر متأخرين = ١٠٠، وكل متأخر −٢٥.
    const overdueCount = overdueByEmp.get(e.id) ?? 0;
    const overdueBonus = clamp(100 - overdueCount * 25);

    // المؤشر المركّب — أوزان: التغطية ٠٫٣٥ · الالتزام ٠٫٢٥ · السرعة ٠٫٢٥ · النظافة ٠٫١٥.
    // سرعة غير متاحة (ما استلم جددًا) → توزَّع أوزانها على البقية.
    const comps: [number, number][] = speedScore == null
      ? [[coverage, 0.47], [punctuality, 0.33], [overdueBonus, 0.2]]
      : [[coverage, 0.35], [punctuality, 0.25], [speedScore, 0.25], [overdueBonus, 0.15]];
    const efficiency = Math.round(comps.reduce((s, [v, w]) => s + v * w, 0));

    // سلسلة الانضباط 🔥: متأخر الآن → صفر؛ وإلا أيام منذ آخر سحب منه (أو منذ انضمامه).
    const streakBase = overdueCount > 0 ? null : (lastPullByEmp.get(e.id) ?? e.createdAt);
    const streakDays = streakBase ? Math.min(Math.floor((now.getTime() - streakBase.getTime()) / DAY_MS), 365) : 0;

    const ranked = assignedActive > 0 || newLeads.length > 0;
    return {
      id: e.id, name: e.name, rank: 0, ranked,
      efficiency,
      parts: { coverage: Math.round(coverage), covered, assignedActive, punctuality: Math.round(punctuality), dueCount, fulfilled, speedScore: speedScore == null ? null : Math.round(speedScore), avgFirstResponseH, overdueBonus: Math.round(overdueBonus), overdueCount },
      points, cappedFollowups, visitAppts, visitsDone, bookings,
      followups: fus.length,
      prevPoints: prev.points, delta: points - prev.points,
      streakDays,
    };
  });

  const ranked = rows.filter((r) => r.ranked).sort((a, b) => b.efficiency - a.efficiency || b.points - a.points || a.name.localeCompare(b.name, "ar"));
  ranked.forEach((r, i) => { r.rank = i + 1; });
  const unranked = rows.filter((r) => !r.ranked);
  const best = ranked.filter((r) => r.delta > 0).sort((a, b) => b.delta - a.delta)[0] ?? null;

  return { weekStart, weekEnd, isCurrentWeek: weekStartKSA(now).getTime() === weekStart.getTime(), rows: ranked, unranked, mostImprovedId: best?.id ?? null };
}

function HOUR(n: number): number { return n * 3_600_000; }

export type MyRank = {
  rank: number;
  total: number;
  points: number;
  efficiency: number;
  /** الفارق عن اللي قدامه بالكفاءة («ترفع كفاءتك N٪ تعدّي فلان») — null = الأول أو خارج الترتيب. */
  gapToNext: { pct: number; name: string } | null;
  ranked: boolean;
};

/** بطاقة الموظف المصغّرة: ترتيبه بالكفاءة + نقاطه + الفارق عن اللي قدامه. */
export async function getMyRank(userId: string): Promise<MyRank | null> {
  const board = await getLeaderboard();
  const me = board.rows.find((r) => r.id === userId) ?? board.unranked.find((r) => r.id === userId);
  if (!me) return null;
  const ahead = me.ranked ? board.rows.find((r) => r.rank === me.rank - 1) ?? null : null;
  return {
    rank: me.rank,
    total: board.rows.length,
    points: me.points,
    efficiency: me.efficiency,
    gapToNext: ahead ? { pct: Math.max(1, ahead.efficiency - me.efficiency + 1), name: ahead.name } : null,
    ranked: me.ranked,
  };
}
