import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * هل على الموظف نداء تحقق نشط (SENT ولم تنقضِ مهلته)؟ — الموظف لنفسه فقط،
 * هويته من الجلسة حصرًا. البطاقة تسأل هذا المسار لعرض بانر «أكّد موقعك».
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false }, { status: 401 });
  if (session.user.role === Role.OWNER) {
    return NextResponse.json({ ok: true, pending: null });
  }

  const now = new Date();
  const pending = await prisma.attendanceVerification.findFirst({
    where: { userId: session.user.id, status: "SENT", deadlineAt: { gt: now } },
    orderBy: { sentAt: "desc" },
  });

  return NextResponse.json({
    ok: true,
    pending: pending
      ? {
          id: pending.id,
          deadlineAtIso: pending.deadlineAt!.toISOString(),
          remainingSeconds: Math.max(0, Math.round((pending.deadlineAt!.getTime() - now.getTime()) / 1000)),
        }
      : null,
  });
}
