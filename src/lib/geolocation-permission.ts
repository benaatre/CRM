/**
 * طبقة إذن الموقع الموحّدة (الحضور بالرادار — ر١) — عميل فقط.
 *
 * مساران خلف واجهة واحدة لا تتغيّر:
 * - **أصلي** (تطبيق Capacitor + إضافة Geolocation متوفّرة): @capacitor/geolocation
 *   يخاطب CoreLocation مباشرة، فالإجابات إجابات iOS الرسمية (لا تخمين WebView).
 * - **ويب** (متصفح، أو تطبيق قديم بلا الإضافة): Web Geolocation API +
 *   navigator.permissions كما كان حرفيًا — توافق خلفي كامل.
 *
 * الكاشف أدناه (`nativeGeo`) هو الفاصل الوحيد بينهما، وذاكرة المنحة الجهازية
 * تُحدَّث من المسارين معًا.
 *
 * الحقيقة الحاكمة (من البحث): الإذن يُمنح فقط لحظة طلب موقع فعلي — فالطلب
 * الرسمي يُطلق من زر صريح (شاشة التفعيل / «أنا موجود بالموقع») لا من النبض.
 */

export type GeoPermState = "granted" | "prompt" | "denied" | "unavailable";

type NativeGeo = typeof import("@capacitor/geolocation").Geolocation;
type NativePosition = import("@capacitor/geolocation").Position;

/**
 * كاشف المسار الأصلي — تحميل كسول مرّة واحدة (الوعد نفسه مُخبّأ فلا سباق).
 * `isPluginAvailable` شرط جوهري: تطبيق قديم مبني قبل هذه الدفعة لا يحمل
 * الإضافة، فيسقط للمسار الويبي بلا كسر.
 */
let nativeGeoPromise: Promise<NativeGeo | null> | null = null;

function nativeGeo(): Promise<NativeGeo | null> {
  nativeGeoPromise ??= (async () => {
    try {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("Geolocation")) return null;
      const { Geolocation } = await import("@capacitor/geolocation");
      return Geolocation;
    } catch {
      return null;
    }
  })();
  return nativeGeoPromise;
}

/** تطبيع تثبيت أصلي إلى شكل GeolocationPosition — المستهلكون لا يفرّقون. */
function toWebPosition(p: NativePosition): GeolocationPosition {
  const c = p.coords;
  const coords = {
    latitude: c.latitude,
    longitude: c.longitude,
    accuracy: c.accuracy,
    altitude: c.altitude ?? null,
    altitudeAccuracy: c.altitudeAccuracy ?? null,
    heading: c.heading ?? null,
    speed: c.speed ?? null,
  };
  return {
    coords: { ...coords, toJSON: () => ({ ...coords }) },
    timestamp: p.timestamp,
    toJSON: () => ({ coords: { ...coords }, timestamp: p.timestamp }),
  } as unknown as GeolocationPosition;
}

/**
 * سباق مهلة صلبة حول وعد بلجن قد لا يُحل أبدًا (إصلاح تجميد البصمة —
 * ‏iOS لا يفرض `timeout` الممرر للبلجن بنفسه): انقضاء المهلة يرفض بـ
 * `Error("timeout")` فيصنّفه `toWebError` القائم `code: 3` (TIMEOUT) —
 * fail-open: المستدعي يعرض رسالة الفشل المعتادة ويعود حيًا.
 */
function raceTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
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
 * تطبيع خطأ أصلي إلى شكل GeolocationPositionError — `code === 1` هو ما تبني
 * عليه ذاكرة المنحة قرار المسح، فنستنطق checkPermissions لنعرف أهو رفض إذن
 * فعلًا أم مجرد تعذّر تثبيت.
 */
async function toWebError(err: unknown, geo: NativeGeo): Promise<GeolocationPositionError> {
  const message = err instanceof Error ? err.message : String(err ?? "");
  let code = 2; // POSITION_UNAVAILABLE
  try {
    // حارس ~3ث: checkPermissions نفسها قد تعلق — انقضاؤه يرمي فنسقط للتصنيف بالنص.
    const st = await raceTimeout(geo.checkPermissions(), 3_000);
    if (st.location === "denied") code = 1;
    else if (/timeout|timed out/i.test(message)) code = 3;
  } catch {
    // checkPermissions ترمي حين تكون خدمات الموقع مطفأة نظاميًا — لا رفض إذن.
    if (/timeout|timed out/i.test(message)) code = 3;
  }
  return {
    code,
    message,
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  } as GeolocationPositionError;
}

/**
 * ذاكرة المنحة الجهازية — iOS WKWebView بلا permissions.query كان يفترض
 * «prompt» كل إقلاع فتعود شاشة التمهيد ويتعطل نبض الرادار (heartbeat يشترط
 * «granted» حرفيًا). المفتاح جهازي عمدًا: إذن OS نفسه جهازي لا مستخدمي.
 * يُكتب عند أي قراءة ناجحة، ويُمسح عند رفض صريح (code 1 — سحب الإذن).
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
  const geo = await nativeGeo();
  if (geo) {
    try {
      const st = await geo.checkPermissions();
      // 'prompt-with-rationale' (أندرويد) تُعامل كـprompt — كما في المسار الويبي.
      const state: GeoPermState =
        st.location === "granted" ? "granted" : st.location === "denied" ? "denied" : "prompt";
      rememberGrant(state === "granted");
      return state;
    } catch {
      // خدمات الموقع مطفأة نظاميًا (checkPermissions ترمي) — نسقط للمسار
      // الويبي أدناه بدل اختلاق حكم، فيبقى السلوك كما كان قبل الدفعة.
    }
  }
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
 * القفل الأحادي للقراءات الأصلية (إصلاح تجميد البصمة): قراءتان أصليتان
 * متزامنتان (بصمة يدوية أثناء النبضة الأولى مثلًا) تُسقطان رد بلجن iOS —
 * فالقراءة الجارية يتشاركها كل المستدعين بدل فتح ثانية موازية. يُنظَّف في
 * الحالتين (نجاح/فشل) فلا يعلق قفلًا، والمسار الويبي خارجه كليًا.
 */
let nativeReadInFlight: Promise<GeolocationPosition> | null = null;

function singleFlightNativeRead(start: () => Promise<GeolocationPosition>): Promise<GeolocationPosition> {
  if (!nativeReadInFlight) {
    const p = start();
    nativeReadInFlight = p;
    const clear = () => {
      if (nativeReadInFlight === p) nativeReadInFlight = null;
    };
    p.then(clear, clear);
  }
  return nativeReadInFlight;
}

/** قراءة موقع واحدة — للنبض و«أنا موجود بالموقع». عالية الدقة للطلب الصريح. */
export async function readPositionOnce(opts?: PositionOptions): Promise<GeolocationPosition> {
  const geo = await nativeGeo();
  if (geo) {
    return singleFlightNativeRead(async () => {
      const timeoutMs = opts?.timeout ?? 12_000;
      try {
        // المهلة الصلبة: البلجن على iOS لا يفرض timeout — السباق يضمن الحسم
        // خلال (المهلة + ٢ث) مهما حدث، برفض يصنَّف TIMEOUT (code 3).
        const pos = await raceTimeout(
          geo.getCurrentPosition({
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: timeoutMs,
            ...opts,
          }),
          timeoutMs + 2_000,
        );
        rememberGrant(true); // قراءة نجحت = المنحة قائمة — تُذكر للجولات القادمة
        return toWebPosition(pos);
      } catch (err) {
        const e = await toWebError(err, geo);
        if (e.code === 1) rememberGrant(false); // رفض صريح — سحب الإذن يُنسي الذاكرة
        throw e;
      }
    });
  }
  return readPositionOnceWeb(opts);
}

function readPositionOnceWeb(opts?: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("unavailable"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        rememberGrant(true); // قراءة نجحت = المنحة قائمة — تُذكر للجولات القادمة
        resolve(pos);
      },
      (err) => {
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
 * قراءة موثوقة عالية الدقة (الحضور بالرادار — ر٢): watchPosition بدل قراءة
 * واحدة — أول تثبيت عادةً ضعيف من الواي‑فاي، والـwatch يحسّن الدقة تدريجيًا.
 * يحسم عند **أول تثبيت ≤ targetAccuracy**، أو **أفضل تثبيت** عند انتهاء المهلة
 * (iOS WebView قد يتأخر ١٠-٦٠ث — المهلة تضمن ألا يعلّق). يرفض إن لم يصل شيء.
 *
 * ترياق iOS: watchPosition قد لا يطلق أول حدث بسرعة — نطلق getCurrentPosition
 * بالتوازي كبذرة، وأيّهما وصل بدقة كافية يحسم.
 */
export async function readBestPosition(opts?: {
  targetAccuracy?: number;
  timeoutMs?: number;
}): Promise<GeolocationPosition> {
  const targetAccuracy = opts?.targetAccuracy ?? 50;
  const timeoutMs = opts?.timeoutMs ?? 12_000;
  const geo = await nativeGeo();
  // نفس القفل الأحادي — النبضة الأولى والبصمة لا تفتحان قراءتين أصليتين أبدًا:
  // الجارية تُشارَك أيًا كان مطلقها (مؤقت النسخة الأصلية يضمن حسمها دائمًا).
  if (geo) return singleFlightNativeRead(() => readBestPositionNative(geo, targetAccuracy, timeoutMs));
  return readBestPositionWeb(targetAccuracy, timeoutMs);
}

/**
 * نسخة أصلية بنفس دلالات النسخة الويبية حرفيًا: بذرة getCurrentPosition
 * موازية · حسم عند accuracy ≤ الهدف · المهلة ترجع أفضل تثبيت · clearWatch
 * دائمًا (حتى لو وصل معرّف الـwatch بعد الحسم — لا watch يبقى حيًا يستنزف
 * البطارية).
 */
function readBestPositionNative(
  geo: NativeGeo,
  targetAccuracy: number,
  timeoutMs: number,
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    let best: GeolocationPosition | null = null;
    let done = false;
    let watchId: string | null = null;
    let cleared = false;

    const clear = () => {
      if (cleared || watchId === null) return; // لا معرّف بعد — يُلغى فور وصوله
      cleared = true;
      void geo.clearWatch({ id: watchId }).catch(() => {});
    };
    const finish = (pos: GeolocationPosition | null, err?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clear();
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
    const fail = (err: unknown) => {
      if (best) return; // عندنا تثبيت — المهلة تحسم به كما في الويب
      void toWebError(err, geo).then((e) => finish(null, e));
    };

    const timer = setTimeout(() => finish(best), timeoutMs);
    const highAcc = { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs };

    geo
      .watchPosition(highAcc, (pos, err) => {
        if (pos) consider(toWebPosition(pos));
        else if (err) fail(err);
      })
      .then((id) => {
        watchId = id;
        if (done) clear(); // حُسم قبل وصول المعرّف — ألغِ الآن
      })
      .catch(fail);
    // بذرة موازية — تعجّل أول تثبيت.
    geo
      .getCurrentPosition(highAcc)
      .then((p) => consider(toWebPosition(p)))
      .catch(() => {});
  });
}

function readBestPositionWeb(targetAccuracy: number, timeoutMs: number): Promise<GeolocationPosition> {
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
 * إطلاق طلب الإذن الرسمي عبر قراءة موقع فعلية — يرجّع الحالة بعد المحاولة.
 * نجاح القراءة = granted؛ رفض (code 1) = denied؛ غير ذلك = يُعاد استعلام الحالة
 * (قد يكون منح مع فشل تثبيت مؤقت).
 */
export async function requestGeoPermission(): Promise<GeoPermState> {
  const geo = await nativeGeo();
  if (geo) {
    try {
      // الطلب الرسمي عبر CoreLocation — حوار iOS الحقيقي لا استنتاج WebView.
      const st = await geo.requestPermissions({ permissions: ["location"] });
      if (st.location === "denied") {
        rememberGrant(false);
        return "denied";
      }
    } catch {
      // خدمات مطفأة أو رفض — القراءة التأكيدية أدناه تحسم.
    }
  }
  // قراءة تأكيدية — مشتركة بين المسارين (readPositionOnce توجّه بنفسها).
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
