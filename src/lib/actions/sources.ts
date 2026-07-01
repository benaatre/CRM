"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireManagerAction, requireUser } from "@/lib/auth-guards";
import { logAudit } from "@/lib/audit";
import { getSourcesList, type SourceListItem } from "@/lib/data/sources";
import { extractSheetId } from "@/lib/utils/sheet";

export type ActionResult = { ok: boolean; error?: string; message?: string };

/** قائمة المصادر للـ dropdown — متاحة لأي مستخدم مسجّل (قراءة فقط). */
export async function fetchSources(): Promise<SourceListItem[]> {
  await requireUser();
  return getSourcesList();
}

function revalidateSources() {
  revalidatePath("/distribution");
}

/** إضافة مصدر جديد — للمالك/المدير. */
export async function addSource(name: string): Promise<ActionResult> {
  try {
    const user = await requireManagerAction();
    const clean = name.trim();
    if (!clean) return { ok: false, error: "اكتب اسم المصدر" };
    const exists = await prisma.leadSource.findUnique({ where: { name: clean }, select: { id: true } });
    if (exists) return { ok: false, error: "المصدر موجود مسبقًا" };
    await prisma.leadSource.create({ data: { name: clean } });
    await logAudit(prisma, { userId: user.id, action: "source.created", entity: "source", summary: `أضاف مصدر «${clean}»` });
    revalidateSources();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** حذف مصدر — يُمنع إذا مرتبط بعملاء أو روابط شيت. */
export async function deleteSource(id: string): Promise<ActionResult> {
  try {
    const user = await requireManagerAction();
    const src = await prisma.leadSource.findUnique({
      where: { id },
      select: { name: true, _count: { select: { leads: true, sheetLinks: true } } },
    });
    if (!src) return { ok: false, error: "المصدر غير موجود" };
    if (src._count.leads > 0 || src._count.sheetLinks > 0) {
      return { ok: false, error: "ما يمكن حذف مصدر مرتبط بعملاء أو روابط شيت" };
    }
    await prisma.leadSource.delete({ where: { id } });
    await logAudit(prisma, { userId: user.id, action: "source.deleted", entity: "source", summary: `حذف مصدر «${src.name}»` });
    revalidateSources();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** إضافة رابط جوجل شيت مربوط بمصدر (إجباري). */
export async function addSheetLink(sheetUrl: string, sourceId: string): Promise<ActionResult> {
  try {
    const user = await requireManagerAction();
    const url = sheetUrl.trim();
    if (!url) return { ok: false, error: "الصق رابط جوجل شيت" };
    if (!sourceId) return { ok: false, error: "اختر المصدر المرتبط" };
    const sheetId = extractSheetId(url);
    if (!sheetId) return { ok: false, error: "رابط جوجل شيت غير صالح" };
    const source = await prisma.leadSource.findUnique({ where: { id: sourceId }, select: { id: true, name: true } });
    if (!source) return { ok: false, error: "المصدر غير موجود" };
    // تفادي تكرار نفس الشيت لنفس المصدر.
    const dup = await prisma.sheetLink.findFirst({ where: { sheetId, sourceId }, select: { id: true } });
    if (dup) return { ok: false, error: "هذا الشيت مضاف مسبقًا لنفس المصدر" };

    await prisma.sheetLink.create({ data: { sheetUrl: url, sheetId, sourceId } });
    await logAudit(prisma, { userId: user.id, action: "sheetlink.created", entity: "sheetlink", summary: `أضاف رابط شيت لمصدر «${source.name}»` });
    revalidateSources();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** تفعيل/تعطيل رابط شيت. */
export async function toggleSheetLink(id: string, isActive: boolean): Promise<ActionResult> {
  try {
    await requireManagerAction();
    await prisma.sheetLink.update({ where: { id }, data: { isActive } });
    revalidateSources();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** حذف رابط شيت. */
export async function deleteSheetLink(id: string): Promise<ActionResult> {
  try {
    const user = await requireManagerAction();
    await prisma.sheetLink.delete({ where: { id } });
    await logAudit(prisma, { userId: user.id, action: "sheetlink.deleted", entity: "sheetlink", summary: "حذف رابط شيت" });
    revalidateSources();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
