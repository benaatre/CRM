"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  PAUSE_REASONS, PAUSE_DURATIONS,
  type PauseReasonCode, type PauseDurationCode,
} from "@/lib/availability";
import { pauseAvailability, resumeAvailability } from "@/lib/actions/availability";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { BottomSheet } from "@/components/mobile/bottom-sheet";

/**
 * بطاقة الملف الشخصي أعلى «المزيد» — أفاتار ذهبي + الاسم + (الدور · حالة الاستلام)
 * ومفتاح تبديل يربط بحالة الإيقاف المؤقت الموجودة أصلًا.
 *
 * صفر أكشن جديد: التشغيل `resumeAvailability()` والإيقاف `pauseAvailability()`
 * — نفس أكشنَي الديسكتوب (SelfAvailabilityToggle) بحارسهما الخادمي. الإيقاف
 * يتطلّب سببًا ومدّة على الخادم، فالمفتاح يفتح ورقة الاختيار قبل التنفيذ.
 *
 * ⚠️ نص حالة الإيقاف يصل **جاهزًا من الخادم** (`pauseText`). كان يُحسب هنا بـ
 * `formatPauseRemaining` وهي تقرأ `Date.now()` — فيختلف نص الخادم عن العميل عند
 * عبور حدّ الدقيقة بين التصيير والترطيب، وهذا اختلاف ترطيب حقيقي.
 */
export function MobileProfileCard({
  name,
  roleText,
  paused,
  pauseText,
  canPause,
}: {
  name: string;
  roleText: string;
  paused: boolean;
  /**
   * المفتاح للموظف وحده: المالك/الإدارة خارج التوزيع التلقائي أصلًا
   * (loadEmployees تقصره على role=EMPLOYEE)، فـ«متاح لاستلام» بلا معنى عندهم.
   * يُخفى تمامًا لا يُعطَّل.
   */
  canPause: boolean;
  /** «موقوف مؤقتًا — إجازة · يرجع بعد ساعتين» — يُصاغ على الخادم لا هنا. */
  pauseText: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sheet, setSheet] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState<{ reason: PauseReasonCode; duration: PauseDurationCode }>({
    reason: "BUSY",
    duration: "manual",
  });

  const firstLetter = (name.trim().split(/\s+/)[0] || "؟").slice(0, 1);
  const statusText = !canPause ? null : paused ? (pauseText ?? "موقوف مؤقتًا") : "متاح لاستلام";

  const resume = () =>
    startTransition(async () => {
      setErr(null);
      const r = await resumeAvailability();
      if (r.ok) router.refresh();
      else setErr(r.error ?? "صار خطأ");
    });

  const pause = () =>
    startTransition(async () => {
      setErr(null);
      const r = await pauseAvailability(pick);
      if (r.ok) { setSheet(false); router.refresh(); }
      else setErr(r.error ?? "صار خطأ");
    });

  return (
    <>
      <div
        className="m-rise flex items-center"
        style={{
          boxSizing: "border-box", gap: 12,
          background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
          borderRadius: 16, padding: "13px 14px",
        }}
      >
        <div
          className="flex flex-none items-center justify-center"
          style={{
            boxSizing: "border-box", width: 48, height: 48, borderRadius: 14,
            background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg, fontSize: 18, fontWeight: 700,
          }}
          aria-hidden
        >
          {firstLetter}
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate" style={{ fontSize: "15.5px", fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>
            {name}
          </div>
          <div className="truncate" style={{ fontSize: "11.5px", color: paused ? MOBILE_STATUS.warning.fg : MOBILE_COLORS.textMuted, marginTop: 4 }}>
            {roleText}{statusText ? ` · ${statusText}` : ""}
          </div>
        </div>

        {canPause && (
        <button
          type="button"
          disabled={pending}
          onClick={() => (paused ? resume() : setSheet(true))}
          aria-pressed={!paused}
          aria-label={paused ? "الرجوع للاستقبال" : "إيقاف الاستقبال مؤقتًا"}
          className="flex-none"
          style={{
            boxSizing: "border-box", width: 52, height: 31, borderRadius: 16, border: "none",
            padding: 3, display: "flex", cursor: "pointer",
            justifyContent: paused ? "flex-end" : "flex-start",
            background: paused ? MOBILE_COLORS.border : MOBILE_COLORS.gold,
            opacity: pending ? 0.6 : 1,
          }}
        >
          <span style={{ width: 25, height: 25, borderRadius: 13, background: "#FFFFFF" }} />
        </button>
        )}
      </div>

      {err && (
        <p
          style={{
            boxSizing: "border-box", borderRadius: 10, padding: "9px 12px", fontSize: "12.5px",
            background: MOBILE_STATUS.danger.bg, color: MOBILE_STATUS.danger.fg,
            border: `1px solid ${MOBILE_STATUS.danger.border}`,
          }}
        >
          {err}
        </p>
      )}

      {/* ورقة الإيقاف — السبب والمدّة مطلوبان في الأكشن الخادمي نفسه. */}
      <BottomSheet
        open={sheet}
        onClose={() => setSheet(false)}
        title="إيقاف استقبال العملاء"
        subtitle="ما توصلك عملاء جدد من التوزيع التلقائي لين ترجع"
        footer={
          <button
            type="button"
            disabled={pending}
            onClick={pause}
            className="m-press m-sweep w-full"
            style={{
              boxSizing: "border-box", height: 48, borderRadius: 12, border: "none",
              background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg,
              fontSize: 14, fontWeight: 700, opacity: pending ? 0.6 : 1,
            }}
          >
            {pending ? "جارٍ…" : "أوقف الاستقبال"}
          </button>
        }
      >
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: "12.5px", color: MOBILE_COLORS.textSecondary, marginBottom: 8 }}>السبب</div>
          <div className="grid grid-cols-2" style={{ gap: 8 }}>
            {PAUSE_REASONS.map((r) => {
              const on = pick.reason === r.code;
              return (
                <button
                  key={r.code}
                  type="button"
                  onClick={() => setPick({ ...pick, reason: r.code })}
                  style={{
                    boxSizing: "border-box", minHeight: 44, borderRadius: 10, fontSize: "12.5px", fontWeight: 600,
                    ...(on
                      ? { background: MOBILE_COLORS.goldBg, color: MOBILE_COLORS.gold, border: `1px solid ${MOBILE_COLORS.goldBorder}` }
                      : { background: MOBILE_COLORS.bg, color: MOBILE_COLORS.textSecondary, border: `1px solid ${MOBILE_COLORS.border}` }),
                  }}
                >
                  {r.label}
                </button>
              );
            })}
          </div>

          <div style={{ fontSize: "12.5px", color: MOBILE_COLORS.textSecondary, margin: "16px 0 8px" }}>المدّة</div>
          <div className="grid grid-cols-2" style={{ gap: 8 }}>
            {PAUSE_DURATIONS.map((d) => {
              const on = pick.duration === d.code;
              return (
                <button
                  key={d.code}
                  type="button"
                  onClick={() => setPick({ ...pick, duration: d.code })}
                  style={{
                    boxSizing: "border-box", minHeight: 44, borderRadius: 10, fontSize: "12.5px", fontWeight: 600,
                    ...(on
                      ? { background: MOBILE_COLORS.goldBg, color: MOBILE_COLORS.gold, border: `1px solid ${MOBILE_COLORS.goldBorder}` }
                      : { background: MOBILE_COLORS.bg, color: MOBILE_COLORS.textSecondary, border: `1px solid ${MOBILE_COLORS.border}` }),
                  }}
                >
                  {d.label}
                </button>
              );
            })}
          </div>

        </div>
      </BottomSheet>
    </>
  );
}

export default MobileProfileCard;
