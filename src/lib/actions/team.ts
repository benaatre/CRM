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

type LoadedEmployee = { id: string; name: string; maxClients: number | null; count: number; capacity: number };

/** الموظفون المفعّلون مع حملهم الحالي (عملاء غير مؤرشفين) وسعتهم المتبقية (Infinity = بلا حد). */
async function loadEmployees(): Promise<LoadedEmployee[]> {
  const emps = await prisma.user.findMany({
    where: { role: "EMPLOYEE", active: true },
    select: { id: true, name: true, maxClients: true, _count: { select: { assignedLeads: { where: { isArchived: false } } } } },
    orderBy: { name: "asc" },
  });
  return emps.map((e) => ({
    id: e.id,
    name: e.name,
    maxClients: e.maxClients,
    count: e._count.assignedLeads,
    capacity: e.maxClients == null ? Infinity : Math.max(0, e.maxClients - e._count.assignedLeads),
  }));
}

function revalidateDistribution() {
  revalidatePath("/admin");
  revalidatePath("/leads");
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");
}

/**
 * توزيع العملاء غير الموزّعين على الموظفين — يحترم الحد الأقصى لكل موظف (maxClients).
 * perEmployee غير محدّد → بالتساوي (round-robin على الكل، مع تخطّي من وصل حدّه).
 * perEmployee = N → كل موظف ياخذ حتى N عميل (أو سعته المتبقية، الأصغر).
 */
export async function distributeUnassigned(perEmployee?: number): Promise<ActionResult> {
  try {
    await requireManager();
    const emps = await loadEmployees();
    if (emps.length === 0) return { ok: false, error: "ما فيه موظفين مفعّلين للتوزيع" };
    const unassigned = await prisma.lead.findMany({ where: { assignedToId: null }, select: { id: true }, orderBy: { createdAt: "asc" } });
    if (unassigned.length === 0) return { ok: true, message: "ما فيه عملاء غير موزّعين" };

    const n = perEmployee && perEmployee > 0 ? perEmployee : 0;
    // السعة لكل موظف: حدّه المتبقّي، ومع «عدد لكل موظف» نأخذ الأصغر بينه وبين n.
    const cap = new Map(emps.map((e) => [e.id, n ? Math.min(e.capacity, n) : e.capacity]));

    const order = emps.map((e) => e.id);
    const updates: ReturnType<typeof prisma.lead.update>[] = [];
    let idx = 0;
    for (const lead of unassigned) {
      let pick: string | null = null;
      for (let tries = 0; tries < order.length; tries++) {
        const id = order[idx % order.length];
        idx++;
        if ((cap.get(id) ?? 0) > 0) { pick = id; break; }
      }
      if (pick === null) break; // كل الموظفين وصلوا حدّهم الأقصى
      cap.set(pick, (cap.get(pick) as number) - 1);
      updates.push(prisma.lead.update({ where: { id: lead.id }, data: { assignedToId: pick } }));
    }
    if (updates.length === 0) return { ok: false, error: "كل الموظفين وصلوا الحد الأقصى لعملائهم" };
    await prisma.$transaction(updates);

    revalidateDistribution();
    const leftover = unassigned.length - updates.length;
    const base = `وُزّع ${updates.length} عميل على ${emps.length} موظف`;
    return { ok: true, message: leftover > 0 ? `${base} — بقي ${leftover} بدون توزيع (الموظفون وصلوا حدّهم الأقصى)` : base };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** أحمال الموظفين الحالية + السعة المتبقية — لجدول التوزيع المخصّص. */
export async function getEmployeeLoads(): Promise<{ id: string; name: string; count: number; maxClients: number | null; remaining: number | null }[]> {
  await requireManager();
  const emps = await loadEmployees();
  return emps.map((e) => ({
    id: e.id,
    name: e.name,
    count: e.count,
    maxClients: e.maxClients,
    remaining: e.capacity === Infinity ? null : e.capacity,
  }));
}

/** توزيع مخصّص: عدد محدّد لكل موظف من العملاء غير الموزّعين (بترتيب الأقدم) — لا يتجاوز سعة أي موظف. */
export async function distributeCustom(alloc: { userId: string; count: number }[]): Promise<ActionResult> {
  try {
    await requireManager();
    const items = alloc.filter((a) => a.userId && a.count > 0);
    if (items.length === 0) return { ok: false, error: "حدّد أعدادًا للتوزيع" };
    const totalWanted = items.reduce((s, a) => s + a.count, 0);

    const emps = await loadEmployees();
    const capById = new Map(emps.map((e) => [e.id, e.capacity]));
    const nameById = new Map(emps.map((e) => [e.id, e.name]));
    for (const a of items) {
      const capacity = capById.get(a.userId);
      if (capacity !== undefined && capacity !== Infinity && a.count > capacity) {
        return { ok: false, error: `${nameById.get(a.userId) ?? "موظف"}: العدد ${a.count} يتجاوز سعته المتبقية (${capacity})` };
      }
    }

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

    revalidateDistribution();
    return { ok: true, message: `وُزّع ${targets.length} عميل حسب الأعداد المحددة` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** توزيع غير الموزّعين على الأخفّ حملًا — يحترم الحد الأقصى لكل موظف. */
export async function distributeLeastLoaded(): Promise<ActionResult> {
  try {
    await requireManager();
    const emps = await loadEmployees();
    if (emps.length === 0) return { ok: false, error: "ما فيه موظفين مفعّلين للتوزيع" };
    const unassigned = await prisma.lead.findMany({ where: { assignedToId: null }, select: { id: true }, orderBy: { createdAt: "asc" } });
    if (unassigned.length === 0) return { ok: true, message: "ما فيه عملاء غير موزّعين" };

    const load = new Map(emps.map((e) => [e.id, e.count]));
    const cap = new Map(emps.map((e) => [e.id, e.capacity]));
    const updates: ReturnType<typeof prisma.lead.update>[] = [];
    for (const lead of unassigned) {
      let best: string | null = null;
      let min = Infinity;
      for (const e of emps) {
        if ((cap.get(e.id) ?? 0) <= 0) continue;
        const l = load.get(e.id) ?? 0;
        if (l < min) { min = l; best = e.id; }
      }
      if (best === null) break; // كل الموظفين وصلوا حدّهم الأقصى
      load.set(best, (load.get(best) ?? 0) + 1);
      cap.set(best, (cap.get(best) as number) - 1);
      updates.push(prisma.lead.update({ where: { id: lead.id }, data: { assignedToId: best } }));
    }
    if (updates.length === 0) return { ok: false, error: "كل الموظفين وصلوا الحد الأقصى لعملائهم" };
    await prisma.$transaction(updates);

    revalidateDistribution();
    const leftover = unassigned.length - updates.length;
    const base = `وُزّع ${updates.length} عميل على الأخفّ حملًا`;
    return { ok: true, message: leftover > 0 ? `${base} — بقي ${leftover} بدون توزيع (الموظفون وصلوا حدّهم الأقصى)` : base };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
