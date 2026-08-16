import { NextResponse } from "next/server";
import { AttendanceEventType, Role } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { matchLocation, nearestLocation } from "@/lib/geofence";
import { getActiveLocations, getAttendanceSettings } from "@/lib/data/attendance";
import { formatTime } from "@/lib/format";
import { activeWorkedMinutes } from "@/lib/attendance-logic";
import { checkoutText, pauseStartText, verifyOutOfZoneText } from "@/lib/attendance-notify";
import { notify, ownerIds } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ردّ الموظف على النداء الإجباري — أربعة ردود للنداء العشوائي/اليدوي، وردّان
 * لنداء الوصول. الحكم كله على الخادم؛ لا ثقة بأي «داخل النطاق» من الجوال.
 *
 *   HERE            تأكيد الحضور: قراءة موقع → CONFIRMED أو OUT_OF_ZONE.
 *                   لنداء الوصول (ARRIVAL): المطابقة تفتح محطة LOCATION_CHANGE.
 *   EN_ROUTE        ذاهب لمشروع: العدّاد يكمل ويُجدول نداء وصول بعد المهلة.
 *   PAUSE           استأذنت للخروج (راجع اليوم): جهة إذن إلزامية → AttendancePause وإيقاف العدّاد.
 *   CHECKOUT        استأذنت وانتهى دوامه لظرف: انصراف فوري — الجلسة تُقفل
 *                   بالدالة المشتركة، والانصراف من خارج النطاق مسموح (outOfZone
 *                   يُسجَّل ويُنبَّه المالك)، ولا جهة إذن ولا سبب.
 *   STILL_EN_ROUTE  (وصول فقط) لسه بالطريق: تمديد مرة واحدة إضافية فقط.
 */

type Body = {
  answer?: unknown;
  lat?: unknown;
  lng?: unknown;
  accuracy?: unknown;
  isMock?: unknown;
  pauseKind?: unknown;
  authorizerId?: unknown;
  reason?: unknown;
};

const ANSWERS = new Set(["HERE", "EN_ROUTE", "PAUSE", "CHECKOUT", "STILL_EN_ROUTE"]);

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false }, { status: 401 });
  if (session.user.role === Role.OWNER) {
    return NextResponse.json(
      { ok: false, reason: "owner_excluded", message: "المالك خارج نظام البصم" },
      { status: 403 },
    );
  }
  const userId = session.user.id;

  let raw: Body;
  try {
    raw = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid", message: "بيانات غير صالحة" }, { status: 400 });
  }

  // «HERE» هو السلوك القديم — غياب answer يعامَل كتأكيد حضور (توافق رجعي).
  const answer = typeof raw.answer === "string" && ANSWERS.has(raw.answer) ? raw.answer : "HERE";

  const now = new Date();
  const pending = await prisma.attendanceVerification.findFirst({
    where: { userId, status: "SENT", deadlineAt: { gt: now } },
    orderBy: { sentAt: "desc" },
  });
  if (!pending) {
    return NextResponse.json({ ok: false, reason: "no_pending", message: "ما عندك نداء تحقق نشط الحين" });
  }

  const settings = await getAttendanceSettings();
  const isArrival = pending.kind === "ARRIVAL";

  /* ═══════════ لسه بالطريق — تمديد نداء الوصول مرة واحدة فقط ═══════════ */
  if (answer === "STILL_EN_ROUTE") {
    if (!isArrival) {
      return NextResponse.json({ ok: false, reason: "invalid", message: "هذا الرد لنداء الوصول فقط" });
    }
    const rootId = pending.parentId ?? pending.id;
    const arrivals = await prisma.attendanceVerification.count({
      where: { kind: "ARRIVAL", OR: [{ parentId: rootId }, { id: rootId }] },
    });
    if (arrivals >= 2) {
      return NextResponse.json({
        ok: false,
        reason: "no_extension",
        message: "مدّدنا لك مرة قبل — أكّد وصولك أو بيتسجّل النداء فائتًا",
      });
    }
    await prisma.$transaction([
      prisma.attendanceVerification.update({
        where: { id: pending.id },
        data: { status: "EN_ROUTE", respondedAt: now },
      }),
      prisma.attendanceVerification.create({
        data: {
          userId,
          sessionId: pending.sessionId,
          kind: "ARRIVAL",
          parentId: rootId,
          scheduledAt: new Date(now.getTime() + settings.arrivalConfirmMinutes * 60_000),
        },
      }),
    ]);
    return NextResponse.json({
      ok: true,
      status: "EN_ROUTE",
      message: `تمام — بنسألك عن وصولك بعد ${settings.arrivalConfirmMinutes} دقيقة (آخر تمديد)`,
    });
  }

  /* ═══════════ ذاهب إلى مشروع — العدّاد يكمل ويُجدول نداء وصول ═══════════ */
  if (answer === "EN_ROUTE") {
    if (isArrival) {
      return NextResponse.json({ ok: false, reason: "invalid", message: "أكّد وصولك أو اختر «لسه بالطريق»" });
    }
    await prisma.$transaction([
      prisma.attendanceVerification.update({
        where: { id: pending.id },
        data: { status: "EN_ROUTE", respondedAt: now },
      }),
      prisma.attendanceVerification.create({
        data: {
          userId,
          sessionId: pending.sessionId,
          kind: "ARRIVAL",
          parentId: pending.id,
          scheduledAt: new Date(now.getTime() + settings.arrivalConfirmMinutes * 60_000),
        },
      }),
    ]);
    return NextResponse.json({
      ok: true,
      status: "EN_ROUTE",
      message: `تمام — دوامك مستمر، وبنسألك عن وصولك بعد ${settings.arrivalConfirmMinutes} دقيقة`,
    });
  }

  /* ═══════════ استأذنت / غادرت — جهة إلزامية + إيقاف العدّاد ═══════════ */
  if (answer === "PAUSE") {
    // الواجهة صارت تنتج EXCUSED فقط (خطوة «راجع اليوم؟») — LEFT يبقى مقبولًا للتوافق.
    const kind = raw.pauseKind === "LEFT" ? "LEFT" : "EXCUSED";
    const authorizerId = typeof raw.authorizerId === "string" ? raw.authorizerId : "";
    const authorizer = authorizerId
      ? await prisma.attendanceAuthorizer.findUnique({ where: { id: authorizerId } })
      : null;
    if (!authorizer || !authorizer.isActive) {
      return NextResponse.json({ ok: false, reason: "invalid", message: "اختر جهة الإذن" });
    }
    const openSession = await prisma.attendanceSession.findFirst({
      where: { userId, endedAt: null },
      orderBy: { startedAt: "desc" },
    });
    if (!openSession) {
      return NextResponse.json({ ok: false, reason: "not_checked_in", message: "ما عندك جلسة دوام مفتوحة" });
    }
    const alreadyPaused = await prisma.attendancePause.findFirst({
      where: { sessionId: openSession.id, endedAt: null },
      select: { id: true },
    });
    if (alreadyPaused) {
      return NextResponse.json({ ok: false, reason: "already_paused", message: "عدّادك موقوف أصلًا" });
    }
    const reason = typeof raw.reason === "string" ? raw.reason.trim().slice(0, 500) : "";

    await prisma.$transaction([
      prisma.attendanceVerification.update({
        where: { id: pending.id },
        data: { status: "PAUSED", respondedAt: now },
      }),
      prisma.attendancePause.create({
        data: {
          sessionId: openSession.id,
          userId,
          kind,
          authorizerId: authorizer.id,
          authorizerLabel: authorizer.label, // نسخة نصية — تبقى لو حُذفت الجهة
          reason: reason || null,
          startedAt: now,
        },
      }),
    ]);

    try {
      const me = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
      await notify(
        prisma,
        await ownerIds(prisma),
        "attendance.paused",
        pauseStartText(me?.name ?? "موظف", kind, authorizer.label, formatTime(now)),
        reason || undefined,
        `/attendance/${userId}`,
      );
    } catch (e) {
      console.error("[attendance] فشل إشعار بدء التوقف", e);
    }

    return NextResponse.json({
      ok: true,
      status: "PAUSED",
      message: "أوقفنا عدّادك — اضغط «رجعت» أول ما ترجع لدوامك",
    });
  }

  /* ═══════════ تأكيد الحضور أو الانصراف الفوري — قراءة موقع والحكم بالسيرفر ═══════════ */
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  const accuracy = Number(raw.accuracy);
  if (
    !Number.isFinite(lat) || lat < -90 || lat > 90 ||
    !Number.isFinite(lng) || lng < -180 || lng > 180 ||
    !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100_000
  ) {
    return NextResponse.json({ ok: false, reason: "invalid", message: "بيانات غير صالحة" }, { status: 400 });
  }

  // فحص الدقة كما في punch — قراءة ضعيفة تُرفض قبل أي تسجيل، والنداء يبقى نشطًا.
  if (accuracy > settings.minAccuracyMeters) {
    return NextResponse.json({
      ok: false,
      reason: "weak_accuracy",
      message: "الإشارة ضعيفة، حاول مرة ثانية بمكان مفتوح",
    });
  }

  const locations = await getActiveLocations();
  const match = matchLocation(lat, lng, accuracy, locations);

  /* ═══════════ «خلاص انتهى دوامي لظرف» — انصراف فوري من النداء ═══════════ */
  if (answer === "CHECKOUT") {
    if (isArrival) {
      return NextResponse.json({ ok: false, reason: "invalid", message: "أكّد وصولك أو اختر «لسه بالطريق»" });
    }
    const openSession = await prisma.attendanceSession.findFirst({
      where: { userId, endedAt: null },
      orderBy: { startedAt: "desc" },
    });
    if (!openSession) {
      return NextResponse.json({ ok: false, reason: "not_checked_in", message: "ما عندك جلسة دوام مفتوحة" });
    }

    const nearest = match ?? nearestLocation(lat, lng, locations);
    const locationName = match ? (locations.find((l) => l.id === match.id)?.name ?? null) : null;
    const verifyStatus = match ? "CONFIRMED" : "OUT_OF_ZONE";

    // الساعات الصافية بالدالة المشتركة — التوقف النشط يُقفل أولًا عند هذي اللحظة.
    const pauses = await prisma.attendancePause.findMany({ where: { sessionId: openSession.id } });
    const workedMinutes = activeWorkedMinutes(
      openSession.startedAt,
      now,
      pauses.map((p) => ({ startedAt: p.startedAt, endedAt: p.endedAt ?? now })),
      now,
    );
    // هدف اليوم لتنبيه «قبل إكمال دوامه» — دوامه المحدد (الاستثناءات نادرة هنا والفرق تجميلي).
    const schedule = await prisma.attendanceSchedule.findUnique({ where: { userId } });
    const targetMinutes = schedule?.shiftMinutes ?? 480;

    await prisma.$transaction(async (tx) => {
      await tx.attendancePause.updateMany({
        where: { sessionId: openSession.id, endedAt: null },
        data: { endedAt: now },
      });
      // الانصراف من أي موقع مسموح بقرار المالك — خارج النطاق يُسجَّل ولا يُرفض.
      const event = await tx.attendanceEvent.create({
        data: {
          userId,
          locationId: match?.id ?? null,
          type: AttendanceEventType.CHECK_OUT,
          timestamp: now,
          lat,
          lng,
          accuracy,
          distanceMeters: nearest?.distance ?? 0,
          source: "WEB",
          isMock: raw.isMock === true,
          outOfZone: !match,
          isLate: false,
        },
      });
      await tx.attendanceSession.update({
        where: { id: openSession.id },
        data: { checkOutEventId: event.id, endedAt: now, workedMinutes },
      });
      await tx.attendanceVerification.update({
        where: { id: pending.id },
        data: {
          status: verifyStatus,
          respondedAt: now,
          lat,
          lng,
          accuracy,
          locationId: match?.id ?? null,
          distanceMeters: nearest?.distance ?? null,
        },
      });
      // انصرف — نداءات اليوم المعلّقة صارت بلا معنى.
      await tx.attendanceVerification.deleteMany({ where: { userId, status: "PENDING" } });
    });

    try {
      const me = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
      const name = me?.name ?? "موظف";
      await notify(
        prisma,
        await ownerIds(prisma),
        "attendance.completed",
        checkoutText(name, formatTime(now), locationName, workedMinutes < targetMinutes),
        undefined,
        `/attendance/${userId}`,
      );
      if (!match) {
        await notify(
          prisma,
          await ownerIds(prisma),
          "attendance.verify_out_of_zone",
          verifyOutOfZoneText(
            name,
            nearest?.distance ?? null,
            nearest ? (locations.find((l) => l.id === nearest.id)?.name ?? null) : null,
          ),
          undefined,
          `/attendance/${userId}`,
        );
      }
    } catch (e) {
      console.error("[attendance] فشل إشعار الانصراف من النداء", e);
    }

    return NextResponse.json({
      ok: true,
      status: verifyStatus,
      message: match
        ? `سجّلنا انصرافك من ${locationName ?? "موقعك"} — تروح وتجيك العافية`
        : "سجّلنا انصرافك من خارج النطاق — بلّغنا الإدارة",
    });
  }

  if (match) {
    const matchedName = locations.find((l) => l.id === match.id)?.name ?? null;
    await prisma.$transaction(async (tx) => {
      await tx.attendanceVerification.update({
        where: { id: pending.id },
        data: {
          status: "CONFIRMED",
          respondedAt: now,
          lat,
          lng,
          accuracy,
          locationId: match.id,
          distanceMeters: match.distance,
        },
      });
      // إثباتا الحياة والموقع (الثقة المتجددة v3) — رد مؤكَّد داخل النطاق.
      await tx.attendanceSession.updateMany({
        where: { userId, endedAt: null },
        data: { lastAliveAt: now, lastZoneProofAt: now },
      });
      // نداء الوصول المؤكد يفتح محطة بالمشروع المطابق — نفس نموذج «تغيير موقعي».
      if (isArrival) {
        await tx.attendanceEvent.create({
          data: {
            userId,
            locationId: match.id,
            type: AttendanceEventType.LOCATION_CHANGE,
            timestamp: now,
            lat,
            lng,
            accuracy,
            distanceMeters: match.distance,
            source: "WEB",
            isMock: raw.isMock === true,
            outOfZone: false,
            isLate: false,
          },
        });
      }
    });
    return NextResponse.json({
      ok: true,
      status: "CONFIRMED",
      message: isArrival
        ? `وصلت — سجّلنا محطتك${matchedName ? ` في ${matchedName}` : ""}`
        : `تم — أكّدنا موقعك${matchedName ? ` في ${matchedName}` : ""}`,
    });
  }

  // خارج النطاق: يُسجَّل الرد كما هو ويُنبَّه المالك — لا رفض صامت.
  const nearest = nearestLocation(lat, lng, locations);
  await prisma.$transaction(async (tx) => {
    await tx.attendanceVerification.update({
      where: { id: pending.id },
      data: {
        status: "OUT_OF_ZONE",
        respondedAt: now,
        lat,
        lng,
        accuracy,
        locationId: null,
        distanceMeters: nearest?.distance ?? null,
      },
    });
    // إثبات حياة فقط (v3) — ردّ خارج النطاق لا يجدد إثبات الموقع.
    await tx.attendanceSession.updateMany({
      where: { userId, endedAt: null },
      data: { lastAliveAt: now },
    });
    // وصول خارج النطاق: محطة «خارج النطاق» — تُسجَّل ولا توقف الدوام.
    if (isArrival) {
      await tx.attendanceEvent.create({
        data: {
          userId,
          locationId: null,
          type: AttendanceEventType.LOCATION_CHANGE,
          timestamp: now,
          lat,
          lng,
          accuracy,
          distanceMeters: nearest?.distance ?? 0,
          source: "WEB",
          isMock: raw.isMock === true,
          outOfZone: true,
          isLate: false,
        },
      });
    }
  });
  try {
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    await notify(
      prisma,
      await ownerIds(prisma),
      "attendance.verify_out_of_zone",
      verifyOutOfZoneText(
        me?.name ?? "موظف",
        nearest?.distance ?? null,
        nearest ? (locations.find((l) => l.id === nearest.id)?.name ?? null) : null,
      ),
      undefined,
      `/attendance/${userId}`,
    );
  } catch (e) {
    console.error("[attendance] فشل إشعار المالك برد خارج النطاق", e);
  }

  return NextResponse.json({
    ok: true,
    status: "OUT_OF_ZONE",
    message: "سجّلنا ردك، لكن موقعك خارج النطاق — بلّغنا المالك",
  });
}
