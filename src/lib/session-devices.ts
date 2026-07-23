import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * سجل الجلسات النشطة — مبني على نبضة heartbeat القائمة بلا جدول ولا عمود جديد:
 * صف AuditLog واحد لكل (مستخدم + جهاز) بنوع مخصص `session.device`
 * (entity=session · entityId=userId · summary=وصف الجهاز)، وكل نبضة تحدّث createdAt.
 * الجلسة «نشطة» إذا آخر نبضة خلال ٣٠ دقيقة.
 */

export const SESSION_DEVICE_ACTION = "session.device";
export const ACTIVE_SESSION_WINDOW_MS = 30 * 60 * 1000;

/** وصف الجهاز من User-Agent: جوال/كمبيوتر + المتصفح — بالعربي. */
export function deviceLabelFromUA(ua: string | null): string {
  const s = ua ?? "";
  const kind = /Mobi|Android|iPhone|iPad/i.test(s) ? "جوال" : "كمبيوتر";
  const browser = /Edg\//.test(s) ? "إيدج"
    : /SamsungBrowser/i.test(s) ? "متصفح سامسونج"
      : /OPR\/|Opera/i.test(s) ? "أوبرا"
        : /Chrome\//.test(s) ? "كروم"
          : /Safari\//.test(s) && /Version\//.test(s) ? "سفاري"
            : /Firefox\//.test(s) ? "فايرفوكس"
              : "متصفح آخر";
  return `${kind} · ${browser}`;
}

/** تسجيل نبضة جهاز — upsert منطقي على (المستخدم + وصف الجهاز). فشله لا يُفشل النبضة. */
export async function recordSessionBeat(userId: string, ua: string | null): Promise<void> {
  const label = deviceLabelFromUA(ua);
  const existing = await prisma.auditLog.findFirst({
    where: { action: SESSION_DEVICE_ACTION, entityId: userId, summary: label },
    select: { id: true },
  });
  if (existing) {
    await prisma.auditLog.update({ where: { id: existing.id }, data: { createdAt: new Date() } });
  } else {
    await prisma.auditLog.create({
      data: { userId, action: SESSION_DEVICE_ACTION, entity: "session", entityId: userId, summary: label },
    });
  }
}

export type UserSessions = {
  userId: string;
  name: string;
  devices: { label: string; lastBeat: Date }[];
};

/** الجلسات النشطة (آخر نبضة خلال ٣٠ دقيقة) مجمّعة لكل مستخدم — الأحدث نشاطًا أولًا. */
export async function getActiveSessions(now: Date = new Date()): Promise<UserSessions[]> {
  const since = new Date(now.getTime() - ACTIVE_SESSION_WINDOW_MS);
  const rows = await prisma.auditLog.findMany({
    where: { action: SESSION_DEVICE_ACTION, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    select: { entityId: true, summary: true, createdAt: true },
  });
  const byUser = new Map<string, { label: string; lastBeat: Date }[]>();
  for (const r of rows) {
    if (!r.entityId) continue;
    const list = byUser.get(r.entityId) ?? [];
    list.push({ label: r.summary, lastBeat: r.createdAt });
    byUser.set(r.entityId, list);
  }
  if (byUser.size === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: [...byUser.keys()] } },
    select: { id: true, name: true },
  });
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  return [...byUser.entries()]
    .map(([userId, devices]) => ({ userId, name: nameById.get(userId) ?? "—", devices }))
    .sort((a, b) => b.devices[0].lastBeat.getTime() - a.devices[0].lastBeat.getTime());
}
