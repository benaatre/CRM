import { requireManager } from "@/lib/auth-guards";
import {
  getAuditLog, getAuditActors, getAuditEmployeeStats, resolveAuditNames,
  AUDIT_CATEGORIES, type AuditCategory,
} from "@/lib/data/audit";
import { formatDateTime, RIYADH_TZ } from "@/lib/format";
import { AutoRefresh } from "@/components/auto-refresh";
import { AuditFilterBar } from "@/components/audit/audit-filter-bar";
import { AuditLogView } from "@/components/audit/audit-log-view";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CATEGORY_VALUES = new Set(AUDIT_CATEGORIES.map((c) => c.value));

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

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; emp?: string; from?: string; to?: string }>;
}) {
  // مركز المراقبة للمالك والمدير (requireManager) — بقرار المالك بعد المراجعة.
  await requireManager();
  const sp = await searchParams;

  const category = sp.type && CATEGORY_VALUES.has(sp.type as AuditCategory) ? (sp.type as AuditCategory) : undefined;
  const userId = sp.emp || undefined;
  const from = riyadhBoundary(sp.from, false);
  const to = riyadhBoundary(sp.to, true);

  const [entries, actors, stats] = await Promise.all([
    getAuditLog({ category, userId, from, to }),
    getAuditActors(),
    getAuditEmployeeStats(from, to),
  ]);
  // حلّ الأسماء لسجلات الصفحة الحالية — استعلامان مجمّعان (لا N+1).
  const names = await resolveAuditNames(entries);

  const todayKey = riyadhDayKey(new Date());
  const yesterdayKey = shiftDayKey(todayKey, -1);
  const when = Object.fromEntries(entries.map((e) => [e.id, auditWhen(e.createdAt, todayKey, yesterdayKey)]));

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <AutoRefresh seconds={30} />
      <header>
        <h1 className="text-2xl font-bold text-foreground">سجل التدقيق</h1>
        <p className="mt-1 text-sm text-muted-foreground">مركز المراقبة: من سوّى إيش ومتى — بأسماء حقيقية ودفعات مجمّعة</p>
      </header>

      <AuditFilterBar
        actors={actors}
        current={{ type: category ?? "", emp: userId ?? "", from: DATE_RE.test(sp.from ?? "") ? sp.from! : "", to: DATE_RE.test(sp.to ?? "") ? sp.to! : "" }}
      />

      <AuditLogView entries={entries} names={names} stats={stats} currentEmp={userId ?? ""} when={when} />
    </div>
  );
}
