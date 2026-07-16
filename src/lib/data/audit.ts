import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export type AuditEntry = {
  id: string;
  action: string;
  summary: string;
  userName: string | null;
  createdAt: Date;
};

export type AuditFilters = {
  /** بادئة نوع العملية: lead | booking | user | availability | source | project … */
  actionPrefix?: string;
  /** معرّف المستخدم الفاعل. */
  userId?: string;
  /** من تاريخ (شامل). */
  from?: Date;
  /** إلى تاريخ (شامل). */
  to?: Date;
  limit?: number;
};

export async function getAuditLog(filters: AuditFilters = {}): Promise<AuditEntry[]> {
  const { actionPrefix, userId, from, to, limit = 100 } = filters;

  const where: Prisma.AuditLogWhereInput = {};
  if (actionPrefix) where.action = { startsWith: `${actionPrefix}.` };
  if (userId) where.userId = userId;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = from;
    if (to) where.createdAt.lte = to;
  }

  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { user: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    summary: r.summary,
    userName: r.user?.name ?? null,
    createdAt: r.createdAt,
  }));
}

export type AuditActor = { id: string; name: string };

/**
 * كل مستخدم له سطور فعلية في السجل (مالك/مدير/موظف) — لفلتر «مَن».
 * distinct userId من AuditLog ثم جلب الأسماء.
 */
export async function getAuditActors(): Promise<AuditActor[]> {
  const rows = await prisma.auditLog.findMany({
    where: { userId: { not: null } },
    distinct: ["userId"],
    select: { userId: true },
  });
  const ids = rows.map((r) => r.userId).filter((v): v is string => !!v);
  if (ids.length === 0) return [];

  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return users.map((u) => ({ id: u.id, name: u.name }));
}
