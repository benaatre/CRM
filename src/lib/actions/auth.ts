"use server";

import { signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guards";

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
