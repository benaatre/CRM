import { requireManager } from "@/lib/auth-guards";
import { getLeads, getEmployees } from "@/lib/data/leads";
import { MOBILE_COLORS } from "@/lib/mobile-tokens";
import { toArabicDigits, elapsedLabel } from "@/lib/mobile-format";
import { MobileUnassignedPanel, type UnassignedRow } from "@/components/mobile/unassigned-panel";

export const dynamic = "force-dynamic";

/**
 * «غير موزّعين» — تبويب المالك في الشريط السفلي. غلاف جوال لتبويب unassigned
 * في شاشة عملاء الديسكتوب بكامل أدواته (طرق الإضافة + التوزيع + التحديد اليدوي).
 *
 * الحارس requireManager(): تبويب الإدارة (مالك + أدمن) — نفس حارس أكشنات
 * التوزيع نفسها (distributeUnassigned/Custom/LeastLoaded · transferLeads).
 */
export default async function MobileUnassignedPage() {
  await requireManager();

  const now = new Date();
  const [leads, employees] = await Promise.all([
    // نفس المصدر المحجَّم: tab=unassigned يستثني المؤرشف والمكرر بمنطق الخادم.
    getLeads({ tab: "unassigned", sort: "newest" }),
    getEmployees(),
  ]);

  const rows: UnassignedRow[] = leads.map((l) => ({
    id: l.id,
    name: l.name,
    phone: l.phone,
    channel: l.channel,
    agoText: l.createdAt ? `من ${elapsedLabel(l.createdAt, now)}` : "—",
    inAutoPool: l.inAutoPool,
  }));

  return (
    <div className="m-screen flex flex-col" style={{ gap: 13 }}>
      <div style={{ padding: "0 2px" }}>
        <h1 style={{ fontSize: 21, fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>غير موزّعين</h1>
        <div style={{ fontSize: "12.5px", color: MOBILE_COLORS.textMuted, marginTop: 4 }}>
          {toArabicDigits(rows.length)} عميل بانتظار التوزيع
        </div>
      </div>

      <MobileUnassignedPanel rows={rows} employees={employees} isManager />
    </div>
  );
}
