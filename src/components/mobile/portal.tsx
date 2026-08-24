"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * بوابة إلى <body> — الأساس الذي تقوم عليه كل الطبقات العائمة في التطبيق.
 *
 * ⚠️ لماذا نحتاجها أصلًا: صنف `.m-screen` يحمل حركة دخول تنتهي عند
 * `transform: translateY(0) scale(1)` بـ`fill-mode: both`، فتبقى قيمة تحويل
 * غير `none` على العنصر بعد انتهاء الحركة. وأي عنصر بتحويل يصير **الكتلة
 * الحاوية** لأحفاده ذوي `position: fixed` (مواصفة CSS Transforms).
 *
 * النتيجة قبل الإصلاح: الورقة السفلية والشريط الطافي كانا يُثبَّتان على حاوية
 * الصفحة الطويلة لا على الشاشة — فـ`bottom: 0` يقع أسفل المحتوى كله (خارج
 * المرئي) وتظهر الورقة مقطوعة والشريط لا يظهر إطلاقًا.
 *
 * النقل يخرجها من تحت التحويل فترجع `fixed` إلى مرجعها الطبيعي.
 *
 * المضيف: **غلاف الثيم `[data-theme]`** (غلاف /m) لا `<body>` — فتُحلّ توكنات
 * `--m-*`/`--sop-*` داخل البورتالات وتسري أغطية svg في mobile.css ويتبع
 * المحتوى تبديل الليلي/النهاري تلقائيًا (نحن أبناء حامل السمة نفسه، بلا نسخ
 * ولا متابعة). الغلاف نفسه بلا transform (الحركة على `.m-screen` تحته) فمرجع
 * `fixed` سليم. على الويب لا `[data-theme]` ⇒ يسقط لـ`<body>` كالسلوك القائم.
 */
export function MobilePortal({ children }: { children: React.ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  // بعد الترطيب فقط — document غير موجود أثناء التصيير الخادمي.
  useEffect(() => {
    setHost(document.querySelector<HTMLElement>("[data-theme]") ?? document.body);
  }, []);

  if (!host) return null;
  return createPortal(children, host);
}

export default MobilePortal;
