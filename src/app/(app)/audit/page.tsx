import { requireManager } from "@/lib/auth-guards";
import { getAuditLog, getAuditActors } from "@/lib/data/audit";
import { formatDate, formatDateTime, RIYADH_TZ } from "@/lib/format";
import { AutoRefresh } from "@/components/auto-refresh";
import { AuditFilterBar } from "@/components/audit/audit-filter-bar";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TYPE_PREFIXES = new Set(["lead", "booking", "user", "availability", "source", "project"]);

// مفتاح اليوم (YYYY-MM-DD) بتوقيت الرياض — لتمييز «اليوم/أمس» بحدود منتصف الليل الرياضي (لا فرق ٢٤ ساعة).
function riyadhDayKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: RIYADH_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function shiftDayKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

// عرض الوقت: «اليوم/أمس + الساعة» بتوقيت الرياض، والأقدم تاريخ+ساعة كامل (ميلادي، أرقام عربية).
function auditWhen(date: Date, todayKey: string, yesterdayKey: string): string {
  const key = riyadhDayKey(date);
  const time = new Intl.DateTimeFormat("ar-SA-u-nu-arab", { calendar: "gregory", timeZone: RIYADH_TZ, hour: "numeric", minute: "2-digit" }).format(date);
  if (key === todayKey) return `اليوم ${time}`;
  if (key === yesterdayKey) return `أمس ${time}`;
  return formatDateTime(date);
}

// تحويل YYYY-MM-DD (بتوقيت الرياض) إلى حدود UTC — الرياض ثابتة +03:00 بلا توقيت صيفي.
function riyadhBoundary(dateStr: string | undefined, endOfDay: boolean): Date | undefined {
  if (!dateStr || !DATE_RE.test(dateStr)) return undefined;
  const d = new Date(`${dateStr}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+03:00`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

const actionColor: Record<string, string> = {
  "booking.created": "text-success",
  "booking.cancelled": "text-destructive",
  "booking.stage": "text-gold",
  "booking.finance": "text-warning",
  "lead.created": "text-info",
  "lead.reassigned": "text-muted-foreground",
};

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; emp?: string; from?: string; to?: string }>;
}) {
  await requireManager();
  const sp = await searchParams;

  const actionPrefix = sp.type && TYPE_PREFIXES.has(sp.type) ? sp.type : undefined;
  const userId = sp.emp || undefined;
  const from = riyadhBoundary(sp.from, false);
  const to = riyadhBoundary(sp.to, true);

  const [entries, actors] = await Promise.all([
    getAuditLog({ actionPrefix, userId, from, to }),
    getAuditActors(),
  ]);

  const todayKey = riyadhDayKey(new Date());
  const yesterdayKey = shiftDayKey(todayKey, -1);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <AutoRefresh seconds={30} />
      <header>
        <h1 className="text-2xl font-bold text-foreground">سجل التدقيق</h1>
        <p className="mt-1 text-sm text-muted-foreground">كل عملية: من غيّر + متى + ماذا — يتحدّث تلقائيًا</p>
      </header>

      <AuditFilterBar
        actors={actors}
        current={{ type: actionPrefix ?? "", emp: userId ?? "", from: DATE_RE.test(sp.from ?? "") ? sp.from! : "", to: DATE_RE.test(sp.to ?? "") ? sp.to! : "" }}
      />

      {entries.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground">ما فيه عمليات مطابقة.</p>
      ) : (
        <ol className="space-y-2">
          {entries.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card p-3">
              <div className="flex items-start gap-3">
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${(actionColor[e.action] ?? "text-muted-foreground").replace("text-", "bg-")}`} />
                <div>
                  <p className="text-sm text-foreground">{e.summary}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{e.userName ?? "النظام"}</p>
                </div>
              </div>
              <div className="shrink-0 text-left text-xs text-muted-foreground" title={formatDate(e.createdAt)}>{auditWhen(e.createdAt, todayKey, yesterdayKey)}</div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
