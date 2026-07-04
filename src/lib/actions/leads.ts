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
import { toUserError } from "@/lib/action-error";
import { parseEnum } from "@/lib/parse-enum";
import { requireUser, isManager, requireManagerAction } from "@/lib/auth-guards";
import { logAudit } from "@/lib/audit";
import { emitNotification, emitLeadAssignedBatch, notifyBestEffort } from "@/lib/notifications/emit";
import { pickInitialAssignee, markContacted } from "@/lib/auto-distribute";
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
  revalidatePath("/dashboard");
  revalidatePath("/analytics");
}

/** إنشاء عميل جديد. الموظف يُسند العميل لنفسه؛ المدير يقدر يختار. */
export async function createLead(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();

    const name = String(formData.get("name") ?? "").trim();
    const phone = String(formData.get("phone") ?? "").trim();
    if (!name) return { ok: false, error: "اكتب اسم العميل" };
    if (!/^\d{9,10}$/.test(phone.replace(/\s/g, "")))
      return { ok: false, error: "رقم جوال غير صحيح" };

    const channel = parseEnum(Channel, formData.get("channel"), Channel.OTHER)!;
    // المصدر إجباري عند الإضافة اليدوية.
    const sourceId = String(formData.get("sourceId") ?? "").trim();
    if (!sourceId) return { ok: false, error: "اختر مصدر العميل" };
    const sourceExists = await prisma.leadSource.findUnique({ where: { id: sourceId }, select: { id: true } });
    if (!sourceExists) return { ok: false, error: "المصدر غير صالح" };
    const unitTypeRaw = formData.get("unitType") as string;
    const unitType =
      unitTypeRaw && unitTypeRaw in UnitType
        ? (unitTypeRaw as UnitType)
        : null;
    const budgetRaw = String(formData.get("budget") ?? "").replace(/[^\d]/g, "");
    const budget = budgetRaw ? Number(budgetRaw) : null;
    const notes = String(formData.get("notes") ?? "").trim() || null;

    // الإسناد: المدير يقدر يحدّد موظفًا؛ أو توزيع تلقائي ذكي (الدور/الأقل حملًا)؛ غير ذلك = نفسه.
    // autoDistributed = أُسند عبر نظام التوزيع التلقائي → يبدأ عدّاد إعادة التوجيه (assignedAt).
    let assignedToId = user.id;
    let autoDistributed = false;
    const chosen = String(formData.get("assignedToId") ?? "");
    if (isManager(user.role)) {
      if (chosen) {
        assignedToId = chosen;
      } else {
        // ١) التوزيع التلقائي الذكي (إن مُفعّل وداخل النافذة ومع وجود مشاركين متواجدين)
        const picked = await pickInitialAssignee(prisma);
        if (picked) {
          assignedToId = picked;
          autoDistributed = true;
        } else {
          // ٢) رجوع للإسناد البسيط للأقل حملًا (autoAssign القديم) إن مُفعّل
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
        sourceId,
        stage: LeadStage.NEW,
        priority: Priority.MEDIUM,
        nextFollowup: tomorrow,
        ...(autoDistributed ? { assignedAt: new Date() } : {}),
      },
    });
    if (autoDistributed) {
      await prisma.reassignment.create({ data: { leadId: lead.id, fromUserId: null, toUserId: assignedToId, reason: "initial" } });
    }
    // آثار جانبية بعد الحفظ — فشلها ما يُفشِل إنشاء العميل (#29).
    await notifyBestEffort("lead.created.audit", () =>
      logAudit(prisma, { userId: user.id, action: "lead.created", entity: "lead", entityId: lead.id, summary: `أضاف عميل ${name}` }));
    // حدث: توزّع عليك عميل — يُطلق فقط عند الإسناد لموظف غير المُنشئ (إسناد مدير/تلقائي).
    if (assignedToId && assignedToId !== user.id) {
      await notifyBestEffort("lead.created.notify", () =>
        emitNotification({
          eventKey: "lead_assigned",
          assignedUserId: assignedToId,
          title: "توزّع عليك عميل",
          body: `العميل: ${name}`,
          link: `/leads/${lead.id}`,
        }));
    }

    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e, "lead.create") };
  }
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
    return { ok: false, error: toUserError(e) };
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
      // مكالمة/واتساب = «تواصل» يوقف عدّاد إعادة التوجيه التلقائي.
      if (bumpsAttempt) await markContacted(tx, leadId);
    });

    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
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
    // تحديد موعد متابعة قادم = «تواصل» يوقف عدّاد إعادة التوجيه.
    if (data.nextFollowup) await markContacted(prisma, leadId);
    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
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

    // #8: النقل اليدوي يبدأ مهلة الموظف الجديد من جديد (assignedAt=الآن) ويُلغي احتساب تواصل السابق.
    await prisma.lead.updateMany({ where: { id: { in: ids } }, data: { assignedToId: toUserId, assignedAt: new Date(), contactedAt: null } });
    await logAudit(prisma, { userId: user.id, action: "lead.reassigned", entity: "lead", summary: `نقل ${ids.length} عميل إلى موظف` });
    // إشعار مجمّع للموظف المعني.
    await emitLeadAssignedBatch([{ userId: toUserId, count: ids.length, sampleLeadId: ids[0] }]);
    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/** حذف جماعي — المدير يحذف أي عميل، الموظف يحذف عملاءه فقط. */
/** حذف جماعي نهائي للعملاء — للمالك/المدير فقط (يُتحقق على الخادم). */
export async function bulkDelete(ids: string[]): Promise<ActionResult> {
  try {
    const user = await requireManagerAction(); // OWNER/ADMIN فقط — يرفض الموظف
    if (ids.length === 0) return { ok: false, error: "ما فيه عملاء محدّدين" };
    // امنع حذف عميل عنده بيع مكتمل — البيع سجل مالي ما ينمحي بحذف جماعي.
    const soldBks = await prisma.booking.findMany({
      where: { leadId: { in: ids }, stage: { in: ["SOLD", "DELIVERED"] } },
      select: { lead: { select: { name: true } } },
    });
    if (soldBks.length) {
      const names = [...new Set(soldBks.map((b) => b.lead.name))].join("، ");
      return { ok: false, error: `ما نقدر نحذف: عندهم مبيعات مسجّلة (${names}) — ألغِ البيع أول أو استثنِهم` };
    }
    // حرّر وحدات الحجوزات غير المباعة فقط قبل الحذف (الحجز يُحذف تلقائيًا cascade).
    const bks = await prisma.booking.findMany({ where: { leadId: { in: ids } }, select: { unitId: true } });
    const unitIds = bks.map((b) => b.unitId);
    await prisma.$transaction([
      ...(unitIds.length ? [prisma.unit.updateMany({ where: { id: { in: unitIds } }, data: { status: "AVAILABLE" } })] : []),
      prisma.lead.deleteMany({ where: { id: { in: ids } } }),
    ]);
    await logAudit(prisma, { userId: user.id, action: "lead.deleted", entity: "lead", summary: `حذف ${ids.length} عميل نهائيًا` });
    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
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
    return { ok: false, error: toUserError(e) };
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
    return { ok: false, error: toUserError(e) };
  }
}

/** تعديل بيانات العميل من تبويب «البيانات» في الدرج. */
export async function updateLead(
  leadId: string,
  data: {
    name?: string;
    phone?: string;
    budget?: string | null;
    unitType?: UnitType | null;
    priority?: Priority;
    purchaseMethod?: PurchaseMethod | null;
    purchaseGoal?: PurchaseGoal | null;
    preferredDistrict?: string | null;
    sourceId?: string | null;
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
        ...(data.priority ? { priority: data.priority } : {}),
        ...(data.unitType !== undefined ? { unitType: data.unitType } : {}),
        ...(budget !== undefined ? { budget } : {}),
        ...(data.purchaseMethod !== undefined ? { purchaseMethod: data.purchaseMethod } : {}),
        ...(data.purchaseGoal !== undefined ? { purchaseGoal: data.purchaseGoal } : {}),
        ...(data.preferredDistrict !== undefined ? { preferredDistrict: data.preferredDistrict || null } : {}),
        ...(data.sourceId !== undefined ? { sourceId: data.sourceId || null } : {}),
      },
    });
    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/** تعديل قناة العميل — للمالك/المدير فقط (الفرض على الخادم؛ الموظف يُرفض). */
export async function updateLeadChannel(leadId: string, channel: Channel): Promise<ActionResult> {
  try {
    if (!isManager((await requireUser()).role)) {
      return { ok: false, error: "تعديل القناة للمالك أو المدير فقط" };
    }
    if (!(channel in Channel)) return { ok: false, error: "قناة غير صالحة" };
    await prisma.lead.update({ where: { id: leadId }, data: { channel } });
    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
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
    sourceId?: string | null;
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
        ...(data.sourceId !== undefined ? { sourceId: data.sourceId || null } : {}),
      },
    });
    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
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
    return { ok: false, error: toUserError(e) };
  }
}

/**
 * تحويل عملاء لموظف — للمدير فقط. وضعان:
 *  - "full": نقل مع كل السجل والمتابعات (تبقى البيانات كما هي).
 *  - "fresh": نقل كعميل جديد (البيانات الأساسية فقط؛ المتابعات تبدأ من صفر).
 */
export async function transferLeads(
  ids: string[],
  toUserId: string,
  mode: "full" | "fresh",
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    if (!isManager(user.role)) return { ok: false, error: "التحويل للمدير فقط" };
    if (ids.length === 0) return { ok: false, error: "ما فيه عملاء محدّدين" };
    const target = await prisma.user.findUnique({ where: { id: toUserId }, select: { id: true, name: true } });
    if (!target) return { ok: false, error: "الموظف غير موجود" };

    await prisma.$transaction(async (tx) => {
      if (mode === "fresh") {
        await tx.followUp.deleteMany({ where: { leadId: { in: ids } } });
        await tx.lead.updateMany({
          where: { id: { in: ids } },
          data: {
            assignedToId: toUserId, stage: LeadStage.NEW, attempts: 0,
            firstContactStage: null, firstContactDate: null, firstContactAt: null,
            lastContact: null, nextFollowup: null,
            assignedAt: new Date(), contactedAt: null, // #8
          },
        });
      } else {
        // #8: النقل اليدوي يبدأ مهلة الموظف الجديد من جديد ويُلغي احتساب تواصل السابق.
        await tx.lead.updateMany({ where: { id: { in: ids } }, data: { assignedToId: toUserId, assignedAt: new Date(), contactedAt: null } });
      }
      await tx.activity.createMany({
        data: ids.map((leadId) => ({
          leadId, userId: user.id, type: ActivityType.ASSIGNMENT,
          note: mode === "fresh" ? `نُقل كعميل جديد إلى ${target.name}` : `نُقل إلى ${target.name}`,
        })),
      });
      await logAudit(tx, {
        userId: user.id, action: "lead.transferred", entity: "lead",
        summary: `${mode === "fresh" ? "نقل كعميل جديد" : "نقل"} ${ids.length} عميل إلى ${target.name}`,
      });
    });
    // إشعار مجمّع للموظف المعني.
    await emitLeadAssignedBatch([{ userId: toUserId, count: ids.length, sampleLeadId: ids[0] }]);
    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/** استرداد عملاء للنظام كعملاء جدد — بدون موظف، المرحلة ترجع «جديد». للمدير فقط. */
export async function recoverLeads(ids: string[]): Promise<ActionResult> {
  try {
    const user = await requireUser();
    if (!isManager(user.role)) return { ok: false, error: "الاسترداد للمدير فقط" };
    if (ids.length === 0) return { ok: false, error: "ما فيه عملاء محدّدين" };

    await prisma.$transaction(async (tx) => {
      await tx.followUp.deleteMany({ where: { leadId: { in: ids } } });
      await tx.lead.updateMany({
        where: { id: { in: ids } },
        data: {
          assignedToId: null, stage: LeadStage.NEW, attempts: 0,
          firstContactStage: null, firstContactDate: null, firstContactAt: null,
          lastContact: null, nextFollowup: null,
        },
      });
      await tx.activity.createMany({
        data: ids.map((leadId) => ({
          leadId, userId: user.id, type: ActivityType.ASSIGNMENT, note: "استُرد للنظام (بدون موظف)",
        })),
      });
      await logAudit(tx, {
        userId: user.id, action: "lead.recovered", entity: "lead",
        summary: `استرد ${ids.length} عميل للنظام كعملاء جدد`,
      });
    });
    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
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

    const [target, lead] = await Promise.all([
      prisma.user.findUnique({ where: { id: toUserId }, select: { id: true, name: true } }),
      prisma.lead.findUnique({ where: { id: leadId }, select: { name: true } }),
    ]);
    if (!target) return { ok: false, error: "الموظف غير موجود" };

    await prisma.$transaction([
      prisma.lead.update({
        where: { id: leadId },
        // #8: مهلة جديدة للموظف الجديد + إلغاء احتساب تواصل السابق.
        data: { assignedToId: toUserId, assignedAt: new Date(), contactedAt: null },
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
    // حدث: توزّع عليك عميل (الجمهور حسب الإعداد — افتراضيًا الموظف المعني).
    await emitNotification({
      eventKey: "lead_assigned",
      assignedUserId: toUserId,
      title: "توزّع عليك عميل",
      body: lead ? `العميل: ${lead.name}` : undefined,
      link: `/leads/${leadId}`,
    });

    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}
