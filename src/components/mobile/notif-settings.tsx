"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateNotificationEvent, updateMasterAudio } from "@/lib/actions/notifications";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";

export type NotifEventRow = {
  eventKey: string;
  label: string;
  soundEnabled: boolean;
  toastEnabled: boolean;
};

/**
 * إعدادات الإشعارات — نفس أكشنات الديسكتوب (updateNotificationEvent /
 * updateMasterAudio) بحارسها الخادمي requireManagerAction. للمدير/المالك فقط
 * (الصفحة تخفيها عن الموظف كما يفعل الديسكتوب في /settings).
 */
export function MobileNotifSettings({
  events,
  globalMute,
}: {
  events: NotifEventRow[];
  globalMute: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const patch = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setErr(null);
      const r = await fn();
      if (!r.ok) setErr(r.error ?? "صار خطأ");
      else router.refresh();
    });

  const Toggle = ({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) => (
    <button type="button" disabled={pending} onClick={onClick} aria-pressed={on} aria-label={label}
      style={{
        boxSizing: "border-box", width: 44, height: 26, borderRadius: 13, border: "none",
        padding: 3, display: "flex", cursor: "pointer",
        justifyContent: on ? "flex-start" : "flex-end",
        background: on ? MOBILE_COLORS.gold : MOBILE_COLORS.border,
        opacity: pending ? 0.6 : 1,
      }}>
      <span style={{ width: 20, height: 20, borderRadius: 10, background: "#FFFFFF" }} />
    </button>
  );

  return (
    <div className="flex flex-col" style={{ gap: 8 }}>
      {err && (
        <p style={{ boxSizing: "border-box", borderRadius: 10, padding: "8px 12px", fontSize: 12, background: MOBILE_STATUS.danger.bg, color: MOBILE_STATUS.danger.fg }}>
          {err}
        </p>
      )}

      {/* كتم عام — updateMasterAudio */}
      <div className="flex items-center justify-between" style={{ minHeight: 40 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: MOBILE_COLORS.textPrimary }}>كتم كل الأصوات</span>
        <Toggle on={globalMute} label="كتم كل الأصوات"
          onClick={() => patch(() => updateMasterAudio({ globalMute: !globalMute }))} />
      </div>

      {/* الأحداث — updateNotificationEvent لكل حدث */}
      {events.map((e) => (
        <div key={e.eventKey} className="flex items-center justify-between"
          style={{ boxSizing: "border-box", gap: 8, minHeight: 44, borderTop: `1px solid ${MOBILE_COLORS.line3}` }}>
          <span className="min-w-0 flex-1 truncate" style={{ fontSize: "12.5px", color: MOBILE_COLORS.textSecondary }}>
            {e.label}
          </span>
          <div className="flex items-center" style={{ gap: 10 }}>
            <span style={{ fontSize: 10, color: MOBILE_COLORS.textMuted }}>تنبيه</span>
            <Toggle on={e.toastEnabled} label={`تنبيه ${e.label}`}
              onClick={() => patch(() => updateNotificationEvent(e.eventKey, { toastEnabled: !e.toastEnabled }))} />
            <span style={{ fontSize: 10, color: MOBILE_COLORS.textMuted }}>صوت</span>
            <Toggle on={e.soundEnabled} label={`صوت ${e.label}`}
              onClick={() => patch(() => updateNotificationEvent(e.eventKey, { soundEnabled: !e.soundEnabled }))} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default MobileNotifSettings;
