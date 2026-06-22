"use server";

import { revalidatePath } from "next/cache";
import {
  ActivityType,
  Channel,
  LeadStage,
  Priority,
  UnitType,
} from "@prisma/client";
import type { PurchaseMethod, PurchaseGoal, FirstContactStage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, isManager } from "@/lib/auth-guards";
import { logAudit } from "@/lib/audit";
import { notify, managerIds } from "@/lib/notify";
import { getLeadDetail, type LeadDetail } from "@/lib/data/leads";

export type ActionResult = { ok: boolean; error?: string };

/** جلب تفاصيل العميل للدرج (مع تحقق الصلاحية داخل getLeadDetail). */
export async function fetchLeadDetail(id: string): Promise<LeadDetail | null> {
  return getLeadDetail(id);
}

/** يتحقق أن العميل ضمن صلاحية المستخدم (مالكه أو مدير). يرجّع المستخدم أو يرمي. */
async function assertLeadAccess(leadId: string) {
  const user = await requireUser();
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, assignedToId: true, stage: true },
  });
  if (!lead) throw new Error("العميل غير موجود");
  if (!isManager(user.role) && lead.assignedToId !== user.id) {
    throw new Error("ما عندك صلاحية على هذا العميل");
  }
  return { user, lead };
}

function revalidateLeads() {
  revalidatePath("/leads");
  revalidatePath("/pipeline");
}

/** إنشاء عميل جديد. الموظف يُسند العميل لنفسه؛ المدير يقدر يختار. */
export async function createLead(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();

  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  if (!name) return { ok: false, error: "اكتب اسم العميل" };
  if (!/^\d{9,10}$/.test(phone.replace(/\s/g, "")))
    return { ok: false, error: "رقم جوال غير صحيح" };

  const channel = (formData.get("channel") as Channel) || Channel.OTHER;
  const unitTypeRaw = formData.get("unitType") as string;
  const unitType =
    unitTypeRaw && unitTypeRaw in UnitType
      ? (unitTypeRaw as UnitType)
      : null;
  const budgetRaw = String(formData.get("budget") ?? "").replace(/[^\d]/g, "");
  const budget = budgetRaw ? Number(budgetRaw) : null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  // الإسناد: المدير يقدر يحدّد موظفًا؛ أو إسناد تلقائي للأقل حملًا؛ غير ذلك = نفسه.
  let assignedToId = user.id;
  const chosen = String(formData.get("assignedToId") ?? "");
  if (isManager(user.role)) {
    if (chosen) {
      assignedToId = chosen;
    } else {
      const settings = await prisma.settings.findUnique({
        where: { id: "singleton" },
        select: { autoAssign: true },
      });
      if (settings?.autoAssign) {
        const emps = await prisma.user.findMany({
          where: { role: "EMPLOYEE", active: true },
          select: { id: true, _count: { select: { assignedLeads: true } } },
        });
        if (emps.length > 0) {
          emps.sort((a, b) => a._count.assignedLeads - b._count.assignedLeads);
          assignedToId = emps[0].id;
        }
      }
    }
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const lead = await prisma.lead.create({
    data: {
      name,
      phone,
      channel,
      unitType,
      budget,
      notes,
      assignedToId,
      createdById: user.id,
      stage: LeadStage.NEW,
      priority: Priority.MEDIUM,
      nextFollowup: tomorrow,
    },
  });
  await logAudit(prisma, { userId: user.id, action: "lead.created", entity: "lead", entityId: lead.id, summary: `أضاف عميل ${name}` });
  const mgrs = await managerIds(prisma);
  await notify(prisma, [...mgrs, assignedToId], "lead.new", "عميل جديد وصل", name);

  revalidateLeads();
  return { ok: true };
}

/** تغيير مرحلة العميل (السحب في الكانبان أو من الدرج) + تسجيل في السجل. */
export async function updateLeadStage(
  leadId: string,
  stage: LeadStage,
): Promise<ActionResult> {
  try {
    const { user, lead } = await assertLeadAccess(leadId);
    if (lead.stage === stage) return { ok: true };

    await prisma.$transaction([
      prisma.lead.update({
        where: { id: leadId },
        data: { stage, lastContact: new Date() },
      }),
      prisma.activity.create({
        data: {
          leadId,
          userId: user.id,
          type: ActivityType.STAGE_CHANGE,
          note: `نُقل إلى مرحلة جديدة`,
        },
      }),
    ]);

    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** تسجيل متابعة/نشاط على العميل. */
export async function addActivity(
  leadId: string,
  type: ActivityType,
  note: string,
): Promise<ActionResult> {
  try {
    const { user } = await assertLeadAccess(leadId);

    const bumpsAttempt =
      type === ActivityType.CALL || type === ActivityType.WHATSAPP;

    await prisma.$transaction(async (tx) => {
      await tx.activity.create({
        data: { leadId, userId: user.id, type, note: note.trim() || null },
      });
      const lead = await tx.lead.findUnique({
        where: { id: leadId },
        select: { firstContactAt: true },
      });
      await tx.lead.update({
        where: { id: leadId },
        data: {
          lastContact: new Date(),
          firstContactAt: lead?.firstContactAt ?? new Date(),
          ...(bumpsAttempt ? { attempts: { increment: 1 } } : {}),
        },
      });
    });

    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** تحديث أولوية/متابعة/ملاحظات العميل. */
export async function updateLeadFields(
  leadId: string,
  data: { priority?: Priority; nextFollowup?: string | null; notes?: string },
): Promise<ActionResult> {
  try {
    await assertLeadAccess(leadId);
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        ...(data.priority ? { priority: data.priority } : {}),
        ...(data.notes !== undefined ? { notes: data.notes.trim() || null } : {}),
        ...(data.nextFollowup !== undefined
          ? { nextFollowup: data.nextFollowup ? new Date(data.nextFollowup) : null }
          : {}),
      },
    });
    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** نقل جماعي لعدة عملاء لموظف — للمدير فقط. */
export async function bulkReassign(ids: string[], toUserId: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    if (!isManager(user.role)) return { ok: false, error: "النقل للمدير فقط" };
    if (ids.length === 0) return { ok: false, error: "ما فيه عملاء محدّدين" };
    const target = await prisma.user.findUnique({ where: { id: toUserId }, select: { id: true } });
    if (!target) return { ok: false, error: "الموظف غير موجود" };

    await prisma.lead.updateMany({ where: { id: { in: ids } }, data: { assignedToId: toUserId } });
    await logAudit(prisma, { userId: user.id, action: "lead.reassigned", entity: "lead", summary: `نقل ${ids.length} عميل إلى موظف` });
    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** حذف جماعي — المدير يحذف أي عميل، الموظف يحذف عملاءه فقط. */
export async function bulkDelete(ids: string[]): Promise<ActionResult> {
  try {
    const user = await requireUser();
    if (ids.length === 0) return { ok: false, error: "ما فيه عملاء محدّدين" };
    const scope = isManager(user.role) ? {} : { assignedToId: user.id };
    await prisma.lead.deleteMany({ where: { id: { in: ids }, ...scope } });
    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** أرشفة جماعية — تنقل العملاء لتبويب «تم الحجز/الشراء». المدير للكل، الموظف لعملائه فقط. */
export async function bulkArchive(ids: string[]): Promise<ActionResult> {
  try {
    const user = await requireUser();
    if (ids.length === 0) return { ok: false, error: "ما فيه عملاء محدّدين" };
    const scope = isManager(user.role) ? {} : { assignedToId: user.id };
    const res = await prisma.lead.updateMany({ where: { id: { in: ids }, ...scope }, data: { isArchived: true } });
    await logAudit(prisma, { userId: user.id, action: "lead.archived", entity: "lead", summary: `أرشف ${res.count} عميل` });
    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** إرجاع العميل لمرحلة «جديد» — مع تسجيل في السجل. */
export async function resetLeadToNew(leadId: string): Promise<ActionResult> {
  try {
    const { user, lead } = await assertLeadAccess(leadId);
    if (lead.stage === LeadStage.NEW) return { ok: true };
    await prisma.$transaction([
      prisma.lead.update({ where: { id: leadId }, data: { stage: LeadStage.NEW, lastContact: new Date() } }),
      prisma.activity.create({
        data: { leadId, userId: user.id, type: ActivityType.STAGE_CHANGE, note: "أُرجع لمرحلة جديد" },
      }),
    ]);
    await logAudit(prisma, { userId: user.id, action: "lead.resetToNew", entity: "lead", entityId: leadId, summary: "أرجع العميل لمرحلة جديد" });
    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** تعديل بيانات العميل من تبويب «البيانات» في الدرج. */
export async function updateLead(
  leadId: string,
  data: {
    name?: string;
    phone?: string;
    channel?: Channel;
    budget?: string | null;
    unitType?: UnitType | null;
    priority?: Priority;
    purchaseMethod?: PurchaseMethod | null;
    purchaseGoal?: PurchaseGoal | null;
    preferredDistrict?: string | null;
  },
): Promise<ActionResult> {
  try {
    await assertLeadAccess(leadId);
    const budget =
      data.budget != null ? Number(String(data.budget).replace(/[^\d]/g, "")) || null : undefined;
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        ...(data.name ? { name: data.name.trim() } : {}),
        ...(data.phone ? { phone: data.phone.replace(/[^\d]/g, "") } : {}),
        ...(data.channel ? { channel: data.channel } : {}),
        ...(data.priority ? { priority: data.priority } : {}),
        ...(data.unitType !== undefined ? { unitType: data.unitType } : {}),
        ...(budget !== undefined ? { budget } : {}),
        ...(data.purchaseMethod !== undefined ? { purchaseMethod: data.purchaseMethod } : {}),
        ...(data.purchaseGoal !== undefined ? { purchaseGoal: data.purchaseGoal } : {}),
        ...(data.preferredDistrict !== undefined ? { preferredDistrict: data.preferredDistrict || null } : {}),
      },
    });
    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** تحديث بيانات الاستقبال (هدف/طريقة الشراء + رينج السعر + الأحياء + المشاريع المفضّلة). */
export async function updateLeadIntake(
  leadId: string,
  data: {
    purchaseGoal?: PurchaseGoal | null;
    purchaseMethod?: PurchaseMethod | null;
    priceMin?: number | null;
    priceMax?: number | null;
    preferredAreas?: string[];
    preferredProjects?: string[];
  },
): Promise<ActionResult> {
  try {
    await assertLeadAccess(leadId);
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        ...(data.purchaseGoal !== undefined ? { purchaseGoal: data.purchaseGoal } : {}),
        ...(data.purchaseMethod !== undefined ? { purchaseMethod: data.purchaseMethod } : {}),
        ...(data.priceMin !== undefined ? { priceMin: data.priceMin } : {}),
        ...(data.priceMax !== undefined ? { priceMax: data.priceMax } : {}),
        ...(data.preferredAreas ? { preferredAreas: data.preferredAreas } : {}),
        ...(data.preferredProjects ? { preferredProjects: data.preferredProjects } : {}),
      },
    });
    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** تعيين المرحلة الأولى — مرة واحدة فقط، لا تُعدّل بعدها. */
export async function setFirstContactStage(leadId: string, stage: FirstContactStage): Promise<ActionResult> {
  try {
    const { user } = await assertLeadAccess(leadId);
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { firstContactStage: true } });
    if (lead?.firstContactStage) return { ok: false, error: "المرحلة الأولى محدّدة مسبقًا ولا تُعدّل" };
    await prisma.lead.update({
      where: { id: leadId },
      data: { firstContactStage: stage, firstContactDate: new Date(), firstContactAt: new Date() },
    });
    await logAudit(prisma, { userId: user.id, action: "lead.firstStage", entity: "lead", entityId: leadId, summary: "حدّد المرحلة الأولى" });
    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** إعادة إسناد العميل لموظف آخر — للمدير فقط. */
export async function reassignLead(
  leadId: string,
  toUserId: string,
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    if (!isManager(user.role))
      return { ok: false, error: "إعادة الإسناد للمدير فقط" };

    const target = await prisma.user.findUnique({
      where: { id: toUserId },
      select: { id: true, name: true },
    });
    if (!target) return { ok: false, error: "الموظف غير موجود" };

    await prisma.$transaction([
      prisma.lead.update({
        where: { id: leadId },
        data: { assignedToId: toUserId },
      }),
      prisma.activity.create({
        data: {
          leadId,
          userId: user.id,
          type: ActivityType.ASSIGNMENT,
          note: `أُسند إلى ${target.name}`,
        },
      }),
    ]);
    await logAudit(prisma, { userId: user.id, action: "lead.reassigned", entity: "lead", entityId: leadId, summary: `أعاد إسناد عميل إلى ${target.name}` });

    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
