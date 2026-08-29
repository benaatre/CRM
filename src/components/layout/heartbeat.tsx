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
 * - (دفعة إغلاق النبض) **النبضة الأولى لكل فترة مقدّمة** تحمل الموقع مباشرة —
 *   فقط والإذن `granted` مؤكَّدًا والموافقة قائمة (ذاكرتها المحلية المزامَنة من
 *   حقيقة الخادم) — فمن يفتح التطبيق دقيقة ليبصم يولّد نبضة جغرافية بلا
 *   انتظار دورة wantGeo كاملة. الخادم يظل الحاكم: غير المستحق تُهمل إحداثياته.
 * - رفق بالبطارية: بلا enableHighAccuracy وبكاش قصير — الحكم خادمي، والدقة
 *   الرديئة تصير «حياة بلا حكم موقع» هناك لا حكمًا خاطئًا هنا.
 * - القراءة تتوقف تلقائيًا بإغلاق التطبيق (لا تتبع بالخلفية — WebView معلّق).
 *
 * ملاحظة: القراءة الحالية لقطة واحدة خفيفة؛ watchPosition + قرار الدقة
 * والهامش تأتي في ر٢ (الحضور بالرادار).
 */
/**
 * تعطيل «النبضة الأولى بالموقع» (طوارئ 2026-08-27 — تراجع جراحي لسلوك النشرة ٦):
 * فتح watchPosition عند كل فتحة/رجوع للمقدمة (a0c25ae) تزامن مع تسمم قراءات
 * getCurrentPosition على عدة أجهزة iOS (البلجن يتوقف عن الرد والويب سليم) —
 * ساعات مراقبة يتيمة محتملة على CLLocationManager تتراكم عبر الفتحات.
 * true = نبضة الفتح بلا قراءة موقع كما في 30122ad (آخر سلوك native مؤكد العمل
 * 25/08)؛ النبض الدوري ومسار wantGeo يبقيان كما هما. الكود نفسه محفوظ أدناه.
 */
const FIRST_BEAT_COORDS_DISABLED: boolean = true;

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

    /**
     * موقع للنبضة الأولى — فقط والإذن `granted` مؤكَّدًا (الطبقة الموحّدة:
     * تشمل المسار الأصلي وذاكرة المنحة) والموافقة قائمة. أي تعذّر = نبضة
     * عادية بلا موقع — مسار wantGeo القائم يغطي البقية. **صفر prompt**.
     */
    const firstBeatCoords = async (): Promise<{ lat: number; lng: number; accuracy: number } | null> => {
      try {
        if (window.localStorage.getItem("attendance-geo-consent-v3") !== "1") return null;
        if ((await queryGeoPermission()) !== "granted") return null;
        const pos = await readBestPosition({ targetAccuracy: 60, timeoutMs: 8_000 });
        return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
      } catch {
        return null;
      }
    };

    let timer: ReturnType<typeof setTimeout> | null = null;
    let delay = 120_000;

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void ping(), delay);
    };

    const ping = async (firstOfForeground = false) => {
      if (busyRef.current) {
        schedule();
        return;
      }
      busyRef.current = true;
      try {
        const coords = !FIRST_BEAT_COORDS_DISABLED && firstOfForeground ? await firstBeatCoords() : null;
        const res = await fetch("/api/heartbeat", {
          method: "POST",
          ...(coords
            ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(coords) }
            : {}),
        });
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

    void ping(true);
    // رجوع التطبيق للمقدمة = نبضة فورية — يسرّع البصم التلقائي وكشف الرجوع
    // بعد الاستئذان بلا انتظار الدورة. أول نبضة الرجوع تحمل الموقع كذلك.
    const onVisible = () => {
      if (document.visibilityState === "visible") void ping(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
