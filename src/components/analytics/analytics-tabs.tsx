"use client";

import { useState } from "react";
import { toArabicDigits } from "@/lib/format";
import type { AnalyticsData } from "@/lib/data/analytics";

type Team = AnalyticsData["team"];

/** هيكل ٣ تبويبات منفصلة للتحليلات — كل تبويب يعرض محتواه فقط. الافتراضي «المؤشرات العامة». */
export function AnalyticsTabs({
  general, projectFinance, employees,
}: {
  general: React.ReactNode;
  projectFinance: React.ReactNode;
  employees: React.ReactNode;
}) {
  const [tab, setTab] = useState<"general" | "finance" | "employees">("general");
  const tabs = [
    ["general", "المؤشرات العامة"],
    ["finance", "تحليل المشاريع المالي"],
    ["employees", "أداء الموظفين"],
  ] as const;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1">
        {tabs.map(([v, label]) => (
          <button
            key={v}
            onClick={() => setTab(v)}
            className={`flex-1 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${tab === v ? "bg-secondary text-gold" : "text-muted-foreground hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "general" ? general : tab === "finance" ? projectFinance : employees}
    </div>
  );
}

export function EmployeeKpis({ team }: { team: Team }) {
  if (team.length === 0) {
    return <p className="glass rounded-2xl p-8 text-center text-muted-foreground">ما فيه موظفون.</p>;
  }
  return (
    <section className="glass rounded-2xl p-5">
      <h2 className="mb-4 font-semibold text-foreground">أداء الموظفين — مؤشرات الأداء (KPI)</h2>

      {/* بطاقات الجوال */}
      <div className="space-y-3 md:hidden">
        {team.map((t) => (
          <div key={t.id} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="font-medium text-foreground">{t.name}</span>
              <span className="rounded-full bg-gold/15 px-2 py-0.5 text-xs text-gold">تحويل {toArabicDigits(t.conversion)}٪</span>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
              <Cell label="عملاء" v={t.assigned} />
              <Cell label="متابعات" v={t.followups} />
              <Cell label="زيارات" v={t.visits} />
              <Cell label="حجوزات" v={t.bookings} />
            </div>
            <TargetBar closed={t.closed} target={t.target} progress={t.progress} />
          </div>
        ))}
      </div>

      {/* جدول سطح المكتب */}
      <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
        <table className="w-full min-w-[760px] text-right text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
          <thead className="bg-secondary/40 text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">الموظف</th>
              <th className="px-4 py-3 font-medium">العملاء المعيّنون</th>
              <th className="px-4 py-3 font-medium">المتابعات</th>
              <th className="px-4 py-3 font-medium">الزيارات</th>
              <th className="px-4 py-3 font-medium">الحجوزات</th>
              <th className="px-4 py-3 font-medium">معدل التحويل</th>
              <th className="px-4 py-3 font-medium">الهدف الشهري</th>
            </tr>
          </thead>
          <tbody>
            {team.map((t) => (
              <tr key={t.id} className="border-t border-border hover:bg-secondary/30">
                <td className="px-4 py-3 font-medium text-foreground">{t.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{toArabicDigits(t.assigned)}</td>
                <td className="px-4 py-3 text-muted-foreground">{toArabicDigits(t.followups)}</td>
                <td className="px-4 py-3 text-muted-foreground">{toArabicDigits(t.visits)}</td>
                <td className="px-4 py-3 text-muted-foreground">{toArabicDigits(t.bookings)}</td>
                <td className="px-4 py-3 text-gold">{toArabicDigits(t.conversion)}٪</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full bg-gold" style={{ width: `${Math.min(t.progress ?? 0, 100)}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {toArabicDigits(t.closed)} / {t.target > 0 ? toArabicDigits(t.target) : "—"}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Cell({ label, v }: { label: string; v: number }) {
  return (
    <div className="rounded-lg bg-secondary/50 py-2">
      <div className="text-base font-bold text-foreground">{toArabicDigits(v)}</div>
      <div className="text-muted-foreground">{label}</div>
    </div>
  );
}

function TargetBar({ closed, target, progress }: { closed: number; target: number; progress: number | null }) {
  return (
    <div className="mt-3">
      <div className="mb-1 flex justify-between text-xs text-muted-foreground">
        <span>الهدف الشهري</span>
        <span className="text-gold">{toArabicDigits(closed)} / {target > 0 ? toArabicDigits(target) : "—"}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-gold" style={{ width: `${Math.min(progress ?? 0, 100)}%` }} />
      </div>
    </div>
  );
}
