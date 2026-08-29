import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireOwnerApi } from "@/lib/attendance-guard";
import { getScheduleFor } from "@/lib/data/attendance";
import { recordAuditEvent } from "@/lib/audit-event";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** دوام الموظف المحدد — المالك فقط يقرأ ويعدّل. */
export async function GET(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const guard = await requireOwnerApi();
  if (!guard.ok) return guard.res;

  const { userId } = await params;
  const [schedule, row] = await Promise.all([
    getScheduleFor(userId),
    prisma.attendanceSchedule.findUnique({ where: { userId } }),
  ]);
  return NextResponse.json({ ok: true, schedule, config: row ?? null });
}

const MODES = new Set(["STRICT", "WATCH_ONLY", "EXEMPT"]);
const DAY_CODES = new Set(["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]);
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * تعديل دوام/إعدادات الموظف (ملف الموظف الحي) — المالك فقط:
 * الحقول الأساسية (البداية/الساعات/النافذة) إلزامية كما كانت، وحقول التخصيص
 * اختيارية: غير المُرسل لا يُمس، وnull صراحةً = «ارجع للإعداد العام».
 * أي لمس لحقول التخصيص/الوضع يُقيَّد ATTENDANCE_CONFIG_UPDATE وإلا SCHEDULE_UPDATE.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const guard = await requireOwnerApi();
  if (!guard.ok) return guard.res;

  const { userId } = await params;
  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "بيانات غير صالحة" }, { status: 400 });
  }

  const startMinutes = Math.round(Number(raw.startMinutes));
  const shiftMinutes = Math.round(Number(raw.shiftMinutes));
  if (!Number.isFinite(startMinutes) || startMinutes < 0 || startMinutes > 1439) {
    return NextResponse.json({ ok: false, error: "بداية الدوام غير صحيحة" }, { status: 400 });
  }
  // من ساعة إلى ١٦ ساعة — خارجها ضبط خاطئ يفسد العدادات كلها.
  if (!Number.isFinite(shiftMinutes) || shiftMinutes < 60 || shiftMinutes > 960) {
    return NextResponse.json({ ok: false, error: "عدد الساعات غير صحيح (من ساعة إلى ١٦)" }, { status: 400 });
  }
  /*
   * نافذة البداية المرنة (الدوام الواقعي — قرار ٢): اختيارية؛ null = وقت واحد.
   * لازم تكون بعد البداية وبفارق منطقي (حتى ٦ ساعات — أوسع منها ضبط خاطئ).
   */
  let startWindowEndMinutes: number | null = null;
  if (raw.startWindowEndMinutes !== undefined && raw.startWindowEndMinutes !== null && raw.startWindowEndMinutes !== "") {
    startWindowEndMinutes = Math.round(Number(raw.startWindowEndMinutes));
    if (!Number.isFinite(startWindowEndMinutes) || startWindowEndMinutes <= startMinutes || startWindowEndMinutes > 1439) {
      return NextResponse.json({ ok: false, error: "نهاية نافذة البداية لازم تكون بعد بدايتها" }, { status: 400 });
    }
    if (startWindowEndMinutes - startMinutes > 360) {
      return NextResponse.json({ ok: false, error: "نافذة البداية تتجاوز ٦ ساعات — تأكد من الوقتين" }, { status: 400 });
    }
  }

  // ===== حقول التخصيص الاختيارية (undefined = لا تلمس · null = ارجع للعام) =====
  const patch: Record<string, unknown> = { startMinutes, shiftMinutes, startWindowEndMinutes };
  const err = (msg: string) => NextResponse.json({ ok: false, error: msg }, { status: 400 });

  if (raw.enforcementMode !== undefined) {
    if (typeof raw.enforcementMode !== "string" || !MODES.has(raw.enforcementMode)) return err("وضع الإلزام غير معروف");
    patch.enforcementMode = raw.enforcementMode;
  }
  if (raw.exemptUntil !== undefined) {
    if (raw.exemptUntil === null || raw.exemptUntil === "") patch.exemptUntil = null;
    else if (typeof raw.exemptUntil === "string" && DAY_KEY.test(raw.exemptUntil)) patch.exemptUntil = new Date(`${raw.exemptUntil}T00:00:00Z`);
    else return err("تاريخ انتهاء الإعفاء غير صحيح");
  }
  if (raw.exemptReason !== undefined) {
    patch.exemptReason = typeof raw.exemptReason === "string" && raw.exemptReason.trim() ? raw.exemptReason.trim().slice(0, 200) : null;
  }
  if (raw.verificationPerDay !== undefined) {
    if (raw.verificationPerDay === null) patch.verificationPerDay = null;
    else {
      const n = Math.round(Number(raw.verificationPerDay));
      if (!Number.isFinite(n) || n < 0 || n > 4) return err("عدد النداءات اليومية من ٠ إلى ٤");
      patch.verificationPerDay = n;
    }
  }
  if (raw.weekendDays !== undefined) {
    if (raw.weekendDays === null) patch.weekendDays = null;
    else if (typeof raw.weekendDays === "string") {
      const codes = raw.weekendDays.split(",").map((c) => c.trim()).filter(Boolean);
      if (codes.some((c) => !DAY_CODES.has(c)) || codes.length > 6) return err("أيام العطلة غير صحيحة");
      patch.weekendDays = [...new Set(codes)].join(",");
    } else return err("أيام العطلة غير صحيحة");
  }
  for (const key of ["outZoneCallEnabled", "dayLockEnabled", "notifyMissedCall", "watchAlertFirstSeen", "gapCallEnabled", "punchReminderEnabled"] as const) {
    if (raw[key] !== undefined) {
      if (raw[key] !== null && typeof raw[key] !== "boolean") return err("قيمة مفتاح غير صحيحة");
      patch[key] = raw[key];
    }
  }
  // ===== الدفعة ب =====
  if (raw.quietMode !== undefined) {
    if (typeof raw.quietMode !== "boolean") return err("قيمة الوضع الإخباري غير صحيحة");
    patch.quietMode = raw.quietMode;
  }
  if (raw.lateThresholdMinutes !== undefined) {
    if (raw.lateThresholdMinutes === null) patch.lateThresholdMinutes = null;
    else {
      const n = Math.round(Number(raw.lateThresholdMinutes));
      if (!Number.isFinite(n) || n < 0 || n > 240) return err("حد التأخير من ٠ إلى ٢٤٠ دقيقة");
      patch.lateThresholdMinutes = n;
    }
  }
  if (raw.watchFromMinutes !== undefined || raw.watchToMinutes !== undefined) {
    const parse = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v)));
    const from = parse(raw.watchFromMinutes);
    const to = parse(raw.watchToMinutes);
    if (from !== null && (!Number.isFinite(from) || from < 0 || from > 1439)) return err("بداية نطاق الرصد غير صحيحة");
    if (to !== null && (!Number.isFinite(to) || to < 0 || to > 1439)) return err("نهاية نطاق الرصد غير صحيحة");
    if (from !== null && to !== null && to <= from) return err("نهاية نطاق الرصد لازم بعد بدايته");
    patch.watchFromMinutes = from;
    patch.watchToMinutes = to;
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user) return NextResponse.json({ ok: false, error: "الموظف غير موجود" }, { status: 404 });
  if (user.role === Role.OWNER) {
    return NextResponse.json({ ok: false, error: "المالك خارج نظام البصم" }, { status: 400 });
  }

  const CONFIG_KEYS = [
    "enforcementMode", "exemptUntil", "exemptReason", "verificationPerDay", "weekendDays",
    "outZoneCallEnabled", "dayLockEnabled", "notifyMissedCall", "watchFromMinutes", "watchToMinutes", "watchAlertFirstSeen",
    "lateThresholdMinutes", "gapCallEnabled", "punchReminderEnabled", "quietMode",
  ];
  const touchesConfig = CONFIG_KEYS.some((k) => k in patch);

  const before = await prisma.attendanceSchedule.findUnique({ where: { userId } });
  const schedule = await prisma.attendanceSchedule.upsert({
    where: { userId },
    update: patch,
    create: { userId, ...patch } as never,
  });
  // سجل التدقيق — تعديل الدوام/الإعدادات إجراء مالك حسّاس، بقبل/بعد كاملين.
  const auditShape = (row: typeof before | typeof schedule | null) =>
    row
      ? Object.fromEntries(
          ["startMinutes", "shiftMinutes", "startWindowEndMinutes", ...CONFIG_KEYS].map((k) => [
            k,
            (row as Record<string, unknown>)[k] instanceof Date
              ? ((row as Record<string, unknown>)[k] as Date).toISOString().slice(0, 10)
              : ((row as Record<string, unknown>)[k] ?? null),
          ]),
        )
      : null;
  await recordAuditEvent(prisma, {
    actorId: guard.userId,
    actorRole: "OWNER",
    action: touchesConfig ? "ATTENDANCE_CONFIG_UPDATE" : "SCHEDULE_UPDATE",
    resourceType: "attendance_schedule",
    resourceId: userId,
    before: auditShape(before),
    after: auditShape(schedule),
    ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });
  return NextResponse.json({ ok: true, schedule });
}
