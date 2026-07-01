"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser, isManager } from "@/lib/auth-guards";
import { logAudit } from "@/lib/audit";
import { notify, managerIds } from "@/lib/notify";
import { emitNotification } from "@/lib/notifications/emit";
import { ksaTodayStart } from "@/lib/auto-distribute";
import { PAUSE_REASONS, pauseReasonLabel, type PauseReasonCode, type PauseDurationCode } from "@/lib/availability";

export type ActionResult = { ok: boolean; error?: string; message?: string };

export type MyAvailability = {
  paused: boolean;
  reason: string | null;
  pauseUntil: Date | null;
};

/** حالة توفّر المستخدم الحالي (للزر في الواجهة). */
export async function getMyAvailability(): Promise<MyAvailability> {
  const user = await requireUser();
  const u = await prisma.user.findUnique({
    where: { id: user.id },
    select: { availabilityPaused: true, pauseReason: true, pauseUntil: true },
  });
  return { paused: !!u?.availabilityPaused, reason: u?.pauseReason ?? null, pauseUntil: u?.pauseUntil ?? null };
}

/** يحسب وقت الرجوع التلقائي من رمز المدة — null = يدوي بلا مدة. */
function computePauseUntil(duration: PauseDurationCode, now: Date): Date | null {
  if (duration === "2h") return new Date(now.getTime() + 2 * 60 * 60 * 1000);
  if (duration === "4h") return new Date(now.getTime() + 4 * 60 * 60 * 1000);
  if (duration === "today") return new Date(ksaTodayStart(now).getTime() + 24 * 60 * 60 * 1000); // منتصف ليل السعودية القادم
  return null; // manual
}

function revalidateAvailability() {
  revalidatePath("/distribution");
  revalidatePath("/admin");
  revalidatePath("/", "layout");
}

/**
 * إيقاف استقبال العملاء — للموظف لنفسه، أو للمالك/المدير على أي موظف.
 * userId غير محدّد = إيقاف النفس.
 */
export async function pauseAvailability(input: {
  userId?: string;
  reason: PauseReasonCode;
  duration: PauseDurationCode;
}): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const targetId = input.userId || user.id;
    const isSelf = targetId === user.id;
    if (!isSelf && !isManager(user.role)) return { ok: false, error: "إيقاف موظف آخر للمدير فقط" };
    if (!PAUSE_REASONS.some((r) => r.code === input.reason)) return { ok: false, error: "سبب غير صالح" };

    const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, name: true } });
    if (!target) return { ok: false, error: "الموظف غير موجود" };

    const now = new Date();
    const pauseUntil = computePauseUntil(input.duration, now);
    await prisma.user.update({
      where: { id: targetId },
      data: { availabilityPaused: true, pauseReason: input.reason, pauseUntil, pausedBy: user.id, pausedAt: now },
    });

    const label = pauseReasonLabel(input.reason);
    if (isSelf) {
      // حدث: موظف وقف نفسه — الجمهور حسب الإعداد (افتراضيًا الإدارة).
      await emitNotification({
        eventKey: "employee_paused",
        title: "موظف أوقف الاستقبال",
        body: `${target.name} أوقف استقبال العملاء — السبب: ${label}`,
        link: "/distribution",
      });
    } else {
      // المالك أوقف الموظف → إشعار مباشر للموظف.
      await notify(prisma, [targetId], "availability.paused", "تم إيقاف استقبالك للعملاء", `السبب: ${label}`);
    }
    await logAudit(prisma, {
      userId: user.id, action: "availability.paused", entity: "user", entityId: targetId,
      summary: isSelf ? `أوقف استقباله للعملاء (${label})` : `أوقف استقبال ${target.name} (${label})`,
    });

    revalidateAvailability();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** الرجوع للاستقبال — للموظف لنفسه، أو للمالك/المدير على أي موظف. */
export async function resumeAvailability(input?: { userId?: string }): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const targetId = input?.userId || user.id;
    const isSelf = targetId === user.id;
    if (!isSelf && !isManager(user.role)) return { ok: false, error: "تفعيل موظف آخر للمدير فقط" };

    const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, name: true } });
    if (!target) return { ok: false, error: "الموظف غير موجود" };

    await prisma.user.update({
      where: { id: targetId },
      data: { availabilityPaused: false, pauseReason: null, pauseUntil: null, pausedBy: null, pausedAt: null },
    });

    if (isSelf) {
      const mgrs = await managerIds(prisma);
      await notify(prisma, mgrs, "availability.resumed", "موظف رجع للاستقبال", `${target.name} رجع لاستقبال العملاء`);
    } else {
      await notify(prisma, [targetId], "availability.resumed", "تم تفعيل استقبالك للعملاء", "ترجع الآن ضمن التوزيع التلقائي");
    }
    await logAudit(prisma, {
      userId: user.id, action: "availability.resumed", entity: "user", entityId: targetId,
      summary: isSelf ? "رجع لاستقبال العملاء" : `فعّل استقبال ${target.name}`,
    });

    revalidateAvailability();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
