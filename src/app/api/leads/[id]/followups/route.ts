import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { FollowUpType, FollowUpResult, FollowUpSection, LeadStage, FirstContactStage, ActivityType } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { markContacted } from "@/lib/auto-distribute";
import { shouldHideHistory } from "@/lib/visibility";
import { resultToStage, followUpResultLabels, firstContactStageLabels, KEEP_STAGE_RESULTS } from "@/lib/labels";

export const runtime = "nodejs";

function isManager(role: string) {
  return role === "OWNER" || role === "ADMIN";
}

/** يتحقق من جلسة + صلاحية الوصول للعميل (الموظف لعملائه فقط). */
async function authorize(leadId: string) {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: "غير مصرّح" }, { status: 401 }) };
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, assignedToId: true, assignedAt: true, stage: true, firstContactAt: true, firstContactStage: true, firstContactDate: true } });
  if (!lead) return { error: NextResponse.json({ error: "العميل غير موجود" }, { status: 404 }) };
  if (!isManager(session.user.role) && lead.assignedToId !== session.user.id) {
    return { error: NextResponse.json({ error: "ما عندك صلاحية على هذا العميل" }, { status: 403 }) };
  }
  return { user: session.user, lead };
}

// GET /api/leads/[id]/followups — متابعات العميل (تصاعدي: الأقدم أولًا).
// الخطوة ٣ب: للموظف مع عميل موزَّع «كجديد» (_fresh): ما قبل آخر إسناد يُحذف من الـpayload.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const a = await authorize(id);
  if (a.error) return a.error;

  const lastAssign = await prisma.reassignment.findFirst({
    where: { leadId: id, toUserId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { reason: true },
  });
  const hide = await shouldHideHistory(prisma, a.user.role, { id, lastAssignReason: lastAssign?.reason ?? null, assignedAt: a.lead.assignedAt });

  const items = await prisma.followUp.findMany({
    where: {
      leadId: id,
      ...(hide && a.lead.assignedAt ? { createdAt: { gt: a.lead.assignedAt } } : {}),
    },
    orderBy: { createdAt: "asc" },
    include: { employee: { select: { name: true } } },
  });
  // وسم «مُعدَّلة»: من سجل التدقيق (followup.edited · entityId=معرّف المتابعة) — استعلام واحد.
  const editedRows = items.length
    ? await prisma.auditLog.findMany({
        where: { action: "followup.edited", entityId: { in: items.map((f) => f.id) } },
        select: { entityId: true },
      })
    : [];
  const editedSet = new Set(editedRows.map((r) => r.entityId));

  const manager = isManager(a.user.role);
  const now = Date.now();
  return NextResponse.json({
    items: items.map((f) => {
      const mine = f.createdBy === a.user.id;
      const withinWindow = now - f.createdAt.getTime() <= EDIT_WINDOW_MS;
      return {
        id: f.id,
        type: f.type,
        result: f.result,
        section: f.section,
        stageAfter: f.stageAfter,
        note: f.note,
        nextDate: f.nextDate,
        createdAt: f.createdAt,
        employeeName: f.employee?.name ?? null,
        edited: editedSet.has(f.id),
        // الصلاحية تُعاد حسابها على الخادم عند PATCH — هذه للعرض فقط.
        canEdit: manager || (mine && withinWindow),
        canEditResult: manager,
      };
    }),
  });
}

// نافذة تعديل الموظف لمتابعته: ٦٠ دقيقة من تسجيلها.
const EDIT_WINDOW_MS = 60 * 60 * 1000;

// PATCH /api/leads/[id]/followups — تعديل متابعة (الجزء ١):
//   الموظف: متابعته هو خلال ساعة — الملاحظة وموعد المتابعة القادم فقط (النتيجة لا تُعدَّل).
//   المالك/المدير: أي متابعة أي وقت شامل النتيجة — وتغيير النتيجة يمر بمسار المرحلة
//   الموحّد نفسه (resultToStage). التعديل لا يمحو الأصل: سجل تدقيق + وسم «مُعدَّلة».
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const a = await authorize(id);
  if (a.error) return a.error;
  const { user } = a;
  const manager = isManager(user.role);

  let body: { followupId?: string; note?: string; nextDate?: string | null; result?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }
  if (!body.followupId) return NextResponse.json({ error: "معرّف المتابعة مفقود" }, { status: 400 });

  const fu = await prisma.followUp.findUnique({
    where: { id: body.followupId },
    select: { id: true, leadId: true, createdBy: true, createdAt: true, result: true },
  });
  if (!fu || fu.leadId !== id) return NextResponse.json({ error: "المتابعة غير موجودة" }, { status: 404 });

  // الصلاحية على الخادم (لا الواجهة): الموظف = متابعته + نافذة ساعة + بلا نتيجة.
  if (!manager) {
    if (fu.createdBy !== user.id) {
      return NextResponse.json({ error: "تعديل المتابعة لصاحبها فقط" }, { status: 403 });
    }
    if (Date.now() - fu.createdAt.getTime() > EDIT_WINDOW_MS) {
      return NextResponse.json({ error: "مهلة التعديل انتهت (ساعة من التسجيل) — سجّل متابعة جديدة" }, { status: 403 });
    }
    if (body.result !== undefined) {
      return NextResponse.json({ error: "النتيجة ما تتعدل — تغييرها يغيّر المرحلة، سجّل متابعة جديدة" }, { status: 403 });
    }
  }

  let nextDate: Date | null | undefined = undefined;
  if (body.nextDate !== undefined) {
    if (body.nextDate === null || body.nextDate === "") nextDate = null;
    else {
      nextDate = new Date(body.nextDate);
      if (Number.isNaN(nextDate.getTime())) return NextResponse.json({ error: "تاريخ المتابعة غير صحيح" }, { status: 400 });
    }
  }
  const newResult = body.result !== undefined && body.result in FollowUpResult ? (body.result as FollowUpResult) : undefined;
  if (body.result !== undefined && !newResult) return NextResponse.json({ error: "نتيجة المتابعة غير صحيحة" }, { status: 400 });
  const resultChanged = !!newResult && newResult !== fu.result;
  // تغيير النتيجة يمر بالمسار الموحّد: المرحلة الجديدة من resultToStage.
  const newStage = resultChanged ? resultToStage[newResult!] : undefined;

  await prisma.$transaction(async (tx) => {
    await tx.followUp.update({
      where: { id: fu.id },
      data: {
        ...(body.note !== undefined ? { note: body.note.trim() || null } : {}),
        ...(nextDate !== undefined ? { nextDate } : {}),
        ...(resultChanged ? { result: newResult, stageAfter: newStage } : {}),
      },
    });
    if (nextDate !== undefined || resultChanged) {
      await tx.lead.update({
        where: { id },
        data: {
          ...(nextDate !== undefined ? { nextFollowup: nextDate } : {}),
          ...(resultChanged ? { stage: newStage } : {}),
        },
      });
    }
    // التعديل لا يمحو الأصل — سجل تدقيق بنمط المعرّفات (العميل=cuid يصير اسمًا رابطًا في v2).
    await logAudit(tx, {
      userId: user.id,
      action: "followup.edited",
      entity: "followup",
      entityId: fu.id,
      summary: `عدّل متابعة${resultChanged ? ` (النتيجة ← ${followUpResultLabels[newResult!]})` : ""} · العميل=${id}`,
    });
  });

  revalidatePath("/leads");
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");
  return NextResponse.json({ ok: true });
}

// POST /api/leads/[id]/followups — إضافة متابعة + تحديث مرحلة العميل تلقائيًا.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const a = await authorize(id);
  if (a.error) return a.error;
  const { user, lead } = a;

  let body: { type?: string; result?: string; section?: string; stage?: string; note?: string; nextDate?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }

  const type = body.type as FollowUpType;
  const result = body.result as FollowUpResult;
  if (!type || !(type in FollowUpType)) return NextResponse.json({ error: "نوع المتابعة غير صحيح" }, { status: 400 });
  if (!result || !(result in FollowUpResult)) return NextResponse.json({ error: "نتيجة المتابعة غير صحيحة" }, { status: 400 });

  const section = body.section && body.section in FollowUpSection ? (body.section as FollowUpSection) : null;
  // #32: تاريخ غير صالح يُرفض برسالة عربية بدل خطأ Prisma خام.
  let nextDate: Date | null = null;
  if (body.nextDate) {
    nextDate = new Date(body.nextDate);
    if (Number.isNaN(nextDate.getTime())) return NextResponse.json({ error: "تاريخ المتابعة غير صحيح" }, { status: 400 });
  }
  // نتائج «بلا تغيير مرحلة» (لم يستجب/حسبة البنك/في الانتظار): المرحلة تثبت على الخادم مهما أُرسل —
  // فلا تُحرَّك المرحلة ولا يدخل العميل نظام «لم يتم الرد» (نتيجتها ليست NOT_ANSWERED_*).
  // غير ذلك: المرحلة المرسلة صراحةً تُقدَّم؛ وإلا تُشتق من النتيجة.
  const newStage = KEEP_STAGE_RESULTS.includes(result)
    ? lead.stage
    : body.stage && body.stage in LeadStage ? (body.stage as LeadStage) : resultToStage[result];
  const bumpsAttempt = type === "CALL" || type === "WHATSAPP";

  // المرحلة الأولى تُحدَّد مرة واحدة من أول متابعة (حسب قسمها).
  const sectionToFirst: Record<FollowUpSection, FirstContactStage> = {
    INTERESTED: FirstContactStage.INTERESTED,
    NO_ANSWER: FirstContactStage.NO_ANSWER,
    NOT_INTERESTED: FirstContactStage.NOT_INTERESTED,
  };
  const firstStage = !lead.firstContactStage && section ? sectionToFirst[section] : null;

  const created = await prisma.$transaction(async (tx) => {
    const fu = await tx.followUp.create({
      data: { leadId: id, type, result, section, stageAfter: newStage, note: body.note?.trim() || null, nextDate, createdBy: user.id },
      include: { employee: { select: { name: true } } },
    });
    // أرشفة تلقائية: «غير مهتم بالعقارات نهائيًا» أو «مسوّق» → يُؤرشف مع الإغلاق مباشرة.
    // ⚠️ الانتساب يبقى (assignedToId لا يُمسح) — نحتاج نعرف عملاء مين في الأرشيف.
    const autoArchive = newStage === LeadStage.CLOSED_LOST
      && (result === "NOT_INTERESTED_FINAL" || result === "NOT_INTERESTED_MARKETER");
    await tx.lead.update({
      where: { id },
      data: {
        stage: newStage,
        ...(autoArchive ? { isArchived: true } : {}),
        lastContact: new Date(),
        // أول تواصل: الوقت والتاريخ يُحفظان مرة واحدة فقط (عند أول متابعة).
        firstContactAt: lead.firstContactAt ?? new Date(),
        firstContactDate: lead.firstContactDate ?? new Date(),
        // المرحلة الأولى تُحدَّد مرة واحدة من قسم أول متابعة.
        ...(firstStage ? { firstContactStage: firstStage } : {}),
        ...(nextDate ? { nextFollowup: nextDate } : {}),
        ...(bumpsAttempt ? { attempts: { increment: 1 } } : {}),
      },
    });
    // سجل أول تواصل في الـTimeline (Activity) — مع اسم الموظف والوقت تلقائيًا.
    if (firstStage) {
      await tx.activity.create({
        data: { leadId: id, userId: user.id, type: ActivityType.NOTE, note: `تم تسجيل أول تواصل: ${firstContactStageLabels[firstStage]}` },
      });
    }
    // #20: أي متابعة مسجّلة = تعامل فعلي مع العميل → توقف عدّاد إعادة التوجيه.
    // (عدّاد المحاولات attempts يبقى للمكالمات/واتساب فقط عبر bumpsAttempt أعلاه.)
    await markContacted(tx, id);
    await logAudit(tx, {
      userId: user.id, action: "followup.added", entity: "lead", entityId: id,
      // معرّف العميل داخل النص — يلتقطه resolveAuditNames فيتحوّل لاسم رابط في سجل التدقيق v2.
      summary: `متابعة: ${followUpResultLabels[result]} · العميل=${id}`,
    });
    return fu;
  });

  // المتابعة تغيّر المرحلة → ينعكس في الجدول والكانبان ولوحة التحكم.
  revalidatePath("/leads");
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");
  revalidatePath("/analytics");

  return NextResponse.json({
    ok: true,
    followup: {
      id: created.id, type: created.type, result: created.result, note: created.note,
      nextDate: created.nextDate, createdAt: created.createdAt, employeeName: created.employee?.name ?? null,
    },
    newStage,
  });
}
