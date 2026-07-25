"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toUserError } from "@/lib/action-error";
import { requireManagerAction, requireUser } from "@/lib/auth-guards";
import { logAudit } from "@/lib/audit";
import { getSourcesList, type SourceListItem } from "@/lib/data/sources";
import { readSheetValues, resolveTabByGid } from "@/lib/google-sheets";
import { extractSheetId, extractGid, withGid } from "@/lib/utils/sheet";
import { FULL_SYNC_APPROVED } from "@/lib/sheet-sync-google";

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

/** يحلّ gid الورقة من الرابط أو من حقل «رقم الورقة» — null = ما تحددت ورقة. */
function resolveGidInput(url: string, gidInput?: string): number | null {
  const fromUrl = extractGid(url);
  if (fromUrl != null) return fromUrl;
  const g = (gidInput ?? "").trim();
  return /^\d+$/.test(g) ? Number(g) : null;
}

const GID_HELP = "افتح الورقة المطلوبة في المتصفح وانسخ الرقم بعد gid= من شريط العنوان";

/**
 * إضافة مصدر بشيته دفعة واحدة (المالك فقط): اسم المصدر + رابط الشيت + الورقة (gid).
 * ⛔ إصلاح حادثة 2026-07-25: الورقة إلزامية — الرابط يُخزَّن دائمًا بـ#gid= مثبّت،
 * فلا تسقط المزامنة أبدًا على الورقة الأولى/المستند كله.
 */
export async function addSheetSource(name: string, sheetUrl: string, gidInput?: string): Promise<ActionResult> {
  try {
    const user = await requireOwnerAction();
    const clean = name.trim();
    const url = sheetUrl.trim();
    if (!clean) return { ok: false, error: "اكتب اسم المصدر" };
    if (!url) return { ok: false, error: "الصق رابط جوجل شيت" };
    const sheetId = extractSheetId(url);
    if (!sheetId) return { ok: false, error: "رابط جوجل شيت غير صالح" };
    const gid = resolveGidInput(url, gidInput);
    if (gid == null) return { ok: false, error: `حدد الورقة: ${GID_HELP} — أو الصق رابطًا يحوي ‎#gid=‎` };
    // تحقق مبكر أن الورقة موجودة فعلًا (يرمي خطأً عربيًا بأسماء الأوراق المتاحة).
    await resolveTabByGid(sheetId, gid);
    const storedUrl = withGid(url, gid);

    const source = await prisma.leadSource.upsert({
      where: { name: clean },
      update: {},
      create: { name: clean },
    });
    const dup = await prisma.sheetLink.findFirst({ where: { sheetId, sourceId: source.id }, select: { id: true } });
    if (dup) return { ok: false, error: "هذا الشيت مضاف مسبقًا لنفس المصدر" };

    await prisma.sheetLink.create({ data: { sheetUrl: storedUrl, sheetId, sourceId: source.id } });
    await logAudit(prisma, { userId: user.id, action: "sheetlink.created", entity: "sheetlink", summary: `أضاف مصدر عملاء «${clean}» بشيت مزامنة (gid=${gid})` });
    revalidateSources();
    return { ok: true, message: `أُضيف مصدر «${clean}» (الورقة gid=${gid}) — المزامنة بتلقطه بالدورة الجاية` };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

export type SheetTestResult = {
  ok: boolean;
  error?: string;
  /** اسم الورقة المستهدفة — يتأكد المالك أنها الورقة الصح قبل التفعيل. */
  tabTitle?: string;
  /** عدد صفوف البيانات الكلي (بلا صف العناوين). */
  totalRows?: number;
  rows?: string[][];
};

/**
 * «جرّب الاتصال» (المالك فقط): يقرأ الورقة المحددة بالـgid حصريًا ويعرض اسمها +
 * أول صفوفها + عدد الصفوف الكلي — يتأكد المالك أنها الورقة الصح قبل التفعيل.
 */
export async function testSheetConnection(sheetUrl: string, gidInput?: string): Promise<SheetTestResult> {
  try {
    await requireOwnerAction();
    const url = sheetUrl.trim();
    const sheetId = extractSheetId(url);
    if (!sheetId) return { ok: false, error: "رابط جوجل شيت غير صالح" };
    const gid = resolveGidInput(url, gidInput);
    if (gid == null) return { ok: false, error: `حدد الورقة: ${GID_HELP}` };
    const tab = await resolveTabByGid(sheetId, gid); // يرمي لو الورقة غير موجودة — لا سقوط على الأولى
    const values = await readSheetValues(sheetId, { tab: tab.title });
    if (values.length === 0) return { ok: false, error: `الورقة «${tab.title}» فاضية` };
    // العناوين + أول صفّين بيانات، وبحد ٨ أعمدة للعرض + العدد الكلي.
    return {
      ok: true,
      tabTitle: tab.title,
      totalRows: Math.max(0, values.length - 1),
      rows: values.slice(0, 3).map((r) => r.slice(0, 8)),
    };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/**
 * قرار المالك لمصدر جديد بشيت مليان (حد أمان أول مزامنة):
 * «زامن الكل» — موافقة صريحة على إدخال الشيت كاملًا (المؤشر = FULL_SYNC_APPROVED).
 */
export async function approveFullSync(linkId: string): Promise<ActionResult> {
  try {
    const user = await requireOwnerAction();
    const link = await prisma.sheetLink.findUnique({ where: { id: linkId }, select: { id: true, lastRowSynced: true, source: { select: { name: true } } } });
    if (!link) return { ok: false, error: "الرابط غير موجود" };
    if (link.lastRowSynced > 0) return { ok: false, error: "المصدر بدأ المزامنة فعلًا — القرار ما عاد لازمًا" };
    await prisma.sheetLink.update({
      where: { id: linkId },
      data: { lastRowSynced: FULL_SYNC_APPROVED, lastSyncStatus: null, lastSyncError: null },
    });
    await logAudit(prisma, { userId: user.id, action: "sheetlink.fullSyncApproved", entity: "sheetlink", entityId: linkId, summary: `وافق على مزامنة شيت «${link.source?.name ?? "؟"}» كاملًا من البداية` });
    revalidateSources();
    return { ok: true, message: "تمت الموافقة — الدورة الجاية تبدأ الإدخال من أول الشيت (دفعات ٥٠)" };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

export type StartLastTwoDaysResult = ActionResult & {
  /** الورقة بلا عمود تاريخ مكتشَف — الواجهة تسأل «كم صفًا أخيرًا تريد التقاطه؟» وتعيد النداء بـ count. */
  needCount?: boolean;
  totalRows?: number;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{1,2}:\d{2})?/;

/**
 * الخيار الثالث «آخر يومين ثم لايف»: يلتقط صفوف آخر ٤٨ ساعة فقط بالفلترة على عمود التاريخ
 * (ISO timestamps — يُكتشف تلقائيًا)، بضبط المؤشر على أول صف حديث — فتمر الدفعة بكامل المسار
 * القياسي (الحقول الستة ← المكررات ← التوزيع) بدفعات ٥٠ كل دورة، ثم تكمل المزامنة لايف طبيعيًا.
 * بلا عمود تاريخ: يرجع needCount والمالك يحدد كم صفًا أخيرًا (count).
 * حد أمان أول مزامنة لا يعترض هذا الخيار — لو المؤشر المحسوب صفرًا يُضبط على موافقة «زامن الكل».
 */
export async function startSyncLastTwoDays(linkId: string, count?: number): Promise<StartLastTwoDaysResult> {
  try {
    const user = await requireOwnerAction();
    const link = await prisma.sheetLink.findUnique({ where: { id: linkId }, select: { id: true, sheetId: true, sheetUrl: true, lastRowSynced: true, source: { select: { name: true } } } });
    if (!link) return { ok: false, error: "الرابط غير موجود" };
    if (link.lastRowSynced > 0) return { ok: false, error: "المصدر بدأ المزامنة فعلًا — القرار ما عاد لازمًا" };
    const gid = extractGid(link.sheetUrl);
    if (gid == null) return { ok: false, error: `رابط المصدر بلا gid — ${GID_HELP} ثم حدّث المصدر` };
    const tab = await resolveTabByGid(link.sheetId, gid);
    const values = await readSheetValues(link.sheetId, { tab: tab.title });
    const data = values.slice(1); // بلا صف العناوين
    const totalRows = data.length;

    // اكتشاف عمود التاريخ: العمود الذي أغلب قيمه غير الفارغة ISO timestamps (عينة أول ٥٠ صفًا).
    let dateCol = -1;
    const sample = data.slice(0, 50);
    const width = Math.max(0, ...sample.map((r) => r.length));
    for (let c = 0; c < width; c++) {
      const cells = sample.map((r) => String(r[c] ?? "").trim()).filter(Boolean);
      if (cells.length >= 3 && cells.filter((v) => ISO_DATE_RE.test(v)).length / cells.length >= 0.5) { dateCol = c; break; }
    }

    let pointer: number;
    let how: string;
    if (dateCol >= 0) {
      // أول صف تاريخه داخل آخر ٤٨ ساعة (الصفوف مضافة زمنيًا) — ما قبله يُتجاهل.
      const cutoff = Date.now() - 48 * 3_600_000;
      let firstRecent = totalRows; // لا صفوف حديثة → لايف من الآن
      for (let i = 0; i < data.length; i++) {
        const t = Date.parse(String(data[i][dateCol] ?? "").trim());
        if (!Number.isNaN(t) && t >= cutoff) { firstRecent = i; break; }
      }
      pointer = firstRecent;
      how = `عمود التاريخ (العمود ${dateCol + 1}) — ${totalRows - pointer} صفًا من آخر يومين`;
    } else if (count != null && Number.isFinite(count) && count >= 0) {
      pointer = Math.max(0, totalRows - Math.floor(count));
      how = `آخر ${totalRows - pointer} صفًا (بلا عمود تاريخ — عدد يدوي)`;
    } else {
      // بلا عمود تاريخ ولا عدد — الواجهة تعرض سؤال «كم صفًا أخيرًا؟».
      return { ok: false, needCount: true, totalRows, error: "الورقة بلا عمود تاريخ مكتشَف — حدد كم صفًا أخيرًا تريد التقاطه" };
    }

    await prisma.sheetLink.update({
      where: { id: linkId },
      // مؤشر 0 = كل الشيت حديث → موافقة «زامن الكل» حتى لا يعترضه حد أمان أول مزامنة.
      data: { lastRowSynced: pointer === 0 ? FULL_SYNC_APPROVED : pointer, lastSyncAt: new Date(), lastSyncStatus: "success", lastSyncError: null },
    });
    await logAudit(prisma, { userId: user.id, action: "sheetlink.startedLastTwoDays", entity: "sheetlink", entityId: linkId, summary: `فعّل «آخر يومين ثم لايف» لشيت «${link.source?.name ?? "؟"}» — ${how}` });
    revalidateSources();
    const picked = totalRows - pointer;
    return { ok: true, message: picked > 0 ? `تم — ${picked} صفًا حديثًا سيدخلون بدفعات ٥٠ كل دورة، ثم لايف طبيعيًا` : "تم — ما فيه صفوف حديثة؛ المزامنة لايف من الآن" };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/**
 * «ابدأ من الآن فقط»: المؤشر = آخر صف حالي — القديم يُتجاهل نهائيًا والجديد فقط من هنا وطالع.
 * (يمنع تكرار حادثة الإغراق نهائيًا للمصادر ذات الأرشيف الكبير.)
 */
export async function startSyncFromNow(linkId: string): Promise<ActionResult> {
  try {
    const user = await requireOwnerAction();
    const link = await prisma.sheetLink.findUnique({ where: { id: linkId }, select: { id: true, sheetId: true, sheetUrl: true, lastRowSynced: true, source: { select: { name: true } } } });
    if (!link) return { ok: false, error: "الرابط غير موجود" };
    if (link.lastRowSynced > 0) return { ok: false, error: "المصدر بدأ المزامنة فعلًا — القرار ما عاد لازمًا" };
    const gid = extractGid(link.sheetUrl);
    if (gid == null) return { ok: false, error: `رابط المصدر بلا gid — ${GID_HELP} ثم حدّث المصدر` };
    const tab = await resolveTabByGid(link.sheetId, gid);
    const values = await readSheetValues(link.sheetId, { tab: tab.title });
    const totalRows = Math.max(0, values.length - 1);
    await prisma.sheetLink.update({
      where: { id: linkId },
      data: { lastRowSynced: totalRows, lastSyncAt: new Date(), lastSyncStatus: "success", lastSyncError: null },
    });
    await logAudit(prisma, { userId: user.id, action: "sheetlink.startedFromNow", entity: "sheetlink", entityId: linkId, summary: `بدأ مزامنة «${link.source?.name ?? "؟"}» من الآن فقط (تجاهل ${totalRows} صفًا قديمًا)` });
    revalidateSources();
    return { ok: true, message: `تم — المؤشر وقف على ${totalRows}؛ الجديد فقط من هنا وطالع` };
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
