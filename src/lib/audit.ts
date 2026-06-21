import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/** يكتب سطرًا في سجل التدقيق (من + متى + ماذا). يقبل عميل prisma أو معاملة (tx). */
export async function logAudit(
  db: Db,
  data: { userId?: string | null; action: string; entity?: string; entityId?: string; summary: string },
): Promise<void> {
  await db.auditLog.create({
    data: {
      userId: data.userId ?? null,
      action: data.action,
      entity: data.entity ?? null,
      entityId: data.entityId ?? null,
      summary: data.summary,
    },
  });
}
