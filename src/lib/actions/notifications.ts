"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guards";

export type NotificationDTO = {
  id: string;
  type: string;
  title: string;
  body: string | null;
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
    items: items.map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, read: n.read, createdAt: n.createdAt })),
    unread,
  };
}

export async function markAllRead(): Promise<{ ok: boolean }> {
  const user = await requireUser();
  await prisma.notification.updateMany({ where: { userId: user.id, read: false }, data: { read: true } });
  revalidatePath("/", "layout");
  return { ok: true };
}
