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
 * قراءة موثوقة عالية الدقة (الحضور بالرادار — ر٢): watchPosition بدل قراءة
 * واحدة — أول تثبيت عادةً ضعيف من الواي‑فاي، والـwatch يحسّن الدقة تدريجيًا.
 * يحسم عند **أول تثبيت ≤ targetAccuracy**، أو **أفضل تثبيت** عند انتهاء المهلة
 * (iOS WebView قد يتأخر ١٠-٦٠ث — المهلة تضمن ألا يعلّق). يرفض إن لم يصل شيء.
 *
 * ترياق iOS: watchPosition قد لا يطلق أول حدث بسرعة — نطلق getCurrentPosition
 * بالتوازي كبذرة، وأيّهما وصل بدقة كافية يحسم.
 */
export function readBestPosition(opts?: { targetAccuracy?: number; timeoutMs?: number }): Promise<GeolocationPosition> {
  const targetAccuracy = opts?.targetAccuracy ?? 50;
  const timeoutMs = opts?.timeoutMs ?? 12_000;
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("unavailable"));
      return;
    }
    let best: GeolocationPosition | null = null;
    let done = false;
    let watchId: number | null = null;

    const finish = (pos: GeolocationPosition | null, err?: unknown) => {
      if (done) return;
      done = true;
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      clearTimeout(timer);
      if (pos) resolve(pos);
      else reject(err ?? new Error("timeout"));
    };
    const consider = (pos: GeolocationPosition) => {
      if (!best || pos.coords.accuracy < best.coords.accuracy) best = pos;
      if (pos.coords.accuracy <= targetAccuracy) finish(pos); // دقة كافية — احسم فورًا
    };

    const timer = setTimeout(() => finish(best), timeoutMs);
    const highAcc: PositionOptions = { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs };
    watchId = navigator.geolocation.watchPosition(consider, (e) => { if (!best) finish(null, e); }, highAcc);
    // بذرة موازية — تعجّل أول تثبيت على iOS.
    navigator.geolocation.getCurrentPosition(consider, () => {}, highAcc);
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

/** هل نقدر نفتح إعدادات النظام؟ iOS داخل التطبيق فقط (app-settings:). */
export async function canOpenLocationSettings(): Promise<boolean> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
  } catch {
    return false;
  }
}

/**
 * يفتح إعدادات التطبيق على iOS (`app-settings:` عبر AppLauncher) — للموظف الذي
 * رفض الإذن سابقًا فلا يظهر له الطلب الرسمي ثانيةً (سلوك iOS). يرجّع نجاح الفتح.
 * يعمل فعليًا بعد `npx cap sync` + بناء iOS (مرحلة native منفصلة).
 */
export async function openLocationSettings(): Promise<boolean> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "ios") return false;
    const { AppLauncher } = await import("@capacitor/app-launcher");
    await AppLauncher.openUrl({ url: "app-settings:" });
    return true;
  } catch {
    return false;
  }
}
