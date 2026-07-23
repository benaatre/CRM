import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { Role } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * إخفاء سجل العميل الموزَّع «كعميل جديد» (الخطوة ٣ — جلسة 2026-07-23):
 * عند توزيع عميل من حوض «لم يتم الرد» بخيار «كعميل جديد»، يُسجَّل التوزيع في Reassignment
 * بسبب لاحقته `_fresh` (مقابل `_full` للتوزيع بسجله). للموظف EMPLOYEE فقط، إذا كان آخر
 * إسناد للعميل بلاحقة `_fresh`: المتابعات/الأنشطة الأقدم من آخر assignedAt تُحذف من الـpayload،
 * والعدّادات تُحسب لما بعد الإسناد فقط، وأول تواصل/المرحلة الأولى لا يُرسلان.
 * المالك/المدير يصلهما كل شيء دائمًا، وللمالك زر «كشف السجل» يعطّل الإخفاء لعميل بعينه
 * (سجل AuditLog بنوع REVEAL_HISTORY، والضغطة الثانية HIDE_HISTORY تعيد الإخفاء).
 */

export const REVEAL_HISTORY_ACTION = "REVEAL_HISTORY";
export const HIDE_HISTORY_ACTION = "HIDE_HISTORY";

/** هل آخر إسنادٍ لهذا العميل كان توزيعًا «كعميل جديد»؟ (اللاحقة _fresh في سبب آخر إسناد فعلي) */
export function isFreshDistributed(lastAssignReason: string | null | undefined): boolean {
  return !!lastAssignReason && lastAssignReason.endsWith("_fresh");
}

/**
 * آخر قرار كشف/إخفاء مسجّل لعميل — null يعني لا قرار (الافتراضي: مخفي إن كان _fresh).
 * since: سجل الكشف يخص التوزيع الحالي فقط — الأقدم من آخر assignedAt لاغٍ
 * (توزيع جديد يعيد الافتراضي: مخفي، وكشف المرة السابقة لا يتسرب للموظف الجديد).
 */
export async function latestRevealAction(db: Db, leadId: string, since?: Date | null): Promise<string | null> {
  const row = await db.auditLog.findFirst({
    where: {
      entityId: leadId,
      entity: "lead",
      action: { in: [REVEAL_HISTORY_ACTION, HIDE_HISTORY_ACTION] },
      ...(since ? { createdAt: { gt: since } } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: { action: true },
  });
  return row?.action ?? null;
}

/**
 * قرار الإخفاء لدفعة عملاء (للقوائم) — استعلام تدقيق واحد للمجموعة.
 * يرجّع Set بمعرّفات العملاء الواجب إخفاء سجلهم عن هذا الدور.
 */
export async function hiddenHistoryIds(
  db: Db,
  role: Role,
  candidates: { id: string; lastAssignReason: string | null; assignedAt: Date | null }[],
): Promise<Set<string>> {
  if (role === Role.OWNER || role === Role.ADMIN) return new Set();
  const fresh = candidates.filter((c) => isFreshDistributed(c.lastAssignReason));
  if (fresh.length === 0) return new Set();
  const freshIds = fresh.map((c) => c.id);
  const assignedAtById = new Map(fresh.map((c) => [c.id, c.assignedAt]));
  const audits = await db.auditLog.findMany({
    where: { entityId: { in: freshIds }, entity: "lead", action: { in: [REVEAL_HISTORY_ACTION, HIDE_HISTORY_ACTION] } },
    orderBy: { createdAt: "desc" },
    select: { entityId: true, action: true, createdAt: true },
  });
  // الأحدث لكل عميل يحسم — مع إسقاط السجلات الأقدم من آخر إسناد (كشف توزيعة سابقة لاغٍ:
  // توزيع جديد يعيد الافتراضي «مخفي» ولا يرث كشفًا مُنح لموظف سابق).
  const latest = new Map<string, string>();
  for (const a of audits) {
    if (!a.entityId || latest.has(a.entityId)) continue;
    const assignedAt = assignedAtById.get(a.entityId);
    if (assignedAt && a.createdAt <= assignedAt) continue; // سجل من توزيعة سابقة — لاغٍ
    latest.set(a.entityId, a.action);
  }
  return new Set(freshIds.filter((id) => latest.get(id) !== REVEAL_HISTORY_ACTION));
}

/** قرار الإخفاء لعميل واحد (لملف العميل ومسار المتابعات). */
export async function shouldHideHistory(
  db: Db,
  role: Role,
  lead: { id: string; lastAssignReason: string | null; assignedAt: Date | null },
): Promise<boolean> {
  const hidden = await hiddenHistoryIds(db, role, [lead]);
  return hidden.has(lead.id);
}
