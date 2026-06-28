"use client";

import { useState, useTransition } from "react";
import { purchaseGoalLabels, purchaseMethodLabels } from "@/lib/labels";
import { toArabicDigits } from "@/lib/format";
import { fetchEmployeeAnalysis } from "@/lib/actions/analytics";
import type { EmployeeDeepAnalysis, DistItem, StuckLead } from "@/lib/data/analytics";

const goalLabel = (k: string) => (k === "NONE" ? "غير محدّد" : purchaseGoalLabels[k as keyof typeof purchaseGoalLabels] ?? k);
const methodLabel = (k: string) => (k === "NONE" ? "غير محدّد" : purchaseMethodLabels[k as keyof typeof purchaseMethodLabels] ?? k);
const hrs = (h: number | null) => (h == null ? "—" : `${toArabicDigits(h)} ساعة`);

/** لوحة المدير: اختيار موظف + تحليله العميق. */
export function EmployeeAnalysisPanel({ employees }: { employees: { id: string; name: string }[] }) {
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState("");
  const [data, setData] = useState<EmployeeDeepAnalysis | null>(null);

  function onSelect(id: string) {
    setSelected(id);
    setData(null);
    if (!id) return;
    startTransition(async () => setData(await fetchEmployeeAnalysis(id)));
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold text-foreground">تحليل أداء موظف</h2>
        <select value={selected} onChange={(e) => onSelect(e.target.value)} className="select-base sm:w-auto">
          <option value="">اختر موظفًا…</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </div>
      {pending && <p className="glass rounded-2xl p-8 text-center text-sm text-muted-foreground">جارٍ التحميل…</p>}
      {!pending && data && <EmployeeAnalysisView data={data} />}
      {!pending && !data && selected === "" && (
        <p className="glass rounded-2xl p-8 text-center text-muted-foreground">اختر موظفًا لعرض تحليله العميق.</p>
      )}
    </div>
  );
}

/** عرض تحليل الموظف (مشترك بين المدير وصفحة الموظف نفسه). */
export function EmployeeAnalysisView({ data: d }: { data: EmployeeDeepAnalysis }) {
  return (
    <div className="space-y-6">
      <div className="text-lg font-bold text-foreground">{d.name}</div>

      {/* حجم الشغل */}
      <Block title="حجم الشغل">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="إجمالي عملائه" v={d.total} cls="text-gold" />
          <Stat label="النشط" v={d.active} cls="text-success" />
          <Stat label="المؤرشف" v={d.archived} cls="text-muted-foreground" />
        </div>
        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          <Dist title="توزيع حسب هدف الشراء" items={d.byGoal} label={goalLabel} color="var(--gold)" />
          <Dist title="توزيع حسب طريقة الشراء" items={d.byMethod} label={methodLabel} color="var(--info)" />
        </div>
      </Block>

      {/* النشاط والاستجابة */}
      <Block title="النشاط والاستجابة">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="المتابعات" v={d.followups} cls="text-foreground" />
          <Stat label="الزيارات" v={d.visits} cls="text-info" />
          <Stat label="الاتصالات" v={d.calls} cls="text-warning" />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
          <Info label="متوسط تأخر أول تواصل" value={hrs(d.avgResponseHours)} />
          <Info label="أسرع استجابة" value={hrs(d.fastestResponseHours)} accent="text-success" />
          <Info label="أبطأ استجابة" value={hrs(d.slowestResponseHours)} accent="text-destructive" />
        </div>
      </Block>

      {/* النتائج */}
      <Block title="النتائج">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="الحجوزات" v={d.bookings} cls="text-warning" />
          <Stat label="المبيعات" v={d.sales} cls="text-info" />
          <Stat label="مقفول-بيع" v={d.closed} cls="text-success" />
          <div className="rounded-xl bg-secondary/50 py-3 text-center">
            <div className="text-2xl font-bold text-gold">{toArabicDigits(d.conversion)}٪</div>
            <div className="text-xs text-muted-foreground">معدل التحويل</div>
          </div>
        </div>
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-sm">
            <span className="text-muted-foreground">نسبة الوصول للهدف الشهري</span>
            <span className="text-gold">{toArabicDigits(d.closed)} / {d.target > 0 ? toArabicDigits(d.target) : "غير محدّد"}{d.targetPct != null && ` (${toArabicDigits(d.targetPct)}٪)`}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full bg-gradient-to-l from-gold to-gold-dark" style={{ width: `${Math.min(d.targetPct ?? 0, 100)}%` }} />
          </div>
        </div>
      </Block>

      {/* التشخيص — نجح وفشل */}
      <Block title="التشخيص — نجح وفشل">
        <div className="grid gap-4 lg:grid-cols-2">
          {/* مقارنة بالفريق */}
          <div className="space-y-3">
            <Compare label="معدل التحويل" mine={`${toArabicDigits(d.conversion)}٪`} team={`${toArabicDigits(d.teamAvgConversion)}٪`} better={d.conversion >= d.teamAvgConversion} />
            <Compare label="سرعة الاستجابة (أقل أفضل)" mine={hrs(d.avgResponseHours)} team={hrs(d.teamAvgResponseHours)} better={d.avgResponseHours != null && d.teamAvgResponseHours != null ? d.avgResponseHours <= d.teamAvgResponseHours : false} />
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
              <div className="text-sm font-bold text-destructive">{toArabicDigits(d.lost)} عميل ضائع (مهمل/خاسر)</div>
              <div className="text-xs text-muted-foreground">{toArabicDigits(d.lostPct)}٪ من إجمالي عملائه</div>
            </div>
          </div>
          {/* عملاء عالقون */}
          <div className="rounded-xl border border-warning/30 bg-warning/5 p-3">
            <div className="mb-2 text-sm font-bold text-warning">محتاجين متابعة ({toArabicDigits(d.stuck.length)})</div>
            {d.stuck.length === 0 ? (
              <p className="text-xs text-muted-foreground">ما فيه عملاء عالقون — ممتاز.</p>
            ) : (
              <ul className="max-h-56 space-y-1.5 overflow-y-auto">
                {d.stuck.map((s, i) => <StuckRow key={i} s={s} />)}
              </ul>
            )}
          </div>
        </div>
      </Block>
    </div>
  );
}

function StuckRow({ s }: { s: StuckLead }) {
  return (
    <li className="flex items-center justify-between gap-2 rounded-lg bg-card px-2.5 py-1.5 text-xs">
      <div className="min-w-0">
        <div className="truncate font-medium text-foreground">{s.name}</div>
        <div className="text-[0.65rem] text-muted-foreground">{s.reason}</div>
      </div>
      <a href={`tel:${s.phone}`} className="shrink-0 text-gold" dir="ltr">{s.phone}</a>
    </li>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-2xl p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="h-5 w-1 rounded-full bg-gold" />
        <h3 className="font-semibold text-foreground">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Stat({ label, v, cls }: { label: string; v: number; cls: string }) {
  return (
    <div className="rounded-xl bg-secondary/50 py-3 text-center">
      <div className={`text-2xl font-bold ${cls}`}>{toArabicDigits(v)}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Info({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <div className={`text-base font-bold ${accent ?? "text-foreground"}`}>{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Compare({ label, mine, team, better }: { label: string; mine: string; team: string; better: boolean }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="mb-1 text-xs text-muted-foreground">{label}</div>
      <div className="flex items-center justify-between text-sm">
        <span className={`font-bold ${better ? "text-success" : "text-destructive"}`}>{mine} {better ? "▲" : "▼"}</span>
        <span className="text-xs text-muted-foreground">متوسط الفريق: {team}</span>
      </div>
    </div>
  );
}

function Dist({ title, items, label, color }: { title: string; items: DistItem[]; label: (k: string) => string; color: string }) {
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <div>
      <div className="mb-2 text-sm font-medium text-muted-foreground">{title}</div>
      <div className="space-y-2">
        {items.map((it) => (
          <div key={it.key} className="flex items-center gap-3">
            <span className="w-20 shrink-0 text-xs text-muted-foreground">{label(it.key)}</span>
            <div className="h-5 flex-1 overflow-hidden rounded-lg bg-secondary">
              <div className="flex h-full items-center justify-end rounded-lg px-2 text-[0.65rem] font-medium text-primary-foreground" style={{ width: `${Math.max((it.count / max) * 100, it.count > 0 ? 12 : 0)}%`, background: color }}>
                {it.count > 0 ? toArabicDigits(it.count) : ""}
              </div>
            </div>
            <span className="w-10 shrink-0 text-left text-xs text-gold">{toArabicDigits(it.pct)}٪</span>
          </div>
        ))}
      </div>
    </div>
  );
}
