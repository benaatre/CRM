import { notFound } from "next/navigation";
import { Zain } from "next/font/google";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth-guards";
import { buildEmployeeFileBundle, type BundleQuery } from "@/lib/data/employee-file-extras";
import { EmployeeFileView } from "@/components/employee-file/employee-file-view";

export const dynamic = "force-dynamic";

const zain = Zain({ subsets: ["arabic"], weight: ["700", "800"], variable: "--font-zain", display: "swap" });

/**
 * ملف الموظف الكامل — المالك فقط (المرجع الملزم docs/design/employee-file-2026.html).
 * كل الفلاتر (p/view/month/from/to) تمرّ بالرابط فيجلبها الخادم من السطح القائم.
 */
export default async function EmployeeFilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<BundleQuery>;
}) {
  const viewer = await requireRole(Role.OWNER, Role.HR, Role.FINANCE);
  const { id } = await params;
  const sp = await searchParams;

  const bundle = await buildEmployeeFileBundle(id, sp);
  if (!bundle) notFound();

  return (
    <div className={zain.variable}>
      <EmployeeFileView bundle={bundle} viewerRole={viewer.role as "OWNER" | "HR" | "FINANCE"} basePath={`/employees/${id}`} />
    </div>
  );
}
