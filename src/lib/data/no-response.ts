import "server-only";

import type { Prisma, LeadStage, Channel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { NO_RESPONSE_STAGES } from "@/lib/auto-distribute";
import {
  getNoResponseConfig, noResponseBaseline, noResponseState, escalationCategory,
  CATEGORY_ORDER, warnMessage, noAnswerStats, type EscalationCategory, type NoAnswerStats,
} from "@/lib/no-response-escalation";

// سقف إعادة التوجيه — بعده يُعتبر العميل «مستنفدًا» (يُعطَّل زر التوزيع). موحّد مع auto-distribute.
export const MAX_REASSIGNS = 3;

// شرط الحوض — مصدر واحد لتعريفه (تُشاركه القائمة والعدّاد والشارة).
const QUEUE_WHERE: Prisma.LeadWhereInput = {
  assignedToId: null,
  reassignCount: { gt: 0 },
  isArchived: false,
  stage: { in: [...NO_RESPONSE_STAGES] },
};

/** عدّاد حوض «لم يتم الرد» — لشارة التنقّل (خفيف، بلا جلب صفوف). */
export async function getNoResponseCount(): Promise<number> {
  return prisma.lead.count({ where: QUEUE_WHERE });
}

export type EmployeeLoad = {
  id: string;
  name: string;
  count: number; // عملاؤه الحاليون (غير مؤرشفين)
  maxClients: number | null;
  remaining: number | null; // المتبقّي له (null = بلا حد)
};

/** الموظفون النشطون المتاحون للاستقبال + حملهم الحالي وسعتهم — لنافذة اختيار المشاركين. */
export async function getActiveEmployeeLoads(now: Date = new Date()): Promise<EmployeeLoad[]> {
  const emps = await prisma.user.findMany({
    where: {
      role: "EMPLOYEE", active: true,
      OR: [{ availabilityPaused: false }, { availabilityPaused: true, pauseUntil: { not: null, lte: now } }],
    },
    select: { id: true, name: true, maxClients: true, _count: { select: { assignedLeads: { where: { isArchived: false } } } } },
    orderBy: { name: "asc" },
  });
  return emps.map((e) => ({
    id: e.id, name: e.name, count: e._count.assignedLeads, maxClients: e.maxClients,
    remaining: e.maxClients == null ? null : Math.max(0, e.maxClients - e._count.assignedLeads),
  }));
}

// ===================== لوحة «بانتظار السحب» (رأس الصفحة) =====================

// خانة لكل فئة تصعيد: إجمالي العملاء + كم بانتظار الإنذار + كم يُسحب الآن.
export type CategoryStat = { total: number; pending: number; overdue: number };

export type PendingPullEmployee = {
  id: string;
  name: string;
  byCategory: Record<EscalationCategory, CategoryStat>;
  overdueVery: number;  // يُسحب الآن ومتأخّر جدًا (+٥ أيام بلا متابعة)
  overdueLate: number;  // يُسحب الآن ومتأخّر (٣–٥ أيام بلا متابعة)
  totalPending: number; // مجموع بانتظار الإنذار عبر الفئات
  totalOverdue: number; // مجموع يُسحب الآن عبر الفئات
};

// عتبات أيام «يُسحب الآن» (مطلقة، مستقلة عن الفئة).
export const OVERDUE_VERY_DAYS = 5;
export const OVERDUE_LATE_DAYS = 3;

export type PendingPullSummary = {
  employees: PendingPullEmployee[];
  totalPending: number;
  totalOverdue: number;
  inQueue: number; // إجمالي في الحوض (انسحبوا فعلًا)
  capped: number; // بلغوا سقف الدورات
  live: boolean; // حالة النظام: مفعّل (سحب حقيقي) أم معاينة (dry-run)
};

function emptyByCategory(): Record<EscalationCategory, CategoryStat> {
  return Object.fromEntries(CATEGORY_ORDER.map((c) => [c, { total: 0, pending: 0, overdue: 0 }])) as Record<EscalationCategory, CategoryStat>;
}

/** إحصاء «لم يرد» لكل عميل من متابعاته (نتيجة + وقت) — مصدر واحد يشاركه كل تجميع لم يتم الرد. */
async function noAnswerStatsByLead(leadIds: string[]): Promise<Map<string, NoAnswerStats>> {
  const out = new Map<string, NoAnswerStats>();
  if (leadIds.length === 0) return out;
  const fus = await prisma.followUp.findMany({ where: { leadId: { in: leadIds } }, select: { leadId: true, result: true, createdAt: true } });
  const byLead = new Map<string, { result: string; createdAt: Date }[]>();
  for (const f of fus) {
    const arr = byLead.get(f.leadId);
    if (arr) arr.push({ result: f.result, createdAt: f.createdAt });
    else byLead.set(f.leadId, [{ result: f.result, createdAt: f.createdAt }]);
  }
  for (const [leadId, arr] of byLead) out.set(leadId, noAnswerStats(arr));
  return out;
}

/**
 * تجميع العملاء المتأخرين لكل موظف حسب فئة التصعيد (عدد المتابعات) — مصدر لوحة الأرقام.
 * يطابق محرّك السحب حرفيًا: نفس المرشّحين + نفس منطق التصعيد (noResponseState) + نفس الحصانات
 * (manualAssignedAt · sweepCutoffAt · سقف الدورات). كل فئة: إجمالي/بانتظار الإنذار/يُسحب الآن.
 */
export async function getPendingPullByEmployee(now: Date = new Date()): Promise<PendingPullSummary> {
  const config = getNoResponseConfig();

  // بلا حاجز sweepCutoffAt — مستقلّ؛ الحاجز الاختياري ACTIVATION يُدمج في الـbaseline (يطابق المحرّك).
  const leads = await prisma.lead.findMany({
    where: {
      assignedToId: { not: null },
      isArchived: false,
      stage: { in: [...NO_RESPONSE_STAGES] },
      reassignCount: { lt: MAX_REASSIGNS },
      assignedTo: { role: "EMPLOYEE" },
      manualAssignedAt: null,
    },
    select: { id: true, assignedToId: true, assignedAt: true, assignedTo: { select: { name: true } } },
  });

  // إحصاء «لم يرد» لكل عميل (العدّاد المعتمد + المرجع الزمني + الاستبعاد).
  const statsByLead = await noAnswerStatsByLead(leads.map((l) => l.id));

  const byEmp = new Map<string, PendingPullEmployee>();
  let totalPending = 0;
  let totalOverdue = 0;
  for (const l of leads) {
    const stats = statsByLead.get(l.id) ?? { included: true, noAnswerCount: 0, lastNoAnswerAt: null, lastResult: null };
    if (!stats.included) continue; // رد العميل (آخر متابعة ليست «لم يرد») → خارج النظام
    const fu = stats.noAnswerCount;
    const baseline = noResponseBaseline(l.assignedAt, stats.lastNoAnswerAt, config.activationDate);
    const { state, daysSince } = noResponseState(fu, baseline, now, config);
    const cat = escalationCategory(fu, config);
    const id = l.assignedToId as string;
    const row = byEmp.get(id) ?? { id, name: l.assignedTo?.name ?? "—", byCategory: emptyByCategory(), overdueVery: 0, overdueLate: 0, totalPending: 0, totalOverdue: 0 };
    row.byCategory[cat].total++;
    if (state === "overdue") {
      row.byCategory[cat].overdue++; row.totalOverdue++; totalOverdue++;
      if (daysSince >= OVERDUE_VERY_DAYS) row.overdueVery++; else row.overdueLate++;
    } else if (state === "pending") {
      row.byCategory[cat].pending++; row.totalPending++; totalPending++;
    }
    byEmp.set(id, row);
  }

  const [inQueue, capped] = await Promise.all([
    prisma.lead.count({ where: QUEUE_WHERE }),
    prisma.lead.count({
      where: { isArchived: false, stage: { in: [...NO_RESPONSE_STAGES] }, reassignCount: { gte: MAX_REASSIGNS } },
    }),
  ]);

  const employees = [...byEmp.values()].sort((a, b) => (b.totalOverdue * 1000 + b.totalPending) - (a.totalOverdue * 1000 + a.totalPending));
  return { employees, totalPending, totalOverdue, inQueue, capped, live: config.enabled };
}

// ===================== المرشّحون للسحب (معاينة per-lead) =====================

export type PullbackClass = "pending" | "overdue";

export type PullbackPreviewRow = {
  id: string;
  name: string;
  phone: string;
  employeeId: string | null;
  employee: string | null;   // الموظف الحالي (المرشّح للسحب منه)
  followUpCount: number;
  daysLate: number;          // أيام منذ آخر متابعة (أو الإسناد لو صفر)
  timeoutDays: number;       // مهلة فئته بالأيام
  category: EscalationCategory;
  klass: PullbackClass;      // بانتظار الإنذار | يُسحب الآن
};

/**
 * المرشّحون فعليًا للسحب (pending/overdue فقط) — نفس منطق runNoResponsePullback حرفيًا:
 * نفس المرشّحين + noResponseState (نموذج المتابعات) + الحصانات (manualAssignedAt · سقف الدورات · ٥+).
 * لكل عميل: متأخر منذ (daysLate) · المهلة (timeoutDays) · الفئة · الحالة. المحصّنون مستثنون من القائمة.
 */
export async function getPullbackPreview(filters: NoResponseFilters = {}, now: Date = new Date()): Promise<PullbackPreviewRow[]> {
  const config = getNoResponseConfig();
  const q = filters.q?.trim();

  const leads = await prisma.lead.findMany({
    where: {
      assignedToId: { not: null },
      isArchived: false,
      stage: { in: [...NO_RESPONSE_STAGES] },
      reassignCount: { lt: MAX_REASSIGNS },
      assignedTo: { role: "EMPLOYEE" },
      manualAssignedAt: null,
      ...(q ? { OR: [{ name: { contains: q } }, { phone: { contains: q } }] } : {}),
    },
    select: { id: true, name: true, phone: true, assignedToId: true, assignedAt: true, assignedTo: { select: { name: true } } },
    take: 2000,
  });

  const statsByLead = await noAnswerStatsByLead(leads.map((l) => l.id));

  let rows: PullbackPreviewRow[] = [];
  for (const l of leads) {
    const stats = statsByLead.get(l.id) ?? { included: true, noAnswerCount: 0, lastNoAnswerAt: null, lastResult: null };
    if (!stats.included) continue; // رد العميل → خارج النظام
    const fu = stats.noAnswerCount;
    const baseline = noResponseBaseline(l.assignedAt, stats.lastNoAnswerAt, config.activationDate);
    const { state, daysSince, tier } = noResponseState(fu, baseline, now, config);
    if (state !== "pending" && state !== "overdue") continue; // فقط المرشّحون
    rows.push({
      id: l.id, name: l.name, phone: l.phone,
      employeeId: l.assignedToId, employee: l.assignedTo?.name ?? null,
      followUpCount: fu, daysLate: Math.floor(daysSince), timeoutDays: tier.warnDays,
      category: escalationCategory(fu, config), klass: state,
    });
  }

  if (filters.prevEmp) rows = rows.filter((r) => r.employeeId === filters.prevEmp);
  // ترتيب: «يُسحب الآن» أولًا، ثم الأكثر تأخّرًا.
  rows.sort((a, b) => (a.klass !== b.klass ? (a.klass === "overdue" ? -1 : 1) : b.daysLate - a.daysLate));
  return rows;
}

// ===================== جدول الحوض (العملاء المسحوبون) =====================

export type NoResponseRow = {
  id: string;
  name: string;
  phone: string;
  lastEmployeeId: string | null;
  lastEmployee: string | null; // آخر موظف سُحب منه (من آخر Reassignment)
  pullDate: Date | null; // تاريخ السحب (createdAt لآخر Reassignment)
  lastContact: Date | null;
  reassignCount: number;
  followUpCount: number; // عدد المتابعات (لعمود التوزيع المتقدّم)
  stage: LeadStage;
  channel: Channel;
  exhausted: boolean; // بلغ السقف → معطّل
};

export type NoResponseSort = "recent" | "oldest" | "rounds";

export type NoResponseFilters = {
  q?: string;
  prevEmp?: string; // معرّف الموظف السابق
  rounds?: 1 | 2 | 3; // ٣ = ٣ فأكثر
  sort?: NoResponseSort;
};

/**
 * حوض «لم يتم الرد»: عملاء انسحبوا من موظف (assignedToId=null) بسبب عدم الرد
 * (reassignCount>0) وما زالوا في مراحل عدم الرد وغير مؤرشفين — للمالك فقط.
 * «آخر موظف» وتاريخ السحب يُشتقّان من آخر Reassignment بلا حقل جديد.
 * البحث/الفلاتر/الترتيب يُطبَّق بعد الاشتقاق (الحوض محدود الحجم).
 */
export async function getNoResponseLeads(filters: NoResponseFilters = {}): Promise<NoResponseRow[]> {
  const q = filters.q?.trim();
  const leads = await prisma.lead.findMany({
    where: {
      ...QUEUE_WHERE,
      ...(q ? { OR: [{ name: { contains: q } }, { phone: { contains: q } }] } : {}),
    },
    select: {
      id: true, name: true, phone: true, lastContact: true, reassignCount: true, stage: true, channel: true,
      reassignments: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { fromUserId: true, createdAt: true },
      },
    },
    take: 500,
  });

  // حلّ أسماء آخر موظف + عدد المتابعات بدفعة واحدة (بلا N+1).
  const fromIds = [...new Set(leads.map((l) => l.reassignments[0]?.fromUserId).filter((x): x is string => !!x))];
  const leadIds = leads.map((l) => l.id);
  const [users, fuGrouped] = await Promise.all([
    fromIds.length ? prisma.user.findMany({ where: { id: { in: fromIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    leadIds.length ? prisma.followUp.groupBy({ by: ["leadId"], where: { leadId: { in: leadIds } }, _count: { _all: true } }) : Promise.resolve([]),
  ]);
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  const fuById = new Map(fuGrouped.map((g) => [g.leadId, g._count._all]));

  let rows: NoResponseRow[] = leads.map((l) => {
    const last = l.reassignments[0];
    return {
      id: l.id,
      name: l.name,
      phone: l.phone,
      lastEmployeeId: last?.fromUserId ?? null,
      lastEmployee: last?.fromUserId ? (nameById.get(last.fromUserId) ?? null) : null,
      pullDate: last?.createdAt ?? null,
      lastContact: l.lastContact,
      reassignCount: l.reassignCount,
      followUpCount: fuById.get(l.id) ?? 0,
      stage: l.stage,
      channel: l.channel,
      exhausted: l.reassignCount >= MAX_REASSIGNS,
    };
  });

  // فلتر الموظف السابق (يعتمد على آخر Reassignment — لذلك بعد الاشتقاق).
  if (filters.prevEmp) rows = rows.filter((r) => r.lastEmployeeId === filters.prevEmp);
  // فلتر عدد الدورات: ١ / ٢ / ٣ فأكثر.
  if (filters.rounds) rows = rows.filter((r) => filters.rounds === 3 ? r.reassignCount >= 3 : r.reassignCount === filters.rounds);

  const sort = filters.sort ?? "recent";
  const t = (d: Date | null) => d?.getTime() ?? 0;
  rows.sort((a, b) => {
    if (sort === "rounds") return b.reassignCount - a.reassignCount || t(b.pullDate) - t(a.pullDate);
    if (sort === "oldest") return t(a.pullDate) - t(b.pullDate);
    return t(b.pullDate) - t(a.pullDate); // recent
  });

  return rows;
}

// ===================== الحوض مجمّعًا حسب الموظف المسحوب منه =====================

export type PoolSourceGroup = {
  employeeId: string;   // الموظف المسحوب منه (المصدر)
  employee: string;     // اسمه
  count: number;        // عدد العملاء المسحوبين منه
  byFollowup: Record<EscalationCategory, number>; // توزيع حسب عدد المتابعات
  leadIds: string[];    // معرّفات عملاء المجموعة (للتوزيع)
};

function emptyFuMap(): Record<EscalationCategory, number> {
  return Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0])) as Record<EscalationCategory, number>;
}

/**
 * حوض «لم يتم الرد» مجمّعًا حسب الموظف المسحوب منه (من آخر Reassignment→null): لكل مصدر عدد
 * العملاء + توزيعهم حسب عدد المتابعات + معرّفاتهم (للتوزيع). بلا أسماء عملاء — أرقام ومجموعات.
 */
export async function getPoolBySourceEmployee(filters: NoResponseFilters = {}): Promise<PoolSourceGroup[]> {
  const config = getNoResponseConfig();
  const q = filters.q?.trim();
  const leads = await prisma.lead.findMany({
    where: { ...QUEUE_WHERE, ...(q ? { OR: [{ name: { contains: q } }, { phone: { contains: q } }] } : {}) },
    select: {
      id: true,
      reassignments: { where: { toUserId: null }, orderBy: { createdAt: "desc" }, take: 1, select: { fromUserId: true } },
    },
    take: 3000,
  });

  const statsByLead = await noAnswerStatsByLead(leads.map((l) => l.id));

  const bySource = new Map<string, { leadIds: string[]; byFollowup: Record<EscalationCategory, number>; count: number }>();
  for (const l of leads) {
    const src = l.reassignments[0]?.fromUserId;
    if (!src) continue; // بلا مصدر معروف
    const stats = statsByLead.get(l.id) ?? { included: true, noAnswerCount: 0, lastNoAnswerAt: null, lastResult: null };
    if (!stats.included) continue; // رد العميل → خارج النظام
    const cat = escalationCategory(stats.noAnswerCount, config);
    const g = bySource.get(src) ?? { leadIds: [], byFollowup: emptyFuMap(), count: 0 };
    g.leadIds.push(l.id);
    g.count++;
    g.byFollowup[cat]++;
    bySource.set(src, g);
  }

  let entries = [...bySource.entries()];
  if (filters.prevEmp) entries = entries.filter(([src]) => src === filters.prevEmp);

  const names = await prisma.user.findMany({ where: { id: { in: entries.map(([src]) => src) } }, select: { id: true, name: true } });
  const nameById = new Map(names.map((u) => [u.id, u.name]));

  return entries
    .map(([employeeId, g]) => ({ employeeId, employee: nameById.get(employeeId) ?? "—", count: g.count, byFollowup: g.byFollowup, leadIds: g.leadIds }))
    .sort((a, b) => b.count - a.count);
}

// ===================== بانر إنذار لوحة الموظف =====================

// سطر إنذار لفئة (حسب عدد المتابعات) — بعدده ونصّه الحرفي.
export type MyAlertLine = { followUps: number; count: number; message: string };

export type MyNoResponseAlert = {
  lines: MyAlertLine[]; // سطر لكل فئة فيها عملاء بلغوا الإنذار/السحب (مرتّبة تصاعديًا بعدد المتابعات)
  late: number;         // إجمالي المتأخرين (لتوافق العرض القديم)
  pulled: number;       // كم عميل سُحب مني مؤخّرًا لعدم التواصل (آخر ٧ أيام)
};

/**
 * إنذار الموظف على لوحته مفصّلًا حسب فئة التصعيد: لكل فئة عدد + نص الإنذار المناسب.
 * يطابق منطق المحرّك (نفس المرشّحين + noResponseState + الحصانات).
 */
export async function getMyNoResponseAlert(userId: string, now: Date = new Date()): Promise<MyNoResponseAlert> {
  const config = getNoResponseConfig();
  const recentCutoff = new Date(now.getTime() - 7 * 24 * 3_600_000);

  const [mine, pulled] = await Promise.all([
    prisma.lead.findMany({
      where: {
        assignedToId: userId, isArchived: false,
        stage: { in: [...NO_RESPONSE_STAGES] }, reassignCount: { lt: MAX_REASSIGNS },
        manualAssignedAt: null,
      },
      select: { id: true, assignedAt: true },
    }),
    prisma.reassignment.count({
      where: { fromUserId: userId, toUserId: null, reason: "no_response", createdAt: { gte: recentCutoff } },
    }),
  ]);

  const statsByLead = await noAnswerStatsByLead(mine.map((l) => l.id));

  // نجمّع المتأخرين (بانتظار الإنذار أو يُسحب الآن) حسب عدد متابعات «لم يرد».
  const byFu = new Map<number, number>();
  for (const l of mine) {
    const stats = statsByLead.get(l.id) ?? { included: true, noAnswerCount: 0, lastNoAnswerAt: null, lastResult: null };
    if (!stats.included) continue; // رد العميل → خارج النظام
    const fu = stats.noAnswerCount;
    const baseline = noResponseBaseline(l.assignedAt, stats.lastNoAnswerAt, config.activationDate);
    const { state } = noResponseState(fu, baseline, now, config);
    if (state === "pending" || state === "overdue") byFu.set(fu, (byFu.get(fu) ?? 0) + 1);
  }

  const lines: MyAlertLine[] = [...byFu.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([followUps, count]) => ({ followUps, count, message: warnMessage(followUps, count) }));
  const late = lines.reduce((s, l) => s + l.count, 0);

  return { lines, late, pulled };
}
