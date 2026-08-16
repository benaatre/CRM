import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ksaDayKey } from "@/lib/ksa-time";
import { formatDate } from "@/lib/format";
import { dayDateOf, getAttendanceSettings } from "@/lib/data/attendance";
import { recordAuditEvent } from "@/lib/audit-event";
import { notify, ownerIds } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const LEAVE_TYPES = new Set(["SICK", "OFFICIAL", "PERSONAL"]);
const LEAVE_LABEL: Record<string, string> = { SICK: "مرضية", OFFICIAL: "رسمية", PERSONAL: "ظرف خاص" };
/** أقصى مدة لإجازة ذاتية — أطول من كذا قرار إداري لا تسجيل ذاتي. */
const MAX_DAYS = 30;

/**
 * إجازة ذاتية من بطاقة بداية اليوم — تسري فورًا (leaveNeedsApproval=false):
 * استثناء FULL_DAY_LEAVE بمداها + وضع LEAVE ليومها الأول إن كان اليوم +
 * إيقاف استقبال الليدات طوال المدة (الآلية القائمة: availabilityPaused +
 * pauseUntil صباح يوم الرجوع، والرجوع التلقائي من كرون التوزيع القائم).
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false }, { status: 401 });
  if (session.user.role === Role.OWNER) {
    return NextResponse.json({ ok: false, message: "المالك خارج نظام البصم" }, { status: 403 });
  }
  const userId = session.user.id;

  let raw: {
    leaveType?: unknown;
    fromKey?: unknown;
    toKey?: unknown;
    authorizerId?: unknown;
    pauseIntake?: unknown;
  };
  try {
    raw = (await req.json()) as typeof raw;
  } catch {
    return NextResponse.json({ ok: false, message: "بيانات غير صالحة" }, { status: 400 });
  }

  const leaveType = typeof raw.leaveType === "string" && LEAVE_TYPES.has(raw.leaveType) ? raw.leaveType : null;
  const fromKey = typeof raw.fromKey === "string" && DAY_KEY.test(raw.fromKey) ? raw.fromKey : null;
  const toKey = typeof raw.toKey === "string" && DAY_KEY.test(raw.toKey) ? raw.toKey : null;
  if (!leaveType || !fromKey || !toKey || fromKey > toKey) {
    return NextResponse.json({ ok: false, message: "حدّد النوع والمدة" });
  }
  const spanDays = (dayDateOf(toKey).getTime() - dayDateOf(fromKey).getTime()) / 86_400_000 + 1;
  if (spanDays > MAX_DAYS) {
    return NextResponse.json({ ok: false, message: "المدة طويلة — كلم الإدارة لإجازة أطول من شهر" });
  }

  const now = new Date();
  const todayKey = ksaDayKey(now);
  if (toKey < todayKey) {
    return NextResponse.json({ ok: false, message: "المدة كلها بالماضي" });
  }

  const authorizerId = typeof raw.authorizerId === "string" ? raw.authorizerId : "";
  const authorizer = authorizerId
    ? await prisma.attendanceAuthorizer.findUnique({ where: { id: authorizerId } })
    : null;
  if (!authorizer || !authorizer.isActive) {
    return NextResponse.json({ ok: false, message: "اختر جهة الإذن" });
  }

  /*
   * قرار المالك: الإجازة الذاتية **تسري فورًا دائمًا** — لا اعتماد مسبق.
   * الضمانة هي إشعار المالك وإمكانية الإلغاء من ملف الموظف (LEAVE_CANCEL).
   * عمود leaveNeedsApproval باقٍ بالمخطط بلا استخدام (كـ allowLeftOption).
   */
  const settings = await getAttendanceSettings();

  // بصمة قائمة اليوم مع إجازة تبدأ اليوم — تناقض نرفضه بوضوح.
  if (fromKey === todayKey) {
    const open = await prisma.attendanceSession.findFirst({ where: { userId, endedAt: null }, select: { id: true } });
    if (open) {
      return NextResponse.json({ ok: false, message: "عندك دوام مفتوح — سجّل انصرافك أول" });
    }
  }

  const pauseIntake = raw.pauseIntake !== false && settings.leavePausesLeadIntake;

  const exception = await prisma.$transaction(async (tx) => {
    const created = await tx.attendanceException.create({
      data: {
        userId,
        type: "FULL_DAY_LEAVE",
        dateFrom: dayDateOf(fromKey),
        dateTo: dayDateOf(toKey),
        reason: `إجازة ${LEAVE_LABEL[leaveType]} — تسجيل ذاتي`,
        createdById: userId,
        leaveType,
        authorizerId: authorizer.id,
        authorizerLabel: authorizer.label,
        selfDeclared: true,
      },
    });

    // وضع اليوم LEAVE إن كانت المدة تشمل اليوم — البطاقة واللوحة يقرآنه.
    if (fromKey <= todayKey && todayKey <= toKey) {
      await tx.attendanceDay.upsert({
        where: { userId_date: { userId, date: dayDateOf(todayKey) } },
        update: { mode: "LEAVE" },
        create: { userId, date: dayDateOf(todayKey), mode: "LEAVE" },
      });
    }

    /*
     * ربط إيقاف الاستقبال — الآلية القائمة حرفيًا: pauseUntil = صباح يوم
     * الرجوع (٦:٠٠) وautoResumeExpiredPauses في كرون التوزيع يرجّعه تلقائيًا.
     */
    if (pauseIntake) {
      const resumeAt = new Date(dayDateOf(toKey).getTime() + 86_400_000 + 6 * 3_600_000 - 3 * 3_600_000);
      await tx.user.update({
        where: { id: userId },
        data: {
          availabilityPaused: true,
          pauseReason: "VACATION",
          pauseUntil: resumeAt,
          pausedBy: userId,
          pausedAt: now,
        },
      });
      await recordAuditEvent(tx, {
        actorId: userId,
        actorRole: session.user.role,
        action: "INTAKE_TOGGLE",
        resourceType: "user",
        resourceId: userId,
        after: { availabilityPaused: true, pauseUntil: resumeAt.toISOString(), cause: "self_leave" },
        reason: `إيقاف تلقائي مع إجازة ${LEAVE_LABEL[leaveType]}`,
      });
    }

    await recordAuditEvent(tx, {
      actorId: userId,
      actorRole: session.user.role,
      action: "EXCEPTION_GRANT",
      resourceType: "attendance_exception",
      resourceId: created.id,
      after: { userId, type: "FULL_DAY_LEAVE", leaveType, fromKey, toKey, authorizer: authorizer.label, selfDeclared: true },
    });

    return created;
  });

  try {
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    await notify(
      prisma,
      await ownerIds(prisma),
      "attendance.leave_declared",
      `سجّل ${me?.name ?? "موظف"} إجازة ${LEAVE_LABEL[leaveType]} من ${formatDate(dayDateOf(fromKey))} إلى ${formatDate(dayDateOf(toKey))} — بإذن ${authorizer.label}`,
      pauseIntake ? "أوقفنا استقباله للعملاء طوال المدة — يرجع تلقائيًا صباح يوم الرجوع" : undefined,
      `/attendance/${userId}`,
    );
  } catch (e) {
    console.error("[attendance] فشل إشعار الإجازة", e);
  }

  return NextResponse.json({
    ok: true,
    exceptionId: exception.id,
    message: `سجّلنا إجازتك ${LEAVE_LABEL[leaveType]} — ${fromKey === toKey ? "اليوم" : `حتى ${formatDate(dayDateOf(toKey))}`}`,
  });
}
