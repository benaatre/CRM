import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getAttendanceSettings } from "@/lib/data/attendance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * هل على الموظف نداء تحقق نشط (SENT ولم تنقضِ مهلته)؟ — الموظف لنفسه فقط،
 * هويته من الجلسة حصرًا. النافذة الإجبارية تُبنى من هذي الحمولة: نوع النداء
 * (عشوائي/يدوي/وصول)، وهل يملك تمديد الوصول، وهل خيار «غادرت» ظاهر.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false }, { status: 401 });
  if (session.user.role === Role.OWNER) {
    return NextResponse.json({ ok: true, pending: null });
  }

  const now = new Date();
  const [pending, settings] = await Promise.all([
    prisma.attendanceVerification.findFirst({
      where: { userId: session.user.id, status: "SENT", deadlineAt: { gt: now } },
      orderBy: { sentAt: "desc" },
    }),
    getAttendanceSettings(),
  ]);

  if (!pending) return NextResponse.json({ ok: true, pending: null });

  // تمديد الوصول مرة واحدة فقط: نداءان بنفس الأصل يعني التمديد استُهلك.
  let canExtend = false;
  if (pending.kind === "ARRIVAL") {
    const rootId = pending.parentId ?? pending.id;
    const arrivals = await prisma.attendanceVerification.count({
      where: { kind: "ARRIVAL", OR: [{ parentId: rootId }, { id: rootId }] },
    });
    canExtend = arrivals < 2;
  }

  return NextResponse.json({
    ok: true,
    pending: {
      id: pending.id,
      kind: pending.kind,
      deadlineAtIso: pending.deadlineAt!.toISOString(),
      remainingSeconds: Math.max(0, Math.round((pending.deadlineAt!.getTime() - now.getTime()) / 1000)),
      windowSeconds: settings.verificationWindowMinutes * 60,
      canExtend,
    },
  });
}
