import "server-only";

import { prisma } from "@/lib/prisma";
import { dayStartKSA } from "@/lib/ksa-time";
import { notify } from "@/lib/notify";

/**
 * النداء المشروط (الدوام الواقعي — قانون ٩ وقرار ١٠): يُنشأ `SENT` فورًا
 * (كالنداء اليدوي — push يوصل والتطبيق مقفول) بسبب مسجّل، ويمر بحراس ثلاثة:
 *
 * - نداء نشط قائم (أي نوع) → لا نداء فوقه.
 * - تهدئة `conditionalCooldownMinutes` بين نداءات الانقطاع/الخروج (GAP/OUT).
 * - سقف `maxConditionalPerDay` يوميًا لهما — VISIT_STALE خارج السقف والتهدئة
 *   العامتين (له إيقاعه الخاص `visitReverifyMinutes` عند المستدعي) حتى لا
 *   يقتل السقفُ التحققَ الدوري المعتمد كل ٢٠ دقيقة.
 *
 * انتهاء مهلته بلا رد → توقف NO_RESPONSE بوقت غير مؤكَّد **من آخر إثبات موقع**
 * (فرع CONDITIONAL في expireMissedVerifications بالكرون).
 */

export type ConditionalReason = "HEARTBEAT_GAP" | "OUT_ZONE" | "SILENT_OUT" | "VISIT_STALE";

const CAPPED: ConditionalReason[] = ["HEARTBEAT_GAP", "OUT_ZONE", "SILENT_OUT"];

/* ═══════════ فلسفة النبض الحاكم — الدفعة أ ═══════════ */

/**
 * حصانة النبض (القاعدة الذهبية): آخر نبضة **محكومة** (inZone ليست null) كانت
 * داخل النطاق وعمرها ≤ هذه الدقائق = إثبات حضور قائم — لا نداء آليًا فوقه.
 * النداء اليدوي (trigger — قرار المالك المباشر) مستثنى عمدًا وينفذ دائمًا.
 * تُعدَّل من هنا حصرًا.
 */
export const PULSE_IMMUNITY_MINUTES = 30;

/**
 * إيقاف جدولة النداءات العشوائية الجديدة (من العشوائي الأعمى إلى تنبيهات
 * القرار): البنية كلها باقية — sendDueVerifications والتصعيد والرد — والمعلقة
 * القائمة تنتهي طبيعيًا؛ فقط لا جدولة RANDOM جديدة عند البصم/البصم التلقائي.
 */
export const NEW_RANDOM_CALLS_DISABLED: boolean = true;

/**
 * «النداء التلقائي عند الخروج المؤكد» (م٣-٣): عند التفعيل، خروجٌ مؤكَّد مستمر
 * ≥ settings.maxOutOfZoneMinutes يرسل نداءً تلقائيًا واحدًا (بسقوف اليوم
 * القائمة) بدل تنبيه قرار المالك. لا حقل إعداد قائم يصلح له ولا حقل JSON في
 * AttendanceSettings — فالوضع «إيقاف» ثابت هنا، ومفتاح المالك (تشغيل/إيقاف +
 * المدة) يُستكمل في الدفعة ب بإضافة schema.
 */
export const AUTO_CALL_ON_SUSTAINED_OUTZONE: boolean = false;

/**
 * هل المستخدم محصون بنبضه الآن؟ آخر نبضة محكومة داخل النطاق وطازجة.
 * (نبضة لاحقة خارج النطاق تُسقط الحصانة فورًا — فلا تُخنق نداءات الخروج.)
 */
export async function hasPulseImmunity(userId: string, now: Date): Promise<boolean> {
  const last = await prisma.attendancePulse.findFirst({
    where: { userId, inZone: { not: null } },
    orderBy: { at: "desc" },
    select: { inZone: true, at: true },
  });
  return (
    last?.inZone === true && now.getTime() - last.at.getTime() <= PULSE_IMMUNITY_MINUTES * 60_000
  );
}

export async function createConditionalCall(args: {
  userId: string;
  sessionId: string;
  reason: ConditionalReason;
  now: Date;
  windowMinutes: number;
  cooldownMinutes: number;
  maxPerDay: number;
  title: string;
  body?: string;
}): Promise<boolean> {
  const { userId, now, reason } = args;

  // نداء نشط قائم — لا نداء فوق نداء.
  const active = await prisma.attendanceVerification.findFirst({
    where: { userId, status: "SENT", deadlineAt: { gt: now } },
    select: { id: true },
  });
  if (active) return false;

  // القاعدة الذهبية (النبض الحاكم): نبضة داخل النطاق طازجة = لا نداء آليًا.
  // OUT_ZONE/SILENT_OUT تمرّان طبيعيًا — آخر نبضة محكومة عندهما خارجية أصلًا.
  if (await hasPulseImmunity(userId, now)) return false;

  const dayStart = dayStartKSA(now);
  if (CAPPED.includes(reason)) {
    // التهدئة العامة بين المشروطة المسقوفة.
    const recent = await prisma.attendanceVerification.findFirst({
      where: {
        userId,
        kind: "CONDITIONAL",
        triggerReason: { in: CAPPED },
        createdAt: { gte: new Date(now.getTime() - args.cooldownMinutes * 60_000) },
      },
      select: { id: true },
    });
    if (recent) return false;

    const todayCount = await prisma.attendanceVerification.count({
      where: { userId, kind: "CONDITIONAL", triggerReason: { in: CAPPED }, createdAt: { gte: dayStart } },
    });
    if (todayCount >= args.maxPerDay) return false;
  }

  const deadlineAt = new Date(now.getTime() + args.windowMinutes * 60_000);
  await prisma.attendanceVerification.create({
    data: {
      userId,
      sessionId: args.sessionId,
      kind: "CONDITIONAL",
      triggerReason: reason,
      status: "SENT",
      scheduledAt: now,
      sentAt: now,
      deadlineAt,
    },
  });
  await notify(prisma, [userId], "attendance.verify", args.title, args.body, "/m").catch(() => {});
  return true;
}
