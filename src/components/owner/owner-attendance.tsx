"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toArabicDigits } from "@/lib/format";
import { hmLabel } from "@/lib/attendance-ui";
import type { LiveBoardRow, LiveTodayPayload, RangeBoardRow, TileState } from "@/lib/data/attendance";
import { DayTimeline, type TimelineTokens } from "@/components/attendance/day-timeline";

/**
 * «الدوام» — العمود الجانبي (dawam2 من المرجع): بطاقة لكل موظف بعدّاد تنازلي حي.
 *
 * يستهلك `GET /api/attendance/live` كما هو (العقد نهائي): بلا بارامترات = اليوم
 * اللحظي، و`?from=&to=` = ملخّص فترة. السيرفر يرسل لحظات ISO والعميل يحرّك
 * العدادات فقط (نفس فلسفة «البلاط الموحّد»): العدّاد من دوام كل موظف المحدد
 * (targetMinutes) صافيًا من التوقف، ويتجمّد طبيعيًا أثناء «متوقّف» لأن نهاية
 * الدوام تتأخر بمقدار التوقف الجاري.
 */

type LivePayload = ({ ok: boolean } & LiveTodayPayload) | { ok: boolean; mode: "range"; fromKey: string; toKey: string; rows: RangeBoardRow[] };

type Chip = "today" | "yesterday" | "week" | "month";

const KSA_OFFSET_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;

/** مفتاح يوم الرياض على العميل — نفس نمط البلاط الموحّد (الإزاحة ثابتة +٣). */
function ksaKey(offsetDays = 0): string {
  return new Date(Date.now() + KSA_OFFSET_MS - offsetDays * DAY_MS).toISOString().slice(0, 10);
}

function chipRange(chip: Chip): { from: string; to: string } | null {
  if (chip === "today") return null;
  if (chip === "yesterday") return { from: ksaKey(1), to: ksaKey(1) };
  if (chip === "week") return { from: ksaKey(6), to: ksaKey(0) };
  return { from: `${ksaKey(0).slice(0, 7)}-01`, to: ksaKey(0) };
}

const CHIPS: { key: Chip; label: string }[] = [
  { key: "today", label: "اليوم" },
  { key: "yesterday", label: "أمس" },
  { key: "week", label: "أسبوع" },
  { key: "month", label: "شهر" },
];

/** الحالة → التسمية واللون. «متأخر» تبقى «مداوم» أخضر — التأخير وسم جنب الحضور. */
const STATE_META: Record<TileState, { label: string; color: string }> = {
  on: { label: "مداوم", color: "var(--od-won)" },
  late: { label: "مداوم", color: "var(--od-won)" },
  paused: { label: "متوقّف", color: "var(--od-try)" },
  remote: { label: "عن بُعد", color: "var(--od-info, var(--od-t3))" },
  miss: { label: "لم يسجّل", color: "var(--od-red)" },
  exc: { label: "مستثنى", color: "var(--od-later)" },
  done: { label: "أنهى دوامه", color: "var(--od-t3)" },
};

const EXCEPTION_LABEL: Record<string, string> = {
  FULL_DAY_LEAVE: "إجازة يوم كامل",
  WEEKEND: "عطلة أسبوعية",
  HOURS_EXCUSE: "استئذان ساعات",
  MODIFIED_SHIFT: "دوام معدّل",
};

function Tag({ text, color }: { text: string; color: string }) {
  return (
    <span
      className="rounded-md px-1.5 py-0.5 text-[9.5px] font-semibold"
      style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
    >
      {text}
    </span>
  );
}

/** الدقائق المنجزة الحية صافيةً من التوقف — نفس معادلة الشريط المباشر مفكوكة. */
function liveWorkedMs(r: LiveBoardRow, nowMs: number): number {
  if (!r.startedAtIso) return r.doneMinutes * 60_000;
  const pauseLive = r.activePause ? nowMs - new Date(r.activePause.startedIso).getTime() : 0;
  return Math.max(0, nowMs - new Date(r.startedAtIso).getTime() - r.pausedMsBase - pauseLive) + r.doneMinutes * 60_000;
}

/** الباقي للنهاية = (الحضور + الدوام المحدد + التوقف المخصوم) − الآن. */
function remainingMs(r: LiveBoardRow, nowMs: number): number {
  if (!r.startedAtIso) return 0;
  const pauseLive = r.activePause ? nowMs - new Date(r.activePause.startedIso).getTime() : 0;
  const end = new Date(r.startedAtIso).getTime() + r.targetMinutes * 60_000 + r.pausedMsBase + pauseLive;
  return Math.max(0, end - nowMs);
}

function TodayTile({ r, nowMs, onOpen }: { r: LiveBoardRow; nowMs: number; onOpen: () => void }) {
  const meta = STATE_META[r.state];
  const active = r.state === "on" || r.state === "late" || r.state === "paused";
  const workedMin = active ? liveWorkedMs(r, nowMs) / 60_000 : r.doneMinutes;
  // سقف بصري للقيم الشاذة (جلسات قديمة ظهرت «٣٩:٣٢»): الشريط لا يتجاوز ١٠٠٪،
  // والرقم يُعرض كما هو — لا نلمس البيانات.
  const pct = Math.min(100, (workedMin / Math.max(1, r.targetMinutes)) * 100);
  const rem = active ? remainingMs(r, nowMs) : 0;
  const remMin = Math.floor(rem / 60_000);
  const remSec = Math.floor((rem % 60_000) / 1000);

  return (
    <div className="relative mb-[11px] overflow-hidden rounded-2xl p-[15px] last:mb-0" style={{ background: "var(--od-raised2)" }}>
      {/* هالة الحالة */}
      <span aria-hidden className="pointer-events-none absolute -top-8 end-[-30px] size-[130px] rounded-full opacity-30 blur-[45px]" style={{ background: meta.color }} />
      <div className="relative">
        {/* الرأس: الاسم + الحالة + سهم الملف */}
        <div className="mb-2.5 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[14.5px] font-bold text-foreground">
              <span className="truncate">{r.name}</span>
              {r.outOfZoneToday && <Tag text="خارج النطاق" color="var(--od-red)" />}
              {r.autoClosed && <Tag text="جلسة لم تُغلق" color="var(--od-try)" />}
            </div>
            <div className="mt-[3px] flex items-center gap-1.5 text-[11px]" style={{ color: "var(--od-t2)" }}>
              {r.station ? r.station.name : active ? "بلا موقع" : `دوامه ${r.scheduledStartText}`}
              {active && r.endsAtText && <span style={{ color: "var(--od-t3)" }}>· {r.startedAtText} ← {r.endsAtText}</span>}
            </div>
          </div>
          <span className="flex-none rounded-[20px] px-[11px] py-1 text-[10px] font-semibold" style={{ background: `color-mix(in srgb, ${meta.color} 14%, transparent)`, color: meta.color }}>
            {meta.label}
          </span>
          <button
            type="button"
            onClick={onOpen}
            aria-label={`ملف دوام ${r.name}`}
            className="grid size-[26px] flex-none place-items-center rounded-lg transition-colors hover:text-gold"
            style={{ background: "rgba(255,255,255,.04)", color: "var(--od-t3)" }}
          >
            <svg viewBox="0 0 24 24" className="size-[15px]" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" aria-hidden><path d="M15 18l-6-6 6-6" /></svg>
          </button>
        </div>

        {(active || r.state === "done") && (
          <>
            {/* الساعات الكبيرة + العدّاد */}
            <div className="mb-[11px] flex items-end justify-between">
              <div className="flex items-baseline gap-1.5">
                <span className="text-[44px] font-black leading-[.9] text-foreground" style={{ fontFamily: "var(--font-zain), var(--font-sans)", fontVariantNumeric: "tabular-nums" }}>
                  {hmLabel(workedMin, toArabicDigits)}
                </span>
                <span className="text-[13px]" style={{ color: "var(--od-t3)", fontFamily: "var(--font-zain), var(--font-sans)" }}>
                  / {toArabicDigits(Math.round(r.targetMinutes / 60))}س
                </span>
              </div>
              {active ? (
                <span className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1" style={{ background: "var(--od-raised)" }}>
                  <span className={r.state === "paused" ? "" : "animate-pulse"} style={{ color: meta.color }} aria-hidden>
                    <svg viewBox="0 0 24 24" className="size-[11px]" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                  </span>
                  <span className="flex flex-col leading-tight">
                    <span className="inline-flex items-baseline gap-0.5 text-[15px] font-extrabold text-foreground" style={{ fontFamily: "var(--font-zain), var(--font-sans)", fontVariantNumeric: "tabular-nums" }}>
                      {hmLabel(remMin, toArabicDigits)}
                      <span className="text-[9.5px] opacity-70">{toArabicDigits(String(remSec).padStart(2, "0"))}</span>
                    </span>
                    <span className="text-[8px]" style={{ color: "var(--od-t3)" }}>{r.state === "paused" ? "متوقّف مؤقتًا" : "باقي للنهاية"}</span>
                  </span>
                </span>
              ) : (
                <span className="text-[12.5px] font-semibold" style={{ color: "var(--od-t3)" }}>
                  انصراف {r.endedAtText ?? "—"}
                </span>
              )}
            </div>

            {/* شريط التقدم */}
            <div className="mb-3 h-[7px] overflow-hidden rounded" style={{ background: "var(--od-raised)" }}>
              <span className="block h-full rounded transition-[width] duration-1000" style={{ width: `${pct}%`, background: meta.color === "var(--od-t3)" ? "var(--od-won)" : meta.color }} />
            </div>

            {/* القدم: الحضور + التأخير + المنجز */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]" style={{ color: "var(--od-t2)" }}>
              {r.startedAtText && <span>حضور {r.startedAtText}</span>}
              {r.lateMinutes != null && r.lateMinutes > 0 && (
                <span style={{ color: "var(--od-red)" }}>متأخر {toArabicDigits(r.lateMinutes)}د</span>
              )}
              {r.earlyIn && <span style={{ color: "var(--od-won)" }}>حضر مبكرًا</span>}
              {r.activePause && <span style={{ color: "var(--od-try)" }}>توقّف {r.activePause.startedText}</span>}
              <span style={{ marginInlineStart: "auto" }}>أنجز {hmLabel(workedMin, toArabicDigits)}س</span>
            </div>
          </>
        )}

        {r.state === "miss" && (
          <div className="text-[11.5px] leading-relaxed" style={{ color: "var(--od-t2)" }}>
            {r.lastSeenText ? `آخر حضور: ${r.lastSeenText}` : "ما سجّل حضورًا بعد"}
            {r.absenceStreak > 0 && (
              <span className="ms-2" style={{ color: "var(--od-red)" }}>غياب {toArabicDigits(r.absenceStreak)} {r.absenceStreak === 1 ? "يوم" : "أيام"} متتالية</span>
            )}
          </div>
        )}

        {r.state === "exc" && (
          <div className="text-[11.5px]" style={{ color: "var(--od-t2)" }}>
            {EXCEPTION_LABEL[r.exceptionType ?? ""] ?? "استثناء معتمد"}
          </div>
        )}

        {/* سجل اليوم المنسدل — نفس مكوّن لوحة الحوكمة بتوكنز الدشبورد */}
        <DayTimeline userId={r.id} t={OD_TIMELINE_TOKENS} />
      </div>
    </div>
  );
}

/** توكنز السجل بثيم عمود الدوام في لوحة المالك (od). */
const OD_TIMELINE_TOKENS: TimelineTokens = {
  line: "var(--od-hair)", card: "var(--od-raised2)", card2: "var(--od-raised)",
  muted: "var(--od-t2)", text: "var(--foreground)", gold: "var(--gold)",
  green: "var(--od-won)", red: "var(--od-red)", amber: "var(--od-try)",
};

function RangeRow({ r }: { r: RangeBoardRow }) {
  return (
    <div className="mb-[11px] rounded-2xl p-[15px] last:mb-0" style={{ background: "var(--od-raised2)" }}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="truncate text-[13.5px] font-bold text-foreground">{r.name}</span>
        <span className="text-[15px] font-extrabold" style={{ color: "var(--gold)", fontFamily: "var(--font-zain), var(--font-sans)", fontVariantNumeric: "tabular-nums" }}>
          {hmLabel(r.totalMinutes, toArabicDigits)}س
        </span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]" style={{ color: "var(--od-t2)" }}>
        <span>دوام {toArabicDigits(r.workDays)} يوم</span>
        <span style={{ color: r.lateDays ? "var(--od-try)" : undefined }}>تأخير {toArabicDigits(r.lateDays)}</span>
        <span style={{ color: r.absentDays ? "var(--od-red)" : undefined }}>غياب {toArabicDigits(r.absentDays)}</span>
      </div>
    </div>
  );
}

export function OwnerAttendance() {
  const router = useRouter();
  const [chip, setChip] = useState<Chip>("today");
  const [data, setData] = useState<LivePayload | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async (c: Chip) => {
    const range = chipRange(c);
    const url = range ? `/api/attendance/live?from=${range.from}&to=${range.to}` : "/api/attendance/live";
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } catch { /* شبكة — نبقي آخر بيانات */ }
  }, []);

  // الجلب عند تغيير الشريحة + تحديث دوري كل ٣٠ث (نفس إيقاع البلاط الموحّد).
  useEffect(() => {
    load(chip);
    const t = setInterval(() => load(chip), 30_000);
    return () => clearInterval(t);
  }, [chip, load]);

  // نبضة الثانية للعدّاد التنازلي.
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const today = data && data.mode === "today" ? (data as { ok: boolean } & LiveTodayPayload) : null;
  const onDutyText = useMemo(
    () => (today ? `${toArabicDigits(today.summary.onDuty)} مداوم الآن` : "—"),
    [today],
  );

  return (
    <div className="rounded-[18px] border p-3.5" style={{ background: "var(--od-raised)", borderColor: "var(--od-hair)" }}>
      {/* الرأس: عنوان + عدّاد + سهم القسم */}
      <div className="mb-1 flex items-center gap-2">
        <span className="h-[18px] w-1 rounded-sm" style={{ background: "var(--gold)" }} aria-hidden />
        <span className="text-[15px] font-bold text-foreground">الدوام</span>
        <span className="text-[11px]" style={{ color: "var(--od-t3)", fontVariantNumeric: "tabular-nums" }}>{onDutyText}</span>
        <button
          type="button"
          onClick={() => router.push("/attendance")}
          aria-label="فتح حوكمة الدوام"
          className="grid size-7 place-items-center rounded-[9px] transition-colors"
          style={{ background: "var(--od-raised2)", color: "var(--gold)", marginInlineStart: "auto" }}
        >
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" aria-hidden><path d="M15 18l-6-6 6-6" /></svg>
        </button>
      </div>

      {/* فلتر التاريخ */}
      <div className="mb-3.5 mt-2 flex gap-1 rounded-[11px] p-1" style={{ background: "var(--od-raised2)" }}>
        {CHIPS.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setChip(c.key)}
            className="flex-1 whitespace-nowrap rounded-lg px-1.5 py-[7px] text-[11.5px] transition-colors"
            style={c.key === chip ? { background: "var(--gold)", color: "#fff", fontWeight: 600 } : { color: "var(--od-t2)" }}
          >
            {c.label}
          </button>
        ))}
      </div>

      {!data && <div className="grid h-32 place-items-center text-xs" style={{ color: "var(--od-t3)" }}>يحمّل الدوام…</div>}

      {today && today.rows.map((r) => (
        <TodayTile key={r.id} r={r} nowMs={nowMs} onOpen={() => router.push(`/attendance/${r.id}`)} />
      ))}

      {data && data.mode === "range" && (
        data.rows.length === 0
          ? <div className="grid h-24 place-items-center text-xs" style={{ color: "var(--od-t3)" }}>ما فيه بيانات بالفترة</div>
          : data.rows.map((r) => <RangeRow key={r.id} r={r} />)
      )}
    </div>
  );
}
