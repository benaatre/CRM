import "server-only";

import { prisma } from "@/lib/prisma";
import {
  CATEGORIES,
  CATEGORY_META,
  channelIdFor,
  rawNameFor,
  type PushCategory,
} from "@/lib/push/channels";

/**
 * إعداد قنوات الإشعارات النيتف — نغمة كل فئة يختارها المالك.
 *
 * التخزين بإعادة استخدام NotificationSetting (لا جدول ولا عمود جديد): صف لكل
 * فئة بمفتاح `channel:urgent` وأخواته، نستعمل منه حقل soundId وحده. بقية
 * حقول الصف (audience/volume/toast) لا معنى لها هنا وتبقى على افتراضياتها.
 */

/** مفتاح صف الفئة داخل NotificationSetting — بادئة تمنع أي تصادم مع مفاتيح الأحداث. */
export const channelSettingKey = (c: PushCategory): string => `channel:${c}`;

export type ChannelConfig = {
  category: PushCategory;
  /** معرّف القناة على أندرويد — يتغيّر بتغيّر النغمة */
  channelId: string;
  label: string;
  description: string;
  importance: number;
  vibration: boolean;
  /** اسم الملف في res/raw (مثل notif_bell.wav) */
  sound: string;
  /** معرّف SoundAsset المختار — للواجهة */
  soundId: string | null;
  /** مسار النغمة على الويب — للمعاينة في الشاشة */
  soundUrl: string;
};

/**
 * يزرع صفوف الفئات الثلاث بنغماتها الافتراضية (idempotent).
 * منفصل عن ensureNotificationDefaults لأن ذاك يتعامل مع الأحداث لا الفئات.
 */
export async function ensureChannelDefaults(): Promise<void> {
  // تنظيف صفوف فئات النسخة الثلاثية (عاجل/عادي/معلومات) — بطلت أسماؤها مع
  // الانتقال للسبع وصارت يتيمة. idempotent: بعد أول حذف ترجع صفرًا دائمًا.
  await prisma.notificationSetting.deleteMany({
    where: { eventKey: { in: ["channel:urgent", "channel:normal", "channel:info"] } },
  });
  const existing = await prisma.notificationSetting.findMany({
    where: { eventKey: { in: CATEGORIES.map(channelSettingKey) } },
    select: { eventKey: true },
  });
  const have = new Set(existing.map((r) => r.eventKey));
  const missing = CATEGORIES.filter((c) => !have.has(channelSettingKey(c)));
  if (missing.length === 0) return;

  const sounds = await prisma.soundAsset.findMany({
    where: { fileUrl: { in: missing.map((c) => CATEGORY_META[c].defaultSound) } },
    select: { id: true, fileUrl: true },
  });
  const byUrl = new Map(sounds.map((s) => [s.fileUrl, s.id]));

  await prisma.notificationSetting.createMany({
    data: missing.map((c) => ({
      eventKey: channelSettingKey(c),
      soundId: byUrl.get(CATEGORY_META[c].defaultSound) ?? null,
    })),
    skipDuplicates: true,
  });
}

/**
 * إعداد القنوات الثلاث الحالي — يقرأه الخادم لبناء حمولة FCM، ويقرأه التطبيق
 * عند الإقلاع لينشئ القنوات المطابقة.
 *
 * النغمة المرفوعة من المالك (ليست من النغمات المدمجة) لا مقابل لها داخل
 * الـAPK، فتسقط لافتراضي الفئة — مع بقاء اختياره ظاهرًا في الويب.
 */
export async function getChannelConfig(): Promise<ChannelConfig[]> {
  const [rows, sounds] = await Promise.all([
    prisma.notificationSetting.findMany({
      where: { eventKey: { in: CATEGORIES.map(channelSettingKey) } },
      select: { eventKey: true, soundId: true },
    }),
    prisma.soundAsset.findMany({ select: { id: true, fileUrl: true } }),
  ]);
  const soundById = new Map(sounds.map((s) => [s.id, s.fileUrl]));
  const rowByKey = new Map(rows.map((r) => [r.eventKey, r]));

  return CATEGORIES.map((category) => {
    const meta = CATEGORY_META[category];
    const row = rowByKey.get(channelSettingKey(category));
    const chosenUrl = row?.soundId ? soundById.get(row.soundId) : undefined;
    // اسم مورد صالح داخل الـAPK، وإلا افتراضي الفئة.
    const raw = rawNameFor(chosenUrl) ?? rawNameFor(meta.defaultSound)!;
    const effectiveUrl = rawNameFor(chosenUrl) ? chosenUrl! : meta.defaultSound;
    return {
      category,
      channelId: channelIdFor(category, raw),
      label: meta.label,
      description: meta.description,
      importance: meta.importance,
      vibration: meta.vibration,
      sound: raw,
      soundId: row?.soundId ?? null,
      soundUrl: effectiveUrl,
    };
  });
}

// كاش داخل العملية — إعداد القنوات يتغيّر نادرًا، وقراءته مع كل إشعار هدر.
let cache: { at: number; value: ChannelConfig[] } | null = null;
const TTL_MS = 60_000;

/** نسخة مُخبّأة لمسار الإرسال الساخن (كل إشعار يمرّ منها). */
export async function getChannelConfigCached(): Promise<ChannelConfig[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const value = await getChannelConfig();
  cache = { at: Date.now(), value };
  return value;
}

/** يُبطل الكاش فورًا بعد تغيير المالك للنغمة — لئلا ينتظر الإشعار التالي دقيقة. */
export function invalidateChannelCache(): void {
  cache = null;
}
