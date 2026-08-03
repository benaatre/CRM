import { MOBILE_COLORS } from "@/lib/mobile-tokens";

/** لوحة المالك — تُستبدل باللوحة الفعلية (isOwnerHome) في قسمها. */
export function MobileOwnerHome(_props: { user: { name?: string | null } }) {
  return (
    <div
      className="rounded-xl p-5 text-center"
      style={{ backgroundColor: MOBILE_COLORS.card, color: MOBILE_COLORS.textSecondary }}
    >
      <h1 className="text-base font-medium text-white">لوحة المالك</h1>
      <p className="mt-2 text-sm">قيد الإنشاء</p>
    </div>
  );
}

export default MobileOwnerHome;
