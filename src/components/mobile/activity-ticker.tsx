import type { AuditEntry, AuditNameMaps } from "@/lib/data/audit";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { elapsedLabel } from "@/lib/mobile-format";

/**
 * تيكر «آخر النشاطات» — آخر ١٠ أحداث من سجل التدقيق عند فتح الصفحة (لقطة، لا تحديث حي).
 * server component خالص: الحركة CSS فقط (m-rise بتتابع) فتحترم prefers-reduced-motion تلقائيًا.
 */

// cuid داخل نص summary — يُستبدل بالاسم المحلول (نفس نمط صفحة /m/audit حرفيًا).
const CUID_RE = /\bc[a-z0-9]{24}\b/g;
const resolveSummary = (summary: string, names: AuditNameMaps): string =>
  summary.replace(CUID_RE, (id) => names.leadNames[id] ?? names.userNames[id] ?? "عنصر محذوف");

/**
 * لون النقطة حسب نوع الحدث: حجز/زيارة أخضر · مرحلة وتوزيع ذهبي · سحب/أمان أحمر ·
 * اتصال/متابعة أزرق · أرشفة وغير المصنّف خافت. الزيارة تُميَّز بنص «زيار» لأن
 * المتابعات كلها action واحد (followup.*).
 */
function toneOf(action: string, summary: string): string {
  if (action.startsWith("booking.")) return MOBILE_STATUS.success.base;
  if (action.startsWith("followup.") && /زيار/.test(summary)) return MOBILE_STATUS.success.base;
  if (action === "lead.stage" || action === "lead.firstStage") return MOBILE_COLORS.gold;
  if (/Pull|warned/i.test(action) || action.startsWith("session.") || action.startsWith("auth.")
    || action.includes("security") || action.includes("delete") || action.startsWith("REVEAL") || action.startsWith("HIDE"))
    return MOBILE_STATUS.danger.base;
  if (action.startsWith("followup.")) return MOBILE_STATUS.info.base;
  if (action.includes("archive")) return MOBILE_COLORS.textMuted;
  if (action.startsWith("lead.")) return MOBILE_COLORS.gold; // توزيع/إسناد/استرجاع
  return MOBILE_COLORS.textMuted;
}

export function ActivityTicker({ entries, names, now }: {
  entries: AuditEntry[];
  names: AuditNameMaps;
  now: Date;
}) {
  return (
    <div className="flex flex-col" style={{ gap: 8 }}>
      {entries.map((e, i) => (
        <div
          key={e.id}
          className="m-rise flex items-start"
          style={{
            boxSizing: "border-box", gap: 10,
            background: MOBILE_COLORS.card,
            border: `1px solid ${MOBILE_COLORS.border}`,
            borderRadius: 13, padding: "10px 12px",
            animationDelay: `${i * 50}ms`,
          }}
        >
          <span
            className="flex-none"
            style={{ width: 7, height: 7, borderRadius: 4, marginTop: 5, background: toneOf(e.action, e.summary) }}
          />
          <span className="flex-1" style={{ fontSize: "12.5px", lineHeight: 1.7, color: MOBILE_COLORS.textPrimary }}>
            <span style={{ fontWeight: 700 }}>{e.userName ?? "النظام"}</span>
            {" — "}
            <span style={{ color: MOBILE_COLORS.textSecondary }}>{resolveSummary(e.summary, names)}</span>
          </span>
          <span className="flex-none whitespace-nowrap" style={{ fontSize: "10.5px", color: MOBILE_COLORS.textMuted, marginTop: 2 }}>
            قبل {elapsedLabel(e.createdAt, now)}
          </span>
        </div>
      ))}
    </div>
  );
}

export default ActivityTicker;
