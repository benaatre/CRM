import "server-only";

import type { Prisma, LeadStage, Channel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { NO_RESPONSE_STAGES, unreachableLeadIds } from "@/lib/auto-distribute";
import {
  getNoResponseConfig, noResponseBaseline, noResponseState, escalationCategory,
  CATEGORY_ORDER, warnMessage, noAnswerStats, overdueAgeBucket, OVERDUE_AGE_ORDER,
  type EscalationCategory, type NoAnswerStats, type OverdueAgeBucket,
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

// خانة لكل فئة تصعيد: الإجمالي + في المهلة (grace) + تحذير (٢٤س) + يُسحب الآن (overdue).
export type CategoryStat = { total: number; grace: number; warning: number; overdue: number };

export type PendingPullEmployee = {
  id: string;
  name: string;
  byCategory: Record<EscalationCategory, CategoryStat>;
  byAge: Record<OverdueAgeBucket, number>; // «يُسحب الآن» موزّعًا على فترات العمر (٣–٧ · ٨–١٤ · ١٥–٣٠ · ٣٠+)
  oldestOverdueDays: number;               // أقدم تأخير عند الموظف (أقصى daysSince) — لحجم المشكلة بنظرة
  totalGrace: number;   // مجموع «في المهلة» (grace) عبر الفئات
  totalWarning: number; // مجموع «تحذير ٢٤س» (warning) — الرقم الرئيسي لجدول «بانتظار السحب»
  totalOverdue: number; // مجموع «يُسحب الآن» (overdue) عبر الفئات
  overdueNeglect: number;   // §٣: من «يُسحب الآن» بسبب تقصير (count 1–2، انتهت المهلة)
  overdueExhausted: number; // §٣: من «يُسحب الآن» بسبب استنفاد محاولات (count ≥ حد السحب)
};

export type PendingPullSummary = {
  employees: PendingPullEmployee[];
  totalGrace: number;
  totalWarning: number;
  totalOverdue: number;
  inQueue: number; // إجمالي في الحوض (انسحبوا فعلًا)
  capped: number; // بلغوا سقف الدورات
  live: boolean; // حالة النظام: مفعّل (سحب حقيقي) أم معاينة (dry-run)
};

function emptyByCategory(): Record<EscalationCategory, CategoryStat> {
  return Object.fromEntries(CATEGORY_ORDER.map((c) => [c, { total: 0, grace: 0, warning: 0, overdue: 0 }])) as Record<EscalationCategory, CategoryStat>;
}

function emptyByAge(): Record<OverdueAgeBucket, number> {
  return Object.fromEntries(OVERDUE_AGE_ORDER.map((a) => [a, 0])) as Record<OverdueAgeBucket, number>;
}

/**
 * إحصاء «لم يرد» لكل عميل من متابعاته (نتيجة + وقت) — مصدر واحد يشاركه كل تجميع لم يتم الرد.
 * §١أ: نمرّر assignedAt لكل عميل فيُحتسب العدّاد من متابعات ما بعد آخر إسناد فقط (يتصفّر عند النقل).
 */
async function noAnswerStatsByLead(leads: { id: string; assignedAt: Date | null }[]): Promise<Map<string, NoAnswerStats>> {
  const out = new Map<string, NoAnswerStats>();
  if (leads.length === 0) return out;
  const assignedAtById = new Map(leads.map((l) => [l.id, l.assignedAt]));
  // م-٥: العدّاد يحتسب ما بعد آخر إسناد فقط — نحصر الجلب بما بعد أقدم assignedAt في المجموعة.
  const minAssignedAt = leads.reduce<Date | null>(
    (min, l) => (l.assignedAt && (!min || l.assignedAt < min) ? l.assignedAt : min),
    null,
  );
  const fus = await prisma.followUp.findMany({
    where: { leadId: { in: leads.map((l) => l.id) }, ...(minAssignedAt ? { createdAt: { gte: minAssignedAt } } : {}) },
    select: { leadId: true, result: true, createdAt: true },
  });
  const byLead = new Map<string, { result: string; createdAt: Date }[]>();
  for (const f of fus) {
    const arr = byLead.get(f.leadId);
    if (arr) arr.push({ result: f.result, createdAt: f.createdAt });
    else byLead.set(f.leadId, [{ result: f.result, createdAt: f.createdAt }]);
  }
  for (const l of leads) out.set(l.id, noAnswerStats(byLead.get(l.id) ?? [], assignedAtById.get(l.id) ?? null));
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
      // م-٣: active:true — يطابق المحرّك (runNoResponsePullback)؛ عملاء الموظف المعطَّل
      // كانوا يُعدّون «يُسحب الآن» في اللوحة والمحرك لا يسحبهم — رقم لا ينزل أبدًا.
      assignedTo: { role: "EMPLOYEE", active: true },
      manualAssignedAt: null,
    },
    select: { id: true, assignedToId: true, assignedAt: true, assignedTo: { select: { name: true } } },
  });

  // إحصاء «لم يرد» لكل عميل (العدّاد المعتمد + المرجع الزمني + الاستبعاد).
  const statsByLead = await noAnswerStatsByLead(leads.map((l) => ({ id: l.id, assignedAt: l.assignedAt })));

  const byEmp = new Map<string, PendingPullEmployee>();
  let totalGrace = 0;
  let totalWarning = 0;
  let totalOverdue = 0;
  for (const l of leads) {
    const stats = statsByLead.get(l.id) ?? { included: true, noAnswerCount: 0, lastNoAnswerAt: null, lastResult: null };
    if (!stats.included) continue; // رد العميل (آخر متابعة ليست «لم يرد») → خارج النظام
    const fu = stats.noAnswerCount;
    const baseline = noResponseBaseline(l.assignedAt, stats.lastNoAnswerAt, config.activationDate);
    const { state, daysSince } = noResponseState(fu, baseline, now, config);
    if (state === "out") continue; // §١ب: count=0 → خارج نظام «لم يتم الرد» إطلاقًا (لا يُحتسب في أي رقم)
    const cat = escalationCategory(fu, config);
    const id = l.assignedToId as string;
    const row = byEmp.get(id) ?? { id, name: l.assignedTo?.name ?? "—", byCategory: emptyByCategory(), byAge: emptyByAge(), oldestOverdueDays: 0, totalGrace: 0, totalWarning: 0, totalOverdue: 0, overdueNeglect: 0, overdueExhausted: 0 };
    row.byCategory[cat].total++;
    if (state === "overdue") {
      row.byCategory[cat].overdue++; row.totalOverdue++; totalOverdue++;
      // §٣: سبب السحب — استنفاد (count ≥ حد السحب) أو تقصير (دونه).
      if (fu >= config.immunityCap) row.overdueExhausted++; else row.overdueNeglect++;
      // فترة العمر (نفس daysSince من الـbaseline — بلا حساب جديد) + تتبّع أقدم تأخير.
      row.byAge[overdueAgeBucket(daysSince)]++;
      const d = Math.floor(daysSince);
      if (d > row.oldestOverdueDays) row.oldestOverdueDays = d;
    } else if (state === "warning") {
      row.byCategory[cat].warning++; row.totalWarning++; totalWarning++;
    } else { // grace
      row.byCategory[cat].grace++; row.totalGrace++; totalGrace++;
    }
    byEmp.set(id, row);
  }

  const [inQueue, capped] = await Promise.all([
    prisma.lead.count({ where: QUEUE_WHERE }),
    prisma.lead.count({
      where: { isArchived: false, stage: { in: [...NO_RESPONSE_STAGES] }, reassignCount: { gte: MAX_REASSIGNS } },
    }),
  ]);

  const employees = [...byEmp.values()].sort((a, b) => (b.totalOverdue * 1000 + b.totalWarning) - (a.totalOverdue * 1000 + a.totalWarning));
  return { employees, totalGrace, totalWarning, totalOverdue, inQueue, capped, live: config.enabled };
}

// ===================== المرشّحون للسحب (معاينة per-lead) =====================

export type PullbackClass = "warning" | "overdue";

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
      // م-٣: active:true — يطابق المحرّك (انظر getPendingPullByEmployee).
      assignedTo: { role: "EMPLOYEE", active: true },
      manualAssignedAt: null,
      ...(q ? { OR: [{ name: { contains: q } }, { phone: { contains: q } }] } : {}),
    },
    select: { id: true, name: true, phone: true, assignedToId: true, assignedAt: true, assignedTo: { select: { name: true } } },
    take: 2000,
  });

  const statsByLead = await noAnswerStatsByLead(leads.map((l) => ({ id: l.id, assignedAt: l.assignedAt })));

  let rows: PullbackPreviewRow[] = [];
  for (const l of leads) {
    const stats = statsByLead.get(l.id) ?? { included: true, noAnswerCount: 0, lastNoAnswerAt: null, lastResult: null };
    if (!stats.included) continue; // رد العميل → خارج النظام
    const fu = stats.noAnswerCount;
    const baseline = noResponseBaseline(l.assignedAt, stats.lastNoAnswerAt, config.activationDate);
    const { state, daysSince, pullDay } = noResponseState(fu, baseline, now, config);
    if (state !== "warning" && state !== "overdue") continue; // المرشّحون: تحذير أو تجاوز (out/grace مستبعدان)
    rows.push({
      id: l.id, name: l.name, phone: l.phone,
      employeeId: l.assignedToId, employee: l.assignedTo?.name ?? null,
      followUpCount: fu, daysLate: Math.floor(daysSince), timeoutDays: pullDay ?? 0,
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

  // الحوض عرض تاريخي: نمرّر epoch (لا null) فيُحتسب كل متابعات «لم يرد» تاريخيًا (assignedAt=null صار out).
  const statsByLead = await noAnswerStatsByLead(leads.map((l) => ({ id: l.id, assignedAt: new Date(0) })));

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
  warningCount: number; // §٥: عملاء في حالة warning (يُسحبون خلال ٢٤ ساعة) — مصدر بانر الموظف
  warningMinHoursLeft: number | null; // أقل عدد ساعات متبقّية على السحب بين عملاء warning (للّون)
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
      where: { fromUserId: userId, toUserId: null, reason: { startsWith: "no_response" }, createdAt: { gte: recentCutoff } },
    }),
  ]);

  const statsByLead = await noAnswerStatsByLead(mine.map((l) => ({ id: l.id, assignedAt: l.assignedAt })));

  // نجمّع المتأخرين (بانتظار الإنذار أو يُسحب الآن) حسب عدد متابعات «لم يرد».
  const byFu = new Map<number, number>();
  let warningCount = 0;
  let warningMinHoursLeft: number | null = null;
  for (const l of mine) {
    const stats = statsByLead.get(l.id) ?? { included: true, noAnswerCount: 0, lastNoAnswerAt: null, lastResult: null };
    if (!stats.included) continue; // رد العميل → خارج النظام
    const fu = stats.noAnswerCount;
    const baseline = noResponseBaseline(l.assignedAt, stats.lastNoAnswerAt, config.activationDate);
    const { state, daysSince, pullDay } = noResponseState(fu, baseline, now, config);
    if (state === "warning" || state === "overdue") byFu.set(fu, (byFu.get(fu) ?? 0) + 1);
    // §٥: عملاء warning + الساعات المتبقّية على السحب (للبانر واللون).
    if (state === "warning" && pullDay != null) {
      warningCount++;
      const hoursLeft = Math.max(0, (pullDay - daysSince) * 24);
      if (warningMinHoursLeft === null || hoursLeft < warningMinHoursLeft) warningMinHoursLeft = hoursLeft;
    }
  }

  const lines: MyAlertLine[] = [...byFu.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([followUps, count]) => ({ followUps, count, message: warnMessage(followUps, count) }));
  const late = lines.reduce((s, l) => s + l.count, 0);

  return { lines, late, pulled, warningCount, warningMinHoursLeft };
}

// ===================== بحاجة لمراجعة (للمالك فقط — عرض بلا سحب) =====================

export type ReviewGroup = { employeeId: string; employeeName: string; count: number };
export type NeedsReview = {
  noAssignDate: ReviewGroup[];      // (أ) مُسند لموظف لكن assignedAt=null → خارج السحب التلقائي
  neverContacted: ReviewGroup[];    // (ب) assignedAt مضبوط + صفر متابعات + مضى >٣ أيام
  totalNoAssign: number;
  totalNeverContacted: number;
};

/**
 * عملاء «بحاجة لمراجعة» لا يمسكهم السحب التلقائي — للمالك فقط (عرض تشخيصي بلا أزرار).
 *  (أ) بلا تاريخ إسناد: assignedToId مضبوط و assignedAt=null (لا نعرف متى أُسند → out).
 *  (ب) لم يُتواصل إطلاقًا: assignedAt مضبوط، صفر متابعات، ومضى أكثر من ٣ أيام.
 * كلاهما ضمن نطاق «لم يتم الرد» (NEW/ATTEMPTED، موظف مبيعات فعّال، دون سقف الدورات، غير يدوي).
 */
export async function getNeedsReview(now: Date = new Date()): Promise<NeedsReview> {
  const cutoff = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const base = {
    isArchived: false,
    stage: { in: [...NO_RESPONSE_STAGES] },
    manualAssignedAt: null,
    reassignCount: { lt: MAX_REASSIGNS },
    assignedTo: { role: "EMPLOYEE" as const, active: true },
  };
  const [noAssign, never] = await Promise.all([
    prisma.lead.findMany({
      where: { ...base, assignedToId: { not: null }, assignedAt: null },
      select: { assignedToId: true, assignedTo: { select: { name: true } } },
    }),
    prisma.lead.findMany({
      where: { ...base, assignedToId: { not: null }, assignedAt: { not: null, lt: cutoff }, followUps: { none: {} } },
      select: { assignedToId: true, assignedTo: { select: { name: true } } },
    }),
  ]);
  const group = (rows: { assignedToId: string | null; assignedTo: { name: string } | null }[]): ReviewGroup[] => {
    const m = new Map<string, { name: string; count: number }>();
    for (const r of rows) {
      if (!r.assignedToId) continue;
      const e = m.get(r.assignedToId) ?? { name: r.assignedTo?.name ?? "—", count: 0 };
      e.count++; m.set(r.assignedToId, e);
    }
    return [...m.entries()].map(([employeeId, v]) => ({ employeeId, employeeName: v.name, count: v.count })).sort((a, b) => b.count - a.count);
  };
  return { noAssignDate: group(noAssign), neverContacted: group(never), totalNoAssign: noAssign.length, totalNeverContacted: never.length };
}

// ===================== تعذّر الوصول (§٤ — للمالك فقط، عرض) =====================

export type UnreachableRow = { id: string; name: string; lastEmployee: string | null; exhaustedEmployees: number };

/**
 * §٤: عملاء «تعذّر الوصول» — سُحبوا بسبب EXHAUSTED من ≥٢ موظفين متعاقبين. مستبعدون من كل توزيع تلقائي.
 * عرض للمالك فقط: الاسم · آخر موظف EXHAUSTED · عدد الموظفين المتعاقبين.
 */
export async function getUnreachableLeads(): Promise<UnreachableRow[]> {
  const ids = [...(await unreachableLeadIds())];
  if (ids.length === 0) return [];
  const leads = await prisma.lead.findMany({
    where: { id: { in: ids }, isArchived: false },
    select: {
      id: true, name: true,
      reassignments: { where: { toUserId: null, reason: "no_response_exhausted" }, orderBy: { createdAt: "desc" }, select: { fromUserId: true } },
    },
  });
  const fromIds = [...new Set(leads.flatMap((l) => l.reassignments.map((r) => r.fromUserId)).filter((x): x is string => !!x))];
  const users = fromIds.length ? await prisma.user.findMany({ where: { id: { in: fromIds } }, select: { id: true, name: true } }) : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  return leads.map((l) => ({
    id: l.id, name: l.name,
    lastEmployee: l.reassignments[0]?.fromUserId ? (nameById.get(l.reassignments[0].fromUserId) ?? null) : null,
    exhaustedEmployees: new Set(l.reassignments.map((r) => r.fromUserId).filter(Boolean)).size,
  }));
}

// ===================== المستنفدون العالقون في الحوض =====================

export type ExhaustedRow = {
  id: string;
  name: string;
  reassignCount: number;
  lastEmployeeId: string | null; // آخر موظف سُحب منه (لتعطيله في التوزيع الاستثنائي)
  lastEmployee: string | null;
  pullDate: Date | null;
};

/**
 * عملاء الحوض الذين بلغوا سقف الدورات (reassignCount ≥ MAX): مسحوبون (assignedToId=null) وعالقون
 * — لا يوزّعهم التوزيع العادي ولا يسحبهم المحرّك. يحتاجون قرار المالك (توزيع استثنائي أو أرشفة). للمالك فقط.
 */
export async function getExhaustedPoolLeads(): Promise<ExhaustedRow[]> {
  const leads = await prisma.lead.findMany({
    where: { assignedToId: null, isArchived: false, stage: { in: [...NO_RESPONSE_STAGES] }, reassignCount: { gte: MAX_REASSIGNS } },
    select: {
      id: true, name: true, reassignCount: true,
      reassignments: { where: { toUserId: null }, orderBy: { createdAt: "desc" }, take: 1, select: { fromUserId: true, createdAt: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  const fromIds = [...new Set(leads.map((l) => l.reassignments[0]?.fromUserId).filter((x): x is string => !!x))];
  const users = fromIds.length ? await prisma.user.findMany({ where: { id: { in: fromIds } }, select: { id: true, name: true } }) : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  return leads.map((l) => {
    const last = l.reassignments[0];
    return {
      id: l.id, name: l.name, reassignCount: l.reassignCount,
      lastEmployeeId: last?.fromUserId ?? null,
      lastEmployee: last?.fromUserId ? (nameById.get(last.fromUserId) ?? null) : null,
      pullDate: last?.createdAt ?? null,
    };
  });
}

// ===================== دفعات السحب القابلة للتراجع (آخر ٢٤ ساعة) =====================

export type UndoableBatch = {
  batchId: string;
  kind: "auto" | "manual";
  at: Date;
  total: number;    // إجمالي المسحوبين في الدفعة (من سجل التدقيق)
  undoable: number; // كم لا يزال في الحوض قابلًا للإرجاع فعلًا
};

const AUTO_BATCH = "lead.no_response.autoPullBatch";
const MANUAL_BATCH = "lead.no_response.manualPullBatch";
const AUTO_PULLED = "lead.no_response.autoPulled";
const MANUAL_PULLED = "lead.no_response.manualPulled";

/**
 * دفعات السحب في آخر ٢٤ ساعة مع عدد القابل للإرجاع فعلًا (لا يزال في الحوض). ٣ استعلامات فقط:
 * ملخّصات الدفعات · سجلّات السحب لكل عميل · حالة العملاء الحالية. للمالك فقط.
 */
export async function getUndoablePullBatches(now: Date = new Date()): Promise<UndoableBatch[]> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [batches, leadRows] = await Promise.all([
    prisma.auditLog.findMany({
      where: { action: { in: [AUTO_BATCH, MANUAL_BATCH] }, createdAt: { gte: cutoff } },
      select: { entityId: true, action: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
    prisma.auditLog.findMany({
      where: { action: { in: [AUTO_PULLED, MANUAL_PULLED] }, createdAt: { gte: cutoff } },
      select: { entityId: true, summary: true },
    }),
  ]);
  if (batches.length === 0) return [];

  // اجمع معرّفات العملاء لكل دفعة (batchId من داخل الملخّص).
  const byBatch = new Map<string, Set<string>>();
  const allLeadIds = new Set<string>();
  for (const r of leadRows) {
    if (!r.entityId) continue;
    const bid = /batch=([^ \]·]+)/.exec(r.summary)?.[1];
    if (!bid) continue;
    const set = byBatch.get(bid) ?? new Set<string>();
    set.add(r.entityId);
    byBatch.set(bid, set);
    allLeadIds.add(r.entityId);
  }

  // العملاء الذين لا يزالون في الحوض (قابلون للإرجاع).
  const poolLeads = allLeadIds.size
    ? await prisma.lead.findMany({ where: { id: { in: [...allLeadIds] }, assignedToId: null, reassignCount: { gt: 0 } }, select: { id: true } })
    : [];
  const inPool = new Set(poolLeads.map((l) => l.id));

  return batches
    .filter((b): b is typeof b & { entityId: string } => !!b.entityId)
    .map((b) => {
      const set = byBatch.get(b.entityId) ?? new Set<string>();
      const undoable = [...set].filter((lid) => inPool.has(lid)).length;
      return { batchId: b.entityId, kind: b.action === AUTO_BATCH ? "auto" as const : "manual" as const, at: b.createdAt, total: set.size, undoable };
    })
    .filter((b) => b.total > 0);
}
