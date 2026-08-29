"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Zain } from "next/font/google";
import {
  Activity,
  AlertTriangle,
  Bell,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPin,
  MessageSquare,
  Users,
} from "lucide-react";
import type { AttendanceSettings } from "@prisma/client";
import { toArabicDigits } from "@/lib/format";
import { minutesToTime, timeToMinutes } from "@/lib/attendance-ui";
import { WEEKDAY_CODES } from "@/lib/attendance-logic";
import { Time12 } from "@/components/ui/time12";
import { AuthorizersSection } from "@/components/attendance/attendance-admin";

const zain = Zain({ subsets: ["arabic"], weight: ["700", "800"], display: "swap" });

/**
 * مركز التحكم (الدفعة أ) — المرجع: docs/design/control-center-v2.html.
 * رئيسية ببوابات ست ← صفحات أقسام. الأقسام الأربعة الأولى تحفظ حقول
 * AttendanceSettings (ومنها ما كان مدفونًا بلا واجهة) عبر PATCH القائم؛
 * «توزيع التنبيهات» قراءة (لا تخزين لكل مستلم بعد — الدفعة ب)؛ و«الموظفون»
 * قائمة تفتح ملف الموظف الحي — لا سطح تعديل فردي جديد.
 */

type View = "home" | "time" | "punch" | "pulse" | "calls" | "alerts" | "emps";

const VIEW_META: Record<View, { title: string; sub: string }> = {
  home: { title: "مركز التحكم", sub: "كل قسم صفحته — والموظف صفحته" },
  time: { title: "الدوام والأوقات", sub: "نافذة الشركة — الورديات الفردية من صفحة كل موظف" },
  punch: { title: "البصم والمواقع", sub: "البصمة هي كل ما يراه الموظف" },
  pulse: { title: "النبض الحاكم", sub: "النبض يحكم — والنداء آخر دواء" },
  calls: { title: "النداءات والتحقق", sub: "تعمل فقط لمن سقطت حصانته" },
  alerts: { title: "توزيع التنبيهات", sub: "من يستلم ماذا — يسري فورًا بعد الحفظ" },
  emps: { title: "الموظفون", sub: "اضغط الاسم — ملف الموظف الحي بقسم إعداداته" },
};

const WEEKDAY_LABELS: Record<string, string> = {
  SUN: "الأحد", MON: "الاثنين", TUE: "الثلاثاء", WED: "الأربعاء", THU: "الخميس", FRI: "الجمعة", SAT: "السبت",
};

/** الحقول القابلة للحفظ من المركز — مفاتيح PATCH كما هي. */
type Draft = {
  workStartMinutes: number;
  workEndMinutes: number;
  lateThresholdMinutes: number;
  weekendDays: string;
  cooldownSeconds: number;
  autoCloseAliveGraceMinutes: number;
  autoPunchEnabled: boolean;
  minAccuracyMeters: number;
  allowProjectAttendance: boolean;
  notifyAutoPunchOwner: boolean;
  radarFreshMinutes: number;
  heartbeatGapMinutes: number;
  maxOutOfZoneMinutes: number;
  verificationEnabled: boolean;
  verificationPerDay: number;
  verificationWindowMinutes: number;
  verificationStartGuardMinutes: number;
  verificationEndGuardMinutes: number;
  verificationQuietWindowMinutes: number;
  escalationDelayMinutes: number;
  conditionalWindowMinutes: number;
  conditionalCooldownMinutes: number;
  maxConditionalPerDay: number;
  visitReverifyMinutes: number;
  quietWindowCountsCrm: boolean;
  // ===== الدفعة ب =====
  maxSessionMinutes: number;
  pulseImmunityMinutes: number;
  autoCallOnSustainedOutZone: boolean;
  /** توزيع التنبيهات كسلسلة JSON — للمقارنة البسيطة في changedKeys. */
  alertRoutingJson: string;
};

const draftOf = (s: AttendanceSettings): Draft => ({
  workStartMinutes: s.workStartMinutes,
  workEndMinutes: s.workEndMinutes,
  lateThresholdMinutes: s.lateThresholdMinutes,
  weekendDays: s.weekendDays,
  cooldownSeconds: s.cooldownSeconds,
  autoCloseAliveGraceMinutes: s.autoCloseAliveGraceMinutes,
  autoPunchEnabled: s.autoPunchEnabled,
  minAccuracyMeters: s.minAccuracyMeters,
  allowProjectAttendance: s.allowProjectAttendance,
  notifyAutoPunchOwner: s.notifyAutoPunchOwner,
  radarFreshMinutes: s.radarFreshMinutes,
  heartbeatGapMinutes: s.heartbeatGapMinutes,
  maxOutOfZoneMinutes: s.maxOutOfZoneMinutes,
  verificationEnabled: s.verificationEnabled,
  verificationPerDay: s.verificationPerDay,
  verificationWindowMinutes: s.verificationWindowMinutes,
  verificationStartGuardMinutes: s.verificationStartGuardMinutes,
  verificationEndGuardMinutes: s.verificationEndGuardMinutes,
  verificationQuietWindowMinutes: s.verificationQuietWindowMinutes,
  escalationDelayMinutes: s.escalationDelayMinutes,
  conditionalWindowMinutes: s.conditionalWindowMinutes,
  conditionalCooldownMinutes: s.conditionalCooldownMinutes,
  maxConditionalPerDay: s.maxConditionalPerDay,
  visitReverifyMinutes: s.visitReverifyMinutes,
  quietWindowCountsCrm: s.quietWindowCountsCrm,
  maxSessionMinutes: s.maxSessionMinutes,
  pulseImmunityMinutes: s.pulseImmunityMinutes,
  autoCallOnSustainedOutZone: s.autoCallOnSustainedOutZone,
  alertRoutingJson: JSON.stringify(s.alertRouting ?? {}),
});

export type ControlEmployee = { id: string; name: string; startMinutes: number | null; custom: boolean };

export type ControlRoutee = { id: string; name: string; role: string };

export function ControlCenter({
  settings,
  employees,
  routees,
}: {
  settings: AttendanceSettings;
  employees: ControlEmployee[];
  routees: ControlRoutee[];
}) {
  const router = useRouter();
  const [view, setView] = useState<View>("home");
  const [draft, setDraft] = useState<Draft>(() => draftOf(settings));
  const [saved, setSaved] = useState<Draft>(() => draftOf(settings));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const changedKeys = useMemo(
    () => (Object.keys(draft) as (keyof Draft)[]).filter((k) => draft[k] !== saved[k]),
    [draft, saved],
  );

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setMsg(null);
    setDraft((d) => ({ ...d, [k]: v }));
  };

  const save = () => {
    if (changedKeys.length === 0) return;
    setMsg(null);
    start(async () => {
      const body: Record<string, unknown> = Object.fromEntries(
        changedKeys.filter((k) => k !== "alertRoutingJson").map((k) => [k, draft[k]]),
      );
      if (changedKeys.includes("alertRoutingJson")) {
        try {
          body.alertRouting = JSON.parse(draft.alertRoutingJson);
        } catch {
          /* لن يحدث — نحن من نكتبها */
        }
      }
      const res = await fetch("/api/attendance/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (data.ok) {
        setSaved({ ...draft });
        setMsg({ ok: true, text: "انحفظت الإعدادات" });
        router.refresh();
      } else {
        setMsg({ ok: false, text: data.error ?? "ما انحفظت" });
      }
    });
  };

  /** استعادة افتراضي القسم = إرجاع حقوله لقيمها المحفوظة (تراجع عن غير المحفوظ). */
  const resetSection = (keys: (keyof Draft)[]) => {
    setDraft((d) => ({ ...d, ...Object.fromEntries(keys.map((k) => [k, saved[k]])) }));
  };

  const meta = VIEW_META[view];
  const impact12 = minutesToTime(Math.min(1439, draft.workStartMinutes + 15));

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* ===== الشريط العلوي اللاصق ===== */}
      <div className="sticky top-0 z-40 -mx-2 flex items-center gap-3 border-b border-border bg-background/85 px-2 py-3 backdrop-blur-md">
        {view !== "home" ? (
          <button
            type="button"
            onClick={() => setView("home")}
            aria-label="رجوع"
            className="flex size-9 flex-none items-center justify-center rounded-xl border border-border text-muted-foreground hover:text-foreground"
          >
            <ChevronRight aria-hidden size={17} strokeWidth={1.8} />
          </button>
        ) : (
          <Link
            href="/attendance"
            aria-label="رجوع للوحة الدوام"
            className="flex size-9 flex-none items-center justify-center rounded-xl border border-border text-muted-foreground hover:text-foreground"
          >
            <ChevronRight aria-hidden size={17} strokeWidth={1.8} />
          </Link>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] font-bold text-foreground">{meta.title}</h1>
          <p className="truncate text-[11.5px] text-muted-foreground">{meta.sub}</p>
        </div>
        <span
          className={`flex-none rounded-full border px-3 py-1.5 text-[11px] font-bold ${
            changedKeys.length > 0 ? "border-warning/40 text-warning" : "border-border text-muted-foreground"
          }`}
        >
          {changedKeys.length > 0 ? (
            <>غير محفوظة (<span className={zain.className}>{toArabicDigits(changedKeys.length)}</span>)</>
          ) : (
            "لا تغييرات"
          )}
        </span>
        <button
          type="button"
          onClick={save}
          disabled={pending || changedKeys.length === 0}
          className="h-10 flex-none rounded-xl bg-gold px-5 text-[13px] font-bold text-primary-foreground disabled:opacity-45"
        >
          {pending ? "جاري الحفظ…" : "حفظ"}
        </button>
      </div>

      {msg && <p className={`text-xs ${msg.ok ? "text-success" : "text-destructive"}`}>{msg.text}</p>}

      {/* ═══════════ الرئيسية — البوابات الست ═══════════ */}
      {view === "home" && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-2xl border border-success/25 bg-success/5 p-4 text-[12.5px] leading-relaxed text-muted-foreground">
            <Activity aria-hidden size={17} strokeWidth={1.6} className="mt-0.5 flex-none text-success" />
            <span>
              <b className="text-foreground">شاشة الموظف الآن: البصمة فقط.</b> أُلغيت شاشة الحسم الإجبارية — الموظف
              يفتح فيدخل مباشرة، يبصم بنفسه أو يبصمه التلقائي. الإجازة والمرضية والاستئذان طلبات في قسم الإجازات،
              والتأخير يُرصد ويصل المسؤولين دون أن يوقفه شيء.
            </span>
          </div>

          <div className="grid gap-3.5 sm:grid-cols-2">
            <Gate
              icon={<Clock3 aria-hidden size={20} strokeWidth={1.6} />}
              title="الدوام والأوقات"
              desc="نافذة قبول البصمات، حد التأخير، وأيام العطلة."
              status={<span className={zain.className}>{fmt12(draft.workStartMinutes)} — {fmt12(draft.workEndMinutes)}</span>}
              onClick={() => setView("time")}
            />
            <Gate
              icon={<MapPin aria-hidden size={20} strokeWidth={1.6} />}
              title="البصم والمواقع"
              desc="البصم التلقائي، الدقة المقبولة، والمشاريع."
              status={draft.autoPunchEnabled ? "التلقائي مفعّل" : "التلقائي مطفأ"}
              onClick={() => setView("punch")}
            />
            <Gate
              gold
              icon={<Activity aria-hidden size={20} strokeWidth={1.6} />}
              title="النبض الحاكم"
              desc="الحصانة، الرادار، الخروج المؤكد — النبض يحكم والنداء آخر دواء."
              status={<>الحصانة <span className={zain.className}>{toArabicDigits(30)}</span> دقيقة</>}
              onClick={() => setView("pulse")}
            />
            <Gate
              icon={<Bell aria-hidden size={20} strokeWidth={1.6} />}
              title="النداءات والتحقق"
              desc="مهل الرد والحرّاس والنداءات المشروطة."
              status={draft.verificationEnabled ? "العشوائي شغّال" : "العشوائي متوقف"}
              onClick={() => setView("calls")}
            />
            <div className="sm:col-span-2">
              <Gate
                wide
                icon={<MessageSquare aria-hidden size={20} strokeWidth={1.6} />}
                title="توزيع التنبيهات"
                desc="من يستلم ماذا: التأخير والغياب وتنبيهات القرار."
                status={<>{(() => { const n = Object.keys(parseRouting(draft.alertRoutingJson)).length; return n > 0 ? <>موزَّع لـ<span className={zain.className}>{toArabicDigits(n)}</span> أنواع</> : "الافتراضي — المالك"; })()}</>}
                onClick={() => setView("alerts")}
              />
            </div>
            <div className="sm:col-span-2">
              <Gate
                wide
                icon={<Users aria-hidden size={20} strokeWidth={1.6} />}
                title="الموظفون — تحكم فردي"
                desc="لكل موظف صفحته: ورديته، نداءاته، عطلته، ووضعه — الفردي يتقدّم على العام."
                status={<><span className={zain.className}>{toArabicDigits(employees.length)}</span> موظفًا</>}
                onClick={() => setView("emps")}
              />
            </div>
          </div>

          {/* جهات الإذن — كانت أسفل تبويب الإعدادات، تبقى هنا بلا سطح ثانٍ */}
          <AuthorizersSection />
        </div>
      )}

      {/* ═══════════ ١ · الدوام والأوقات ═══════════ */}
      {view === "time" && (
        <div className="space-y-4">
          <Card title="نافذة قبول البصمات" onReset={() => resetSection(["workStartMinutes", "workEndMinutes"])}>
            <Row label="بداية الاستقبال" desc="أي بصمة قبلها تُرفض. المبكّر يُحسب له من لحظة بصمته.">
              <Time12 value={minutesToTime(draft.workStartMinutes)} onChange={(v) => { const m = timeToMinutes(v); if (m !== null) set("workStartMinutes", m); }} />
            </Row>
            <Row label="نهاية الدوام" desc="بعدها تُقفل الجلسات المفتوحة تلقائيًا.">
              <Time12 value={minutesToTime(draft.workEndMinutes)} onChange={(v) => { const m = timeToMinutes(v); if (m !== null) set("workEndMinutes", m); }} />
            </Row>
            <p className="mx-4 mb-4 flex items-center gap-2 rounded-xl border border-gold/25 bg-gold/5 px-3.5 py-2.5 text-[12px] text-gold">
              <AlertTriangle aria-hidden size={14} strokeWidth={1.7} className="flex-none" />
              <span>
                بصمة <b className={zain.className}>{fmt12h(impact12)}</b> ستُقبل وتُحسب من لحظتها — والتأخير يبدأ بعد
                بداية وردية الموظف + <b className={zain.className}>{toArabicDigits(draft.lateThresholdMinutes)}</b> دقيقة.
              </span>
            </p>
          </Card>

          <Card title="التأخير والعطلة والضبط الدقيق" onReset={() => resetSection(["lateThresholdMinutes", "weekendDays", "cooldownSeconds", "autoCloseAliveGraceMinutes", "maxSessionMinutes"])}>
            <Row label="حد التأخير" desc="يُقاس على بداية وردية كل موظف — المتأخر يبصم ويدخل عادي، والتنبيه يصل المسؤولين." badge={<CustomBadge />}>
              <Stepper value={draft.lateThresholdMinutes} min={0} max={240} step={5} unit="دقيقة" onChange={(v) => set("lateThresholdMinutes", v)} />
            </Row>
            <Row label="أيام العطلة الأسبوعية" desc="لا حساب غياب ولا تذكيرات فيها — عطلة الموظف المخصصة تتقدّم." badge={<CustomBadge />}>
              <WeekendChips value={draft.weekendDays} onChange={(v) => set("weekendDays", v)} />
            </Row>
            <Row label="فاصل تكرار البصم" desc="حماية من الضغط المزدوج.">
              <Stepper value={draft.cooldownSeconds} min={0} max={600} step={30} unit="ثانية" onChange={(v) => set("cooldownSeconds", v)} />
            </Row>
            <Row label="سماحية الإقفال التلقائي" desc="عند الإقفال القسري تُحتسب هذه المدة بعد آخر إثبات حياة.">
              <Stepper value={draft.autoCloseAliveGraceMinutes} min={5} max={120} step={5} unit="دقيقة" onChange={(v) => set("autoCloseAliveGraceMinutes", v)} />
            </Row>
            <Row label="أقصى مدة جلسة" desc="جلسة تتجاوز هذا السقف تُقفل تلقائيًا عند آخر إثبات حياة — صمام أمان الاحتساب الحر.">
              <Stepper
                value={Math.round(draft.maxSessionMinutes / 60)}
                min={8}
                max={24}
                step={1}
                unit="ساعة"
                onChange={(v) => set("maxSessionMinutes", v * 60)}
              />
            </Row>
          </Card>
        </div>
      )}

      {/* ═══════════ ٢ · البصم والمواقع ═══════════ */}
      {view === "punch" && (
        <Card title="البصم والمواقع" onReset={() => resetSection(["autoPunchEnabled", "minAccuracyMeters", "allowProjectAttendance", "notifyAutoPunchOwner"])}>
          <Row
            label="البصم التلقائي"
            desc="نبضتان متتاليتان داخل النطاق = حضور مسجّل بلا أي ضغطة."
            badge={
              <span className="inline-flex items-center gap-1 rounded-lg border border-destructive/35 bg-destructive/10 px-2 py-0.5 text-[10px] font-bold text-destructive">
                <AlertTriangle aria-hidden size={10} strokeWidth={2} />
                إطفاؤه يوقف البصم التلقائي كليًا
              </span>
            }
          >
            <Toggle on={draft.autoPunchEnabled} onChange={(v) => set("autoPunchEnabled", v)} />
          </Row>
          <Row label="أسوأ دقة مقبولة" desc="بصمة أو نبضة أسوأ من هذا الرقم تُرفض أو تبقى بلا حكم موقع.">
            <Stepper value={draft.minAccuracyMeters} min={10} max={1000} step={10} unit="متر" onChange={(v) => set("minAccuracyMeters", v)} />
          </Row>
          <Row label="قبول الحضور من المشاريع" desc="مطفأ: الحضور الرسمي من المقر فقط والمشاريع زيارات.">
            <Toggle on={draft.allowProjectAttendance} onChange={(v) => set("allowProjectAttendance", v)} />
          </Row>
          <Row label="إشعار المالك بالبصم التلقائي" desc="«بصمنا لفلان» مع أول بصمة تلقائية باليوم.">
            <Toggle on={draft.notifyAutoPunchOwner} onChange={(v) => set("notifyAutoPunchOwner", v)} />
          </Row>
        </Card>
      )}

      {/* ═══════════ ٣ · النبض الحاكم ═══════════ */}
      {view === "pulse" && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-2xl border border-gold/30 bg-gold/5 p-4 text-[12.5px] leading-relaxed text-muted-foreground">
            <Activity aria-hidden size={17} strokeWidth={1.6} className="mt-0.5 flex-none text-gold" />
            <span>
              من يثبت نبضُه وجودَه داخل الموقع <b className="text-gold">محصّن من كل النداءات الآلية</b> — وتنبيهات
              القرار تصلك أنت بدل النداء الأعمى.
            </span>
          </div>
          <Card gold title="النبض الحاكم" onReset={() => resetSection(["radarFreshMinutes", "heartbeatGapMinutes", "maxOutOfZoneMinutes", "pulseImmunityMinutes", "autoCallOnSustainedOutZone"])}>
            <Row label="مدة حصانة النبض" desc="آخر نبضة داخل النطاق أحدث من هذه المدة = صفر نداءات لصاحبها — القاعدة الذهبية.">
              <Stepper value={draft.pulseImmunityMinutes} min={5} max={120} step={5} unit="دقيقة" onChange={(v) => set("pulseImmunityMinutes", v)} />
            </Row>
            <Row label="عتبة الرادار الحي" desc="بعدها بلا نبضة يُعتبر الإثبات «منقطعًا» في المواقع الحية.">
              <Stepper value={draft.radarFreshMinutes} min={1} max={15} step={1} unit="دقائق" onChange={(v) => set("radarFreshMinutes", v)} />
            </Row>
            <Row label="عتبة تنبيه الانقطاع" desc="جلسة مفتوحة بلا إثبات لهذه المدة → يصلك تنبيه قرار (ونداء تأكيد للموظف).">
              <Stepper value={draft.heartbeatGapMinutes} min={15} max={180} step={5} unit="دقيقة" onChange={(v) => set("heartbeatGapMinutes", v)} />
            </Row>
            <Row label="عتبة الخروج المؤكد" desc="نبض خارج النطاق مستمر لهذه المدة → تنبيه قرار باسمه ومدته.">
              <Stepper value={draft.maxOutOfZoneMinutes} min={10} max={120} step={5} unit="دقيقة" onChange={(v) => set("maxOutOfZoneMinutes", v)} />
            </Row>
            <Row label="نداء تلقائي عند الخروج المؤكد" desc="مفعّل: الخروج المؤكد يُندّى بلا انتظارك (بسقوف اليوم). مطفأ: يصلك «أرسل نداء / تجاهل».">
              <Toggle on={draft.autoCallOnSustainedOutZone} onChange={(v) => set("autoCallOnSustainedOutZone", v)} />
            </Row>
          </Card>
        </div>
      )}

      {/* ═══════════ ٤ · النداءات والتحقق ═══════════ */}
      {view === "calls" && (
        <Card
          title="النداءات والتحقق"
          onReset={() =>
            resetSection([
              "verificationEnabled", "verificationPerDay", "verificationWindowMinutes",
              "verificationStartGuardMinutes", "verificationEndGuardMinutes", "verificationQuietWindowMinutes",
              "escalationDelayMinutes", "conditionalWindowMinutes", "conditionalCooldownMinutes",
              "maxConditionalPerDay", "visitReverifyMinutes", "quietWindowCountsCrm",
            ])
          }
        >
          <Row
            label="النداءات العشوائية"
            desc="المفتاح الموحّد الصادق: تشغيله يعيد جدولتها للملزَمين — تنبيهات القرار هي الأساس."
            badge={!draft.verificationEnabled ? <span className="rounded-lg border border-gold/30 bg-gold/10 px-2 py-0.5 text-[10px] font-bold text-gold">متوقفة — تنبيهات القرار هي الأساس</span> : <CustomBadge />}
          >
            <Toggle on={draft.verificationEnabled} onChange={(v) => set("verificationEnabled", v)} />
          </Row>
          <Row label="عددها باليوم" desc="لكل مداوم — بسقف صارم لا يتجاوز نداءين.">
            <Stepper value={draft.verificationPerDay} min={0} max={10} step={1} unit="باليوم" onChange={(v) => set("verificationPerDay", v)} />
          </Row>
          <Row label="مهلة الرد على النداء" desc="بعدها يُوسم فائتًا ويبدأ التصعيد — تسري على كل الأنواع.">
            <Stepper value={draft.verificationWindowMinutes} min={5} max={120} step={5} unit="دقيقة" onChange={(v) => set("verificationWindowMinutes", v)} />
          </Row>
          <Row label="حارسا البداية والنهاية" desc="لا نداء بأول الدوام ولا بآخره.">
            <div className="flex gap-2">
              <Stepper value={draft.verificationStartGuardMinutes} min={0} max={240} step={5} unit="البداية" onChange={(v) => set("verificationStartGuardMinutes", v)} />
              <Stepper value={draft.verificationEndGuardMinutes} min={0} max={240} step={5} unit="النهاية" onChange={(v) => set("verificationEndGuardMinutes", v)} />
            </div>
          </Row>
          <Row label="نافذة الهدوء الذكية" desc="نشاط موقعي حديث خلالها يؤجل النداء — لا نقاطع من يعمل.">
            <Stepper value={draft.verificationQuietWindowMinutes} min={15} max={360} step={15} unit="دقيقة" onChange={(v) => set("verificationQuietWindowMinutes", v)} />
          </Row>
          <Row label="نشاط CRM يقوم مقام التحقق" desc="افتراضيًا لا — الرقمي لا يعوّض الجسدي.">
            <Toggle on={draft.quietWindowCountsCrm} onChange={(v) => set("quietWindowCountsCrm", v)} />
          </Row>
          <Row label="تأخير النداء التصعيدي" desc="بعد فوات الأول بهذه المدة يُرسل الثاني الإجباري.">
            <Stepper value={draft.escalationDelayMinutes} min={5} max={120} step={5} unit="دقيقة" onChange={(v) => set("escalationDelayMinutes", v)} />
          </Row>
          <Row label="النداءات المشروطة" desc="مهلة الرد + تهدئة بين نداءين + سقف يومي.">
            <div className="flex flex-wrap justify-end gap-2">
              <Stepper value={draft.conditionalWindowMinutes} min={5} max={60} step={5} unit="نافذة" onChange={(v) => set("conditionalWindowMinutes", v)} />
              <Stepper value={draft.conditionalCooldownMinutes} min={15} max={240} step={5} unit="تهدئة" onChange={(v) => set("conditionalCooldownMinutes", v)} />
              <Stepper value={draft.maxConditionalPerDay} min={1} max={8} step={1} unit="السقف" onChange={(v) => set("maxConditionalPerDay", v)} />
            </div>
          </Row>
          <Row label="إعادة التحقق بزيارات المشاريع" desc="بلا إثبات موقع لهذه المدة أثناء الزيارة يُسأل «لسه بالمشروع؟».">
            <Stepper value={draft.visitReverifyMinutes} min={5} max={120} step={5} unit="دقيقة" onChange={(v) => set("visitReverifyMinutes", v)} />
          </Row>
        </Card>
      )}

      {/* ═══════════ ٥ · توزيع التنبيهات (عرض) ═══════════ */}
      {view === "alerts" && (
        <Card title="كل تنبيه — ولمن يصل" onReset={() => resetSection(["alertRoutingJson"])}>
          <p className="px-4 pt-3 text-xs leading-relaxed text-muted-foreground">
            علّم مستلمي كل نوع — <b className="text-foreground">قائمة فارغة = الافتراضي (المالك)</b>. التوزيع يسري
            فورًا على نقاط الإرسال الخمس بعد الحفظ.
          </p>
          <div className="overflow-x-auto px-4 pb-4 pt-2">
            <table className="w-full min-w-[420px] border-collapse text-center">
              <thead>
                <tr>
                  <th className="py-2.5 pr-1 text-right text-xs font-semibold text-muted-foreground">التنبيه</th>
                  {routees.map((r) => (
                    <th key={r.id} className="py-2.5 text-[11px] font-semibold text-muted-foreground">
                      {r.name}
                      <span className="block text-[9px] font-normal">{r.role === "OWNER" ? "المالك" : "الإدارة"}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROUTED_ALERTS.map(([key, label, sub]) => {
                  const routing = parseRouting(draft.alertRoutingJson);
                  const list = routing[key] ?? [];
                  return (
                    <tr key={key} className="border-t border-border">
                      <td className="py-3 pr-1 text-right text-[12.5px] font-semibold text-foreground">
                        {label}
                        <span className="mt-0.5 block text-[10.5px] font-normal text-muted-foreground">
                          {list.length === 0 ? "الافتراضي — المالك" : sub}
                        </span>
                      </td>
                      {routees.map((r) => (
                        <td key={r.id} className="py-3">
                          <Toggle
                            on={list.includes(r.id)}
                            onChange={(on) => {
                              const next = { ...routing, [key]: on ? [...list, r.id] : list.filter((x) => x !== r.id) };
                              if (next[key].length === 0) delete next[key];
                              set("alertRoutingJson", JSON.stringify(next));
                            }}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ═══════════ ٦ · الموظفون ═══════════ */}
      {view === "emps" && (
        <Card title="الموظفون — الفردي يتقدّم على العام">
          {employees.map((e) => (
            <Link
              key={e.id}
              href={`/employees/${e.id}`}
              className="flex items-center gap-3 border-b border-border px-4 py-3.5 transition-colors last:border-0 hover:bg-secondary/40"
            >
              <span className={`${zain.className} flex size-10 flex-none items-center justify-center rounded-xl bg-gold text-[15px] font-bold text-primary-foreground`}>
                {e.name.trim().charAt(0)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold text-foreground">{e.name}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {e.startMinutes !== null ? (
                    <>وردية <b className={zain.className}>{fmt12(e.startMinutes)}</b></>
                  ) : (
                    "يتبع الإعدادات العامة"
                  )}
                </span>
              </span>
              {e.custom ? (
                <span className="rounded-lg border border-info/35 bg-info/10 px-2 py-0.5 text-[10px] font-bold text-info">مخصص</span>
              ) : (
                <span className="rounded-lg border border-border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">عام</span>
              )}
              <ChevronLeft aria-hidden size={15} strokeWidth={1.8} className="flex-none text-muted-foreground" />
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}


/** أنواع التنبيهات الموزعة (الدفعة ب) — [المفتاح، التسمية، الوصف الموجز]. */
const ROUTED_ALERTS: [string, string, string][] = [
  ["attendance.late", "تأخر عن الوردية", "بعد حد التأخير من بداية وردية الموظف"],
  ["attendance.no_show", "لم يداوم", "إنذار الغياب"],
  ["attendance.pulse_alert", "تنبيهات القرار", "خروج مؤكد أو انقطاع نبض"],
  ["attendance.auto_punch", "بصم تلقائي", "«بصمنا لفلان» لحظة حدوثه"],
  ["leave.requested", "طلبات الإجازة", "طلب جديد للاعتماد"],
];

function parseRouting(json: string): Record<string, string[]> {
  try {
    const v = JSON.parse(json) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const out: Record<string, string[]> = {};
      for (const [k, arr] of Object.entries(v as Record<string, unknown>)) {
        if (Array.isArray(arr)) out[k] = arr.filter((x): x is string => typeof x === "string");
      }
      return out;
    }
  } catch {
    /* سلسلة معطوبة = خريطة فارغة */
  }
  return {};
}

/* ═══════════ لبنات العرض ═══════════ */

/** ‏«٧:٠٠ ص» من دقائق اليوم. */
function fmt12(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${toArabicDigits(h12)}:${toArabicDigits(String(m).padStart(2, "0"))} ${h >= 12 ? "م" : "ص"}`;
}

/** «HH:MM» (٢٤س) ← عرض ١٢س عربي. */
function fmt12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return fmt12((h ?? 0) * 60 + (m ?? 0));
}

function Gate({
  icon, title, desc, status, onClick, gold = false, wide = false,
}: {
  icon: React.ReactNode; title: string; desc: string; status: React.ReactNode; onClick: () => void; gold?: boolean; wide?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative w-full overflow-hidden rounded-2xl border bg-card p-4 text-right transition-transform active:scale-[.98] ${
        gold ? "border-gold/35" : "border-border"
      } ${wide ? "flex items-center gap-4" : ""}`}
    >
      {gold && <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-l from-transparent via-gold to-transparent" />}
      <span className={`flex size-11 flex-none items-center justify-center rounded-xl ${gold ? "bg-gold text-primary-foreground" : "border border-border bg-secondary/60 text-gold"} ${wide ? "" : "mb-3"}`}>
        {icon}
      </span>
      <span className={wide ? "min-w-0 flex-1" : "block"}>
        <span className="block text-[14px] font-bold text-foreground">{title}</span>
        <span className="mt-1 block text-[11.5px] leading-relaxed text-muted-foreground">{desc}</span>
      </span>
      <span className={`inline-flex items-center rounded-lg bg-gold/10 px-2.5 py-1 text-[11px] font-semibold text-gold ${wide ? "flex-none" : "mt-2.5"}`}>
        {status}
      </span>
    </button>
  );
}

function Card({ title, children, gold = false, onReset }: { title: string; children: React.ReactNode; gold?: boolean; onReset?: () => void }) {
  return (
    <section className={`overflow-hidden rounded-2xl border bg-card ${gold ? "border-gold/35" : "border-border"}`}>
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <h2 className="flex-1 text-[13px] font-bold text-muted-foreground">{title}</h2>
        {onReset && (
          <button type="button" onClick={onReset} className="rounded-lg border border-border px-2.5 py-1 text-[10.5px] font-semibold text-muted-foreground hover:text-destructive">
            تراجع عن غير المحفوظ
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function Row({ label, desc, badge, children }: { label: string; desc: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3.5 last:border-0">
      <div className="min-w-[220px] flex-1">
        <div className="flex flex-wrap items-center gap-2 text-[13.5px] font-semibold text-foreground">
          {label}
          {badge}
        </div>
        <p className="mt-1 max-w-md text-[11.5px] leading-relaxed text-muted-foreground">{desc}</p>
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function Stepper({ value, min, max, step, unit, onChange }: { value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center rounded-xl border border-border bg-secondary/50">
      <button type="button" aria-label="أنقص" onClick={() => onChange(Math.max(min, value - step))} className="flex h-9 w-8 items-center justify-center text-muted-foreground hover:text-gold">
        −
      </button>
      <span className="min-w-[58px] px-1 text-center">
        <span className={`${zain.className} block text-[16px] font-bold leading-tight text-gold`}>{toArabicDigits(value)}</span>
        <span className="-mt-0.5 block text-[9px] text-muted-foreground">{unit}</span>
      </span>
      <button type="button" aria-label="زد" onClick={() => onChange(Math.min(max, value + step))} className="flex h-9 w-8 items-center justify-center text-muted-foreground hover:text-gold">
        +
      </button>
    </div>
  );
}

function Toggle({ on, onChange, disabled = false }: { on: boolean; onChange?: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange?.(!on)}
      className={`relative h-[29px] w-[50px] flex-none rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
        on ? "border-transparent bg-gold" : "border-border bg-secondary"
      }`}
    >
      <span
        aria-hidden
        className={`absolute top-[3px] size-[21px] rounded-full bg-background shadow transition-all ${on ? "right-[26px]" : "right-[3px]"}`}
      />
    </button>
  );
}

function WeekendChips({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const active = new Set(value.split(",").map((c) => c.trim()).filter(Boolean));
  const toggle = (code: string) => {
    const next = new Set(active);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    if (next.size > 6) return;
    onChange([...next].join(","));
  };
  return (
    <div className="flex max-w-[300px] flex-wrap justify-end gap-1.5">
      {WEEKDAY_CODES.map((code) => (
        <button
          key={code}
          type="button"
          aria-pressed={active.has(code)}
          onClick={() => toggle(code)}
          className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
            active.has(code) ? "border-transparent bg-gold text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          {WEEKDAY_LABELS[code]}
        </button>
      ))}
    </div>
  );
}

/** شارة «مخصص لدى موظفين» — الفردي يتقدّم على العام (ملف الموظف الحي). */
function CustomBadge() {
  return (
    <span className="rounded-lg border border-info/35 bg-info/10 px-2 py-0.5 text-[10px] font-bold text-info">
      قد يخصَّص لكل موظف
    </span>
  );
}
