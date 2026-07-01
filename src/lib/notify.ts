import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/** ينشئ إشعارًا لمجموعة مستخدمين. */
export async function notify(
  db: Db,
  userIds: (string | null | undefined)[],
  type: string,
  title: string,
  body?: string,
  link?: string,
): Promise<void> {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (ids.length === 0) return;
  await db.notification.createMany({
    data: ids.map((userId) => ({ userId, type, title, body: body ?? null, link: link ?? null })),
  });
}

/** معرّفات كل المستخدمين المفعّلين. */
export async function activeUserIds(db: Db): Promise<string[]> {
  const us = await db.user.findMany({ where: { active: true }, select: { id: true } });
  return us.map((u) => u.id);
}

/** معرّفات المدراء والمالك المفعّلين. */
export async function managerIds(db: Db): Promise<string[]> {
  const us = await db.user.findMany({ where: { active: true, role: { in: ["OWNER", "ADMIN"] } }, select: { id: true } });
  return us.map((u) => u.id);
}

/** معرّفات المالك (OWNER) المفعّلين — لإشعارات المالك (مثل تجاوز الخصم). */
export async function ownerIds(db: Db): Promise<string[]> {
  const us = await db.user.findMany({ where: { active: true, role: "OWNER" }, select: { id: true } });
  return us.map((u) => u.id);
}
