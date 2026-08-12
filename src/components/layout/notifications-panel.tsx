"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Bell, X } from "lucide-react";
import { timeAgo } from "@/lib/format";
import { markAllRead, type NotificationDTO } from "@/lib/actions/notifications";
import { subscribeNotifications, markSnapshotRead } from "@/components/layout/notifications-store";
import { eventColor } from "@/lib/notifications/event-styles";
import { toArabicDigits } from "@/lib/format";

/**
 * الجرس + لوحة الإشعارات — نفس المصدر القائم حرفيًا (`getNotifications` عبر
 * المخزن المشترك ببولينق واحد/٦٠ث)، مضافًا إليها **تبويبات فلترة على `type`**.
 *
 * حدود معلنة: بلا أزرار تنفيذ لكل نوع (نطاق مؤجّل بقرار المالك) — النقر يفتح
 * `link` الموجود، والفتح يعلّم الكل مقروءًا كما كان. صفر فعل خادم جديد.
 * كل مستمع مُنظَّف، والفلترة محلية على اللقطة المحمّلة.
 */

type TabKey = "all" | "leads" | "appts" | "alerts";

/** تصنيف عرضي فوق مفاتيح الأحداث القائمة — لا يمسّ أي منطق. */
const TAB_OF: Record<string, Exclude<TabKey, "all">> = {
  new_lead_from_sheet: "leads",
  lead_assigned: "leads",
  lead_reassigned: "leads",
  followup_due: "appts",
  unit_booked_sold: "appts",
  employee_idle: "alerts",
  "sweep.warn": "alerts",
  employee_paused: "alerts",
};
const tabOf = (type: string): Exclude<TabKey, "all"> => TAB_OF[type] ?? "alerts";

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "الكل" },
  { key: "leads", label: "عملاء جدد" },
  { key: "appts", label: "مواعيد" },
  { key: "alerts", label: "تنبيهات" },
];

export function NotificationsPanel() {
  const [items, setItems] = useState<NotificationDTO[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabKey>("all");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => subscribeNotifications((s) => { setItems(s.items); setUnread(s.unread); }), []);

  // إغلاق بالضغط خارجها أو بـEsc — المستمعات كلها مُنظَّفة.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const counts = useMemo(() => {
    const c: Record<TabKey, number> = { all: items.length, leads: 0, appts: 0, alerts: 0 };
    for (const n of items) c[tabOf(n.type)]++;
    return c;
  }, [items]);

  const shown = useMemo(
    () => (tab === "all" ? items : items.filter((n) => tabOf(n.type) === tab)),
    [items, tab],
  );

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      markSnapshotRead();
      markAllRead().catch(() => {});
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={toggle}
        aria-label="الإشعارات"
        aria-expanded={open}
        className="relative rounded-xl bg-[var(--elev)] p-2 text-muted-foreground transition-colors hover:text-foreground"
      >
        <Bell className="size-4" strokeWidth={1.6} />
        {unread > 0 && (
          <span
            className="absolute -left-1 -top-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {unread > 9 ? "٩+" : toArabicDigits(unread)}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-x-3 top-16 z-50 mx-auto max-w-sm overflow-hidden rounded-2xl bg-card shadow-2xl sm:absolute sm:inset-x-auto sm:left-0 sm:top-auto sm:mt-2 sm:w-[352px]">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-[14.5px] font-semibold text-foreground">الإشعارات</span>
            <button
              onClick={() => setOpen(false)}
              aria-label="إغلاق"
              className="grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-4" strokeWidth={1.6} />
            </button>
          </div>

          {/* تبويبات الفلترة — على النوع القائم، بلا أي فعل جديد */}
          <div className="flex gap-1.5 px-4 pb-3">
            {TABS.map((t) => {
              const on = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  aria-pressed={on}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium transition-colors ${
                    on ? "bg-gold text-background" : "bg-[var(--elev)] text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t.label}
                  {counts[t.key] > 0 && (
                    <span className={on ? "opacity-80" : "opacity-60"} style={{ fontVariantNumeric: "tabular-nums" }}>
                      {toArabicDigits(counts[t.key])}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {shown.length === 0 ? (
              <p className="py-10 text-center text-[13.5px] text-muted-foreground/70">
                {items.length === 0 ? "ما فيه إشعارات." : "ما فيه إشعارات في هذا التبويب."}
              </p>
            ) : (
              shown.map((n) => {
                const inner = (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 break-words text-[13.5px] font-medium text-foreground">{n.title}</span>
                      <span className="shrink-0 text-[11.5px] text-muted-foreground/70">{timeAgo(n.createdAt)}</span>
                    </div>
                    {n.body && <p className="mt-1 break-words text-[12.5px] leading-6 text-muted-foreground">{n.body}</p>}
                  </>
                );
                const cls = `block px-4 py-3 ${n.read ? "" : "bg-gold/5"}`;
                const style = { borderInlineStartWidth: 3, borderInlineStartColor: eventColor(n.type) };
                return n.link ? (
                  <Link key={n.id} href={n.link} onClick={() => setOpen(false)} className={`${cls} transition-colors hover:bg-[var(--elev)]`} style={style}>
                    {inner}
                  </Link>
                ) : (
                  <div key={n.id} className={cls} style={style}>{inner}</div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default NotificationsPanel;

