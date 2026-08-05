"use server";

import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guards";
import { logAudit } from "@/lib/audit";
import { dropUserTokens } from "@/lib/push/tokens";
import { WEB_LOGIN, MOBILE_LOGIN } from "@/lib/logout-target";

/**
 * خروج الويب. لا تُضاف لها معاملات: تُستخدم كـform action
 * (`<form action={signOutAction}>`) فأول معامل يصلها هو FormData لا وجهة.
 * الجوال له نسخته أدناه.
 */
export async function signOutAction() {
  // نظّف توكنات Push قبل إبطال الجلسة — وإلا بقيت إشعارات تصل جهازًا خرج منه صاحبه.
  const session = await auth();
  if (session?.user?.id) await dropUserTokens(session.user.id);
  await signOut({ redirectTo: WEB_LOGIN });
}

/**
 * تسجيل الخروج من كل الأجهزة: يرفع نقطة القطع sessionsValidFrom إلى الآن،
 * فتُبطَل كل جلسات المستخدم (JWT) المُصدَرة قبلها — على أي جهاز. عند التنقّل
 * التالي يكتشفها requireUser ويحوّل لـ /api/logout. ثم نُخرج الجهاز الحالي فورًا.
 */
async function signOutAllDevices(target: string): Promise<never> {
  const user = await requireUser();
  await prisma.user.update({
    where: { id: user.id },
    data: { sessionsValidFrom: new Date() },
  });
  await dropUserTokens(user.id); // كل الأجهزة تفقد Push أيضًا — لا جلسة ولا إشعار
  await signOut({ redirectTo: target });
  throw new Error("unreachable"); // signOut يرمي تحويلًا — للنوع فقط
}

/** «الخروج من كل الأجهزة» — الويب. form action كذلك، فبلا معاملات. */
export async function signOutAllDevicesAction() {
  return signOutAllDevices(WEB_LOGIN);
}

/**
 * «الخروج من كل الأجهزة» — الجوال. نسخة منفصلة بدل معامل وجهة: نظيرتها في
 * الويب تُستخدم كـform action فأي معامل يصلها FormData، ونداء الجوال مباشر.
 */
export async function signOutAllDevicesMobileAction() {
  return signOutAllDevices(MOBILE_LOGIN);
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
  await dropUserTokens(userId); // إخراج المالك لمستخدم يقطع إشعاراته النيتف كذلك
  await logAudit(prisma, {
    userId: actor.id,
    action: "user.securityChange",
    entity: "user",
    entityId: userId,
    summary: `أخرجت ${target.name} من أجهزته`,
  });
  return { ok: true };
}
