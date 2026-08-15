import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth-guards";
import { getEmployeeFile } from "@/lib/data/attendance";
import { currentMonthKSA } from "@/lib/attendance-logic";
import { AttendanceEmployeeFile } from "@/components/attendance/attendance-file";

export const dynamic = "force-dynamic";

/**
 * ملف الموظف — المالك فقط: إحصاءات الشهر، دوامه المحدد، سجل الأيام،
 * الاستثناءات، ونداءات التحقق. فلتر الشهر يمرّ بالرابط (?month=) فيجلب الخادم
 * شهرًا كاملًا؛ بحث اليوم client-side ضمن الشهر المحمّل.
 */
export default async function EmployeeAttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  await requireRole(Role.OWNER);

  const { userId } = await params;
  const sp = await searchParams;
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : currentMonthKSA();

  const file = await getEmployeeFile(userId, month);
  if (!file) notFound();

  return (
    <div className="mx-auto max-w-4xl">
      <AttendanceEmployeeFile file={file} />
    </div>
  );
}
