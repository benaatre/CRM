import "server-only";

import { prisma } from "@/lib/prisma";

// مفاتيح الأحداث السبعة + أسماؤها (سعودي) + الجمهور الافتراضي.
export const NOTIFICATION_EVENTS = [
  { key: "new_lead_from_sheet", label: "عميل جديد من جوجل شيت", audience: "MANAGERS" },
  { key: "lead_assigned", label: "توزّع عليك عميل", audience: "ASSIGNED" },
  { key: "lead_reassigned", label: "إعادة توزيع عميل", audience: "MANAGERS_AND_ASSIGNED" },
  { key: "employee_idle", label: "موظف ركد / ما رد", audience: "MANAGERS" },
  { key: "followup_due", label: "قرب موعد متابعة", audience: "ASSIGNED" },
  { key: "employee_paused", label: "موظف وقف نفسه", audience: "MANAGERS" },
  { key: "unit_booked_sold", label: "تم حجز / بيع وحدة", audience: "ALL" },
  { key: "no_response.warn", label: "إنذار سحب عميل", audience: "ASSIGNED" },
] as const;

export type AudienceCode = "OWNER" | "MANAGERS" | "ASSIGNED" | "MANAGERS_AND_ASSIGNED" | "ALL";

export const AUDIENCE_OPTIONS: { code: AudienceCode; label: string }[] = [
  { code: "OWNER", label: "المالك فقط" },
  { code: "MANAGERS", label: "المالك + المدير" },
  { code: "ASSIGNED", label: "الموظف المعني" },
  { code: "MANAGERS_AND_ASSIGNED", label: "المالك + المدير + الموظف المعني" },
  { code: "ALL", label: "الكل" },
];

export const eventLabel = (key: string): string =>
  NOTIFICATION_EVENTS.find((e) => e.key === key)?.label ?? key;

// النغمات المدمجة (ملفات WAV مولّدة في public/sounds/).
const BUILTIN_SOUNDS = [
  { name: "تنبيه ناعم", fileUrl: "/sounds/soft.wav" },
  { name: "جرس", fileUrl: "/sounds/bell.wav" },
  { name: "نغمة نجاح", fileUrl: "/sounds/success.wav" },
  { name: "تنبيه عاجل", fileUrl: "/sounds/urgent.wav" },
  { name: "نقرة", fileUrl: "/sounds/click.wav" },
  { name: "دينق", fileUrl: "/sounds/ding.wav" },
];

export type NotifEvent = {
  eventKey: string;
  label: string;
  soundEnabled: boolean;
  toastEnabled: boolean;
  volume: number;
  soundId: string | null;
  audience: string;
};
export type NotifSound = { id: string; name: string; fileUrl: string; isBuiltIn: boolean };
export type NotificationConfig = {
  events: NotifEvent[];
  sounds: NotifSound[];
  masterVolume: number;
  globalMute: boolean;
};

/** كل بيانات قسم الإشعارات (للوحة الإعدادات) — يضمن وجود الافتراضيات. */
export async function getNotificationConfig(): Promise<NotificationConfig> {
  await ensureNotificationDefaults();
  const [rows, sounds, settings] = await Promise.all([
    prisma.notificationSetting.findMany(),
    prisma.soundAsset.findMany({ orderBy: [{ isBuiltIn: "desc" }, { createdAt: "asc" }] }),
    prisma.settings.upsert({ where: { id: "singleton" }, update: {}, create: { id: "singleton" }, select: { masterVolume: true, globalMute: true } }),
  ]);
  const byKey = new Map(rows.map((r) => [r.eventKey, r]));
  // نرتّب حسب ترتيب القائمة الثابت (NOTIFICATION_EVENTS).
  const events: NotifEvent[] = NOTIFICATION_EVENTS.map((e) => {
    const r = byKey.get(e.key);
    return {
      eventKey: e.key,
      label: e.label,
      soundEnabled: r?.soundEnabled ?? true,
      toastEnabled: r?.toastEnabled ?? true,
      volume: r?.volume ?? 100,
      soundId: r?.soundId ?? null,
      audience: r?.audience ?? e.audience,
    };
  });
  return {
    events,
    sounds: sounds.map((s) => ({ id: s.id, name: s.name, fileUrl: s.fileUrl, isBuiltIn: s.isBuiltIn })),
    masterVolume: settings.masterVolume,
    globalMute: settings.globalMute,
  };
}

/**
 * يزرع النغمات المدمجة + إعدادات الأحداث السبعة بقيمها الافتراضية (idempotent).
 */
export async function ensureNotificationDefaults(): Promise<void> {
  // النغمات المدمجة
  if ((await prisma.soundAsset.count({ where: { isBuiltIn: true } })) === 0) {
    await prisma.soundAsset.createMany({
      data: BUILTIN_SOUNDS.map((s) => ({ name: s.name, fileUrl: s.fileUrl, isBuiltIn: true })),
      skipDuplicates: true,
    });
  }
  // إعدادات الأحداث — النغمة الافتراضية = «تنبيه ناعم». نزرع الناقص فقط (idempotent):
  // إضافة حدث جديد لاحقًا (مثل «إنذار سحب عميل») تُزرع تلقائيًا دون مسّ إعدادات الموجود،
  // وهذا ضروري لأن updateNotificationEvent يستخدم update لا upsert (يحتاج صفًّا موجودًا).
  if ((await prisma.notificationSetting.count()) < NOTIFICATION_EVENTS.length) {
    const softSound = await prisma.soundAsset.findFirst({ where: { fileUrl: "/sounds/soft.wav" }, select: { id: true } });
    await prisma.notificationSetting.createMany({
      data: NOTIFICATION_EVENTS.map((e) => ({ eventKey: e.key, audience: e.audience, soundId: softSound?.id ?? null })),
      skipDuplicates: true,
    });
  }
}
