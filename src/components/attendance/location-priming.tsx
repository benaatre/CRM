"use client";

import { useCallback, useEffect, useState } from "react";
import { MapPin, Fingerprint, EyeOff, MoonStar, Settings2 } from "lucide-react";
import { MobilePortal } from "@/components/mobile/portal";
import {
  queryGeoPermission,
  requestGeoPermission,
  onGeoPermissionChange,
  type GeoPermState,
} from "@/lib/geolocation-permission";
import "./attendance.css";

/**
 * شاشة تفعيل الموقع (الحضور بالرادار — ر١) — تمهيد قبل طلب الإذن الرسمي.
 *
 * تظهر **بعد قبول الإفصاح v3** (المالك لا يقبله فلا تظهر له) وحين تكون حالة
 * الإذن `prompt`: تشرح الفائدة وتطمئن، ثم زر «تفعيل الموقع» يُطلق الطلب الرسمي
 * (قراءة موقع فعلية — الحقيقة الحاكمة: الإذن يُمنح فقط لحظة طلب فعلي). «لاحقًا»
 * تؤجّلها للجلسة دون حرق الطلب. حالة `denied` → بانر إرشاد الإعدادات (غير حاجب).
 *
 * لا تتبع ولا طلب من النبض — الطلب من هذا الزر الصريح وحده.
 */

const CONSENT_KEY = "attendance-geo-consent-v3";
const SNOOZE_KEY = "attendance-loc-priming-snoozed";

const ASSURANCES = [
  { icon: Fingerprint, text: "أول ما توصل الموقع نبصم لك تلقائيًا" },
  { icon: EyeOff, text: "القراءة والتطبيق مفتوح فقط — لا تتبع بالخلفية" },
  { icon: MoonStar, text: "تتوقف خارج أوقات دوامك" },
] as const;

export function LocationPriming() {
  const [perm, setPerm] = useState<GeoPermState | null>(null);
  const [consented, setConsented] = useState(false);
  const [snoozed, setSnoozed] = useState(false);
  const [busy, setBusy] = useState(false);

  // الإفصاح v3 والتأجيل يُقرآن بعد التركيب (localStorage يكسر الترطيب في العرض).
  useEffect(() => {
    try {
      setConsented(window.localStorage.getItem(CONSENT_KEY) === "1");
      setSnoozed(window.sessionStorage.getItem(SNOOZE_KEY) === "1");
    } catch {
      /* تخزين محجوب — نُبقي الافتراضات */
    }
    void queryGeoPermission().then(setPerm);
    // يُعاد الفحص عند رجوع التطبيق للمقدمة (قد يمنح الإذن من الإعدادات).
    const onVisible = () => {
      if (document.visibilityState === "visible") void queryGeoPermission().then(setPerm);
    };
    document.addEventListener("visibilitychange", onVisible);
    const unsub = onGeoPermissionChange(setPerm);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      unsub();
    };
  }, []);

  const activate = useCallback(async () => {
    setBusy(true);
    const next = await requestGeoPermission();
    setPerm(next);
    setBusy(false);
  }, []);

  const snooze = useCallback(() => {
    try {
      window.sessionStorage.setItem(SNOOZE_KEY, "1");
    } catch {
      /* تجاهل */
    }
    setSnoozed(true);
  }, []);

  // لا نعرض شيئًا قبل قبول الإفصاح، أو والحالة غير محسومة/ممنوحة/غير متاحة.
  if (!consented || perm === null || perm === "granted" || perm === "unavailable") return null;

  // ===== إرشاد الإعدادات — الإذن مرفوض (بانر سفلي غير حاجب) =====
  if (perm === "denied") {
    if (snoozed) return null;
    return (
      <MobilePortal>
        <div
          dir="rtl"
          className="att-scope m-toastin fixed z-[70]"
          style={{ bottom: "calc(100px + env(safe-area-inset-bottom))", insetInline: 14 }}
        >
          <div
            className="flex items-center gap-2.5"
            style={{
              boxSizing: "border-box", borderRadius: 14, padding: "12px 14px",
              background: "var(--m-sheet)", border: "1px solid var(--m-hair)",
              boxShadow: "0 12px 32px rgba(0,0,0,.4)",
            }}
          >
            <Settings2 aria-hidden size={18} strokeWidth={1.7} style={{ color: "var(--att-late)", flex: "none" }} />
            <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed" style={{ color: "var(--m-text1)" }}>
              فعّل الموقع من إعدادات جهازك عشان نبصم لك تلقائيًا
            </p>
            <button
              type="button"
              onClick={snooze}
              className="flex-none text-[11px] font-bold"
              style={{ color: "var(--m-text3)" }}
            >
              تمام
            </button>
          </div>
        </div>
      </MobilePortal>
    );
  }

  // ===== شاشة التفعيل الكاملة — الحالة prompt =====
  if (snoozed) return null;
  return (
    <MobilePortal>
      <div
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-label="تفعيل الموقع"
        className="att-scope fixed inset-0 z-[88] flex items-center justify-center p-4"
      >
        <button type="button" aria-label="لاحقًا" onClick={snooze} className="absolute inset-0 border-0" style={{ background: "rgba(8, 5, 3, 0.82)", backdropFilter: "blur(5px)" }} />

        <div
          className="relative w-full max-w-md overflow-hidden rounded-3xl border p-6 text-center"
          style={{ borderColor: "var(--att-esp-line)", background: "var(--att-esp-bg)" }}
        >
          {/* أيقونة الموقع بحلقة متوهّجة */}
          <span className="relative mx-auto mb-4 flex size-16 items-center justify-center">
            <span aria-hidden className="absolute inset-0 rounded-full" style={{ border: "1px solid var(--m-acc-a32)", boxShadow: "0 0 34px var(--m-acc-glow)" }} />
            <MapPin aria-hidden size={28} strokeWidth={1.6} style={{ color: "var(--att-gold)" }} />
          </span>

          <h2 className="text-[18px] font-extrabold" style={{ color: "var(--att-esp-text)" }}>
            فعّل موقعك للحضور التلقائي
          </h2>
          <p className="mx-auto mt-2 max-w-xs text-[12.5px] leading-relaxed" style={{ color: "var(--att-esp-muted)" }}>
            أول ما توصل موقع العمل والتطبيق مفتوح، نبصم لك تلقائيًا — بلا ما تفتح التطبيق كل يوم
          </p>

          <div className="mt-5 flex flex-col gap-2.5 text-right">
            {ASSURANCES.map((a) => (
              <div key={a.text} className="flex items-center gap-2.5">
                <span className="flex size-8 flex-none items-center justify-center rounded-xl" style={{ background: "var(--att-esp-card)", border: "1px solid var(--att-esp-line)" }}>
                  <a.icon aria-hidden size={15} strokeWidth={1.7} style={{ color: "var(--att-gold)" }} />
                </span>
                <span className="text-[12px]" style={{ color: "var(--att-esp-text)" }}>{a.text}</span>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void activate()}
            disabled={busy}
            className="mt-6 min-h-12 w-full rounded-[14px] border-0 text-[15px] font-extrabold disabled:opacity-60"
            style={{ background: "var(--att-gold)", color: "var(--att-on-gold)" }}
          >
            {busy ? "لحظة…" : "تفعيل الموقع"}
          </button>
          <button
            type="button"
            onClick={snooze}
            disabled={busy}
            className="mt-2 min-h-9 w-full text-[12.5px] font-medium"
            style={{ color: "var(--att-esp-muted)" }}
          >
            لاحقًا
          </button>
        </div>
      </div>
    </MobilePortal>
  );
}

export default LocationPriming;
