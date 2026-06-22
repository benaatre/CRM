import { NextResponse } from "next/server";
import { FollowUpType, FollowUpResult } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { resultToStage, followUpResultLabels } from "@/lib/labels";

export const runtime = "nodejs";

function isManager(role: string) {
  return role === "OWNER" || role === "ADMIN";
}

/** يتحقق من جلسة + صلاحية الوصول للعميل (الموظف لعملائه فقط). */
async function authorize(leadId: string) {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: "غير مصرّح" }, { status: 401 }) };
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, assignedToId: true, firstContactAt: true } });
  if (!lead) return { error: NextResponse.json({ error: "العميل غير موجود" }, { status: 404 }) };
  if (!isManager(session.user.role) && lead.assignedToId !== session.user.id) {
    return { error: NextResponse.json({ error: "ما عندك صلاحية على هذا العميل" }, { status: 403 }) };
  }
  return { user: session.user, lead };
}

// GET /api/leads/[id]/followups — كل متابعات العميل (تصاعدي: الأقدم أولًا).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const a = await authorize(id);
  if (a.error) return a.error;

  const items = await prisma.followUp.findMany({
    where: { leadId: id },
    orderBy: { createdAt: "asc" },
    include: { employee: { select: { name: true } } },
  });
  return NextResponse.json({
    items: items.map((f) => ({
      id: f.id,
      type: f.type,
      result: f.result,
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

  let body: { type?: string; result?: string; note?: string; nextDate?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }

  const type = body.type as FollowUpType;
  const result = body.result as FollowUpResult;
  if (!type || !(type in FollowUpType)) return NextResponse.json({ error: "نوع المتابعة غير صحيح" }, { status: 400 });
  if (!result || !(result in FollowUpResult)) return NextResponse.json({ error: "نتيجة المتابعة غير صحيحة" }, { status: 400 });

  const nextDate = body.nextDate ? new Date(body.nextDate) : null;
  const newStage = resultToStage[result];
  const bumpsAttempt = type === "CALL" || type === "WHATSAPP";

  const created = await prisma.$transaction(async (tx) => {
    const fu = await tx.followUp.create({
      data: { leadId: id, type, result, note: body.note?.trim() || null, nextDate, createdBy: user.id },
      include: { employee: { select: { name: true } } },
    });
    await tx.lead.update({
      where: { id },
      data: {
        stage: newStage,
        lastContact: new Date(),
        firstContactAt: lead.firstContactAt ?? new Date(),
        ...(nextDate ? { nextFollowup: nextDate } : {}),
        ...(bumpsAttempt ? { attempts: { increment: 1 } } : {}),
      },
    });
    await logAudit(tx, {
      userId: user.id, action: "followup.added", entity: "lead", entityId: id,
      summary: `متابعة: ${followUpResultLabels[result]}`,
    });
    return fu;
  });

  return NextResponse.json({
    ok: true,
    followup: {
      id: created.id, type: created.type, result: created.result, note: created.note,
      nextDate: created.nextDate, createdAt: created.createdAt, employeeName: created.employee?.name ?? null,
    },
    newStage,
  });
}
