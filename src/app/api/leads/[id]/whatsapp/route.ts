import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { FollowUpType, FollowUpResult, ActivityType } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { markContacted } from "@/lib/auto-distribute";

export const runtime = "nodejs";

function isManager(role: string) {
  return role === "OWNER" || role === "ADMIN";
}

// POST /api/leads/[id]/whatsapp — يُسجّل ضغط زر «إرسال واتساب» كمتابعة WHATSAPP
// ويوقف عدّاد إعادة التوجيه التلقائي.
// م-٢: إرسال واتساب لعميل «جديد» يحرّكه لمرحلة «محاولة» — كان يترك العميل في
// «ينتظر أول تواصل» بالداشبورد بينما لوحة التوزيع تعدّه «تم التواصل» (نفس مرض «لم يتم الرد»).
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const lead = await prisma.lead.findUnique({
    where: { id },
    select: { id: true, assignedToId: true, stage: true, firstContactAt: true, firstContactDate: true },
  });
  if (!lead) return NextResponse.json({ error: "العميل غير موجود" }, { status: 404 });
  if (!isManager(session.user.role) && lead.assignedToId !== session.user.id) {
    return NextResponse.json({ error: "ما عندك صلاحية على هذا العميل" }, { status: 403 });
  }

  // تجنّب التكرار من النقرات المتعدّدة: تخطَّ لو فيه متابعة واتساب خلال آخر دقيقة.
  const recent = await prisma.followUp.findFirst({
    where: { leadId: id, type: FollowUpType.WHATSAPP, createdAt: { gte: new Date(Date.now() - 60_000) } },
    select: { id: true },
  });

  const now = new Date();
  // «جديد» → «محاولة» (يطابق resultToStage لنتيجة NOT_ANSWERED_WHATSAPP).
  const nextStage = lead.stage === "NEW" ? "ATTEMPTED" : lead.stage;
  await prisma.$transaction(async (tx) => {
    if (!recent) {
      await tx.followUp.create({
        data: {
          leadId: id,
          type: FollowUpType.WHATSAPP,
          result: FollowUpResult.NOT_ANSWERED_WHATSAPP,
          stageAfter: nextStage,
          note: "أُرسل واتساب",
          nextDate: null,
          createdBy: session.user.id,
        },
      });
      await tx.activity.create({
        data: { leadId: id, userId: session.user.id, type: ActivityType.WHATSAPP, note: "أُرسل واتساب" },
      });
    }
    await tx.lead.update({
      where: { id },
      data: {
        ...(nextStage !== lead.stage ? { stage: nextStage } : {}),
        lastContact: now,
        firstContactAt: lead.firstContactAt ?? now,
        firstContactDate: lead.firstContactDate ?? now,
        ...(recent ? {} : { attempts: { increment: 1 } }),
      },
    });
    // يوقف عدّاد إعادة التوجيه التلقائي.
    await markContacted(tx, id, now);
  });

  revalidatePath("/leads");
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");
  return NextResponse.json({ ok: true, logged: !recent });
}
