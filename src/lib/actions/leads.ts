"use server";

import { revalidatePath } from "next/cache";
import {
  ActivityType,
  Channel,
  LeadStage,
  Priority,
  UnitType,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, isManager } from "@/lib/auth-guards";
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

  // الإسناد: المدير يقدر يحدّد موظفًا، غير ذلك = نفسه.
  let assignedToId = user.id;
  const chosen = String(formData.get("assignedToId") ?? "");
  if (isManager(user.role) && chosen) assignedToId = chosen;

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  await prisma.lead.create({
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

    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
