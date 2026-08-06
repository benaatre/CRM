import Link from "next/link";
import { ChevronLeft, ShieldCheck, Bell } from "lucide-react";
import { requireUser, isManager } from "@/lib/auth-guards";
import { getNotificationConfig, eventLabel, ensureNotificationDefaults } from "@/lib/data/notifications-config";
import { ensureChannelDefaults, getChannelConfig } from "@/lib/data/push-channels";
import { eventsByCategory } from "@/lib/push/channels";
import { MobileChannelSounds } from "@/components/mobile/channel-sounds";
import { getActiveSessions } from "@/lib/session-devices";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { MobileSecurityPanel } from "@/components/mobile/security-panel";
import { MobileNotifSettings } from "@/components/mobile/notif-settings";

export const dynamic = "force-dynamic";

const card = {
  boxSizing: "border-box" as const,
  background: MOBILE_COLORS.card,
  border: `1px solid ${MOBILE_COLORS.border}`,
  borderRadius: 16,
  padding: "13px 14px",
};

/**
 * «الإعدادات» — تجمع ما كان مسطّحًا في /m/more: الإشعارات والأصوات (المدير/المالك)
 * والأمان (للجميع، والجلسات النشطة للمالك). نفس الحراس السابقة حرفيًا.
 */
export default async function MobileSettingsPage() {
  const user = await requireUser();
  const manager = isManager(user.role);
  const owner = user.role === "OWNER";

  // نغمات القنوات للمالك وحده — الزرع قبل القراءة ليضمن وجود الصفوف الثلاثة.
  if (owner) {
    await ensureNotificationDefaults();
    await ensureChannelDefaults();
  }

  const [notifCfg, sessions, channels] = await Promise.all([
    // التعديل محروس بـrequireManagerAction داخل الأكشن — الإخفاء هنا للعرض.
    manager ? getNotificationConfig() : Promise.resolve(null),
    // الجلسات النشطة — للمالك فقط (نفس لوحة الإعدادات بالديسكتوب).
    owner ? getActiveSessions() : Promise.resolve([]),
    owner ? getChannelConfig() : Promise.resolve([]),
  ]);

  const byCategory = eventsByCategory();

  return (
    <div className="m-screen flex flex-col" style={{ gap: 13 }}>
      <div className="flex items-center" style={{ gap: 11 }}>
        <Link href="/m/more" aria-label="رجوع" className="flex items-center justify-center"
          style={{ minWidth: 44, minHeight: 44, marginInlineStart: -10, color: MOBILE_COLORS.textPrimary }}>
          <ChevronLeft size={20} strokeWidth={2} style={{ transform: "scaleX(-1)" }} aria-hidden />
        </Link>
        <div>
          <h1 style={{ fontSize: 17, fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>الإعدادات</h1>
          <div style={{ fontSize: "11.5px", color: MOBILE_COLORS.textMuted, marginTop: 3 }}>
            {manager ? "الإشعارات والأصوات والأمان" : "الإشعارات والأمان"}
          </div>
        </div>
      </div>

      {/* ===== شاشة الإشعارات نفسها ===== */}
      <Link href="/m/notifications" className="m-rise flex items-center"
        style={{ ...card, gap: 10, minHeight: 52 }}>
        <span className="flex flex-none items-center justify-center"
          style={{ boxSizing: "border-box", width: 30, height: 30, borderRadius: 9, background: MOBILE_COLORS.goldBg }}>
          <Bell size={15} style={{ color: MOBILE_COLORS.gold }} aria-hidden />
        </span>
        <span style={{ fontSize: "12.5px", fontWeight: 600, color: MOBILE_COLORS.textPrimary }}>الإشعارات</span>
      </Link>

      {/* ===== الإشعارات والأصوات — المدير/المالك ===== */}
      {manager && notifCfg && (
        <div className="m-rise" style={{ ...card, borderInlineStart: `3px solid ${MOBILE_STATUS.warning.base}`, animationDelay: "60ms" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: MOBILE_COLORS.textPrimary, marginBottom: 8 }}>
            إعدادات الإشعارات والأصوات
          </div>
          <MobileNotifSettings
            events={notifCfg.events.map((e) => ({
              eventKey: e.eventKey, label: e.label, soundEnabled: e.soundEnabled, toastEnabled: e.toastEnabled,
            }))}
            globalMute={notifCfg.globalMute}
          />
        </div>
      )}

      {/* ===== نغمات التنبيهات — المالك وحده ===== */}
      {owner && notifCfg && channels.length > 0 && (
        <div className="m-rise" style={{ ...card, borderInlineStart: `3px solid ${MOBILE_COLORS.gold}`, animationDelay: "90ms" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: MOBILE_COLORS.textPrimary, marginBottom: 3 }}>
            نغمات التنبيهات على الجوال
          </div>
          <p style={{ fontSize: 10.5, color: MOBILE_COLORS.textMuted, lineHeight: 1.7, marginBottom: 9 }}>
            كل نوع تنبيه له نغمته — تسمعها حتى والجوال مقفل.
          </p>
          <MobileChannelSounds
            channels={channels.map((c) => ({
              category: c.category,
              label: c.label,
              description: c.description,
              soundId: c.soundId,
              soundUrl: c.soundUrl,
              events: (byCategory[c.category] ?? []).map(eventLabel),
            }))}
            sounds={notifCfg.sounds.map((s) => ({
              id: s.id, name: s.name, fileUrl: s.fileUrl, builtIn: s.isBuiltIn,
            }))}
          />
        </div>
      )}

      {/* ===== الأمان ===== */}
      <div className="m-rise" style={{ ...card, borderInlineStart: `3px solid ${MOBILE_STATUS.danger.base}`, animationDelay: "120ms" }}>
        <div className="flex items-center" style={{ gap: 6, fontSize: 13, fontWeight: 700, color: MOBILE_COLORS.textPrimary, marginBottom: 10 }}>
          <ShieldCheck size={15} style={{ color: MOBILE_STATUS.danger.base }} aria-hidden />
          الأمان
        </div>
        <MobileSecurityPanel
          isOwner={owner}
          sessions={sessions.map((s) => ({
            userId: s.userId, name: s.name,
            devices: s.devices.map((d) => ({ label: d.label, lastBeat: d.lastBeat.toISOString() })),
          }))}
        />
        <p style={{ fontSize: 10.5, color: MOBILE_COLORS.textMuted, marginTop: 8, lineHeight: 1.7 }}>
          تغيير رمز الدخول يتم بدعوة إيميل من المدير (شاشة الفريق بالديسكتوب).
        </p>
      </div>
    </div>
  );
}
