"use client";

import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { ExternalLink as ExternalIcon } from "lucide-react";
import { MOBILE_COLORS } from "@/lib/mobile-tokens";

/** أصل الإنتاج — الروابط الخارجية لازم تكون مطلقة داخل التطبيق الأصلي. */
const WEB_ORIGIN = "https://crm.benaatre.com";

/**
 * رابط لشاشة ويب لا مقابل لها في /m.
 *
 * ⚠️ `target="_blank"` **لا يخرج من WebView** في Capacitor — يفتح الويب الكامل
 * داخل التطبيق فيضيع الموظف بلا شريط سفلي ولا رجوع. لذلك:
 * - داخل التطبيق الأصلي: `Browser.open` (Custom Tab بمتصفح النظام، وله زر إغلاق يرجّعه).
 * - في المتصفح العادي: تبويب جديد كالمعتاد.
 */
export function MobileExternalLink({
  href,
  children,
  className,
  style,
  showIcon = true,
}: {
  /** مسار مطلق يبدأ بـ/ (يُضاف الأصل تلقائيًا في التطبيق). */
  href: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  showIcon?: boolean;
}) {
  const absolute = href.startsWith("http") ? href : `${WEB_ORIGIN}${href}`;

  const open = async (e: React.MouseEvent) => {
    if (!Capacitor.isNativePlatform()) return; // المتصفح: اترك السلوك الافتراضي
    e.preventDefault();
    await Browser.open({ url: absolute, presentationStyle: "popover" });
  };

  return (
    <a href={absolute} target="_blank" rel="noopener noreferrer" onClick={open} className={className} style={style}>
      {children}
      {showIcon && (
        <ExternalIcon
          size={13}
          style={{ color: MOBILE_COLORS.textMuted, flex: "none", marginInlineStart: 6 }}
          aria-label="يفتح في المتصفح"
        />
      )}
    </a>
  );
}

export default MobileExternalLink;
