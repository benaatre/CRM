"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireManager } from "@/lib/auth-guards";
import { sendMail } from "@/lib/mailer";
import { emitLeadAssignedBatch, type LeadAssignedBucket } from "@/lib/notifications/emit";

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
  id: string; name: string; phone: string | null; email: string | null; role: Role;
  targetDeals: number; maxClients: number | null; staffNotes: string | null;
  active: boolean; allowedProjectIds: string[];
};

/** جلب تفاصيل موظف لنافذة الإعدادات. */
export async function fetchEmployeeDetail(userId: string): Promise<EmployeeDetail | null> {
  await requireManager();
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, phone: true, email: true, role: true, targetDeals: true, maxClients: true, staffNotes: true, active: true, allowedProjects: { select: { id: true } } },
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
    const email = String(formData.get("email") ?? "").trim().toLowerCase() || null;
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
    if (email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "صيغة الإيميل غير صحيحة" };
      const exists = await prisma.user.findFirst({ where: { email, NOT: { id: userId } } });
      if (exists) return { ok: false, error: "الإيميل مسجّل لمستخدم ثاني" };
    }
    if (pin && !/^\d{4,6}$/.test(pin)) return { ok: false, error: "الرمز لازم ٤–٦ أرقام" };

    await prisma.user.update({
      where: { id: userId },
      data: {
        name, phone, email, role, targetDeals, maxClients, staffNotes, active,
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

/** إرسال دعوة بالإيميل لتعيين/تغيير رمز الـ PIN — يولّد رمزًا صالحًا ٢٤ ساعة. */
export async function inviteEmployee(userId: string): Promise<ActionResult> {
  try {
    await requireManager();
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
    if (!u) return { ok: false, error: "الموظف غير موجود" };
    if (!u.email) return { ok: false, error: "أضف إيميل الموظف واحفظ أولاً" };

    const token = crypto.randomBytes(24).toString("hex");
    const exp = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.user.update({ where: { id: userId }, data: { pinResetToken: token, pinResetExp: exp } });

    const base = (process.env.AUTH_URL || process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/$/, "");
    const link = `${base}/reset-pin?token=${token}`;
    const html = `
      <div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;background:#0a0a0b;color:#ededf0;padding:24px;border-radius:12px">
        <h2 style="color:#cba45e;margin:0 0 8px">مرحبًا ${u.name}</h2>
        <p>تمت دعوتك لتعيين رمز الدخول (PIN) الخاص بك في نظام <b>مشاريع السلطان</b>.</p>
        <p style="margin:20px 0">
          <a href="${link}" style="background:#cba45e;color:#0a0a0b;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">تعيين رمز الدخول</a>
        </p>
        <p style="color:#9a9aa3;font-size:13px">الرابط صالح ٢٤ ساعة. إذا لم تطلب هذا تجاهل الرسالة.</p>
        <p style="color:#6b665b;font-size:11px;direction:ltr;word-break:break-all">${link}</p>
      </div>`;
    const res = await sendMail(u.email, "دعوة لتعيين رمز الدخول — مشاريع السلطان", html);
    if (!res.ok) return { ok: false, error: `تعذّر الإرسال: ${res.error}` };
    return { ok: true, message: `تم إرسال الدعوة إلى ${u.email}` };
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

/** يجمّع عدّاد ما استقبله كل موظف + عيّنة (لإشعار مجمّع واحد). */
function bumpBucket(buckets: Map<string, LeadAssignedBucket>, userId: string, leadId: string, name?: string) {
  const b = buckets.get(userId);
  if (b) b.count++;
  else buckets.set(userId, { userId, count: 1, sampleLeadId: leadId, sampleName: name });
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
    const unassigned = await prisma.lead.findMany({ where: { assignedToId: null }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
    if (unassigned.length === 0) return { ok: true, message: "ما فيه عملاء غير موزّعين" };

    const n = perEmployee && perEmployee > 0 ? perEmployee : 0;
    // السعة لكل موظف: حدّه المتبقّي، ومع «عدد لكل موظف» نأخذ الأصغر بينه وبين n.
    const cap = new Map(emps.map((e) => [e.id, n ? Math.min(e.capacity, n) : e.capacity]));

    const order = emps.map((e) => e.id);
    const updates: ReturnType<typeof prisma.lead.update>[] = [];
    const buckets = new Map<string, LeadAssignedBucket>();
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
      bumpBucket(buckets, pick, lead.id, lead.name);
    }
    if (updates.length === 0) return { ok: false, error: "كل الموظفين وصلوا الحد الأقصى لعملائهم" };
    await prisma.$transaction(updates);
    await emitLeadAssignedBatch([...buckets.values()]);

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

    const unassigned = await prisma.lead.findMany({ where: { assignedToId: null }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
    if (unassigned.length === 0) return { ok: true, message: "ما فيه عملاء غير موزّعين" };
    if (totalWanted > unassigned.length) return { ok: false, error: `المجموع ${totalWanted} أكبر من المتاح ${unassigned.length}` };

    const targets: { id: string; name: string; userId: string }[] = [];
    let i = 0;
    for (const a of items) {
      for (let k = 0; k < a.count && i < unassigned.length; k++, i++) {
        targets.push({ id: unassigned[i].id, name: unassigned[i].name, userId: a.userId });
      }
    }
    await prisma.$transaction(targets.map((t) => prisma.lead.update({ where: { id: t.id }, data: { assignedToId: t.userId } })));
    const buckets = new Map<string, LeadAssignedBucket>();
    for (const t of targets) bumpBucket(buckets, t.userId, t.id, t.name);
    await emitLeadAssignedBatch([...buckets.values()]);

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
    const unassigned = await prisma.lead.findMany({ where: { assignedToId: null }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
    if (unassigned.length === 0) return { ok: true, message: "ما فيه عملاء غير موزّعين" };

    const load = new Map(emps.map((e) => [e.id, e.count]));
    const cap = new Map(emps.map((e) => [e.id, e.capacity]));
    const updates: ReturnType<typeof prisma.lead.update>[] = [];
    const buckets = new Map<string, LeadAssignedBucket>();
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
      bumpBucket(buckets, best, lead.id, lead.name);
    }
    if (updates.length === 0) return { ok: false, error: "كل الموظفين وصلوا الحد الأقصى لعملائهم" };
    await prisma.$transaction(updates);
    await emitLeadAssignedBatch([...buckets.values()]);

    revalidateDistribution();
    const leftover = unassigned.length - updates.length;
    const base = `وُزّع ${updates.length} عميل على الأخفّ حملًا`;
    return { ok: true, message: leftover > 0 ? `${base} — بقي ${leftover} بدون توزيع (الموظفون وصلوا حدّهم الأقصى)` : base };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
