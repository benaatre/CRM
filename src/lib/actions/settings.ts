"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireManager, requireUser } from "@/lib/auth-guards";
import { runSheetSync, type SyncResult } from "@/lib/sheet-sync";

export type ActionResult = { ok: boolean; error?: string };

export async function updateSettings(formData: FormData): Promise<ActionResult> {
  try {
    await requireManager();
    const companyName = String(formData.get("companyName") ?? "").trim();
    const falLicense = String(formData.get("falLicense") ?? "").trim() || null;
    const phone = String(formData.get("phone") ?? "").trim() || null;
    const autoAssign = formData.get("autoAssign") === "on";
    const googleSheetUrl = String(formData.get("googleSheetUrl") ?? "").trim() || null;
    if (!companyName) return { ok: false, error: "اكتب اسم الشركة" };

    await prisma.settings.upsert({
      where: { id: "singleton" },
      update: { companyName, falLicense, phone, autoAssign, googleSheetUrl },
      create: { id: "singleton", companyName, falLicense, phone, autoAssign, googleSheetUrl },
    });

    revalidatePath("/", "layout");
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** مزامنة فورية من جوجل شيت (زر «مزامنة الآن» + التشغيل الدوري). */
export async function syncGoogleSheet(): Promise<SyncResult> {
  try {
    await requireManager();
    const res = await runSheetSync();
    if (res.ok) {
      revalidatePath("/leads");
      revalidatePath("/admin");
      revalidatePath("/settings");
    }
    return res;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** تغيير رمز PIN للمستخدم الحالي (المالك/المدير من شاشة الإعدادات). */
export async function updateMyPin(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const pin = String(formData.get("pin") ?? "").trim();
    if (!/^\d{4,6}$/.test(pin)) return { ok: false, error: "الرمز لازم ٤–٦ أرقام" };
    await prisma.user.update({
      where: { id: user.id },
      data: { pinHash: bcrypt.hashSync(pin, 10) },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}