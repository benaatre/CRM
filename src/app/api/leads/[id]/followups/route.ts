import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { FollowUpType, FollowUpResult, FollowUpSection, LeadStage, FirstContactStage, ActivityType } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { markContacted } from "@/lib/auto-distribute";
import { shouldHideHistory } from "@/lib/visibility";
import { resultToStage, followUpResultLabels, firstContactStageLabels } from "@/lib/labels";

export const runtime = "nodejs";

function isManager(role: string) {
  return role === "OWNER" || role === "ADMIN";
}

/** يتحقق من جلسة + صلاحية الوصول للعميل (الموظف لعملائه فقط). */
async function authorize(leadId: string) {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: "غير مصرّح" }, { status: 401 }) };
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, assignedToId: true, assignedAt: true, firstContactAt: true, firstContactStage: true, firstContactDate: true } });
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
  const hide = await shouldHideHistory(prisma, a.user.role, { id, lastAssignReason: lastAssign?.reason ?? null });

  const items = await prisma.followUp.findMany({
    where: {
      leadId: id,
      ...(hide && a.lead.assignedAt ? { createdAt: { gt: a.lead.assignedAt } } : {}),
    },
    orderBy: { createdAt: "asc" },
    include: { employee: { select: { name: true } } },
  });
  return NextResponse.json({
    items: items.map((f) => ({
      id: f.id,
      type: f.type,
      result: f.result,
      section: f.section,
      stageAfter: f.stageAfter,
      note: f.note,
      nextDate: f.nextDate,
      createdAt: f.createdAt,
      employeeName: f.employee?.name ?? null,
    })),
  });
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
  // المرحلة المرسلة صراحةً تُقدَّم؛ وإلا تُشتق من النتيجة.
  const newStage = body.stage && body.stage in LeadStage ? (body.stage as LeadStage) : resultToStage[result];
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
    await tx.lead.update({
      where: { id },
      data: {
        stage: newStage,
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
      summary: `متابعة: ${followUpResultLabels[result]}`,
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
