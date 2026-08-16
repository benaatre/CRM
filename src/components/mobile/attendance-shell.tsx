"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/**
 * مزوّد حالة الدوام لقشرة الجوال — بصري بحت (الخطوة ٤ من إلباس «الديوان»).
 *
 * الغرض: زر الدوام المرتفع بالكبسولة وشارة «مداوم» بالترويسة يحتاجان الحالة
 * خارج شجرة بطاقة الدوام. المصدر **نفس** GET /api/attendance/status القائم —
 * صفر مسارات جديدة وصفر منطق: القراءة هنا عرض فقط، والخادم يحكم كما هو.
 *
 * منعًا للنداءين المتوازيين: البطاقة (حين تكون معروضة) تنشر حالتها هنا عبر
 * `publish` فور كل loadStatus لها، فيتزامن الزر لحظيًا. وفي الشاشات التي لا
 * بطاقة فيها (العملاء/المتابعات…) يجلب المزوّد بنفسه كل دقيقة وعند العودة
 * للمقدمة. `enabled=false` (للإدارة) = لا جلب ولا زر.
 */

/** الحد الأدنى الذي يحتاجه الزر والشارة — مشتق من StatusPayload لا بديل عنه. */
export type ShellAttendance = {
  state: "none" | "in" | "out";
  targetMinutes: number;
  dayBaseMinutes: number;
  /** بداية الجلسة الحية (ISO) — null إن لم تكن جلسة مفتوحة. */
  startedAtIso: string | null;
  /** مجموع التوقفات المغلقة بالمللي ثانية. */
  pausedMsBase: number;
  /** بداية التوقف الجاري (ISO) — null إن لم يكن توقف. */
  activePauseStartedIso: string | null;
  /** توقف عدم الرد — الزر لا يعرض «مداوم» عنده. */
  noResponse: boolean;
  remote: boolean;
  onLeave: boolean;
};

type ShellContext = {
  /** الجلب والزر مفعّلان (موظف داخل قشرة الجوال). */
  active: boolean;
  status: ShellAttendance | null;
  /** البطاقة تنشر حالتها هنا بعد كل قراءة — يلغي أي انتظار للدورة القادمة. */
  publish: (s: ShellAttendance | null) => void;
  /** لوحة الدوام المنبثقة — يفتحها الزر وتغلقها اللوحة نفسها. */
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
};

const Ctx = createContext<ShellContext | null>(null);

/** null خارج المزوّد (لوحات الويب) — البطاقة تتصرف كما كانت تمامًا. */
export function useAttendanceShell(): ShellContext | null {
  return useContext(Ctx);
}

/** تحويل رد /api/attendance/status إلى الحد الأدنى — نفس حقول البطاقة حرفيًا. */
function toShell(data: Record<string, unknown>): ShellAttendance {
  const session = data.session as { startedAt?: string } | null;
  const pause = data.activePause as { kind?: string; startedIso?: string } | null;
  const day = data.day as { mode?: string } | null;
  return {
    state: (data.state as ShellAttendance["state"]) ?? "none",
    targetMinutes: Math.max(1, (data.targetMinutes as number) ?? 480),
    dayBaseMinutes: (data.dayBaseMinutes as number) ?? 0,
    startedAtIso: session?.startedAt ?? null,
    pausedMsBase: (data.pausedMsBase as number) ?? 0,
    activePauseStartedIso: pause?.startedIso ?? null,
    noResponse: pause?.kind === "NO_RESPONSE",
    remote: day?.mode === "REMOTE",
    onLeave: day?.mode === "LEAVE" || Boolean(data.onLeaveToday),
  };
}

export function AttendanceShellProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const [status, setStatus] = useState<ShellAttendance | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  // آخر نشر من البطاقة يتقدّم على جلب المزوّد القديم — طابع زمني بسيط.
  const lastPublishRef = useRef(0);

  const publish = useCallback((s: ShellAttendance | null) => {
    lastPublishRef.current = Date.now();
    setStatus(s);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let dead = false;
    const load = async () => {
      // البطاقة نشرت خلال آخر ٣٠ ثانية؟ حالتها أحدث — لا داعي للجلب.
      if (Date.now() - lastPublishRef.current < 30_000) return;
      try {
        const res = await fetch("/api/attendance/status", { cache: "no-store" });
        if (!res.ok || dead) return;
        const data = (await res.json()) as Record<string, unknown>;
        if (!dead && data.ok) setStatus(toShell(data));
      } catch {
        /* الشبكة راحت — الدورة القادمة بعد دقيقة */
      }
    };
    void load();
    const t = setInterval(() => void load(), 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      dead = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);

  const value = useMemo<ShellContext>(
    () => ({ active: enabled, status, publish, panelOpen, setPanelOpen }),
    [enabled, status, publish, panelOpen],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** الدقائق المنجزة الآن — نفس معادلة البطاقة: أساس اليوم + الجلسة الحية صافية. */
export function shellElapsedMinutes(s: ShellAttendance, nowMs: number): number {
  if (s.state !== "in" || !s.startedAtIso) return s.dayBaseMinutes;
  const started = new Date(s.startedAtIso).getTime();
  const paused =
    s.pausedMsBase +
    (s.activePauseStartedIso ? Math.max(0, nowMs - new Date(s.activePauseStartedIso).getTime()) : 0);
  return s.dayBaseMinutes + Math.max(0, Math.floor((nowMs - started - paused) / 60_000));
}
