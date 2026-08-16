import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ksaDayKey, ksaMinutesOfDay } from "@/lib/ksa-time";
import { formatTime } from "@/lib/format";
import { dayDateOf, ensureAttendanceDay, getAttendanceDay, getAttendanceSettings } from "@/lib/data/attendance";
import { activeOnWayDecision, effectiveDayOf } from "@/lib/attendance-auto-punch";
import { notify, ownerIds } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * شاشة الحسم الإجبارية (الدوام الواقعي — قراران ٤ و٥):
 *
 * GET  — هل الحسم مستحق الآن؟ fail-open بالتصميم: أي شك = غير مستحق، والعميل
 *        يخفي الشاشة عند أي خطأ — الخلل لا يحجب أحدًا بالغلط (قرار المالك).
 * POST — تسجيل الإجابة: بالطريق (بمدة) / إجازة اليوم / مستأذن / عن بُعد
 *        (عن بُعد يمر أولًا بمسار v2 القائم بجهة الإذن — العميل يستدعيه ثم
 *        يسجّل هنا). كل إجابة صف في AttendanceDecision + إشعار فوري للمالك.
 *
 * الاستحقاق: موظف (ليس OWNER) بيوم عمل «في الموقع»، تجاوز نهاية نافذة بدايته
 * وما بصم وما قرر — حتى نهاية نافذة الشركة. «بالطريق» النشطة تؤجل الاستحقاق،
 * وانتهاء مهلتها (+الهامش) يعيده مع وسم القديمة RE_PROMPTED.
 */

const ETA_CHOICES = new Set([10, 15, 30, 60]);

async function computeDue(userId: string, now: Date) {
  const todayKey = ksaDayKey(now);
  const [day, settings, openOrToday] = await Promise.all([
    getAttendanceDay(userId, todayKey),
    getAttendanceSettings(),
    prisma.attendanceSession.findFirst({
      where: {
        userId,
        voided: false,
        OR: [{ endedAt: null }, { startedAt: { gte: new Date(`${todayKey}T00:00:00+03:00`) } }],
      },
      select: { id: true },
    }),
  ]);

  if (openOrToday) return { due: false as const };
  if (day && day.mode !== "ONSITE") return { due: false as const };

  const eff = await effectiveDayOf(userId, now);
  if (eff.isWeekend || eff.onLeave) return { due: false as const };

  const m = ksaMinutesOfDay(now);
  // الاستحقاق بعد نهاية نافذته وقبل إقفال الشركة (قرار ١ — لا حسم بعد النافذة الكلية).
  if (m <= eff.windowEndMinutes || m >= settings.workEndMinutes) return { due: false as const };

  // قرارات اليوم: إجازة/استئذان/عن بُعد تحسم اليوم كله.
  const decisions = await prisma.attendanceDecision.findMany({
    where: { userId, date: dayDateOf(todayKey) },
    orderBy: { decidedAt: "desc" },
  });
  if (decisions.some((d) => d.kind === "LEAVE" || d.kind === "EXCUSED" || d.kind === "REMOTE")) {
    return { due: false as const };
  }

  // «بالطريق» نشطة تؤجل؛ ومنتهية بلا وصول → توسم وتعيد الاستحقاق.
  const onWay = await activeOnWayDecision(userId, now, settings.arrivalMarginMinutes);
  if (onWay) return { due: false as const };
  await prisma.attendanceDecision.updateMany({
    where: { userId, date: dayDateOf(todayKey), kind: "ON_WAY", resolvedAt: null },
    data: { resolvedAt: now, outcome: "RE_PROMPTED" },
  });

  return {
    due: true as const,
    windowEndText: formatTime(
      new Date(new Date(`${todayKey}T00:00:00+03:00`).getTime() + eff.windowEndMinutes * 60_000),
    ),
  };
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user || session.user.role === Role.OWNER) return NextResponse.json({ ok: true, due: false });
    return NextResponse.json({ ok: true, ...(await computeDue(session.user.id, new Date())) });
  } catch {
    // fail-open — خلل البوابة لا يحجب أحدًا.
    return NextResponse.json({ ok: true, due: false });
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false }, { status: 401 });
  if (session.user.role === Role.OWNER) {
    return NextResponse.json({ ok: false, error: "المالك خارج نظام البصم" }, { status: 400 });
  }
  const userId = session.user.id;
  const now = new Date();
  const todayKey = ksaDayKey(now);

  let raw: { kind?: unknown; etaMinutes?: unknown };
  try {
    raw = (await req.json()) as typeof raw;
  } catch {
    return NextResponse.json({ ok: false, error: "بيانات غير صالحة" }, { status: 400 });
  }
  const kind = typeof raw.kind === "string" ? raw.kind : "";
  if (!["ON_WAY", "LEAVE", "EXCUSED", "REMOTE"].includes(kind)) {
    return NextResponse.json({ ok: false, error: "اختر إجابة" }, { status: 400 });
  }

  let etaMinutes: number | null = null;
  if (kind === "ON_WAY") {
    etaMinutes = Math.round(Number(raw.etaMinutes));
    if (!ETA_CHOICES.has(etaMinutes)) {
      return NextResponse.json({ ok: false, error: "اختر مدة الوصول" }, { status: 400 });
    }
  }

  const me = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  const name = me?.name ?? "موظف";

  await prisma.$transaction(async (tx) => {
    await tx.attendanceDecision.create({
      data: { userId, date: dayDateOf(todayKey), kind, etaMinutes, decidedAt: now },
    });
    /*
     * إجازة/استئذان يوسمان اليوم LEAVE (لا نداءات ولا «لم يداوم» — نفس عزل v2)؛
     * التمييز بينهما محفوظ في صف القرار نفسه. عن بُعد يوسمه مسار v2 القائم.
     */
    if (kind === "LEAVE" || kind === "EXCUSED") {
      const day = await ensureAttendanceDay(tx, userId, todayKey);
      await tx.attendanceDay.update({ where: { id: day.id }, data: { mode: "LEAVE", lastActivityAt: now } });
      await tx.attendanceVerification.deleteMany({ where: { userId, status: "PENDING" } });
    }
  });

  // إشعار المالك الفوري (قرار ١٢) — best-effort.
  try {
    const label =
      kind === "ON_WAY"
        ? `بالطريق — يوصل خلال ${etaMinutes} دقيقة`
        : kind === "LEAVE"
          ? "إجازة اليوم"
          : kind === "EXCUSED"
            ? "مستأذن — ما يداوم اليوم"
            : "يداوم عن بُعد";
    await notify(
      prisma,
      await ownerIds(prisma),
      "attendance.decision",
      `${name} أجاب شاشة الحسم: ${label} — ${formatTime(now)}`,
      undefined,
      `/attendance/${userId}`,
    );
  } catch (e) {
    console.error("[attendance] فشل إشعار قرار الحسم", e);
  }

  return NextResponse.json({
    ok: true,
    message:
      kind === "ON_WAY"
        ? `تمام — ننتظرك خلال ${etaMinutes} دقيقة، وأول ما توصل الموقع نبصم لك تلقائيًا`
        : kind === "LEAVE"
          ? "سجّلنا إجازتك اليوم — تقدر تستخدم النظام عادي"
          : kind === "EXCUSED"
            ? "سجّلنا استئذانك اليوم — تقدر تستخدم النظام عادي"
            : "تم — كمّل مسار «عن بُعد» بجهة الإذن",
  });
}
