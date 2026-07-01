"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { getNotifications, fetchPlaybackConfig, type NotificationDTO, type PlaybackConfig } from "@/lib/actions/notifications";
import { eventColor } from "@/lib/notifications/event-styles";

const POLL_MS = 5000;

/**
 * مزوّد مركزي (مركّب مرة واحدة في الـ layout) — يتولّى صوت وتوست الإشعارات الجديدة
 * للمستخدم الحالي، حسب إعداد كل حدث (صوت/توست/نغمة/مستوى/لون) واحترام كتم الكل.
 * الجرس يبقى للقائمة والعدّاد فقط (تفاديًا لتكرار الصوت).
 */
export function NotificationCenter() {
  const cfg = useRef<PlaybackConfig | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const first = useRef(true);
  const unlocked = useRef(false);
  const [toast, setToast] = useState<NotificationDTO | null>(null);
  const [shown, setShown] = useState(false); // للأنيميشن (ظهور/اختفاء)

  // فتح الصوت بعد أول تفاعل (يشمل لمس الجوال).
  useEffect(() => {
    const unlock = () => { unlocked.current = true; };
    const events = ["pointerdown", "touchstart", "keydown"] as const;
    events.forEach((e) => window.addEventListener(e, unlock, { once: true }));
    return () => events.forEach((e) => window.removeEventListener(e, unlock));
  }, []);

  useEffect(() => {
    let alive = true;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let removeTimer: ReturnType<typeof setTimeout> | undefined;

    function playSound(url: string | undefined, eventVolume: number, masterVolume: number) {
      if (!url || !unlocked.current) return; // قبل أول تفاعل: تجاهل بصمت
      try {
        const a = new Audio(url);
        a.volume = Math.min(1, Math.max(0, (eventVolume / 100) * (masterVolume / 100)));
        a.play().catch(() => {});
      } catch { /* تجاهل بصمت */ }
    }

    function showToast(n: NotificationDTO) {
      clearTimeout(hideTimer); clearTimeout(removeTimer);
      setToast(n);
      // ظهور ناعم في الإطار التالي.
      requestAnimationFrame(() => { if (alive) setShown(true); });
      hideTimer = setTimeout(() => {
        if (!alive) return;
        setShown(false); // بداية الاختفاء
        removeTimer = setTimeout(() => { if (alive) setToast(null); }, 320);
      }, 4500);
    }

    function handle(n: NotificationDTO) {
      const c = cfg.current;
      const ev = c?.events[n.type]; // type = eventKey
      const toastEnabled = ev ? ev.toastEnabled : true; // الأنواع القديمة → توست افتراضيًا
      const soundEnabled = ev ? ev.soundEnabled : false;
      if (toastEnabled) showToast(n);
      if (c && soundEnabled && !c.globalMute) {
        const url = (ev?.soundId && c.sounds[ev.soundId]) || c.defaultSoundUrl || undefined;
        playSound(url, ev?.volume ?? 100, c.masterVolume);
      }
    }

    async function tick() {
      const [conf, res] = await Promise.all([
        fetchPlaybackConfig().catch(() => null),
        getNotifications().catch(() => null),
      ]);
      if (!alive || !res) return;
      if (conf) cfg.current = conf;
      if (first.current) {
        res.items.forEach((n) => seen.current.add(n.id));
        first.current = false;
        return;
      }
      const fresh = res.items.filter((n) => !seen.current.has(n.id));
      fresh.forEach((n) => seen.current.add(n.id));
      const newest = fresh.filter((n) => !n.read)[0];
      if (newest) handle(newest);
    }
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(t); clearTimeout(hideTimer); clearTimeout(removeTimer); };
  }, []);

  if (!toast) return null;
  const color = eventColor(toast.type);
  const body = (
    <div className="flex items-start gap-2">
      <Bell className="mt-0.5 size-4 shrink-0" style={{ color }} />
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground">{toast.title}</div>
        {toast.body && <p className="mt-0.5 text-xs text-muted-foreground">{toast.body}</p>}
      </div>
    </div>
  );

  return (
    <div
      className={`fixed bottom-4 left-4 right-4 z-[80] mx-auto max-w-sm overflow-hidden rounded-xl border border-gold/30 bg-card p-4 shadow-2xl transition-all duration-300 ease-out sm:left-6 sm:right-auto sm:w-80 ${shown ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"}`}
      style={{ borderInlineStartWidth: 4, borderInlineStartColor: color }}
    >
      {toast.link ? <Link href={toast.link} onClick={() => setToast(null)}>{body}</Link> : body}
    </div>
  );
}
