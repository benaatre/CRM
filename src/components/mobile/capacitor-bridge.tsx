"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { takeRecentCall } from "@/lib/mobile-call-tracker";

/**
 * جسر Capacitor — يعمل داخل التطبيق الأصلي فقط (isNativePlatform).
 *
 * العودة للمقدمة بعد «اتصال» خلال آخر ٥ دقائق ⟵ فتح ملف العميل بورقة
 * تسجيل النتيجة (?log=call) — فلا مكالمة تضيع بلا تسجيل.
 * في المتصفح العادي: لا مستمعين ولا أي أثر.
 */
export function CapacitorBridge() {
  const router = useRouter();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const sub = App.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) return;
      const recent = takeRecentCall();
      if (recent) router.push(`/m/leads/${recent.leadId}?log=call`);
    });

    return () => {
      sub.then((h) => h.remove()).catch(() => {});
    };
  }, [router]);

  return null;
}

export default CapacitorBridge;
