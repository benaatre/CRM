import { UserPlus } from "lucide-react";
import { requireUser, isManager } from "@/lib/auth-guards";
import { getLeads } from "@/lib/data/leads";
import { buildAgenda } from "@/lib/mobile-agenda";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits, waitingBasisOf } from "@/lib/mobile-format";
import { MobileLeadCard } from "@/components/mobile/lead-card";

export const dynamic = "force-dynamic";

export default async function MobileNewPage() {
  const user = await requireUser();
  const manager = isManager(user.role);

  // محجَّم بالدور تلقائيًا (scopeForUser داخل getLeads).
  const leads = await getLeads({ tab: "working", sort: "activity" });
  /*
   * «جديد» = مرحلة NEW — نفس تعريف getNotContactedCount المعتمد في الويب،
   * من المصدر المشترك. الاعتماد على firstContactStage=null كان يضخّم العدد:
   * نتيجة «طلب التواصل في وقت آخر» تتركها فارغة رغم حصول تواصل فعلي.
   * الأطول انتظارًا فوق.
   */
  const fresh = [...buildAgenda(leads).notContacted].sort((a, b) => b.daysWaiting - a.daysWaiting);

  return (
    <div className="flex flex-col" style={{ gap: 14, padding: "0 2px" }}>
      <div className="flex items-baseline" style={{ gap: 9 }}>
        <h1 style={{ fontSize: 21, fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>ينتظرون أول تواصل</h1>
        {fresh.length > 0 && (
          <span
            style={{
              boxSizing: "border-box", fontSize: 13, fontWeight: 600,
              color: MOBILE_STATUS.danger.base, background: MOBILE_STATUS.danger.bg,
              padding: "3px 9px", borderRadius: 8,
            }}
          >
            {toArabicDigits(fresh.length)}
          </span>
        )}
      </div>
      <div style={{ fontSize: "11.5px", color: MOBILE_COLORS.textMuted, marginTop: -8 }}>
        {manager ? "كل من ينتظر أول تواصل" : "سرعة الرد ترفع التحويل ٩ أضعاف · الأطول انتظارًا فوق"}
      </div>

      {fresh.length === 0 ? (
        <EmptyNew />
      ) : (
        <div className="flex flex-col" style={{ gap: 10 }}>
          {fresh.map((l) => (
            <MobileLeadCard key={l.id} lead={l} late waitingBasis={waitingBasisOf(l)} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyNew() {
  return (
    <div
      className="flex flex-col items-center text-center"
      style={{
        boxSizing: "border-box", gap: 9, padding: "34px 16px",
        background: MOBILE_COLORS.card, borderRadius: 16,
        border: `1px solid ${MOBILE_COLORS.border}`,
      }}
    >
      <UserPlus size={34} style={{ color: MOBILE_COLORS.textMuted }} aria-hidden />
      <p style={{ fontSize: "12.5px", color: MOBILE_COLORS.textSecondary }}>
        ما فيه ليدات جديدة تنتظر
      </p>
    </div>
  );
}
