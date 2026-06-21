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

/** توزيع العملاء غير الموزّعين على الموظفين بالتساوي (round-robin). */
export async function distributeUnassigned(): Promise<ActionResult> {
  try {
    await requireManager();
    const [emps, unassigned] = await Promise.all([
      prisma.user.findMany({ where: { role: "EMPLOYEE", active: true }, select: { id: true } }),
      prisma.lead.findMany({ where: { assignedToId: null }, select: { id: true } }),
    ]);
    if (emps.length === 0) return { ok: false, error: "ما فيه موظفين مفعّلين للتوزيع" };
    if (unassigned.length === 0) return { ok: true, message: "ما فيه عملاء غير موزّعين" };

    await prisma.$transaction(
      unassigned.map((lead, i) =>
        prisma.lead.update({
          where: { id: lead.id },
          data: { assignedToId: emps[i % emps.length].id },
        }),
      ),
    );

    revalidatePath("/admin");
    revalidatePath("/leads");
    return { ok: true, message: `وُزّع ${unassigned.length} عميل على ${emps.length} موظف` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
