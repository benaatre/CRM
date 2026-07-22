"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { timeAgo } from "@/lib/format";
import { markAllRead, type NotificationDTO } from "@/lib/actions/notifications";
import { subscribeNotifications, markSnapshotRead } from "@/components/layout/notifications-store";
import { eventColor } from "@/lib/notifications/event-styles";

// ملاحظة: الصوت والتوست يتولّاهما NotificationCenter (مركّب مرة واحدة في الـ layout)
// تفاديًا لتكرار الصوت — الجرس للقائمة والعدّاد فقط.
// البيانات من المخزن المشترك (notifications-store) — بولينق واحد للجلسة كلها (م-٥).
export function NotificationBell() {
  const [items, setItems] = useState<NotificationDTO[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return subscribeNotifications((s) => {
      setItems(s.items);
      setUnread(s.unread);
    });
  }, []);

  // إغلاق القائمة عند الضغط خارجها.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  // فتح القائمة → علّم الكل كمقروء تلقائيًا (العدّاد يصفّر فورًا).
  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      markSnapshotRead(); // تحديث اللقطة المشتركة (الجرس + المركز) فورًا
      markAllRead().catch(() => {});
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={toggle} className="relative rounded-xl border border-border p-2 text-muted-foreground transition-colors hover:text-gold">
        <Bell className="size-4" />
        {unread > 0 && <span className="absolute -left-1 -top-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[0.6rem] font-bold text-white">{unread > 9 ? "٩+" : unread}</span>}
      </button>

      {open && (
        <div className="fixed inset-x-3 top-16 z-50 mx-auto max-w-sm rounded-xl border border-border bg-card shadow-2xl sm:absolute sm:inset-x-auto sm:left-0 sm:top-auto sm:mt-2 sm:w-80">
          <div className="flex items-center justify-between border-b border-border p-3">
            <span className="text-sm font-semibold text-foreground">الإشعارات</span>
            {items.length > 0 && <span className="text-[0.65rem] text-muted-foreground">{timeAgo(items[0].createdAt)}</span>}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">ما فيه إشعارات.</p>
            ) : (
              items.map((n) => {
                const inner = (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 break-words text-sm font-medium text-foreground">{n.title}</span>
                      <span className="shrink-0 text-[0.65rem] text-muted-foreground">{timeAgo(n.createdAt)}</span>
                    </div>
                    {n.body && <p className="mt-0.5 break-words text-xs text-muted-foreground">{n.body}</p>}
                  </>
                );
                const cls = `block border-b border-border p-3 ${n.read ? "" : "bg-gold/5"}`;
                const style = { borderInlineStartWidth: 3, borderInlineStartColor: eventColor(n.type) };
                return n.link
                  ? <Link key={n.id} href={n.link} onClick={() => setOpen(false)} className={`${cls} hover:bg-secondary/40`} style={style}>{inner}</Link>
                  : <div key={n.id} className={cls} style={style}>{inner}</div>;
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
