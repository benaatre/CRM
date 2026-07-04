"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { toUserError } from "@/lib/action-error";
import { requireManager, requireUser } from "@/lib/auth-guards";
import { logAudit } from "@/lib/audit";
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

    // لوجو الشركة — يُخزَّن كـ Data URL (base64). الحد ٥٠٠ كيلوبايت.
    let logoUpdate: { logoUrl?: string | null } = {};
    const removeLogo = formData.get("removeLogo") === "on";
    const logo = formData.get("logo");
    if (removeLogo) {
      logoUpdate = { logoUrl: null };
    } else if (logo && typeof logo === "object" && "arrayBuffer" in logo && (logo as File).size > 0) {
      const file = logo as File;
      if (!file.type.startsWith("image/")) return { ok: false, error: "اللوجو لازم يكون صورة" };
      if (file.size > 500 * 1024) return { ok: false, error: "حجم اللوجو لازم أقل من ٥٠٠ كيلوبايت" };
      const b64 = Buffer.from(await file.arrayBuffer()).toString("base64");
      logoUpdate = { logoUrl: `data:${file.type};base64,${b64}` };
    }

    await prisma.settings.upsert({
      where: { id: "singleton" },
      update: { companyName, falLicense, phone, autoAssign, googleSheetUrl, ...logoUpdate },
      create: { id: "singleton", companyName, falLicense, phone, autoAssign, googleSheetUrl, ...logoUpdate },
    });

    revalidatePath("/", "layout");
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/** مزامنة فورية من جوجل شيت (زر «مزامنة الآن» + التشغيل الدوري). */
export async function syncGoogleSheet(): Promise<SyncResult> {
  try {
    await requireManager();
    const res = await runSheetSync();
    if (res.ok) {
      revalidatePath("/leads");
      revalidatePath("/pipeline");
      revalidatePath("/dashboard");
      revalidatePath("/admin");
      revalidatePath("/settings");
    }
    return res;
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/** حفظ إعدادات توقيتات الإشعارات. */
export async function updateNotifyConfig(formData: FormData): Promise<ActionResult> {
  try {
    await requireManager();
    const followupBeforeHours = Number(String(formData.get("followupBeforeHours") ?? "2").replace(/\D/g, "")) || 2;
    const staleHours = Number(String(formData.get("staleHours") ?? "48").replace(/\D/g, "")) || 48;
    await prisma.settings.update({
      where: { id: "singleton" },
      data: { notifyConfig: { followupBeforeHours, staleHours } },
    });
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/** تغيير رمز PIN للمستخدم الحالي (المالك/المدير من شاشة الإعدادات). */
export async function updateMyPin(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const currentPin = String(formData.get("currentPin") ?? "").trim();
    const pin = String(formData.get("pin") ?? "").trim();
    if (!/^\d{6}$/.test(pin)) return { ok: false, error: "الرمز لازم ٦ أرقام" };
    // تأكيد الرمز الحالي — جلسة مفتوحة على جهاز مشترك ما تكفي للاستيلاء.
    const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { pinHash: true } });
    if (dbUser?.pinHash && !bcrypt.compareSync(currentPin, dbUser.pinHash)) {
      return { ok: false, error: "الرمز الحالي غلط" };
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { pinHash: bcrypt.hashSync(pin, 10) },
    });
    await logAudit(prisma, { userId: user.id, action: "user.pinChanged", entity: "user", entityId: user.id, summary: "غيّر رمز الدخول" });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}