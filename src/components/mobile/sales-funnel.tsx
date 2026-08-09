import type { LeadStage } from "@prisma/client";
import { stageLabels } from "@/lib/labels";
import { STAGE_HEX } from "@/lib/stage-colors";
import { MOBILE_COLORS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";

/**
 * «قمع المبيعات» — data.funnel الجاهز من getDashboard (صفر استعلام جديد).
 * كل المراحل بالترتيب ومنفصلة (قرار المالك: القمع يعكس مسار البيع الحقيقي — لا دمج زيارة).
 * الامتلاء scaleX عبر keyframe m-fillX (transform فقط، يحترم prefers-reduced-motion)،
 * والألوان من المصدر الموحّد STAGE_HEX (ثابتة في الثيمين مثل بقية شارات المراحل).
 */
export function SalesFunnel({ funnel }: { funnel: { stage: LeadStage; count: number }[] }) {
  const max = Math.max(...funnel.map((f) => f.count), 1);
  return (
    <div className="flex flex-col" style={{ gap: 8 }}>
      {funnel.map((f, i) => {
        const ratio = f.count / max;
        // أدنى امتلاء مرئي للمراحل غير الصفرية — الصفر شريط فارغ فعلًا.
        const scale = f.count > 0 ? Math.max(ratio, 0.05) : 0;
        return (
          <div key={f.stage} className="m-rise flex items-center" style={{ gap: 9, animationDelay: `${i * 40}ms` }}>
            <span
              className="flex-none truncate"
              style={{ width: 82, fontSize: "11.5px", fontWeight: 600, color: STAGE_HEX[f.stage] }}
            >
              {stageLabels[f.stage]}
            </span>
            <div
              className="flex-1 overflow-hidden"
              style={{ height: 16, borderRadius: 8, background: MOBILE_COLORS.line2 }}
            >
              <div
                className="m-fillx"
                style={{
                  height: "100%", borderRadius: 8,
                  background: STAGE_HEX[f.stage],
                  transform: `scaleX(${scale})`,
                  animationDelay: `${120 + i * 60}ms`,
                }}
              />
            </div>
            <span
              className="flex-none text-left"
              style={{ minWidth: 30, fontSize: 12, fontWeight: 700, color: STAGE_HEX[f.stage] }}
            >
              {toArabicDigits(f.count)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default SalesFunnel;
