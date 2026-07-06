import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { LeadStage, ActivityType, FirstContactStage, FollowUpType, FollowUpResult, FollowUpSection } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { markContacted } from "@/lib/auto-distribute";
import { stageLabels, firstContactStageLabels } from "@/lib/labels";

// سحب العميل في الكانبان لإحدى مراحل «أول تواصل» الثلاث → يحدّد المرحلة الأولى تلقائيًا.
const STAGE_TO_FIRST: Partial<Record<LeadStage, { fc: FirstContactStage; result: FollowUpResult; section: FollowUpSection }>> = {
  INTERESTED: { fc: FirstContactStage.INTERESTED, result: FollowUpResult.INTERESTED_SENT_INFO, section: FollowUpSection.INTERESTED },
  ATTEMPTED: { fc: FirstContactStage.NO_ANSWER, result: FollowUpResult.NOT_ANSWERED_SCHEDULED, section: FollowUpSection.NO_ANSWER },
  CLOSED_LOST: { fc: FirstContactStage.NOT_INTERESTED, result: FollowUpResult.NOT_INTERESTED_FINAL, section: FollowUpSection.NOT_INTERESTED },
};

export const runtime = "nodejs";

function isManager(role: string) {
  return role === "OWNER" || role === "ADMIN";
}

/**
 * PATCH /api/leads/[id] — تحديث مرحلة العميل (السحب في الكانبان).
 * الصلاحيات على الخادم: الموظف يعدّل عملاءه فقط؛ المدير/المالك الكل.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const { id } = await ctx.params;
  const lead = await prisma.lead.findUnique({
    where: { id },
    select: { id: true, assignedToId: true, stage: true, firstContactStage: true, firstContactDate: true, firstContactAt: true },
  });
  if (!lead) return NextResponse.json({ error: "العميل غير موجود" }, { status: 404 });
  if (!isManager(session.user.role) && lead.assignedToId !== session.user.id) {
    return NextResponse.json({ error: "ما عندك صلاحية على هذا العميل" }, { status: 403 });
  }

  let body: { stage?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }

  const stage = body.stage as LeadStage;
  if (!stage || !(stage in LeadStage)) {
    return NextResponse.json({ error: "مرحلة غير صحيحة" }, { status: 400 });
  }
  if (lead.stage === stage) return NextResponse.json({ ok: true });
  // «غير مهتم» لا يُقبل كتحويل مرحلة مباشر — المسار الشرعي الوحيد عبر POST /followups بسبب منظّم.
  if (stage === "CLOSED_LOST") {
    return NextResponse.json({ error: "تحويل «غير مهتم» لازم يكون مع سبب — استخدم نتيجة المتابعة." }, { status: 400 });
  }

  // أول تواصل تلقائيًا: لو ما تحدّدت المرحلة الأولى وسُحب لإحدى المراحل الثلاث.
  const fc = !lead.firstContactStage ? STAGE_TO_FIRST[stage] : undefined;

  await prisma.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id },
      data: {
        stage,
        lastContact: new Date(),
        ...(fc ? {
          firstContactStage: fc.fc,
          firstContactDate: lead.firstContactDate ?? new Date(),
          firstContactAt: lead.firstContactAt ?? new Date(),
        } : {}),
      },
    });
    await tx.activity.create({
      data: {
        leadId: id, userId: session.user!.id, type: ActivityType.STAGE_CHANGE,
        note: fc ? `تم تسجيل أول تواصل: ${firstContactStageLabels[fc.fc]}` : `نُقل إلى «${stageLabels[stage]}» من الكانبان`,
      },
    });
    // أول تواصل من الكانبان → سجل في الـTimeline (followUpsCount + 1).
    if (fc) {
      await tx.followUp.create({
        data: {
          leadId: id, createdBy: session.user!.id, type: FollowUpType.CALL,
          result: fc.result, section: fc.section, stageAfter: stage,
          note: `تم تسجيل أول تواصل: ${firstContactStageLabels[fc.fc]} (من الكانبان)`,
        },
      });
    }
    // أي نقل مرحلة بالسحب = مبادرة/محاولة تواصل → يوقف عدّاد إعادة التوجيه (يضبط contactedAt إن كان null).
    await markContacted(tx, id);
  });
  await logAudit(prisma, {
    userId: session.user.id, action: "lead.stage", entity: "lead", entityId: id,
    summary: fc ? `أول تواصل «${firstContactStageLabels[fc.fc]}» (كانبان)` : `نقل عميل إلى مرحلة «${stageLabels[stage]}» (كانبان)`,
  });

  revalidatePath("/leads");
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");
  revalidatePath("/analytics");
  return NextResponse.json({ ok: true });
}
