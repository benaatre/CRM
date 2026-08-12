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
import { KEEP_STAGE_RESULTS, VISIT_APPOINTMENT_RESULTS } from "@/lib/labels";
import { DAY_MS, ksaDayKey, weekStartKSA } from "@/lib/ksa-time";

// نافذة الأسبوع من المصدر الموحّد (lib/ksa-time) — لا تعريف محلي، فلا تنحرف شاشة عن أخرى.
export { weekStartKSA };

/**
 * أوزان «الإنجاز» — أرقام مطلقة من شغله الفعلي (الاجتهاد يحكم، والنسب مكمّل فقط):
 * درجة الموظف = الإنجاز × معامل الجودة (٠٫٨ – ١٫٢). صفر إنجاز = صفر درجة نهائيًا —
 * من لم يعمل لا يسبق من عمل مهما كانت نسبه.
 */
export const WEIGHTS = {
  contacted: 2,   // عميل تواصل معه (متابعة/اتصال مسجّل — بالعميل الفريد)
  followup: 1,    // متابعة مسجّلة (بسقف يومي)
  interested: 5,  // عميل نقله لمهتم
  visitAppt: 5,   // موعد زيارة أكّده
  visitDone: 10,  // زيارة تمّت
  booking: 50,    // حجز
  win: 80,        // بيع (CLOSED_WON)
} as const;
/** سقف متابعات تُحتسب في اليوم الواحد — يمنع اكتساح الكم الخام. */
export const DAILY_FOLLOWUP_CAP = 15;

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
  /** الدرجة النهائية = الإنجاز × معامل الجودة — الترتيب بها. صفر إنجاز = صفر نهائيًا. */
  score: number;
  achievement: number;   // الإنجاز المطلق (الحاكم)
  qualityPct: number;    // الجودة المركّبة ٠–١٠٠ (المكمّل)
  qualityFactor: number; // معامل الضرب ٠٫٨–١٫٢
  parts: EfficiencyParts;
  contacted: number;     // 📞 عملاء تواصل معهم
  interested: number;    // 💚 نقلهم لمهتم
  visitAppts: number;
  visitsDone: number;    // 🏠 زيارات تمّت
  bookings: number;      // 📋 حجوزات
  wins: number;          // 💰 مبيعات
  followups: number;     // الخام (للعرض)
  cappedFollowups: number;
  delta: number;         // فرق الإنجاز عن الأسبوع السابق — لوسام «الأكثر تحسنًا»
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

export type FuRow = {
  createdBy: string;
  createdAt: Date;
  result: FollowUpResult;
  leadId: string;
  nextDate: Date | null;
  stageAfter: string | null; // التحوّلات (مهتم/بيع) — من عمود stageAfter القائم
};

export type Achievement = {
  achievement: number;     // مجموع الإنجاز المطلق
  contacted: number;       // عملاء تواصل معهم (فريدون)
  cappedFollowups: number; // متابعات بعد السقف اليومي
  interested: number;      // عملاء نقلهم لمهتم (فريدون)
  visitAppts: number;      // مواعيد زيارة أكّدها
  visitsDone: number;      // زيارات تمّت
  bookings: number;
  wins: number;            // مبيعات CLOSED_WON (فريدون)
};

/**
 * «الإنجاز» — أرقام مطلقة من صفوف متابعاته + حجوزاته، المتابعات بسقف يومي (الرياض).
 * الدالة الوحيدة المعتمدة (تستهلكها اللوحة وصفحة «سجلّي» — لا حساب موازٍ).
 */
export function computeAchievement(fus: FuRow[], bookings: number): Achievement {
  const byDay = new Map<string, number>();
  const contactedSet = new Set<string>();
  const interestedSet = new Set<string>();
  const winsSet = new Set<string>();
  let visitAppts = 0, visitsDone = 0;
  for (const f of fus) {
    const dayKey = ksaDayKey(f.createdAt); // سقف المتابعات يومي بتوقيت الرياض
    byDay.set(dayKey, (byDay.get(dayKey) ?? 0) + 1);
    contactedSet.add(f.leadId);
    // «نقله لمهتم» = انتقال فعلي، لا مجرد عمود stageAfter=INTERESTED.
    // نتائج «بلا تغيير مرحلة» (لم يستجب · حسبة البنك · في الانتظار) يكتب لها المسار
    // مرحلة العميل كما هي؛ فلو كان مهتمًا أصلًا صارت متابعة معناها «ما استجاب» تكسب
    // خمس نقاط «تحويل». هذا ما رفع موظفة فوق أخرى أعلى منها في كل مؤشر شغل خام
    // (تحقيق ٢٥ يوليو ٢٠٢٦ — docs/investigations/week-score-2026-07-25.md).
    if (f.stageAfter === "INTERESTED" && !KEEP_STAGE_RESULTS.includes(f.result)) interestedSet.add(f.leadId);
    if (f.stageAfter === "CLOSED_WON") winsSet.add(f.leadId);
    // «الزيارة زيارة»: موعد الزيارة الجديد وإعادة الجدولة القديمة يعدّان معًا —
    // رقم واحد يطابق «سجلّي» وبقية الشاشات.
    if (VISIT_APPOINTMENT_RESULTS.includes(f.result)) visitAppts++;
    if (VISIT_DONE_RESULTS.includes(f.result)) visitsDone++;
  }
  const cappedFollowups = [...byDay.values()].reduce((s, n) => s + Math.min(n, DAILY_FOLLOWUP_CAP), 0);
  const contacted = contactedSet.size, interested = interestedSet.size, wins = winsSet.size;
  const achievement =
    contacted * WEIGHTS.contacted +
    cappedFollowups * WEIGHTS.followup +
    interested * WEIGHTS.interested +
    visitAppts * WEIGHTS.visitAppt +
    visitsDone * WEIGHTS.visitDone +
    bookings * WEIGHTS.booking +
    wins * WEIGHTS.win;
  return { achievement, contacted, cappedFollowups, interested, visitAppts, visitsDone, bookings, wins };
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
    prisma.followUp.findMany({ where: { createdAt: inWeek }, select: { createdBy: true, createdAt: true, result: true, leadId: true, nextDate: true, stageAfter: true } }),
    prisma.followUp.findMany({ where: { createdAt: { gte: prevStart, lt: weekStart } }, select: { createdBy: true, createdAt: true, result: true, leadId: true, nextDate: true, stageAfter: true } }),
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
    const ach = computeAchievement(fus, bookings);
    const prev = computeAchievement(prevByEmp.get(e.id) ?? [], prevBookMap.get(e.id) ?? 0);

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

    // «الجودة» المركّبة (المكمّل لا الحاكم) — أوزان: التغطية ٠٫٣٥ · الالتزام ٠٫٢٥ ·
    // السرعة ٠٫٢٥ · النظافة ٠٫١٥. سرعة غير متاحة (ما استلم جددًا) → توزَّع على البقية.
    const comps: [number, number][] = speedScore == null
      ? [[coverage, 0.47], [punctuality, 0.33], [overdueBonus, 0.2]]
      : [[coverage, 0.35], [punctuality, 0.25], [speedScore, 0.25], [overdueBonus, 0.15]];
    const qualityPct = Math.round(comps.reduce((s, [v, w]) => s + v * w, 0));
    // معامل الجودة ٠٫٨–١٫٢: ممتازة ترفع حتى +٢٠٪ ورديئة تخصم حتى −٢٠٪ — لا تقلب
    // الترتيب لصالح من لم يعمل: صفر إنجاز = صفر درجة نهائيًا مهما كانت النسب.
    const qualityFactor = Math.round((0.8 + (qualityPct / 100) * 0.4) * 100) / 100;
    const score = ach.achievement === 0 ? 0 : Math.round(ach.achievement * qualityFactor);

    // سلسلة الانضباط 🔥: متأخر الآن → صفر؛ وإلا أيام منذ آخر سحب منه (أو منذ انضمامه).
    const streakBase = overdueCount > 0 ? null : (lastPullByEmp.get(e.id) ?? e.createdAt);
    const streakDays = streakBase ? Math.min(Math.floor((now.getTime() - streakBase.getTime()) / DAY_MS), 365) : 0;

    const ranked = assignedActive > 0 || newLeads.length > 0;
    return {
      id: e.id, name: e.name, rank: 0, ranked,
      score, achievement: ach.achievement, qualityPct, qualityFactor,
      parts: { coverage: Math.round(coverage), covered, assignedActive, punctuality: Math.round(punctuality), dueCount, fulfilled, speedScore: speedScore == null ? null : Math.round(speedScore), avgFirstResponseH, overdueBonus: Math.round(overdueBonus), overdueCount },
      contacted: ach.contacted, interested: ach.interested,
      visitAppts: ach.visitAppts, visitsDone: ach.visitsDone, bookings, wins: ach.wins,
      cappedFollowups: ach.cappedFollowups,
      followups: fus.length,
      delta: ach.achievement - prev.achievement,
      streakDays,
    };
  });

  // الترتيب بالدرجة (الاجتهاد الفعلي يحكم) — التعادل بالإنجاز الخام ثم الاسم.
  const ranked = rows.filter((r) => r.ranked).sort((a, b) => b.score - a.score || b.achievement - a.achievement || a.name.localeCompare(b.name, "ar"));
  ranked.forEach((r, i) => { r.rank = i + 1; });
  const unranked = rows.filter((r) => !r.ranked);
  const best = ranked.filter((r) => r.delta > 0).sort((a, b) => b.delta - a.delta)[0] ?? null;

  return { weekStart, weekEnd, isCurrentWeek: weekStartKSA(now).getTime() === weekStart.getTime(), rows: ranked, unranked, mostImprovedId: best?.id ?? null };
}

function HOUR(n: number): number { return n * 3_600_000; }

// ===================== طبقة الخصوصية (تحويل قبل مغادرة الخادم) =====================

/**
 * صف اللوحة **كما يراه المشاهد** — النوع نفسه لا يعرّف الأرقام الخام لغير المستحق،
 * فهي لا تُسلسَل في حمولة RSC أصلًا ولا تصل متصفحه بأي حال.
 *
 * القاعدة: المالك/المدير يرى كل شيء خامًا · الموظف يرى **أرقامه هو** خامًا فقط،
 * وزملاؤه نِسبًا محسوبة على الخادم. الدرجة والمعامل والترتيب والحجوزات والمبيعات
 * تبقى للجميع — هي جوهر اللوحة وغرضها المعلن.
 */
export type BoardViewRow = {
  id: string;
  name: string;
  rank: number;
  ranked: boolean;
  score: number;
  qualityFactor: number;
  bookings: number;
  wins: number;
  streakDays: number;
  delta: number;
  /** صف المشاهد نفسه — يفتح عرض أرقامه الخام. */
  isSelf: boolean;
  /** الأرقام الخام — موجودة فقط للمالك/المدير أو لصف الموظف نفسه. */
  raw?: {
    achievement: number;
    qualityPct: number;
    contacted: number;
    interested: number;
    visitAppts: number;
    visitsDone: number;
    followups: number;
    cappedFollowups: number;
    parts: EfficiencyParts;
  };
  /** النِسب — بديل الأرقام الخام لصفوف الزملاء عند الموظف. */
  share?: {
    /** نسبة تواصله من إجمالي تواصل الفريق هذا الأسبوع (٠–١٠٠). */
    contactShare: number;
    /** نسبة مهتميه من إجمالي مهتمي الفريق (٠–١٠٠). */
    interestedShare: number;
  };
};

export type BoardView = {
  weekStart: Date;
  weekEnd: Date;
  isCurrentWeek: boolean;
  rows: BoardViewRow[];
  unranked: { id: string; name: string }[];
  mostImprovedId: string | null;
  /** المشاهد مدير/مالك — لعرض التفاصيل الكاملة. */
  managerView: boolean;
  /** صاحب أعلى معامل جودة بالفريق (سطر سياق «أعلى جودة بالفريق»). */
  topQualityId: string | null;
};

const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

/**
 * يحوّل حمولة اللوحة الكاملة إلى ما يحقّ للمشاهد رؤيته — **قبل أي إرسال للعميل**.
 * الأرقام الخام لغير المستحق لا تُنسخ إلى الناتج إطلاقًا (لا إخفاء بالواجهة).
 */
export function toBoardView(board: Leaderboard, viewerId: string, manager: boolean): BoardView {
  // إجمالي الفريق للنِسب — من الصفوف المرتَّبة وغير المرتَّبة معًا (كل نشاط الأسبوع).
  const all = [...board.rows, ...board.unranked];
  const totalContacted = all.reduce((s, r) => s + r.contacted, 0);
  const totalInterested = all.reduce((s, r) => s + r.interested, 0);
  const topQuality = [...board.rows].sort((a, b) => b.qualityFactor - a.qualityFactor)[0] ?? null;

  const toRow = (r: LeaderboardRow): BoardViewRow => {
    const isSelf = r.id === viewerId;
    const base: BoardViewRow = {
      id: r.id, name: r.name, rank: r.rank, ranked: r.ranked,
      score: r.score, qualityFactor: r.qualityFactor,
      bookings: r.bookings, wins: r.wins, streakDays: r.streakDays, delta: r.delta,
      isSelf,
    };
    // المستحق للأرقام الخام: المدير/المالك دائمًا، والموظف على صفه وحده.
    if (manager || isSelf) {
      base.raw = {
        achievement: r.achievement, qualityPct: r.qualityPct,
        contacted: r.contacted, interested: r.interested,
        visitAppts: r.visitAppts, visitsDone: r.visitsDone,
        followups: r.followups, cappedFollowups: r.cappedFollowups,
        parts: r.parts,
      };
      return base;
    }
    // غير المستحق: نِسب فقط — ولا حقل خام واحد في الناتج.
    base.share = {
      contactShare: pct(r.contacted, totalContacted),
      interestedShare: pct(r.interested, totalInterested),
    };
    return base;
  };

  return {
    weekStart: board.weekStart,
    weekEnd: board.weekEnd,
    isCurrentWeek: board.isCurrentWeek,
    rows: board.rows.map(toRow),
    // خارج الترتيب: أسماء بلا أي رقم للجميع (كما بالمرجع).
    unranked: board.unranked.map((r) => ({ id: r.id, name: r.name })),
    mostImprovedId: board.mostImprovedId,
    managerView: manager,
    topQualityId: topQuality?.id ?? null,
  };
}

export type MyRank = {
  rank: number;
  total: number;
  score: number;
  achievement: number;
  /** الفارق عن اللي قدامه بالدرجة («تحتاج N درجة تعدّي فلان») — null = الأول أو خارج الترتيب. */
  gapToNext: { pts: number; name: string } | null;
  ranked: boolean;
};

/** بطاقة الموظف المصغّرة: ترتيبه بالدرجة + الفارق عن اللي قدامه. */
export async function getMyRank(userId: string): Promise<MyRank | null> {
  const board = await getLeaderboard();
  const me = board.rows.find((r) => r.id === userId) ?? board.unranked.find((r) => r.id === userId);
  if (!me) return null;
  const ahead = me.ranked ? board.rows.find((r) => r.rank === me.rank - 1) ?? null : null;
  return {
    rank: me.rank,
    total: board.rows.length,
    score: me.score,
    achievement: me.achievement,
    gapToNext: ahead ? { pts: Math.max(1, ahead.score - me.score + 1), name: ahead.name } : null,
    ranked: me.ranked,
  };
}
