import "server-only";

import type { Prisma, LeadStage, Channel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  NO_RESPONSE_STAGES, WARN_AFTER_H, PULL_AFTER_H, PULL_ENABLED, noResponseBaseline,
} from "@/lib/auto-distribute";

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

export type PendingPullEmployee = {
  id: string;
  name: string;
  pending: number; // ٤٨–٧٢ ساعة بلا تواصل → بانتظار السحب
  overdue: number; // تجاوزوا ٧٢ ساعة → يُسحبون الآن
};

export type PendingPullSummary = {
  employees: PendingPullEmployee[];
  totalPending: number;
  totalOverdue: number;
  inQueue: number; // إجمالي في الحوض (انسحبوا فعلًا)
  capped: number; // بلغوا السقف
  live: boolean; // حالة النظام: مفعّل (سحب حقيقي) أم معاينة (dry-run)
};

/**
 * تجميع العملاء المتأخرين لكل موظف — مصدر بيانات رأس الصفحة.
 * pending = خطّ الأساس بين ٤٨ و٧٢ ساعة · overdue = تجاوز ٧٢ ساعة.
 * يطابق محرّك السحب حرفيًا: نفس المراحل + noResponseBaseline (max مع التفعيل) + سقف إعادة التوجيه.
 */
export async function getPendingPullByEmployee(now: Date = new Date()): Promise<PendingPullSummary> {
  const warnCutoff = new Date(now.getTime() - WARN_AFTER_H * 3_600_000);
  const pullCutoff = new Date(now.getTime() - PULL_AFTER_H * 3_600_000);

  // مرشّحون: موزّعون لموظف فعلي، غير مؤرشفين، في مراحل عدم الرد، دون سقف.
  const leads = await prisma.lead.findMany({
    where: {
      assignedToId: { not: null },
      isArchived: false,
      stage: { in: [...NO_RESPONSE_STAGES] },
      reassignCount: { lt: MAX_REASSIGNS },
      assignedTo: { role: "EMPLOYEE" },
    },
    select: {
      assignedToId: true, assignedAt: true, lastContact: true,
      assignedTo: { select: { name: true } },
    },
  });

  const byEmp = new Map<string, PendingPullEmployee>();
  let totalPending = 0;
  let totalOverdue = 0;
  for (const l of leads) {
    const base = noResponseBaseline(l);
    if (!base) continue;
    const isOverdue = base <= pullCutoff;
    const isPending = !isOverdue && base <= warnCutoff;
    if (!isOverdue && !isPending) continue;
    const id = l.assignedToId as string;
    const row = byEmp.get(id) ?? { id, name: l.assignedTo?.name ?? "—", pending: 0, overdue: 0 };
    if (isOverdue) { row.overdue++; totalOverdue++; }
    else { row.pending++; totalPending++; }
    byEmp.set(id, row);
  }

  const [inQueue, capped] = await Promise.all([
    prisma.lead.count({ where: QUEUE_WHERE }),
    prisma.lead.count({
      where: { isArchived: false, stage: { in: [...NO_RESPONSE_STAGES] }, reassignCount: { gte: MAX_REASSIGNS } },
    }),
  ]);

  // الأكثر تأخيرًا أولًا: المتجاوزون ٧٢ ساعة لهم وزن أكبر، ثم بانتظار السحب.
  const employees = [...byEmp.values()].sort((a, b) => (b.overdue * 1000 + b.pending) - (a.overdue * 1000 + a.pending));

  return { employees, totalPending, totalOverdue, inQueue, capped, live: PULL_ENABLED };
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

  // حلّ أسماء آخر موظف بدفعة واحدة (بلا N+1).
  const fromIds = [...new Set(leads.map((l) => l.reassignments[0]?.fromUserId).filter((x): x is string => !!x))];
  const users = fromIds.length
    ? await prisma.user.findMany({ where: { id: { in: fromIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));

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

// ===================== بانر إنذار لوحة الموظف =====================

export type MyNoResponseAlert = {
  late: number; // عملائي المتأخرون (بلا تواصل ≥ ٤٨ ساعة، ما زالوا معي) — تحرّك قبل السحب
  pulled: number; // كم عميل سُحب مني مؤخّرًا لعدم التواصل (آخر ٧ أيام)
};

/**
 * إنذار الموظف على لوحته: عملاؤه المعرّضون للسحب + من سُحب منه مؤخّرًا.
 * late يطابق منطق المحرّك (baseline ≥ ٤٨ ساعة، مراحل عدم الرد، دون السقف).
 */
export async function getMyNoResponseAlert(userId: string, now: Date = new Date()): Promise<MyNoResponseAlert> {
  const warnCutoff = new Date(now.getTime() - WARN_AFTER_H * 3_600_000);
  const recentCutoff = new Date(now.getTime() - 7 * 24 * 3_600_000);

  const [mine, pulled] = await Promise.all([
    prisma.lead.findMany({
      where: {
        assignedToId: userId, isArchived: false,
        stage: { in: [...NO_RESPONSE_STAGES] }, reassignCount: { lt: MAX_REASSIGNS },
      },
      select: { assignedAt: true, lastContact: true },
    }),
    prisma.reassignment.count({
      where: { fromUserId: userId, toUserId: null, reason: "no_response", createdAt: { gte: recentCutoff } },
    }),
  ]);

  const late = mine.filter((l) => {
    const base = noResponseBaseline(l);
    return !!base && base <= warnCutoff;
  }).length;

  return { late, pulled };
}
