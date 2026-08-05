"use client";

import { MOBILE_COLORS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";
import { MobilePortal } from "@/components/mobile/portal";

/**
 * شريط الإجراءات الطافي في وضع التحديد — يجلس **فوق** الشريط السفلي.
 *
 * ⚠️ يمرّ عبر `MobilePortal` للسبب نفسه الذي تمرّ لأجله الورقة: `.m-screen`
 * تحمل تحويلًا باقيًا فتصير الكتلة الحاوية لأي `position: fixed` تحتها، فيسقط
 * الشريط أسفل حاوية الصفحة الطويلة — خارج الشاشة تمامًا (كان لا يظهر إطلاقًا).
 */
export function MobileActionBar({
  count,
  children,
}: {
  /** عدد المحدّدين — يظهر ذهبيًا في صدر الشريط. */
  count: number;
  children: React.ReactNode;
}) {
  return (
    <MobilePortal>
      <div className="m-actionbar mx-auto w-full max-w-lg" style={{ padding: "0 18px" }} dir="rtl">
        <div
          className="m-noscroll flex items-center overflow-x-auto"
          style={{
            boxSizing: "border-box", gap: 7, borderRadius: 16, padding: "9px 11px",
            background: MOBILE_COLORS.sheet, border: `1px solid ${MOBILE_COLORS.goldBorder}`,
            boxShadow: "0 12px 30px rgba(0,0,0,.4)",
          }}
        >
          <span
            className="flex flex-none items-center justify-center"
            style={{
              boxSizing: "border-box", minWidth: 26, height: 26, borderRadius: 13, padding: "0 7px",
              background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg, fontSize: 12, fontWeight: 700,
            }}
          >
            {toArabicDigits(count)}
          </span>
          {children}
        </div>
      </div>
    </MobilePortal>
  );
}

export default MobileActionBar;
