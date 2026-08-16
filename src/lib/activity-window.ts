import "server-only";

import { prisma } from "@/lib/prisma";
import { ksaDayKey } from "@/lib/ksa-time";
import { dayDateOf } from "@/lib/data/attendance";

/**
 * فترات فتح التطبيق (وضع «عن بُعد») — heartbeat مصدر الحقيقة (قرار المالك):
 *
 * كل نبضة (كل دقيقتين) تمدّد `closedAt` للفترة الجارية — سجل «متدحرج» مقفول
 * دائمًا بآخر نبضة، فلا يحتاج الكرون إقفالًا: انقطاع أطول من ٥ دقائق يعني
 * ببساطة أن النبضة التالية تفتح فترة **جديدة**. `appStateChange` تحسين للدقة:
 * الخروج للخلفية يقفل الفترة لحظيًا بدل انتظار مرور المهلة.
 *
 * يُقاس فقط لمن يومه REMOTE — لا نكتب صفوفًا لبقية الفريق مع كل نبضة.
 */

/** انقطاع أطول من كذا = فترة جديدة (نفس عتبة المواصفة). */
const GAP_MS = 5 * 60_000;

/** نبضة/عودة للمقدمة — تمديد الفترة الجارية أو فتح جديدة. */
export async function trackActivityWindow(userId: string, now: Date): Promise<void> {
  const todayKey = ksaDayKey(now);
  const date = dayDateOf(todayKey);

  const day = await prisma.attendanceDay.findUnique({
    where: { userId_date: { userId, date } },
    select: { mode: true },
  });
  if (day?.mode !== "REMOTE") return;

  const latest = await prisma.appActivityWindow.findFirst({
    where: { userId, date },
    orderBy: { openedAt: "desc" },
  });

  if (latest && latest.closedAt && now.getTime() - latest.closedAt.getTime() <= GAP_MS) {
    await prisma.appActivityWindow.update({ where: { id: latest.id }, data: { closedAt: now } });
  } else {
    await prisma.appActivityWindow.create({
      data: { userId, date, openedAt: now, closedAt: now },
    });
  }
}

/** خروج التطبيق للخلفية — إقفال لحظي للفترة الجارية (تحسين الدقة). */
export async function closeActivityWindow(userId: string, now: Date): Promise<void> {
  const date = dayDateOf(ksaDayKey(now));
  const latest = await prisma.appActivityWindow.findFirst({
    where: { userId, date },
    orderBy: { openedAt: "desc" },
    select: { id: true, closedAt: true },
  });
  if (latest && latest.closedAt && now.getTime() - latest.closedAt.getTime() <= GAP_MS) {
    await prisma.appActivityWindow.update({ where: { id: latest.id }, data: { closedAt: now } });
  }
}
