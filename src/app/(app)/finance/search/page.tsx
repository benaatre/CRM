import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { requireUser } from "@/lib/auth-guards";
import { fetchFinanceSellers } from "@/lib/actions/finance-clients";
import { FinanceClientSearch } from "@/components/finance/finance-client-search";

export const dynamic = "force-dynamic";

/**
 * بحث برقم الجوال — باب المالي الوحيد للعملاء (سلطة المالي — البند ٦).
 * FINANCE (والمالك للإشراف) حصرًا server-side؛ حجب المالي عن قوائم وملفات
 * العملاء (requireClientAccess) لا يُمسّ — هذا مسار مخصص بحد أدنى من البيانات.
 */
export default async function FinanceSearchPage() {
  const user = await requireUser();
  if (user.role !== Role.FINANCE && user.role !== Role.OWNER) redirect("/dashboard");

  const sellers = await fetchFinanceSellers();
  return <FinanceClientSearch sellers={sellers} />;
}
