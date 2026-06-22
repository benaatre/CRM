"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, Check } from "lucide-react";
import { timeAgo } from "@/lib/format";
import { getNotifications, markAllRead, type NotificationDTO } from "@/lib/actions/notifications";

const freqByType: Record<string, number> = {
  "lead.new": 880,
  "booking.created": 660,
  "booking.cancelled": 440,
};

function beep(freq: number) {
  try {
    let on = true, vol = 0.2;
    try { on = localStorage.getItem("notifySound") !== "off"; vol = Number(localStorage.getItem("notifyVolume") ?? "0.2"); } catch {}
    if (!on) return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq;
    o.type = "sine";
    o.connect(g); g.connect(ctx.destination);
    g.gain.value = Math.min(Math.max(vol, 0), 1);
    o.start();
    setTimeout(() => { o.stop(); ctx.close(); }, 200);
  } catch {}
}

export function NotificationBell() {
  const [items, setItems] = useState<NotificationDTO[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<NotificationDTO | null>(null);
  const lastIds = useRef<Set<string>>(new Set());
  const first = useRef(true);

  async function load() {
    const res = await getNotifications();
    setItems(res.items);
    setUnread(res.unread);
    // اكتشاف الجديد للصوت + toast
    if (!first.current) {
      const fresh = res.items.find((n) => !lastIds.current.has(n.id) && !n.read);
      if (fresh) {
        beep(freqByType[fresh.type] ?? 700);
        setToast(fresh);
        setTimeout(() => setToast(null), 4500);
      }
    }
    lastIds.current = new Set(res.items.map((n) => n.id));
    first.current = false;
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, []);

  async function readAll() {
    await markAllRead();
    setUnread(0);
    setItems((xs) => xs.map((x) => ({ ...x, read: true })));
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="relative rounded-xl border border-border p-2 text-muted-foreground transition-colors hover:text-gold">
        <Bell className="size-4" />
        {unread > 0 && <span className="absolute -left-1 -top-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[0.6rem] font-bold text-white">{unread > 9 ? "٩+" : unread}</span>}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-50 mt-2 w-80 rounded-xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border p-3">
              <span className="text-sm font-semibold text-foreground">الإشعارات</span>
              {unread > 0 && <button onClick={readAll} className="flex items-center gap-1 text-xs text-gold"><Check className="size-3.5" /> تمييز الكل كمقروء</button>}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {items.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">ما فيه إشعارات.</p>
              ) : (
                items.map((n) => (
                  <div key={n.id} className={`border-b border-border p-3 ${n.read ? "" : "bg-gold/5"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium text-foreground">{n.title}</span>
                      <span className="shrink-0 text-[0.65rem] text-muted-foreground">{timeAgo(n.createdAt)}</span>
                    </div>
                    {n.body && <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}

      {toast && (
        <div className="fixed bottom-6 left-6 z-[70] w-72 rounded-xl border border-gold/40 bg-card p-4 shadow-2xl">
          <div className="flex items-center gap-2">
            <Bell className="size-4 text-gold" />
            <span className="text-sm font-semibold text-foreground">{toast.title}</span>
          </div>
          {toast.body && <p className="mt-1 text-xs text-muted-foreground">{toast.body}</p>}
        </div>
      )}
    </div>
  );
}
