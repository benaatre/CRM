import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwnerApi } from "@/lib/attendance-guard";
import { getAttendanceSettings } from "@/lib/data/attendance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** حدود كل إعداد — الرقم خارجها يعني ضبطًا خاطئًا يعطّل النظام كله بصمت. */
const RANGES: Record<string, [number, number]> = {
  workStartMinutes: [0, 1439],
  workEndMinutes: [0, 1439],
  lateThresholdMinutes: [0, 240],
  minAccuracyMeters: [10, 1000],
  cooldownSeconds: [0, 3600],
  noShowAfterMinutes: [30, 720],
  verificationPerDay: [0, 10],
  verificationWindowMinutes: [5, 120],
  arrivalConfirmMinutes: [5, 180],
  verificationQuietWindowMinutes: [15, 360],
  verificationStartGuardMinutes: [0, 240],
  verificationEndGuardMinutes: [0, 240],
  escalationDelayMinutes: [5, 120],
  silentCheckIntervalMinutes: [5, 240],
  remoteWeeklyCap: [0, 7],
  // ===== مركز التحكم (الدفعة أ): الحقول الحية التي كانت مدفونة بلا واجهة =====
  heartbeatGapMinutes: [15, 180],
  conditionalWindowMinutes: [5, 60],
  conditionalCooldownMinutes: [15, 240],
  maxConditionalPerDay: [1, 8],
  maxOutOfZoneMinutes: [10, 120],
  visitReverifyMinutes: [5, 120],
  autoCloseAliveGraceMinutes: [5, 120],
  radarFreshMinutes: [1, 15],
};

/** رموز أيام الأسبوع المقبولة في weekendDays. */
const DAY_CODES = new Set(["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]);

export async function GET() {
  const guard = await requireOwnerApi();
  if (!guard.ok) return guard.res;

  return NextResponse.json({ ok: true, settings: await getAttendanceSettings() });
}

export async function PATCH(req: Request) {
  const guard = await requireOwnerApi();
  if (!guard.ok) return guard.res;

  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "بيانات غير صالحة" }, { status: 400 });
  }

  const data: Record<string, number | boolean> = {};
  for (const [key, [min, max]] of Object.entries(RANGES)) {
    if (raw[key] === undefined) continue;
    const v = Math.round(Number(raw[key]));
    if (!Number.isFinite(v) || v < min || v > max) {
      return NextResponse.json({ ok: false, error: "قيمة خارج الحدود المسموحة" }, { status: 400 });
    }
    data[key] = v;
  }
  if (typeof raw.allowProjectAttendance === "boolean") {
    data.allowProjectAttendance = raw.allowProjectAttendance;
  }
  if (typeof raw.verificationEnabled === "boolean") {
    data.verificationEnabled = raw.verificationEnabled;
  }
  if (typeof raw.leavePausesLeadIntake === "boolean") {
    data.leavePausesLeadIntake = raw.leavePausesLeadIntake;
  }
  // مفاتيح مركز التحكم (الدفعة أ) — نفس نمط المفاتيح أعلاه حرفيًا.
  if (typeof raw.quietWindowCountsCrm === "boolean") {
    data.quietWindowCountsCrm = raw.quietWindowCountsCrm;
  }
  if (typeof raw.autoPunchEnabled === "boolean") {
    data.autoPunchEnabled = raw.autoPunchEnabled;
  }
  if (typeof raw.notifyAutoPunchOwner === "boolean") {
    data.notifyAutoPunchOwner = raw.notifyAutoPunchOwner;
  }
  // أيام الإجازة الأسبوعية — رموز معروفة فقط، وستة أيام إجازة كحد أقصى.
  let weekendDays: string | undefined;
  if (typeof raw.weekendDays === "string") {
    const codes = raw.weekendDays
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter((c) => c.length > 0);
    if (codes.some((c) => !DAY_CODES.has(c)) || codes.length > 6) {
      return NextResponse.json({ ok: false, error: "أيام الإجازة غير صحيحة" }, { status: 400 });
    }
    weekendDays = [...new Set(codes)].join(",");
  }
  if (Object.keys(data).length === 0 && weekendDays === undefined) {
    return NextResponse.json({ ok: false, error: "ما فيه شي للتعديل" }, { status: 400 });
  }

  // نهاية دوام قبل بدايته تجعل «متأخر» بلا معنى — نفحصها على القيم بعد الدمج.
  const current = await getAttendanceSettings();
  const start = (data.workStartMinutes as number) ?? current.workStartMinutes;
  const end = (data.workEndMinutes as number) ?? current.workEndMinutes;
  if (end <= start) {
    return NextResponse.json(
      { ok: false, error: "نهاية الدوام لازم تكون بعد بدايته" },
      { status: 400 },
    );
  }

  const settings = await prisma.attendanceSettings.update({
    where: { id: "singleton" },
    data: { ...data, ...(weekendDays !== undefined ? { weekendDays } : {}) },
  });
  return NextResponse.json({ ok: true, settings });
}
