import "server-only";

import type { AttendanceSchedule, AttendanceSettings } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ksaDayKey } from "@/lib/ksa-time";
import { parseWeekendDays, resolveEnforcement } from "@/lib/attendance-logic";
import { getAttendanceSettings } from "@/lib/data/attendance";

/**
 * الإعدادات الفعلية لكل موظف (ملف الموظف الحي) — **نقطة القراءة الوحيدة** لكل
 * مستهلكي v3: دمج تخصيصات AttendanceSchedule فوق AttendanceSettings العام،
 * وكل null يسقط للقيمة العامة (توافق خلفي حرفي: من لا تخصيص له = السلوك القديم).
 *
 * EXEMPT منتهي المدة (exemptUntil < اليوم) يُعامل STRICT وقت القراءة — لا كرون إعادة.
 */

export type EnforcementMode = "STRICT" | "WATCH_ONLY" | "EXEMPT";

export type EffectiveAttendanceConfig = {
  mode: EnforcementMode;
  exemptUntilKey: string | null;
  exemptReason: string | null;
  startMinutes: number;
  shiftMinutes: number;
  startWindowEndMinutes: number | null;
  verificationPerDay: number;
  weekendDays: string;
  weekendSet: Set<number>;
  outZoneCallEnabled: boolean;
  dayLockEnabled: boolean;
  notifyMissedCall: boolean;
  watchFromMinutes: number;
  watchToMinutes: number;
  watchAlertFirstSeen: boolean;
  /** أعلام «مخصّص» للواجهة — أي حقل تخصيص غير null. */
  custom: {
    verificationPerDay: boolean;
    weekendDays: boolean;
    outZoneCallEnabled: boolean;
    dayLockEnabled: boolean;
    notifyMissedCall: boolean;
  };
  /** الإلزام فعّال (نداءات/غياب/تأخر/شاشة الحسم) — STRICT فقط. */
  enforced: boolean;
};

export function mergeConfig(
  settings: AttendanceSettings,
  row: AttendanceSchedule | null,
  now: Date = new Date(),
): EffectiveAttendanceConfig {
  const mode = resolveEnforcement(row?.enforcementMode ?? null, row?.exemptUntil ?? null, ksaDayKey(now));
  const weekendDays = row?.weekendDays ?? settings.weekendDays;
  return {
    mode,
    exemptUntilKey: row?.exemptUntil ? row.exemptUntil.toISOString().slice(0, 10) : null,
    exemptReason: row?.exemptReason ?? null,
    startMinutes: row?.startMinutes ?? 540,
    shiftMinutes: row?.shiftMinutes ?? 480,
    startWindowEndMinutes: row?.startWindowEndMinutes ?? null,
    verificationPerDay: row?.verificationPerDay ?? settings.verificationPerDay,
    weekendDays,
    weekendSet: parseWeekendDays(weekendDays),
    outZoneCallEnabled: row?.outZoneCallEnabled ?? true,
    dayLockEnabled: row?.dayLockEnabled ?? false,
    notifyMissedCall: row?.notifyMissedCall ?? true,
    watchFromMinutes: row?.watchFromMinutes ?? 480,
    watchToMinutes: row?.watchToMinutes ?? 1320,
    watchAlertFirstSeen: row?.watchAlertFirstSeen ?? false,
    custom: {
      verificationPerDay: row?.verificationPerDay != null,
      weekendDays: row?.weekendDays != null,
      outZoneCallEnabled: row?.outZoneCallEnabled != null,
      dayLockEnabled: row?.dayLockEnabled != null,
      notifyMissedCall: row?.notifyMissedCall != null,
    },
    enforced: mode === "STRICT",
  };
}

/** إعدادات موظف واحد. */
export async function effectiveConfigFor(
  userId: string,
  pre?: { settings?: AttendanceSettings; row?: AttendanceSchedule | null },
  now: Date = new Date(),
): Promise<EffectiveAttendanceConfig> {
  const [settings, row] = await Promise.all([
    pre?.settings ? Promise.resolve(pre.settings) : getAttendanceSettings(),
    pre?.row !== undefined ? Promise.resolve(pre.row) : prisma.attendanceSchedule.findUnique({ where: { userId } }),
  ]);
  return mergeConfig(settings, row, now);
}

/** دفعة (الكرون/اللوحات): خريطة userId → الإعدادات الفعلية — استعلامان فقط. */
export async function effectiveConfigsFor(
  userIds: string[],
  now: Date = new Date(),
): Promise<Map<string, EffectiveAttendanceConfig>> {
  const [settings, rows] = await Promise.all([
    getAttendanceSettings(),
    userIds.length ? prisma.attendanceSchedule.findMany({ where: { userId: { in: userIds } } }) : Promise.resolve([]),
  ]);
  const byUser = new Map(rows.map((r) => [r.userId, r]));
  return new Map(userIds.map((id) => [id, mergeConfig(settings, byUser.get(id) ?? null, now)]));
}
