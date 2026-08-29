"use client";

import { useCallback, useEffect, useState } from "react";
import { MapPin, Fingerprint, EyeOff, MoonStar, Settings2 } from "lucide-react";
import { MobilePortal } from "@/components/mobile/portal";
import { toArabicDigits } from "@/lib/format";
import {
  queryGeoPermission,
  requestGeoPermission,
  onGeoPermissionChange,
  canOpenLocationSettings,
  openLocationSettings,
  getGeoDiagnostics,
  onGeoDiagnostics,
  type GeoPermState,
  type GeoDiagnostics,
} from "@/lib/geolocation-permission";
import "./attendance.css";

/**
 * شاشة تفعيل الموقع (الحضور بالرادار — ر١) — تمهيد قبل طلب الإذن الرسمي.
 *
 * تظهر **بعد ثبوت موافقة الإفصاح v3 خادميًا** (سجل PRIVACY_CONSENT للمستخدم
 * الحالي — تتبع المستخدم لا الجهاز، فجهاز مشترك لا يسرّب موافقة موظف لغيره؛
 * المالك لا يقبل الإفصاح فلا تظهر له) وحين تكون حالة الإذن `prompt`: تشرح
 * الفائدة وتطمئن، ثم زر «تفعيل الموقع» يُطلق الطلب الرسمي (قراءة موقع فعلية —
 * الحقيقة الحاكمة: الإذن يُمنح فقط لحظة طلب فعلي). «لاحقًا» تؤجّلها للجلسة دون
 * حرق الطلب. حالة `denied` → بانر إرشاد الإعدادات (غير حاجب)، وعلى iOS داخل
 * التطبيق زر «افتح الإعدادات» (app-settings: عبر AppLauncher الجاهزة).
 *
 * لا تتبع ولا طلب من النبض — الطلب من هذا الزر الصريح وحده.
 */

const SNOOZE_KEY = "attendance-loc-priming-snoozed";
const FAL_LICENSE = "1200021029";

const ASSURANCES = [
  { icon: Fingerprint, text: "أول ما توصل الموقع نبصم لك تلقائيًا" },
  { icon: EyeOff, text: "القراءة والتطبيق مفتوح فقط — لا تتبع بالخلفية" },
  { icon: MoonStar, text: "تتوقف خارج أوقات دوامك" },
] as const;

/** سطر ترخيص فال — نفس نمط تذييل صفحات /m (more/employee-home) حرفيًا. */
function RegaLine() {
  return (
    <p className="mt-3 text-center text-[10px]" style={{ color: "var(--att-esp-muted)" }}>
      ترخيص فال (REGA) {toArabicDigits(FAL_LICENSE)}
    </p>
  );
}

/**
 * سطر الحالة التشخيصي (T20) — يفصل الصمت عن أسبابه بدل التخمين:
 * «البلجن غير متاح» (الإضافة الأصلية غير محمّلة فالمسار سقط للويب) · «بانتظار
 * حوار الإذن» (الطلب الرسمي مُطلق ولم يُحسم بعد) · «انتهت المهلة» (الوعد الأصلي
 * علّق وحسمه السباق). يعرض قيمة `isPluginAvailable("Geolocation")` الفعلية.
 * داخل التطبيق فقط — المتصفح لا يراه.
 */
function DiagLine({ d }: { d: GeoDiagnostics }) {
  if (!d.native) return null;
  const availability = d.pluginAvailable === null ? "قيد الفحص" : d.pluginAvailable ? "متاحة" : "غير متاحة";
  const state =
    d.pluginAvailable === false
      ? "البلجن غير متاح"
      : d.phase === "awaiting-dialog"
        ? "بانتظار حوار الإذن"
        : d.phase === "timeout"
          ? "انتهت المهلة"
          : null;
  // المسار الفائز بآخر قراءة (المظلة الويبية 29/08) — يكشف من لقطة شاشة أي مسار يعمل فعليًا.
  const winner = d.winner === "native" ? "أصلي" : d.winner === "web" ? "ويب داخل التطبيق" : null;
  return (
    <p className="mt-3 text-center text-[10px]" style={{ color: "var(--att-esp-muted)" }}>
      {state ? `${state} · ` : ""}الإضافة الأصلية: {availability}
      {winner ? ` · المسار: ${winner}` : ""}
    </p>
  );
}

export function LocationPriming() {
  const [perm, setPerm] = useState<GeoPermState | null>(null);
  // الموافقة خادمية الحقيقة: null = غير محسومة (لا عرض) — لا اعتماد على كاش الجهاز
  // هنا إطلاقًا، فالشاشة أصلًا غير عاجلة والحسم الصادق أهم من الظهور المبكر.
  const [consented, setConsented] = useState<boolean | null>(null);
  const [snoozed, setSnoozed] = useState(false);
  const [busy, setBusy] = useState(false);
  // زر «افتح الإعدادات» — داخل التطبيق على iOS فقط (AppLauncher app-settings:).
  const [canOpenSettings, setCanOpenSettings] = useState(false);
  // تشخيص طبقة الموقع — لقطة + اشتراك، فالسطر يتابع الطلب لحظيًا.
  const [diag, setDiag] = useState<GeoDiagnostics>(getGeoDiagnostics);

  useEffect(() => {
    try {
      setSnoozed(window.sessionStorage.getItem(SNOOZE_KEY) === "1");
    } catch {
      /* تخزين محجوب — نُبقي الافتراض */
    }
    // حقيقة الموافقة من الخادم (نفس مصدر البطاقة /status) — فشل/401 = لا عرض (fail-closed).
    fetch("/api/attendance/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { ok?: boolean; consented?: boolean } | null) => {
        setConsented(d?.ok === true && d.consented === true);
      })
      .catch(() => setConsented(false));
    void canOpenLocationSettings().then(setCanOpenSettings);
    void queryGeoPermission().then(setPerm);
    // يُعاد الفحص عند رجوع التطبيق للمقدمة (قد يمنح الإذن من الإعدادات).
    const onVisible = () => {
      if (document.visibilityState === "visible") void queryGeoPermission().then(setPerm);
    };
    document.addEventListener("visibilitychange", onVisible);
    const unsub = onGeoPermissionChange(setPerm);
    setDiag(getGeoDiagnostics()); // الكاشف قد يكون حسم قبل التركيب
    const unsubDiag = onGeoDiagnostics(setDiag);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      unsub();
      unsubDiag();
    };
  }, []);

  const activate = useCallback(async () => {
    setBusy(true);
    try {
      const next = await requestGeoPermission();
      setPerm(next);
    } finally {
      setBusy(false); // لا يبقى الزر مقفولًا مهما جرى
    }
  }, []);

  const snooze = useCallback(() => {
    try {
      window.sessionStorage.setItem(SNOOZE_KEY, "1");
    } catch {
      /* تجاهل */
    }
    setSnoozed(true);
  }, []);

  // لا نعرض شيئًا قبل ثبوت الموافقة خادميًا، أو والحالة غير محسومة/ممنوحة/غير متاحة.
  if (consented !== true || perm === null || perm === "granted" || perm === "unavailable") return null;

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
            className="flex flex-col gap-2"
            style={{
              boxSizing: "border-box", borderRadius: 16, padding: "13px 14px",
              background: "var(--m-sheet)", border: "1px solid var(--m-hair)",
              boxShadow: "0 12px 32px var(--att-overlay-soft)",
            }}
          >
            <div className="flex items-start gap-2.5">
              <Settings2 aria-hidden size={18} strokeWidth={1.7} style={{ color: "var(--att-late)", flex: "none", marginTop: 1 }} />
              <p className="min-w-0 flex-1 text-[12px] font-bold" style={{ color: "var(--m-text1)" }}>
                الموقع مقفول — فعّله عشان نبصم لك تلقائيًا
              </p>
              <button type="button" onClick={snooze} className="flex-none text-[11px] font-bold" style={{ color: "var(--m-text3)" }}>
                تمام
              </button>
            </div>
            {canOpenSettings ? (
              /* داخل التطبيق (iOS): فتح إعدادات التطبيق مباشرة — بلا رحلة يدوية. */
              <button
                type="button"
                onClick={() => void openLocationSettings()}
                className="flex min-h-10 items-center justify-center gap-2 rounded-xl border-0 text-[12.5px] font-bold"
                style={{ background: "var(--att-gold)", color: "var(--att-on-gold)", marginInlineStart: 28 }}
              >
                <Settings2 aria-hidden size={14} strokeWidth={1.8} style={{ maxWidth: 22, maxHeight: 22 }} />
                افتح الإعدادات
              </button>
            ) : (
              /* المتصفح/أندرويد: الإرشاد اليدوي كما هو. */
              <p className="text-[11px] leading-relaxed" style={{ color: "var(--m-text2)", paddingInlineStart: 28 }}>
                افتح إعدادات جهازك ← الخصوصية ← خدمات الموقع ← مشاريع السلطان ← اختر «أثناء الاستخدام»
              </p>
            )}
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
        <button type="button" aria-label="لاحقًا" onClick={snooze} className="absolute inset-0 border-0" style={{ background: "var(--att-overlay-soft)", backdropFilter: "blur(5px)" }} />

        <div
          className="relative w-full max-w-md overflow-hidden rounded-3xl border p-6 text-center"
          style={{ borderColor: "var(--att-esp-line)", background: "var(--att-esp-bg)" }}
        >
          {/* أيقونة الموقع بحلقة متوهّجة — أكبر من سقف الأيقونات عمدًا (بطلة الشاشة) */}
          <span className="relative mx-auto mb-4 flex size-16 items-center justify-center">
            <span aria-hidden className="absolute inset-0 rounded-full" style={{ border: "1px solid var(--att-esp-line)", boxShadow: "0 0 34px var(--att-esp-glow)" }} />
            <MapPin data-svg-free aria-hidden size={28} strokeWidth={1.6} style={{ color: "var(--att-gold)" }} />
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
          <DiagLine d={diag} />
          <RegaLine />
        </div>
      </div>
    </MobilePortal>
  );
}

export default LocationPriming;
