"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Zain } from "next/font/google";
import {
  ChevronDown,
  LogIn,
  LogOut,
  MapPin,
  PauseCircle,
  PlayCircle,
  Route,
  ShieldCheck,
} from "lucide-react";
import { hmLabel, type AttendanceTheme } from "@/lib/attendance-ui";
import { toArabicDigits } from "@/lib/format";
import { DayLine, StationsLog, type StationDto, type VerificationDto } from "@/components/attendance/attendance-stations";
import { LocationSheet, type NearbyLocation } from "@/components/attendance/location-sheet";
import { VerifyModal, type PendingCall } from "@/components/attendance/attendance-verify-modal";
import "./attendance.css";

const zain = Zain({ subsets: ["arabic"], weight: ["700", "800"], display: "swap" });

/**
 * بطاقة «تسجيل الدوام» — التصميم الإسبريسو المعتمد (الدفعة الثانية).
 *
 * القراءة تحدث **لحظة الضغط فقط** والتطبيق مفتوح — لا تتبّع بالخلفية ولا
 * watchPosition. البطاقة ترسل الإحداثيات والدقّة كما هي، والسيرفر يقرّر
 * المطابقة والتأخير والمحطات بوقته؛ فلا حالة «داخل الدائرة» تُحسب هنا أبدًا.
 *
 * الألوان كلها من متغيرات `attendance.css` (النهاري يتفعّل بسمة data-theme
 * القائمة)؛ prop الثيم بقيت للتوافق مع مواضع التركيب ولا تغيّر الألوان.
 */

const CONSENT_KEY = "attendance-geo-consent";

type Intent = "CHECK_IN" | "CHECK_OUT" | "LOCATION_CHANGE";

type StatusPayload = {
  ok: boolean;
  state: "none" | "in" | "out";
  session: {
    startedAt: string;
    startedAtText: string;
    endedAtText: string | null;
    workedMinutes: number | null;
    wasLate: boolean;
    locationName: string | null;
  } | null;
  targetMinutes: number;
  shiftEndText: string | null;
  stations: StationDto[];
  visitsCount: number;
  awayMinutes: number;
  verifications: VerificationDto[];
  /** التوقف (الدفعة الثالثة): مجموع المخصوم المغلق + التوقف النشط إن وجد. */
  pausedMsBase: number;
  activePause: {
    kind: "EXCUSED" | "LEFT";
    authorizerLabel: string;
    reason: string | null;
    startedIso: string;
    startedText: string;
  } | null;
};

type PunchResult = {
  ok: boolean;
  reason?: string;
  message?: string;
  type?: string;
  locationName?: string | null;
  timeKSA?: string;
  isLate?: boolean;
  outOfZone?: boolean;
};

type FeedbackTone = "success" | "danger" | "warning" | "info";

const TONE_VAR: Record<FeedbackTone, string> = {
  success: "var(--att-on)",
  danger: "var(--att-miss)",
  warning: "var(--att-late)",
  info: "var(--att-teal)",
};

/** خلفية باهتة من لون التوكن — color-mix يشتغل على var() بخلاف دمج النصوص. */
const soft = (color: string, pct = 12) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

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

// prop الثيم بقيت للتوافق مع مواضع التركيب — الألوان من متغيرات CSS حصرًا.
export function AttendanceCard(props: { theme?: AttendanceTheme }) {
  void props.theme;
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [consent, setConsent] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<Intent | "nearby" | null>(null);
  const [feedback, setFeedback] = useState<{ tone: FeedbackTone; text: string } | null>(null);
  const [pendingVerify, setPendingVerify] = useState<PendingCall | null>(null);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [movesSeen, setMovesSeen] = useState(false);
  const [sheet, setSheet] = useState<{ open: boolean; locations: NearbyLocation[] }>({ open: false, locations: [] });
  const lastPosRef = useRef<GeolocationPosition | null>(null);
  // دقيقة للتقدم والسجل؛ وثانية للعداد الكبير أثناء الدوام فقط.
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [secTick, setSecTick] = useState(() => Date.now());

  const checkedIn = status?.state === "in";

  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // عدّاد الثواني يعمل فقط والجلسة مفتوحة — reduced-motion يكتفي بالدقيقة.
  useEffect(() => {
    if (!checkedIn) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setSecTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [checkedIn]);

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

  /*
   * نداء التحقق: نسأل عند التركيب ثم كل دقيقة — ضغط إشعار الـpush يفتح
   * التطبيق على الرئيسية حيث هذي البطاقة، فيظهر البانر فورًا مع أول قراءة.
   */
  const loadVerification = useCallback(async () => {
    try {
      const res = await fetch("/api/attendance/verification/pending", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { ok: boolean; pending: PendingCall | null };
      if (data.ok) setPendingVerify(data.pending);
    } catch {
      /* الشبكة راحت — المحاولة القادمة بعد دقيقة */
    }
  }, []);

  useEffect(() => {
    void loadVerification();
    const t = setInterval(() => void loadVerification(), 60_000);
    return () => clearInterval(t);
  }, [loadVerification]);

  /** «رجعت — كمّل دوامي» — يقفل التوقف الجاري ويستأنف العدّاد. */
  const resumeShift = async () => {
    setResumeBusy(true);
    try {
      const res = await fetch("/api/attendance/pause/resume", { method: "POST" });
      const data = (await res.json()) as { ok: boolean; message?: string };
      setFeedback({
        tone: data.ok ? "success" : "warning",
        text: data.message ?? (data.ok ? "رجعناك — عدّادك يكمل" : "ما قدرنا نرجّعك — حاول مرة ثانية"),
      });
      if (data.ok) await loadStatus();
    } catch {
      setFeedback({ tone: "danger", text: "تعذّر الاتصال — تأكد من الإنترنت وحاول مرة ثانية" });
    }
    setResumeBusy(false);
  };

  const acceptConsent = () => {
    try {
      window.localStorage.setItem(CONSENT_KEY, "1");
    } catch {
      /* وضع التصفح الخاص — نكمل بلا حفظ */
    }
    setConsent(true);
  };

  /** بصمة حضور/انصراف أو تغيير موقع — كلها نفس المسار والخادم يحكم. */
  const punch = async (intent: Intent, targetLocationId?: string, presetPos?: GeolocationPosition) => {
    setBusy(intent);
    setFeedback({ tone: "info", text: "جاري تحديد موقعك…" });

    let pos: GeolocationPosition;
    try {
      pos = presetPos ?? (await readPosition());
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
          ...(targetLocationId ? { targetLocationId } : {}),
        }),
      });

      if (res.status === 401) {
        setFeedback({ tone: "danger", text: "انتهت جلستك — سجّل دخولك مرة ثانية" });
        setBusy(null);
        return;
      }

      const data = (await res.json()) as PunchResult;

      if (!data.ok) {
        const tone: FeedbackTone = data.reason === "out_of_zone" ? "danger" : "warning";
        setFeedback({ tone, text: data.message ?? "ما قدرنا نسجّل البصمة — حاول مرة ثانية" });
      } else {
        setFeedback({
          tone: data.outOfZone ? "warning" : data.isLate ? "warning" : "success",
          text: successText(data),
        });
        await loadStatus();
        void loadVerification();
      }
    } catch {
      setFeedback({ tone: "danger", text: "تعذّر الاتصال — تأكد من الإنترنت وحاول مرة ثانية" });
    }
    setBusy(null);
  };

  /** «تغيير موقعي»: قراءة واحدة ← قائمة الأقرب من الخادم ← شيت الاختيار. */
  const openLocationSheet = async () => {
    setBusy("nearby");
    setFeedback({ tone: "info", text: "جاري تحديد موقعك…" });
    let pos: GeolocationPosition;
    try {
      pos = await readPosition();
    } catch (err) {
      setFeedback({ tone: "danger", text: geoErrorMessage(err) });
      setBusy(null);
      return;
    }
    lastPosRef.current = pos;
    try {
      const res = await fetch("/api/attendance/locations/nearby", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      });
      const data = (await res.json()) as { ok: boolean; locations?: NearbyLocation[]; message?: string };
      if (!data.ok || !data.locations) {
        setFeedback({ tone: "warning", text: data.message ?? "ما قدرنا نجيب المواقع — حاول مرة ثانية" });
      } else {
        setFeedback(null);
        setSheet({ open: true, locations: data.locations });
      }
    } catch {
      setFeedback({ tone: "danger", text: "تعذّر الاتصال — تأكد من الإنترنت وحاول مرة ثانية" });
    }
    setBusy(null);
  };

  const pickLocation = async (loc: NearbyLocation) => {
    setSheet((s) => ({ ...s, open: false }));
    // نفس القراءة التي رتّبت القائمة — والخادم يعيد الحساب على كل حال.
    await punch("LOCATION_CHANGE", loc.id, lastPosRef.current ?? undefined);
  };

  const working = busy !== null;
  const startedMs = status?.session?.startedAt ? new Date(status.session.startedAt).getTime() : null;
  const targetMinutes = Math.max(1, status?.targetMinutes ?? 480);
  const activePause = status?.activePause ?? null;
  const paused = checkedIn && activePause !== null;
  /*
   * المنجز صافيًا من التوقف — نفس معادلة الدالة المشتركة على الخادم مفكوكة:
   * now − البداية − المخصوم المغلق − (توقف نشط؟ now − بدايته). أثناء التوقف
   * يتجمّد الرقم طبيعيًا لأن حدّي الطرح يكبران معًا.
   */
  const pausedMs =
    (status?.pausedMsBase ?? 0) +
    (activePause ? Math.max(0, nowTick - new Date(activePause.startedIso).getTime()) : 0);
  const elapsedMinutes =
    checkedIn && startedMs ? Math.max(0, Math.floor((nowTick - startedMs - pausedMs) / 60_000)) : 0;
  const progressPct = Math.min(100, Math.round((elapsedMinutes / targetMinutes) * 100));
  const targetDone = elapsedMinutes >= targetMinutes;
  // نهاية دوامه تتأخر بمقدار التوقف — البداية + الهدف + المخصوم.
  const shiftEndIso = startedMs ? new Date(startedMs + targetMinutes * 60_000 + pausedMs).toISOString() : null;
  const hasMoves = (status?.stations.length ?? 0) > 1;
  const pauseMinutes = activePause
    ? Math.max(0, Math.floor((nowTick - new Date(activePause.startedIso).getTime()) / 60_000))
    : 0;

  return (
    <section
      dir="rtl"
      aria-label="تسجيل الدوام"
      className="att-scope relative overflow-hidden"
      style={{
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        borderRadius: 18,
        padding: "15px 15px 14px",
        border: "1px solid var(--att-esp-line)",
        background:
          "radial-gradient(130% 100% at 85% -20%, var(--att-esp-bg2) 0%, transparent 55%), radial-gradient(120% 90% at 0% 110%, var(--att-esp-bg2) 0%, transparent 50%), var(--att-esp-bg)",
        // توكنات المكوّنات المشتركة تتبع الإسبريسو داخل هذي البطاقة فقط.
        ["--att-text" as string]: "var(--att-esp-text)",
        ["--att-muted" as string]: "var(--att-esp-muted)",
        ["--att-line" as string]: "var(--att-esp-line)",
        ["--att-card2" as string]: "var(--att-esp-card)",
      }}
    >
      {/* الإطار العلوي المضيء + الحبيبات */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          insetInline: "10%",
          top: 0,
          height: 1,
          background: "linear-gradient(90deg, transparent, var(--att-esp-glow), transparent)",
        }}
      />
      <span aria-hidden className="att-grain" />

      {/* ===== الرأس: أيقونة + العنوان + وسم الحالة ===== */}
      <div className="relative flex items-start justify-between gap-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-9 flex-none items-center justify-center rounded-xl border border-[var(--att-esp-line)] bg-[var(--att-esp-card)]">
            <MapPin aria-hidden size={16} strokeWidth={1.5} style={{ color: "var(--att-gold)" }} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15.5px] font-extrabold text-[var(--att-esp-text)]">تسجيل الدوام</h2>
            <p className="mt-0.5 truncate text-[12px] text-[var(--att-esp-muted)]">
              {statusFailed && !status ? "ما قدرنا نقرأ حالتك الحين" : statusLine(status)}
            </p>
          </div>
        </div>
        {status && status.state !== "none" && (
          <span
            className="flex-none rounded-lg px-2 py-1 text-[10.5px] font-bold"
            style={{
              color: paused
                ? "var(--att-pause)"
                : checkedIn
                  ? status.session?.wasLate
                    ? "var(--att-late)"
                    : "var(--att-on)"
                  : "var(--att-done)",
              background: soft(
                paused
                  ? "var(--att-pause)"
                  : checkedIn
                    ? status.session?.wasLate
                      ? "var(--att-late)"
                      : "var(--att-on)"
                    : "var(--att-done)",
                14,
              ),
            }}
          >
            {paused
              ? `${activePause!.kind === "EXCUSED" ? "مستأذن" : "غادر"} — بإذن ${activePause!.authorizerLabel}`
              : checkedIn
                ? status.session?.wasLate
                  ? "مداوم — مسجّل تأخير"
                  : "مداوم"
                : "منصرف"}
          </span>
        )}
      </div>

      {/* ===== الموافقة الأولى — تسبق أي قراءة موقع ===== */}
      {consent === false ? (
        <div className="relative flex flex-col gap-2.5 rounded-xl border border-[var(--att-esp-line)] bg-[var(--att-esp-card)] p-3">
          <div className="flex gap-2">
            <ShieldCheck aria-hidden size={17} strokeWidth={1.5} style={{ color: "var(--att-esp-muted)", flex: "none", marginTop: 2 }} />
            <p className="text-[12.5px] leading-relaxed text-[var(--att-esp-muted)]">
              التطبيق يقرأ موقعك لحظة تسجيل الحضور فقط، للتحقق أنك داخل موقع العمل. لا يتم تتبعك خارج ذلك.
            </p>
          </div>
          <button
            type="button"
            onClick={acceptConsent}
            className="min-h-10 cursor-pointer rounded-xl border-0 text-sm font-bold"
            style={{ background: "var(--att-gold)", color: "var(--att-on-gold)" }}
          >
            موافق
          </button>
        </div>
      ) : (
        consent === true && (
          <>
            {/* ===== العداد الكبير + خط اليوم — أثناء الدوام فقط ===== */}
            {checkedIn && startedMs && shiftEndIso && (
              <div className="relative flex flex-col gap-3">
                <BigCountdown
                  remainingSeconds={Math.max(
                    0,
                    targetMinutes * 60 -
                      Math.floor(
                        (Math.max(secTick, nowTick) -
                          startedMs -
                          (status.pausedMsBase +
                            (activePause
                              ? Math.max(0, Math.max(secTick, nowTick) - new Date(activePause.startedIso).getTime())
                              : 0))) /
                          1000,
                      ),
                  )}
                  zainClass={zain.className}
                  done={targetDone}
                  paused={paused}
                />

                {/* شريط التوقف — البداية والمدة الحية وزر الرجوع في الأسفل */}
                {paused && activePause && (
                  <div
                    className="flex items-center gap-2.5 rounded-xl border px-3 py-2.5"
                    style={{
                      borderColor: "color-mix(in srgb, var(--att-pause) 40%, transparent)",
                      background: soft("var(--att-pause)", 10),
                    }}
                  >
                    <PauseCircle aria-hidden size={17} strokeWidth={1.5} style={{ color: "var(--att-pause)", flex: "none" }} />
                    <p className="min-w-0 flex-1 text-[12px] leading-relaxed" style={{ color: "var(--att-esp-text)" }}>
                      العدّاد موقوف من {activePause.startedText}
                      <span className="block text-[11px]" style={{ color: "var(--att-esp-muted)" }}>
                        مدة التوقف حتى الآن {hmLabel(pauseMinutes, toArabicDigits)}
                      </span>
                    </p>
                  </div>
                )}
                <DayLine
                  stations={status.stations}
                  startIso={status.session!.startedAt}
                  shiftEndIso={shiftEndIso}
                  now={nowTick}
                  startLabel={`حضرت ${status.session!.startedAtText}`}
                  endLabel={`نهاية دوامك ${status.shiftEndText ?? "—"}`}
                />

                {/* ===== صف الإحصاءات — كله قابل للنقر يفتح السجل ===== */}
                <button
                  type="button"
                  onClick={() => {
                    setLogOpen((v) => !v);
                    setMovesSeen(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-xl border border-[var(--att-esp-line)] bg-[var(--att-esp-card)] px-3 py-2.5 text-right"
                >
                  <StatCell label="أنجزت" value={hmLabel(elapsedMinutes, toArabicDigits)} zainClass={zain.className} />
                  <StatCell label="زيارات مشاريع" value={toArabicDigits(status.visitsCount)} zainClass={zain.className} />
                  <StatCell label="خارج المقر" value={hmLabel(status.awayMinutes, toArabicDigits)} zainClass={zain.className} />
                  <StatCell label="التقدم" value={`${toArabicDigits(progressPct)}٪`} zainClass={zain.className} />
                  <span className="relative flex-none text-[var(--att-esp-muted)]">
                    <ChevronDown
                      aria-hidden
                      size={16}
                      strokeWidth={1.8}
                      style={{
                        transform: logOpen ? "rotate(180deg)" : "none",
                        transition: "transform 0.35s cubic-bezier(0.23,1,0.32,1)",
                      }}
                    />
                    {hasMoves && !movesSeen && !logOpen && (
                      <span
                        aria-hidden
                        className="att-pulse absolute -left-1 -top-1 size-2 rounded-full"
                        style={{ background: "var(--att-teal)" }}
                      />
                    )}
                  </span>
                </button>

                {/* ===== سجل التحركات القابل للطي ===== */}
                {logOpen && (
                  <StationsLog stations={status.stations} verifications={status.verifications} now={nowTick} />
                )}
              </div>
            )}

            {/* ===== الأزرار — أثناء التوقف: «رجعت» أساسي والانصراف يبقى متاحًا ===== */}
            <div className="relative flex flex-col gap-2">
              {paused ? (
                <>
                  <button
                    type="button"
                    onClick={() => void resumeShift()}
                    disabled={working || resumeBusy}
                    className="flex min-h-12 items-center justify-center gap-2 rounded-[13px] border-0 text-[15px] font-extrabold"
                    style={{
                      background: "var(--att-gold)",
                      color: "var(--att-on-gold)",
                      cursor: working || resumeBusy ? "default" : "pointer",
                      opacity: working || resumeBusy ? 0.6 : 1,
                    }}
                  >
                    <PlayCircle aria-hidden size={18} strokeWidth={2} />
                    {resumeBusy ? "لحظة…" : "رجعت — كمّل دوامي"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void punch("CHECK_OUT")}
                    disabled={working || resumeBusy}
                    className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--att-esp-line)] bg-[var(--att-esp-card)] text-[13.5px] font-semibold text-[var(--att-esp-text)]"
                    style={{ cursor: working || resumeBusy ? "default" : "pointer", opacity: working || resumeBusy ? 0.6 : 1 }}
                  >
                    <LogOut aria-hidden size={16} strokeWidth={1.5} />
                    {busy === "CHECK_OUT" ? "جاري تحديد موقعك…" : "تسجيل انصراف"}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => void punch(checkedIn ? "CHECK_OUT" : "CHECK_IN")}
                    disabled={working}
                    className="flex min-h-12 items-center justify-center gap-2 rounded-[13px] border-0 text-[15px] font-extrabold"
                    style={{
                      background: "var(--att-gold)",
                      color: "var(--att-on-gold)",
                      cursor: working ? "default" : "pointer",
                      opacity: working ? 0.6 : 1,
                    }}
                  >
                    {checkedIn ? <LogOut aria-hidden size={18} strokeWidth={2} /> : <LogIn aria-hidden size={18} strokeWidth={2} />}
                    {busy === "CHECK_IN" || busy === "CHECK_OUT"
                      ? "جاري تحديد موقعك…"
                      : checkedIn
                        ? "تسجيل انصراف"
                        : "تسجيل حضور"}
                  </button>

                  {checkedIn && (
                    <button
                      type="button"
                      onClick={() => void openLocationSheet()}
                      disabled={working}
                      className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--att-esp-line)] bg-[var(--att-esp-card)] text-[13.5px] font-semibold text-[var(--att-esp-text)]"
                      style={{ cursor: working ? "default" : "pointer", opacity: working ? 0.6 : 1 }}
                    >
                      <Route aria-hidden size={16} strokeWidth={1.5} />
                      {busy === "nearby" || busy === "LOCATION_CHANGE" ? "جاري تحديد موقعك…" : "تغيير موقعي"}
                    </button>
                  )}
                </>
              )}
            </div>
          </>
        )
      )}

      {/* ===== نتيجة آخر محاولة ===== */}
      {feedback && (
        <p
          role="status"
          className="relative rounded-xl px-3 py-2.5 text-[12.5px] leading-relaxed"
          style={{ color: TONE_VAR[feedback.tone], background: soft(TONE_VAR[feedback.tone], 12) }}
        >
          {feedback.text}
        </p>
      )}

      {/* شيت «وين أنت الآن؟» */}
      <LocationSheet
        open={sheet.open}
        locations={sheet.locations}
        busy={working}
        onPick={(l) => void pickLocation(l)}
        onClose={() => setSheet((s) => ({ ...s, open: false }))}
      />

      {/* ===== النداء الإجباري — يغطي الشاشة ولا يُغلق إلا برد ===== */}
      {consent === true && pendingVerify && (
        <VerifyModal
          pending={pendingVerify}
          onDone={(message, tone) => {
            setPendingVerify(null);
            setFeedback({ tone, text: message });
            void loadStatus();
            void loadVerification();
          }}
          onExpired={() => {
            setPendingVerify(null);
            setFeedback({ tone: "warning", text: "فات وقت النداء — بلّغنا الإدارة أنه ما تم الرد" });
            void loadVerification();
          }}
        />
      )}
    </section>
  );
}

/* ═══════════════════ العداد الكبير H:MM:SS ═══════════════════ */

/**
 * الباقي من دوامه — كل خانة تُحدَّث منفردة وتنبض عند تغيّرها (المفتاح
 * موضع+قيمة فيعاد تركيب الخانة المتغيّرة وحدها فتجري حركة att-tick).
 * الاتجاه LTR داخل حاوية معزولة، أرقام Zain tabular. أثناء التوقف يتجمّد
 * الرقم (الأب يمرر باقيًا ثابتًا) ويتحوّل لونه بنفسجيًا.
 */
function BigCountdown({
  remainingSeconds,
  zainClass,
  done,
  paused,
}: {
  remainingSeconds: number;
  zainClass: string;
  done: boolean;
  paused: boolean;
}) {
  const h = Math.floor(remainingSeconds / 3600);
  const m = Math.floor((remainingSeconds % 3600) / 60);
  const s = remainingSeconds % 60;
  const text = `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  const chars = useMemo(() => toArabicDigits(text).split(""), [text]);

  return (
    <div className="text-center">
      <p className="text-[10.5px] font-medium text-[var(--att-esp-muted)]">
        {paused ? "العدّاد موقوف" : done ? "أكملت دوامك اليوم" : "الباقي من دوامك"}
      </p>
      <div dir="ltr" className="mt-1 flex items-baseline justify-center" style={{ unicodeBidi: "isolate" }}>
        {chars.map((c, i) => (
          <span
            key={`${i}-${c}`}
            className={`${zainClass} att-tick inline-block text-[38px] font-extrabold leading-none`}
            style={{
              color: paused ? "var(--att-pause)" : done ? "var(--att-on)" : "var(--att-esp-text)",
              fontVariantNumeric: "tabular-nums",
              minWidth: c === ":" ? undefined : "0.62em",
              textAlign: "center",
            }}
          >
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}

function StatCell({ label, value, zainClass }: { label: string; value: string; zainClass: string }) {
  return (
    <span className="block min-w-0 flex-1">
      <span className="block truncate text-[9.5px] text-[var(--att-esp-muted)]">{label}</span>
      <span
        className={`${zainClass} mt-0.5 block truncate text-[14px] font-bold text-[var(--att-esp-text)]`}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </span>
    </span>
  );
}

/** سطر الحالة تحت العنوان — يتبع الجلسة لا آخر بصمة. */
function statusLine(status: StatusPayload | null): string {
  if (!status) return "جاري قراءة حالتك…";
  if (status.state === "in") {
    const current = status.stations.find((s) => s.toIso === null);
    const where = current?.name ?? status.session?.locationName;
    return `مداوم منذ ${status.session?.startedAtText ?? "—"}${where ? ` — ${where}` : ""}`;
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
  if (data.type === "LOCATION_CHANGE") {
    return data.outOfZone
      ? "سجّلنا موقعك خارج النطاق — دوامك مستمر وتم إشعار الإدارة"
      : `تم تغيير موقعك ${at}${where}`;
  }
  return `تم التسجيل ${at}${where}`;
}

export default AttendanceCard;
