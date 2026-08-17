"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Zain } from "next/font/google";
import {
  CalendarDays,
  ChevronDown,
  Laptop,
  LogIn,
  LogOut,
  MapPin,
  PauseCircle,
  PlayCircle,
  Route,
  ShieldCheck,
  Undo2,
} from "lucide-react";
import { hmLabel, type AttendanceTheme } from "@/lib/attendance-ui";
import { toArabicDigits } from "@/lib/format";
import { DayLine, StationsLog, type StationDto, type VerificationDto } from "@/components/attendance/attendance-stations";
import { LocationSheet, type NearbyLocation } from "@/components/attendance/location-sheet";
import { VerifyModal, type PendingCall } from "@/components/attendance/attendance-verify-modal";
import { AttendancePanel } from "@/components/attendance/attendance-panel";
import { useAttendanceShell, type ShellAttendance } from "@/components/mobile/attendance-shell";
import { MobilePortal } from "@/components/mobile/portal";
import "./attendance.css";

const zain = Zain({ subsets: ["arabic"], weight: ["700", "800"], display: "swap" });

/**
 * بطاقة «تسجيل الدوام» — الدفعة الرابعة: الحساب **يومي** لا جلسي (الانصراف
 * بالغلط يُستأنف)، وثلاثة أوضاع لبداية اليوم (في الموقع · عن بُعد · إجازة)،
 * وتأكيد قبل الانصراف الناقص مع نافذة تراجع ٩٠ ثانية، والنداء الأول لطيف
 * (شريط ثابت) قبل النافذة الإجبارية، وفحص موقع صامت عند الفتح (مُفصح عنه).
 *
 * القراءة تحدث لحظة الحاجة فقط — لا تتبّع بالخلفية، والخادم يقرر كل شيء.
 */

/** مفتاح إفصاح v3 — النص الجديد يشمل النبض الجغرافي الدوري فيجب أن يراه الجميع مجددًا. */
const CONSENT_KEY = "attendance-geo-consent-v3";

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
  pausedMsBase: number;
  activePause: {
    kind: "EXCUSED" | "LEFT" | "NO_RESPONSE";
    authorizerLabel: string;
    reason: string | null;
    startedIso: string;
    startedText: string;
  } | null;
  /** الدفعة الرابعة — الحساب اليومي والأوضاع. */
  dayBaseMinutes: number;
  sessionsToday: number;
  day: {
    mode: "ONSITE" | "REMOTE" | "LEAVE";
    wasLate: boolean;
    unconfirmedMinutes: number;
    autoEnded: boolean;
    remoteAuthorizerLabel: string | null;
    startedText: string;
    firstCheckInText: string | null;
  } | null;
  onLeaveToday: boolean;
  /** إجازة/استئذان ذاتيان (شاشة الحسم) — للتراجع: النوع + هل هو داخل النطاق الآن. */
  selfOff: { kind: "LEAVE" | "EXCUSED"; inZoneNow: boolean; zoneName: string | null } | null;
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
  resumed?: boolean;
  dayWorkedMinutes?: number;
  undoUntilIso?: string | null;
};

type FeedbackTone = "success" | "danger" | "warning" | "info";

const TONE_VAR: Record<FeedbackTone, string> = {
  success: "var(--att-on)",
  danger: "var(--att-miss)",
  warning: "var(--att-late)",
  info: "var(--att-teal)",
};

type Authorizer = { id: string; label: string };

const LEAVE_TYPES = [
  { key: "SICK", label: "مرضية" },
  { key: "OFFICIAL", label: "رسمية" },
  { key: "PERSONAL", label: "ظرف خاص" },
] as const;

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

/*
 * prop الثيم أُحييت (إلباس «الديوان» — عزل الديسكتوب): تفريع **بصري بحت** —
 * "mobile" داخل مزوّد القشرة = البطاقة تنطوي أثناء الدوام واللوحة المنبثقة
 * تحمل عناصرها؛ "web" (لوحات الديسكتوب) = السلوك القائم حرفيًا بلا مساس.
 * الألوان تبقى من متغيرات CSS حصرًا.
 */
export function AttendanceCard({ theme = "web" }: { theme?: AttendanceTheme }) {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [consent, setConsent] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<Intent | "nearby" | null>(null);
  const [feedback, setFeedback] = useState<{ tone: FeedbackTone; text: string } | null>(null);
  const [pendingVerify, setPendingVerify] = useState<PendingCall | null>(null);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [movesSeen, setMovesSeen] = useState(false);
  // «تفاصيل اليوم» باللوحة المنبثقة — عناصر v2 المرحّلة خلف زر توسيع (المطابقة).
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [sheet, setSheet] = useState<{ open: boolean; locations: NearbyLocation[] }>({ open: false, locations: [] });
  const lastPosRef = useRef<{ pos: GeolocationPosition; at: number } | null>(null);
  // الدفعة الرابعة: تدفق أوضاع البداية + تأكيد الانصراف + نافذة التراجع.
  const [modeFlow, setModeFlow] = useState<null | "remote" | "leave">(null);
  const [authorizers, setAuthorizers] = useState<Authorizer[] | null>(null);
  const [confirmOut, setConfirmOut] = useState(false);
  const [undoUntil, setUndoUntil] = useState<number | null>(null);
  const silentBusyRef = useRef(false);
  // دقيقة للتقدم والسجل؛ وثانية للعداد الكبير أثناء الدوام فقط.
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [secTick, setSecTick] = useState(() => Date.now());
  // مزوّد قشرة الجوال (زر الكبسولة + الشارة) — null على الويب فالسلوك القائم.
  const shell = useAttendanceShell();

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

  // نافذة التراجع تحتاج ثانية حية وإن لم تكن الجلسة مفتوحة.
  useEffect(() => {
    if (undoUntil === null) return;
    const t = setInterval(() => setSecTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [undoUntil]);

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
   * التطبيق على الرئيسية حيث هذي البطاقة.
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

  /*
   * ===== الفحص الصامت (الدفعة الرابعة) =====
   * عند الفتح/العودة للمقدمة: نسأل الخادم «هل الفحص مستحق؟» (وضع في الموقع +
   * جلسة مفتوحة + مرّ الفاصل) — وإن استُحق تُقرأ قراءة واحدة **بصمت** وتُرسل.
   * لا أثر مرئي إطلاقًا، والفشل/الرفض يُتجاهل. مذكور صراحة في شاشة الإفصاح.
   */
  const silentCheck = useCallback(async () => {
    if (silentBusyRef.current) return;
    silentBusyRef.current = true;
    try {
      const res = await fetch("/api/attendance/silent-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = (await res.json()) as { ok: boolean; due?: boolean };
      if (data.due) {
        const pos = await readPosition();
        await fetch("/api/attendance/silent-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          }),
        });
      }
    } catch {
      /* صامت بالتعريف */
    }
    silentBusyRef.current = false;
  }, []);

  useEffect(() => {
    if (consent !== true) return;
    void silentCheck();
    const onVisible = () => {
      if (document.visibilityState === "visible") void silentCheck();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [consent, silentCheck]);

  /** «رجعت / سجّل حضوري» — يقفل التوقف الجاري ويستأنف العدّاد. */
  /**
   * التراجع عن إجازة/استئذان ذاتيين (شاشة الحسم) — «أبي أداوم اليوم»:
   * يوسم القرار REVOKED ويرجع اليوم «في الموقع»، وإن كان داخل النطاق يبصم فورًا.
   */
  const [revokeBusy, setRevokeBusy] = useState(false);
  const revokeSelfOff = async (thenPunch: boolean) => {
    setRevokeBusy(true);
    try {
      const res = await fetch("/api/attendance/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "REVOKE" }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; message?: string };
      if (!data.ok) {
        setFeedback({ tone: "warning", text: data.error ?? "ما نفذت — حاول مرة ثانية" });
      } else {
        await loadStatus();
        if (thenPunch) {
          await punch("CHECK_IN");
        } else {
          setFeedback({ tone: "success", text: data.message ?? "رجعنا يومك «في الموقع» — بصم متى جهزت" });
        }
      }
    } catch {
      setFeedback({ tone: "danger", text: "تعذّر الاتصال — حاول مرة ثانية" });
    }
    setRevokeBusy(false);
  };

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

  const acceptConsent = async () => {
    try {
      window.localStorage.setItem(CONSENT_KEY, "1");
    } catch {
      /* وضع التصفح الخاص — نكمل بلا حفظ */
    }
    setConsent(true);
    // توثيق الموافقة في سجل التدقيق — best-effort.
    fetch("/api/attendance/consent", { method: "POST" }).catch(() => {});
  };

  /** بصمة حضور/انصراف أو تغيير موقع — كلها نفس المسار والخادم يحكم. */
  const punch = async (intent: Intent, targetLocationId?: string, presetPos?: GeolocationPosition) => {
    setBusy(intent);
    setConfirmOut(false);
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
        if (data.type === "CHECK_OUT" && data.undoUntilIso) {
          setUndoUntil(new Date(data.undoUntilIso).getTime());
        }
        await loadStatus();
        void loadVerification();
      }
    } catch {
      setFeedback({ tone: "danger", text: "تعذّر الاتصال — تأكد من الإنترنت وحاول مرة ثانية" });
    }
    setBusy(null);
  };

  /** «تراجع» — يلغي الانصراف الحديث ويعيد الجلسة كما كانت. */
  const undoCheckout = async () => {
    setUndoUntil(null);
    try {
      const res = await fetch("/api/attendance/punch/undo", { method: "POST" });
      const data = (await res.json()) as { ok: boolean; message?: string };
      setFeedback({ tone: data.ok ? "success" : "warning", text: data.message ?? "" });
      await loadStatus();
    } catch {
      setFeedback({ tone: "danger", text: "تعذّر الاتصال — تأكد من الإنترنت" });
    }
  };

  /** «تغيير موقعي»: الشيت ينفتح فورًا بحالة قراءة — والقائمة بعد الإحداثيات فقط. */
  const openLocationSheet = () => {
    setSheet({ open: true, locations: [] });
  };

  /** قراءة الشيت — يستدعيها الشيت نفسه (فتح/إعادة محاولة/تحسين دقة). */
  const readForSheet = useCallback(async (): Promise<{ locations: NearbyLocation[]; accuracy: number }> => {
    const pos = await readPosition();
    lastPosRef.current = { pos, at: Date.now() };
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
    if (!data.ok || !data.locations) throw new Error(data.message ?? "fetch_failed");
    return { locations: data.locations, accuracy: pos.coords.accuracy };
  }, []);

  const pickLocation = async (loc: NearbyLocation) => {
    setSheet((s) => ({ ...s, open: false }));
    /*
     * قرار المالك: قراءة أقدم من ٦٠ ثانية باطلة — تُعاد القراءة إجباريًا
     * قبل الإرسال (والخادم يعيد الحساب على كل حال).
     */
    const fresh = lastPosRef.current && Date.now() - lastPosRef.current.at <= 60_000;
    await punch("LOCATION_CHANGE", loc.id, fresh ? lastPosRef.current!.pos : undefined);
  };

  /** جهات الإذن — تُجلب عند أول حاجة (عن بُعد/إجازة). */
  const loadAuthorizers = useCallback(async () => {
    if (authorizers !== null) return;
    try {
      const res = await fetch("/api/attendance/authorizers", { cache: "no-store" });
      const data = (await res.json()) as { ok: boolean; authorizers?: Authorizer[] };
      setAuthorizers(data.ok && data.authorizers ? data.authorizers : []);
    } catch {
      setAuthorizers([]);
    }
  }, [authorizers]);

  const working = busy !== null;
  const startedMs = status?.session?.startedAt ? new Date(status.session.startedAt).getTime() : null;
  const targetMinutes = Math.max(1, status?.targetMinutes ?? 480);
  const activePause = status?.activePause ?? null;
  const paused = checkedIn && activePause !== null;
  const noResponsePause = paused && activePause!.kind === "NO_RESPONSE";
  const pausedMs =
    (status?.pausedMsBase ?? 0) +
    (activePause ? Math.max(0, nowTick - new Date(activePause.startedIso).getTime()) : 0);
  /*
   * الحساب اليومي (الدفعة الرابعة): المنجز = أساس اليوم المغلق + الجلسة الحية
   * صافية — العدّاد يعرض **مجموع اليوم**، والاستئناف يكمل ولا يصفّر.
   */
  const dayBase = status?.dayBaseMinutes ?? 0;
  const liveMinutes =
    checkedIn && startedMs ? Math.max(0, Math.floor((nowTick - startedMs - pausedMs) / 60_000)) : 0;
  const elapsedMinutes = dayBase + liveMinutes;
  const progressPct = Math.min(100, Math.round((elapsedMinutes / targetMinutes) * 100));
  const targetDone = elapsedMinutes >= targetMinutes;
  const shiftEndIso =
    checkedIn && startedMs
      ? new Date(startedMs + Math.max(0, targetMinutes - dayBase) * 60_000 + pausedMs).toISOString()
      : null;
  const hasMoves = (status?.stations.length ?? 0) > 1;
  const pauseMinutes = activePause
    ? Math.max(0, Math.floor((nowTick - new Date(activePause.startedIso).getTime()) / 60_000))
    : 0;
  const dayMode = status?.day?.mode ?? "ONSITE";
  const onLeave = dayMode === "LEAVE" || (status?.onLeaveToday ?? false);
  const remoteDay = dayMode === "REMOTE";
  const undoLeft = undoUntil !== null ? Math.max(0, Math.ceil((undoUntil - Math.max(secTick, nowTick)) / 1000)) : 0;

  useEffect(() => {
    if (undoUntil !== null && undoLeft <= 0) setUndoUntil(null);
  }, [undoLeft, undoUntil]);

  /*
   * ===== إلباس «الديوان» (بصري بحت) =====
   * mobileShell: بطاقة الجوال داخل مزوّد القشرة الفعّال. collapsed: أثناء
   * الدوام تنطوي البطاقة الكبيرة — يبقى زر الكبسولة وشارة «مداوم»، وعناصر
   * v2 (الخط/المحطات/الإحصاءات/الانصراف) تعيش داخل اللوحة المنبثقة.
   * «دوامك متوقف» (عدم الرد) حرجة فتبقى بطاقة ظاهرة — لا تنطوي.
   */
  const mobileShell = theme === "mobile" && shell !== null && shell.active;
  const collapsed = mobileShell && consent === true && checkedIn && !noResponsePause;
  const panelOpen = collapsed && (shell?.panelOpen ?? false);

  // نشر الحالة للمزوّد فور كل قراءة — زر الكبسولة يتزامن لحظيًا بلا نداء ثانٍ.
  const publish = shell?.publish;
  useEffect(() => {
    if (!publish || theme !== "mobile") return;
    if (!status) {
      publish(null);
      return;
    }
    const mini: ShellAttendance = {
      state: status.state,
      targetMinutes: Math.max(1, status.targetMinutes),
      dayBaseMinutes: status.dayBaseMinutes ?? 0,
      startedAtIso: status.session?.startedAt ?? null,
      pausedMsBase: status.pausedMsBase ?? 0,
      activePauseStartedIso: status.activePause?.startedIso ?? null,
      noResponse: status.activePause?.kind === "NO_RESPONSE",
      remote: status.day?.mode === "REMOTE",
      onLeave: status.day?.mode === "LEAVE" || status.onLeaveToday,
    };
    publish(mini);
  }, [publish, status, theme]);

  // انتهى الدوام (انصراف من اللوحة مثلًا) أو توقف عدم رد؟ اللوحة تُغلق.
  const setPanelOpen = shell?.setPanelOpen;
  useEffect(() => {
    if (!setPanelOpen) return;
    if (status !== null && (status.state !== "in" || noResponsePause)) setPanelOpen(false);
  }, [setPanelOpen, status, noResponsePause]);

  return (
    <>
      {/* ===== بطاقة الجوال `.att` — بنية المرجع حرفيًا (تنطوي أثناء الدوام) ===== */}
      {!collapsed && mobileShell && (
        <div
          dir="rtl"
          aria-label="تسجيل الدوام"
          className="att-scope relative overflow-hidden"
          style={{
            boxSizing: "border-box",
            background: "radial-gradient(130% 90% at 50% 0%, var(--m-sheet), var(--m-card))",
            border: "1px solid var(--m-hair)",
            borderRadius: 22,
            padding: "20px 18px",
          }}
        >
          {/* الخط العلوي المتدرّج `::before` */}
          <span
            aria-hidden
            style={{
              position: "absolute", insetInline: 0, top: 0, height: 1,
              background: "linear-gradient(90deg, transparent, var(--m-acc-a32), transparent)",
            }}
          />

          {/* ===== `.atop`: شارة الحالة + «دوامك» ===== */}
          <div className="relative flex items-center justify-between" style={{ marginBottom: 4 }}>
            {(() => {
              const tag =
                statusFailed && !status ? { color: "var(--att-miss)", label: "ما قدرنا نقرأ حالتك" }
                : !status ? { color: "var(--m-text3)", label: "جاري قراءة حالتك…" }
                : remoteDay ? { color: "var(--att-remote)", label: "عن بُعد" }
                : onLeave ? { color: "var(--att-leave)", label: "إجازة اليوم" }
                : noResponsePause ? { color: "var(--att-miss)", label: "متوقف — بلا رد" }
                : status.state === "out" && dayBase >= targetMinutes
                  ? { color: "var(--att-on)", label: "أكمل دوامه ✓" }
                : status.state === "out" ? { color: "var(--att-done)", label: "منصرف" }
                : { color: "var(--m-dw-amber)", label: "لم تسجّل الحضور" };
              return (
                <span
                  className="inline-flex items-center"
                  style={{
                    gap: 7, fontSize: 12, fontWeight: 600, color: tag.color,
                    background: `color-mix(in srgb, ${tag.color} 14%, transparent)`,
                    borderRadius: 9, padding: "6px 11px",
                  }}
                >
                  <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />
                  {tag.label}
                </span>
              );
            })()}
            <div className="text-left" style={{ fontSize: 11, color: "var(--m-text3)" }}>
              دوامك
              <b className={zain.className} style={{ display: "block", marginTop: 2, fontSize: 13, fontWeight: 700, color: "var(--m-text2)", fontVariantNumeric: "tabular-nums" }}>
                {targetLabel(targetMinutes)}
              </b>
            </div>
          </div>

          {/* ===== شاشة الإفصاح v2 — كما هي ===== */}
          {consent === false && (
            <div className="relative mt-2 flex flex-col gap-2.5 rounded-xl border p-3" style={{ borderColor: "var(--m-hair)", background: "var(--m-sheet)" }}>
              <div className="flex gap-2">
                <ShieldCheck aria-hidden size={17} strokeWidth={1.5} style={{ color: "var(--m-text2)", flex: "none", marginTop: 2 }} />
                <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--m-text2)" }}>
                  نظام الدوام يقرأ موقعك في حالات محددة: عند تسجيل حضورك وانصرافك، وعند تغيير موقعك،
                  وعند فتحك التطبيق أثناء دوامك، وقراءة دورية أثناء دوامك{" "}
                  <b className="font-bold" style={{ color: "var(--m-text1)" }}>ما دام التطبيق مفتوحًا</b> — للتأكد أنك في
                  موقع العمل.{" "}
                  <b className="font-bold" style={{ color: "var(--m-text1)" }}>
                    القراءة الدورية تتوقف لحظة إغلاق التطبيق، ولا تعمل خارج أوقات دوامك، ولا نتتبع موقعك في الخلفية أبدًا.
                  </b>{" "}
                  تُستخدم البيانات حصريًا لإثبات الحضور، ولك حق الاطلاع عليها وطلب تصحيحها.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void acceptConsent()}
                className="min-h-10 cursor-pointer rounded-xl border-0 text-sm font-bold"
                style={{ background: "var(--m-gold)", color: "var(--m-gold-bg)" }}
              >
                فهمت وموافق
              </button>
            </div>
          )}

          {consent === true && (
            <>
              {/* ===== يوم «عن بُعد» / «إجازة» — سطرا v2 ===== */}
              {remoteDay ? (
                <div className="relative mt-2 flex items-center gap-2.5 rounded-xl border px-3 py-3" style={{ borderColor: soft("var(--att-remote)", 40), background: soft("var(--att-remote)", 10) }}>
                  <Laptop aria-hidden size={17} strokeWidth={1.5} style={{ color: "var(--att-remote)", flex: "none" }} />
                  <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--m-text1)" }}>
                    تشتغل عن بُعد اليوم
                    {status?.day?.remoteAuthorizerLabel ? ` · بإذن ${status.day.remoteAuthorizerLabel}` : ""}
                    {status?.day?.startedText ? ` · سُجّل ${status.day.startedText}` : ""}
                  </p>
                </div>
              ) : onLeave ? (
                <div className="relative mt-2 flex flex-col gap-2.5">
                  <div className="flex items-center gap-2.5 rounded-xl border px-3 py-3" style={{ borderColor: soft("var(--att-leave)", 40), background: soft("var(--att-leave)", 10) }}>
                    <CalendarDays aria-hidden size={17} strokeWidth={1.5} style={{ color: "var(--att-leave)", flex: "none" }} />
                    <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--m-text1)" }}>
                      {status?.selfOff?.kind === "EXCUSED" ? "مستأذن اليوم" : "بإجازة اليوم"} — لا بصم ولا نداءات
                    </p>
                  </div>
                  {status?.selfOff && (
                    <>
                      {status.selfOff.inZoneNow && (
                        <button
                          type="button"
                          onClick={() => void revokeSelfOff(true)}
                          disabled={revokeBusy || working}
                          className="min-h-11 rounded-xl border-0 text-[13.5px] font-extrabold"
                          style={{ background: "var(--m-gold)", color: "var(--m-gold-bg)", opacity: revokeBusy ? 0.6 : 1 }}
                        >
                          {revokeBusy
                            ? "لحظة…"
                            : `أنت داخل ${status.selfOff.zoneName ?? "دائرة الدوام"} — تلغي ${status.selfOff.kind === "EXCUSED" ? "استئذانك" : "إجازتك"} وتبصم؟`}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void revokeSelfOff(false)}
                        disabled={revokeBusy || working}
                        className="min-h-10 rounded-xl border text-[12.5px] font-bold"
                        style={{ borderColor: "var(--m-hair)", background: "var(--m-sheet)", color: "var(--m-text1)", opacity: revokeBusy ? 0.6 : 1 }}
                      >
                        تراجعت — أبي أداوم اليوم
                      </button>
                    </>
                  )}
                </div>
              ) : noResponsePause ? (
                /* ===== «دوامك متوقف» — حرجة فتبقى ظاهرة (قرار معتمد) ===== */
                <div className="relative mt-2 flex flex-col gap-2.5 rounded-xl border p-3" style={{ borderColor: soft("var(--att-miss)", 45), background: soft("var(--att-miss)", 10) }}>
                  <p className="text-[13.5px] font-extrabold" style={{ color: "var(--m-text1)" }}>دوامك متوقف</p>
                  <p className="text-[12px] leading-relaxed" style={{ color: "var(--m-text2)" }}>
                    ما وصلنا ردك على نداءي التحقق، فتوقف عدّادك الساعة {activePause?.startedText ?? "—"}. إذا كنت لا
                    تزال بموقع العمل، سجّل حضورك ليكمل الوقت من الآن.
                  </p>
                  <button
                    type="button"
                    onClick={() => void resumeShift()}
                    disabled={resumeBusy}
                    className="min-h-11 rounded-xl border-0 text-sm font-extrabold"
                    style={{ background: "var(--m-gold)", color: "var(--m-gold-bg)", opacity: resumeBusy ? 0.6 : 1 }}
                  >
                    {resumeBusy ? "لحظة…" : "سجّل حضوري"}
                  </button>
                </div>
              ) : (
                status && (
                  <>
                    {/* ===== `.ringbox` ١٨٤px — حلقة r=77 stroke=8 بتدرّج ذهبي ===== */}
                    <div className="relative" style={{ width: 184, height: 184, margin: "10px auto 6px" }}>
                      <svg width={184} height={184} style={{ transform: "rotate(-90deg)" }} aria-hidden>
                        <defs>
                          <linearGradient id="att-card-grad" x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0" style={{ stopColor: "var(--m-grad-a)" }} />
                            <stop offset="1" style={{ stopColor: "var(--m-grad-c)" }} />
                          </linearGradient>
                        </defs>
                        <circle cx={92} cy={92} r={77} fill="none" strokeWidth={8} style={{ stroke: "var(--m-border)" }} />
                        <circle
                          cx={92} cy={92} r={77} fill="none" strokeWidth={8} strokeLinecap="round"
                          stroke="url(#att-card-grad)"
                          strokeDasharray={483}
                          strokeDashoffset={483 * (1 - Math.min(1, dayBase / targetMinutes))}
                          style={{ transition: "stroke-dashoffset 1.1s cubic-bezier(0.23, 1, 0.32, 1)" }}
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <div style={{ fontSize: 10, color: "var(--m-text3)", marginBottom: 5 }}>دوامك اليوم</div>
                        <div
                          dir="ltr"
                          className={zain.className}
                          style={{ fontSize: 29, fontWeight: 800, color: "var(--m-text2)", fontVariantNumeric: "tabular-nums" }}
                        >
                          {toArabicDigits(
                            `${Math.floor(Math.max(0, targetMinutes - dayBase) / 60)}:${String(Math.max(0, targetMinutes - dayBase) % 60).padStart(2, "0")}:00`,
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--m-text2)", marginTop: 5 }}>
                          {status.state === "out" && dayBase > 0 ? (
                            <>
                              أنجزت{" "}
                              <b className={zain.className} style={{ color: "var(--m-dw-green)", fontWeight: 700 }}>
                                {toArabicDigits(Math.min(100, Math.round((dayBase / targetMinutes) * 100)))}٪
                              </b>
                            </>
                          ) : (
                            "جاهز للبدء"
                          )}
                        </div>
                      </div>
                    </div>

                    {/* ===== `.arail` — بعد انصراف جزئي فقط (بيانات حقيقية) ===== */}
                    {status.state === "out" && dayBase > 0 && (
                      <div className="flex justify-around" style={{ margin: "8px 0 14px" }}>
                        <div className="text-center">
                          <div className={zain.className} style={{ fontSize: 14, fontWeight: 700, color: "var(--m-text1)", fontVariantNumeric: "tabular-nums" }}>
                            {status.day?.firstCheckInText ?? "—"}
                          </div>
                          <div style={{ fontSize: 9, color: "var(--m-text3)", marginTop: 2 }}>الحضور</div>
                        </div>
                        <div className="text-center">
                          <div className={zain.className} style={{ fontSize: 14, fontWeight: 700, color: "var(--m-text1)", fontVariantNumeric: "tabular-nums" }}>
                            {hmLabel(dayBase, toArabicDigits)}
                          </div>
                          <div style={{ fontSize: 9, color: "var(--m-text3)", marginTop: 2 }}>أنجزت</div>
                        </div>
                        <div className="text-center">
                          <div className={zain.className} style={{ fontSize: 14, fontWeight: 700, color: "var(--m-text1)", fontVariantNumeric: "tabular-nums" }}>
                            {toArabicDigits(Math.min(100, Math.round((dayBase / targetMinutes) * 100)))}٪
                          </div>
                          <div style={{ fontSize: 9, color: "var(--m-text3)", marginTop: 2 }}>النسبة</div>
                        </div>
                      </div>
                    )}

                    {/* ===== `.aloc` — آخر موقع مسجّل (يظهر فقط إن وُجد فعلًا) ===== */}
                    {status.session?.locationName && (
                      <div className="flex items-center" style={{ gap: 9, background: "var(--m-bg)", border: "1px solid var(--m-hair)", borderRadius: 12, padding: "10px 12px", marginBottom: 14 }}>
                        <span className="flex flex-none items-center justify-center" style={{ width: 30, height: 30, borderRadius: 9, background: "var(--m-dw-sky-dim)", color: "var(--m-dw-sky)" }}>
                          <MapPin aria-hidden size={15} strokeWidth={1.7} />
                        </span>
                        <div className="flex-1">
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--m-text1)" }}>{status.session.locationName}</div>
                          <div style={{ fontSize: 10, color: "var(--m-text3)", marginTop: 1 }}>آخر موقع مسجّل</div>
                        </div>
                      </div>
                    )}

                    {/* ===== شرائح الأوضاع الثلاثة (v2) — الدمج المعتمد داخل `.att` ===== */}
                    {status.state === "none" && status.sessionsToday === 0 && (
                      <div style={{ marginBottom: 14 }}>
                        <ModeChips
                          diwan
                          flow={modeFlow}
                          setFlow={(f) => {
                            setModeFlow(f);
                            if (f) void loadAuthorizers();
                          }}
                          authorizers={authorizers}
                          onDone={(msg, tone) => {
                            setModeFlow(null);
                            setFeedback({ tone, text: msg });
                            void loadStatus();
                          }}
                        />
                      </div>
                    )}

                    {/* ===== `.aacts` — الزر الذهبي الكبير (يختفي بعد اكتمال الهدف — قرار ٧) ===== */}
                    {status.state === "out" && dayBase >= targetMinutes ? (
                      <p
                        className="flex items-center justify-center"
                        style={{ gap: 7, borderRadius: 13, padding: "13px 0", fontSize: 13, fontWeight: 700, background: soft("var(--att-on)", 12), color: "var(--att-on)" }}
                      >
                        أكملت دوامك اليوم ✓ — يعطيك العافية
                      </p>
                    ) : (
                      <div className="flex" style={{ gap: 9 }}>
                        <button
                          type="button"
                          onClick={() => void punch("CHECK_IN")}
                          disabled={working}
                          className="m-press flex flex-1 items-center justify-center"
                          style={{
                            boxSizing: "border-box", gap: 7, background: "var(--m-gold)", color: "var(--m-gold-bg)",
                            borderRadius: 13, padding: "13px 0", fontSize: 13, fontWeight: 700, border: "none",
                            boxShadow: "inset 0 1px 0 rgba(255,255,255,.22)",
                            opacity: working ? 0.6 : 1,
                          }}
                        >
                          <LogIn aria-hidden size={15} strokeWidth={1.8} />
                          {busy === "CHECK_IN"
                            ? "جاري تحديد موقعك…"
                            : status.state === "out"
                              ? "إكمال الدوام"
                              : "تسجيل الحضور"}
                        </button>
                      </div>
                    )}
                  </>
                )
              )}
            </>
          )}

          {/* ===== نتيجة آخر محاولة ===== */}
          {feedback && (
            <p
              role="status"
              className="relative mt-3 rounded-xl px-3 py-2.5 text-[12.5px] leading-relaxed"
              style={{ color: TONE_VAR[feedback.tone], background: soft(TONE_VAR[feedback.tone], 12) }}
            >
              {feedback.text}
            </p>
          )}
        </div>
      )}

      {/* ===== بطاقة الويب (الإسبريسو) — الديسكتوب كما هو حرفيًا ===== */}
      {!collapsed && !mobileShell && (
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
        ["--att-text" as string]: "var(--att-esp-text)",
        ["--att-muted" as string]: "var(--att-esp-muted)",
        ["--att-line" as string]: "var(--att-esp-line)",
        ["--att-card2" as string]: "var(--att-esp-card)",
      }}
    >
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

      {/* ===== الرأس ===== */}
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
        {status && (checkedIn || status.state === "out" || remoteDay || onLeave) && (
          <span
            className="flex-none rounded-lg px-2 py-1 text-[10.5px] font-bold"
            style={{
              color: headTagColor(status, paused, noResponsePause, remoteDay, onLeave),
              background: soft(headTagColor(status, paused, noResponsePause, remoteDay, onLeave), 14),
            }}
          >
            {headTagLabel(status, paused, activePause, remoteDay, onLeave)}
          </span>
        )}
      </div>

      {/* ===== الموافقة الأولى — شاشة الإفصاح الكاملة (v3) ===== */}
      {consent === false ? (
        <div className="relative flex flex-col gap-2.5 rounded-xl border border-[var(--att-esp-line)] bg-[var(--att-esp-card)] p-3">
          <div className="flex gap-2">
            <ShieldCheck aria-hidden size={17} strokeWidth={1.5} style={{ color: "var(--att-esp-muted)", flex: "none", marginTop: 2 }} />
            <p className="text-[12.5px] leading-relaxed text-[var(--att-esp-muted)]">
              نظام الدوام يقرأ موقعك في حالات محددة: عند تسجيل حضورك وانصرافك، وعند تغيير موقعك،
              وعند فتحك التطبيق أثناء دوامك، وقراءة دورية أثناء دوامك{" "}
              <b className="font-bold text-[var(--att-esp-text)]">ما دام التطبيق مفتوحًا</b> — للتأكد أنك في موقع العمل.{" "}
              <b className="font-bold text-[var(--att-esp-text)]">
                القراءة الدورية تتوقف لحظة إغلاق التطبيق، ولا تعمل خارج أوقات دوامك، ولا نتتبع موقعك في الخلفية أبدًا.
              </b>{" "}
              تُستخدم البيانات حصريًا لإثبات الحضور، ولك حق الاطلاع عليها وطلب تصحيحها.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void acceptConsent()}
            className="min-h-10 cursor-pointer rounded-xl border-0 text-sm font-bold"
            style={{ background: "var(--att-gold)", color: "var(--att-on-gold)" }}
          >
            فهمت وموافق
          </button>
        </div>
      ) : (
        consent === true && (
          <>
            {/* ===== يوم «عن بُعد» — سطر واحد وبس، لا عدّاد ولا أزرار ===== */}
            {remoteDay ? (
              <div className="relative flex items-center gap-2.5 rounded-xl border px-3 py-3" style={{ borderColor: soft("var(--att-remote)", 40), background: soft("var(--att-remote)", 10) }}>
                <Laptop aria-hidden size={17} strokeWidth={1.5} style={{ color: "var(--att-remote)", flex: "none" }} />
                <p className="text-[12.5px] leading-relaxed text-[var(--att-esp-text)]">
                  تشتغل عن بُعد اليوم
                  {status?.day?.remoteAuthorizerLabel ? ` · بإذن ${status.day.remoteAuthorizerLabel}` : ""}
                  {status?.day?.startedText ? ` · سُجّل ${status.day.startedText}` : ""}
                </p>
              </div>
            ) : onLeave ? (
              /* ===== يوم إجازة/استئذان — مع التراجع الذاتي ===== */
              <div className="relative flex flex-col gap-2.5">
                <div className="flex items-center gap-2.5 rounded-xl border px-3 py-3" style={{ borderColor: soft("var(--att-leave)", 40), background: soft("var(--att-leave)", 10) }}>
                  <CalendarDays aria-hidden size={17} strokeWidth={1.5} style={{ color: "var(--att-leave)", flex: "none" }} />
                  <p className="text-[12.5px] leading-relaxed text-[var(--att-esp-text)]">
                    {status?.selfOff?.kind === "EXCUSED" ? "مستأذن اليوم" : "بإجازة اليوم"} — لا بصم ولا نداءات
                  </p>
                </div>
                {status?.selfOff && (
                  <>
                    {status.selfOff.inZoneNow && (
                      <button
                        type="button"
                        onClick={() => void revokeSelfOff(true)}
                        disabled={revokeBusy || working}
                        className="min-h-11 rounded-xl border-0 text-[13.5px] font-extrabold"
                        style={{ background: "var(--att-gold)", color: "var(--att-on-gold)", opacity: revokeBusy ? 0.6 : 1 }}
                      >
                        {revokeBusy
                          ? "لحظة…"
                          : `أنت داخل ${status.selfOff.zoneName ?? "دائرة الدوام"} — تلغي ${status.selfOff.kind === "EXCUSED" ? "استئذانك" : "إجازتك"} وتبصم؟`}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void revokeSelfOff(false)}
                      disabled={revokeBusy || working}
                      className="min-h-10 rounded-xl border border-[var(--att-esp-line)] bg-[var(--att-esp-card)] text-[12.5px] font-bold text-[var(--att-esp-text)]"
                      style={{ opacity: revokeBusy ? 0.6 : 1 }}
                    >
                      تراجعت — أبي أداوم اليوم
                    </button>
                  </>
                )}
              </div>
            ) : noResponsePause ? (
              /* ===== شاشة «دوامك متوقف» — إيقاف عدم الرد ===== */
              <div className="relative flex flex-col gap-2.5 rounded-xl border p-3" style={{ borderColor: soft("var(--att-miss)", 45), background: soft("var(--att-miss)", 10) }}>
                <p className="text-[13.5px] font-extrabold text-[var(--att-esp-text)]">دوامك متوقف</p>
                <p className="text-[12px] leading-relaxed text-[var(--att-esp-muted)]">
                  ما وصلنا ردك على نداءي التحقق، فتوقف عدّادك الساعة {activePause?.startedText ?? "—"}. إذا كنت لا
                  تزال بموقع العمل، سجّل حضورك ليكمل الوقت من الآن.
                </p>
                <button
                  type="button"
                  onClick={() => void resumeShift()}
                  disabled={resumeBusy}
                  className="min-h-11 rounded-xl border-0 text-sm font-extrabold"
                  style={{ background: "var(--att-gold)", color: "var(--att-on-gold)", opacity: resumeBusy ? 0.6 : 1 }}
                >
                  {resumeBusy ? "لحظة…" : "سجّل حضوري"}
                </button>
              </div>
            ) : (
              <>
                {/* ===== العداد الكبير + خط اليوم — أثناء الدوام ===== */}
                {checkedIn && startedMs && shiftEndIso && status && (
                  <div className="relative flex flex-col gap-3">
                    <BigCountdown
                      remainingSeconds={Math.max(
                        0,
                        targetMinutes * 60 -
                          (dayBase * 60 +
                            Math.max(
                              0,
                              Math.floor(
                                (Math.max(secTick, nowTick) -
                                  startedMs -
                                  ((status.pausedMsBase ?? 0) +
                                    (activePause
                                      ? Math.max(0, Math.max(secTick, nowTick) - new Date(activePause.startedIso).getTime())
                                      : 0))) /
                                  1000,
                              ),
                            )),
                      )}
                      zainClass={zain.className}
                      done={targetDone}
                      paused={paused}
                    />

                    {status.sessionsToday > 1 && (
                      <p className="text-center text-[10.5px] text-[var(--att-esp-muted)]">
                        استأنفت دوامك — مجموع اليوم {hmLabel(elapsedMinutes, toArabicDigits)} من {targetLabel(targetMinutes)}
                      </p>
                    )}

                    {paused && activePause && !noResponsePause && (
                      <div
                        className="flex items-center gap-2.5 rounded-xl border px-3 py-2.5"
                        style={{ borderColor: soft("var(--att-pause)", 40), background: soft("var(--att-pause)", 10) }}
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
                      startLabel={`حضرت ${status.day?.firstCheckInText ?? status.session!.startedAtText}`}
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
                      <StatCell label="أنجزت اليوم" value={hmLabel(elapsedMinutes, toArabicDigits)} zainClass={zain.className} />
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
                          <span aria-hidden className="att-pulse absolute -left-1 -top-1 size-2 rounded-full" style={{ background: "var(--att-teal)" }} />
                        )}
                      </span>
                    </button>

                    {logOpen && <StationsLog stations={status.stations} verifications={status.verifications} now={nowTick} />}
                  </div>
                )}

                {/* ===== ملخص يوم منصرف جزئيًا ===== */}
                {status?.state === "out" && dayBase > 0 && (
                  <p className="relative text-[11.5px] text-[var(--att-esp-muted)]">
                    أنجزت اليوم <b className="font-bold text-[var(--att-esp-text)]">{hmLabel(dayBase, toArabicDigits)}</b> من{" "}
                    {targetLabel(targetMinutes)} — تقدر تكمل بأي وقت
                  </p>
                )}

                {/* ===== شرائح أوضاع بداية اليوم — قبل أول حضور فقط ===== */}
                {status?.state === "none" && status.sessionsToday === 0 && (
                  <ModeChips
                    flow={modeFlow}
                    setFlow={(f) => {
                      setModeFlow(f);
                      if (f) void loadAuthorizers();
                    }}
                    authorizers={authorizers}
                    onDone={(msg, tone) => {
                      setModeFlow(null);
                      setFeedback({ tone, text: msg });
                      void loadStatus();
                    }}
                  />
                )}

                {/* ===== تأكيد الانصراف الناقص ===== */}
                {confirmOut && (
                  <div className="relative flex flex-col gap-2.5 rounded-xl border p-3" style={{ borderColor: soft("var(--att-late)", 45), background: soft("var(--att-late)", 10) }}>
                    <p className="text-[12.5px] leading-relaxed text-[var(--att-esp-text)]">
                      متأكد تبي تنهي دوامك؟ باقي لك{" "}
                      <b className="font-bold">{hmLabel(Math.max(0, targetMinutes - elapsedMinutes), toArabicDigits)}</b> من دوامك
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void punch("CHECK_OUT")}
                        disabled={working}
                        className="min-h-10 flex-1 rounded-xl border-0 text-[13px] font-extrabold"
                        style={{ background: "var(--att-late)", color: "var(--att-esp-bg)", opacity: working ? 0.6 : 1 }}
                      >
                        نعم — إنهاء الدوام
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmOut(false)}
                        className="min-h-10 flex-1 rounded-xl border border-[var(--att-esp-line)] bg-[var(--att-esp-card)] text-[13px] font-bold text-[var(--att-esp-text)]"
                      >
                        أكمل دوامي
                      </button>
                    </div>
                  </div>
                )}

                {/* ===== نافذة التراجع ٩٠ ثانية — سطرية على الويب؛ الجوال له توست عائم ===== */}
                {!mobileShell && undoUntil !== null && undoLeft > 0 && (
                  <button
                    type="button"
                    onClick={() => void undoCheckout()}
                    className="relative flex min-h-11 items-center justify-center gap-2 rounded-xl border text-[13px] font-bold"
                    style={{ borderColor: soft("var(--att-teal)", 45), background: soft("var(--att-teal)", 10), color: "var(--att-teal)" }}
                  >
                    <Undo2 aria-hidden size={16} strokeWidth={1.8} />
                    تراجع عن الانصراف ({toArabicDigits(undoLeft)} ث)
                  </button>
                )}

                {/* ===== الأزرار ===== */}
                <div className="relative flex flex-col gap-2">
                  {paused && !noResponsePause ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void resumeShift()}
                        disabled={working || resumeBusy}
                        className="flex min-h-12 items-center justify-center gap-2 rounded-[13px] border-0 text-[15px] font-extrabold"
                        style={{ background: "var(--att-gold)", color: "var(--att-on-gold)", opacity: working || resumeBusy ? 0.6 : 1 }}
                      >
                        <PlayCircle aria-hidden size={18} strokeWidth={2} />
                        {resumeBusy ? "لحظة…" : "رجعت — كمّل دوامي"}
                      </button>
                      <button
                        type="button"
                        onClick={() => (elapsedMinutes < targetMinutes ? setConfirmOut(true) : void punch("CHECK_OUT"))}
                        disabled={working || resumeBusy}
                        className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--att-esp-line)] bg-[var(--att-esp-card)] text-[13.5px] font-semibold text-[var(--att-esp-text)]"
                        style={{ opacity: working || resumeBusy ? 0.6 : 1 }}
                      >
                        <LogOut aria-hidden size={16} strokeWidth={1.5} />
                        {busy === "CHECK_OUT" ? "جاري تحديد موقعك…" : "تسجيل انصراف"}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          checkedIn
                            ? elapsedMinutes < targetMinutes
                              ? setConfirmOut(true)
                              : void punch("CHECK_OUT")
                            : void punch("CHECK_IN")
                        }
                        disabled={working}
                        className="flex min-h-12 items-center justify-center gap-2 rounded-[13px] border-0 text-[15px] font-extrabold"
                        style={{ background: "var(--att-gold)", color: "var(--att-on-gold)", opacity: working ? 0.6 : 1 }}
                      >
                        {checkedIn ? <LogOut aria-hidden size={18} strokeWidth={2} /> : <LogIn aria-hidden size={18} strokeWidth={2} />}
                        {busy === "CHECK_IN" || busy === "CHECK_OUT"
                          ? "جاري تحديد موقعك…"
                          : checkedIn
                            ? "تسجيل انصراف"
                            : status?.state === "out"
                              ? "إكمال الدوام"
                              : "تسجيل حضور"}
                      </button>

                      {checkedIn && (
                        <button
                          type="button"
                          onClick={openLocationSheet}
                          disabled={working}
                          className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--att-esp-line)] bg-[var(--att-esp-card)] text-[13.5px] font-semibold text-[var(--att-esp-text)]"
                          style={{ opacity: working ? 0.6 : 1 }}
                        >
                          <Route aria-hidden size={16} strokeWidth={1.5} />
                          {busy === "LOCATION_CHANGE" ? "جاري التسجيل…" : "تغيير موقعي"}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
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
    </section>
      )}

      {/* ===== لوحة الدوام المنبثقة (الديوان §٣) — عناصر v2 مرحّلة بلا منطق جديد ===== */}
      {collapsed && status && startedMs && shiftEndIso && (
        <AttendancePanel
          open={panelOpen}
          onClose={() => shell?.setPanelOpen(false)}
          chip={{
            label: headTagLabel(status, paused, activePause, remoteDay, onLeave),
            color: headTagColor(status, paused, noResponsePause, remoteDay, onLeave),
          }}
        >
          {/* الحلقة الراديّة — العدّاد اليومي التراكمي (v2) داخلها */}
          <div className="relative mx-auto" style={{ width: 168, height: 168 }}>
            <svg width={168} height={168} style={{ transform: "rotate(-90deg)" }} aria-hidden>
              <defs>
                <linearGradient id="att-panel-grad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" style={{ stopColor: "var(--m-grad-a, var(--att-gold))" }} />
                  <stop offset="1" style={{ stopColor: "var(--m-grad-c, var(--att-gold))" }} />
                </linearGradient>
              </defs>
              <circle cx={84} cy={84} r={70} fill="none" strokeWidth={8} style={{ stroke: "var(--att-rail)" }} />
              <circle
                cx={84} cy={84} r={70} fill="none" strokeWidth={8} strokeLinecap="round"
                stroke="url(#att-panel-grad)"
                strokeDasharray={439.8}
                strokeDashoffset={439.8 * (1 - Math.min(1, progressPct / 100))}
                style={{ transition: "stroke-dashoffset 1s cubic-bezier(0.23, 1, 0.32, 1)" }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <BigCountdown
                remainingSeconds={Math.max(
                  0,
                  targetMinutes * 60 -
                    (dayBase * 60 +
                      Math.max(
                        0,
                        Math.floor(
                          (Math.max(secTick, nowTick) -
                            startedMs -
                            ((status.pausedMsBase ?? 0) +
                              (activePause
                                ? Math.max(0, Math.max(secTick, nowTick) - new Date(activePause.startedIso).getTime())
                                : 0))) /
                            1000,
                        ),
                      )),
                )}
                zainClass={zain.className}
                done={targetDone}
                paused={paused}
                size={25}
              />
              <p className="mt-1 text-[10px]" style={{ color: "var(--m-text2)" }}>
                أنجزت{" "}
                <b className={zain.className} style={{ color: "var(--m-dw-green)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                  {toArabicDigits(progressPct)}٪
                </b>
              </p>
            </div>
          </div>

          {/* ===== `.srail` — ثلاث خلايا فقط: الحضور / النهاية / أنجزت ===== */}
          <div className="flex justify-around gap-2 rounded-[14px] border" style={{ borderColor: "var(--m-hair)", background: "var(--m-bg)", padding: "12px 18px" }}>
            <StatCell label="الحضور" value={status.day?.firstCheckInText ?? status.session!.startedAtText} zainClass={zain.className} />
            <StatCell label="النهاية" value={status.shiftEndText ?? "—"} zainClass={zain.className} />
            <StatCell label="أنجزت" value={hmLabel(elapsedMinutes, toArabicDigits)} zainClass={zain.className} />
          </div>

          {/* ===== `.sloc` — الموقع الحالي + «منذ» ===== */}
          {(() => {
            const cur = status.stations.find((s) => s.toIso === null);
            const name = cur?.name ?? status.session?.locationName;
            if (!name) return null;
            const sinceMin = cur ? Math.max(0, Math.floor((nowTick - new Date(cur.fromIso).getTime()) / 60_000)) : null;
            return (
              <div className="flex items-center" style={{ gap: 9, background: "var(--m-bg)", border: "1px solid var(--m-hair)", borderRadius: 12, padding: "10px 12px" }}>
                <span className="flex flex-none items-center justify-center" style={{ width: 30, height: 30, borderRadius: 9, background: "var(--m-dw-sky-dim)", color: "var(--m-dw-sky)" }}>
                  <MapPin aria-hidden size={15} strokeWidth={1.7} />
                </span>
                <div className="flex-1">
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--m-text1)" }}>{name}</div>
                  <div style={{ fontSize: 10, color: "var(--m-text3)", marginTop: 1 }}>موقعك الحالي</div>
                </div>
                {sinceMin !== null && (
                  <span className={zain.className} style={{ fontSize: 10, color: "var(--m-text2)", fontVariantNumeric: "tabular-nums" }}>
                    منذ {hmLabel(sinceMin, toArabicDigits)}
                  </span>
                )}
              </div>
            );
          })()}

          {/* شريط التوقف الجاري (v2) */}
          {paused && activePause && (
            <div className="flex items-center gap-2.5 rounded-xl border px-3 py-2.5" style={{ borderColor: soft("var(--att-pause)", 40), background: soft("var(--att-pause)", 10) }}>
              <PauseCircle aria-hidden size={17} strokeWidth={1.5} style={{ color: "var(--att-pause)", flex: "none" }} />
              <p className="min-w-0 flex-1 text-[12px] leading-relaxed" style={{ color: "var(--att-esp-text)" }}>
                العدّاد موقوف من {activePause.startedText}
                <span className="block text-[11px]" style={{ color: "var(--att-esp-muted)" }}>
                  مدة التوقف حتى الآن {hmLabel(pauseMinutes, toArabicDigits)}
                </span>
              </p>
            </div>
          )}

          {/* ===== «تفاصيل اليوم» — عناصر v2 المرحّلة خلف زر توسيع بلغة `.big-act` ===== */}
          <button
            type="button"
            onClick={() => {
              setDetailsOpen((v) => !v);
              setMovesSeen(true);
            }}
            className="m-press flex w-full items-center text-right"
            style={{
              boxSizing: "border-box", gap: 12, padding: 13, borderRadius: 14,
              background: "var(--m-sheet)", border: "1px solid var(--m-hair)",
            }}
          >
            <span className="flex flex-none items-center justify-center" style={{ width: 38, height: 38, borderRadius: 11, background: "var(--m-acc-dim)", color: "var(--m-gold)" }}>
              <Route aria-hidden size={18} strokeWidth={1.8} />
            </span>
            <span className="flex-1">
              <span className="block" style={{ fontSize: 13, fontWeight: 600, color: "var(--m-text1)" }}>تفاصيل اليوم</span>
              <span className="block" style={{ fontSize: 10, color: "var(--m-text3)", marginTop: 2 }}>
                خط اليوم والمحطات والإحصاءات
              </span>
            </span>
            <span className="relative flex-none" style={{ color: "var(--m-text3)" }}>
              <ChevronDown
                aria-hidden
                size={16}
                strokeWidth={1.8}
                style={{
                  transform: detailsOpen ? "rotate(180deg)" : "none",
                  transition: "transform 0.35s cubic-bezier(0.23,1,0.32,1)",
                }}
              />
              {hasMoves && !movesSeen && !detailsOpen && (
                <span aria-hidden className="att-pulse absolute -left-1 -top-1 size-2 rounded-full" style={{ background: "var(--att-teal)" }} />
              )}
            </span>
          </button>

          {detailsOpen && (
            <>
              <DayLine
                stations={status.stations}
                startIso={status.session!.startedAt}
                shiftEndIso={shiftEndIso}
                now={nowTick}
                startLabel={`حضرت ${status.day?.firstCheckInText ?? status.session!.startedAtText}`}
                endLabel={`نهاية دوامك ${status.shiftEndText ?? "—"}`}
              />

              <div className="flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-right" style={{ borderColor: "var(--m-hair)", background: "var(--m-sheet)" }}>
                <StatCell label="أنجزت اليوم" value={hmLabel(elapsedMinutes, toArabicDigits)} zainClass={zain.className} />
                <StatCell label="زيارات مشاريع" value={toArabicDigits(status.visitsCount)} zainClass={zain.className} />
                <StatCell label="خارج المقر" value={hmLabel(status.awayMinutes, toArabicDigits)} zainClass={zain.className} />
              </div>

              <StationsLog stations={status.stations} verifications={status.verifications} now={nowTick} />
            </>
          )}

          {/* تأكيد الانصراف الناقص (v2) */}
          {confirmOut && (
            <div className="flex flex-col gap-2.5 rounded-xl border p-3" style={{ borderColor: soft("var(--att-late)", 45), background: soft("var(--att-late)", 10) }}>
              <p className="text-[12.5px] leading-relaxed text-[var(--att-esp-text)]">
                متأكد تبي تنهي دوامك؟ باقي لك{" "}
                <b className="font-bold">{hmLabel(Math.max(0, targetMinutes - elapsedMinutes), toArabicDigits)}</b> من دوامك
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void punch("CHECK_OUT")}
                  disabled={working}
                  className="min-h-10 flex-1 rounded-xl border-0 text-[13px] font-extrabold"
                  style={{ background: "var(--att-late)", color: "var(--att-esp-bg)", opacity: working ? 0.6 : 1 }}
                >
                  نعم — إنهاء الدوام
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmOut(false)}
                  className="min-h-10 flex-1 rounded-xl border border-[var(--att-esp-line)] bg-[var(--att-esp-card)] text-[13px] font-bold text-[var(--att-esp-text)]"
                >
                  أكمل دوامي
                </button>
              </div>
            </div>
          )}

          {/* ===== الأفعال `.big-act`: انصراف + تغيير موقعي فقط (قرار معتمد — لا استئذان ذاتيًا) ===== */}
          <div className="flex flex-col" style={{ gap: 9 }}>
            {paused && !noResponsePause && (
              <button
                type="button"
                onClick={() => void resumeShift()}
                disabled={working || resumeBusy}
                className="m-press flex w-full items-center text-right"
                style={{
                  boxSizing: "border-box", gap: 12, padding: 13, borderRadius: 14,
                  background: "var(--m-sheet)", border: "1px solid var(--m-hair)",
                  opacity: working || resumeBusy ? 0.6 : 1,
                }}
              >
                <span className="flex flex-none items-center justify-center" style={{ width: 38, height: 38, borderRadius: 11, background: "var(--m-dw-green-dim)", color: "var(--m-dw-green)" }}>
                  <PlayCircle aria-hidden size={18} strokeWidth={1.8} />
                </span>
                <span className="flex-1">
                  <span className="block" style={{ fontSize: 13, fontWeight: 600, color: "var(--m-text1)" }}>
                    {resumeBusy ? "لحظة…" : "رجعت — كمّل دوامي"}
                  </span>
                  <span className="block" style={{ fontSize: 10, color: "var(--m-text3)", marginTop: 2 }}>يستأنف العدّاد من الآن</span>
                </span>
                <span className="flex-none" style={{ color: "var(--m-text3)" }}>
                  <ChevronDown aria-hidden size={16} strokeWidth={1.7} style={{ transform: "rotate(90deg)" }} />
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => (elapsedMinutes < targetMinutes ? setConfirmOut(true) : void punch("CHECK_OUT"))}
              disabled={working || resumeBusy}
              className="m-press flex w-full items-center text-right"
              style={{
                boxSizing: "border-box", gap: 12, padding: 13, borderRadius: 14,
                background: "var(--m-sheet)", border: "1px solid var(--m-hair)",
                opacity: working || resumeBusy ? 0.6 : 1,
              }}
            >
              <span className="flex flex-none items-center justify-center" style={{ width: 38, height: 38, borderRadius: 11, background: "var(--m-acc-dim)", color: "var(--m-gold)" }}>
                <LogOut aria-hidden size={18} strokeWidth={1.8} />
              </span>
              <span className="flex-1">
                <span className="block" style={{ fontSize: 13, fontWeight: 600, color: "var(--m-text1)" }}>
                  {busy === "CHECK_OUT" ? "جاري تحديد موقعك…" : "تسجيل انصراف"}
                </span>
                <span className="block" style={{ fontSize: 10, color: "var(--m-text3)", marginTop: 2 }}>إنهاء دوام اليوم</span>
              </span>
              <span className="flex-none" style={{ color: "var(--m-text3)" }}>
                <ChevronDown aria-hidden size={16} strokeWidth={1.7} style={{ transform: "rotate(90deg)" }} />
              </span>
            </button>

            {!paused && (
              <button
                type="button"
                onClick={() => {
                  // الشيت (z-50) تحت اللوحة (z-65) — نغلق اللوحة أولًا ليظهر.
                  shell?.setPanelOpen(false);
                  openLocationSheet();
                }}
                disabled={working}
                className="m-press flex w-full items-center text-right"
                style={{
                  boxSizing: "border-box", gap: 12, padding: 13, borderRadius: 14,
                  background: "var(--m-sheet)", border: "1px solid var(--m-hair)",
                  opacity: working ? 0.6 : 1,
                }}
              >
                <span className="flex flex-none items-center justify-center" style={{ width: 38, height: 38, borderRadius: 11, background: "var(--m-dw-sky-dim)", color: "var(--m-dw-sky)" }}>
                  <MapPin aria-hidden size={18} strokeWidth={1.8} />
                </span>
                <span className="flex-1">
                  <span className="block" style={{ fontSize: 13, fontWeight: 600, color: "var(--m-text1)" }}>
                    {busy === "LOCATION_CHANGE" ? "جاري التسجيل…" : "تغيير موقعي"}
                  </span>
                  <span className="block" style={{ fontSize: 10, color: "var(--m-text3)", marginTop: 2 }}>
                    {status.stations.find((s) => s.toIso === null)?.name ?? status.session?.locationName ?? "تحديث موقعك الحالي"}
                  </span>
                </span>
                <span className="flex-none" style={{ color: "var(--m-text3)" }}>
                  <ChevronDown aria-hidden size={16} strokeWidth={1.7} style={{ transform: "rotate(90deg)" }} />
                </span>
              </button>
            )}
          </div>

          {/* نتيجة آخر محاولة — داخل اللوحة وهي مفتوحة */}
          {feedback && (
            <p
              role="status"
              className="rounded-xl px-3 py-2.5 text-[12.5px] leading-relaxed"
              style={{ color: TONE_VAR[feedback.tone], background: soft(TONE_VAR[feedback.tone], 12) }}
            >
              {feedback.text}
            </p>
          )}
        </AttendancePanel>
      )}

      {/* ===== توست التراجع العائم (جوال) — ستايل `.toast` من المرجع حرفيًا.
           عبر MobilePortal: transform باقٍ على .m-screen بعد حركتها فيكسر fixed تحتها. ===== */}
      {mobileShell && undoUntil !== null && undoLeft > 0 && (
        <MobilePortal>
        <div
          dir="rtl"
          className="att-scope m-toastin fixed z-[95]"
          style={{ bottom: "calc(100px + env(safe-area-inset-bottom))", left: "50%", transform: "translateX(-50%)" }}
        >
          <button
            type="button"
            onClick={() => void undoCheckout()}
            className="flex items-center whitespace-nowrap"
            style={{
              boxSizing: "border-box", gap: 8, borderRadius: 13, padding: "12px 18px",
              fontSize: 12.5, fontWeight: 600,
              border: "1px solid var(--m-dw-sky-dim)",
              background: "var(--m-sheet)",
              color: "var(--m-dw-sky)",
            }}
          >
            <Undo2 aria-hidden size={15} strokeWidth={1.8} />
            تراجع عن الانصراف ({toArabicDigits(undoLeft)} ث)
          </button>
        </div>
        </MobilePortal>
      )}

      {/* شيت «وين أنت الآن؟» — القراءة داخله والقائمة بعد الإحداثيات فقط.
          عبر البوابة لنفس علة الكتلة الحاوية (transform على .m-screen). */}
      <MobilePortal>
      <LocationSheet
        open={sheet.open}
        read={readForSheet}
        busy={working}
        onPick={(l) => void pickLocation(l)}
        onClose={() => setSheet((s) => ({ ...s, open: false }))}
      />

      {/* ===== النداء الأول لطيف (شريط ثابت) — والإجباري نافذة ===== */}
      {consent === true && pendingVerify && pendingVerify.kind === "RANDOM" ? (
        <SoftCallBar
          pending={pendingVerify}
          now={Math.max(secTick, nowTick)}
          onDone={(message, tone) => {
            setPendingVerify(null);
            setFeedback({ tone, text: message });
            void loadStatus();
            void loadVerification();
          }}
          onExpired={() => {
            setPendingVerify(null);
            void loadVerification();
          }}
        />
      ) : consent === true && pendingVerify ? (
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
      ) : null}
      </MobilePortal>
    </>
  );
}

/* ═══════════════════ شرائح أوضاع بداية اليوم ═══════════════════ */

function ModeChips({
  flow,
  setFlow,
  authorizers,
  onDone,
  diwan = false,
}: {
  flow: null | "remote" | "leave";
  setFlow: (f: null | "remote" | "leave") => void;
  authorizers: Authorizer[] | null;
  onDone: (message: string, tone: FeedbackTone) => void;
  /** كسوة الديوان (بطاقة الجوال): شرائح بمواصفات المرجع — المنطق نفسه حرفيًا. */
  diwan?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authorizerId, setAuthorizerId] = useState("");
  const [leaveType, setLeaveType] = useState<(typeof LEAVE_TYPES)[number]["key"]>("SICK");
  const [duration, setDuration] = useState<"1" | "2" | "3" | "custom">("1");
  const [fromKey, setFromKey] = useState("");
  const [toKey, setToKey] = useState("");
  const [pauseIntake, setPauseIntake] = useState(true);

  const todayKey = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
  const addDays = (key: string, n: number) =>
    new Date(new Date(`${key}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

  const submitRemote = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/attendance/day/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorizerId }),
      });
      const data = (await res.json()) as { ok: boolean; message?: string };
      if (data.ok) onDone("سجّلنا يومك «عن بُعد» — موفق", "success");
      else setError(data.message ?? "ما قدرنا نسجّل");
    } catch {
      setError("تعذّر الاتصال — حاول مرة ثانية");
    }
    setBusy(false);
  };

  const submitLeave = async () => {
    setBusy(true);
    setError(null);
    const from = duration === "custom" ? fromKey : todayKey;
    const to =
      duration === "custom" ? toKey : duration === "1" ? todayKey : addDays(todayKey, duration === "2" ? 1 : 2);
    try {
      const res = await fetch("/api/attendance/day/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leaveType, fromKey: from, toKey: to, authorizerId, pauseIntake }),
      });
      const data = (await res.json()) as { ok: boolean; message?: string };
      if (data.ok) onDone(data.message ?? "سجّلنا إجازتك", "success");
      else setError(data.message ?? "ما قدرنا نسجّل");
    } catch {
      setError("تعذّر الاتصال — حاول مرة ثانية");
    }
    setBusy(false);
  };

  return (
    <div className="relative flex flex-col gap-2.5">
      {/* الشرائح الثلاث — «في الموقع» الافتراضي */}
      <div className="flex gap-1.5">
        <Chip diwan={diwan} active={flow === null} onClick={() => setFlow(null)} icon={<MapPin aria-hidden size={14} strokeWidth={1.5} />}>
          في الموقع
        </Chip>
        <Chip diwan={diwan} active={flow === "remote"} onClick={() => setFlow("remote")} icon={<Laptop aria-hidden size={14} strokeWidth={1.5} />}>
          عن بُعد
        </Chip>
        <Chip diwan={diwan} active={flow === "leave"} onClick={() => setFlow("leave")} icon={<CalendarDays aria-hidden size={14} strokeWidth={1.5} />}>
          إجازة
        </Chip>
      </div>

      {flow !== null && (
        <div className="flex flex-col gap-2.5 rounded-xl border border-[var(--att-esp-line)] bg-[var(--att-esp-card)] p-3">
          {flow === "leave" && (
            <>
              <div className="flex gap-1.5">
                {LEAVE_TYPES.map((t) => (
                  <Chip key={t.key} diwan={diwan} active={leaveType === t.key} onClick={() => setLeaveType(t.key)}>
                    {t.label}
                  </Chip>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Chip diwan={diwan} active={duration === "1"} onClick={() => setDuration("1")}>اليوم فقط</Chip>
                <Chip diwan={diwan} active={duration === "2"} onClick={() => setDuration("2")}>يومان</Chip>
                <Chip diwan={diwan} active={duration === "3"} onClick={() => setDuration("3")}>٣ أيام</Chip>
                <Chip diwan={diwan} active={duration === "custom"} onClick={() => setDuration("custom")}>تحديد تاريخ</Chip>
              </div>
              {duration === "custom" && (
                <div className="flex gap-2">
                  <label className="flex-1 text-[10.5px] text-[var(--att-esp-muted)]">
                    من
                    <input type="date" value={fromKey} onChange={(e) => setFromKey(e.target.value)} dir="ltr" className="mt-1 h-9 w-full rounded-lg border px-2 text-[12px]" style={{ borderColor: "var(--att-esp-line)", background: "transparent", color: "var(--att-esp-text)" }} />
                  </label>
                  <label className="flex-1 text-[10.5px] text-[var(--att-esp-muted)]">
                    إلى
                    <input type="date" value={toKey} onChange={(e) => setToKey(e.target.value)} dir="ltr" className="mt-1 h-9 w-full rounded-lg border px-2 text-[12px]" style={{ borderColor: "var(--att-esp-line)", background: "transparent", color: "var(--att-esp-text)" }} />
                  </label>
                </div>
              )}
            </>
          )}

          {/* جهة الإذن — إلزامية للوضعين */}
          <div>
            <p className="mb-1.5 text-[10.5px] text-[var(--att-esp-muted)]">
              {flow === "remote" ? "مين أذن لك تشتغل عن بُعد؟" : "مين أذن لك بالإجازة؟"}
            </p>
            {authorizers === null ? (
              <p className="py-1 text-[11.5px] text-[var(--att-esp-muted)]">جاري تحميل الجهات…</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {authorizers.map((a) => (
                  <Chip key={a.id} diwan={diwan} active={authorizerId === a.id} onClick={() => setAuthorizerId(a.id)}>
                    {a.label}
                  </Chip>
                ))}
              </div>
            )}
          </div>

          {flow === "leave" && (
            <label className="flex items-center gap-2 text-[11.5px] text-[var(--att-esp-muted)]">
              <input type="checkbox" checked={pauseIntake} onChange={(e) => setPauseIntake(e.target.checked)} className="size-4 accent-[var(--att-gold)]" />
              إيقاف استقبال العملاء الجدد طوال الإجازة (يرجع تلقائيًا)
            </label>
          )}

          {error && <p className="text-[11.5px]" style={{ color: "var(--att-miss)" }}>{error}</p>}

          <button
            type="button"
            disabled={busy || !authorizerId || (flow === "leave" && duration === "custom" && (!fromKey || !toKey))}
            onClick={() => void (flow === "remote" ? submitRemote() : submitLeave())}
            className="min-h-11 rounded-xl border-0 text-[13.5px] font-extrabold disabled:opacity-50"
            style={{ background: "var(--att-gold)", color: "var(--att-on-gold)" }}
          >
            {busy ? "جاري التسجيل…" : flow === "remote" ? "تسجيل يوم عن بُعد" : "تسجيل الإجازة"}
          </button>
        </div>
      )}
    </div>
  );
}

function Chip({ active, onClick, icon, children, diwan = false }: { active: boolean; onClick: () => void; icon?: React.ReactNode; children: React.ReactNode; diwan?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 border px-2.5 py-1.5 text-[11.5px] font-bold"
      style={
        diwan
          ? {
              /* مواصفات الدمج المعتمد: خلفية s2 وحد hair وقطر 11 — النشطة accA32/accDim */
              borderRadius: 11,
              borderColor: active ? "var(--m-acc-a32)" : "var(--m-hair)",
              background: active ? "var(--m-acc-dim)" : "var(--m-sheet)",
              color: active ? "var(--m-gold)" : "var(--m-text2)",
            }
          : {
              borderRadius: 8,
              borderColor: active ? "var(--att-gold)" : "var(--att-esp-line)",
              background: active ? "color-mix(in srgb, var(--att-gold) 12%, transparent)" : "transparent",
              color: active ? "var(--att-gold)" : "var(--att-esp-muted)",
            }
      }
    >
      {icon}
      {children}
    </button>
  );
}

/* ═══════════════════ النداء اللطيف — شريط ثابت أعلى الشاشة ═══════════════════ */

function SoftCallBar({
  pending,
  now,
  onDone,
  onExpired,
}: {
  pending: PendingCall;
  now: number;
  onDone: (message: string, tone: FeedbackTone) => void;
  onExpired: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const deadline = useMemo(() => new Date(pending.deadlineAtIso).getTime(), [pending.deadlineAtIso]);
  const remainingMin = Math.max(0, Math.ceil((deadline - now) / 60_000));

  useEffect(() => {
    if (deadline - now <= 0) onExpired();
  }, [deadline, now, onExpired]);

  const confirm = async () => {
    setBusy(true);
    try {
      const pos = await readPosition();
      const res = await fetch("/api/attendance/verification/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answer: "HERE",
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          isMock: false,
        }),
      });
      const data = (await res.json()) as { ok: boolean; status?: string; message?: string; reason?: string };
      if (data.ok) onDone(data.message ?? "تم — أكّدنا موقعك", data.status === "CONFIRMED" ? "success" : "warning");
      else if (data.reason === "no_pending") onExpired();
      else onDone(data.message ?? "ما قدرنا نسجّل ردك", "warning");
    } catch (err) {
      onDone(geoErrorMessage(err), "danger");
    }
    setBusy(false);
  };

  return (
    <div
      dir="rtl"
      role="status"
      className="att-scope fixed inset-x-0 top-0 z-[60] flex items-center gap-2.5 border-b px-3.5 py-2.5"
      style={{ borderColor: soft("var(--att-gold)", 45), background: "var(--att-esp-bg)" }}
    >
      <span aria-hidden className="att-pulse size-2.5 flex-none rounded-full" style={{ background: "var(--att-gold)" }} />
      <p className="min-w-0 flex-1 text-[12px] leading-tight" style={{ color: "var(--att-esp-text)" }}>
        نداء تحقق — أكّد موقعك وأنت مكمّل شغلك
        <span className="block text-[10.5px]" style={{ color: "var(--att-esp-muted)" }}>
          باقي {toArabicDigits(remainingMin)} دقيقة
        </span>
      </p>
      <button
        type="button"
        onClick={() => void confirm()}
        disabled={busy}
        className="flex-none rounded-xl border-0 px-4 py-2 text-[12.5px] font-extrabold disabled:opacity-60"
        style={{ background: "var(--att-gold)", color: "var(--att-on-gold)" }}
      >
        {busy ? "لحظة…" : "أنا بالموقع"}
      </button>
    </div>
  );
}

/* ═══════════════════ العداد الكبير H:MM:SS ═══════════════════ */

function BigCountdown({
  remainingSeconds,
  zainClass,
  done,
  paused,
  size = 38,
}: {
  remainingSeconds: number;
  zainClass: string;
  done: boolean;
  paused: boolean;
  /** حجم الأرقام — 38 القائم (البطاقة)، وأصغر داخل حلقة اللوحة المنبثقة. */
  size?: number;
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
            className={`${zainClass} att-tick inline-block font-extrabold leading-none`}
            style={{
              fontSize: size,
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
      <span className={`${zainClass} mt-0.5 block truncate text-[14px] font-bold text-[var(--att-esp-text)]`} style={{ fontVariantNumeric: "tabular-nums" }}>
        {value}
      </span>
    </span>
  );
}

/** «٨ ساعات» أو «٧:٣٠ ساعة». */
function targetLabel(minutes: number): string {
  return minutes % 60 === 0 ? `${toArabicDigits(minutes / 60)} ساعات` : `${hmLabel(minutes, toArabicDigits)} ساعة`;
}

function headTagColor(
  status: StatusPayload,
  paused: boolean,
  noResponse: boolean,
  remoteDay: boolean,
  onLeave: boolean,
): string {
  if (remoteDay) return "var(--att-remote)";
  if (onLeave) return "var(--att-leave)";
  if (noResponse) return "var(--att-miss)";
  if (paused) return "var(--att-pause)";
  if (status.state === "in") return status.day?.wasLate ? "var(--att-late)" : "var(--att-on)";
  return "var(--att-done)";
}

function headTagLabel(
  status: StatusPayload,
  paused: boolean,
  activePause: StatusPayload["activePause"],
  remoteDay: boolean,
  onLeave: boolean,
): string {
  if (remoteDay) return "عن بُعد";
  if (onLeave) return "إجازة";
  if (paused && activePause) {
    if (activePause.kind === "NO_RESPONSE") return "متوقف — بلا رد";
    return `${activePause.kind === "EXCUSED" ? "مستأذن" : "غادر"} — بإذن ${activePause.authorizerLabel}`;
  }
  if (status.state === "in") return status.day?.wasLate ? "مداوم — مسجّل تأخير" : "مداوم";
  return "منصرف";
}

/** سطر الحالة تحت العنوان — يتبع اليوم لا الجلسة (الدفعة الرابعة). */
function statusLine(status: StatusPayload | null): string {
  if (!status) return "جاري قراءة حالتك…";
  if (status.day?.mode === "REMOTE") return "يوم عن بُعد";
  if (status.day?.mode === "LEAVE" || status.onLeaveToday) return "يوم إجازة";
  if (status.state === "in") {
    const current = status.stations.find((s) => s.toIso === null);
    const where = current?.name ?? status.session?.locationName;
    return `مداوم منذ ${status.day?.firstCheckInText ?? status.session?.startedAtText ?? "—"}${where ? ` — ${where}` : ""}`;
  }
  if (status.state === "out") {
    return status.sessionsToday > 1 ? "منصرف — تقدر تكمل دوامك بأي وقت" : "منصرف — دوام اليوم انتهى أو تكمله لاحقًا";
  }
  return "لم تسجّل حضورك اليوم";
}

/** نص النجاح حسب نوع البصمة. */
function successText(data: PunchResult): string {
  const at = data.timeKSA ?? "";
  const where = data.locationName ? ` — ${data.locationName}` : "";
  if (data.type === "CHECK_IN") {
    if (data.resumed) return `كمّلنا دوامك ${at}${where} — مجموعك محفوظ`;
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
