"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser, requireManager, requireManagerAction } from "@/lib/auth-guards";
import { getNotificationConfig, type NotificationConfig } from "@/lib/data/notifications-config";

export type NotificationDTO = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: Date;
};

export async function getNotifications(): Promise<{ items: NotificationDTO[]; unread: number }> {
  const user = await requireUser();
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.notification.count({ where: { userId: user.id, read: false } }),
  ]);
  return {
    items: items.map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, read: n.read, createdAt: n.createdAt })),
    unread,
  };
}

export async function markAllRead(): Promise<{ ok: boolean }> {
  const user = await requireUser();
  await prisma.notification.updateMany({ where: { userId: user.id, read: false }, data: { read: true } });
  revalidatePath("/", "layout");
  return { ok: true };
}

// ===================== إعدادات الإشعارات والأصوات (المالك/المدير) =====================

export type ActionResult = { ok: boolean; error?: string };

const AUDIENCES = ["OWNER", "MANAGERS", "ASSIGNED", "MANAGERS_AND_ASSIGNED", "ALL"];

/** جلب إعدادات الإشعارات الكاملة (للوحة) — مدير فقط. */
export async function fetchNotificationConfig(): Promise<NotificationConfig> {
  await requireManager();
  return getNotificationConfig();
}

export type PlaybackConfig = {
  events: Record<string, { soundEnabled: boolean; toastEnabled: boolean; volume: number; soundId: string | null }>;
  sounds: Record<string, string>; // soundId → fileUrl
  defaultSoundUrl: string | null;
  masterVolume: number;
  globalMute: boolean;
};

/** إعدادات تشغيل خفيفة لأي مستخدم — لتشغيل النغمة/التوست الصحيحين على العميل. */
export async function fetchPlaybackConfig(): Promise<PlaybackConfig> {
  await requireUser();
  const cfg = await getNotificationConfig();
  const events: PlaybackConfig["events"] = {};
  for (const e of cfg.events) {
    events[e.eventKey] = { soundEnabled: e.soundEnabled, toastEnabled: e.toastEnabled, volume: e.volume, soundId: e.soundId };
  }
  const sounds: Record<string, string> = {};
  for (const s of cfg.sounds) sounds[s.id] = s.fileUrl;
  const defaultSoundUrl = cfg.sounds.find((s) => s.fileUrl === "/sounds/soft.wav")?.fileUrl ?? cfg.sounds[0]?.fileUrl ?? null;
  return { events, sounds, defaultSoundUrl, masterVolume: cfg.masterVolume, globalMute: cfg.globalMute };
}

/** تعديل إعداد حدث (صوت/توست/نغمة/جمهور). */
export async function updateNotificationEvent(
  eventKey: string,
  patch: { soundEnabled?: boolean; toastEnabled?: boolean; volume?: number; soundId?: string | null; audience?: string },
): Promise<ActionResult> {
  try {
    await requireManagerAction();
    if (patch.audience !== undefined && !AUDIENCES.includes(patch.audience)) {
      return { ok: false, error: "جمهور غير صالح" };
    }
    await prisma.notificationSetting.update({
      where: { eventKey },
      data: {
        ...(patch.soundEnabled !== undefined ? { soundEnabled: patch.soundEnabled } : {}),
        ...(patch.toastEnabled !== undefined ? { toastEnabled: patch.toastEnabled } : {}),
        ...(patch.volume !== undefined ? { volume: Math.min(100, Math.max(0, Math.round(patch.volume))) } : {}),
        ...(patch.soundId !== undefined ? { soundId: patch.soundId || null } : {}),
        ...(patch.audience !== undefined ? { audience: patch.audience } : {}),
      },
    });
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** تعديل التحكم العام: مستوى الصوت الرئيسي / كتم الكل. */
export async function updateMasterAudio(patch: { masterVolume?: number; globalMute?: boolean }): Promise<ActionResult> {
  try {
    await requireManagerAction();
    const data: { masterVolume?: number; globalMute?: boolean } = {};
    if (patch.masterVolume !== undefined) data.masterVolume = Math.min(100, Math.max(0, Math.round(patch.masterVolume)));
    if (patch.globalMute !== undefined) data.globalMute = patch.globalMute;
    await prisma.settings.update({ where: { id: "singleton" }, data });
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** حذف نغمة مرفوعة (المدمجة ما تنحذف). */
export async function deleteSound(id: string): Promise<ActionResult> {
  try {
    await requireManagerAction();
    const s = await prisma.soundAsset.findUnique({ where: { id }, select: { isBuiltIn: true } });
    if (!s) return { ok: false, error: "النغمة غير موجودة" };
    if (s.isBuiltIn) return { ok: false, error: "ما يمكن حذف نغمة مدمجة" };
    // فك ارتباط الأحداث التي تستخدمها (ترجع للنغمة الافتراضية).
    await prisma.notificationSetting.updateMany({ where: { soundId: id }, data: { soundId: null } });
    await prisma.soundAsset.delete({ where: { id } });
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
