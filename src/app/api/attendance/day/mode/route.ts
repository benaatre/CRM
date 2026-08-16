import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ksaDayKey, KSA_OFFSET_MS, weekStartKSA } from "@/lib/ksa-time";
import { formatTime } from "@/lib/format";
import { dayDateOf, getAttendanceSettings } from "@/lib/data/attendance";
import { notify, ownerIds } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * بداية يوم «عن بُعد» — الموظف يختار جهة الإذن ويضغط زرًا واحدًا، وبعدها لا
 * يتعامل مع البطاقة إطلاقًا: لا عدّاد ولا نداءات ولا فحص موقع، ولا يُحتسب
 * غيابًا. اليوم ينتهي تلقائيًا مع نهاية نافذة الشركة.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false }, { status: 401 });
  if (session.user.role === Role.OWNER) {
    return NextResponse.json(
      { ok: false, message: "المالك خارج نظام البصم" },
      { status: 403 },
    );
  }
  const userId = session.user.id;

  let raw: { authorizerId?: unknown };
  try {
    raw = (await req.json()) as typeof raw;
  } catch {
    return NextResponse.json({ ok: false, message: "بيانات غير صالحة" }, { status: 400 });
  }

  const authorizerId = typeof raw.authorizerId === "string" ? raw.authorizerId : "";
  const authorizer = authorizerId
    ? await prisma.attendanceAuthorizer.findUnique({ where: { id: authorizerId } })
    : null;
  if (!authorizer || !authorizer.isActive) {
    return NextResponse.json({ ok: false, message: "اختر جهة الإذن" });
  }

  const now = new Date();
  const todayKey = ksaDayKey(now);

  // بصمة قائمة أو جلسة مفتوحة تعني يومًا موقعيًا بدأ فعلًا — لا انقلاب عن بُعد.
  const [openSession, existing] = await Promise.all([
    prisma.attendanceSession.findFirst({ where: { userId, endedAt: null }, select: { id: true } }),
    prisma.attendanceDay.findUnique({ where: { userId_date: { userId, date: dayDateOf(todayKey) } } }),
  ]);
  if (openSession || existing?.firstCheckInAt) {
    return NextResponse.json({ ok: false, message: "بدأت دوامك في الموقع اليوم — ما يتبدل عن بُعد" });
  }
  if (existing?.mode === "LEAVE") {
    return NextResponse.json({ ok: false, message: "يومك مسجّل إجازة" });
  }
  if (existing?.mode === "REMOTE") {
    return NextResponse.json({ ok: false, message: "يومك مسجّل عن بُعد أصلًا" });
  }

  // سقف «عن بُعد» الأسبوعي (0 = بلا حد) — أيام REMOTE من بداية أسبوع الرياض.
  const settings = await getAttendanceSettings();
  if (settings.remoteWeeklyCap > 0) {
    const weekStartKey = ksaDayKey(new Date(weekStartKSA(now).getTime() + KSA_OFFSET_MS));
    const used = await prisma.attendanceDay.count({
      where: { userId, mode: "REMOTE", date: { gte: dayDateOf(weekStartKey) } },
    });
    if (used >= settings.remoteWeeklyCap) {
      return NextResponse.json({
        ok: false,
        message: `وصلت حد «عن بُعد» الأسبوعي (${settings.remoteWeeklyCap} أيام)`,
      });
    }
  }

  const day = await prisma.attendanceDay.upsert({
    where: { userId_date: { userId, date: dayDateOf(todayKey) } },
    update: { mode: "REMOTE", remoteAuthorizerId: authorizer.id, remoteAuthorizerLabel: authorizer.label },
    create: {
      userId,
      date: dayDateOf(todayKey),
      mode: "REMOTE",
      remoteAuthorizerId: authorizer.id,
      remoteAuthorizerLabel: authorizer.label,
    },
  });

  try {
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    await notify(
      prisma,
      await ownerIds(prisma),
      "attendance.remote_day",
      `سجّل ${me?.name ?? "موظف"} يوم «عن بُعد» بإذن ${authorizer.label} الساعة ${formatTime(now)}`,
      undefined,
      `/attendance/${userId}`,
    );
  } catch (e) {
    console.error("[attendance] فشل إشعار يوم عن بُعد", e);
  }

  return NextResponse.json({
    ok: true,
    day: { mode: day.mode, remoteAuthorizerLabel: day.remoteAuthorizerLabel, startedText: formatTime(now) },
  });
}
