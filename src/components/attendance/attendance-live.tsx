"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, CalendarRange, MapPin } from "lucide-react";
import { toArabicDigits } from "@/lib/format";
import { hmLabel } from "@/lib/attendance-ui";
import type { LiveBoardPayload, LiveBoardRow, RangeBoardRow, TileState } from "@/lib/data/attendance";
import "./attendance.css";

/**
 * تبويب «مداوم الآن» — البلاط الموحّد: بلاطة لكل موظف أيًّا كانت حالته، بنفس
 * البنية (هالة حالة + رأس ثابت + جسم حسب الحالة)، مع فلتر تاريخ وشريط مباشر.
 *
 * السيرفر يرسل لحظات ISO والعميل يحرّك العدادات كل دقيقة؛ وضع اليوم يتحدث
 * تلقائيًا كل ٣٠ ثانية. كل الألوان من متغيرات `attendance.css` — صفر hex هنا.
 */

type Chip = "today" | "yesterday" | "week" | "month" | "custom";

const KSA_OFFSET_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;

/** مفتاح يوم الرياض على العميل — الإزاحة ثابتة +٣ فلا حاجة لمكتبة مناطق. */
function ksaKey(msOffsetDays = 0): string {
  return new Date(Date.now() + KSA_OFFSET_MS - msOffsetDays * DAY_MS).toISOString().slice(0, 10);
}

/** حدود الشرائح الجاهزة — كلها بمفاتيح أيام الرياض. */
function chipRange(chip: Chip): { from: string; to: string } | null {
  if (chip === "today") return null;
  if (chip === "yesterday") return { from: ksaKey(1), to: ksaKey(1) };
  if (chip === "week") return { from: ksaKey(6), to: ksaKey(0) };
  if (chip === "month") return { from: `${ksaKey(0).slice(0, 7)}-01`, to: ksaKey(0) };
  return null;
}

const STATE_LABEL: Record<TileState, string> = {
  on: "مداوم",
  late: "متأخر",
  miss: "لم يسجّل",
  exc: "مستثنى",
  done: "أنهى دوامه",
};

const EXC_LABEL: Record<string, string> = {
  FULL_DAY_LEAVE: "إجازة يوم كامل",
  HOURS_EXCUSE: "استئذان ساعات",
  MODIFIED_SHIFT: "دوام معدّل",
  WEEKEND: "الإجازة الأسبوعية",
};

/** لون حالة البلاطة — من متغيرات المصدر الواحد. */
const STATE_VAR: Record<TileState, string> = {
  on: "var(--att-on)",
  late: "var(--att-late)",
  miss: "var(--att-miss)",
  exc: "var(--att-exc)",
  done: "var(--att-done)",
};

export function LiveTab({ initial }: { initial: LiveBoardPayload }) {
  const router = useRouter();
  const [payload, setPayload] = useState<LiveBoardPayload>(initial);
  const [chip, setChip] = useState<Chip>(() => inferChip(initial));
  const [customFrom, setCustomFrom] = useState(initial.mode === "range" ? initial.fromKey : "");
  const [customTo, setCustomTo] = useState(initial.mode === "range" ? initial.toKey : "");
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const chipRef = useRef(chip);
  chipRef.current = chip;

  // دقّة الدقيقة تكفي عدادات البلاط.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async (range: { from: string; to: string } | null) => {
    setLoading(true);
    try {
      const qs = range ? `?from=${range.from}&to=${range.to}` : "";
      const res = await fetch(`/api/attendance/live${qs}`, { cache: "no-store" });
      const data = (await res.json()) as { ok: boolean } & LiveBoardPayload;
      if (data.ok) {
        setPayload(data);
        setNow(Date.now());
      }
    } catch {
      /* الصفوف الحالية تبقى — التحديث القادم يعوّض */
    }
    setLoading(false);
  }, []);

  /** تغيير الشريحة: يحدّث الـURL (حالة قابلة للمشاركة) ويجلب. */
  const applyChip = (next: Chip, custom?: { from: string; to: string }) => {
    setChip(next);
    const range = next === "custom" ? (custom ?? null) : chipRange(next);
    const url = new URL(window.location.href);
    if (range) {
      url.searchParams.set("from", range.from);
      url.searchParams.set("to", range.to);
    } else {
      url.searchParams.delete("from");
      url.searchParams.delete("to");
    }
    window.history.replaceState(null, "", url.toString());
    void load(range);
  };

  // التحديث التلقائي كل ٣٠ ثانية — وضع اليوم فقط والتبويب ظاهر.
  useEffect(() => {
    if (chip !== "today") return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible" && chipRef.current === "today") void load(null);
    }, 30_000);
    return () => clearInterval(t);
  }, [chip, load]);

  return (
    <div className="att-scope space-y-4">
      <DateFilter
        chip={chip}
        customFrom={customFrom}
        customTo={customTo}
        setCustomFrom={setCustomFrom}
        setCustomTo={setCustomTo}
        loading={loading}
        onPick={applyChip}
      />

      {payload.mode === "today" ? (
        <>
          <LiveStrip payload={payload} now={now} />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {payload.rows.map((r) => (
              <TodayTile key={r.id} row={r} now={now} onOpen={() => router.push(`/attendance/${r.id}`)} />
            ))}
          </div>
        </>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {payload.rows.map((r) => (
            <RangeTile key={r.id} row={r} onOpen={() => router.push(`/attendance/${r.id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}

/** يستنتج الشريحة من الحمولة الأولية (الصفحة تقرأ ?from=&to= على الخادم). */
function inferChip(p: LiveBoardPayload): Chip {
  if (p.mode === "today") return "today";
  for (const c of ["yesterday", "week", "month"] as const) {
    const r = chipRange(c);
    if (r && r.from === p.fromKey && r.to === p.toKey) return c;
  }
  return "custom";
}

/* ═══════════════════ فلتر التاريخ ═══════════════════ */

const CHIPS: { key: Chip; label: string }[] = [
  { key: "today", label: "اليوم" },
  { key: "yesterday", label: "أمس" },
  { key: "week", label: "آخر ٧ أيام" },
  { key: "month", label: "هذا الشهر" },
];

function DateFilter({
  chip,
  customFrom,
  customTo,
  setCustomFrom,
  setCustomTo,
  loading,
  onPick,
}: {
  chip: Chip;
  customFrom: string;
  customTo: string;
  setCustomFrom: (v: string) => void;
  setCustomTo: (v: string) => void;
  loading: boolean;
  onPick: (chip: Chip, custom?: { from: string; to: string }) => void;
}) {
  const [openCustom, setOpenCustom] = useState(chip === "custom");

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {CHIPS.map((c) => (
          <button
            key={c.key}
            type="button"
            disabled={loading}
            onClick={() => {
              setOpenCustom(false);
              onPick(c.key);
            }}
            className={`rounded-xl border px-3.5 py-1.5 text-xs font-bold transition-colors disabled:opacity-60 ${
              chip === c.key
                ? "border-transparent bg-[var(--att-text)] text-[var(--att-card)]"
                : "border-[var(--att-line)] text-[var(--att-muted)] hover:text-[var(--att-text)]"
            }`}
          >
            {c.label}
          </button>
        ))}
        <button
          type="button"
          disabled={loading}
          onClick={() => setOpenCustom((v) => !v)}
          className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-1.5 text-xs font-bold transition-colors disabled:opacity-60 ${
            chip === "custom"
              ? "border-transparent bg-[var(--att-text)] text-[var(--att-card)]"
              : "border-[var(--att-line)] text-[var(--att-muted)] hover:text-[var(--att-text)]"
          }`}
        >
          <CalendarRange aria-hidden size={14} strokeWidth={1.8} />
          فترة مخصصة
        </button>
      </div>

      {openCustom && (
        <div className="flex flex-wrap items-end gap-2.5 rounded-2xl border border-[var(--att-line)] bg-[var(--att-card)] p-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-[var(--att-muted)]">من</span>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              dir="ltr"
              className="h-9 rounded-lg border border-[var(--att-line)] bg-[var(--att-bg)] px-2.5 text-xs text-[var(--att-text)] outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-[var(--att-muted)]">إلى</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              dir="ltr"
              className="h-9 rounded-lg border border-[var(--att-line)] bg-[var(--att-bg)] px-2.5 text-xs text-[var(--att-text)] outline-none"
            />
          </label>
          <button
            type="button"
            disabled={loading || !customFrom || !customTo || customFrom > customTo}
            onClick={() => onPick("custom", { from: customFrom, to: customTo })}
            className="h-9 rounded-lg bg-[var(--att-gold)] px-5 text-xs font-bold text-[var(--att-on-gold)] disabled:opacity-50"
          >
            عرض
          </button>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════ الشريط المباشر (وضع اليوم) ═══════════════════ */

function LiveStrip({ payload, now }: { payload: Extract<LiveBoardPayload, { mode: "today" }>; now: number }) {
  const s = payload.summary;
  const clock = useMemo(
    () =>
      new Intl.DateTimeFormat("ar-SA-u-nu-arab", {
        calendar: "gregory",
        timeZone: "Asia/Riyadh",
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(now)),
    [now],
  );

  return (
    <div className="rounded-2xl border border-[var(--att-line)] bg-[var(--att-card)] p-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <span aria-hidden className="att-pulse size-2.5 flex-none rounded-full bg-[var(--att-on)]" />
        <p className="text-sm font-bold text-[var(--att-text)]">{clock}</p>
        <p className="text-[11px] text-[var(--att-muted)]">تحديث تلقائي كل ٣٠ ثانية — بتوقيت الرياض</p>
      </div>

      <div className="mt-3.5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <Indicator label="مداوم الآن" value={toArabicDigits(s.onDuty)} color="var(--att-on)" />
        <Indicator
          label="تأخّر اليوم"
          value={toArabicDigits(s.lateCount)}
          sub={s.lateCount > 0 ? `متوسط ${hmLabel(s.avgLateMinutes, toArabicDigits)}` : undefined}
          color="var(--att-late)"
        />
        <Indicator label="لم يسجّل" value={toArabicDigits(s.missCount)} color="var(--att-miss)" />
        <Indicator
          label="في مشاريع"
          value={toArabicDigits(s.inProjects)}
          sub={s.visitsToday > 0 ? `${toArabicDigits(s.visitsToday)} زيارة اليوم` : undefined}
          color="var(--att-teal)"
        />
        <Indicator
          label="مجموع ساعات اليوم"
          value={hmLabel(s.totalMinutesToday, toArabicDigits)}
          sub={s.avgMinutesToday > 0 ? `متوسط ${hmLabel(s.avgMinutesToday, toArabicDigits)}` : undefined}
          color="var(--att-gold)"
        />
      </div>
    </div>
  );
}

function Indicator({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="rounded-xl border border-[var(--att-line)] bg-[var(--att-card2)] px-3 py-2.5">
      <p className="text-[11px] text-[var(--att-muted)]">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums" style={{ color }}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[10.5px] text-[var(--att-muted)]">{sub}</p>}
    </div>
  );
}

/* ═══════════════════ البلاطة الموحّدة — وضع اليوم ═══════════════════ */

function TodayTile({ row, now, onOpen }: { row: LiveBoardRow; now: number; onOpen: () => void }) {
  const color = STATE_VAR[row.state];
  const active = row.state === "on" || row.state === "late";

  return (
    <button type="button" onClick={onOpen} className="att-tile relative overflow-hidden rounded-2xl border border-[var(--att-line)] bg-[var(--att-card)] p-4 text-right">
      <span aria-hidden className="att-halo" style={{ "--halo": color } as React.CSSProperties} />

      {/* ===== الرأس الثابت ===== */}
      <div className="relative flex items-start gap-2.5">
        <span className="flex size-9 flex-none items-center justify-center rounded-xl border border-[var(--att-line)] bg-[var(--att-card2)] text-sm font-bold text-[var(--att-text)]">
          {row.name.trim().charAt(0)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-[var(--att-text)]">{row.name}</span>
          <span className="mt-0.5 block text-[11px] text-[var(--att-muted)]">
            {active && row.startedAtText
              ? `حضر ${row.startedAtText}`
              : `دوامه ${row.scheduledStartText} · ${targetLabel(row.targetMinutes)}`}
          </span>
        </span>
        <span
          className="flex-none rounded-lg border px-2 py-1 text-[10.5px] font-bold"
          style={{ color, borderColor: `color-mix(in srgb, ${color} 40%, transparent)` }}
        >
          {row.state === "exc" ? (EXC_LABEL[row.exceptionType ?? ""] ?? STATE_LABEL.exc) : STATE_LABEL[row.state]}
        </span>
      </div>

      {/* ===== الجسم حسب الحالة ===== */}
      <div className="relative mt-3.5">
        {active && <OnBody row={row} now={now} />}
        {row.state === "miss" && <MissBody row={row} now={now} />}
        {row.state === "exc" && <ExcBody row={row} />}
        {row.state === "done" && <DoneBody row={row} />}
      </div>

      {row.outOfZoneToday && (
        <p className="relative mt-2.5 text-[10.5px] font-bold text-[var(--att-miss)]">فيه محاولة بصم خارج النطاق اليوم</p>
      )}
    </button>
  );
}

/** «٨ ساعات» أو «٧:٣٠ ساعة». */
function targetLabel(minutes: number): string {
  return minutes % 60 === 0 ? `${toArabicDigits(minutes / 60)} ساعات` : `${hmLabel(minutes, toArabicDigits)} ساعة`;
}

/** مداوم/متأخر: الحلقة + شبكة 2×2 + شريط التقدم + سطر الموقع. */
function OnBody({ row, now }: { row: LiveBoardRow; now: number }) {
  const startedMs = row.startedAtIso ? new Date(row.startedAtIso).getTime() : now;
  const elapsed = Math.max(0, Math.floor((now - startedMs) / 60_000));
  const target = Math.max(1, row.targetMinutes);
  const remaining = Math.max(0, target - elapsed);
  const pct = Math.min(100, Math.round((elapsed / target) * 100));
  const stationSince = row.station ? Math.max(0, Math.floor((now - new Date(row.station.sinceIso).getTime()) / 60_000)) : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3.5">
        {/* الحلقة — conic + @property */}
        <span className="relative inline-flex size-[74px] flex-none items-center justify-center">
          <span
            aria-hidden
            className="att-ring absolute inset-0 rounded-full"
            style={{ "--att-p": `${pct}%`, "--ring": elapsed >= target ? "var(--att-on)" : "var(--att-gold)" } as React.CSSProperties}
          />
          <span className="text-center leading-none">
            <span className="block text-[13.5px] font-bold tabular-nums text-[var(--att-text)]" dir="ltr">
              {elapsed >= target ? "تم" : hmLabel(remaining, toArabicDigits)}
            </span>
            <span className="mt-1 block text-[9px] text-[var(--att-muted)]">{elapsed >= target ? "أكمل" : "الباقي"}</span>
          </span>
        </span>

        {/* شبكة 2×2 */}
        <div className="grid flex-1 grid-cols-2 gap-x-3 gap-y-2">
          <Cell label="حضر" value={row.startedAtText ?? "—"} />
          <Cell label="ينتهي" value={row.endsAtText ?? "—"} />
          <Cell label="أنجز" value={hmLabel(elapsed, toArabicDigits)} />
          <Cell label="زيارات" value={toArabicDigits(row.visitsCount)} />
        </div>
      </div>

      <div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--att-rail)]">
          <div
            className="h-full rounded-full"
            style={{ width: `${pct}%`, background: elapsed >= target ? "var(--att-on)" : "var(--att-gold)" }}
          />
        </div>
        <p className="mt-1.5 flex items-center justify-between text-[11px] text-[var(--att-muted)]">
          <span>
            أنجز <b className="font-bold text-[var(--att-text)]">{hmLabel(elapsed, toArabicDigits)}</b> من {targetLabel(row.targetMinutes)}
          </span>
          <span className="tabular-nums">{toArabicDigits(pct)}٪</span>
        </p>
      </div>

      {row.station && (
        <p className="flex items-center gap-1.5 text-[11.5px] text-[var(--att-muted)]">
          {row.station.kind === "HQ" ? (
            <Building2 aria-hidden size={14} strokeWidth={1.5} style={{ color: "var(--att-seg-hq)" }} />
          ) : (
            <MapPin
              aria-hidden
              size={14}
              strokeWidth={1.5}
              style={{ color: row.station.kind === "OUT" ? "var(--att-seg-out)" : "var(--att-seg-project)" }}
            />
          )}
          <span className="truncate font-medium text-[var(--att-text)]">{row.station.name}</span>
          <span>منذ {hmLabel(stationSince, toArabicDigits)}</span>
        </p>
      )}

      {row.lateMinutes != null && row.lateMinutes > 0 && (
        <p className="text-[11px] font-medium" style={{ color: "var(--att-late)" }}>
          تأخر {hmLabel(row.lateMinutes, toArabicDigits)} عن بداية دوامه
        </p>
      )}
    </div>
  );
}

/** لم يسجّل: كم مضى / أيام الشهر / ساعات الشهر + آخر حضور أو سلسلة الغياب. */
function MissBody({ row, now }: { row: LiveBoardRow; now: number }) {
  const sinceStart = Math.floor((now - new Date(row.accountStartIso).getTime()) / 60_000);
  const started = sinceStart >= 0;

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-3 gap-2">
        <Cell
          label={started ? "مضى على بداية دوامه" : "يبدأ دوامه"}
          value={started ? hmLabel(sinceStart, toArabicDigits) : row.scheduledStartText}
          valueColor={started ? "var(--att-miss)" : undefined}
        />
        <Cell label="أيام الشهر" value={toArabicDigits(row.monthStats.workDays)} />
        <Cell label="ساعات الشهر" value={hmLabel(row.monthStats.totalMinutes, toArabicDigits)} />
      </div>
      {row.absenceStreak >= 2 ? (
        <p className="text-[11px] font-bold text-[var(--att-miss)]">
          {row.absenceStreak >= 3
            ? `${toArabicDigits(row.absenceStreak + 1)} أيام غياب على التوالي`
            : "ثاني يوم على التوالي بلا حضور"}
        </p>
      ) : row.lastSeenText ? (
        <p className="text-[11px] text-[var(--att-muted)]">آخر حضور معروف: {row.lastSeenText}</p>
      ) : (
        <p className="text-[11px] text-[var(--att-muted)]">ما له حضور مسجّل خلال آخر ٣٠ يوم</p>
      )}
    </div>
  );
}

/** مستثنى: نوع الاستثناء + أرقام الشهر + «ما تُحتسب غيابًا». */
function ExcBody({ row }: { row: LiveBoardRow }) {
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2">
        <Cell label="أيام الشهر" value={toArabicDigits(row.monthStats.workDays)} />
        <Cell label="ساعات الشهر" value={hmLabel(row.monthStats.totalMinutes, toArabicDigits)} />
      </div>
      <p className="text-[11px] text-[var(--att-muted)]">
        <span className="font-bold" style={{ color: "var(--att-exc)" }}>
          {EXC_LABEL[row.exceptionType ?? ""] ?? "استثناء"}
        </span>{" "}
        — ما تُحتسب غيابًا
      </p>
    </div>
  );
}

/** أنهى دوامه: حضر/انصرف/ساعات اليوم + النسبة + الزيارات. */
function DoneBody({ row }: { row: LiveBoardRow }) {
  const pct = Math.min(100, Math.round((row.doneMinutes / Math.max(1, row.targetMinutes)) * 100));
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-3 gap-2">
        <Cell label="حضر" value={row.startedAtText ?? "—"} />
        <Cell label="انصرف" value={row.endedAtText ?? "—"} />
        <Cell label="ساعات اليوم" value={hmLabel(row.doneMinutes, toArabicDigits)} />
      </div>
      <p className="flex items-center justify-between text-[11px] text-[var(--att-muted)]">
        <span>
          أنجز <b className="font-bold text-[var(--att-text)]">{toArabicDigits(pct)}٪</b> من هدفه
        </span>
        {row.visitsCount > 0 && <span>{toArabicDigits(row.visitsCount)} زيارات مشاريع</span>}
      </p>
    </div>
  );
}

function Cell({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <span className="block min-w-0">
      <span className="block text-[10px] text-[var(--att-muted)]">{label}</span>
      <span
        className="mt-0.5 block truncate text-[12.5px] font-bold tabular-nums text-[var(--att-text)]"
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </span>
    </span>
  );
}

/* ═══════════════════ بلاطة وضع الفترة ═══════════════════ */

function RangeTile({ row, onOpen }: { row: RangeBoardRow; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="att-tile relative overflow-hidden rounded-2xl border border-[var(--att-line)] bg-[var(--att-card)] p-4 text-right">
      <div className="flex items-start gap-2.5">
        <span className="flex size-9 flex-none items-center justify-center rounded-xl border border-[var(--att-line)] bg-[var(--att-card2)] text-sm font-bold text-[var(--att-text)]">
          {row.name.trim().charAt(0)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-[var(--att-text)]">{row.name}</span>
          <span className="mt-0.5 block text-[11px] text-[var(--att-muted)]">
            دوامه {row.scheduledStartText} · {targetLabel(row.targetMinutes)}
          </span>
        </span>
      </div>

      <div className="mt-3.5 grid grid-cols-4 gap-2">
        <Cell label="ساعات" value={hmLabel(row.totalMinutes, toArabicDigits)} />
        <Cell label="أيام حضور" value={toArabicDigits(row.workDays)} />
        <Cell label="تأخير" value={toArabicDigits(row.lateDays)} valueColor={row.lateDays > 0 ? "var(--att-late)" : undefined} />
        <Cell label="غياب" value={toArabicDigits(row.absentDays)} valueColor={row.absentDays > 0 ? "var(--att-miss)" : undefined} />
      </div>
    </button>
  );
}

export default LiveTab;
