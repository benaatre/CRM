"use client";

import { useEffect, useRef } from "react";
import { queryGeoPermission, readBestPosition } from "@/lib/geolocation-permission";

/**
 * النبضة — «آخر ظهور» + (الثقة المتجددة v3) النبض الجغرافي:
 *
 * الخادم يرد `wantGeo: true` لمن يستحق (جلسة مفتوحة + يوم «في الموقع»)،
 * فنقرأ الموقع **بصمت** ونرسله بنبضة ثانية. قواعد صارمة:
 * - لا prompt إذن أبدًا من النبضة: نقرأ فقط إذا الإذن `granted` مسبقًا — الطلب
 *   الرسمي من شاشة التفعيل (الحضور بالرادار — ر١) لا من هنا.
 * - رفق بالبطارية: بلا enableHighAccuracy وبكاش قصير — الحكم خادمي، والدقة
 *   الرديئة تصير «حياة بلا حكم موقع» هناك لا حكمًا خاطئًا هنا.
 * - القراءة تتوقف تلقائيًا بإغلاق التطبيق (لا تتبع بالخلفية — WebView معلّق).
 *
 * ملاحظة: القراءة الحالية لقطة واحدة خفيفة؛ watchPosition + قرار الدقة
 * والهامش تأتي في ر٢ (الحضور بالرادار).
 */
export function Heartbeat() {
  const busyRef = useRef(false);

  useEffect(() => {
    const sendGeo = async () => {
      try {
        // لا نقرأ إلا بإذن قائم — لا prompt من النبض (الطبقة الموحّدة).
        if ((await queryGeoPermission()) !== "granted") return;
        // watchPosition مؤقت (ر٢): يحسّن الدقة تدريجيًا ثم يُوقَف — لا watch دائم
        // يستنزف البطارية. يحسم عند ≤٦٠م أو أفضل تثبيت خلال ٨ث.
        const pos = await readBestPosition({ targetAccuracy: 60, timeoutMs: 8_000 });
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
