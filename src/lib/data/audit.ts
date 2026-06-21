import "server-only";

import { prisma } from "@/lib/prisma";

export type AuditEntry = {
  id: string;
  action: string;
  summary: string;
  userName: string | null;
  createdAt: Date;
};

export async function getAuditLog(limit = 100): Promise<AuditEntry[]> {
  const rows = await prisma.auditLog.findMany({
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
