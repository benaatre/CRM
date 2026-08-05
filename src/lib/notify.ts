import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { sendPush } from "@/lib/push/send";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * ينشئ إشعارًا لمجموعة مستخدمين، ويطلق نسخة Push نيتف لأجهزتهم.
 *
 * نقطة الحقن الوحيدة: كل مواضع إنشاء الإشعارات في النظام تمرّ من هنا (مباشرة
 * أو عبر emitNotification)، فتُغطّى كلها بلا لمس أي call-site.
 *
 * الإرسال best-effort ومنفصل عن الـawait الأساسي: notify() يُستدعى أحيانًا
 * داخل transaction (auto-distribute)، وانتظار نداء HTTP خارجي داخل معاملة
 * مفتوحة يقفل صفوفًا بلا داعٍ. المقايضة المعروفة: لو تراجعت المعاملة بعد
 * الإرسال، يصل تنبيه لجهاز بلا صف مقابل في الجرس — أثر تجميلي نادر، مقابل
 * عدم تعليق المعاملات.
 */
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
  // type هو eventKey — تختار منه خدمة الإرسال القناة (عادية/عاجلة).
  void sendPush(ids, { eventKey: type, title, body, link }).catch((e) =>
    console.error("[push] فشل إرسال إشعار نيتف", e),
  );
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
