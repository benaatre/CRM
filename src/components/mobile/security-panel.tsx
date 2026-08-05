"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signOutAllDevicesMobileAction, signOutUserDevices } from "@/lib/actions/auth";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";

export type SessionRow = { userId: string; name: string; devices: { label: string; lastBeat: string }[] };

/**
 * قسم الأمان — نفس أكشنات الديسكتوب بمنطقها الواحد:
 * «الخروج من كل الأجهزة» signOutAllDevicesMobileAction (نفس sessionsValidFrom،
 * والفرق الوحيد أن وجهة ما بعد الخروج /m/login لا /login)،
 * وقائمة الجلسات النشطة + إخراج مستخدم signOutUserDevices (المالك — الحارس داخل الأكشن).
 */
export function MobileSecurityPanel({
  sessions,
  isOwner,
}: {
  /** الجلسات النشطة (٣٠ دقيقة) — تُجلب للمالك فقط في الصفحة. */
  sessions: SessionRow[];
  isOwner: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const kickUser = (userId: string, name: string) =>
    startTransition(async () => {
      if (!confirm(`إخراج ${name} من كل أجهزته؟`)) return;
      const r = await signOutUserDevices(userId);
      setMsg(r.ok ? `أُخرج ${name} من أجهزته` : (r.error ?? "صار خطأ"));
      if (r.ok) router.refresh();
    });

  return (
    <div className="flex flex-col" style={{ gap: 10 }}>
      {msg && (
        <p style={{ boxSizing: "border-box", borderRadius: 10, padding: "8px 12px", fontSize: 12, background: MOBILE_COLORS.goldBg, color: MOBILE_COLORS.gold }}>
          {msg}
        </p>
      )}

      {/* جلساتي: خروج من كل الأجهزة — يُبطل كل التوكنات (sessionsValidFrom) */}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            if (!confirm("تسجيل الخروج من كل الأجهزة؟ ستحتاج تسجيل الدخول من جديد على كل جهاز.")) return;
            await signOutAllDevicesMobileAction(); // يعيد التوجيه بنفسه — إلى /m/login
          })
        }
        className="flex w-full items-center justify-center"
        style={{
          boxSizing: "border-box", minHeight: 48, borderRadius: 12,
          border: `1px solid ${MOBILE_STATUS.warning.border}`, background: MOBILE_STATUS.warning.bg,
          color: MOBILE_STATUS.warning.fg, fontSize: 13, fontWeight: 700, opacity: pending ? 0.6 : 1,
        }}
      >
        الخروج من كل الأجهزة
      </button>

      {/* الجلسات النشطة — المالك فقط (نفس لوحة الإعدادات بالديسكتوب) */}
      {isOwner && sessions.length > 0 && (
        <div
          style={{
            boxSizing: "border-box", background: MOBILE_COLORS.bg,
            border: `1px solid ${MOBILE_COLORS.border}`, borderRadius: 14, padding: "11px 13px",
          }}
        >
          <div style={{ fontSize: "12.5px", fontWeight: 700, color: MOBILE_COLORS.textPrimary, marginBottom: 4 }}>
            الجلسات النشطة (آخر ٣٠ دقيقة)
          </div>
          {sessions.map((s, i) => (
            <div key={s.userId} className="flex items-center justify-between"
              style={{ boxSizing: "border-box", gap: 8, minHeight: 44, borderTop: i === 0 ? "none" : `1px solid ${MOBILE_COLORS.line3}` }}>
              <span className="min-w-0 flex-1">
                <span className="block truncate" style={{ fontSize: 13, color: MOBILE_COLORS.textPrimary }}>
                  {s.name}
                  <span style={{ color: MOBILE_COLORS.textMuted }}> · {toArabicDigits(s.devices.length)} جهاز</span>
                </span>
                <span className="block truncate" style={{ fontSize: 10.5, color: MOBILE_COLORS.textMuted, marginTop: 2 }}>
                  {s.devices.map((d) => d.label).join(" · ")}
                </span>
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => kickUser(s.userId, s.name)}
                className="flex-none"
                style={{
                  boxSizing: "border-box", minHeight: 36, padding: "0 10px", borderRadius: 9,
                  border: `1px solid ${MOBILE_STATUS.danger.border}`, background: MOBILE_STATUS.danger.bg,
                  color: MOBILE_STATUS.danger.fg, fontSize: 11, fontWeight: 600,
                }}
              >
                أخرجه
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default MobileSecurityPanel;
