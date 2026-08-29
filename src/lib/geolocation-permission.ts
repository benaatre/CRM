/**
 * طبقة الموقع الموحّدة (يوم الإغلاق 29/08) — **الويبي هو المسار الوحيد**.
 *
 * بلجن Geolocation الأصلي حُذف من هذا الملف نهائيًا: معطوب رسميًا (تعليق
 * notDetermined — Issue #2023 بلا إصلاح)، واستيراده الديناميكي كان «القاتل»
 * الذي جمّد البصمة (يعلق للأبد على WKWebView — أثبته الصندوق الأسود). Web
 * Geolocation موثوق داخل Capacitor مع server.url بعيد (سياق آمن https)
 * وعلى المتصفح بالبداهة — مسار واحد واضح: ويب + مهلات + زرعات.
 *
 * بلجن SultanGeo المخصص (Build 5) سيعود من الماك مسارًا أول فوق هذا الملف
 * النظيف — لا فوق ركام المسارات القديمة.
 *
 * الحقيقة الحاكمة: الإذن يُمنح فقط لحظة طلب موقع فعلي — فالطلب الرسمي يُطلق
 * من زر صريح (شاشة التفعيل / «أنا موجود بالموقع») لا من النبض.
 */

import { geoDiag } from "@/lib/geo-diag";

export type GeoPermState = "granted" | "prompt" | "denied" | "unavailable";

/** شكل window.Capacitor العام كما يحقنه الجسر الأصلي قبل تحميل الصفحة. */
type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, unknown>;
};

function capGlobal(): CapacitorGlobal | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

/** هل نحن داخل التطبيق الأصلي؟ — متزامن حصرًا (درس القاتل: صفر import ديناميكي). */
function isNativeApp(): boolean {
  try {
    return capGlobal()?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

/**
 * سباق مهلة صلبة — شبكة أمان فوق مهلة المتصفح نفسها: انقضاؤه يرفض بخطأ
 * يصنَّف TIMEOUT (code 3) عند المستهلكين، وكل انفجار يسجَّل باسمه.
 */
function raceTimeout<T>(p: Promise<T>, ms: number, label = "?"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      geoDiag("timeout:" + label, { ms });
      reject(new Error("timeout"));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * ذاكرة المنحة الجهازية — iOS WKWebView بلا permissions.query يفترض «prompt»
 * كل إقلاع فتعود شاشة التمهيد ويتعطل نبض الرادار. المفتاح جهازي عمدًا: إذن
 * OS نفسه جهازي لا مستخدمي. يُكتب عند أي قراءة ناجحة، ويُمسح عند رفض صريح.
 */
const GRANT_KEY = "attendance-geo-granted-v1";

function rememberGrant(granted: boolean): void {
  try {
    if (granted) window.localStorage.setItem(GRANT_KEY, "1");
    else window.localStorage.removeItem(GRANT_KEY);
  } catch {
    /* تخزين محجوب (تصفح خاص) — الذاكرة تسقط بأمان لسلوك ما قبلها */
  }
}

function hasRememberedGrant(): boolean {
  try {
    return window.localStorage.getItem(GRANT_KEY) === "1";
  } catch {
    return false;
  }
}

/** حالة الإذن الحالية — بلا إطلاق أي طلب. `unavailable` = لا API إطلاقًا. */
export async function queryGeoPermission(): Promise<GeoPermState> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return "unavailable";
  // لا permissions.query (iOS WKWebView غالبًا): ذاكرة المنحة تحسم — منحة OS
  // نفسها ثابتة بين الفتحات، والذي كان يضيع هو «علم التطبيق» بها.
  if (!navigator.permissions?.query) return hasRememberedGrant() ? "granted" : "prompt";
  try {
    const st = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    // «prompt-with-rationale» (أندرويد) تُعامل كـprompt.
    const state: GeoPermState = st.state === "granted" ? "granted" : st.state === "denied" ? "denied" : "prompt";
    // permissions.query هو الحاكم حيث يتوفر — والذاكرة تُحدَّث وفق حكمه.
    rememberGrant(state === "granted");
    return state;
  } catch {
    return hasRememberedGrant() ? "granted" : "prompt";
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

/**
 * قراءة موقع واحدة — البصمة والنبض والفحص الصامت. عالية الدقة بلا كاش، بمهلة
 * المتصفح الممررة وفوقها شبكة الأمان (+٢ث) — لا وعد يبقى معلقًا مهما حدث.
 */
export async function readPositionOnce(opts?: PositionOptions): Promise<GeolocationPosition> {
  const timeoutMs = opts?.timeout ?? 12_000;
  geoDiag("readPositionOnce:start", { native: isNativeApp(), timeout: timeoutMs });
  return raceTimeout(readPositionOnceWeb(opts), timeoutMs + 2_000, "readPositionOnce");
}

function readPositionOnceWeb(opts?: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      geoDiag("web:unavailable");
      reject(new Error("unavailable"));
      return;
    }
    geoDiag("web:getCurrentPosition:call", { timeout: opts?.timeout ?? 12_000 });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        geoDiag("web:success", { acc: Math.round(pos.coords.accuracy) });
        rememberGrant(true); // قراءة نجحت = المنحة قائمة — تُذكر للجولات القادمة
        resolve(pos);
      },
      (err) => {
        geoDiag("web:error", { code: err?.code, message: err?.message });
        if (err?.code === 1) rememberGrant(false); // رفض صريح — سحب الإذن يُنسي الذاكرة
        reject(err);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 12_000,
        ...opts,
      },
    );
  });
}

/**
 * قراءة موثوقة عالية الدقة (الحضور بالرادار — ر٢): watchPosition يحسّن الدقة
 * تدريجيًا — يحسم عند أول تثبيت ≤ targetAccuracy أو أفضل تثبيت عند المهلة،
 * وclearWatch على كل مسارات النهاية. بذرة getCurrentPosition موازية تعجّل
 * أول تثبيت على iOS.
 */
export async function readBestPosition(opts?: {
  targetAccuracy?: number;
  timeoutMs?: number;
}): Promise<GeolocationPosition> {
  const targetAccuracy = opts?.targetAccuracy ?? 50;
  const timeoutMs = opts?.timeoutMs ?? 12_000;
  geoDiag("readBestPosition:start", { native: isNativeApp(), targetAccuracy, timeoutMs });
  return readBestPositionWeb(targetAccuracy, timeoutMs);
}

function readBestPositionWeb(targetAccuracy: number, timeoutMs: number): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      geoDiag("web:unavailable");
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
      if (pos) {
        rememberGrant(true); // تثبيت وصل = المنحة قائمة
        resolve(pos);
      } else {
        if ((err as GeolocationPositionError | undefined)?.code === 1) rememberGrant(false);
        reject(err ?? new Error("timeout"));
      }
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
 * إطلاق طلب الإذن الرسمي عبر قراءة موقع فعلية — القراءة تُظهر حوار إذن
 * WKWebView/المتصفح وتأخذ وقتها (١٥ث: الحوار + ضغطة المستخدم + قراءة GPS).
 * نجاحها granted؛ رفض صريح denied؛ غير ذلك يُعاد استعلام الحالة.
 */
export async function requestGeoPermission(): Promise<GeoPermState> {
  geoDiag("requestGeoPermission:start", { native: isNativeApp() });
  try {
    await readPositionOnce({ enableHighAccuracy: true, timeout: 15_000 });
    geoDiag("requestGeoPermission:granted");
    return "granted";
  } catch (err) {
    if ((err as GeolocationPositionError | undefined)?.code === 1) {
      geoDiag("requestGeoPermission:denied");
      return "denied";
    }
    geoDiag("requestGeoPermission:inconclusive");
    return queryGeoPermission();
  }
}

/** هل نقدر نفتح إعدادات النظام؟ iOS داخل التطبيق فقط (app-settings:). */
export async function canOpenLocationSettings(): Promise<boolean> {
  try {
    // متزامن عبر window.Capacitor — لا استيراد ديناميكيًا (درس القاتل).
    const cap = capGlobal();
    return cap?.isNativePlatform?.() === true && cap?.getPlatform?.() === "ios";
  } catch {
    return false;
  }
}

/**
 * يفتح إعدادات التطبيق على iOS (`app-settings:` عبر AppLauncher من
 * window.Capacitor.Plugins — متزامن الوصول) — للموظف الذي رفض الإذن سابقًا
 * فلا يظهر له الطلب الرسمي ثانيةً. يرجّع نجاح الفتح.
 */
export async function openLocationSettings(): Promise<boolean> {
  try {
    const cap = capGlobal();
    if (cap?.isNativePlatform?.() !== true || cap?.getPlatform?.() !== "ios") return false;
    const launcher = cap.Plugins?.AppLauncher as { openUrl?: (o: { url: string }) => Promise<unknown> } | undefined;
    if (!launcher?.openUrl) return false;
    await launcher.openUrl({ url: "app-settings:" });
    return true;
  } catch {
    return false;
  }
}
