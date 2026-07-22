import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * دالة الإسناد الموحّدة — كل مسار يُسند عميلًا لموظف يمرّ من هنا (م-١ من تدقيق 2026-07).
 * تضمن كتابة الأختام الثلاثة دائمًا بلا استثناء:
 *   assignedToId + assignedAt (يبدأ عدّاد المهلة) + تصفير contactedAt (تواصل السابق لا يُحتسب)
 *   + سجل Reassignment (يغذّي «استقبل» في تقرير النشاط ولوحة التوزيع).
 * manual=true (قرار بشري: توزيع/نقل يدوي) → يكتب manualAssignedAt كمان (حصانة السحب التلقائي).
 */
export type AssignOpts = {
  /** إسناد يدوي (قرار بشري) — يمنح حصانة manualAssignedAt من السحب التلقائي */
  manual: boolean;
  /** سبب سجل التحويلات — الافتراضي: manual (يدوي) أو initial (تلقائي) */
  reason?: string;
  /** الموظف السابق (إن عُرف) — لسجل التحويلات */
  fromUserId?: string | null;
  now?: Date;
};

/** الحقول القياسية لأي إسناد — لا تُكتب هذه الحقول يدويًا خارج هذا الملف. */
export function assignmentData(toUserId: string, opts: AssignOpts) {
  const now = opts.now ?? new Date();
  return {
    assignedToId: toUserId,
    assignedAt: now,
    contactedAt: null,
    ...(opts.manual ? { manualAssignedAt: now } : {}),
  };
}

function assignmentReason(opts: AssignOpts): string {
  return opts.reason ?? (opts.manual ? "manual" : "initial");
}

/**
 * إسناد عميل واحد + سجل Reassignment داخل نفس الـtx.
 * guardWhere: شرط تزامن إضافي (مثل assignedToId=null) — لو ما تطابق يرجّع false بلا كتابة.
 * extraData: حقول إضافية تُكتب مع الإسناد (مثل stage أو reassignCount).
 */
export async function assignLead(
  db: Db,
  leadId: string,
  toUserId: string,
  opts: AssignOpts & { guardWhere?: Prisma.LeadWhereInput; extraData?: Prisma.LeadUpdateManyMutationInput },
): Promise<boolean> {
  const res = await db.lead.updateMany({
    where: { id: leadId, ...(opts.guardWhere ?? {}) },
    data: { ...assignmentData(toUserId, opts), ...(opts.extraData ?? {}) },
  });
  if (res.count !== 1) return false;
  await db.reassignment.create({
    data: { leadId, fromUserId: opts.fromUserId ?? null, toUserId, reason: assignmentReason(opts) },
  });
  return true;
}

/** إسناد دفعة عملاء لموظف واحد (updateMany + createMany) — نفس الحقول القياسية. يرجّع العدد. */
export async function assignLeadsToEmployee(
  db: Db,
  leadIds: string[],
  toUserId: string,
  opts: AssignOpts & { extraData?: Prisma.LeadUpdateManyMutationInput },
): Promise<number> {
  if (leadIds.length === 0) return 0;
  const res = await db.lead.updateMany({
    where: { id: { in: leadIds } },
    data: { ...assignmentData(toUserId, opts), ...(opts.extraData ?? {}) },
  });
  await db.reassignment.createMany({
    data: leadIds.map((leadId) => ({
      leadId,
      fromUserId: opts.fromUserId ?? null,
      toUserId,
      reason: assignmentReason(opts),
    })),
  });
  return res.count;
}
