"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ArrowLeft } from "lucide-react";
import { toArabicDigits, formatDateTime } from "@/lib/format";
import type { ActivityReport } from "@/lib/data/activity-report";

type Mode = "today" | "all" | "day";

export function ActivityReportView({
  data, mode, day,
}: {
  data: ActivityReport;
  mode: Mode;
  day: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function go(params: Record<string, string>) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
    const s = p.toString();
    startTransition(() => router.push(s ? `/distribution?${s}` : "/distribution"));
  }

  const btn = (active: boolean) =>
    `rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${active ? "border-gold bg-gold/15 text-gold" : "border-border text-muted-foreground hover:text-foreground"}`;

  return (
    <section className="mx-auto mt-6 max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-foreground">تقرير النشاط</h2>
          <p className="text-xs text-muted-foreground">الفترة: <span className="text-gold">{data.periodLabel}</span>{pending ? " · جارٍ التحديث…" : ""}</p>
        </div>
        {/* محدّد الفترة */}
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => go({})} className={btn(mode === "today")}>اليوم</button>
          <button onClick={() => go({ arp: "all" })} className={btn(mode === "all")}>الإجمالي</button>
          <input
            type="date"
            value={mode === "day" ? day : ""}
            onChange={(e) => (e.target.value ? go({ arday: e.target.value }) : go({}))}
            className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-gold"
            aria-label="يوم محدّد"
          />
        </div>
      </div>

      {/* جدول الموظفين — الأعمدة بترتيب الأولويات */}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[680px] text-right text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
          <thead className="bg-secondary/40 text-muted-foreground">
            <tr>
              <th className="px-3 py-2.5 font-medium">الموظف</th>
              <th className="px-3 py-2.5 font-medium">استقبل</th>
              <th className="px-3 py-2.5 font-medium">تأخّر / فات منه</th>
              <th className="px-3 py-2.5 font-medium">متابعات</th>
              <th className="px-3 py-2.5 font-medium">زيارات</th>
              <th className="px-3 py-2.5 font-medium">حجوزات</th>
              <th className="px-3 py-2.5 font-medium">غير مهتم</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">ما فيه نشاط في هذه الفترة.</td></tr>
            ) : (
              data.rows.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-secondary/40">
                  <td className="px-3 py-2.5 font-medium text-foreground">{r.name}</td>
                  <td className="px-3 py-2.5 text-info">{toArabicDigits(r.received)}</td>
                  <td className={`px-3 py-2.5 font-medium ${r.lateLost > 0 ? "text-destructive" : "text-muted-foreground"}`}>{toArabicDigits(r.lateLost)}</td>
                  <td className="px-3 py-2.5 text-foreground">{toArabicDigits(r.followups)}</td>
                  <td className="px-3 py-2.5 text-foreground">{toArabicDigits(r.visits)}</td>
                  <td className="px-3 py-2.5 font-medium text-success">{toArabicDigits(r.bookings)}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{toArabicDigits(r.notInterested)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* قائمة الفوات — من فات منه العميل ومن استلمه + الوقت */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-bold text-destructive">إعادات التوجيه (فوات العملاء)</h3>
        {data.reassigns.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">ما فيه فوات في هذه الفترة — ما شاء الله.</p>
        ) : (
          <ul className="space-y-2">
            {data.reassigns.map((e, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-background/40 px-3 py-2 text-xs">
                <span className="font-medium text-foreground">{e.leadName}</span>
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="text-destructive">{e.fromName}</span>
                  <ArrowLeft className="size-3.5" />
                  <span className="text-success">{e.toName}</span>
                </span>
                <span className="text-muted-foreground">{formatDateTime(e.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
