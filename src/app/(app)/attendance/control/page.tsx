import { Role } from "@prisma/client";
import { requireRole, TRACKED_ROLES } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { getAttendanceSettings } from "@/lib/data/attendance";
import { ControlCenter } from "@/components/attendance/control-center";

export const dynamic = "force-dynamic";

/**
 * مركز التحكم — إعدادات الحضور (الدفعة أ). المالك حصرًا server-side؛
 * خلَف تبويب «الإعدادات» في لوحة حوكمة الدوام (لا سطحين إعدادات).
 * المرجع البصري: docs/design/control-center-v2.html — بوابات ست: رئيسية ← صفحات.
 */
export default async function ControlCenterPage() {
  await requireRole(Role.OWNER);

  const [settings, users, schedules, routees] = await Promise.all([
    getAttendanceSettings(),
    prisma.user.findMany({
      where: { role: { in: TRACKED_ROLES }, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.attendanceSchedule.findMany(),
    // مرشحو توزيع التنبيهات (الدفعة ب): المالك والإدارة النشطون.
    prisma.user.findMany({
      where: { role: { in: [Role.OWNER, Role.ADMIN] }, active: true },
      select: { id: true, name: true, role: true },
      orderBy: { role: "asc" },
    }),
  ]);

  const rowByUser = new Map(schedules.map((s) => [s.userId, s]));
  const employees = users.map((u) => {
    const s = rowByUser.get(u.id) ?? null;
    // «مخصص» = أي انحراف عن العام: وردية غير الافتراضي، وضع غير STRICT، أو أي حقل تخصيص.
    const custom =
      !!s &&
      (s.startMinutes !== 540 ||
        s.shiftMinutes !== 480 ||
        s.startWindowEndMinutes !== null ||
        s.enforcementMode !== "STRICT" ||
        s.verificationPerDay !== null ||
        s.weekendDays !== null ||
        s.outZoneCallEnabled !== null ||
        s.dayLockEnabled !== null ||
        s.notifyMissedCall !== null);
    return { id: u.id, name: u.name, startMinutes: s?.startMinutes ?? null, custom };
  });

  return <ControlCenter settings={settings} employees={employees} routees={routees} />;
}
