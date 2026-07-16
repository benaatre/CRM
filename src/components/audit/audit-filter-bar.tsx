"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

type Actor = { id: string; name: string };

type AuditFilterState = { type: string; emp: string; from: string; to: string };

// مجموعات نوع العملية — كل زر = بادئة action (startsWith). «عملاء» تغطّي lead.stage (الكانبان) تلقائيًا.
const TYPES: { value: string; label: string }[] = [
  { value: "", label: "الكل" },
  { value: "lead", label: "عملاء" },
  { value: "booking", label: "حجوزات" },
  { value: "user", label: "موظفين" },
  { value: "availability", label: "التوفر" },
  { value: "source", label: "المصادر" },
  { value: "project", label: "المشاريع" },
];

const RIYADH_TZ = "Asia/Riyadh";

// مفتاح اليوم (YYYY-MM-DD) بتوقيت الرياض — مستقل عن توقيت متصفح المستخدم.
function riyadhToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: RIYADH_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
// إزاحة مفتاح تقويمي بعدد أيام (تعبر حدود الشهر/السنة بأمان).
function shiftKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

// عنصر مختار: أخضر. غير مختار: رمادي محايد. (نفس لغة شريط فلاتر العملاء.)
function chip(active: boolean) {
  return `rounded-full border px-3 py-1.5 text-xs transition-colors ${active ? "border-[#22c55e] bg-[#22c55e]/15 text-[#22c55e]" : "border-border text-muted-foreground hover:text-foreground"}`;
}
// زر «الكل»: ذهبي عند تفعيله (لا فلتر محدّد).
function chipAll(active: boolean) {
  return `rounded-full border px-3 py-1.5 text-xs transition-colors ${active ? "border-gold bg-gold/15 text-gold" : "border-border text-muted-foreground hover:text-foreground"}`;
}

/**
 * شريط فلترة سجل التدقيق (تاريخ + موظف + نوع) — كله server-side عبر الرابط (AND).
 * البارامترات: ?type= ?emp= ?from= ?to= (from/to بصيغة YYYY-MM-DD بتوقيت الرياض).
 */
export function AuditFilterBar({ actors, current }: { actors: Actor[]; current: AuditFilterState }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function build(patch: Partial<AuditFilterState>): string {
    const next: AuditFilterState = { ...current, ...patch };
    const p = new URLSearchParams();
    if (next.type) p.set("type", next.type);
    if (next.emp) p.set("emp", next.emp);
    if (next.from) p.set("from", next.from);
    if (next.to) p.set("to", next.to);
    const s = p.toString();
    return s ? `/audit?${s}` : "/audit";
  }
  function go(patch: Partial<AuditFilterState>) {
    startTransition(() => router.push(build(patch)));
  }

  // مفاتيح التاريخ المرجعية (بتوقيت الرياض) لتمييز أزرار المدى النشطة.
  const today = riyadhToday();
  const yesterday = shiftKey(today, -1);
  const weekStart = shiftKey(today, -6);

  const isToday = current.from === today && current.to === today;
  const isYesterday = current.from === yesterday && current.to === yesterday;
  const isWeek = current.from === weekStart && current.to === today;
  const isAllDates = !current.from && !current.to;

  const hasFilters = !!current.type || !!current.emp || !!current.from || !!current.to;

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-3">
      {/* فلتر التاريخ */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="ml-1 text-xs text-muted-foreground">التاريخ:</span>
        <button onClick={() => go({ from: "", to: "" })} className={chipAll(isAllDates)}>الكل</button>
        <button onClick={() => go({ from: today, to: today })} className={chip(isToday)}>اليوم</button>
        <button onClick={() => go({ from: yesterday, to: yesterday })} className={chip(isYesterday)}>أمس</button>
        <button onClick={() => go({ from: weekStart, to: today })} className={chip(isWeek)}>آخر ٧ أيام</button>
        <span className="mx-1 text-xs text-muted-foreground">مخصّص:</span>
        <input
          type="date"
          value={current.from}
          max={current.to || undefined}
          onChange={(e) => go({ from: e.target.value })}
          aria-label="من تاريخ"
          className="rounded-lg border border-border bg-background px-2 py-1 text-xs outline-none focus:border-gold"
        />
        <span className="text-xs text-muted-foreground">←</span>
        <input
          type="date"
          value={current.to}
          min={current.from || undefined}
          onChange={(e) => go({ to: e.target.value })}
          aria-label="إلى تاريخ"
          className="rounded-lg border border-border bg-background px-2 py-1 text-xs outline-none focus:border-gold"
        />
      </div>

      {/* فلتر الموظف */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="ml-1 text-xs text-muted-foreground">الموظف:</span>
        <select
          value={current.emp}
          onChange={(e) => go({ emp: e.target.value })}
          aria-label="فلتر الموظف"
          className="select-base w-auto"
        >
          <option value="">كل الموظفين</option>
          {actors.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>

      {/* فلتر النوع */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="ml-1 text-xs text-muted-foreground">النوع:</span>
        {TYPES.map((t) =>
          t.value === "" ? (
            <button key="all" onClick={() => go({ type: "" })} className={chipAll(!current.type)}>{t.label}</button>
          ) : (
            <button key={t.value} onClick={() => go({ type: t.value })} className={chip(current.type === t.value)}>{t.label}</button>
          )
        )}
      </div>

      {(hasFilters || pending) && (
        <div className="flex items-center gap-2">
          {hasFilters && (
            <button
              onClick={() => go({ type: "", emp: "", from: "", to: "" })}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              مسح الكل
            </button>
          )}
          {pending && <span className="text-xs text-muted-foreground">جارٍ التحديث…</span>}
        </div>
      )}
    </div>
  );
}
