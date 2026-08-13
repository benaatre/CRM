import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth-guards";
import { getSettings } from "@/lib/data/settings";
import {
  getAllLocations,
  getAttendanceBoard,
  getAttendanceSettings,
} from "@/lib/data/attendance";
import { AttendanceAdmin } from "@/components/attendance/attendance-admin";

export const dynamic = "force-dynamic";

/**
 * حوكمة الدوام — المالك فقط.
 *
 * الحماية على الخادم أولًا: `requireRole(OWNER)` يحوّل غير المالك قبل جلب أي
 * بيانات، وكل مسار API خلف هذي الشاشة يعيد الفحص بنفسه (إخفاء الرابط من القائمة
 * ليس صلاحية).
 */
export default async function AttendancePage() {
  await requireRole(Role.OWNER);

  const [locations, settings, board, appSettings] = await Promise.all([
    getAllLocations(),
    getAttendanceSettings(),
    getAttendanceBoard(),
    getSettings(),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-foreground">حوكمة الدوام</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          مواقع البصم ونطاقاتها، أوقات الدوام، وحالة الفريق اليوم — كل تحقّق يتم على الخادم بتوقيت الرياض.
        </p>
      </header>

      <AttendanceAdmin locations={locations} settings={settings} board={board} />

      {appSettings.falLicense && (
        <footer className="pt-2 text-center text-[11.5px] text-muted-foreground/70">
          ترخيص فال (REGA) — {appSettings.falLicense}
        </footer>
      )}
    </div>
  );
}
