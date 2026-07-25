"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toUserError } from "@/lib/action-error";
import { requireManagerAction, requireUser } from "@/lib/auth-guards";
import { logAudit } from "@/lib/audit";
import { getSourcesList, type SourceListItem } from "@/lib/data/sources";
import { readSheetValues } from "@/lib/google-sheets";
import { extractSheetId } from "@/lib/utils/sheet";

export type ActionResult = { ok: boolean; error?: string; message?: string };

/** قائمة المصادر للـ dropdown — متاحة لأي مستخدم مسجّل (قراءة فقط). */
export async function fetchSources(): Promise<SourceListItem[]> {
  await requireUser();
  return getSourcesList();
}

function revalidateSources() {
  revalidatePath("/distribution");
  revalidatePath("/settings");
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
    return { ok: false, error: toUserError(e) };
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
    return { ok: false, error: toUserError(e) };
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
    return { ok: false, error: toUserError(e) };
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
    return { ok: false, error: toUserError(e) };
  }
}

// ===================== شاشة «مصادر العملاء» (الإعدادات — مالك فقط) =====================

/** حارس المالك للأكشنات — يرمي خطأً عربيًا (لا redirect) ليصل toUserError للواجهة. */
async function requireOwnerAction() {
  const user = await requireUser();
  if (user.role !== Role.OWNER) throw new Error("شاشة «مصادر العملاء» للمالك فقط");
  return user;
}

/**
 * إضافة مصدر بشيته دفعة واحدة (المالك فقط): اسم المصدر (سناب/تيك توك/ميتا/جوجل…)
 * + رابط الشيت — يجد المصدر أو ينشئه ثم يربط الشيت به بمؤشر يبدأ من الصفر.
 */
export async function addSheetSource(name: string, sheetUrl: string): Promise<ActionResult> {
  try {
    const user = await requireOwnerAction();
    const clean = name.trim();
    const url = sheetUrl.trim();
    if (!clean) return { ok: false, error: "اكتب اسم المصدر" };
    if (!url) return { ok: false, error: "الصق رابط جوجل شيت" };
    const sheetId = extractSheetId(url);
    if (!sheetId) return { ok: false, error: "رابط جوجل شيت غير صالح" };

    const source = await prisma.leadSource.upsert({
      where: { name: clean },
      update: {},
      create: { name: clean },
    });
    const dup = await prisma.sheetLink.findFirst({ where: { sheetId, sourceId: source.id }, select: { id: true } });
    if (dup) return { ok: false, error: "هذا الشيت مضاف مسبقًا لنفس المصدر" };

    await prisma.sheetLink.create({ data: { sheetUrl: url, sheetId, sourceId: source.id } });
    await logAudit(prisma, { userId: user.id, action: "sheetlink.created", entity: "sheetlink", summary: `أضاف مصدر عملاء «${clean}» بشيت مزامنة` });
    revalidateSources();
    return { ok: true, message: `أُضيف مصدر «${clean}» — المزامنة بتلقطه بالدورة الجاية` };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

export type SheetTestResult = { ok: boolean; error?: string; rows?: string[][] };

/**
 * «جرّب الاتصال» (المالك فقط): يقرأ أول صفّين من الشيت ويعرضهما — يتحقق من
 * مشاركة الشيت مع حساب الخدمة وصحة الرابط قبل تفعيل المزامنة.
 */
export async function testSheetConnection(sheetUrl: string): Promise<SheetTestResult> {
  try {
    await requireOwnerAction();
    const url = sheetUrl.trim();
    const sheetId = extractSheetId(url);
    if (!sheetId) return { ok: false, error: "رابط جوجل شيت غير صالح" };
    const gidMatch = url.match(/[#&]gid=(\d+)/);
    const gid = gidMatch ? Number(gidMatch[1]) : undefined;
    const values = await readSheetValues(sheetId, { gid, endRow: 2 });
    if (values.length === 0) return { ok: false, error: "الشيت فاضي أو التبويب ما فيه بيانات" };
    // أول صفّين، وبحد ٨ أعمدة للعرض.
    return { ok: true, rows: values.slice(0, 2).map((r) => r.slice(0, 8)) };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
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
    return { ok: false, error: toUserError(e) };
  }
}
