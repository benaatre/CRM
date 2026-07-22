"use client";

import { getNotifications, type NotificationDTO } from "@/lib/actions/notifications";

export type NotificationsSnapshot = { items: NotificationDTO[]; unread: number };

// مخزن مشترك بين الجرس (NotificationBell) والمركز (NotificationCenter):
// بولينق واحد كل ٦٠ ثانية بدل اثنين كل ١٥ (م-٥) — ويتوقف والتبويب مخفي.
let snapshot: NotificationsSnapshot = { items: [], unread: 0 };
let loaded = false;
const listeners = new Set<(s: NotificationsSnapshot) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

export const NOTIFICATIONS_POLL_MS = 60_000;

async function refresh() {
  if (typeof document !== "undefined" && document.hidden) return;
  try {
    snapshot = await getNotifications();
    loaded = true;
    listeners.forEach((l) => l(snapshot));
  } catch {
    /* فشل مؤقت — المحاولة القادمة بعد دقيقة */
  }
}

function ensureTimer() {
  if (timer) return;
  void refresh();
  timer = setInterval(refresh, NOTIFICATIONS_POLL_MS);
  if (typeof document !== "undefined") {
    // رجوع التبويب للواجهة → تحديث فوري (بدل انتظار بقية الدقيقة).
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) void refresh();
    });
  }
}

/** اشتراك مكوّن في اللقطة المشتركة — يُستدعى فورًا بالقيمة الحالية ثم مع كل تحديث. */
export function subscribeNotifications(cb: (s: NotificationsSnapshot) => void): () => void {
  listeners.add(cb);
  if (loaded) cb(snapshot);
  ensureTimer();
  return () => {
    listeners.delete(cb);
  };
}

/** تعليم الكل مقروءًا محليًا (فوري) — القاعدة تُحدَّث عبر markAllRead في المكوّن. */
export function markSnapshotRead() {
  snapshot = { items: snapshot.items.map((n) => ({ ...n, read: true })), unread: 0 };
  listeners.forEach((l) => l(snapshot));
}
