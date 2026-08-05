import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireManager } from "@/lib/auth-guards";
import {
  getAuditLog, getAuditActors, resolveAuditNames, inferFollowupLeads,
  AUDIT_CATEGORIES, type AuditCategory, type AuditEntry, type AuditNameMaps,
} from "@/lib/data/audit";
import { formatDateTime, RIYADH_TZ } from "@/lib/format";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { MobileAuditLog, type AuditRow } from "@/components/mobile/audit-log";

export const dynamic = "force-dynamic";

/*
 * غلاف جوال لسجل التدقيق — يعيد استخدام دوال الديسكتوب نفسها حرفيًا
 * (getAuditLog · getAuditActors · resolveAuditNames · inferFollowupLeads)
 * من `@/lib/data/audit`. لا استعلام جديد ولا منطق أعمال جديد: هذي الصفحة
 * طبقة عرض فقط. صيغ الوقت منسوخة من (app)/audit/page.tsx كما هي.
 */

// مفتاح اليوم (YYYY-MM-DD) بتوقيت الرياض — نسخة الديسكتوب حرفيًا.
function riyadhDayKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: RIYADH_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}
function shiftDayKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}
/** «اليوم/أمس + الساعة» بتوقيت الرياض، والأقدم تاريخ كامل — ميلادي بأرقام عربية. */
function auditWhen(date: Date, todayKey: string, yesterdayKey: string): string {
  const key = riyadhDayKey(date);
  const time = new Intl.DateTimeFormat("ar-SA-u-nu-arab", {
    calendar: "gregory", timeZone: RIYADH_TZ, hour: "numeric", minute: "2-digit",
  }).format(date);
  if (key === todayKey) return `اليوم ${time}`;
  if (key === yesterdayKey) return `أمس ${time}`;
  return formatDateTime(date);
}

// cuid داخل نص summary — نستبدله بالاسم المحلول (نفس نمط الديسكتوب).
const CUID_RE = /\bc[a-z0-9]{24}\b/g;

/** يستبدل المعرّفات في النص بأسمائها؛ الغائب = «عميل محذوف». */
function resolveSummary(summary: string, names: AuditNameMaps): string {
  return summary.replace(CUID_RE, (id) =>
    names.leadNames[id] ?? names.userNames[id] ?? "عنصر محذوف",
  );
}

/** أول معرّف عميل معروف داخل النص — لربط السطر بملفه. */
function leadIdIn(summary: string, names: AuditNameMaps): string | null {
  for (const id of summary.match(CUID_RE) ?? []) if (names.leadNames[id]) return id;
  return null;
}

/** لون النقطة حسب فئة الفعل — من نفس مفاتيح AUDIT_CATEGORIES. */
function dotColor(action: string): string {
  if (action.startsWith("session.") || action.startsWith("auth.")) return MOBILE_STATUS.danger.base;
  if (action.includes("booking")) return MOBILE_STATUS.success.base;
  if (action.includes("archive") || action.includes("delete")) return MOBILE_COLORS.textMuted;
  if (action.includes("followup") || action.includes("stage")) return MOBILE_STATUS.info.base;
  return MOBILE_COLORS.gold;
}

export default async function MobileAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; emp?: string }>;
}) {
  // ⛔ حارس الصلاحية على الخادم — نفس فحص الديسكتوب ((app)/audit/page.tsx:49).
  await requireManager();

  const sp = await searchParams;
  const CATEGORY_VALUES = new Set(AUDIT_CATEGORIES.map((c) => c.value));
  const category = sp.type && CATEGORY_VALUES.has(sp.type as AuditCategory)
    ? (sp.type as AuditCategory)
    : undefined;
  const userId = sp.emp || undefined;

  // نفس دوال الديسكتوب بالضبط — بلا فلاتر تاريخ (الجوال يعرض آخر الصفحة فقط).
  const [entries, actors] = await Promise.all([
    getAuditLog({ category, userId }),
    getAuditActors(),
  ]);
  const inferred = await inferFollowupLeads(entries);
  const names = await resolveAuditNames(entries, Object.values(inferred));

  const todayKey = riyadhDayKey(new Date());
  const yesterdayKey = shiftDayKey(todayKey, -1);

  // كل نصوص العرض تُحسب هنا (خادم) — المكوّن العميل يعرض فقط.
  const rows: AuditRow[] = entries.map((e: AuditEntry) => {
    // المعرّف المصرّح داخل النص أولًا، ثم المستدلّ لسجلات المتابعة القديمة.
    const leadId = leadIdIn(e.summary, names) ?? inferred[e.id] ?? null;
    const key = riyadhDayKey(e.createdAt);
    return {
      id: e.id,
      action: e.action,
      head: resolveSummary(e.summary, names),
      actor: e.userName ?? "النظام",
      leadId,
      leadName: leadId ? (names.leadNames[leadId] ?? null) : null,
      whenText: auditWhen(e.createdAt, todayKey, yesterdayKey),
      fullWhen: formatDateTime(e.createdAt),
      dot: dotColor(e.action),
      group: key === todayKey ? "اليوم" : key === yesterdayKey ? "أمس" : "الأقدم",
    };
  });

  return (
    <div className="m-screen flex flex-col" style={{ gap: 11 }}>
      {/* ===== الترويسة ===== */}
      <div className="flex items-center" style={{ gap: 11 }}>
        <Link
          href="/m/more"
          aria-label="رجوع"
          className="flex items-center justify-center"
          style={{ minWidth: 44, minHeight: 44, marginInlineStart: -10, color: MOBILE_COLORS.textPrimary }}
        >
          <ChevronLeft size={20} strokeWidth={2} style={{ transform: "scaleX(-1)" }} aria-hidden />
        </Link>
        <div>
          <h1 style={{ fontSize: 17, fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>سجل التدقيق</h1>
          <div style={{ fontSize: "11.5px", color: MOBILE_COLORS.textMuted, marginTop: 3 }}>
            مين غيّر وش · توقيت الرياض
          </div>
        </div>
      </div>

      <MobileAuditLog
        rows={rows}
        categories={AUDIT_CATEGORIES.map((c) => ({ value: c.value as string, label: c.label }))}
        actors={actors.map((a) => ({ id: a.id, name: a.name }))}
        currentType={category ?? null}
        currentActor={userId ?? null}
      />
    </div>
  );
}
