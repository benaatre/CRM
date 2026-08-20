import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth-guards";

export const dynamic = "force-dynamic";

/**
 * المسار القديم لملف الدوام — يحوّل خادميًا لملف الموظف الكامل /employees/[id]
 * (قرار توحيد المداخل 2026-08-19) مع تمرير ?month. الملفات القديمة باقية
 * (AttendanceEmployeeFile صار يتيمًا غير مستدعى — لا حذف).
 */
export default async function EmployeeAttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  await requireRole(Role.OWNER, Role.HR, Role.FINANCE);

  const { userId } = await params;
  const sp = await searchParams;
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : null;

  redirect(`/employees/${userId}${month ? `?month=${month}` : ""}`);
}
