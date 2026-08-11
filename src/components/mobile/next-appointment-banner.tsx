"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { DayAppointment } from "@/lib/mobile-agenda";
import { MOBILE_COLORS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";
import { markCall } from "@/lib/mobile-call-tracker";

/**
 * البانر المثبّت «موعدك القادم» — أول موعد وقته داخل النافذة [الآن−١٠د، الآن+٣٠د].
 * client بمؤقّت واحد كل ٣٠ ثانية (مع cleanup) — الحالات تتحدث بلا تحديث صفحة:
 * «قادم» ذهبي، «فات» (≤١٠ دقائق) أحمر، وبعدها يختفي/ينتقل للتالي تلقائيًا.
 */

const MIN = 60_000;
const ZAIN = { fontFamily: "var(--font-zain), var(--font-sans)" };

function fmtClock(d: Date): string {
  return new Intl.DateTimeFormat("ar-SA-u-nu-arab", { hour: "numeric", minute: "2-digit" }).format(d);
}

/** «٥ دقائق» / «دقيقة» / «٢٥ دقيقة» — نافذة البانر ≤ ٣٠ دقيقة فالدقائق تكفي. */
function minsLabel(ms: number): string {
  const m = Math.max(1, Math.round(ms / MIN));
  if (m === 1) return "دقيقة";
  if (m === 2) return "دقيقتين";
  return `${toArabicDigits(m)} ${m <= 10 ? "دقائق" : "دقيقة"}`;
}

export function NextAppointmentBanner({ appointments }: { appointments: DayAppointment[] }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // أول موعد داخل النافذة — الفائت بأكثر من ١٠ دقائق خرج، والأبعد من ٣٠ دقيقة لم يدخل بعد.
  const hit = appointments.find((a) => {
    const d = a.at.getTime() - nowMs;
    return d >= -10 * MIN && d <= 30 * MIN;
  });
  if (!hit) return null;

  const diff = hit.at.getTime() - nowMs;
  const passed = diff < 0;
  const accent = passed ? MOBILE_COLORS.rose : MOBILE_COLORS.gold;
  const accentBg = passed ? MOBILE_COLORS.roseBg : MOBILE_COLORS.goldBg;

  return (
    <div
      className="m-rise m-sweep relative overflow-hidden"
      style={{
        boxSizing: "border-box",
        background: `linear-gradient(160deg, ${accentBg} 0%, ${MOBILE_COLORS.card} 70%)`,
        border: `1px solid ${accent}`,
        borderRadius: 22,
        padding: "15px 16px",
        boxShadow: `0 14px 34px rgba(0, 0, 0, 0.35)`,
      }}
    >
      {/* خط علوي متوهّج بلون الحالة */}
      <span
        aria-hidden
        style={{ position: "absolute", top: 0, insetInline: 0, height: 2, background: accent, boxShadow: `0 0 14px ${accent}` }}
      />

      <div className="flex items-center" style={{ gap: 7 }}>
        <span className="m-pulse" style={{ width: 8, height: 8, borderRadius: 5, background: accent }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: accent }}>
          {passed ? "موعد فات — اتصل الحين" : "موعدك القادم"}
        </span>
      </div>

      <div className="flex items-center justify-between" style={{ gap: 10, marginTop: 9 }}>
        <div className="min-w-0">
          <div className="truncate" style={{ fontSize: 16, fontWeight: 800, color: MOBILE_COLORS.textPrimary }}>
            {hit.name} — <span style={{ fontWeight: 600, color: MOBILE_COLORS.textSecondary }}>{hit.reason}</span>
          </div>
          <div style={{ fontSize: "12.5px", color: passed ? MOBILE_COLORS.rose : MOBILE_COLORS.textSecondary, marginTop: 6 }}>
            {passed ? `⚠️ فات من ${minsLabel(-diff)}` : `⏳ باقي ${minsLabel(diff)} — عندك وقت تجهّز`}
          </div>
        </div>
        <div className="flex-none text-left">
          <div style={{ ...ZAIN, fontSize: 27, fontWeight: 800, lineHeight: 1, color: accent }}>
            {fmtClock(hit.at)}
          </div>
          <div style={{ fontSize: "10.5px", color: MOBILE_COLORS.textMuted, marginTop: 4 }}>اليوم</div>
        </div>
      </div>

      <div className="flex" style={{ gap: 8, marginTop: 12 }}>
        <a
          href={`tel:${hit.phone}`}
          onClick={() => markCall(hit.leadId)}
          className="m-ctapulse m-press flex flex-1 items-center justify-center"
          style={{
            boxSizing: "border-box", height: 46, borderRadius: 13, border: "none",
            background: accent, color: MOBILE_COLORS.bg, fontSize: 14, fontWeight: 700, gap: 6,
          }}
        >
          📞 {passed ? "اتصل الحين" : "اتصل الآن"}
        </a>
        <Link
          href={`/m/leads/${hit.leadId}`}
          className="m-press flex flex-none items-center justify-center"
          style={{
            boxSizing: "border-box", height: 46, padding: "0 16px", borderRadius: 13,
            background: MOBILE_COLORS.sheet, border: `1px solid ${MOBILE_COLORS.border}`,
            color: MOBILE_COLORS.textPrimary, fontSize: 13, fontWeight: 600,
          }}
        >
          ← الملف
        </Link>
      </div>
    </div>
  );
}

export default NextAppointmentBanner;
