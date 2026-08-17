"use client";

import { useEffect, useRef } from "react";

/**
 * النبضة كل دقيقتين — «آخر ظهور» + (الثقة المتجددة v3) النبض الجغرافي:
 *
 * الخادم يرد `wantGeo: true` لمن يستحق (جلسة مفتوحة + يوم «في الموقع»)،
 * فنقرأ الموقع **بصمت** ونرسله بنبضة ثانية. قواعد صارمة:
 * - لا prompt إذن أبدًا من النبضة: نقرأ فقط إذا الإذن ممنوح مسبقًا
 *   (navigator.permissions) — أول منح يحدث عند البصمة بموافقة الإفصاح v3.
 * - رفق بالبطارية: بلا enableHighAccuracy وبكاش ٩٠ ثانية — الحكم خادمي،
 *   والدقة الرديئة تصير «حياة بلا حكم موقع» هناك لا حكمًا خاطئًا هنا.
 * - القراءة تتوقف تلقائيًا بإغلاق التطبيق (لا تتبع بالخلفية — WebView معلّق).
 */
export function Heartbeat() {
  const busyRef = useRef(false);

  useEffect(() => {
    const sendGeo = async () => {
      try {
        // لا نقرأ إلا بإذن قائم — المتصفحات بلا permissions API تُتخطى بصمت.
        if (typeof navigator === "undefined" || !navigator.geolocation) return;
        if (navigator.permissions?.query) {
          const st = await navigator.permissions.query({ name: "geolocation" });
          if (st.state !== "granted") return;
        }
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: false,
            maximumAge: 90_000,
            timeout: 10_000,
          });
        });
        await fetch("/api/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          }),
        });
      } catch {
        /* صامت بالتعريف — النبضة العادية وصلت أصلًا */
      }
    };

    let timer: ReturnType<typeof setTimeout> | null = null;
    let delay = 120_000;

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void ping(), delay);
    };

    const ping = async () => {
      if (busyRef.current) {
        schedule();
        return;
      }
      busyRef.current = true;
      try {
        const res = await fetch("/api/heartbeat", { method: "POST" });
        const data = (await res.json().catch(() => null)) as { wantGeo?: boolean; openSession?: boolean } | null;
        if (data?.wantGeo) await sendGeo();
        // قرار ١٠ (الدوام الواقعي): أثناء جلسة مفتوحة النبض كل دقيقة — المراقبة بالدقيقة.
        delay = data?.openSession ? 60_000 : 120_000;
      } catch {
        /* الشبكة راحت — النبضة القادمة بموعدها */
      }
      busyRef.current = false;
      schedule();
    };

    void ping();
    // رجوع التطبيق للمقدمة = نبضة فورية — يسرّع البصم التلقائي وكشف الرجوع
    // بعد الاستئذان بلا انتظار الدورة.
    const onVisible = () => {
      if (document.visibilityState === "visible") void ping();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
