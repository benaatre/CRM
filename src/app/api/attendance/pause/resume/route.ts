import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { pauseResumeText } from "@/lib/attendance-notify";
import { notify, ownerIds } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * «رجعت — كمّل دوامي» — يقفل التوقف الجاري ويستأنف العدّاد. الموظف لنفسه فقط.
 * لا قراءة موقع هنا: الرجوع إعلان، ونداءات التحقق العشوائية تعود لتشمله فورًا.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false }, { status: 401 });
  if (session.user.role === Role.OWNER) {
    return NextResponse.json(
      { ok: false, reason: "owner_excluded", message: "المالك خارج نظام البصم" },
      { status: 403 },
    );
  }
  const userId = session.user.id;
  const now = new Date();

  const active = await prisma.attendancePause.findFirst({
    where: { userId, endedAt: null, session: { endedAt: null } },
    orderBy: { startedAt: "desc" },
  });
  if (!active) {
    return NextResponse.json({ ok: false, reason: "not_paused", message: "عدّادك مو موقوف الحين" });
  }

  await prisma.attendancePause.update({ where: { id: active.id }, data: { endedAt: now } });

  const pausedMinutes = Math.max(0, Math.round((now.getTime() - active.startedAt.getTime()) / 60_000));
  try {
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    await notify(
      prisma,
      await ownerIds(prisma),
      "attendance.resumed",
      pauseResumeText(me?.name ?? "موظف", pausedMinutes),
      undefined,
      `/attendance/${userId}`,
    );
  } catch (e) {
    console.error("[attendance] فشل إشعار الرجوع", e);
  }

  return NextResponse.json({ ok: true, pausedMinutes, message: "رجعناك — عدّادك يكمل من جديد" });
}
