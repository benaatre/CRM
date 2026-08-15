import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireOwnerApi } from "@/lib/attendance-guard";
import { getAttendanceSettings } from "@/lib/data/attendance";
import { durationArabic } from "@/lib/attendance-notify";
import { notify } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * نداء تحقق يدوي من المالك — يُنشأ `SENT` فورًا بمهلة رد ويُرسل push للموظف.
 * لا تكرار: نداء `SENT` نشط قائم يمنع نداءً جديدًا. ويشترط جلسة دوام مفتوحة —
 * «وين أنت الآن؟» سؤال مداومة، ولغير المداوم بلاطة «لم يسجّل» وإشعاراتها.
 */
export async function POST(req: Request) {
  const guard = await requireOwnerApi();
  if (!guard.ok) return guard.res;

  let raw: { userId?: unknown };
  try {
    raw = (await req.json()) as typeof raw;
  } catch {
    return NextResponse.json({ ok: false, error: "بيانات غير صالحة" }, { status: 400 });
  }
  const userId = typeof raw.userId === "string" ? raw.userId : "";
  const target = userId
    ? await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, active: true } })
    : null;
  if (!target || !target.active || target.role === Role.OWNER) {
    return NextResponse.json({ ok: false, error: "الموظف غير معروف" }, { status: 400 });
  }

  const now = new Date();
  const openSession = await prisma.attendanceSession.findFirst({
    where: { userId, endedAt: null },
    select: { id: true },
  });
  if (!openSession) {
    return NextResponse.json({ ok: false, error: "الموظف مو مداوم الحين — النداء للمداومين" });
  }

  const activeCall = await prisma.attendanceVerification.findFirst({
    where: { userId, status: "SENT", deadlineAt: { gt: now } },
    select: { id: true },
  });
  if (activeCall) {
    return NextResponse.json({ ok: false, error: "عنده نداء نشط قائم — انتظر رده أو انتهاء مهلته" });
  }

  const settings = await getAttendanceSettings();
  const deadlineAt = new Date(now.getTime() + settings.verificationWindowMinutes * 60_000);
  await prisma.attendanceVerification.create({
    data: {
      userId,
      sessionId: openSession.id,
      kind: "MANUAL",
      status: "SENT",
      scheduledAt: now,
      sentAt: now,
      deadlineAt,
    },
  });

  await notify(
    prisma,
    [userId],
    "attendance.verify",
    "نداء تحقق — أكّد موقعك الآن",
    `افتح التطبيق وأكّد موقعك خلال ${durationArabic(settings.verificationWindowMinutes)}`,
    "/m",
  );

  return NextResponse.json({ ok: true, deadlineAtIso: deadlineAt.toISOString() });
}
