"use server";

import { signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guards";
import { logAudit } from "@/lib/audit";

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}

/**
 * تسجيل الخروج من كل الأجهزة: يرفع نقطة القطع sessionsValidFrom إلى الآن،
 * فتُبطَل كل جلسات المستخدم (JWT) المُصدَرة قبلها — على أي جهاز. عند التنقّل
 * التالي يكتشفها requireUser ويحوّل لـ /api/logout. ثم نُخرج الجهاز الحالي فورًا.
 */
export async function signOutAllDevicesAction() {
  const user = await requireUser();
  await prisma.user.update({
    where: { id: user.id },
    data: { sessionsValidFrom: new Date() },
  });
  await signOut({ redirectTo: "/login" });
}

/**
 * إخراج مستخدم بعينه من كل أجهزته — للمالك فقط (قسم «الجلسات» بالإعدادات).
 * نفس آلية sessionsValidFrom لكن على مستخدم محدد: توكناته الأقدم تُبطَل،
 * وطلبه التالي يكتشفه requireUser فيحوّله لـ/api/logout. بقية المستخدمين بلا أثر.
 */
export async function signOutUserDevices(userId: string): Promise<{ ok: boolean; error?: string }> {
  const actor = await requireUser();
  if (actor.role !== "OWNER") return { ok: false, error: "إخراج المستخدمين للمالك فقط" };
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  if (!target) return { ok: false, error: "المستخدم غير موجود" };
  await prisma.user.update({ where: { id: userId }, data: { sessionsValidFrom: new Date() } });
  await logAudit(prisma, {
    userId: actor.id,
    action: "user.securityChange",
    entity: "user",
    entityId: userId,
    summary: `أخرجت ${target.name} من أجهزته`,
  });
  return { ok: true };
}
