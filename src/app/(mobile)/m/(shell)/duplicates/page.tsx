import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth-guards";
import { getDuplicateLeads } from "@/lib/data/duplicates";
import { getEmployees } from "@/lib/data/leads";
import { MOBILE_COLORS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";
import { MobileDuplicatesPanel } from "@/components/mobile/duplicates-panel";

export const dynamic = "force-dynamic";

/**
 * العملاء المكررون — غلاف جوال لنفس مصدرَي الديسكتوب حرفيًا
 * ((app)/leads/duplicates/page.tsx): الحارس requireRole(OWNER) والبيانات من
 * getDuplicateLeads() + getEmployees() (قائمة الموظفين لحوار التوزيع).
 * الأدوات كلها في اللوحة: فلاتر المدى · توزيع · سحب · حذف (أرشفة كمكرر).
 */
export default async function MobileDuplicatesPage() {
  await requireRole(Role.OWNER); // المالك فقط — نفس فحص الديسكتوب.
  const [data, employees] = await Promise.all([getDuplicateLeads(), getEmployees()]);

  return (
    <div className="m-screen flex flex-col" style={{ gap: 13 }}>
      <div className="flex items-center" style={{ gap: 11 }}>
        <Link href="/m/more" aria-label="رجوع" className="flex items-center justify-center"
          style={{ minWidth: 44, minHeight: 44, marginInlineStart: -10, color: MOBILE_COLORS.textPrimary }}>
          <ChevronLeft size={20} strokeWidth={2} style={{ transform: "scaleX(-1)" }} aria-hidden />
        </Link>
        <div>
          <h1 style={{ fontSize: 17, fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>العملاء المكررون</h1>
          <div style={{ fontSize: "11.5px", color: MOBILE_COLORS.textMuted, marginTop: 3 }}>
            {toArabicDigits(data.totalGroups)} مجموعة
            {data.newTodayGroups > 0 ? ` · ${toArabicDigits(data.newTodayGroups)} جديدة اليوم` : ""}
            {" — محجوبة عن التوزيع التلقائي حتى تُحلّ"}
          </div>
        </div>
      </div>

      <MobileDuplicatesPanel
        groups={data.groups}
        totalGroups={data.totalGroups}
        newTodayGroups={data.newTodayGroups}
        employees={employees}
      />
    </div>
  );
}
