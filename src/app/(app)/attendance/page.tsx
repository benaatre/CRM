import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth-guards";
import { getSettings } from "@/lib/data/settings";
import {
  getAllLocations,
  getLiveBoard,
  getLocationRadar,
  getTeamSummary,
} from "@/lib/data/attendance";
import { currentMonthKSA } from "@/lib/attendance-logic";
import { AttendanceAdmin } from "@/components/attendance/attendance-admin";

export const dynamic = "force-dynamic";

/**
 * حوكمة الدوام — المالك فقط.
 *
 * الحماية على الخادم أولًا: `requireRole(OWNER)` يحوّل غير المالك قبل جلب أي
 * بيانات، وكل مسار API خلف هذي الشاشة يعيد الفحص بنفسه (إخفاء الرابط من القائمة
 * ليس صلاحية).
 */
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const viewer = await requireRole(Role.OWNER, Role.HR, Role.FINANCE);

  // فلتر الفترة في الـURL (?from=&to=) — نفس تحقق مسار live حرفيًا.
  const sp = await searchParams;
  const range =
    sp.from && sp.to && DAY_KEY.test(sp.from) && DAY_KEY.test(sp.to) && sp.from <= sp.to
      ? { fromKey: sp.from, toKey: sp.to }
      : null;

  const month = currentMonthKSA();
  const [locations, live, teamRows, appSettings, radar] = await Promise.all([
    getAllLocations(),
    getLiveBoard(range),
    getTeamSummary(month),
    getSettings(),
    getLocationRadar(),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-foreground">حوكمة الدوام</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          مداومو الآن بعداداتهم، سجل الفريق الشهري، مواقع البصم، والإعدادات — كل تحقّق يتم على الخادم بتوقيت الرياض.
        </p>
      </header>

      <AttendanceAdmin
        locations={locations}
        live={live}
        radar={radar}
        teamMonth={month}
        teamRows={teamRows}
        readOnly={viewer.role !== "OWNER"}
      />

      {appSettings.falLicense && (
        <footer className="pt-2 text-center text-[11.5px] text-muted-foreground/70">
          ترخيص فال (REGA) — {appSettings.falLicense}
        </footer>
      )}
    </div>
  );
}
