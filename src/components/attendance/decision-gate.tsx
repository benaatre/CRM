"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Clock3, DoorOpen, Laptop, Route } from "lucide-react";
import { MobilePortal } from "@/components/mobile/portal";
import { toArabicDigits } from "@/lib/format";
import "./attendance.css";

/**
 * شاشة الحسم الإجبارية (الدوام الواقعي — قرار ٤) — تُركّب في قشرتَي الويب
 * والتطبيق معًا بجوار النبضة، فتغطي كل المسارات.
 *
 * قواعد المالك الملزمة:
 * - OWNER مستثنى دائمًا (الخادم يحسم — GET يرجع due:false له).
 * - **fail-open**: أي خطأ شبكة/خادم = الشاشة تختفي ولا تحجب أحدًا بالغلط.
 * - حاجبة بنمط VerifyModal: بلا إغلاق إلا بإجابة + ابتلاع زر الرجوع.
 *
 * «عن بُعد» يمر بمسار v2 القائم حرفيًا (جهة الإذن عبر /api/attendance/day/mode)
 * ثم يسجَّل القرار — لا منطق موازٍ.
 */

type GateState = { due: boolean; windowEndText?: string };
type Authorizer = { id: string; label: string };

const ETAS = [10, 15, 30, 60] as const;

export function DecisionGate() {
  const [state, setState] = useState<GateState>({ due: false });
  const [screen, setScreen] = useState<"main" | "eta" | "remote">("main");
  const [authorizers, setAuthorizers] = useState<Authorizer[] | null>(null);
  const [authorizerId, setAuthorizerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/attendance/decision", { cache: "no-store" });
      const data = (await res.json()) as { ok: boolean; due?: boolean; windowEndText?: string };
      setState(data.ok && data.due ? { due: true, windowEndText: data.windowEndText } : { due: false });
    } catch {
      // fail-open — قرار المالك.
      setState({ due: false });
    }
  }, []);

  useEffect(() => {
    void check();
    const t = setInterval(() => void check(), 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [check]);

  // ابتلاع زر الرجوع ما دامت ظاهرة — نفس نمط النداء الإجباري.
  useEffect(() => {
    if (!state.due) return;
    const block = () => window.history.pushState(null, "", window.location.href);
    block();
    window.addEventListener("popstate", block);
    return () => window.removeEventListener("popstate", block);
  }, [state.due]);

  const answer = useCallback(
    async (kind: "ON_WAY" | "LEAVE" | "EXCUSED", etaMinutes?: number) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/attendance/decision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, etaMinutes }),
        });
        const data = (await res.json()) as { ok: boolean; error?: string };
        if (data.ok) {
          setState({ due: false });
          setScreen("main");
        } else {
          setError(data.error ?? "ما نفذت — حاول مرة ثانية");
        }
      } catch {
        setError("تعذّر الاتصال — تأكد من الإنترنت");
      }
      setBusy(false);
    },
    [],
  );

  const answerRemote = useCallback(async () => {
    if (!authorizerId) {
      setError("اختر جهة الإذن");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // مسار v2 القائم أولًا — هو صاحب توسيم اليوم REMOTE وقياس النشاط.
      const res = await fetch("/api/attendance/day/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "REMOTE", authorizerId }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; message?: string };
      if (!data.ok) {
        setError(data.error ?? data.message ?? "ما نفذت — حاول مرة ثانية");
        setBusy(false);
        return;
      }
      await fetch("/api/attendance/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "REMOTE" }),
      }).catch(() => {});
      setState({ due: false });
      setScreen("main");
    } catch {
      setError("تعذّر الاتصال — تأكد من الإنترنت");
    }
    setBusy(false);
  }, [authorizerId]);

  const openRemote = useCallback(async () => {
    setScreen("remote");
    setError(null);
    if (authorizers !== null) return;
    try {
      const res = await fetch("/api/attendance/authorizers", { cache: "no-store" });
      const data = (await res.json()) as { ok: boolean; authorizers?: Authorizer[] };
      setAuthorizers(data.ok && data.authorizers ? data.authorizers : []);
    } catch {
      setAuthorizers([]);
    }
  }, [authorizers]);

  if (!state.due) return null;

  const rowCls = "att-scope flex w-full items-center gap-3 rounded-[14px] border p-3.5 text-right";
  const rowStyle = { borderColor: "var(--att-esp-line)", background: "var(--att-esp-card)" } as const;

  return (
    <MobilePortal>
      <div
        dir="rtl"
        role="alertdialog"
        aria-modal="true"
        aria-label="حسم يومك"
        className="att-scope fixed inset-0 z-[93] flex items-center justify-center p-4"
      >
        {/* خلفية بلا onClick عمدًا — الشاشة لا تُرفع إلا بإجابة */}
        <div className="absolute inset-0" style={{ background: "rgba(8, 5, 3, 0.9)", backdropFilter: "blur(6px)" }} />

        <div
          className="relative w-full max-w-md overflow-hidden rounded-3xl border p-5"
          style={{ borderColor: "var(--att-esp-line)", background: "var(--att-esp-bg)" }}
        >
          <div className="flex items-start gap-3">
            <span className="relative flex size-11 flex-none items-center justify-center rounded-2xl border" style={{ borderColor: "var(--att-esp-line)", background: "var(--att-esp-card)" }}>
              <Clock3 aria-hidden size={19} strokeWidth={1.5} style={{ color: "var(--att-gold)" }} />
              <span aria-hidden className="att-pulse absolute -left-0.5 -top-0.5 size-2.5 rounded-full" style={{ background: "var(--att-late)" }} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[17px] font-extrabold" style={{ color: "var(--att-esp-text)" }}>
                فاتت نافذة بدايتك — وش وضعك اليوم؟
              </h2>
              <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--att-esp-muted)" }}>
                {state.windowEndText ? `نافذتك انتهت ${state.windowEndText}` : "ما بصمت وما أعلنت شيئًا"} — اختر إجابة
                للمتابعة، وما تقدر تكمل قبلها
              </p>
            </div>
          </div>

          {error && (
            <p className="mt-3 rounded-xl px-3 py-2.5 text-[12px]" style={{ color: "var(--att-miss)", background: "color-mix(in srgb, var(--att-miss) 12%, transparent)" }}>
              {error}
            </p>
          )}

          {screen === "main" && (
            <div className="mt-4 space-y-2">
              <button type="button" disabled={busy} onClick={() => setScreen("eta")} className={rowCls} style={rowStyle}>
                <span className="flex size-9 flex-none items-center justify-center rounded-xl" style={{ background: "color-mix(in srgb, var(--att-teal) 14%, transparent)", color: "var(--att-teal)" }}>
                  <Route aria-hidden size={17} strokeWidth={1.8} />
                </span>
                <span className="flex-1">
                  <span className="block text-[13.5px] font-bold" style={{ color: "var(--att-esp-text)" }}>أنا بالطريق</span>
                  <span className="block text-[10.5px]" style={{ color: "var(--att-esp-muted)" }}>حدد متى توصل — وأول ما تدخل الموقع نبصم لك تلقائيًا</span>
                </span>
              </button>
              <button type="button" disabled={busy} onClick={() => void answer("LEAVE")} className={rowCls} style={rowStyle}>
                <span className="flex size-9 flex-none items-center justify-center rounded-xl" style={{ background: "color-mix(in srgb, var(--att-leave) 14%, transparent)", color: "var(--att-leave)" }}>
                  <CalendarDays aria-hidden size={17} strokeWidth={1.8} />
                </span>
                <span className="flex-1">
                  <span className="block text-[13.5px] font-bold" style={{ color: "var(--att-esp-text)" }}>إجازة اليوم</span>
                  <span className="block text-[10.5px]" style={{ color: "var(--att-esp-muted)" }}>يومك يوسم إجازة — والنظام يفتح لك عادي</span>
                </span>
              </button>
              <button type="button" disabled={busy} onClick={() => void answer("EXCUSED")} className={rowCls} style={rowStyle}>
                <span className="flex size-9 flex-none items-center justify-center rounded-xl" style={{ background: "color-mix(in srgb, var(--att-pause) 14%, transparent)", color: "var(--att-pause)" }}>
                  <DoorOpen aria-hidden size={17} strokeWidth={1.8} />
                </span>
                <span className="flex-1">
                  <span className="block text-[13.5px] font-bold" style={{ color: "var(--att-esp-text)" }}>مستأذن — ما أداوم اليوم</span>
                  <span className="block text-[10.5px]" style={{ color: "var(--att-esp-muted)" }}>بلّغنا الإدارة — واستخدم النظام عادي</span>
                </span>
              </button>
              <button type="button" disabled={busy} onClick={() => void openRemote()} className={rowCls} style={rowStyle}>
                <span className="flex size-9 flex-none items-center justify-center rounded-xl" style={{ background: "color-mix(in srgb, var(--att-remote) 14%, transparent)", color: "var(--att-remote)" }}>
                  <Laptop aria-hidden size={17} strokeWidth={1.8} />
                </span>
                <span className="flex-1">
                  <span className="block text-[13.5px] font-bold" style={{ color: "var(--att-esp-text)" }}>أداوم عن بُعد</span>
                  <span className="block text-[10.5px]" style={{ color: "var(--att-esp-muted)" }}>بجهة إذن — يقاس يومك بالنشاط لا بالموقع</span>
                </span>
              </button>
              <p className="pt-1 text-center text-[10px]" style={{ color: "var(--att-esp-muted)" }}>
                لا يمكن إغلاق هذي الشاشة إلا بإجابة — وكل إجابة تُبلَّغ للإدارة فورًا
              </p>
            </div>
          )}

          {screen === "eta" && (
            <div className="mt-4 space-y-3">
              <h3 className="text-[14.5px] font-extrabold" style={{ color: "var(--att-esp-text)" }}>توصل خلال كم؟</h3>
              <div className="grid grid-cols-2 gap-2">
                {ETAS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    disabled={busy}
                    onClick={() => void answer("ON_WAY", m)}
                    className="min-h-11 rounded-xl border text-[13px] font-bold"
                    style={{ borderColor: "var(--att-esp-line)", background: "var(--att-esp-card)", color: "var(--att-esp-text)" }}
                  >
                    {m === 60 ? "ساعة" : `${toArabicDigits(m)} دقيقة`}
                  </button>
                ))}
              </div>
              <button type="button" disabled={busy} onClick={() => setScreen("main")} className="w-full py-1 text-center text-[12px] font-medium" style={{ color: "var(--att-esp-muted)" }}>
                رجوع للخيارات
              </button>
            </div>
          )}

          {screen === "remote" && (
            <div className="mt-4 space-y-3">
              <h3 className="text-[14.5px] font-extrabold" style={{ color: "var(--att-esp-text)" }}>مين أذن لك بالعمل عن بُعد؟</h3>
              {authorizers === null ? (
                <p className="py-2 text-[12px]" style={{ color: "var(--att-esp-muted)" }}>جاري تحميل الجهات…</p>
              ) : authorizers.length === 0 ? (
                <p className="py-2 text-[12px]" style={{ color: "var(--att-esp-muted)" }}>ما فيه جهات معرّفة — كلّم الإدارة</p>
              ) : (
                <div className="space-y-1.5">
                  {authorizers.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      disabled={busy}
                      onClick={() => setAuthorizerId(a.id)}
                      className="flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-right text-[13px] font-bold"
                      style={{
                        borderColor: authorizerId === a.id ? "var(--att-gold)" : "var(--att-esp-line)",
                        background: authorizerId === a.id ? "color-mix(in srgb, var(--att-gold) 10%, transparent)" : "var(--att-esp-card)",
                        color: "var(--att-esp-text)",
                      }}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                disabled={busy || !authorizerId}
                onClick={() => void answerRemote()}
                className="min-h-11 w-full rounded-xl border-0 text-[13.5px] font-extrabold disabled:opacity-50"
                style={{ background: "var(--att-gold)", color: "var(--att-on-gold)" }}
              >
                {busy ? "لحظة…" : "تأكيد — أداوم عن بُعد"}
              </button>
              <button type="button" disabled={busy} onClick={() => setScreen("main")} className="w-full py-1 text-center text-[12px] font-medium" style={{ color: "var(--att-esp-muted)" }}>
                رجوع للخيارات
              </button>
            </div>
          )}
        </div>
      </div>
    </MobilePortal>
  );
}

export default DecisionGate;
