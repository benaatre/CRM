"use client";

import { useEffect, useState } from "react";
import { MOBILE_COLORS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";
import { shellElapsedMinutes, useAttendanceShell } from "@/components/mobile/attendance-shell";

/**
 * شارة «مداوم» على التحية — نقطة نابضة + عدّاد س:دد حي (الديوان §١).
 *
 * عرض بحت من مزوّد القشرة: تظهر فقط والجلسة مفتوحة (وليست توقف عدم رد —
 * ذاك له شاشته الحرجة بالبطاقة). العدّاد بدقة الدقيقة، والتوقف الجاري
 * يجمّده تلقائيًا لأن المعادلة تخصم التوقفات (نفس حساب البطاقة).
 */
export function AttendanceBadge() {
  const shell = useAttendanceShell();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const s = shell?.status;
  if (!shell?.active || !s || s.state !== "in" || s.noResponse) return null;

  const minutes = shellElapsedMinutes(s, now);
  const label = `${toArabicDigits(Math.floor(minutes / 60))}:${toArabicDigits(String(minutes % 60).padStart(2, "0"))}`;

  return (
    <span
      className="inline-flex flex-none items-center"
      style={{
        gap: 6, fontSize: 10, fontWeight: 600, color: MOBILE_COLORS.dwGreen,
        background: MOBILE_COLORS.dwGreenDim, borderRadius: 8, padding: "4px 9px",
      }}
    >
      <span aria-hidden className="m-pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: MOBILE_COLORS.dwGreen }} />
      مداوم
      <span dir="ltr" style={{ fontFamily: "var(--font-zain), var(--font-sans)", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
        {label}
      </span>
    </span>
  );
}

export default AttendanceBadge;
