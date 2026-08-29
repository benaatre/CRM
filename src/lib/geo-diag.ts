/**
 * «الصندوق الأسود» — أداة تشخيص مسار الموقع الدائمة (يوم الإغلاق 29/08).
 *
 * **خاملة افتراضيًا بصفر كلفة**: كل الزرعات في الكود تمر من هنا، ولا تطبع ولا
 * ترسل شيئًا إلا عند تفعيل صريح — مفتاح localStorage باسم `geo-diag-on` قيمته
 * "1"، أو فتح الصفحة بكويري `?diag=1`. عند التفعيل: طباعة كونسول + إرسال
 * fire-and-forget إلى POST /api/diag/geo (sendBeacon ثم fetch keepalive)،
 * والإرسال من تطبيق Capacitor الأصلي حصرًا — الويب العادي كونسول فقط.
 */

let enabledKnown: boolean | null = null;

function diagEnabled(): boolean {
  if (enabledKnown !== null) return enabledKnown;
  if (typeof window === "undefined") return false; // لا تخبئة على الخادم
  try {
    enabledKnown =
      window.localStorage.getItem("geo-diag-on") === "1" ||
      new URLSearchParams(window.location.search).get("diag") === "1";
  } catch {
    enabledKnown = false;
  }
  return enabledKnown;
}

/** كشف native متزامن عبر window.Capacitor — لا استيراد ديناميكيًا (درس القاتل). */
function isNativeSync(): boolean {
  try {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    return cap?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

/** تسلسل آمن مبتور — الكائنات الغريبة لا تكسر التشخيص أبدًا. */
function serialize(detail: unknown): string {
  if (detail === undefined) return "";
  if (typeof detail === "string") return detail.slice(0, 300);
  try {
    return JSON.stringify(detail)?.slice(0, 300) ?? String(detail);
  } catch {
    return String(detail).slice(0, 300);
  }
}

export function geoDiag(step: string, detail?: unknown): void {
  if (!diagEnabled()) return; // الوضع الدائم: صمت تام بصفر كلفة

  const text = serialize(detail);
  try {
    console.debug(`[geo-diag] ${step}`, text);
  } catch {
    /* كونسول محجوب — لا شيء يتوقف */
  }
  if (!isNativeSync()) return; // الإرسال من التطبيق حصرًا
  try {
    const body = JSON.stringify({
      step,
      detail: text,
      ts: new Date().toISOString(),
      ua: navigator.userAgent.slice(0, 120),
    });
    const beacon =
      typeof navigator.sendBeacon === "function" &&
      navigator.sendBeacon("/api/diag/geo", new Blob([body], { type: "application/json" }));
    if (!beacon) {
      void fetch("/api/diag/geo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    /* التشخيص لا يُفشل شيئًا أبدًا */
  }
}
