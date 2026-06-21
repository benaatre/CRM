"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireManager } from "@/lib/auth-guards";

export type ActionResult = { ok: boolean; error?: string };

export async function updateSettings(formData: FormData): Promise<ActionResult> {
  try {
    await requireManager();
    const companyName = String(formData.get("companyName") ?? "").trim();
    const falLicense = String(formData.get("falLicense") ?? "").trim() || null;
    const phone = String(formData.get("phone") ?? "").trim() || null;
    if (!companyName) return { ok: false, error: "اكتب اسم الشركة" };

    await prisma.settings.upsert({
      where: { id: "singleton" },
      update: { companyName, falLicense, phone },
      create: { id: "singleton", companyName, falLicense, phone },
    });

    revalidatePath("/", "layout");
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
