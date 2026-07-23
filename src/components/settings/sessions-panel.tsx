"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Smartphone, Monitor, LogOut, MonitorSmartphone } from "lucide-react";
import { lastSeenAgo } from "@/lib/format";
import { signOutUserDevices, signOutAllDevicesAction } from "@/lib/actions/auth";
import type { UserSessions } from "@/lib/session-devices";

/**
 * قسم «الجلسات» بالإعدادات — للمالك فقط (البيانات تُجلب للمالك حصرًا في الصفحة):
 * أجهزة كل مستخدم النشطة (آخر نبضة خلال ٣٠ دقيقة) + إخراج فردي + «خروجي من كل أجهزتي».
 */
export function SessionsPanel({ sessions }: { sessions: UserSessions[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function kickUser(u: UserSessions) {
    if (!confirm(`تسجيل خروج ${u.name} من كل أجهزته؟ سيحتاج الدخول من جديد.`)) return;
    startTransition(async () => {
      const r = await signOutUserDevices(u.userId);
      if (!r.ok && r.error) alert(r.error);
      router.refresh();
    });
  }

  return (
    <section className="glass space-y-3 rounded-2xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-foreground">الجلسات النشطة</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">الأجهزة التي نبضت خلال آخر ٣٠ دقيقة — لكل مستخدم</p>
        </div>
        {/* «خروج من كل الأجهزة» (جلساتي أنا) — انتقل من الهيدر إلى هنا */}
        <form
          action={signOutAllDevicesAction}
          onSubmit={(e) => {
            if (!confirm("تسجيل الخروج من كل الأجهزة؟ ستحتاج تسجيل الدخول من جديد على كل جهاز.")) e.preventDefault();
          }}
        >
          <button
            type="submit"
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
          >
            <MonitorSmartphone className="size-3.5" /> خروجي من كل أجهزتي
          </button>
        </form>
      </div>

      {sessions.length === 0 ? (
        <p className="rounded-xl border border-border px-4 py-6 text-center text-sm text-muted-foreground">
          ما فيه جلسات نشطة الآن.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {sessions.map((u) => (
            <div key={u.userId} className="rounded-xl border border-border bg-background/40 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-foreground">{u.name}</span>
                <button
                  onClick={() => kickUser(u)}
                  disabled={pending}
                  className="flex items-center gap-1 rounded-lg border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/20 disabled:opacity-50"
                >
                  <LogOut className="size-3" /> تسجيل خروج
                </button>
              </div>
              <ul className="space-y-1.5">
                {u.devices.map((d, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                    {d.label.startsWith("جوال") ? <Smartphone className="size-3.5 text-gold" /> : <Monitor className="size-3.5 text-gold" />}
                    <span className="flex-1">{d.label}</span>
                    <span>{lastSeenAgo(d.lastBeat)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
