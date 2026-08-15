"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";
import { toArabicDigits } from "@/lib/format";
import { hmLabel } from "@/lib/attendance-ui";
import type { LiveBoardRow } from "@/lib/data/attendance";

/**
 * تبويب «مداوم الآن» — بطاقة duty لكل مداوم: حلقة عداد تنازلي (الباقي من
 * دوامه)، مكانه، نهاية دوامه، شريط تقدم «أنجز ٤:٣٥ من ٨ ساعات»، والوسوم.
 *
 * السيرفر يرسل بداية الجلسة والهدف فقط؛ العداد يتحدث كل دقيقة على العميل من
 * `startedAtIso` — لا «باقي» مرسل من الخادم يشيخ بين تحديثين.
 */

/** صف اللوحة بعد عبور حدود السيرفر (التواريخ تصير نصوصًا). */
export type LiveRow = Omit<LiveBoardRow, never>;

const TAG_STYLE: Record<string, string> = {
  on: "border-success/40 text-success",
  late: "border-warning/40 text-warning",
  early: "border-info/40 text-info",
  project: "border-border text-muted-foreground",
};

export function LiveTab({ initialRows }: { initialRows: LiveRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<LiveRow[]>(initialRows);
  const [now, setNow] = useState(() => Date.now());

  // دقّة الدقيقة تكفي العداد — لا ثواني تقفز أمام المالك.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const refresh = () => {
    start(async () => {
      try {
        const res = await fetch("/api/attendance/live", { cache: "no-store" });
        const data = (await res.json()) as { ok: boolean; rows?: LiveRow[] };
        if (data.ok && data.rows) {
          setRows(data.rows);
          setNow(Date.now());
        }
      } catch {
        /* نبقي الصفوف الحالية — زر التحديث يعاد ضغطه */
      }
    });
  };

  const onDuty = rows.filter((r) => r.state === "on");
  const others = rows.filter((r) => r.state !== "on");

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {onDuty.length === 0 ? "ما فيه أحد مداوم الحين" : `${toArabicDigits(onDuty.length)} مداوم الآن — بتوقيت الرياض`}
        </p>
        <button
          type="button"
          onClick={refresh}
          disabled={pending}
          className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground disabled:opacity-60"
        >
          <RotateCw aria-hidden size={13} strokeWidth={1.8} />
          {pending ? "جاري التحديث…" : "تحديث"}
        </button>
      </div>

      {/* ===== بطاقات المداومين ===== */}
      {onDuty.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {onDuty.map((r) => (
            <DutyCard key={r.id} row={r} now={now} onOpen={() => router.push(`/attendance/${r.id}`)} />
          ))}
        </div>
      )}

      {/* ===== البقية: لم يسجّل / منصرف / إجازة ===== */}
      {others.length > 0 && (
        <div className="rounded-2xl border border-border bg-card">
          <p className="border-b border-border px-4 py-3 text-xs font-bold text-muted-foreground">بقية الفريق</p>
          <ul>
            {others.map((r) => (
              <li key={r.id} className="border-b border-border/60 last:border-0">
                <button
                  type="button"
                  onClick={() => router.push(`/attendance/${r.id}`)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-right hover:bg-secondary/40"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-foreground">{r.name}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {r.state === "done"
                        ? `منصرف — أنجز ${hmLabel(r.doneMinutes ?? 0, toArabicDigits)}${r.endedAtText ? ` · انصرف ${r.endedAtText}` : ""}`
                        : r.state === "leave"
                          ? "إجازة معتمدة اليوم"
                          : `لسة ما سجّل حضور — بداية دوامه ${r.scheduledStartText}`}
                    </span>
                  </span>
                  <span
                    className={`flex-none rounded-lg border px-2 py-1 text-[11px] font-bold ${
                      r.state === "done"
                        ? "border-border text-muted-foreground"
                        : r.state === "leave"
                          ? "border-info/40 text-info"
                          : "border-destructive/30 text-destructive"
                    }`}
                  >
                    {r.state === "done" ? "منصرف" : r.state === "leave" ? "إجازة" : "لم يسجّل"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** بطاقة مداوم واحدة — الحلقة والتقدم والوسوم. */
function DutyCard({ row, now, onOpen }: { row: LiveRow; now: number; onOpen: () => void }) {
  const startedMs = row.startedAtIso ? new Date(row.startedAtIso).getTime() : now;
  const elapsedMinutes = Math.max(0, Math.floor((now - startedMs) / 60_000));
  const target = Math.max(1, row.targetMinutes);
  const remainingMinutes = Math.max(0, target - elapsedMinutes);
  const ratio = Math.min(1, elapsedMinutes / target);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="rounded-2xl border border-border bg-card p-4 text-right transition-colors hover:border-foreground/25"
    >
      <div className="flex items-center gap-3.5">
        <CountdownRing ratio={ratio} remainingMinutes={remainingMinutes} overtime={elapsedMinutes >= target} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold text-foreground">{row.name}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {row.inProject && row.projectName ? `في ${row.projectName}` : (row.locationName ?? "—")}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            نهاية دوامه {row.endsAtText ?? "—"}
          </p>
        </div>
      </div>

      {/* شريط التقدم: أنجز ٤:٣٥ من ٨ ساعات */}
      <div className="mt-3">
        <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
          <div
            className={`h-full rounded-full ${elapsedMinutes >= target ? "bg-success" : "bg-foreground/60"}`}
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </div>
        <p className="mt-1.5 text-[11.5px] text-muted-foreground">
          أنجز <b className="font-bold text-foreground">{hmLabel(elapsedMinutes, toArabicDigits)}</b> من{" "}
          {target % 60 === 0 ? `${toArabicDigits(target / 60)} ساعات` : `${hmLabel(target, toArabicDigits)} ساعة`}
        </p>
      </div>

      {/* الوسوم — عرض فقط، ليست مخالفات */}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <Tag style={TAG_STYLE.on}>مداوم</Tag>
        {row.wasLate && <Tag style={TAG_STYLE.late}>تأخر</Tag>}
        {row.earlyIn && <Tag style={TAG_STYLE.early}>حضر بدري</Tag>}
        {row.inProject && <Tag style={TAG_STYLE.project}>في مشروع</Tag>}
        {row.outOfZoneToday && <Tag style="border-destructive/30 text-destructive">محاولة خارج النطاق</Tag>}
      </div>
    </button>
  );
}

function Tag({ children, style }: { children: React.ReactNode; style: string }) {
  return <span className={`rounded-lg border px-2 py-0.5 text-[11px] font-bold ${style}`}>{children}</span>;
}

/**
 * حلقة العداد التنازلي — SVG خفيف: قوس الخلفية كامل، وقوس التقدم بنسبة المنجز،
 * والمنتصف «الباقي من دوامه». أنجز الهدف → الحلقة كلها بلون النجاح.
 */
function CountdownRing({
  ratio,
  remainingMinutes,
  overtime,
}: {
  ratio: number;
  remainingMinutes: number;
  overtime: boolean;
}) {
  const R = 26;
  const C = 2 * Math.PI * R;
  return (
    <span className="relative inline-flex size-[64px] flex-none items-center justify-center">
      <svg viewBox="0 0 64 64" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="32" cy="32" r={R} fill="none" stroke="var(--border)" strokeWidth="4" />
        <circle
          cx="32"
          cy="32"
          r={R}
          fill="none"
          stroke={overtime ? "var(--success)" : "var(--gold)"}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - ratio)}
        />
      </svg>
      <span className="text-center leading-none">
        <span className="block text-[13px] font-bold tabular-nums text-foreground" dir="ltr">
          {overtime ? "✓" : hmLabel(remainingMinutes, toArabicDigits)}
        </span>
        <span className="mt-0.5 block text-[9px] text-muted-foreground">{overtime ? "أكمل" : "الباقي"}</span>
      </span>
    </span>
  );
}

export default LiveTab;
