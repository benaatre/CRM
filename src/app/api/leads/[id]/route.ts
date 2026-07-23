import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { LeadStage } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { applyStageChange } from "@/lib/stage-change";
import { stageLabels, firstContactStageLabels } from "@/lib/labels";

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

  // م-٢: المسار الموحّد (applyStageChange) — نفس سلوك الدرج بالضبط، وبلا متابعة CALL مصطنعة.
  const { firstContact } = await prisma.$transaction((tx) =>
    applyStageChange(tx, lead, stage, session.user!.id, "من الكانبان"),
  );
  await logAudit(prisma, {
    userId: session.user.id, action: "lead.stage", entity: "lead", entityId: id,
    summary: firstContact
      ? `أول تواصل «${firstContactStageLabels[firstContact]}» (كانبان) · العميل=${id}`
      : `نقل عميل إلى مرحلة «${stageLabels[stage]}» (كانبان) · العميل=${id}`,
  });

  revalidatePath("/leads");
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");
  revalidatePath("/analytics");
  return NextResponse.json({ ok: true });
}
