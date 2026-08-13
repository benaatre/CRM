"use client";

import { useCallback, useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Crosshair, LogIn, LogOut, MapPin, ShieldCheck } from "lucide-react";
import {
  ATTENDANCE_PALETTE,
  tint,
  toneColor,
  type AttendanceTheme,
  type FeedbackTone,
} from "@/lib/attendance-ui";

/**
 * بطاقة «تسجيل الدوام» — الواجهة الوحيدة للبصم (الويب والتطبيق).
 *
 * القراءة تحدث **لحظة الضغط فقط** والتطبيق مفتوح — لا تتبّع بالخلفية ولا
 * watchPosition. البطاقة ترسل الإحداثيات والدقّة كما هي، والسيرفر يقرّر
 * المطابقة والتأخير بوقته؛ فلا حالة «داخل الدائرة» تُحسب هنا أبدًا.
 *
 * الموافقة الأولى تُحفظ محليًا (localStorage) وتُعرض قبل أي قراءة موقع.
 */

const CONSENT_KEY = "attendance-geo-consent";

type Intent = "CHECK_IN" | "CHECK_OUT" | "PROJECT_IN" | "PROJECT_OUT";

type StatusPayload = {
  ok: boolean;
  state: "none" | "in" | "out";
  session: {
    startedAtText: string;
    endedAtText: string | null;
    workedMinutes: number | null;
    wasLate: boolean;
    locationName: string | null;
  } | null;
  projectOpen: boolean;
  projectLocationName: string | null;
};

type PunchResult = {
  ok: boolean;
  reason?: string;
  message?: string;
  type?: Intent;
  locationName?: string | null;
  timeKSA?: string;
  isLate?: boolean;
};

/** قراءة موقع واحدة بأعلى دقة متاحة — بلا كاش (maximumAge:0) ومهلة ١٥ ثانية. */
function readPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("unsupported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15000,
    });
  });
}

/** رسالة خطأ الموقع بلهجة واضحة — الرفض له نصّه الخاص. */
function geoErrorMessage(err: unknown): string {
  const code = (err as GeolocationPositionError | undefined)?.code;
  if (code === 1) return "لازم تسمح بالوصول للموقع عشان تسجّل حضورك";
  if (code === 3) return "طوّلنا وما وصلتنا إشارة — حاول مرة ثانية بمكان مفتوح";
  return "ما قدرنا نحدد موقعك — تأكد أن خدمة الموقع مشغّلة وحاول مرة ثانية";
}

export function AttendanceCard({ theme = "mobile" }: { theme?: AttendanceTheme }) {
  const p = ATTENDANCE_PALETTE[theme];

  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [consent, setConsent] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<Intent | null>(null);
  const [feedback, setFeedback] = useState<{ tone: FeedbackTone; text: string } | null>(null);

  // الموافقة تُقرأ بعد التركيب لا أثناء العرض — قراءة localStorage في العرض تكسر الترطيب.
  useEffect(() => {
    try {
      setConsent(window.localStorage.getItem(CONSENT_KEY) === "1");
    } catch {
      setConsent(false);
    }
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/attendance/status", { cache: "no-store" });
      if (!res.ok) {
        setStatusFailed(true);
        return;
      }
      setStatus((await res.json()) as StatusPayload);
      setStatusFailed(false);
    } catch {
      // لا نخمّن حالة: «لم تسجّل حضورك» وهو حاضر كذبة أسوأ من الاعتراف بالفشل.
      setStatusFailed(true);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const acceptConsent = () => {
    try {
      window.localStorage.setItem(CONSENT_KEY, "1");
    } catch {
      /* وضع التصفح الخاص — نكمل بلا حفظ */
    }
    setConsent(true);
  };

  const punch = async (intent: Intent) => {
    setBusy(intent);
    setFeedback({ tone: "info", text: "جاري تحديد موقعك…" });

    let pos: GeolocationPosition;
    try {
      pos = await readPosition();
    } catch (err) {
      setFeedback({ tone: "danger", text: geoErrorMessage(err) });
      setBusy(null);
      return;
    }

    try {
      const res = await fetch("/api/attendance/punch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          isMock: false,
          source: Capacitor.isNativePlatform() ? "NATIVE" : "WEB",
          intent,
        }),
      });

      if (res.status === 401) {
        setFeedback({ tone: "danger", text: "انتهت جلستك — سجّل دخولك مرة ثانية" });
        setBusy(null);
        return;
      }

      const data = (await res.json()) as PunchResult;

      if (!data.ok) {
        // الرفض المتوقّع (خارج النطاق/إشارة ضعيفة/فاصل) يرجع بنصّه العربي من الخادم.
        const tone: FeedbackTone = data.reason === "out_of_zone" ? "danger" : "warning";
        setFeedback({ tone, text: data.message ?? "ما قدرنا نسجّل البصمة — حاول مرة ثانية" });
      } else {
        setFeedback({ tone: data.isLate ? "warning" : "success", text: successText(data) });
        await loadStatus();
      }
    } catch {
      setFeedback({ tone: "danger", text: "تعذّر الاتصال — تأكد من الإنترنت وحاول مرة ثانية" });
    }
    setBusy(null);
  };

  const state = status?.state ?? "none";
  const checkedIn = state === "in";
  const projectOpen = status?.projectOpen ?? false;
  const mainIntent: Intent = checkedIn ? "CHECK_OUT" : "CHECK_IN";
  const projectIntent: Intent = projectOpen ? "PROJECT_OUT" : "PROJECT_IN";
  const working = busy !== null;

  return (
    <section
      dir="rtl"
      aria-label="تسجيل الدوام"
      style={{
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        background: p.card,
        border: `1px solid ${p.border}`,
        borderRadius: 16,
        padding: "14px 15px",
      }}
    >
      {/* ===== الترويسة: العنوان + حالة اليوم ===== */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <MapPin aria-hidden size={17} strokeWidth={1.8} style={{ color: p.text2, flex: "none" }} />
            <h2 style={{ fontSize: 16, fontWeight: 800, color: p.text1 }}>تسجيل الدوام</h2>
          </div>
          <p style={{ fontSize: 13, color: p.text2, marginTop: 5, lineHeight: 1.6 }}>
            {statusFailed && !status ? "ما قدرنا نقرأ حالتك الحين" : statusLine(status)}
          </p>
        </div>
        {checkedIn && (
          <span
            style={{
              boxSizing: "border-box",
              flex: "none",
              borderRadius: 8,
              padding: "4px 9px",
              fontSize: 11,
              fontWeight: 700,
              whiteSpace: "nowrap",
              color: status?.session?.wasLate ? p.warning : p.success,
              background: tint(status?.session?.wasLate ? p.warning : p.success, 14),
            }}
          >
            {status?.session?.wasLate ? "حاضر — مسجّل تأخير" : "حاضر"}
          </span>
        )}
      </div>

      {/* ===== الموافقة الأولى — تسبق أي قراءة موقع ===== */}
      {consent === false ? (
        <div
          style={{
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            background: p.sheet,
            border: `1px solid ${p.border}`,
            borderRadius: 13,
            padding: "12px 13px",
          }}
        >
          <div style={{ display: "flex", gap: 8 }}>
            <ShieldCheck aria-hidden size={17} strokeWidth={1.8} style={{ color: p.text2, flex: "none", marginTop: 2 }} />
            <p style={{ fontSize: 12.5, color: p.text2, lineHeight: 1.75 }}>
              التطبيق يقرأ موقعك لحظة تسجيل الحضور فقط، للتحقق أنك داخل موقع العمل. لا يتم تتبعك خارج ذلك.
            </p>
          </div>
          <button
            type="button"
            onClick={acceptConsent}
            style={{
              boxSizing: "border-box",
              minHeight: 42,
              borderRadius: 11,
              border: "none",
              background: p.gold,
              color: p.onGold,
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            موافق
          </button>
        </div>
      ) : (
        consent === true && (
          <>
            {/* ===== الزر الرئيسي (العنصر الذهبي الوحيد) ===== */}
            <button
              type="button"
              onClick={() => void punch(mainIntent)}
              disabled={working}
              style={{
                boxSizing: "border-box",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                minHeight: 48,
                borderRadius: 13,
                border: "none",
                background: p.gold,
                color: p.onGold,
                fontSize: 15,
                fontWeight: 800,
                cursor: working ? "default" : "pointer",
                opacity: working ? 0.6 : 1,
              }}
            >
              {checkedIn ? (
                <LogOut aria-hidden size={18} strokeWidth={2} />
              ) : (
                <LogIn aria-hidden size={18} strokeWidth={2} />
              )}
              {busy === mainIntent
                ? "جاري تحديد موقعك…"
                : checkedIn
                  ? "تسجيل انصراف"
                  : "تسجيل حضور"}
            </button>

            {/* ===== زيارة مشروع (ثانوي — بلا ذهبي) ===== */}
            <button
              type="button"
              onClick={() => void punch(projectIntent)}
              disabled={working}
              style={{
                boxSizing: "border-box",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                minHeight: 44,
                borderRadius: 12,
                background: p.sheet,
                border: `1px solid ${p.border}`,
                color: p.text1,
                fontSize: 13.5,
                fontWeight: 600,
                cursor: working ? "default" : "pointer",
                opacity: working ? 0.6 : 1,
              }}
            >
              <Crosshair aria-hidden size={16} strokeWidth={1.8} />
              {busy === projectIntent
                ? "جاري تحديد موقعك…"
                : projectOpen
                  ? `إنهاء زيارة ${status?.projectLocationName ?? "المشروع"}`
                  : "زيارة مشروع"}
            </button>
          </>
        )
      )}

      {/* ===== نتيجة آخر محاولة ===== */}
      {feedback && (
        <p
          role="status"
          style={{
            boxSizing: "border-box",
            borderRadius: 11,
            padding: "9px 11px",
            fontSize: 12.5,
            lineHeight: 1.7,
            color: toneColor(p, feedback.tone),
            background: tint(toneColor(p, feedback.tone), 12),
          }}
        >
          {feedback.text}
        </p>
      )}
    </section>
  );
}

/** سطر الحالة تحت العنوان — يتبع الجلسة لا آخر بصمة. */
function statusLine(status: StatusPayload | null): string {
  if (!status) return "جاري قراءة حالتك…";
  if (status.state === "in") {
    const where = status.session?.locationName;
    return `حاضر منذ ${status.session?.startedAtText ?? "—"}${where ? ` — ${where}` : ""}`;
  }
  if (status.state === "out") {
    const from = status.session?.startedAtText;
    const to = status.session?.endedAtText;
    return from && to ? `منصرف — دوامك اليوم من ${from} إلى ${to}` : "منصرف";
  }
  return "لم تسجّل حضورك اليوم";
}

/** نص النجاح حسب نوع البصمة. */
function successText(data: PunchResult): string {
  const at = data.timeKSA ?? "";
  const where = data.locationName ? ` — ${data.locationName}` : "";
  if (data.type === "CHECK_IN") {
    return `تم تسجيل حضورك ${at}${where}${data.isLate ? " · مسجّل تأخير" : ""}`;
  }
  if (data.type === "CHECK_OUT") return `تم تسجيل انصرافك ${at}${where}`;
  if (data.type === "PROJECT_IN") return `سجّلنا دخولك للمشروع ${at}${where}`;
  return `سجّلنا خروجك من المشروع ${at}${where}`;
}

export default AttendanceCard;
