"use client";

import { useEffect } from "react";
import { MOBILE_COLORS } from "@/lib/mobile-tokens";
import { MobilePortal } from "@/components/mobile/portal";

/**
 * الورقة المنزلقة — قشرة مشتركة لكل الأوراق في التطبيق.
 *
 * ⚠️ بنية ثلاثية ثابتة تمنع القصّ من الأسفل (كان زرّ التأكيد يختفي تحت الحافة):
 *   ① الرأس  — ثابت لا يمرّ (المقبض + العنوان).
 *   ② الجسم  — هو **وحده** الذي يمرّر (`flex: 1` + `overflow-y: auto`).
 *   ③ التذييل — لاصق أسفل الورقة، دائم الظهور، والمحتوى يمرّ خلفه.
 *
 * الارتفاع بـ`dvh` لا `vh`: في WebView أندرويد الـviewport التخطيطي أطول من
 * المرئي، فالنسبة تُحسب على ارتفاع أكبر من الشاشة ويقع أسفل الورقة تحت الحافة.
 *
 * الحشوة السفلية = `env(safe-area-inset-bottom)` فقط (بلا ارتفاع الشريط السفلي):
 * الورقة كلها z-60 فوق الشريط (z-50) وتغطّيه، فإضافة ارتفاعه تترك فجوة ميّتة.
 * ارتفاع الشريط (`--m-tabbar-h`) يخصّ الأشرطة الطافية التي **تتعايش** معه.
 *
 * ⚠️⚠️ الورقة تُنقل إلى <body> عبر `MobilePortal`. بدونها تقع تحت `.m-screen`
 * صاحبة التحويل الباقي، فتصير هي الكتلة الحاوية لـ`position: fixed` — وتُثبَّت
 * الورقة على حاوية الصفحة الطويلة لا على الشاشة، فتظهر مقطوعة ويختفي زرّها.
 * هذا كان السبب الجذري لـ«الأوراق متآكلة»، لا الارتفاع ولا الحشوة.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  subtitle,
  maxHeight = "92dvh",
  tall = false,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  maxHeight?: string;
  /**
   * الأوراق الطويلة (نماذج وجداول) — تفتح بارتفاع شبه كامل فورًا بدل ما تتمدّد
   * مع المحتوى. يمنع «تفتح صغيرة ثم تُقصّ» عند تحميل حقول متأخرة (المصادر مثلًا).
   */
  tall?: boolean;
  /** زر التأكيد/الإجراء — يُثبَّت أسفل الورقة فلا يحتاج تمريرًا للوصول إليه. */
  footer?: React.ReactNode;
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
    <MobilePortal>
    <div className="fixed inset-0 z-[60]" dir="rtl" style={{ height: "100dvh" }}>
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
        className="m-sheet absolute inset-x-0 bottom-0 flex flex-col"
        style={{
          boxSizing: "border-box",
          background: MOBILE_COLORS.sheet,
          borderTop: `1px solid ${MOBILE_COLORS.border}`,
          borderRadius: "26px 26px 0 0",
          maxHeight,
          ...(tall ? { height: maxHeight } : {}),
        }}
      >
        {/* ① الرأس — خارج منطقة التمرير فيبقى العنوان ظاهرًا */}
        <div style={{ flex: "none", padding: "10px 18px 0" }}>
          <div
            style={{
              boxSizing: "border-box", width: 38, height: 4, borderRadius: 2,
              background: MOBILE_COLORS.dim2, margin: "0 auto 16px",
            }}
            aria-hidden
          />
          <div style={{ fontSize: 19, fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>{title}</div>
          {subtitle ? (
            <div style={{ fontSize: "12.5px", color: MOBILE_COLORS.textMuted, marginTop: 5 }}>
              {subtitle}
            </div>
          ) : null}
        </div>

        {/* ② الجسم — التمرير هنا وحده، وبلا سحب الصفحة الأم عند بلوغ الحافة */}
        <div
          className="m-noscroll"
          style={{
            boxSizing: "border-box",
            flex: "1 1 auto",
            minHeight: 0,
            overflowY: "auto",
            overscrollBehavior: "contain",
            WebkitOverflowScrolling: "touch",
            padding: footer
              ? "0 18px 14px"
              : "0 18px calc(22px + env(safe-area-inset-bottom))",
          }}
        >
          {children}
        </div>

        {/* ③ التذييل — لاصق، دائم الظهور فوق شريط الإيماءات */}
        {footer ? (
          <div
            style={{
              boxSizing: "border-box",
              flex: "none",
              padding: "12px 18px calc(14px + env(safe-area-inset-bottom))",
              borderTop: `1px solid ${MOBILE_COLORS.line3}`,
              background: MOBILE_COLORS.sheet,
            }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>
    </MobilePortal>
  );
}

export default BottomSheet;
