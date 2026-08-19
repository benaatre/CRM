"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { toArabicDigits } from "@/lib/format";
import { hmLabel } from "@/lib/attendance-ui";
import type { TeamSummaryRow } from "@/lib/data/attendance";

/**
 * تبويب «الكل» — جدول الفريق الشهري: أيام دوام / ساعات / تأخير / غياب لكل
 * موظف + بداية دوامه. فلتر شهر (يجلب من الخادم) وبحث بالاسم (محلي)، وكل صف
 * يفتح ملف الموظف.
 */
export function TeamTab({ initialMonth, initialRows }: { initialMonth: string; initialRows: TeamSummaryRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [month, setMonth] = useState(initialMonth);
  const [rows, setRows] = useState<TeamSummaryRow[]>(initialRows);
  const [q, setQ] = useState("");

  const changeMonth = (m: string) => {
    if (!m) return;
    setMonth(m);
    start(async () => {
      try {
        const res = await fetch(`/api/attendance/team?month=${m}`, { cache: "no-store" });
        const data = (await res.json()) as { ok: boolean; rows?: TeamSummaryRow[] };
        if (data.ok && data.rows) setRows(data.rows);
      } catch {
        /* الصفوف الحالية تبقى — تغيير الشهر يعاد */
      }
    });
  };

  const visible = rows.filter((r) => r.name.includes(q.trim()));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          الشهر
          <input
            type="month"
            value={month}
            onChange={(e) => changeMonth(e.target.value)}
            dir="ltr"
            className="h-9 rounded-xl border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:border-ring"
          />
        </label>
        <label className="relative flex-1 min-w-[180px]">
          <Search
            aria-hidden
            size={14}
            strokeWidth={1.8}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث باسم الموظف"
            className="h-9 w-full rounded-xl border border-input bg-background pr-8 pl-3 text-sm text-foreground outline-none focus:border-ring"
          />
        </label>
        {pending && <span className="text-xs text-muted-foreground">جاري التحميل…</span>}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[640px] text-right text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="px-4 py-3 font-medium">الموظف</th>
              <th className="px-4 py-3 font-medium">بداية دوامه</th>
              <th className="px-4 py-3 font-medium">أيام دوام</th>
              <th className="px-4 py-3 font-medium">الساعات</th>
              <th className="px-4 py-3 font-medium">أيام تأخير</th>
              <th className="px-4 py-3 font-medium">أيام غياب</th>
              <th className="px-4 py-3 font-medium">نسبة التأكيد</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {rows.length === 0 ? "ما فيه موظفين نشطين" : "ما فيه نتائج بهذا الاسم"}
                </td>
              </tr>
            )}
            {visible.map((r) => (
              <tr
                key={r.id}
                onClick={() => router.push(`/employees/${r.id}?month=${month}`)}
                className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-secondary/40"
              >
                <td className="px-4 py-3 font-medium text-foreground">{r.name}</td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{r.startText}</td>
                <td className="px-4 py-3 text-foreground">{toArabicDigits(r.workDays)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-foreground" >
                  {hmLabel(r.totalMinutes, toArabicDigits)}
                </td>
                <td className={`px-4 py-3 ${r.lateDays > 0 ? "text-warning" : "text-muted-foreground"}`}>
                  {toArabicDigits(r.lateDays)}
                </td>
                <td className={`px-4 py-3 ${r.absentDays > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                  {toArabicDigits(r.absentDays)}
                </td>
                {/* نسبة التأكيد (الدفعة الرابعة): المؤكَّد ÷ مجموع الشهر */}
                <td className={`px-4 py-3 tabular-nums ${r.confirmationPct < 90 ? "text-warning" : "text-muted-foreground"}`}>
                  {r.totalMinutes > 0 ? `${toArabicDigits(r.confirmationPct)}٪` : "—"}
                  {r.remoteDays > 0 && (
                    <span className="ms-2 text-[10.5px] text-info">{toArabicDigits(r.remoteDays)} عن بُعد</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default TeamTab;
