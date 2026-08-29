/**
 * «الصندوق الأسود» — مرسل تشخيص مسار الموقع (عميل، 29/08، مؤقت حتى Build 5).
 *
 * fire-and-forget بلا أي انتظار في المسار الحرج: sendBeacon أولًا (يعيش حتى
 * مع إغلاق الصفحة) وfetch keepalive احتياطًا، ويطبع للكونسول دائمًا.
 * **الإرسال من تطبيق Capacitor الأصلي فقط** — صفر ضجيج من الويب العادي.
 */

let nativeKnown: boolean | null = null;

async function isNative(): Promise<boolean> {
  if (nativeKnown !== null) return nativeKnown;
  // الفحص المتزامن أولًا عبر window.Capacitor — لا يعتمد على import ديناميكي
  // قد يعلق (chunk قديم/مفقود): التشخيص يجب أن يصل حتى لو علّة الاستيراد نفسها
  // هي المشتبه به.
  try {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (cap?.isNativePlatform) {
      nativeKnown = cap.isNativePlatform();
      return nativeKnown;
    }
  } catch {
    /* نسقط للاستيراد */
  }
  try {
    const { Capacitor } = await import("@capacitor/core");
    nativeKnown = Capacitor.isNativePlatform();
  } catch {
    nativeKnown = false;
  }
  return nativeKnown;
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
  const text = serialize(detail);
  try {
    console.debug(`[geo-diag] ${step}`, text);
  } catch {
    /* كونسول محجوب — لا شيء يتوقف */
  }
  if (typeof window === "undefined") return;
  void (async () => {
    try {
      if (!(await isNative())) return;
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
        await fetch("/api/diag/geo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
        });
      }
    } catch {
      /* التشخيص لا يُفشل شيئًا أبدًا */
    }
  })();
}
