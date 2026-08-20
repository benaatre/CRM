import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwnerApi } from "@/lib/attendance-guard";
import { ksaDayKey, ksaDayOfWeek, ksaMinutesOfDay, parseRiyadhLocal } from "@/lib/ksa-time";
import { effectiveDay, isLateCheckIn } from "@/lib/attendance-logic";
import { ensureAttendanceDay, getAttendanceSettings } from "@/lib/data/attendance";
import { mergeConfig } from "@/lib/attendance-config";
import { recordAuditEvent } from "@/lib/audit-event";
import { notify } from "@/lib/notify";
import { formatTime } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * حضور بالنيابة (ملف الموظف الحي) — المالك فقط، بنفس فلسفة أدوات الإصلاح:
 * سبب إلزامي + تدقيق MANUAL_CHECKIN + خيار إشعار الموظف أو الصمت.
 * الحدث بمصدر OWNER وإحداثيات صفرية (بلا مطابقة نطاق — البصمة قرار مالك).
 * الوقت: الآن أو مخصص (يُفسَّر رياضًا) داخل اليوم الحالي وقبل الآن.
 */
export async function POST(req: Request) {
  const guard = await requireOwnerApi();
  if (!guard.ok) return guard.res;

  let raw: { userId?: unknown; atIso?: unknown; reason?: unknown; notify?: unknown };
  try {
    raw = (await req.json()) as typeof raw;
  } catch {
    return NextResponse.json({ ok: false, error: "بيانات غير صالحة" }, { status: 400 });
  }
  const userId = typeof raw.userId === "string" ? raw.userId : "";
  const reason = typeof raw.reason === "string" ? raw.reason.trim().slice(0, 500) : "";
  if (!userId) return NextResponse.json({ ok: false, error: "حدّد الموظف" }, { status: 400 });
  // السبب اختياري (قرار 2026-08-20) — التدقيق يسجّل المنفذ دائمًا والسبب إن كُتب.

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, name: true, active: true } });
  if (!user || user.role === "OWNER") return NextResponse.json({ ok: false, error: "الموظف غير موجود" }, { status: 404 });

  const now = new Date();
  let at = now;
  if (typeof raw.atIso === "string" && raw.atIso) {
    at = parseRiyadhLocal(raw.atIso);
    if (Number.isNaN(at.getTime())) return NextResponse.json({ ok: false, error: "الوقت غير صحيح" }, { status: 400 });
  }
  const todayKey = ksaDayKey(now);
  if (ksaDayKey(at) !== todayKey || at.getTime() > now.getTime()) {
    return NextResponse.json({ ok: false, error: "الوقت لازم يكون داخل اليوم الحالي وقبل الآن" }, { status: 400 });
  }

  const open = await prisma.attendanceSession.findFirst({ where: { userId, endedAt: null }, select: { id: true } });
  if (open) return NextResponse.json({ ok: false, error: "عنده جلسة مفتوحة أصلًا" }, { status: 409 });

  const [settings, schedule, exceptions] = await Promise.all([
    getAttendanceSettings(),
    prisma.attendanceSchedule.findUnique({ where: { userId } }),
    prisma.attendanceException.findMany({
      where: { userId, dateFrom: { lte: new Date(`${todayKey}T00:00:00Z`) }, dateTo: { gte: new Date(`${todayKey}T00:00:00Z`) } },
    }),
  ]);
  const config = mergeConfig(settings, schedule, now);
  const eff = effectiveDay(schedule, exceptions, todayKey, ksaDayOfWeek(at), config.weekendSet);
  if (eff.onLeave) return NextResponse.json({ ok: false, error: "عنده إجازة اليوم — ما فيه تسجيل حضور" }, { status: 409 });

  const isLate = config.enforced && isLateCheckIn(ksaMinutesOfDay(at), eff, settings.lateThresholdMinutes);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  const sessionId = await prisma.$transaction(async (tx) => {
    const day = await ensureAttendanceDay(tx, userId, todayKey);
    if (day.mode !== "ONSITE") throw new Error("يومه مسجّل «عن بُعد/إجازة» — ما فيه حضور موقعي");
    if (day.lockedAt) throw new Error("يومه مقفول — دوامه يبدأ بكرة");

    const event = await tx.attendanceEvent.create({
      data: {
        userId,
        locationId: null,
        type: "CHECK_IN",
        timestamp: at,
        lat: 0, lng: 0, accuracy: 0, distanceMeters: 0,
        source: "OWNER",
        isMock: false,
        outOfZone: false,
        isLate,
      },
    });
    const session = await tx.attendanceSession.create({
      data: { userId, dayId: day.id, checkInEventId: event.id, startedAt: at, wasLate: isLate, lastAliveAt: at },
    });
    const isResume = day.firstCheckInAt !== null;
    await tx.attendanceDay.update({
      where: { id: day.id },
      data: isResume ? { lastActivityAt: at } : { firstCheckInAt: at, wasLate: isLate, lastActivityAt: at },
    });
    await recordAuditEvent(tx, {
      actorId: guard.userId,
      actorRole: "OWNER",
      action: "MANUAL_CHECKIN",
      resourceType: "attendance_session",
      resourceId: userId,
      after: { sessionId: session.id, at: at.toISOString(), isLate, notified: raw.notify === true },
      reason: reason || null,
      ipAddress: ip,
    });
    return session.id;
  }).catch((e: unknown) => (e instanceof Error ? e.message : "تعذّر التسجيل"));

  if (typeof sessionId !== "string" || !sessionId.startsWith("c")) {
    return NextResponse.json({ ok: false, error: String(sessionId) }, { status: 409 });
  }

  // إشعار الموظف اختياري — الافتراضي صامت (تدقيق فقط)، مثل مودال الانصراف.
  if (raw.notify === true) {
    await notify(
      prisma,
      [userId],
      "attendance.owner_checkin",
      "تسجيل حضور",
      `سجّلت لك الإدارة حضورًا الساعة ${formatTime(at)} — عدّاد دوامك شغّال الآن.`,
      "/m",
    ).catch(() => {});
  }
  return NextResponse.json({ ok: true, sessionId, startedAtIso: at.toISOString(), isLate });
}
