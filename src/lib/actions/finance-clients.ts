"use server";

import { revalidatePath } from "next/cache";
import { LeadStage, Priority, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toUserError } from "@/lib/action-error";
import { requireUser, SELLER_ROLES } from "@/lib/auth-guards";
import { assignmentData } from "@/lib/assignment";
import { dedupeKey } from "@/lib/phone-dupe";
import { normalizePhone, phoneVariants } from "@/lib/value-normalize";
import { logAudit } from "@/lib/audit";
import { notifyBestEffort, emitNotification } from "@/lib/notifications/emit";

/**
 * باب المالي الوحيد للعملاء (سلطة المالي — البند ٦): بحث برقم الجوال + تسجيل
 * عميل جديد بإسناده لموظف. حجب FINANCE عن قوائم وملفات العملاء (requireClientAccess
 * والمسارات الاثني عشر) لا يُلمس — هذا مسار مخصص بصلاحية server-side صريحة.
 */
async function requireFinanceClientDoor() {
  const user = await requireUser();
  if (user.role !== Role.FINANCE && user.role !== Role.OWNER) {
    throw new Error("هذه الشاشة للمدير المالي فقط");
  }
  return user;
}

export type FinanceLookupMatch = {
  leadId: string;
  name: string;
  /** الموظف المسؤول — «غير موزّع» إن لم يوجد. */
  employeeName: string | null;
};

export type FinanceLookupResult =
  | { ok: true; matches: FinanceLookupMatch[] }
  | { ok: false; error: string };

/**
 * مطابقة بمنطق dedupeKey القائم (آخر ٩ أرقام) على كل السجلات — الحيّة والمؤرشفة
 * (المحجوز/المشتري أهم ما يجب أن يظهر للمالي قبل تسجيل نسخة مكررة).
 * الحد الأدنى من البيانات: الاسم + الموظف فقط — لا فتح ملف.
 */
export async function financePhoneLookup(phoneRaw: string): Promise<FinanceLookupResult> {
  try {
    await requireFinanceClientDoor();
    const phone = String(phoneRaw ?? "").trim();
    const key = dedupeKey(phone);
    if (!key) return { ok: false, error: "اكتب رقم جوال صحيح (٩ أرقام على الأقل)" };
    const cand = await prisma.lead.findMany({
      where: { phone: { in: phoneVariants(normalizePhone(phone)) } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, name: true, phone: true, assignedTo: { select: { name: true, role: true } } },
    });
    const matches = cand
      .filter((c) => dedupeKey(c.phone) === key)
      .slice(0, 5)
      .map((c) => ({
        leadId: c.id,
        name: c.name,
        // المُسند لمالك يُعرض «غير موزّع» — نفس عرف بقية الشاشات.
        employeeName: c.assignedTo && c.assignedTo.role !== "OWNER" ? c.assignedTo.name : null,
      }));
    return { ok: true, matches };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

export type FinanceRegisterResult =
  | { ok: true; leadId: string; employeeName: string }
  | { ok: false; error: string };

/** قائمة الموظفين النشطين المؤهلين للإسناد (SELLER_ROLES) — لنموذج التسجيل. */
export async function fetchFinanceSellers(): Promise<{ id: string; name: string }[]> {
  await requireFinanceClientDoor();
  return prisma.user.findMany({
    where: { role: { in: SELLER_ROLES }, active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/**
 * تسجيل عميل جديد من المالي — يُنسب للموظف المختار (إسناد يدوي بحصانته)،
 * بمصدر «المدير المالي»، مع تدقيق وإشعار للموظف. المكرر الحي يُرفض بإحالة للبحث.
 */
export async function financeRegisterLead(formData: FormData): Promise<FinanceRegisterResult> {
  try {
    const user = await requireFinanceClientDoor();
    const name = String(formData.get("name") ?? "").trim();
    const phone = String(formData.get("phone") ?? "").trim();
    const assignedToId = String(formData.get("assignedToId") ?? "");
    if (!name) return { ok: false, error: "اكتب اسم العميل" };
    if (!/^\d{9,10}$/.test(phone.replace(/\s/g, ""))) return { ok: false, error: "رقم جوال غير صحيح" };
    if (!assignedToId) return { ok: false, error: "اختر الموظف المسؤول" };

    const employee = await prisma.user.findFirst({
      where: { id: assignedToId, active: true, role: { in: SELLER_ROLES } },
      select: { id: true, name: true },
    });
    if (!employee) return { ok: false, error: "الموظف المختار غير صالح" };

    // سباق: البحث قال «غير موجود» لكن أحدًا سجّله قبل الضغط — نعيد للبحث بدل نسخة مكررة.
    const existing = await financePhoneLookup(phone);
    if (existing.ok && existing.matches.length > 0) {
      return { ok: false, error: `الرقم مسجل أصلًا باسم «${existing.matches[0].name}» — ابحث عنه من جديد` };
    }

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const lead = await prisma.lead.create({
      data: {
        name,
        phone,
        channel: "OTHER",
        source: "المدير المالي",
        stage: LeadStage.NEW,
        priority: Priority.MEDIUM,
        nextFollowup: tomorrow,
        createdById: user.id,
        // إسناد يدوي صريح (قرار بشري) — بأختامه الموحّدة وحصانته، خارج بركة التوزيع.
        ...assignmentData(employee.id, { manual: true }),
      },
    });
    await prisma.reassignment.create({
      data: { leadId: lead.id, fromUserId: null, toUserId: employee.id, reason: "manual" },
    });

    await notifyBestEffort("finance.lead.audit", () =>
      logAudit(prisma, {
        userId: user.id, action: "lead.created", entity: "lead", entityId: lead.id,
        summary: `المدير المالي سجّل عميل ${name} وأسنده لـ${employee.name}`,
      }));
    await notifyBestEffort("finance.lead.notify", () =>
      emitNotification({
        eventKey: "lead_assigned",
        assignedUserId: employee.id,
        title: "توزّع عليك عميل",
        body: `العميل: ${name} — سجّله المدير المالي`,
        link: `/leads/${lead.id}`,
      }));

    revalidatePath("/leads");
    revalidatePath("/dashboard");
    return { ok: true, leadId: lead.id, employeeName: employee.name };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}
