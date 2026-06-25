"use server";

import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guards";

export type ChatMessageDTO = {
  id: string;
  body: string;
  senderId: string;
  senderName: string;
  mine: boolean;
  createdAt: Date;
};

export type ChatPeer = { id: string; name: string; role: Role; online: boolean };

const ONLINE_MS = 5 * 60 * 1000;

/** قائمة الموظفين للشات الخاص (عدا المستخدم الحالي). */
export async function getChatPeers(): Promise<ChatPeer[]> {
  const me = await requireUser();
  const users = await prisma.user.findMany({
    where: { active: true, NOT: { id: me.id } },
    select: { id: true, name: true, role: true, lastSeenAt: true },
    orderBy: { name: "asc" },
  });
  const now = Date.now();
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    role: u.role,
    online: !!u.lastSeenAt && now - u.lastSeenAt.getTime() < ONLINE_MS,
  }));
}

/**
 * رسائل الشات — جماعي (peerId فارغ → recipientId = null) أو خاص بين المستخدم الحالي و peerId.
 */
export async function getChatMessages(peerId?: string | null): Promise<ChatMessageDTO[]> {
  const me = await requireUser();
  const where = peerId
    ? {
        OR: [
          { senderId: me.id, recipientId: peerId },
          { senderId: peerId, recipientId: me.id },
        ],
      }
    : { recipientId: null };

  const rows = await prisma.chatMessage.findMany({
    where,
    select: { id: true, body: true, senderId: true, createdAt: true, sender: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    senderId: r.senderId,
    senderName: r.sender.name,
    mine: r.senderId === me.id,
    createdAt: r.createdAt,
  }));
}

/** إرسال رسالة — جماعية (بدون recipientId) أو خاصة. */
export async function sendChatMessage(
  body: string,
  recipientId?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const me = await requireUser();
  const text = body.trim();
  if (!text) return { ok: false, error: "الرسالة فارغة" };
  if (text.length > 2000) return { ok: false, error: "الرسالة طويلة جدًا" };
  if (recipientId) {
    const peer = await prisma.user.findUnique({ where: { id: recipientId }, select: { id: true } });
    if (!peer) return { ok: false, error: "المستلم غير موجود" };
  }
  await prisma.chatMessage.create({
    data: { body: text, senderId: me.id, recipientId: recipientId ?? null },
  });
  return { ok: true };
}
