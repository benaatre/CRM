"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toMobileLink } from "@/lib/mobile-link";
import { CHANNEL_PREFIX, FALLBACK_CHANNEL } from "@/lib/push/channels";

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

type PluginApi = typeof import("@capacitor/push-notifications").PushNotifications;

type ServerChannel = {
  id: string; category: string; name: string; description: string;
  sound: string; importance: number; vibration: boolean;
};

/**
 * يوائم قنوات الجهاز مع نغمات المالك الحالية.
 *
 * أندرويد يجمّد صوت القناة لحظة إنشائها ولا يقبل تعديله، فتغيير النغمة يعني
 * معرّف قناة جديدًا. لذلك عند كل إقلاع: نقرأ المعرّفات الحالية من الخادم،
 * ننشئ الناقص، ونحذف كل قناة قديمة تحمل بادئتنا ولم تعد ضمنها — وإلا تراكمت
 * في إعدادات النظام قنوات ميتة بأصوات قديمة.
 *
 * قناة الاحتياط (sultan_fallback) لا تُمسّ: هي شبكة الأمان المسجّلة في
 * المانيفست لأي إشعار يسبق إنشاء قناته.
 */
async function syncChannels(plugin: PluginApi): Promise<void> {
  const res = await fetch("/api/push/channels", { cache: "no-store" });
  if (!res.ok) return; // بلا شبكة: القنوات الموجودة من آخر مرة تكفي
  const data = (await res.json()) as { ok?: boolean; channels?: ServerChannel[] };
  const wanted = data.channels ?? [];
  if (wanted.length === 0) return;

  for (const c of wanted) {
    // createChannel لا يغيّر قناة قائمة بنفس المعرّف — وهذا مطلوب: المعرّف
    // مشتقّ من النغمة أصلًا، فوجوده يعني أن صوتها صحيح.
    await plugin.createChannel({
      id: c.id,
      name: c.name,
      description: c.description,
      sound: c.sound,
      importance: c.importance as 1 | 2 | 3 | 4 | 5,
      vibration: c.vibration,
      visibility: 0, // PRIVATE — العنوان على شاشة القفل والتفاصيل محجوبة
    }).catch(() => {});
  }

  // تنظيف القنوات المهجورة (نغمات سابقة + قنوات النسخة الأولى sultan_alerts…).
  const keep = new Set([...wanted.map((c) => c.id), FALLBACK_CHANNEL]);
  const existing = await plugin.listChannels().catch(() => null);
  for (const ch of existing?.channels ?? []) {
    if (ch.id.startsWith(CHANNEL_PREFIX) && !keep.has(ch.id)) {
      await plugin.deleteChannel({ id: ch.id }).catch(() => {});
    }
  }
}

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

        await syncChannels(PushNotifications);
        if (cancelled) return;

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
