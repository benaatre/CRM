"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireManager } from "@/lib/auth-guards";

export type ActionResult = { ok: boolean; error?: string; message?: string };

/** إضافة موظف مبيعات جديد برمز PIN. */
export async function addEmployee(formData: FormData): Promise<ActionResult> {
  try {
    await requireManager();
    const name = String(formData.get("name") ?? "").trim();
    const phone = String(formData.get("phone") ?? "").trim() || null;
    const pin = String(formData.get("pin") ?? "").trim();
    const target = Number(String(formData.get("target") ?? "0").replace(/\D/g, "")) || 0;

    if (!name) return { ok: false, error: "اكتب اسم الموظف" };
    if (!/^\d{4,6}$/.test(pin)) return { ok: false, error: "الرمز لازم ٤–٦ أرقام" };
    if (phone) {
      const exists = await prisma.user.findUnique({ where: { phone } });
      if (exists) return { ok: false, error: "الجوال مسجّل لموظف ثاني" };
    }

    await prisma.user.create({
      data: {
        name,
        phone,
        role: Role.EMPLOYEE,
        pinHash: bcrypt.hashSync(pin, 10),
        targetDeals: target,
        active: true,
      },
    });

    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type EmployeeDetail = {
  id: string; name: string; phone: string | null; role: Role;
  targetDeals: number; maxClients: number | null; staffNotes: string | null;
  active: boolean; allowedProjectIds: string[];
};

/** جلب تفاصيل موظف لنافذة الإعدادات. */
export async function fetchEmployeeDetail(userId: string): Promise<EmployeeDetail | null> {
  await requireManager();
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, phone: true, role: true, targetDeals: true, maxClients: true, staffNotes: true, active: true, allowedProjects: { select: { id: true } } },
  });
  if (!u) return null;
  return { ...u, allowedProjectIds: u.allowedProjects.map((p) => p.id) };
}

/** قائمة المشاريع (للاختيار في إعدادات الموظف). */
export async function fetchProjectsList(): Promise<{ id: string; name: string }[]> {
  await requireManager();
  return prisma.project.findMany({ select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
}

/** تحديث إعدادات موظف كاملة. */
export async function updateEmployee(userId: string, formData: FormData): Promise<ActionResult> {
  try {
    await requireManager();
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return { ok: false, error: "اكتب الاسم" };
    const phone = String(formData.get("phone") ?? "").trim() || null;
    const role = (String(formData.get("role") ?? "EMPLOYEE") as Role);
    const targetDeals = Number(String(formData.get("target") ?? "0").replace(/\D/g, "")) || 0;
    const maxClientsRaw = String(formData.get("maxClients") ?? "").replace(/\D/g, "");
    const maxClients = maxClientsRaw ? Number(maxClientsRaw) : null;
    const staffNotes = String(formData.get("staffNotes") ?? "").trim() || null;
    const active = String(formData.get("active") ?? "") === "on";
    const pin = String(formData.get("pin") ?? "").trim();
    const allowedProjectIds = formData.getAll("allowedProjects").map(String).filter(Boolean);

    if (phone) {
      const exists = await prisma.user.findFirst({ where: { phone, NOT: { id: userId } } });
      if (exists) return { ok: false, error: "الجوال مسجّل لمستخدم ثاني" };
    }
    if (pin && !/^\d{4,6}$/.test(pin)) return { ok: false, error: "الرمز لازم ٤–٦ أرقام" };

    await prisma.user.update({
      where: { id: userId },
      data: {
        name, phone, role, targetDeals, maxClients, staffNotes, active,
        ...(pin ? { pinHash: bcrypt.hashSync(pin, 10) } : {}),
        allowedProjects: { set: allowedProjectIds.map((id) => ({ id })) },
      },
    });
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** تفعيل/إيقاف موظف. */
export async function toggleEmployeeActive(userId: string, active: boolean): Promise<ActionResult> {
  try {
    await requireManager();
    await prisma.user.update({ where: { id: userId }, data: { active } });
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * توزيع العملاء غير الموزّعين على الموظفين.
 * perEmployee غير محدّد → بالتساوي (round-robin على الكل).
 * perEmployee = N → كل موظف ياخذ حتى N عميل.
 */
export async function distributeUnassigned(perEmployee?: number): Promise<ActionResult> {
  try {
    await requireManager();
    const [emps, unassigned] = await Promise.all([
      prisma.user.findMany({ where: { role: "EMPLOYEE", active: true }, select: { id: true } }),
      prisma.lead.findMany({ where: { assignedToId: null }, select: { id: true }, orderBy: { createdAt: "asc" } }),
    ]);
    if (emps.length === 0) return { ok: false, error: "ما فيه موظفين مفعّلين للتوزيع" };
    if (unassigned.length === 0) return { ok: true, message: "ما فيه عملاء غير موزّعين" };

    const n = perEmployee && perEmployee > 0 ? perEmployee : 0;
    const list = n ? unassigned.slice(0, n * emps.length) : unassigned;

    await prisma.$transaction(
      list.map((lead, i) => {
        const empIdx = n ? Math.floor(i / n) : i % emps.length;
        return prisma.lead.update({ where: { id: lead.id }, data: { assignedToId: emps[empIdx].id } });
      }),
    );

    revalidatePath("/admin");
    revalidatePath("/leads");
    revalidatePath("/pipeline");
    revalidatePath("/dashboard");
    return { ok: true, message: `وُزّع ${list.length} عميل على ${emps.length} موظف` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** أحمال الموظفين الحالية (عدد العملاء النشطين لكل موظف) — لجدول التوزيع المخصّص. */
export async function getEmployeeLoads(): Promise<{ id: string; name: string; count: number }[]> {
  await requireManager();
  const emps = await prisma.user.findMany({
    where: { role: "EMPLOYEE", active: true },
    select: { id: true, name: true, _count: { select: { assignedLeads: { where: { isArchived: false } } } } },
    orderBy: { name: "asc" },
  });
  return emps.map((e) => ({ id: e.id, name: e.name, count: e._count.assignedLeads }));
}

/** توزيع مخصّص: عدد محدّد لكل موظف من العملاء غير الموزّعين (بترتيب الأقدم). */
export async function distributeCustom(alloc: { userId: string; count: number }[]): Promise<ActionResult> {
  try {
    await requireManager();
    const items = alloc.filter((a) => a.userId && a.count > 0);
    if (items.length === 0) return { ok: false, error: "حدّد أعدادًا للتوزيع" };
    const totalWanted = items.reduce((s, a) => s + a.count, 0);

    const unassigned = await prisma.lead.findMany({ where: { assignedToId: null }, select: { id: true }, orderBy: { createdAt: "asc" } });
    if (unassigned.length === 0) return { ok: true, message: "ما فيه عملاء غير موزّعين" };
    if (totalWanted > unassigned.length) return { ok: false, error: `المجموع ${totalWanted} أكبر من المتاح ${unassigned.length}` };

    const targets: { id: string; userId: string }[] = [];
    let i = 0;
    for (const a of items) {
      for (let k = 0; k < a.count && i < unassigned.length; k++, i++) {
        targets.push({ id: unassigned[i].id, userId: a.userId });
      }
    }
    await prisma.$transaction(targets.map((t) => prisma.lead.update({ where: { id: t.id }, data: { assignedToId: t.userId } })));

    revalidatePath("/admin");
    revalidatePath("/leads");
    revalidatePath("/pipeline");
    revalidatePath("/dashboard");
    return { ok: true, message: `وُزّع ${targets.length} عميل حسب الأعداد المحددة` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** توزيع غير الموزّعين على الأخفّ حملًا — كل عميل يروح للموظف الأقل عملاءً وقتها. */
export async function distributeLeastLoaded(): Promise<ActionResult> {
  try {
    await requireManager();
    const [emps, unassigned] = await Promise.all([
      prisma.user.findMany({
        where: { role: "EMPLOYEE", active: true },
        select: { id: true, _count: { select: { assignedLeads: true } } },
      }),
      prisma.lead.findMany({ where: { assignedToId: null }, select: { id: true }, orderBy: { createdAt: "asc" } }),
    ]);
    if (emps.length === 0) return { ok: false, error: "ما فيه موظفين مفعّلين للتوزيع" };
    if (unassigned.length === 0) return { ok: true, message: "ما فيه عملاء غير موزّعين" };

    const load = new Map(emps.map((e) => [e.id, e._count.assignedLeads]));
    const updates = unassigned.map((lead) => {
      let best = emps[0].id;
      let min = Infinity;
      for (const e of emps) {
        const l = load.get(e.id) ?? 0;
        if (l < min) { min = l; best = e.id; }
      }
      load.set(best, (load.get(best) ?? 0) + 1);
      return prisma.lead.update({ where: { id: lead.id }, data: { assignedToId: best } });
    });
    await prisma.$transaction(updates);

    revalidatePath("/admin");
    revalidatePath("/leads");
    revalidatePath("/pipeline");
    revalidatePath("/dashboard");
    return { ok: true, message: `وُزّع ${unassigned.length} عميل على الأخفّ حملًا` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
