import type { LeadStage } from "@prisma/client";
import { stageLabels } from "@/lib/labels";
import { STAGE_HEX } from "@/lib/stage-colors";
import { SOP } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";

/**
 * «قمع المبيعات» (رئيسية المالك — owner-home-final §٥): ثلاثية علوية
 * (حجز/بيع · زيارة · مهتم) + أشرطة كل مراحل getDashboard().funnel العشر
 * بألوان STAGE_HEX (المصدر الموحّد — لا تكرار لون مرحلة). عرض خادمي خالص،
 * الامتلاء بأنيميشن m-fillx (transform فقط — يحترم تقليل الحركة تلقائيًا).
 */

const ZAIN = { fontFamily: "var(--font-zain), var(--font-sans)", fontVariantNumeric: "tabular-nums" as const };

export function OwnerFunnel({ funnel }: { funnel: { stage: LeadStage; count: number }[] }) {
  const of = (s: LeadStage) => funnel.find((f) => f.stage === s)?.count ?? 0;
  const trio = [
    { label: "حجز/بيع", value: of("RESERVED") + of("CLOSED_WON"), color: SOP.gold2 },
    { label: "زيارة", value: of("VISIT_SCHEDULED"), color: STAGE_HEX.VISIT_SCHEDULED },
    { label: "مهتم", value: of("INTERESTED"), color: STAGE_HEX.INTERESTED },
  ];
  const max = Math.max(...funnel.map((f) => f.count), 1);

  return (
    <>
      {/* الثلاثية العلوية */}
      <div className="grid grid-cols-3" style={{ gap: 8 }}>
        {trio.map((t, i) => (
          <div key={t.label} className="m-raise m-rise text-center" style={{ boxSizing: "border-box", borderRadius: 14, padding: "12px 6px", animationDelay: `${i * 60}ms` }}>
            <div style={{ ...ZAIN, fontSize: 22, fontWeight: 800, color: t.color }}>{toArabicDigits(t.value)}</div>
            <div style={{ fontSize: "8.5px", color: SOP.tx2, marginTop: 2 }}>{t.label}</div>
          </div>
        ))}
      </div>

      {/* أشرطة المراحل كاملة */}
      <div className="m-raise" style={{ boxSizing: "border-box", borderRadius: 16, padding: 13 }}>
        {funnel.map((f, i) => {
          const ratio = f.count / max;
          // أدنى امتلاء مرئي للمراحل غير الصفرية — الصفر شريط فارغ فعلًا.
          const scale = f.count > 0 ? Math.max(ratio, 0.05) : 0;
          return (
            <div key={f.stage} className="flex items-center" style={{ gap: 8, marginBottom: i === funnel.length - 1 ? 0 : 6 }}>
              <span className="flex-none truncate" style={{ width: 70, fontSize: "9.5px", color: SOP.tx2 }}>{stageLabels[f.stage]}</span>
              <span className="flex-1 overflow-hidden" style={{ height: 18, borderRadius: 6, background: SOP.sd, display: "block" }}>
                <i
                  className="m-fillx block"
                  style={{
                    height: "100%", borderRadius: 6, background: STAGE_HEX[f.stage],
                    transform: `scaleX(${scale})`, transformOrigin: "right",
                    animationDelay: `${120 + i * 60}ms`,
                  }}
                />
              </span>
              <span className="flex-none text-start" style={{ ...ZAIN, width: 30, fontSize: 10, fontWeight: 800, color: SOP.tx }}>
                {toArabicDigits(f.count)}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

export default OwnerFunnel;
