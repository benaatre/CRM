"use client";

import { useRouter } from "next/navigation";

/**
 * زر «رجوع للخلف» — العميل الوحيد في صفحات «غير موجود» (تحتاج history.back).
 * بلا تنسيق خاص به: النمط يصل من الصفحة المستضيفة (توكنز الويب أو الجوال)
 * فيخدم السياقين بلا تكرار مكوّن.
 */
export function BackButton({
  label = "رجوع للخلف",
  className,
  style,
}: {
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const router = useRouter();
  return (
    <button type="button" onClick={() => router.back()} className={className} style={style}>
      {label}
    </button>
  );
}

export default BackButton;
