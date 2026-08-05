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
 * النقل إلى <body> يخرجها من تحت التحويل فترجع `fixed` إلى مرجعها الطبيعي.
 */
export function MobilePortal({ children }: { children: React.ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  // بعد الترطيب فقط — document غير موجود أثناء التصيير الخادمي.
  useEffect(() => setHost(document.body), []);

  if (!host) return null;
  return createPortal(children, host);
}

export default MobilePortal;
