import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth-guards";
import { buildEmployeeFileBundle, type BundleQuery } from "@/lib/data/employee-file-extras";
import { EmployeeFileView } from "@/components/employee-file/employee-file-view";

export const dynamic = "force-dynamic";

/**
 * ملف الموظف الكامل — نسخة الجوال (المالك فقط). نفس مكوّن الكابينة؛ نقطة كسر
 * المرجع (٩٨٠px) تطوي الأعمدة لعمود واحد، وأهداف اللمس ≥٤٤px من أنماط الملف.
 * خط Zain يوفره تخطيط /m أصلًا.
 */
export default async function MobileEmployeeFilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<BundleQuery>;
}) {
  await requireRole(Role.OWNER);
  const { id } = await params;
  const sp = await searchParams;

  const bundle = await buildEmployeeFileBundle(id, sp);
  if (!bundle) notFound();

  return <EmployeeFileView bundle={bundle} basePath={`/m/employees/${id}`} />;
}
