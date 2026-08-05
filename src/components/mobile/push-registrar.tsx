"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toMobileLink } from "@/lib/mobile-link";

/**
 * تسجيل الجهاز لإشعارات Push النيتف — يعمل داخل غلاف Capacitor فقط.
 *
 * لماذا هنا (قشرة /m) لا في كود نيتف: capacitor.config يستخدم server.url
 * فالـWebView يحمّل الواجهة من الإنتاج — أي كود جسر لازم يجي من الخادم.
 *
 * حماية المتصفح العادي: نفحص الكائن العام Capacitor الذي يحقنه الغلاف وحده،
 * وما نستورد البلجن إلا بعد نجاح الفحص (import ديناميكي) — فمستخدم الويب لا
 * يحمّل الحزمة أصلًا ولا يُطلب منه أي إذن.
 */

type CapacitorGlobal = { isNativePlatform?: () => boolean };

declare global {
  interface Window {
    Capacitor?: CapacitorGlobal;
  }
}

const isNative = (): boolean => {
  try {
    return typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
};

export function PushRegistrar() {
  const router = useRouter();

  useEffect(() => {
    if (!isNative()) return;

    let cancelled = false;
    // نمسك مرجع البلجن للتنظيف — الاستيراد ديناميكي فما يتوفّر إلا داخل الـeffect.
    let plugin: typeof import("@capacitor/push-notifications").PushNotifications | null = null;

    (async () => {
      try {
        const { PushNotifications } = await import("@capacitor/push-notifications");
        if (cancelled) return;
        plugin = PushNotifications;

        // الإذن: إلزامي وقت التشغيل من أندرويد ١٣. لو رفضه المستخدم سابقًا،
        // requestPermissions ما يعيد السؤال — نخرج بصمت بلا إزعاج.
        let perm = await PushNotifications.checkPermissions();
        if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
          perm = await PushNotifications.requestPermissions();
        }
        if (cancelled || perm.receive !== "granted") return;

        // التوكن يصل عبر هذا الحدث بعد register() — لا يرجع من الدالة نفسها.
        await PushNotifications.addListener("registration", (token) => {
          fetch("/api/push/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: token.value, platform: "android" }),
            keepalive: true,
          }).catch(() => {}); // فشل الشبكة: المحاولة التالية عند فتح التطبيق
        });

        await PushNotifications.addListener("registrationError", (err) => {
          console.error("[push] فشل التسجيل مع FCM", err);
        });

        // ضغط المستخدم على الإشعار (من شاشة القفل أو الدرج) → افتح العنصر.
        await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
          const raw = action.notification?.data?.link;
          const href = toMobileLink(typeof raw === "string" ? raw : null);
          // مسارات داخلية فقط — حارس ضد أي رابط خارجي في حمولة مدسوسة.
          if (href && href.startsWith("/")) router.push(href);
        });

        await PushNotifications.register();
      } catch (e) {
        console.error("[push] تعذّر تهيئة الإشعارات النيتف", e);
      }
    })();

    return () => {
      cancelled = true;
      plugin?.removeAllListeners().catch(() => {});
    };
  }, [router]);

  return null;
}
