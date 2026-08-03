"use client";

import { useEffect } from "react";
import { MOBILE_COLORS } from "@/lib/mobile-tokens";

/**
 * الورقة المنزلقة — قشرة مشتركة لكل الأوراق (متابعة/واتساب).
 * أبعادها من النموذج: زوايا علوية ٢٦ · حشوة 10/18/30 · مقبض ٣٨×٤ · سقف ارتفاع.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  subtitle,
  maxHeight = "76%",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  maxHeight?: string;
  children: React.ReactNode;
}) {
  // قفل تمرير الخلفية ما دامت الورقة مفتوحة.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60]" dir="rtl">
      <button
        aria-label="إغلاق"
        onClick={onClose}
        className="absolute inset-0 h-full w-full"
        style={{ background: "rgba(0,0,0,.55)" }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="absolute inset-x-0 bottom-0 overflow-y-auto"
        style={{
          boxSizing: "border-box",
          background: MOBILE_COLORS.sheet,
          borderTop: `1px solid ${MOBILE_COLORS.border}`,
          borderRadius: "26px 26px 0 0",
          padding: "10px 18px calc(30px + env(safe-area-inset-bottom))",
          maxHeight,
        }}
      >
        <div
          style={{
            boxSizing: "border-box",
            width: 38,
            height: 4,
            borderRadius: 2,
            background: MOBILE_COLORS.dim2,
            margin: "0 auto 16px",
          }}
          aria-hidden
        />
        <div style={{ fontSize: 19, fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>{title}</div>
        {subtitle ? (
          <div style={{ fontSize: "12.5px", color: MOBILE_COLORS.textMuted, marginTop: 5 }}>
            {subtitle}
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}

export default BottomSheet;
