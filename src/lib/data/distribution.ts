import "server-only";

import { prisma } from "@/lib/prisma";
import { ksaTodayStart } from "@/lib/auto-distribute";

export type DistributedLead = {
  id: string;
  name: string;
  phone: string;
  employeeName: string | null;
  assignedAt: Date | null;
  contacted: boolean;
  reassignCount: number;
  stage: string;
  overdue: boolean;
  /// داخل بركة التوزيع التلقائي؟ (autoPoolAt != null) — يميّز «تلقائي» عن «يدوي» في اللوحة.
  inAutoPool: boolean;
};

export type ReassignmentRow = {
  id: string;
  leadName: string;
  fromName: string | null;
  toName: string | null;
  reason: string;
  createdAt: Date;
};

export type DistributionBoard = {
  todayLeads: DistributedLead[];
  log: ReassignmentRow[];
  stats: { total: number; contacted: number; pending: number; reassigned: number; auto: number; manual: number };
  timeoutMin: number;
  /// عدّادات البركة نفسها (مستقلة عن «موزّع اليوم»).
  pool: { total: number; unassigned: number };
};

/** بيانات لوحة مراقبة التوزيع: عملاء اليوم الموزّعون + سجل إعادات التوجيه. */
export async function getDistributionBoard(): Promise<DistributionBoard> {
  const now = new Date();
  const dayStart = ksaTodayStart(now);

  const settings = await prisma.settings.findUnique({
    where: { id: "singleton" }, select: { distTimeoutMin: true },
  });
  const timeoutMin = settings?.distTimeoutMin ?? 60;
  const cutoff = new Date(now.getTime() - timeoutMin * 60_000);

  const leads = await prisma.lead.findMany({
    where: { assignedAt: { gte: dayStart } },
    select: {
      id: true, name: true, phone: true, assignedAt: true, contactedAt: true,
      reassignCount: true, stage: true, isArchived: true, autoPoolAt: true,
      assignedTo: { select: { name: true } },
    },
    orderBy: { assignedAt: "desc" },
  });

  const todayLeads: DistributedLead[] = leads.map((l) => {
    const contacted = l.contactedAt != null;
    const advanced = l.stage === "RESERVED" || l.stage === "CLOSED_WON";
    return {
      id: l.id,
      name: l.name,
      phone: l.phone,
      employeeName: l.assignedTo?.name ?? null,
      assignedAt: l.assignedAt,
      contacted,
      reassignCount: l.reassignCount,
      stage: l.stage,
      // متأخّر = ما تم التواصل، غير مؤرشف، مو مرحلة متقدّمة، ومرّت المهلة.
      overdue: !contacted && !l.isArchived && !advanced && !!l.assignedAt && l.assignedAt <= cutoff,
      inAutoPool: l.autoPoolAt != null,
    };
  });

  const reassignments = await prisma.reassignment.findMany({
    where: { createdAt: { gte: dayStart } },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { lead: { select: { name: true } } },
  });
  // أسماء الموظفين للسجل
  const userIds = [...new Set(reassignments.flatMap((r) => [r.fromUserId, r.toUserId]).filter(Boolean) as string[])];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  const log: ReassignmentRow[] = reassignments.map((r) => ({
    id: r.id,
    leadName: r.lead?.name ?? "—",
    fromName: r.fromUserId ? nameById.get(r.fromUserId) ?? null : null,
    toName: r.toUserId ? nameById.get(r.toUserId) ?? null : null,
    reason: r.reason,
    createdAt: r.createdAt,
  }));

  const total = todayLeads.length;
  const contacted = todayLeads.filter((l) => l.contacted).length;
  const reassigned = todayLeads.filter((l) => l.reassignCount > 0).length;
  // «موزّع اليوم» ينقسم: تلقائي (داخل البركة) · يدوي (خارجها) — رقمان لا رقم واحد.
  const auto = todayLeads.filter((l) => l.inAutoPool).length;

  // عدّادات البركة نفسها — مستقلة عن اليوم.
  const [poolTotal, poolUnassigned] = await Promise.all([
    prisma.lead.count({ where: { autoPoolAt: { not: null }, isArchived: false } }),
    prisma.lead.count({ where: { autoPoolAt: { not: null }, isArchived: false, assignedToId: null } }),
  ]);

  return {
    todayLeads,
    log,
    stats: { total, contacted, pending: total - contacted, reassigned, auto, manual: total - auto },
    timeoutMin,
    pool: { total: poolTotal, unassigned: poolUnassigned },
  };
}
