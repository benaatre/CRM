import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwnerApi } from "@/lib/attendance-guard";
import { ksaDayKey, parseRiyadhLocal } from "@/lib/ksa-time";
import { activeWorkedMinutes } from "@/lib/attendance-logic";
import { ensureAttendanceDay } from "@/lib/data/attendance";
import { recordAuditEvent } from "@/lib/audit-event";
import { ownerCheckoutEmployeeText } from "@/lib/attendance-notify";
import { formatTime } from "@/lib/format";
import { notify } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * أداة تصحيح الجلسات — المالك فقط (م٢ الثقة المتجددة)، بنمط `restore` الحرفي:
 * سبب نصي إلزامي، وكل عملية تُدوَّن في سجل التدقيق (append-only) بقبل/بعد + ip.
 *
 *   op=CLOSE  يقفل جلسة عالقة عند لحظة يحددها المالك (أو الافتراض المعروض له:
 *             آخر إثبات حياة، وللجلسات القديمة بإثباتات null: آخر حدث بصم فعلي).
 *             الدقائق بالدالة المشتركة + حذف نداءات PENDING + closedBy=OWNER.
 *   op=EDIT   يعدّل بداية/نهاية جلسة — الدقائق تُعاد حسابيًا **دائمًا** (لا تحرير
 *             workedMinutes مباشرة؛ التماسك مع التوقفات محفوظ بالدالة المشتركة).
 *   op=VOID   إبطال منطقي (voided=true) — الصف يبقى، والقراءات التجميعية
 *             تستثنيه؛ الجلسة المفتوحة تُقفل لحظة الإبطال أولًا.
 */

/** آخر إثبات حياة للجلسة — وللقديمة (null): آخر حدث بصم فعلي ضمنها، وإلا بدايتها. */
async function defaultCloseAt(s: {
  id: string;
  userId: string;
  startedAt: Date;
  lastAliveAt: Date | null;
}): Promise<Date> {
  if (s.lastAliveAt) return s.lastAliveAt;
  const lastEvent = await prisma.attendanceEvent.findFirst({
    where: { userId: s.userId, timestamp: { gte: s.startedAt } },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true },
  });
  return lastEvent?.timestamp ?? s.startedAt;
}

export async function POST(req: Request) {
  const guard = await requireOwnerApi();
  if (!guard.ok) return guard.res;

  let raw: {
    op?: unknown;
    sessionId?: unknown;
    atIso?: unknown;
    startIso?: unknown;
    endIso?: unknown;
    reason?: unknown;
    notify?: unknown; // CLOSE فقط: إشعار الموظف بالانصراف المسجَّل (اختياري — الافتراضي صامت)
  };
  try {
    raw = (await req.json()) as typeof raw;
  } catch {
    return NextResponse.json({ ok: false, error: "بيانات غير صالحة" }, { status: 400 });
  }

  const reason = typeof raw.reason === "string" ? raw.reason.trim().slice(0, 500) : "";
  if (!reason) {
    return NextResponse.json({ ok: false, error: "اكتب سبب التصحيح" }, { status: 400 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  const sessionId = typeof raw.sessionId === "string" ? raw.sessionId : "";
  const session = sessionId
    ? await prisma.attendanceSession.findUnique({ where: { id: sessionId } })
    : null;
  if (!session) return NextResponse.json({ ok: false, error: "الجلسة غير موجودة" }, { status: 400 });
  if (session.voided) return NextResponse.json({ ok: false, error: "الجلسة مُبطلة أصلًا" });

  const now = new Date();
  // datetime-local بلا منطقة يُفسَّر رياضًا (قاعدة parseRiyadhLocal — حادثة الإزاحة +٣).
  const parseIso = (v: unknown): Date | null => {
    if (typeof v !== "string" || !v) return null;
    const d = parseRiyadhLocal(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  /* ═══════════ CLOSE — قفل جلسة عالقة ═══════════ */
  if (raw.op === "CLOSE") {
    if (session.endedAt) return NextResponse.json({ ok: false, error: "الجلسة مقفلة أصلًا" });

    const chosen = parseIso(raw.atIso) ?? (await defaultCloseAt(session));
    if (chosen.getTime() < session.startedAt.getTime() || chosen.getTime() > now.getTime()) {
      return NextResponse.json({ ok: false, error: "لحظة الإقفال لازم تكون بين بداية الجلسة والآن" });
    }

    const pauses = await prisma.attendancePause.findMany({ where: { sessionId: session.id } });
    const openPause = pauses.find((p) => p.endedAt === null) ?? null;
    // توقف جارٍ: نفس قاعدة الكرون — الإقفال لا يحتسب وقتًا نشطًا بعد بدء التوقف.
    const closeMoment = openPause
      ? new Date(Math.min(chosen.getTime(), openPause.startedAt.getTime()))
      : chosen;
    const workedMinutes = activeWorkedMinutes(
      session.startedAt,
      closeMoment,
      pauses
        .filter((p) => p.endedAt !== null)
        .map((p) => ({ startedAt: p.startedAt, endedAt: p.endedAt })),
      closeMoment,
    );

    await prisma.$transaction(async (tx) => {
      if (openPause) {
        await tx.attendancePause.update({
          where: { id: openPause.id },
          data: { endedAt: openPause.startedAt },
        });
        if (openPause.kind === "NO_RESPONSE") {
          const day = await ensureAttendanceDay(tx, session.userId, ksaDayKey(session.startedAt));
          await tx.attendanceDay.update({ where: { id: day.id }, data: { autoEnded: true } });
        }
      }
      await tx.attendanceSession.update({
        where: { id: session.id },
        data: { endedAt: closeMoment, workedMinutes, closedBy: "OWNER" },
      });
      await tx.attendanceVerification.deleteMany({
        where: { userId: session.userId, status: "PENDING" },
      });
      await recordAuditEvent(tx, {
        actorId: guard.userId,
        actorRole: "OWNER",
        action: "SESSION_CLOSE",
        resourceType: "attendance_session",
        resourceId: session.userId,
        before: {
          sessionId: session.id,
          startedAt: session.startedAt.toISOString(),
          endedAt: null,
          workedMinutes: session.workedMinutes,
        },
        after: {
          sessionId: session.id,
          endedAt: closeMoment.toISOString(),
          workedMinutes,
          closedBy: "OWNER",
          notified: raw.notify === true,
        },
        reason,
        ipAddress: ip,
      });
    });
    // إشعار الموظف اختياري (مودال ملف الموظف) — الافتراضي صامت: يُقيَّد بالتدقيق فقط.
    if (raw.notify === true) {
      await notify(
        prisma,
        [session.userId],
        "attendance.owner_checkout",
        "تسجيل انصراف",
        ownerCheckoutEmployeeText(formatTime(closeMoment)),
        "/m",
      );
    }
    return NextResponse.json({ ok: true, endedAtIso: closeMoment.toISOString(), workedMinutes });
  }

  /* ═══════════ RESUME — استئناف الدوام (فلسفة النبض الحاكم — الدفعة أ) ═══════════
   * جلسة أُقفلت آليًا اليوم (closedBy=AUTO — الإقفال القانوني، ومنه مسار «نداء
   * فائت → توقف بلا رد → إقفال آلي») يستأنفها المالك بجلسة **متصلة جديدة** من
   * وقت يحدده بين لحظة الإقفال والآن — الجلسة الأصلية ودقائقها لا تُمسّان،
   * وقفل اليوم (إن وُجد) يُفكّ لأن قرار الاستئناف أعلى منه. سبب إلزامي + تدقيق.
   */
  if (raw.op === "RESUME") {
    if (!session.endedAt) return NextResponse.json({ ok: false, error: "الجلسة مفتوحة أصلًا" });
    if (ksaDayKey(session.endedAt) !== ksaDayKey(now)) {
      return NextResponse.json({ ok: false, error: "الاستئناف لجلسة أُقفلت اليوم فقط" });
    }
    // TARGET مستثناة عمدًا: الهدف مكتمل والكرون سيعيد إقفالها فورًا بصفر دقائق.
    if (session.closedBy !== "AUTO") {
      return NextResponse.json({ ok: false, error: "الاستئناف للجلسات المقفلة آليًا فقط — لغيرها استخدم التعديل" });
    }
    const openNow = await prisma.attendanceSession.findFirst({
      where: { userId: session.userId, endedAt: null, voided: false },
      select: { id: true },
    });
    if (openNow) return NextResponse.json({ ok: false, error: "عنده جلسة مفتوحة الآن — ما فيه شي يُستأنف" });

    const resumeAt = parseIso(raw.atIso) ?? session.endedAt;
    if (resumeAt.getTime() < session.endedAt.getTime() || resumeAt.getTime() > now.getTime()) {
      return NextResponse.json({ ok: false, error: "وقت الاستئناف لازم يكون بين لحظة الإقفال والآن" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const day = await ensureAttendanceDay(tx, session.userId, ksaDayKey(now));
      const hadLock = day.lockedAt !== null;
      if (hadLock) await tx.attendanceDay.update({ where: { id: day.id }, data: { lockedAt: null } });
      // حدث ربط بنمط بصمة النيابة (manual-checkin) حرفيًا — checkInEventId إلزامي بالمخطط.
      const event = await tx.attendanceEvent.create({
        data: {
          userId: session.userId,
          locationId: null,
          type: "CHECK_IN",
          timestamp: resumeAt,
          lat: 0,
          lng: 0,
          accuracy: 0,
          distanceMeters: 0,
          source: "OWNER",
          isMock: false,
          outOfZone: false,
          isLate: false,
        },
      });
      const created = await tx.attendanceSession.create({
        // استئناف لا حضور جديد: بلا وسم تأخير، وإثبات الحياة من لحظته.
        data: {
          userId: session.userId, dayId: day.id, checkInEventId: event.id,
          startedAt: resumeAt, wasLate: false, lastAliveAt: resumeAt,
        },
      });
      await recordAuditEvent(tx, {
        actorId: guard.userId,
        actorRole: "OWNER",
        action: "SESSION_RESUME",
        resourceType: "attendance_session",
        resourceId: session.userId,
        before: {
          sessionId: session.id,
          endedAt: session.endedAt!.toISOString(),
          closedBy: session.closedBy,
          workedMinutes: session.workedMinutes,
        },
        after: {
          resumedSessionId: created.id,
          startedAt: resumeAt.toISOString(),
          dayLockCleared: hadLock,
        },
        reason,
        ipAddress: ip,
      });
      return created;
    });
    return NextResponse.json({ ok: true, sessionId: result.id, startedAtIso: result.startedAt.toISOString() });
  }

  /* ═══════════ EDIT — تعديل بداية/نهاية بإعادة حساب آلية ═══════════ */
  if (raw.op === "EDIT") {
    const newStart = parseIso(raw.startIso) ?? session.startedAt;
    const newEnd = parseIso(raw.endIso) ?? session.endedAt;
    if (newEnd === null && session.endedAt !== null) {
      return NextResponse.json({ ok: false, error: "لا يمكن إعادة فتح جلسة مقفلة — استخدم التعديل بلحظتين" });
    }
    if (newStart.getTime() > now.getTime()) {
      return NextResponse.json({ ok: false, error: "بداية الجلسة لا تكون بالمستقبل" });
    }
    if (newEnd !== null) {
      if (newEnd.getTime() <= newStart.getTime()) {
        return NextResponse.json({ ok: false, error: "النهاية لازم تكون بعد البداية" });
      }
      if (newEnd.getTime() > now.getTime()) {
        return NextResponse.json({ ok: false, error: "نهاية الجلسة لا تكون بالمستقبل" });
      }
      if (newEnd.getTime() - newStart.getTime() > 24 * 60 * 60_000) {
        return NextResponse.json({ ok: false, error: "مدة الجلسة تتجاوز ٢٤ ساعة — تأكد من اللحظتين" });
      }
    }

    // الدقائق تُعاد دائمًا بالدالة المشتركة — التوقفات تُقصّ على الحدود الجديدة تلقائيًا.
    const pauses = await prisma.attendancePause.findMany({
      where: { sessionId: session.id, endedAt: { not: null } },
    });
    const workedMinutes =
      newEnd === null
        ? null
        : activeWorkedMinutes(
            newStart,
            newEnd,
            pauses.map((p) => ({ startedAt: p.startedAt, endedAt: p.endedAt })),
            newEnd,
          );

    await prisma.$transaction(async (tx) => {
      await tx.attendanceSession.update({
        where: { id: session.id },
        data: { startedAt: newStart, endedAt: newEnd, workedMinutes },
      });
      await recordAuditEvent(tx, {
        actorId: guard.userId,
        actorRole: "OWNER",
        action: "SESSION_EDIT",
        resourceType: "attendance_session",
        resourceId: session.userId,
        before: {
          sessionId: session.id,
          startedAt: session.startedAt.toISOString(),
          endedAt: session.endedAt?.toISOString() ?? null,
          workedMinutes: session.workedMinutes,
        },
        after: {
          sessionId: session.id,
          startedAt: newStart.toISOString(),
          endedAt: newEnd?.toISOString() ?? null,
          workedMinutes,
        },
        reason,
        ipAddress: ip,
      });
    });
    return NextResponse.json({ ok: true, workedMinutes });
  }

  /* ═══════════ VOID — إبطال منطقي، لا حذف صف ═══════════ */
  if (raw.op === "VOID") {
    await prisma.$transaction(async (tx) => {
      // جلسة مفتوحة تُقفل لحظة الإبطال أولًا — لا يبقى «مداوم» على جلسة مُبطلة.
      await tx.attendancePause.updateMany({
        where: { sessionId: session.id, endedAt: null },
        data: { endedAt: now },
      });
      await tx.attendanceSession.update({
        where: { id: session.id },
        data: {
          voided: true,
          ...(session.endedAt === null ? { endedAt: now, closedBy: "OWNER" } : {}),
        },
      });
      await tx.attendanceVerification.deleteMany({
        where: { userId: session.userId, status: "PENDING" },
      });
      await recordAuditEvent(tx, {
        actorId: guard.userId,
        actorRole: "OWNER",
        action: "SESSION_VOID",
        resourceType: "attendance_session",
        resourceId: session.userId,
        before: {
          sessionId: session.id,
          startedAt: session.startedAt.toISOString(),
          endedAt: session.endedAt?.toISOString() ?? null,
          workedMinutes: session.workedMinutes,
          voided: false,
        },
        after: { sessionId: session.id, voided: true },
        reason,
        ipAddress: ip,
      });
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: "عملية غير معروفة" }, { status: 400 });
}
