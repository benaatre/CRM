import "server-only";

import { prisma } from "@/lib/prisma";
import { emitNotification } from "@/lib/notifications/emit";

const CLOSED = ["CLOSED_WON", "CLOSED_LOST"] as const;

async function notifyTimings(): Promise<{ followupBeforeHours: number; staleHours: number }> {
  const s = await prisma.settings.findUnique({ where: { id: "singleton" }, select: { notifyConfig: true } });
  const cfg = (s?.notifyConfig as { followupBeforeHours?: number; staleHours?: number } | null) ?? null;
  return { followupBeforeHours: cfg?.followupBeforeHours ?? 2, staleHours: cfg?.staleHours ?? 48 };
}

/**
 * يطلق «قرب موعد متابعة» للعملاء الذين يقترب موعد متابعتهم (ضمن followupBeforeHours)
 * أو فات قليلًا — لمرة واحدة لكل عميل ضمن النافذة (dedup عبر سجل الإشعار).
 */
export async function runFollowupDueCheck(now: Date = new Date()): Promise<number> {
  const { followupBeforeHours } = await notifyTimings();
  const windowMs = followupBeforeHours * 3_600_000;
  const from = new Date(now.getTime() - windowMs); // يشمل ما فات قليلًا
  const to = new Date(now.getTime() + windowMs);   // والقادم القريب

  const leads = await prisma.lead.findMany({
    where: {
      nextFollowup: { gte: from, lte: to },
      isArchived: false,
      stage: { notIn: [...CLOSED] },
      assignedToId: { not: null },
    },
    select: { id: true, name: true, assignedToId: true },
  });

  let emitted = 0;
  for (const l of leads) {
    const link = `/leads/${l.id}`;
    // تفادي التكرار: لا تُعد التنبيه لنفس العميل خلال آخر نافذة.
    const recent = await prisma.notification.findFirst({
      where: { type: "followup_due", link, createdAt: { gte: new Date(now.getTime() - windowMs - 3_600_000) } },
      select: { id: true },
    });
    if (recent) continue;
    await emitNotification({
      eventKey: "followup_due",
      assignedUserId: l.assignedToId,
      title: "قرب موعد متابعة",
      body: `العميل: ${l.name}`,
      link,
    });
    emitted++;
  }
  return emitted;
}

/**
 * يطلق «موظف ركد / ما رد» للموظفين النشطين الذين عندهم عملاء مفتوحون ولم يسجّلوا
 * أي متابعة منذ staleHours — لمرة واحدة لكل موظف ضمن نافذة الركود (dedup).
 */
export async function runIdleEmployeeCheck(now: Date = new Date()): Promise<number> {
  const { staleHours } = await notifyTimings();
  const cutoff = new Date(now.getTime() - staleHours * 3_600_000);

  const emps = await prisma.user.findMany({ where: { role: "EMPLOYEE", active: true }, select: { id: true, name: true } });
  let emitted = 0;
  for (const e of emps) {
    // عنده شغل مفتوح؟ (بدون عملاء مفتوحين لا يُعتبر راكدًا)
    const openLeads = await prisma.lead.count({
      where: { assignedToId: e.id, isArchived: false, stage: { notIn: [...CLOSED] } },
    });
    if (openLeads === 0) continue;
    const lastFu = await prisma.followUp.findFirst({ where: { createdBy: e.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    const idle = !lastFu || lastFu.createdAt < cutoff;
    if (!idle) continue;

    const link = `/admin?u=${e.id}`;
    const recent = await prisma.notification.findFirst({
      where: { type: "employee_idle", link, createdAt: { gte: cutoff } },
      select: { id: true },
    });
    if (recent) continue;
    await emitNotification({
      eventKey: "employee_idle",
      title: "موظف ركد / ما رد",
      body: `${e.name} ما سجّل متابعة من فترة`,
      link,
    });
    emitted++;
  }
  return emitted;
}
