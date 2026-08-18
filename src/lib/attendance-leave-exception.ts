import "server-only";

import type { Prisma } from "@prisma/client";
import { dayDateOf } from "@/lib/data/attendance";
import { ksaDayKey } from "@/lib/ksa-time";
import { recordAuditEvent } from "@/lib/audit-event";

type Tx = Prisma.TransactionClient;

/**
 * إنشاء استثناء إجازة يوم كامل (FULL_DAY_LEAVE) — الدالة المشتركة (م١).
 * يستخدمها اعتماد طلب الإجازة الآن، ويتبنّاها مسار day/leave لاحقًا (م٢).
 * **داخل معاملة فقط**: تُنشئ الاستثناء + تضبط وضع اليوم LEAVE إن شمل اليوم +
 * (اختياريًا) توقف استقبال الليدات بالآلية القائمة + تُدوّن EXCEPTION_GRANT.
 * لا تمسّ جدول Lead — إيقاف الاستقبال أعمدة على User فقط.
 */
export async function createFullDayLeaveException(
  tx: Tx,
  input: {
    userId: string;
    /** ANNUAL | SICK | EMERGENCY — يُخزَّن نصًّا على الاستثناء (leaveType حر). */
    leaveType: string;
    fromKey: string; // YYYY-MM-DD
    toKey: string; // YYYY-MM-DD
    reason: string;
    createdById: string;
    authorizerId?: string | null;
    authorizerLabel?: string | null;
    selfDeclared?: boolean;
    actorRole: string;
    pauseIntake?: boolean;
    now?: Date;
  },
): Promise<{ id: string }> {
  const now = input.now ?? new Date();
  const todayKey = ksaDayKey(now);

  const created = await tx.attendanceException.create({
    data: {
      userId: input.userId,
      type: "FULL_DAY_LEAVE",
      dateFrom: dayDateOf(input.fromKey),
      dateTo: dayDateOf(input.toKey),
      reason: input.reason,
      createdById: input.createdById,
      leaveType: input.leaveType,
      authorizerId: input.authorizerId ?? null,
      authorizerLabel: input.authorizerLabel ?? null,
      selfDeclared: input.selfDeclared ?? false,
    },
  });

  // وضع اليوم LEAVE إن كانت المدة تشمل اليوم — البطاقة واللوحة يقرآنه.
  if (input.fromKey <= todayKey && todayKey <= input.toKey) {
    await tx.attendanceDay.upsert({
      where: { userId_date: { userId: input.userId, date: dayDateOf(todayKey) } },
      update: { mode: "LEAVE" },
      create: { userId: input.userId, date: dayDateOf(todayKey), mode: "LEAVE" },
    });
  }

  // إيقاف استقبال الليدات طوال المدة — نفس آلية day/leave حرفيًا (أعمدة User).
  if (input.pauseIntake) {
    const resumeAt = new Date(dayDateOf(input.toKey).getTime() + 86_400_000 + 6 * 3_600_000 - 3 * 3_600_000);
    await tx.user.update({
      where: { id: input.userId },
      data: {
        availabilityPaused: true,
        pauseReason: "VACATION",
        pauseUntil: resumeAt,
        pausedBy: input.createdById,
        pausedAt: now,
      },
    });
    await recordAuditEvent(tx, {
      actorId: input.createdById,
      actorRole: input.actorRole,
      action: "INTAKE_TOGGLE",
      resourceType: "user",
      resourceId: input.userId,
      after: { availabilityPaused: true, pauseUntil: resumeAt.toISOString(), cause: "leave_approved" },
      reason: "إيقاف تلقائي مع إجازة معتمدة",
    });
  }

  await recordAuditEvent(tx, {
    actorId: input.createdById,
    actorRole: input.actorRole,
    action: "EXCEPTION_GRANT",
    resourceType: "attendance_exception",
    resourceId: created.id,
    after: {
      userId: input.userId,
      type: "FULL_DAY_LEAVE",
      leaveType: input.leaveType,
      fromKey: input.fromKey,
      toKey: input.toKey,
      selfDeclared: input.selfDeclared ?? false,
    },
  });

  return { id: created.id };
}
