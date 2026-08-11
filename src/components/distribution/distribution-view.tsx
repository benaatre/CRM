"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Loader2, Zap, Clock, Users2, ArrowUp, ArrowDown, Plus, X,
  CheckCircle2, AlertTriangle, RefreshCw, Repeat, Power,
  ShieldCheck, CalendarClock, Hand, UserCheck, Layers,
} from "lucide-react";
import { toArabicDigits, formatDateTime, toRiyadhInputValue } from "@/lib/format";
import { parseRiyadhLocal } from "@/lib/ksa-time";
import { isInitialReason, INITIAL_FRESH } from "@/lib/transfer-mode";
import { stageLabels } from "@/lib/labels";
import type { LeadStage } from "@prisma/client";
import {
  updateDistributionConfig, runSweepNow, updateDailyAssignCaps, setAutoDistribute,
  updateAutoPilotConfig,
  approveSweepPull, dismissSweepCandidate, dismissAllSweepCandidates,
  updateSweepCutoff, protectAllCurrentFromSweep,
  type DistConfig, type DistEmployee, type LastCron, type SweepCandidateRow,
} from "@/lib/actions/distribution";
import type { DistributionBoard } from "@/lib/data/distribution";
import { ManageEmployeeAvailability } from "@/components/availability/manage-availability";
import { Clip } from "@/components/ui/clip";

export function DistributionView({
  config, employees, board, lastCron, isOwner, sweepCutoffAt, candidates,
}: {
  config: DistConfig;
  employees: DistEmployee[];
  board: DistributionBoard;
  lastCron: LastCron;
  isOwner: boolean;
  sweepCutoffAt: Date;
  candidates: SweepCandidateRow[];
}) {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center gap-2">
        <Zap className="size-6 text-gold" />
        <h1 className="text-xl font-bold text-foreground">التوزيع التلقائي الذكي</h1>
      </div>
      {/* قسمان بترتيب المالك: «التوزيع» ثم «السحب التلقائي»، وتحتهما أدوات المالك والمراقبة */}
      <SettingsPanel config={config} employees={employees} />
      {isOwner && <AutoPilotPanel config={config} />}
      {isOwner && !config.autoSweepEnabled && <CandidatesPanel candidates={candidates} />}
      {isOwner && <SweepCutoffPanel sweepCutoffAt={sweepCutoffAt} />}
      <MonitorPanel board={board} lastCron={lastCron} />
    </div>
  );
}

// ===================== قاعدة ٥: مرشّحو السحب (موافقة المالك) =====================

function CandidatesPanel({ candidates }: { candidates: SweepCandidateRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function act(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, id?: string) {
    setMsg(null); setBusyId(id ?? "all");
    startTransition(async () => {
      const res = await fn();
      setMsg(res.ok ? res.message ?? "تم" : res.error ?? "صار خطأ");
      setBusyId(null);
      router.refresh();
    });
  }

  return (
    <div className="glass space-y-4 rounded-2xl border border-gold/30 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-semibold text-foreground">
          <Hand className="size-4 text-gold" /> مرشّحون للسحب — بانتظار قرارك
          <span className="rounded-full bg-gold/15 px-2 py-0.5 text-xs font-bold text-gold">{toArabicDigits(candidates.length)}</span>
        </div>
        {candidates.length > 0 && (
          <button
            onClick={() => act(() => dismissAllSweepCandidates())}
            disabled={pending}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-foreground hover:text-foreground disabled:opacity-50"
          >
            {busyId === "all" ? "…" : "اترك الكل عند موظفيهم"}
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        الـsweep يقترح فقط ولا ينقل أحدًا تلقائيًا. «اسحب» تنقله لموظف آخر، و«اترك عنده» تمنحه حصانة دائمة فلا يُرشَّح ثانية.
      </p>

      {msg && <p className="rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">{msg}</p>}

      {candidates.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          ما فيه مرشّحون للسحب الآن. 👌
        </p>
      ) : (
        <div className="scroll-x">
          <table className="crm-table min-w-[880px] text-sm">
            <thead className="bg-secondary/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 font-medium">العميل</th>
                <th className="px-3 py-2.5 font-medium">الموظف الحالي</th>
                <th className="w-[9rem] px-3 py-2.5 font-medium">وقت الإسناد</th>
                <th className="w-[9rem] px-3 py-2.5 font-medium">آخر نشاط</th>
                <th className="w-[9rem] px-3 py-2.5 font-medium">السبب</th>
                <th className="w-[13rem] px-3 py-2.5 font-medium">القرار</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="px-3 py-2.5 text-foreground"><Clip title={c.leadName}>{c.leadName}</Clip></td>
                  <td className="px-3 py-2.5 text-muted-foreground"><Clip title={c.fromName ?? undefined}>{c.fromName ?? "—"}</Clip></td>
                  <td className="cell-keep px-3 py-2.5 text-muted-foreground">{c.assignedAt ? formatDateTime(c.assignedAt) : "—"}</td>
                  <td className="cell-keep px-3 py-2.5 text-muted-foreground">{c.lastActivityAt ? formatDateTime(c.lastActivityAt) : "—"}</td>
                  <td className="cell-keep px-3 py-2.5">
                    <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs text-warning">
                      تأخّر تواصل{c.timeoutMin ? ` (${toArabicDigits(Math.round(c.timeoutMin / 60))}س)` : ""}
                    </span>
                  </td>
                  <td className="cell-keep px-3 py-2.5">
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => act(() => approveSweepPull(c.id), c.id)}
                        disabled={pending}
                        className="flex items-center gap-1 rounded-lg bg-destructive/15 px-2.5 py-1 text-xs font-semibold text-destructive hover:bg-destructive/25 disabled:opacity-50"
                      >
                        {busyId === c.id ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} اسحب
                      </button>
                      <button
                        onClick={() => act(() => dismissSweepCandidate(c.id), c.id)}
                        disabled={pending}
                        className="flex items-center gap-1 rounded-lg bg-success/15 px-2.5 py-1 text-xs font-semibold text-success hover:bg-success/25 disabled:opacity-50"
                      >
                        <UserCheck className="size-3.5" /> اتركه عنده
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ===================== «الحزمة ب»: إعدادات الأتمتة — المالك فقط =====================

function AutoPilotPanel({ config }: { config: DistConfig }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sweepOn, setSweepOn] = useState(config.autoSweepEnabled);
  const [timeoutMin, setTimeoutMin] = useState(config.distTimeoutMin);
  const [warnMin, setWarnMin] = useState(config.sweepWarnMin);
  const [sweepStart, setSweepStart] = useState(config.sweepStartHour);
  const [sweepEnd, setSweepEnd] = useState(config.sweepEndHour);
  const [pullMode, setPullMode] = useState<DistConfig["distReassignMode"]>(config.distReassignMode);

  function save() {
    setMsg(null); setError(null);
    startTransition(async () => {
      const res = await updateAutoPilotConfig({
        autoSweepEnabled: sweepOn, distTimeoutMin: timeoutMin,
        sweepWarnMin: warnMin, sweepStartHour: sweepStart, sweepEndHour: sweepEnd, distReassignMode: pullMode,
      });
      if (res.ok) { setMsg(res.message ?? "تم"); router.refresh(); }
      else setError(res.error ?? "صار خطأ");
    });
  }

  return (
    <div className="glass space-y-3 rounded-2xl border border-gold/30 p-6">
      <div className="flex items-center gap-1.5 text-base font-bold text-foreground">
        <Repeat className="size-5 text-gold" /> السحب التلقائي
      </div>

      {/* مفتاح التشغيل وحالته — بارزان أعلى القسم بأخضر/أحمر نظام الألوان */}
      <label className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border-2 px-4 py-3 transition-colors ${sweepOn ? "border-green-400/60 bg-green-500/10" : "border-red-500/40 bg-red-500/5"}`}>
        <div className="flex items-center gap-2.5">
          <Power className={`size-5 shrink-0 ${sweepOn ? "text-green-300" : "text-red-300"}`} />
          <div>
            <div className="font-bold text-foreground">
              السحب التلقائي للمتأخر: <span className={sweepOn ? "text-green-300" : "text-red-300"}>{sweepOn ? "شغال" : "متوقف"}</span>
            </div>
            <p className="text-[0.7rem] leading-5 text-muted-foreground">
              شغال: المتأخر يُنذَر ثم يُسحب ويُعاد توزيعه آليًا (بالحصانات كلها — والموزّع يدويًا منك ما يُسحب أبدًا) · متوقف: اقتراح بانتظار موافقتك.
            </p>
          </div>
        </div>
        <input type="checkbox" checked={sweepOn} onChange={(e) => setSweepOn(e.target.checked)} className="size-6 shrink-0 accent-[var(--gold)]" />
      </label>

      {/* الحقول بصف مضغوط بالتسلسل الزمني للدورة: المهلة ← الإنذار ← نافذة السحب (زوج متجاور) —
          الشبكة تمدّ البطاقات (stretch) وكلها ببنية أسطر محجوزة فتتساوى ارتفاعًا وإطارًا */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <NumField label="مهلة البقاء (دقيقة)" desc="بلا أي تواصل قبل بدء مسار السحب"
          value={timeoutMin} onChange={setTimeoutMin} min={1} max={10080}
          hint={timeoutMin < 60 ? `${toArabicDigits(timeoutMin)} دقيقة` : `≈ ${toArabicDigits(Math.round((timeoutMin / 60) * 10) / 10)} ساعة`} />
        <NumField label="إنذار قبل السحب (دقيقة)" desc="إشعار للموظف + وميض أحمر بقائمته"
          value={warnMin} onChange={setWarnMin} min={1} max={120} hint={`«بينتقل منك خلال ${toArabicDigits(warnMin)} دقايق»`} />
        <HourPairField label="نافذة السحب" desc="السحب يشتغل داخل هذي الساعات فقط (بتوقيت الرياض)"
          start={sweepStart} end={sweepEnd} onStart={setSweepStart} onEnd={setSweepEnd} />
      </div>
      {sweepOn && timeoutMin < 60 && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">أرضية الأمان مع السحب التلقائي: ٦٠ دقيقة على الأقل.</p>
      )}
      {warnMin >= timeoutMin && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">الإنذار لازم يكون أقصر من المهلة نفسها.</p>
      )}

      {/* طريقة إعادة توزيع المسحوب — مباشرة تحت الحقول */}
      <div className="space-y-1.5">
        <div className="text-sm font-medium text-foreground">طريقة إعادة توزيع المسحوب</div>
        <p className="text-[0.7rem] text-muted-foreground">يُسند فورًا لموظف آخر بهذي الطريقة — ودائمًا باستثناء الموظف المسحوب منه.</p>
        <div className="flex flex-wrap gap-2">
          <Seg active={pullMode === "ROTATION"} onClick={() => setPullMode("ROTATION")} label="بالترتيب" desc="التالي في الدور (الافتراضي)" />
          <Seg active={pullMode === "LEAST_LOADED"} onClick={() => setPullMode("LEAST_LOADED")} label="الأقل حملًا" desc="من عنده عملاء أقل" />
          <Seg active={pullMode === "MOST_ACTIVE"} onClick={() => setPullMode("MOST_ACTIVE")} label="الأكثر نشاطًا اليوم" desc="من سجّل متابعات أكثر" />
        </div>
      </div>

      {/*
        مفتاح «إعادة توزيع مسحوبي لم يتم الرد» انتقل لصفحته: دورته دورة التصعيد
        بالأيام لا دورة الدقائق للمتأخرين الجدد، وخلطهما بلوحة واحدة كان يربك.
      */}
      <Link href="/no-response" className="block text-xs text-muted-foreground transition-colors hover:text-gold">
        إعدادات سحب عدم الرد بصفحتها ←
      </Link>

      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {msg && <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">{msg}</p>}
      <button onClick={save} disabled={pending} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
        {pending ? "جارٍ الحفظ…" : "حفظ إعدادات السحب التلقائي"}
      </button>
    </div>
  );
}

// ===================== قاعدة ٣: الحاجز التاريخي للسحب — المالك فقط =====================

function SweepCutoffPanel({ sweepCutoffAt }: { sweepCutoffAt: Date }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [local, setLocal] = useState<string>(toLocalInput(sweepCutoffAt));

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setMsg(null);
    startTransition(async () => {
      const res = await fn();
      setMsg(res.ok ? res.message ?? "تم" : res.error ?? "صار خطأ");
      router.refresh();
    });
  }

  return (
    <div className="glass space-y-4 rounded-2xl p-6">
      <div className="flex items-center gap-1.5 font-semibold text-foreground">
        <CalendarClock className="size-4 text-gold" /> الحاجز التاريخي للسحب
      </div>
      <p className="text-xs text-muted-foreground">
        الـsweep يتجاهل أي عميل أُسند <b>قبل</b> هذا التاريخ — يعني كل العملاء الحاليين محميّون، والسحب يشتغل فقط على ما بعده.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block space-y-1.5">
          <span className="text-xs text-muted-foreground">التوزيع التلقائي يبدأ من تاريخ</span>
          <input
            type="datetime-local" dir="ltr" value={local}
            onChange={(e) => setLocal(e.target.value)}
            className="select-base"
          />
        </label>
        <button
          onClick={() => run(() => updateSweepCutoff(parseRiyadhLocal(local).toISOString()))}
          disabled={pending || !local}
          className="rounded-xl border border-gold/40 px-4 py-2 text-sm font-semibold text-gold hover:bg-gold/10 disabled:opacity-50"
        >
          حفظ التاريخ
        </button>
        <button
          onClick={() => run(() => protectAllCurrentFromSweep())}
          disabled={pending}
          className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          <ShieldCheck className="size-4" /> حماية كل العملاء الحاليين
        </button>
      </div>
      <div className="text-xs text-muted-foreground">
        الحاجز الحالي: <b className="text-foreground">{formatDateTime(sweepCutoffAt)}</b>
      </div>
      {msg && <p className="rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}

/** Date → قيمة input[type=datetime-local] بوقت حائط الرياض (نفس تفسير الحفظ). */
const toLocalInput = toRiyadhInputValue;

// (حُذفت بطاقة «مفاتيح دورة الكرون» — كانت أداة تشخيص مؤقتة لسويتشات env؛ بطاقة «آخر دورة
//  كرون» وسطر ترخيص فال انتقلا للوحة المراقبة أدناه.)

// ===================== لوحة الإعدادات =====================

function SettingsPanel({ config, employees }: { config: DistConfig; employees: DistEmployee[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // المفتاح الرئيسي يُحفظ فورًا (setAutoDistribute) — القيمة من الخادم مباشرة لا من state محلي.
  const on = config.autoDistribute;
  const [togglePending, setTogglePending] = useState(false);
  const [startHour, setStartHour] = useState(config.distStartHour);
  const [endHour, setEndHour] = useState(config.distEndHour);
  const [presence, setPresence] = useState(config.distPresenceMin);
  const [initialMode, setInitialMode] = useState(config.distInitialMode);
  const [order, setOrder] = useState<string[]>(config.order);
  // حوكمة الدفعات والسقوف (٠ = بلا سقف/الكل)
  const [receiveGap, setReceiveGap] = useState(config.distReceiveGapMin);
  const [batchSize, setBatchSize] = useState(config.distBatchSize ?? 0);
  const [perWindow, setPerWindow] = useState(config.distPerEmployeePerWindow ?? 0);
  const [windowMin, setWindowMin] = useState(config.distWindowMin);
  // السقف اليومي لكل موظف (تحرير محلي ثم حفظ)
  const [caps, setCaps] = useState<Record<string, number>>(
    Object.fromEntries(employees.map((e) => [e.id, e.dailyAssignCap ?? 0])),
  );

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
        autoDistribute: on,
        autoSweepEnabled: config.autoSweepEnabled,
        sweepWarnMin: config.sweepWarnMin, sweepStartHour: config.sweepStartHour, sweepEndHour: config.sweepEndHour,
        distReceiveGapMin: receiveGap,
        distStartHour: startHour, distEndHour: endHour,
        // المهلة وطريقة إعادة توزيع المسحوب صارتا بقسم «السحب التلقائي» — تمريرهما كما هما.
        distTimeoutMin: config.distTimeoutMin, distPresenceMin: presence,
        distInitialMode: initialMode, distReassignMode: config.distReassignMode, order,
        distBatchSize: batchSize > 0 ? batchSize : null,
        distPerEmployeePerWindow: perWindow > 0 ? perWindow : null,
        distWindowMin: windowMin,
      });
      if (res.ok) {
        // السقوف اليومية تخص جدول User لا Settings — تُحفظ بإجراء منفصل.
        const changed = employees
          .filter((e) => (caps[e.id] ?? 0) !== (e.dailyAssignCap ?? 0))
          .map((e) => ({ userId: e.id, cap: (caps[e.id] ?? 0) > 0 ? caps[e.id] : null }));
        if (changed.length > 0) await updateDailyAssignCaps(changed);
        setMsg("تم حفظ إعدادات التوزيع");
        router.refresh();
      } else setError(res.error ?? "صار خطأ");
    });
  }

  // المفتاح الرئيسي: حفظ فوري + تحديث من الخادم.
  function toggleMaster() {
    setError(null); setMsg(null); setTogglePending(true);
    startTransition(async () => {
      const res = await setAutoDistribute(!on);
      if (!res.ok) setError(res.error ?? "صار خطأ");
      else setMsg(res.message ?? "تم");
      setTogglePending(false);
      router.refresh();
    });
  }

  // ملخّص الإعدادات الفعّالة (مقروء تحت المفتاح مباشرة) — نفس القيم القابلة للتعديل أدناه.
  const cappedCount = employees.filter((e) => (e.dailyAssignCap ?? 0) > 0).length;
  const summary: { label: string; value: string }[] = [
    { label: "كمية الدفعة", value: (config.distBatchSize ?? 0) > 0 ? `${toArabicDigits(config.distBatchSize!)} عميل/دورة` : "الكل دفعة واحدة" },
    { label: "الفاصل الزمني", value: `كل ${toArabicDigits(config.distWindowMin)} دقيقة${(config.distPerEmployeePerWindow ?? 0) > 0 ? ` — بحد ${toArabicDigits(config.distPerEmployeePerWindow!)} للموظف` : ""}` },
    { label: "نافذة العمل", value: config.distStartHour === config.distEndHour ? "على مدار اليوم" : `${hourHint(config.distStartHour)} → ${hourHint(config.distEndHour)}` },
    { label: "السقف اليومي", value: cappedCount > 0 ? `مضبوط لـ${toArabicDigits(cappedCount)} موظف (بجدول الدور)` : "بلا سقف يومي" },
  ];

  return (
    <div className="glass space-y-5 rounded-2xl p-6">
      <div className="flex items-center gap-1.5 text-base font-bold text-foreground">
        <Users2 className="size-5 text-gold" /> التوزيع
      </div>
      {/* المفتاح الرئيسي — كبير وواضح، حفظ فوري، والإعدادات الفعّالة تحته مباشرة */}
      <div className={`space-y-4 rounded-2xl border-2 p-5 transition-colors ${on ? "border-green-400/60 bg-green-500/10" : "border-red-500/40 bg-red-500/5"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Power className={`size-7 ${on ? "text-green-300" : "text-red-300"}`} />
            <div>
              <div className="text-lg font-bold text-foreground">
                التوزيع التلقائي: <span className={on ? "text-green-300" : "text-red-300"}>{on ? "شغال" : "متوقف"}</span>
              </div>
              <div className="text-xs text-muted-foreground">يوزّع العملاء الجدد على الموظفين حسب الإعدادات أدناه</div>
            </div>
          </div>
          <button
            onClick={toggleMaster}
            disabled={togglePending}
            aria-pressed={on}
            className={`min-h-11 rounded-xl border px-6 py-2.5 text-sm font-bold transition-colors disabled:opacity-50 ${on
              ? "border-red-500/40 text-red-300 hover:bg-red-500/15"
              : "border-green-400/60 bg-green-500/25 text-green-200 hover:bg-green-500/30"}`}
          >
            {togglePending ? "لحظة…" : on ? "أوقفه" : "شغّله الآن"}
          </button>
        </div>
        {/* الإعدادات الفعّالة — مقروءة بلمحة، وتعديلها من الحقول بالأسفل مباشرة */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {summary.map((s) => (
            <div key={s.label} className="rounded-xl border border-border bg-card/60 px-3 py-2">
              <div className="text-[11px] text-muted-foreground">{s.label}</div>
              <div className="text-sm font-medium text-foreground">{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className={on ? "space-y-5" : "space-y-5 opacity-50"}>
        {/* فاصل الاستقبال + التواجد + نافذة العمل (زوج متجاور) — نفس شبكة قسم السحب حرفيًا */}
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <NumField label="فاصل الاستقبال (دقيقة)" desc="عميل واحد آليًا لكل موظف كل هذي الدقائق" value={receiveGap} onChange={setReceiveGap} min={0} max={1440} hint={receiveGap === 0 ? "بلا فاصل" : `عميل كل ${toArabicDigits(receiveGap)} دقيقة`} />
          <NumField label="حد التواجد (دقيقة)" desc="من ما فتح النظام خلالها يُتخطّى بالدور" value={presence} onChange={setPresence} min={0} max={1440} hint={presence === 0 ? "بلا شرط تواجد" : undefined} />
          <HourPairField label="نافذة العمل" desc="التوزيع يشتغل داخل هذي الساعات فقط (بتوقيت الرياض)"
            start={startHour} end={endHour} onStart={setStartHour} onEnd={setEndHour} />
        </div>

        {/* حوكمة الدفعات والسقوف — تمنع رمي كل غير الموزّعين دفعة واحدة */}
        <div className="space-y-2 rounded-xl border border-gold/25 bg-gold/5 p-3">
          <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <Layers className="size-4 text-gold" /> حوكمة الدفعات والسقوف
          </div>
          <p className="text-xs text-muted-foreground">
            صفر = بلا حد. حجم الدفعة يحدّد كم عميلًا يُوزَّع في الدورة الواحدة، والسقف يحدّ ما يستقبله الموظف داخل النافذة.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <NumField label="حجم الدفعة (عميل/دورة)" value={batchSize} onChange={setBatchSize} min={0} max={500}
              hint={batchSize === 0 ? "الكل دفعة واحدة" : `${toArabicDigits(batchSize)} في الدورة`} />
            <NumField label="سقف الموظف في النافذة" value={perWindow} onChange={setPerWindow} min={0} max={100}
              hint={perWindow === 0 ? "بلا سقف" : `${toArabicDigits(perWindow)} كحد أقصى`} />
            <NumField label="طول النافذة (دقيقة)" value={windowMin} onChange={setWindowMin} min={1} max={1440}
              hint={`≈ ${toArabicDigits(Math.round(windowMin / 60 * 10) / 10)} ساعة`} />
          </div>
        </div>

        {/* طريقة التوزيع — ثلاث طرق */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-sm font-medium text-foreground"><Users2 className="size-4 text-gold" /> طريقة التوزيع</div>
          <p className="text-xs text-muted-foreground">كيف يختار النظام الموظف المستلم للعميل الجديد.</p>
          <div className="flex flex-wrap gap-2">
            <Seg active={initialMode === "ROUND_ROBIN"} onClick={() => setInitialMode("ROUND_ROBIN")} label="بالترتيب" desc="١→٢→٣→١ (دوري ثابت)" />
            <Seg active={initialMode === "LEAST_LOADED"} onClick={() => setInitialMode("LEAST_LOADED")} label="الأقل حملًا" desc="من عنده عملاء أقل" />
            <Seg active={initialMode === "MOST_ACTIVE"} onClick={() => setInitialMode("MOST_ACTIVE")} label="الأكثر نشاطًا اليوم" desc="من سجّل متابعات أكثر" />
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
                {/* السقف اليومي — قابل للتحرير مباشرة (٠ = بلا سقف) */}
                <label className="flex items-center gap-1 text-[11px] text-muted-foreground" title="سقف ما يستقبله في اليوم الواحد (٠ = بلا سقف)">
                  سقف/يوم
                  <input
                    type="number" min={0} max={200}
                    value={caps[e.id] ?? 0}
                    onChange={(ev) => setCaps((c) => ({ ...c, [e.id]: Math.max(0, Number(ev.target.value) || 0) }))}
                    className="w-14 rounded-lg border border-border bg-background px-1.5 py-1 text-center text-xs text-foreground outline-none focus:border-gold"
                  />
                </label>
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

function MonitorPanel({ board, lastCron }: { board: DistributionBoard; lastCron: LastCron }) {
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

      {/* آخر دورة كرون (انتقلت من بطاقة المفاتيح المحذوفة) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border bg-card px-4 py-2.5 text-sm">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Clock className="size-3.5 text-gold" /> آخر دورة كرون:</span>
        {lastCron.at ? (
          <>
            <span className="text-foreground">{formatDateTime(lastCron.at)}</span>
            <span className="text-muted-foreground">وزّع <b className="text-gold">{toArabicDigits(lastCron.distributed)}</b></span>
            <span className="text-muted-foreground">سحب <b className="text-gold">{toArabicDigits(lastCron.reassigned)}</b></span>
          </>
        ) : (
          <span className="text-muted-foreground">ما فيه دورة مسجّلة بعد.</span>
        )}
      </div>

      {/* بطاقات الإحصاء — «موزّع اليوم» مقسوم: تلقائي (البركة) بارز · يدوي رمادي */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="تلقائي اليوم" value={stats.auto} tone="gold" hint="من بركة التوزيع التلقائي" />
        <StatCard label="يدوي اليوم" value={stats.manual} tone="muted" hint="أسنده مدير بيده — خارج البركة" />
        <StatCard label="تم التواصل" value={stats.contacted} tone="success" />
        <StatCard label="بانتظار التواصل" value={stats.pending} tone="warning" />
        <StatCard label="أُعيد توجيهه" value={stats.reassigned} tone="info" />
      </div>

      {/* حجم البركة نفسها */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gold/25 bg-gold/5 px-4 py-2.5 text-sm">
        <Layers className="size-4 shrink-0 text-gold" />
        <span className="text-muted-foreground">بركة التوزيع التلقائي:</span>
        <span className="font-bold text-gold">{toArabicDigits(board.pool.total)}</span>
        <span className="text-muted-foreground">عميلًا — منهم</span>
        <span className="font-bold text-foreground">{toArabicDigits(board.pool.unassigned)}</span>
        <span className="text-muted-foreground">بانتظار التوزيع</span>
      </div>

      {/* عملاء اليوم */}
      <div className="glass overflow-hidden rounded-2xl">
        <div className="border-b border-border px-4 py-3 text-sm font-medium text-foreground">عملاء اليوم الموزّعون</div>
        {board.todayLeads.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">ما تم توزيع عملاء تلقائيًا اليوم بعد.</p>
        ) : (
          <div className="scroll-x">
            <table className="crm-table min-w-[860px] text-sm">
              <thead className="bg-secondary/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">العميل</th>
                  <th className="px-4 py-2.5 font-medium">الموظف الحالي</th>
                  <th className="w-[9rem] px-4 py-2.5 font-medium">وقت الإسناد</th>
                  <th className="w-[7.5rem] px-4 py-2.5 font-medium">الحالة</th>
                  <th className="w-[6.5rem] px-4 py-2.5 font-medium">مرات التوجيه</th>
                  <th className="w-[8rem] px-4 py-2.5 font-medium">المرحلة</th>
                </tr>
              </thead>
              <tbody>
                {board.todayLeads.map((l) => (
                  <tr key={l.id} className="border-t border-border">
                    <td className="px-4 py-2.5 text-foreground">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="min-w-0 max-w-full truncate" title={l.name}>{l.name}</span>
                        {l.inAutoPool ? (
                          <span className="cell-keep rounded-full border border-gold/40 bg-gold/10 px-1.5 py-0.5 text-[10px] font-bold text-gold" title="من بركة التوزيع التلقائي">تلقائي</span>
                        ) : (
                          <span className="cell-keep rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground" title="إسناد يدوي — خارج البركة">يدوي</span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground"><Clip title={l.employeeName ?? undefined}>{l.employeeName ?? "—"}</Clip></td>
                    <td className="cell-keep px-4 py-2.5 text-muted-foreground">{l.assignedAt ? formatDateTime(l.assignedAt) : "—"}</td>
                    <td className="cell-keep px-4 py-2.5">
                      {l.contacted ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs text-success"><CheckCircle2 className="size-3.5" /> تواصَل</span>
                      ) : l.overdue ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-xs text-destructive"><AlertTriangle className="size-3.5" /> متأخّر</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs text-warning"><Clock className="size-3.5" /> ينتظر</span>
                      )}
                    </td>
                    <td className="cell-keep px-4 py-2.5 text-muted-foreground">{toArabicDigits(l.reassignCount)}</td>
                    <td className="px-4 py-2.5 text-muted-foreground"><Clip>{stageLabels[l.stage as LeadStage] ?? l.stage}</Clip></td>
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
          <div className="scroll-x">
            <table className="crm-table min-w-[760px] text-sm">
              <thead className="bg-secondary/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">العميل</th>
                  <th className="px-4 py-2.5 font-medium">من</th>
                  <th className="px-4 py-2.5 font-medium">إلى</th>
                  <th className="w-[10rem] px-4 py-2.5 font-medium">السبب</th>
                  <th className="w-[9rem] px-4 py-2.5 font-medium">الوقت</th>
                </tr>
              </thead>
              <tbody>
                {board.log.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-4 py-2.5 text-foreground"><Clip title={r.leadName}>{r.leadName}</Clip></td>
                    <td className="px-4 py-2.5 text-muted-foreground"><Clip title={r.fromName ?? undefined}>{r.fromName ?? "—"}</Clip></td>
                    <td className="px-4 py-2.5 text-foreground"><Clip title={r.toName ?? undefined}>{r.toName ?? "—"}</Clip></td>
                    <td className="cell-keep px-4 py-2.5">
                      <LogReasonChip reason={r.reason} />
                    </td>
                    <td className="cell-keep px-4 py-2.5 text-muted-foreground">{formatDateTime(r.createdAt)}</td>
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

/**
 * شارة سبب سجل إعادات التوجيه — الصفحة للمالك/المدير حصرًا فالتسميات الفنية («تلقائي/سحب»)
 * مسموحة هنا (قاعدة العرض: الموظف لا يرى هذه المصطلحات أبدًا في شاشاته).
 */
function LogReasonChip({ reason }: { reason: string }) {
  // عائلة الإسناد الأولي: initial و initial_fresh (الأخير لمسترد بتاريخ سابق).
  if (isInitialReason(reason)) {
    return <span className="rounded-full bg-info/15 px-2 py-0.5 text-xs text-info">{reason === INITIAL_FRESH ? "إسناد أولي (كجديد)" : "إسناد أولي"}</span>;
  }
  const auto: Record<string, string> = {
    timeout_auto: "سحب تلقائي (مهلة)",
    auto_redistribute_fresh: "إعادة توزيع تلقائي (كجديد)",
    no_response_neglect: "سحب تلقائي (عدم رد — تقصير)",
    no_response_exhausted: "سحب تلقائي (عدم رد — استنفاد)",
  };
  if (auto[reason]) {
    return <span className="rounded-full bg-orange-500/15 px-2 py-0.5 text-xs text-orange-300">{auto[reason]}</span>;
  }
  if (reason === "to_auto_pool") {
    return <span className="rounded-full bg-gold/15 px-2 py-0.5 text-xs text-gold">تحويل للبركة</span>;
  }
  if (reason.startsWith("manual")) {
    return <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">{reason.endsWith("_fresh") ? "يدوي (كجديد)" : "يدوي"}</span>;
  }
  return <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs text-warning">تأخّر تواصل</span>;
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

/**
 * حقل رقمي ببطاقة موحّدة البنية: تسمية (سطر مقصوص) → حقل → وصف (سطر محجوز مقصوص) →
 * تلميح (سطر محجوز). الحجز الثابت للسطور — حتى الفارغة — هو ما يضمن تساوي ارتفاع
 * كل بطاقات الشبكة وإطاراتها مهما تفاوتت أطوال النصوص (سبب التفاوت السابق).
 */
function NumField({ label, desc, value, onChange, min, max, hint }: {
  label: string; desc?: string; value: number; onChange: (n: number) => void; min: number; max: number; hint?: string;
}) {
  return (
    <label className="flex h-full flex-col rounded-lg border border-border/60 bg-card/40 p-2">
      <span className="truncate text-xs font-medium leading-4 text-foreground" title={label}>{label}</span>
      <input
        type="number" dir="ltr" value={value} min={min} max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="select-base mt-1 w-full"
      />
      {/* وصف سطر واحد يشرح أثر الإعداد — محجوز الارتفاع حتى لو غاب. */}
      <span className="mt-1 min-h-4 truncate text-[0.68rem] leading-4 text-muted-foreground" title={desc}>{desc ?? " "}</span>
      <span className="mt-0.5 min-h-4 truncate text-[0.7rem] leading-4 text-gold/80">{hint ?? " "}</span>
    </label>
  );
}

/**
 * زوج ساعتَي نافذة (من ← إلى) داخل إطار مشترك واحد — بنفس بنية بطاقة NumField الأربع
 * سطور حرفيًا (تسمية → حقلان → وصف محجوز → تلميحان محجوزان) فيتطابق الارتفاع مع الشبكة.
 */
function HourPairField({ label, desc, start, end, onStart, onEnd }: {
  label: string; desc: string; start: number; end: number;
  onStart: (n: number) => void; onEnd: (n: number) => void;
}) {
  return (
    <div className="col-span-2 flex h-full flex-col rounded-lg border border-border/60 bg-card/40 p-2">
      <span className="truncate text-xs font-medium leading-4 text-foreground" title={label}>{label} — من ← إلى</span>
      <div className="mt-1 grid grid-cols-2 gap-2">
        <input aria-label={`${label} — من الساعة`} type="number" dir="ltr" value={start} min={0} max={23}
          onChange={(e) => onStart(Number(e.target.value))} className="select-base w-full" />
        <input aria-label={`${label} — إلى الساعة`} type="number" dir="ltr" value={end} min={0} max={23}
          onChange={(e) => onEnd(Number(e.target.value))} className="select-base w-full" />
      </div>
      <span className="mt-1 min-h-4 truncate text-[0.68rem] leading-4 text-muted-foreground" title={desc}>{desc}</span>
      <div className="mt-0.5 grid grid-cols-2 gap-2">
        <span className="min-h-4 truncate text-[0.7rem] leading-4 text-gold/80">من: {hourHint(start)}</span>
        <span className="min-h-4 truncate text-[0.7rem] leading-4 text-gold/80">إلى: {hourHint(end)}</span>
      </div>
    </div>
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

function StatCard({ label, value, tone, hint }: {
  label: string; value: number;
  tone?: "success" | "warning" | "info" | "gold" | "muted";
  hint?: string;
}) {
  const color = tone === "success" ? "text-success"
    : tone === "warning" ? "text-warning"
      : tone === "info" ? "text-info"
        : tone === "muted" ? "text-muted-foreground"
          : "text-gold";
  return (
    <div className={`glass rounded-2xl p-4 ${tone === "gold" ? "border border-gold/40" : ""}`} title={hint}>
      <div className={`text-2xl font-bold ${color}`}>{toArabicDigits(value)}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      {hint && <div className="mt-0.5 text-[10px] text-muted-foreground/70">{hint}</div>}
    </div>
  );
}
