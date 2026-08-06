"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { updateChannelSound } from "@/lib/actions/notifications";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";

export type ChannelRow = {
  category: string;
  label: string;
  description: string;
  soundId: string | null;
  soundUrl: string;
  /** أسماء أحداث هذه الفئة بالعربي — للاطلاع فقط */
  events: string[];
};

export type SoundOption = { id: string; name: string; fileUrl: string; builtIn: boolean };

/**
 * نغمة كل فئة تنبيه (عاجل/عادي/معلومات) + معاينة — للمالك وحده.
 *
 * المعاينة تشغيل ويب فقط (نفس نغمات public/sounds التي يستخدمها توست الويب) —
 * غرضها سماع الفرق قبل الاختيار، لا محاكاة صوت الجهاز.
 */
export function MobileChannelSounds({
  channels,
  sounds,
}: {
  channels: ChannelRow[];
  sounds: SoundOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // النغمات المدمجة وحدها: المرفوعة ما لها ملف داخل التطبيق فما تصلح لقناة.
  const options = sounds.filter((s) => s.builtIn);

  const preview = (url: string) => {
    audioRef.current?.pause();
    const a = new Audio(url);
    audioRef.current = a;
    setPlaying(url);
    a.onended = () => setPlaying(null);
    a.play().catch(() => setPlaying(null));
  };

  const choose = (category: string, soundId: string) =>
    startTransition(async () => {
      setErr(null);
      const r = await updateChannelSound(category, soundId);
      if (!r.ok) setErr(r.error ?? "صار خطأ");
      else router.refresh();
    });

  const accent: Record<string, string> = {
    urgent: MOBILE_STATUS.danger.base,
    normal: MOBILE_COLORS.gold,
    info: MOBILE_COLORS.textMuted,
  };

  return (
    <div className="flex flex-col" style={{ gap: 12 }}>
      {err && (
        <p style={{ boxSizing: "border-box", borderRadius: 10, padding: "8px 12px", fontSize: 12, background: MOBILE_STATUS.danger.bg, color: MOBILE_STATUS.danger.fg }}>
          {err}
        </p>
      )}

      {channels.map((c) => {
        const current = options.find((s) => s.id === c.soundId) ?? options.find((s) => s.fileUrl === c.soundUrl);
        return (
          <div key={c.category} style={{
            boxSizing: "border-box", borderRadius: 12, padding: "10px 11px",
            background: MOBILE_COLORS.panel,
            borderInlineStart: `3px solid ${accent[c.category] ?? MOBILE_COLORS.gold}`,
          }}>
            <div className="flex items-center justify-between" style={{ gap: 8 }}>
              <span style={{ fontSize: "12.5px", fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>{c.label}</span>
              <button
                type="button"
                onClick={() => preview(c.soundUrl)}
                aria-label={`معاينة نغمة ${c.label}`}
                className="flex items-center justify-center"
                style={{
                  boxSizing: "border-box", minWidth: 44, minHeight: 32, borderRadius: 9,
                  border: `1px solid ${MOBILE_COLORS.border}`, background: "transparent",
                  color: playing === c.soundUrl ? MOBILE_COLORS.gold : MOBILE_COLORS.textSecondary,
                }}>
                <Play size={13} aria-hidden />
              </button>
            </div>

            <p style={{ fontSize: 10.5, color: MOBILE_COLORS.textMuted, lineHeight: 1.7, margin: "3px 0 7px" }}>
              {c.description}
            </p>

            <select
              value={current?.id ?? ""}
              disabled={pending}
              onChange={(e) => choose(c.category, e.target.value)}
              aria-label={`نغمة ${c.label}`}
              style={{
                boxSizing: "border-box", width: "100%", minHeight: 40, borderRadius: 10,
                border: `1px solid ${MOBILE_COLORS.border}`, background: MOBILE_COLORS.card,
                color: MOBILE_COLORS.textPrimary, fontSize: "12.5px", padding: "0 10px",
                opacity: pending ? 0.6 : 1,
              }}>
              {options.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>

            {/* توزيع الأحداث — للاطلاع فقط (انظر ملاحظة الشاشة) */}
            {c.events.length > 0 && (
              <div className="flex flex-wrap" style={{ gap: 4, marginTop: 7 }}>
                {c.events.map((label) => (
                  <span key={label} style={{
                    boxSizing: "border-box", fontSize: 10, borderRadius: 6, padding: "2px 6px",
                    background: MOBILE_COLORS.goldBg, color: MOBILE_COLORS.textSecondary,
                  }}>
                    {label}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <p style={{ fontSize: 10.5, color: MOBILE_COLORS.textMuted, lineHeight: 1.8 }}>
        النغمة الجديدة تشتغل على جوالات الفريق بعد ما يسكّرون التطبيق ويفتحونه من
        جديد. التوزيع فوق ثابت حاليًا — للاطلاع بس.
      </p>
    </div>
  );
}

export default MobileChannelSounds;
