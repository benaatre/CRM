"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DoorOpen, Loader2, MapPin, Route, UserRoundCheck } from "lucide-react";
import { toArabicDigits } from "@/lib/format";
import { readPositionOnce } from "@/lib/geolocation-permission";
import { geoDiag } from "@/lib/geo-diag";
import "./attendance.css";

/**
 * النداء الإجباري — نافذة تغطي الشاشة ولا تُغلق إلا برد: لا زر إغلاق، لا
 * إغلاق بالنقر خارجها، وزر رجوع الأندرويد لا يمر (popstate يُعاد دفعه).
 *
 * الموقع يُقرأ **مرة واحدة فقط عند الرد** الذي يحتاجه؛ ردود الاستئذان/الذهاب
 * بلا قراءة. المؤقت من مهلة النداء، وانتهاؤه يغلق النافذة برسالة «فات وقت
 * النداء» — والكرون يعلّم النداء MISSED من جهته.
 */

export type PendingCall = {
  id: string;
  kind: string; // RANDOM | MANUAL | ARRIVAL
  deadlineAtIso: string;
  windowSeconds: number;
  canExtend: boolean;
};

type Authorizer = { id: string; label: string };

type RespondResult = { ok: boolean; status?: string; message?: string; reason?: string };

/** مهلة المستدعي القصوى — الضمانة الأخيرة فوق مهل مكتبة الموقع (نفس نمط البطاقة). */
const CALLER_GEO_TIMEOUT_MS = 20_000;

/** خطأ مهلة المستدعي — رسالته الموسومة «(٢)» دليل ميداني أن النسخة الجديدة وصلت. */
class CallerGeoTimeoutError extends Error {}

/** قراءة موقع واحدة — نفس ضبط البطاقة حرفيًا، عبر الطبقة الموحّدة وخلف سباق ٢٠ثانية. */
function readPosition(): Promise<GeolocationPosition> {
  geoDiag("modal:readPosition:start", { timeout: 15000, race: CALLER_GEO_TIMEOUT_MS });
  let settled = false;
  const read = readPositionOnce({ enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }).then(
    (p) => {
      settled = true;
      return p;
    },
    (e: unknown) => {
      settled = true;
      throw e;
    },
  );
  return Promise.race([
    read,
    new Promise<never>((_, reject) =>
      setTimeout(() => {
        if (!settled) geoDiag("modal:race:timeout", { ms: CALLER_GEO_TIMEOUT_MS });
        reject(new CallerGeoTimeoutError("caller-geo-timeout"));
      }, CALLER_GEO_TIMEOUT_MS),
    ),
  ]);
}

/** وسم تشخيصي مختصر — code/message البلجن الفعليان (نفس نمط البطاقة). */
function geoErrTag(err: unknown): string {
  if (err instanceof CallerGeoTimeoutError) return "T20";
  const e = err as Partial<GeolocationPositionError> | undefined;
  const code = typeof e?.code === "number" ? String(e.code) : "؟";
  const msg = typeof e?.message === "string" && e.message ? e.message.slice(0, 40) : "";
  return msg ? `${code}·${msg}` : code;
}

function geoErrorMessage(err: unknown): string {
  const base =
    err instanceof CallerGeoTimeoutError
      ? "ما قدرنا نحدد موقعك — حاول ثانية أو استخدم المتصفح مؤقتًا — جرّب من جديد (٢)"
      : (() => {
          const code = (err as GeolocationPositionError | undefined)?.code;
          if (code === 1) return "لازم تسمح بالوصول للموقع عشان نأكد مكانك";
          if (code === 3) return "طوّلنا وما وصلتنا إشارة — حاول مرة ثانية بمكان مفتوح";
          return "ما قدرنا نحدد موقعك — تأكد أن خدمة الموقع مشغّلة وحاول مرة ثانية";
        })();
  return `${base} (${geoErrTag(err)})`;
}

export function VerifyModal({
  pending,
  onDone,
  onExpired,
}: {
  pending: PendingCall;
  /** انتهى الرد بنجاح أو برسالة — الأب يحدّث حالته ويغلق. */
  onDone: (message: string, tone: "success" | "warning" | "danger") => void;
  /** فات وقت النداء — الأب يغلق ويعرض «فات وقت النداء». */
  onExpired: () => void;
}) {
  const isArrival = pending.kind === "ARRIVAL";
  const [screen, setScreen] = useState<"answers" | "returning" | "authorizer">("answers");
  const [authorizers, setAuthorizers] = useState<Authorizer[] | null>(null);
  const [authorizerId, setAuthorizerId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const deadline = useMemo(() => new Date(pending.deadlineAtIso).getTime(), [pending.deadlineAtIso]);
  const remaining = Math.max(0, Math.floor((deadline - now) / 1000));

  // مؤقت الثانية + انتهاء المهلة.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (remaining <= 0) onExpired();
  }, [remaining, onExpired]);

  // زر الرجوع لا يغلق النافذة — ندفع الحالة ونبتلع popstate ما دامت مفتوحة.
  useEffect(() => {
    const block = () => window.history.pushState(null, "", window.location.href);
    block();
    window.addEventListener("popstate", block);
    return () => window.removeEventListener("popstate", block);
  }, []);

  const respond = useCallback(
    async (body: Record<string, unknown>): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/attendance/verification/respond", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as RespondResult;
        if (data.ok) {
          onDone(
            data.message ?? "تم إرسال ردك",
            data.status === "CONFIRMED" || data.status === "EN_ROUTE" ? "success" : "warning",
          );
        } else if (data.reason === "no_pending") {
          onExpired();
        } else {
          setError(data.message ?? "ما قدرنا نسجّل ردك — حاول مرة ثانية");
        }
      } catch {
        setError("تعذّر الاتصال — تأكد من الإنترنت وحاول مرة ثانية");
      }
      setBusy(false);
    },
    [onDone, onExpired],
  );

  /** تأكيد الحضور/الوصول أو الانصراف الفوري — القراءة الوحيدة للموقع. */
  const respondWithLocation = async (answer: "HERE" | "CHECKOUT") => {
    setBusy(true);
    setError(null);
    // نفس ضمانة البطاقة: أي مسار — حتى غير المتوقع — ينتهي بإرجاع الأزرار.
    try {
      let pos: GeolocationPosition;
      try {
        pos = await readPosition();
      } catch (err) {
        setError(geoErrorMessage(err));
        return;
      }
      await respond({
        answer,
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        isMock: false,
      });
    } finally {
      setBusy(false);
    }
  };

  /** فتح شاشة الجهة — تُجلب القائمة عندها فقط. */
  const openAuthorizer = async () => {
    setScreen("authorizer");
    if (authorizers !== null) return;
    try {
      const res = await fetch("/api/attendance/authorizers", { cache: "no-store" });
      const data = (await res.json()) as { ok: boolean; authorizers?: Authorizer[] };
      setAuthorizers(data.ok && data.authorizers ? data.authorizers : []);
    } catch {
      setAuthorizers([]);
    }
  };

  const pct = pending.windowSeconds > 0 ? remaining / pending.windowSeconds : 0;
  const mm = Math.floor(remaining / 60);
  const ss = remaining % 60;

  return (
    <div
      className="att-scope fixed inset-0 z-[92] flex items-center justify-center p-4"
      dir="rtl"
      role="alertdialog"
      aria-modal="true"
      aria-label="نداء تحقق"
    >
      {/* خلفية معتمة — بلا onClick عمدًا: النافذة لا تُغلق إلا برد */}
      <div className="absolute inset-0" style={{ background: "rgba(8, 5, 3, 0.88)", backdropFilter: "blur(4px)" }} />

      <div
        className="relative w-full max-w-md overflow-hidden rounded-3xl border p-5"
        style={{ borderColor: "var(--att-esp-line)", background: "var(--att-esp-bg)" }}
      >
        {/* ===== الرأس ===== */}
        <div className="flex items-start gap-3">
          <span className="relative flex size-11 flex-none items-center justify-center rounded-2xl border" style={{ borderColor: "var(--att-esp-line)", background: "var(--att-esp-card)" }}>
            <MapPin aria-hidden size={19} strokeWidth={1.5} style={{ color: "var(--att-gold)" }} />
            <span aria-hidden className="att-pulse absolute -left-0.5 -top-0.5 size-2.5 rounded-full" style={{ background: "var(--att-late)" }} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-extrabold" style={{ color: "var(--att-esp-text)" }}>
              {isArrival ? "وصلت المشروع؟" : "وين أنت الآن؟"}
            </h2>
            <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--att-esp-muted)" }}>
              موقعك يُقرأ مرة واحدة فقط عند الرد
            </p>
          </div>
          <span className="flex-none text-left">
            <span className="block text-[19px] font-extrabold tabular-nums" dir="ltr" style={{ color: remaining <= 60 ? "var(--att-miss)" : "var(--att-esp-text)" }}>
              {toArabicDigits(mm)}:{toArabicDigits(String(ss).padStart(2, "0"))}
            </span>
            <span className="block text-[9.5px]" style={{ color: "var(--att-esp-muted)" }}>
              على انتهاء المهلة
            </span>
          </span>
        </div>

        {/* شريط المهلة المنكمش */}
        <div className="mt-3.5 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--att-rail)" }}>
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.max(0, Math.min(100, pct * 100))}%`,
              background: remaining <= 60 ? "var(--att-miss)" : "var(--att-gold)",
              transition: "width 1s linear",
            }}
          />
        </div>

        {error && (
          <p className="mt-3 rounded-xl px-3 py-2.5 text-[12px]" style={{ color: "var(--att-miss)", background: "color-mix(in srgb, var(--att-miss) 12%, transparent)" }}>
            {error}
          </p>
        )}

        {/* ===== الردود الثلاثة ===== */}
        {screen === "answers" ? (
          <div className="mt-4 space-y-2">
            <AnswerButton
              primary
              icon={<UserRoundCheck aria-hidden size={17} strokeWidth={1.5} />}
              label={isArrival ? "وصلت — أكّد موقعي" : "تأكيد الحضور — أنا بموقع العمل"}
              busy={busy}
              onClick={() => void respondWithLocation("HERE")}
            />
            {isArrival ? (
              pending.canExtend && (
                <AnswerButton
                  icon={<Route aria-hidden size={17} strokeWidth={1.5} />}
                  label="لسه بالطريق"
                  busy={busy}
                  onClick={() => void respond({ answer: "STILL_EN_ROUTE" })}
                />
              )
            ) : (
              <>
                <AnswerButton
                  icon={<Route aria-hidden size={17} strokeWidth={1.5} />}
                  label="ذاهب إلى مشروع"
                  busy={busy}
                  onClick={() => void respond({ answer: "EN_ROUTE" })}
                />
                <AnswerButton
                  icon={<DoorOpen aria-hidden size={17} strokeWidth={1.5} />}
                  label="استأذنت للخروج"
                  busy={busy}
                  onClick={() => setScreen("returning")}
                />
              </>
            )}
          </div>
        ) : screen === "returning" ? (
          /* ===== خطوة «راجع اليوم؟» — فرعا الاستئذان ===== */
          <div className="mt-4 space-y-3">
            <h3 className="text-[14.5px] font-extrabold" style={{ color: "var(--att-esp-text)" }}>
              راجع اليوم؟
            </h3>
            <AnswerButton
              primary
              icon={<DoorOpen aria-hidden size={17} strokeWidth={1.5} />}
              label="راجع — أوقفوا عدّادي مؤقتًا"
              busy={busy}
              onClick={() => void openAuthorizer()}
            />
            <AnswerButton
              icon={<UserRoundCheck aria-hidden size={17} strokeWidth={1.5} />}
              label="خلاص انتهى دوامي لظرف — سجّلوا انصرافي"
              busy={busy}
              onClick={() => void respondWithLocation("CHECKOUT")}
            />
            <p className="text-[10.5px] leading-relaxed" style={{ color: "var(--att-esp-muted)" }}>
              «انتهى دوامي» يقفل جلستك الآن ويحسب ساعاتك — بلا جهة إذن ولا سبب.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => setScreen("answers")}
              className="w-full py-1 text-center text-[12px] font-medium"
              style={{ color: "var(--att-esp-muted)" }}
            >
              رجوع للردود
            </button>
          </div>
        ) : (
          /* ===== شاشة «مين أذن لك بالخروج؟» ===== */
          <div className="mt-4 space-y-3">
            <h3 className="text-[14.5px] font-extrabold" style={{ color: "var(--att-esp-text)" }}>
              مين أذن لك بالخروج؟
            </h3>

            {authorizers === null ? (
              <p className="flex items-center gap-2 py-3 text-[12px]" style={{ color: "var(--att-esp-muted)" }}>
                <Loader2 aria-hidden size={14} className="animate-spin" strokeWidth={1.5} />
                جاري تحميل الجهات…
              </p>
            ) : authorizers.length === 0 ? (
              <p className="py-3 text-[12px]" style={{ color: "var(--att-esp-muted)" }}>
                ما فيه جهات معرّفة — كلّم الإدارة
              </p>
            ) : (
              <div className="space-y-1.5">
                {authorizers.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setAuthorizerId(a.id)}
                    className="flex w-full items-center justify-between rounded-xl border px-3.5 py-3 text-right text-[13px] font-bold"
                    style={{
                      borderColor: authorizerId === a.id ? "var(--att-gold)" : "var(--att-esp-line)",
                      background: authorizerId === a.id ? "color-mix(in srgb, var(--att-gold) 10%, transparent)" : "var(--att-esp-card)",
                      color: "var(--att-esp-text)",
                    }}
                  >
                    {a.label}
                    <span
                      aria-hidden
                      className="size-4 rounded-full border"
                      style={{
                        borderColor: authorizerId === a.id ? "var(--att-gold)" : "var(--att-esp-line)",
                        background: authorizerId === a.id ? "var(--att-gold)" : "transparent",
                      }}
                    />
                  </button>
                ))}
              </div>
            )}

            <label className="block">
              <span className="mb-1 block text-[11px]" style={{ color: "var(--att-esp-muted)" }}>
                سبب الخروج — اختياري
              </span>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="h-10 w-full rounded-xl border px-3 text-[13px] outline-none"
                style={{ borderColor: "var(--att-esp-line)", background: "var(--att-esp-card)", color: "var(--att-esp-text)" }}
              />
            </label>

            <button
              type="button"
              disabled={busy || !authorizerId}
              onClick={() => void respond({ answer: "PAUSE", pauseKind: "EXCUSED", authorizerId, reason })}
              className="flex min-h-12 w-full items-center justify-center rounded-[13px] border-0 text-[14.5px] font-extrabold disabled:opacity-50"
              style={{ background: "var(--att-gold)", color: "var(--att-on-gold)", cursor: busy ? "default" : "pointer" }}
            >
              {busy ? "جاري الإرسال…" : "إرسال وإيقاف العدّاد"}
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => setScreen("returning")}
              className="w-full py-1 text-center text-[12px] font-medium"
              style={{ color: "var(--att-esp-muted)" }}
            >
              رجوع
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function AnswerButton({
  icon,
  label,
  busy,
  onClick,
  primary = false,
}: {
  icon: React.ReactNode;
  label: string;
  busy: boolean;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="flex min-h-12 w-full items-center gap-2.5 rounded-[13px] px-4 text-right text-[14px] font-bold disabled:opacity-60"
      style={
        primary
          ? { border: "none", background: "var(--att-gold)", color: "var(--att-on-gold)", cursor: busy ? "default" : "pointer" }
          : {
              border: "1px solid var(--att-esp-line)",
              background: "var(--att-esp-card)",
              color: "var(--att-esp-text)",
              cursor: busy ? "default" : "pointer",
            }
      }
    >
      {icon}
      {label}
    </button>
  );
}

export default VerifyModal;
