"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarClock, ChevronDown, Search, ShieldQuestion, Trash2 } from "lucide-react";
import { toArabicDigits } from "@/lib/format";
import { hmLabel, minuteLabel, minutesToTime, timeToMinutes } from "@/lib/attendance-ui";
import { StationsLog } from "@/components/attendance/attendance-stations";
import type { DayLogEntry, EmployeeFile } from "@/lib/data/attendance";
import "./attendance.css";

/**
 * ملف الموظف — التصميم المعتمد: رأس الإحصاءات، بطاقة «دوامه المحدد» مع تعديل،
 * سجل الأيام (فلتر شهر + بحث يوم client-side ضمن الشهر المحمّل)، الاستثناءات
 * (يمنحها المالك فقط)، ونداءات التحقق.
 *
 * الصلاحية على الخادم: الصفحة محمية بـrequireRole(OWNER) وكل مسار API يعيد
 * الفحص — هذي الواجهة عرض ونداءات فقط.
 */

const STATUS_META: Record<DayLogEntry["status"], { label: string; cls: string }> = {
  COMPLETED: { label: "أكمل دوامه", cls: "border-success/40 text-success" },
  PARTIAL: { label: "داوم جزئيًا", cls: "border-warning/40 text-warning" },
  OPEN: { label: "مداوم الآن", cls: "border-success/40 text-success" },
  ABSENT: { label: "غياب", cls: "border-destructive/30 text-destructive" },
  LEAVE: { label: "إجازة", cls: "border-info/40 text-info" },
  PENDING: { label: "لسة ما داوم", cls: "border-border text-muted-foreground" },
  WEEKEND: { label: "إجازة أسبوعية", cls: "border-border text-muted-foreground" },
};

const EXCEPTION_LABEL: Record<string, string> = {
  FULL_DAY_LEAVE: "إجازة يوم كامل",
  HOURS_EXCUSE: "استئذان ساعات",
  MODIFIED_SHIFT: "دوام معدّل",
};

const VERIFY_META: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "مجدول", cls: "text-muted-foreground" },
  SENT: { label: "بانتظار الرد", cls: "text-info" },
  CONFIRMED: { label: "تم التحقق", cls: "text-success" },
  OUT_OF_ZONE: { label: "خارج النطاق", cls: "text-destructive" },
  MISSED: { label: "ما ردّ", cls: "text-destructive" },
};

/** «2026-08-15» ⟵ «الجمعة ١٥ أغسطس» — المفتاح يوم رياضي فنقرؤه UTC كما هو. */
function dayLabelOf(key: string): string {
  return new Intl.DateTimeFormat("ar-SA-u-nu-arab", {
    calendar: "gregory",
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "short",
  }).format(new Date(`${key}T00:00:00Z`));
}

export function AttendanceEmployeeFile({ file }: { file: EmployeeFile }) {
  const router = useRouter();

  return (
    <div className="space-y-5">
      {/* ===== الرأس ===== */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/attendance"
            aria-label="رجوع لحوكمة الدوام"
            className="flex size-9 items-center justify-center rounded-xl border border-border text-muted-foreground hover:text-foreground"
          >
            <ArrowRight aria-hidden size={17} strokeWidth={1.8} />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-foreground">{file.user.name}</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              ملف الدوام{file.user.active ? "" : " — موقوف"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TriggerCallButton userId={file.user.id} />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            الشهر
            <input
              type="month"
              value={file.month}
              onChange={(e) => e.target.value && router.push(`/attendance/${file.user.id}?month=${e.target.value}`)}
              dir="ltr"
              className="h-9 rounded-xl border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:border-ring"
            />
          </label>
        </div>
      </header>

      {/* ===== إحصاءات الشهر ===== */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCell label="أيام دوام" value={toArabicDigits(file.stats.workDays)} />
        <StatCell label="الساعات" value={hmLabel(file.stats.totalMinutes, toArabicDigits)} />
        <StatCell
          label="أيام تأخير"
          value={toArabicDigits(file.stats.lateDays)}
          tone={file.stats.lateDays > 0 ? "warning" : undefined}
        />
        <StatCell
          label="أيام غياب"
          value={toArabicDigits(file.stats.absentDays)}
          tone={file.stats.absentDays > 0 ? "danger" : undefined}
        />
      </div>

      <ScheduleCard userId={file.user.id} schedule={file.schedule} />
      <DayLog days={file.days} />
      <ExceptionsSection userId={file.user.id} exceptions={file.exceptions} />
      <VerificationsSection verifications={file.verifications} />
    </div>
  );
}

function StatCell({ label, value, tone }: { label: string; value: string; tone?: "warning" | "danger" }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`mt-1 text-xl font-bold tabular-nums ${
          tone === "warning" ? "text-warning" : tone === "danger" ? "text-destructive" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

/* ═══════════════════ دوامه المحدد ═══════════════════ */

function ScheduleCard({ userId, schedule }: { userId: string; schedule: EmployeeFile["schedule"] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [startTime, setStartTime] = useState(minutesToTime(schedule.startMinutes));
  const [hours, setHours] = useState(String(Math.round(schedule.shiftMinutes / 60)));
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    setError(null);
    const s = timeToMinutes(startTime);
    const h = Number(hours);
    if (s === null || !Number.isFinite(h) || h < 1 || h > 16) {
      setError("تأكد من وقت البداية وعدد الساعات (من ١ إلى ١٦)");
      return;
    }
    start(async () => {
      const res = await fetch(`/api/attendance/schedule/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startMinutes: s, shiftMinutes: Math.round(h * 60) }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        setError(data.error ?? "ما انحفظ");
        return;
      }
      setEditing(false);
      router.refresh();
    });
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarClock aria-hidden size={17} strokeWidth={1.8} className="text-muted-foreground" />
          <h2 className="text-sm font-bold text-foreground">دوامه المحدد</h2>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground"
          >
            تعديل
          </button>
        )}
      </div>

      {!editing ? (
        <p className="mt-2.5 text-sm text-muted-foreground">
          يبدأ <b className="font-bold text-foreground">{minuteLabel(schedule.startMinutes, toArabicDigits)}</b> —{" "}
          <b className="font-bold text-foreground">{toArabicDigits(Math.round(schedule.shiftMinutes / 60))} ساعات</b>
          {schedule.isDefault && <span className="mr-2 text-xs">(الافتراضي — ما انضبط له دوام بعد)</span>}
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">بداية دوامه</span>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                dir="ltr"
                className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">عدد الساعات</span>
              <input
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                inputMode="numeric"
                dir="ltr"
                className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
              />
            </label>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            {/* العنصر الذهبي الوحيد في الصفحة */}
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="h-10 rounded-xl bg-gold px-6 text-sm font-bold text-primary-foreground disabled:opacity-60"
            >
              {pending ? "جاري الحفظ…" : "حفظ دوامه"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={pending}
              className="h-10 rounded-xl border border-border px-4 text-sm text-foreground disabled:opacity-60"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/* ═══════════════════ سجل الأيام ═══════════════════ */

function DayLog({ days }: { days: EmployeeFile["days"] }) {
  const [q, setQ] = useState("");

  // بحث اليوم client-side ضمن الشهر المحمّل: بالرقم («15») أو باسم اليوم («الجمعة»).
  const visible = useMemo(() => {
    const needle = q.trim();
    if (!needle) return days;
    return days.filter((d) => {
      const label = dayLabelOf(d.key);
      return d.key.includes(needle) || label.includes(needle) || toArabicDigits(d.key.slice(8, 10)).includes(needle) || String(Number(d.key.slice(8, 10))).includes(needle);
    });
  }, [days, q]);

  return (
    <section className="rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-sm font-bold text-foreground">سجل الأيام</h2>
        <label className="relative">
          <Search
            aria-hidden
            size={13}
            strokeWidth={1.8}
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث عن يوم"
            className="h-8 w-44 rounded-xl border border-input bg-background pr-7 pl-2.5 text-xs text-foreground outline-none focus:border-ring"
          />
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          {days.length === 0 ? "ما فيه أيام بهذا الشهر بعد" : "ما فيه يوم يطابق البحث"}
        </p>
      ) : (
        <ul className="att-scope">
          {visible.map((d) => (
            <DayRow key={d.key} d={d} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** «أرسل نداء تحقق الآن» — نداء يدوي فوري؛ السيرفر يشترط جلسة مفتوحة ولا يكرر. */
function TriggerCallButton({ userId }: { userId: string }) {
  const [phase, setPhase] = useState<"idle" | "busy" | "sent">("idle");
  const [note, setNote] = useState<string | null>(null);

  const fire = async () => {
    if (phase !== "idle") return;
    setPhase("busy");
    setNote(null);
    try {
      const res = await fetch("/api/attendance/verification/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (data.ok) setPhase("sent");
      else {
        setPhase("idle");
        setNote(data.error ?? "ما انرسل النداء");
      }
    } catch {
      setPhase("idle");
      setNote("تعذّر الاتصال");
    }
  };

  return (
    <span className="flex items-center gap-2">
      {note && <span className="text-[11px] font-medium text-warning">{note}</span>}
      <button
        type="button"
        onClick={() => void fire()}
        disabled={phase !== "idle"}
        className="flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-xs font-bold text-foreground disabled:opacity-70"
      >
        <ShieldQuestion aria-hidden size={14} strokeWidth={1.8} />
        {phase === "busy" ? "جاري الإرسال…" : phase === "sent" ? "انرسل النداء" : "أرسل نداء تحقق الآن"}
      </button>
    </span>
  );
}

/**
 * صف يوم واحد في السجل — المحطات (سجل التحركات) نفس مكوّن بطاقة الموظف
 * حرفيًا، تنفتح بضغطة على الصف عند وجود تحركات.
 */
function DayRow({ d }: { d: DayLogEntry }) {
  const [open, setOpen] = useState(false);
  const meta = STATUS_META[d.status];
  const expandable = d.stations.length > 0;

  return (
    <li className="border-b border-border/60 last:border-0">
      <button
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        className={`w-full px-4 py-3 text-right ${expandable ? "cursor-pointer hover:bg-secondary/30" : "cursor-default"}`}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm font-bold text-foreground">
            {dayLabelOf(d.key)}
            {expandable && (
              <ChevronDown
                aria-hidden
                size={14}
                strokeWidth={1.8}
                className="text-muted-foreground"
                style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.3s cubic-bezier(0.23,1,0.32,1)" }}
              />
            )}
          </span>
          <span className={`flex-none rounded-lg border px-2 py-0.5 text-[11px] font-bold ${meta.cls}`}>
            {meta.label}
          </span>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {d.checkInText ? (
            <span>
              {d.checkInText} ← {d.checkOutText ?? "…"}
            </span>
          ) : d.exceptionType ? (
            <span>{EXCEPTION_LABEL[d.exceptionType]}</span>
          ) : null}
          {d.locationName && <span>{d.locationName}</span>}
          {d.workedMinutes > 0 && (
            <span className="tabular-nums">
              {hmLabel(d.workedMinutes, toArabicDigits)} من {hmLabel(d.targetMinutes, toArabicDigits)}
            </span>
          )}
          {d.visitNames.length > 0 && <span>زار: {d.visitNames.join("، ")}</span>}
          {d.late && <span className="text-warning">تأخر</span>}
          {d.earlyIn && <span className="text-info">حضر بدري</span>}
          {d.lateOut && <span className="text-info">مشى متأخر</span>}
        </div>
      </button>

      {open && expandable && (
        <div className="px-4 pb-3">
          <StationsLog stations={d.stations} now={Date.now()} />
        </div>
      )}
    </li>
  );
}

/* ═══════════════════ الاستثناءات ═══════════════════ */

function ExceptionsSection({ userId, exceptions }: { userId: string; exceptions: EmployeeFile["exceptions"] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<"FULL_DAY_LEAVE" | "HOURS_EXCUSE" | "MODIFIED_SHIFT">("FULL_DAY_LEAVE");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [excuseUntil, setExcuseUntil] = useState("12:00");
  const [modifiedHours, setModifiedHours] = useState("6");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    setError(null);
    start(async () => {
      const res = await fetch("/api/attendance/exceptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          type,
          dateFrom,
          dateTo: dateTo || dateFrom,
          excuseUntilMinutes: type === "HOURS_EXCUSE" ? timeToMinutes(excuseUntil) : undefined,
          modifiedShiftMinutes: type === "MODIFIED_SHIFT" ? Math.round(Number(modifiedHours) * 60) : undefined,
          reason,
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        setError(data.error ?? "ما انحفظ الاستثناء");
        return;
      }
      setAdding(false);
      setDateFrom("");
      setDateTo("");
      setReason("");
      router.refresh();
    });
  };

  const remove = (id: string) => {
    start(async () => {
      await fetch(`/api/attendance/exceptions/${id}`, { method: "DELETE" });
      router.refresh();
    });
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-foreground">الاستثناءات</h2>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground"
          >
            إضافة استثناء
          </button>
        )}
      </div>

      {adding && (
        <div className="mt-3 space-y-3 rounded-xl border border-border bg-secondary/40 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">النوع</span>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as typeof type)}
                className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
              >
                <option value="FULL_DAY_LEAVE">إجازة يوم كامل</option>
                <option value="HOURS_EXCUSE">استئذان ساعات</option>
                <option value="MODIFIED_SHIFT">دوام معدّل لفترة</option>
              </select>
            </label>

            {type === "HOURS_EXCUSE" && (
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">معذور حتى الساعة</span>
                <input
                  type="time"
                  value={excuseUntil}
                  onChange={(e) => setExcuseUntil(e.target.value)}
                  dir="ltr"
                  className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
                />
              </label>
            )}
            {type === "MODIFIED_SHIFT" && (
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">ساعات الدوام المعدّل</span>
                <input
                  value={modifiedHours}
                  onChange={(e) => setModifiedHours(e.target.value)}
                  inputMode="numeric"
                  dir="ltr"
                  className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
                />
              </label>
            )}

            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">من يوم</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                dir="ltr"
                className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">إلى يوم (اتركه لو يوم واحد)</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                dir="ltr"
                className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
              />
            </label>

            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-xs text-muted-foreground">السبب</span>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="مثال: مراجعة مستشفى"
                className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
              />
            </label>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={add}
              disabled={pending}
              className="h-10 rounded-xl border border-foreground bg-foreground px-5 text-sm font-bold text-background disabled:opacity-60"
            >
              {pending ? "جاري الحفظ…" : "منح الاستثناء"}
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              disabled={pending}
              className="h-10 rounded-xl border border-border px-4 text-sm text-foreground disabled:opacity-60"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}

      {exceptions.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">ما فيه استثناءات بهذا الشهر</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {exceptions.map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-secondary/40 px-3 py-2.5"
            >
              <div className="min-w-0 text-xs">
                <p className="font-bold text-foreground">
                  {EXCEPTION_LABEL[e.type]}
                  {e.type === "HOURS_EXCUSE" && e.excuseUntilMinutes != null && (
                    <span className="font-medium text-muted-foreground"> — حتى {minuteLabel(e.excuseUntilMinutes, toArabicDigits)}</span>
                  )}
                  {e.type === "MODIFIED_SHIFT" && e.modifiedShiftMinutes != null && (
                    <span className="font-medium text-muted-foreground"> — {toArabicDigits(Math.round(e.modifiedShiftMinutes / 60))} ساعات</span>
                  )}
                </p>
                <p className="mt-0.5 text-muted-foreground">
                  {dayLabelOf(e.dateFromKey)}
                  {e.dateToKey !== e.dateFromKey && <> ← {dayLabelOf(e.dateToKey)}</>} · {e.reason}
                </p>
              </div>
              <button
                type="button"
                onClick={() => remove(e.id)}
                disabled={pending}
                aria-label="حذف الاستثناء"
                className="flex size-8 flex-none items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-destructive disabled:opacity-60"
              >
                <Trash2 aria-hidden size={14} strokeWidth={1.8} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ═══════════════════ نداءات التحقق ═══════════════════ */

function VerificationsSection({ verifications }: { verifications: EmployeeFile["verifications"] }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <ShieldQuestion aria-hidden size={17} strokeWidth={1.8} className="text-muted-foreground" />
        <h2 className="text-sm font-bold text-foreground">نداءات التحقق</h2>
      </div>

      {verifications.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">ما فيه نداءات تحقق بهذا الشهر</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {verifications.map((v) => {
            const meta = VERIFY_META[v.status] ?? VERIFY_META.PENDING;
            return (
              <li key={v.id} className="flex items-center justify-between gap-3 text-xs">
                <span className="text-muted-foreground">
                  {dayLabelOf(v.dayKey)} · {v.scheduledAtText}
                  {v.locationName && <> · {v.locationName}</>}
                </span>
                <span className={`font-bold ${meta.cls}`}>{meta.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default AttendanceEmployeeFile;
