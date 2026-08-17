/**
 * طبقة إذن الموقع الموحّدة (الحضور بالرادار — ر١) — عميل فقط.
 *
 * تعمل عبر Web Geolocation API + navigator.permissions، فتغطّي المتصفح
 * وWebView أندرويد (يرث إذن التطبيق من AndroidManifest). طبقة native
 * (@capacitor/geolocation + Info.plist) تُضاف في مرحلة البناء المنفصلة — هذا
 * الملف مكتوب ليُلفّ لاحقًا بلا تغيير واجهته.
 *
 * الحقيقة الحاكمة (من البحث): الإذن يُمنح فقط لحظة طلب موقع فعلي — فالطلب
 * الرسمي يُطلق من زر صريح (شاشة التفعيل / «أنا موجود بالموقع») لا من النبض.
 */

export type GeoPermState = "granted" | "prompt" | "denied" | "unavailable";

/** حالة الإذن الحالية — بلا إطلاق أي طلب. `unavailable` = لا API إطلاقًا. */
export async function queryGeoPermission(): Promise<GeoPermState> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return "unavailable";
  // بعض المتصفحات/الـWebViews لا تدعم permissions.query لـgeolocation — نفترض
  // «prompt» بأمان (شاشة التفعيل تظهر، والطلب الفعلي يحسم الحالة الحقيقية).
  if (!navigator.permissions?.query) return "prompt";
  try {
    const st = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    // «prompt-with-rationale» (أندرويد) تُعامل كـprompt.
    return st.state === "granted" ? "granted" : st.state === "denied" ? "denied" : "prompt";
  } catch {
    return "prompt";
  }
}

/** يشترك على تغيّر حالة الإذن — يرجّع دالة إلغاء. لا onchange؟ لا اشتراك. */
export function onGeoPermissionChange(cb: (state: GeoPermState) => void): () => void {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) return () => {};
  let status: PermissionStatus | null = null;
  const handler = () => {
    if (!status) return;
    cb(status.state === "granted" ? "granted" : status.state === "denied" ? "denied" : "prompt");
  };
  navigator.permissions
    .query({ name: "geolocation" as PermissionName })
    .then((s) => {
      status = s;
      s.addEventListener("change", handler);
    })
    .catch(() => {});
  return () => status?.removeEventListener("change", handler);
}

/** قراءة موقع واحدة — للنبض و«أنا موجود بالموقع». عالية الدقة للطلب الصريح. */
export function readPositionOnce(opts?: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("unavailable"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 12_000,
      ...opts,
    });
  });
}

/**
 * إطلاق طلب الإذن الرسمي عبر قراءة موقع فعلية — يرجّع الحالة بعد المحاولة.
 * نجاح القراءة = granted؛ رفض (code 1) = denied؛ غير ذلك = يُعاد استعلام الحالة
 * (قد يكون منح مع فشل تثبيت مؤقت).
 */
export async function requestGeoPermission(): Promise<GeoPermState> {
  try {
    await readPositionOnce({ enableHighAccuracy: true, timeout: 12_000 });
    return "granted";
  } catch (err) {
    if ((err as GeolocationPositionError | undefined)?.code === 1) return "denied";
    return queryGeoPermission();
  }
}
