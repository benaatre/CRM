import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * سجل تدقيق الدوام (الدفعة الرابعة) — **append-only بحكم القانون هنا**:
 * هذا الملف هو نقطة الكتابة الوحيدة على `AuditEvent`، وفيه إنشاء فقط.
 * ممنوع أي update أو delete على هذا الجدول في أي مكان بالكود.
 *
 * منفصل عن `AuditLog` القديم (ملخصات نصية عامة) — هذا يحفظ قبل/بعد JSON
 * وسببًا وعنوان IP لإجراءات المالك الحسّاسة على الدوام.
 */
export async function recordAuditEvent(
  db: Db,
  input: {
    actorId: string;
    actorRole: string;
    /** SCHEDULE_UPDATE | EXCEPTION_GRANT | TIME_RESTORE | LEAVE_CANCEL | INTAKE_TOGGLE | PRIVACY_CONSENT … */
    action: string;
    resourceType: string;
    resourceId: string;
    before?: unknown;
    after?: unknown;
    reason?: string | null;
    ipAddress?: string | null;
  },
): Promise<void> {
  try {
    await db.auditEvent.create({
      data: {
        actorId: input.actorId,
        actorRole: input.actorRole,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        before: input.before === undefined ? undefined : (input.before as Prisma.InputJsonValue),
        after: input.after === undefined ? undefined : (input.after as Prisma.InputJsonValue),
        reason: input.reason ?? null,
        ipAddress: input.ipAddress ?? null,
      },
    });
  } catch (e) {
    // فشل التدقيق لا يفشل العملية نفسها — لكنه يستحق سطر خطأ صريحًا.
    console.error("[audit-event] فشل تسجيل حدث تدقيق", input.action, e);
  }
}
