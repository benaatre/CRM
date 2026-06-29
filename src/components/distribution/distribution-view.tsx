"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2, Zap, Clock, Users2, ArrowUp, ArrowDown, Plus, X,
  CheckCircle2, AlertTriangle, RefreshCw, Repeat,
} from "lucide-react";
import { toArabicDigits, formatDateTime } from "@/lib/format";
import { stageLabels } from "@/lib/labels";
import type { LeadStage } from "@prisma/client";
import {
  updateDistributionConfig, runSweepNow,
  type DistConfig, type DistEmployee,
} from "@/lib/actions/distribution";
import type { DistributionBoard } from "@/lib/data/distribution";
import { ManageEmployeeAvailability } from "@/components/availability/manage-availability";

export function DistributionView({
  config, employees, board,
}: {
  config: DistConfig;
  employees: DistEmployee[];
  board: DistributionBoard;
}) {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center gap-2">
        <Zap className="size-6 text-gold" />
        <h1 className="text-xl font-bold text-foreground">التوزيع التلقائي الذكي</h1>
      </div>
      <SettingsPanel config={config} employees={employees} />
      <MonitorPanel board={board} />
    </div>
  );
}

// ===================== لوحة الإعدادات =====================

function SettingsPanel({ config, employees }: { config: DistConfig; employees: DistEmployee[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [on, setOn] = useState(config.autoDistribute);
  const [startHour, setStartHour] = useState(config.distStartHour);
  const [endHour, setEndHour] = useState(config.distEndHour);
  const [timeout, setTimeoutMin] = useState(config.distTimeoutMin);
  const [presence, setPresence] = useState(config.distPresenceMin);
  const [initialMode, setInitialMode] = useState(config.distInitialMode);
  const [reassignMode, setReassignMode] = useState(config.distReassignMode);
  const [order, setOrder] = useState<string[]>(config.order);

  const byId = new Map(employees.map((e) => [e.id, e]));
  const participants = order.map((id) => byId.get(id)).filter(Boolean) as DistEmployee[];
  const available = employees.filter((e) => !order.includes(e.id));

  function move(idx: number, dir: -1 | 1) {
    const next = [...order];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setOrder(next);
  }
  const add = (id: string) => setOrder((o) => [...o, id]);
  const remove = (id: string) => setOrder((o) => o.filter((x) => x !== id));

  function save() {
    setMsg(null); setError(null);
    startTransition(async () => {
      const res = await updateDistributionConfig({
        autoDistribute: on, distStartHour: startHour, distEndHour: endHour,
        distTimeoutMin: timeout, distPresenceMin: presence,
        distInitialMode: initialMode, distReassignMode: reassignMode, order,
      });
      if (res.ok) { setMsg("تم حفظ إعدادات التوزيع"); router.refresh(); }
      else setError(res.error ?? "صار خطأ");
    });
  }

  return (
    <div className="glass space-y-5 rounded-2xl p-6">
      {/* المفتاح الرئيسي */}
      <label className="flex items-center justify-between rounded-xl border border-border p-4">
        <div>
          <div className="font-semibold text-foreground">تشغيل التوزيع التلقائي</div>
          <div className="text-xs text-muted-foreground">يوزّع العملاء الجدد على الموظفين ويعيد توجيه المتأخرين تلقائيًا</div>
        </div>
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} className="size-6 accent-[var(--gold)]" />
      </label>

      <div className={on ? "space-y-5" : "space-y-5 opacity-50"}>
        {/* نافذة العمل + المهلة */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumField label="بداية النافذة (ساعة)" value={startHour} onChange={setStartHour} min={0} max={23} hint={hourHint(startHour)} />
          <NumField label="نهاية النافذة (ساعة)" value={endHour} onChange={setEndHour} min={0} max={23} hint={hourHint(endHour)} />
          <NumField label="مهلة إعادة التوجيه (دقيقة)" value={timeout} onChange={setTimeoutMin} min={1} max={1440} />
          <NumField label="حد التواجد (دقيقة)" value={presence} onChange={setPresence} min={0} max={1440} hint={presence === 0 ? "بلا شرط تواجد" : undefined} />
        </div>

        {/* طريقة التوزيع الأولي */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-sm font-medium text-foreground"><Users2 className="size-4 text-gold" /> طريقة التوزيع الأولي</div>
          <div className="flex gap-2">
            <Seg active={initialMode === "ROUND_ROBIN"} onClick={() => setInitialMode("ROUND_ROBIN")} label="دوري ثابت" desc="١→٢→٣→١" />
            <Seg active={initialMode === "LEAST_LOADED"} onClick={() => setInitialMode("LEAST_LOADED")} label="الأقل عملاءً" desc="متوازن" />
          </div>
        </div>

        {/* طريقة إعادة التوجيه */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-sm font-medium text-foreground"><Repeat className="size-4 text-gold" /> طريقة إعادة التوجيه عند التقصير</div>
          <div className="flex gap-2">
            <Seg active={reassignMode === "MOST_ACTIVE"} onClick={() => setReassignMode("MOST_ACTIVE")} label="الأكثر نشاطًا اليوم" desc="أكثر متابعات" />
            <Seg active={reassignMode === "ROTATION"} onClick={() => setReassignMode("ROTATION")} label="التالي في الدور" desc="بالترتيب" />
          </div>
        </div>

        {/* الموظفون المشاركون في الدور */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-sm font-medium text-foreground"><Users2 className="size-4 text-gold" /> الموظفون المشاركون في الدور</div>
          <p className="text-xs text-muted-foreground">فقط هؤلاء يدخلون التوزيع — بالترتيب. رتّبهم بالأسهم.</p>

          <div className="space-y-2 rounded-xl border border-gold/30 bg-gold/5 p-3">
            {participants.length === 0 ? (
              <p className="py-2 text-center text-xs text-muted-foreground">ما فيه موظفون في الدور — أضف من الأسفل.</p>
            ) : participants.map((e, i) => (
              <div key={e.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gold/20 text-xs font-bold text-gold">{toArabicDigits(i + 1)}</span>
                <span className="text-sm text-foreground">{e.name}</span>
                <StatusDot active={e.active} online={e.online} />
                <ManageEmployeeAvailability employee={{ id: e.id, name: e.name, paused: e.paused, pauseReason: e.pauseReason, pauseUntil: e.pauseUntil }} />
                <span className="flex-1" />
                <button onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowUp className="size-4" /></button>
                <button onClick={() => move(i, 1)} disabled={i === participants.length - 1} className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowDown className="size-4" /></button>
                <button onClick={() => remove(e.id)} title="إزالة من الدور" className="rounded p-1 text-destructive hover:bg-destructive/10"><X className="size-4" /></button>
              </div>
            ))}
          </div>

          {available.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {available.map((e) => (
                <button key={e.id} onClick={() => add(e.id)} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-gold hover:text-gold">
                  <Plus className="size-3.5" /> {e.name}
                  <StatusDot active={e.active} online={e.online} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {msg && <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">{msg}</p>}

      <button onClick={save} disabled={pending} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
        {pending ? "جارٍ الحفظ…" : "حفظ إعدادات التوزيع"}
      </button>
    </div>
  );
}

// ===================== لوحة المراقبة =====================

function MonitorPanel({ board }: { board: DistributionBoard }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function sweep() {
    setMsg(null);
    startTransition(async () => {
      const res = await runSweepNow();
      setMsg(res.ok ? res.message ?? "تم الفحص" : res.error ?? "صار خطأ");
      router.refresh();
    });
  }

  const { stats } = board;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold text-foreground"><Clock className="size-5 text-gold" /> مراقبة توزيع اليوم</h2>
        <button onClick={sweep} disabled={pending} className="flex items-center gap-2 rounded-xl border border-gold/40 px-4 py-2 text-sm font-semibold text-gold hover:bg-gold/10 disabled:opacity-50">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} افحص الآن
        </button>
      </div>
      {msg && <p className="rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">{msg}</p>}

      {/* بطاقات الإحصاء */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="موزّع اليوم" value={stats.total} />
        <StatCard label="تم التواصل" value={stats.contacted} tone="success" />
        <StatCard label="بانتظار التواصل" value={stats.pending} tone="warning" />
        <StatCard label="أُعيد توجيهه" value={stats.reassigned} tone="info" />
      </div>

      {/* عملاء اليوم */}
      <div className="glass overflow-hidden rounded-2xl">
        <div className="border-b border-border px-4 py-3 text-sm font-medium text-foreground">عملاء اليوم الموزّعون</div>
        {board.todayLeads.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">ما تم توزيع عملاء تلقائيًا اليوم بعد.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-secondary/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">العميل</th>
                  <th className="px-4 py-2.5 font-medium">الموظف الحالي</th>
                  <th className="px-4 py-2.5 font-medium">وقت الإسناد</th>
                  <th className="px-4 py-2.5 font-medium">الحالة</th>
                  <th className="px-4 py-2.5 font-medium">مرات التوجيه</th>
                  <th className="px-4 py-2.5 font-medium">المرحلة</th>
                </tr>
              </thead>
              <tbody>
                {board.todayLeads.map((l) => (
                  <tr key={l.id} className="border-t border-border">
                    <td className="px-4 py-2.5 text-foreground">{l.name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{l.employeeName ?? "—"}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{l.assignedAt ? formatDateTime(l.assignedAt) : "—"}</td>
                    <td className="px-4 py-2.5">
                      {l.contacted ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs text-success"><CheckCircle2 className="size-3.5" /> تواصَل</span>
                      ) : l.overdue ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-xs text-destructive"><AlertTriangle className="size-3.5" /> متأخّر</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs text-warning"><Clock className="size-3.5" /> ينتظر</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{toArabicDigits(l.reassignCount)}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{stageLabels[l.stage as LeadStage] ?? l.stage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* سجل إعادات التوجيه */}
      <div className="glass overflow-hidden rounded-2xl">
        <div className="border-b border-border px-4 py-3 text-sm font-medium text-foreground">سجل إعادات التوجيه اليوم</div>
        {board.log.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">ما فيه إعادات توجيه اليوم.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-secondary/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">العميل</th>
                  <th className="px-4 py-2.5 font-medium">من</th>
                  <th className="px-4 py-2.5 font-medium">إلى</th>
                  <th className="px-4 py-2.5 font-medium">السبب</th>
                  <th className="px-4 py-2.5 font-medium">الوقت</th>
                </tr>
              </thead>
              <tbody>
                {board.log.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-4 py-2.5 text-foreground">{r.leadName}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{r.fromName ?? "—"}</td>
                    <td className="px-4 py-2.5 text-foreground">{r.toName ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${r.reason === "initial" ? "bg-info/15 text-info" : "bg-warning/15 text-warning"}`}>
                        {r.reason === "initial" ? "إسناد أولي" : "تأخّر تواصل"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{formatDateTime(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ===================== عناصر مساعدة =====================

function hourHint(h: number): string {
  const x = ((h % 24) + 24) % 24;
  if (x === 0) return "منتصف الليل";
  if (x === 12) return "ظهرًا";
  const period = x < 12 ? "صباحًا" : "مساءً";
  const h12 = x % 12 === 0 ? 12 : x % 12;
  return `${toArabicDigits(h12)} ${period}`;
}

function NumField({ label, value, onChange, min, max, hint }: {
  label: string; value: number; onChange: (n: number) => void; min: number; max: number; hint?: string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        type="number" dir="ltr" value={value} min={min} max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="select-base w-full"
      />
      {hint && <span className="block text-[0.7rem] text-gold/80">{hint}</span>}
    </label>
  );
}

function Seg({ active, onClick, label, desc }: { active: boolean; onClick: () => void; label: string; desc: string }) {
  return (
    <button type="button" onClick={onClick} className={`flex-1 rounded-xl border px-3 py-2.5 text-right transition-colors ${active ? "border-gold bg-gold/15" : "border-border hover:border-gold/40"}`}>
      <div className={`text-sm font-medium ${active ? "text-gold" : "text-foreground"}`}>{label}</div>
      <div className="text-xs text-muted-foreground">{desc}</div>
    </button>
  );
}

function StatusDot({ active, online }: { active: boolean; online: boolean }) {
  if (!active) return <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[0.65rem] text-muted-foreground">موقوف</span>;
  return <span className={`size-2 shrink-0 rounded-full ${online ? "bg-success" : "bg-muted-foreground/40"}`} title={online ? "متصل الآن" : "غير متصل"} />;
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: "success" | "warning" | "info" }) {
  const color = tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : tone === "info" ? "text-info" : "text-gold";
  return (
    <div className="glass rounded-2xl p-4">
      <div className={`text-2xl font-bold ${color}`}>{toArabicDigits(value)}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
