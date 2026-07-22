import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { ActivityType, FirstContactStage, LeadStage } from "@prisma/client";
import { markContacted } from "@/lib/auto-distribute";
import { stageLabels, firstContactStageLabels } from "@/lib/labels";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * م-٢ (تدقيق 2026-07): المسار الموحّد لتغيير مرحلة العميل — الكانبان والدرج يمرّان
 * من هنا فيتصرفان بالضبط نفس التصرف:
 *   تحديث المرحلة + lastContact + أختام أول تواصل (إن لم تتحدد) + نشاط STAGE_CHANGE
 *   + markContacted (إيقاف عدّاد السحب — تحريك المرحلة مبادرة من الموظف).
 * لا يُنشئ متابعة CALL مصطنعة (كانت تنفخ عدّادات المكالمات والمتابعات في كل التقارير).
 * حارس CLOSED_LOST (لازم سبب منظّم عبر POST /followups) مسؤولية المستدعي.
 */
export const STAGE_TO_FIRST: Partial<Record<LeadStage, FirstContactStage>> = {
  INTERESTED: FirstContactStage.INTERESTED,
  ATTEMPTED: FirstContactStage.NO_ANSWER,
  CLOSED_LOST: FirstContactStage.NOT_INTERESTED,
};

export type StageChangeLead = {
  id: string;
  stage: LeadStage;
  firstContactStage: FirstContactStage | null;
  firstContactDate: Date | null;
  firstContactAt: Date | null;
};

/** يطبّق تغيير المرحلة داخل tx. يرجّع أختام أول التواصل إن سُجّلت (لنص السجل). */
export async function applyStageChange(
  db: Db,
  lead: StageChangeLead,
  stage: LeadStage,
  userId: string,
  sourceLabel: string,
): Promise<{ firstContact: FirstContactStage | null }> {
  const now = new Date();
  // أول تواصل تلقائيًا: لو ما تحدّدت المرحلة الأولى ونُقل لإحدى مراحل أول التواصل.
  const fc = !lead.firstContactStage ? (STAGE_TO_FIRST[stage] ?? null) : null;

  await db.lead.update({
    where: { id: lead.id },
    data: {
      stage,
      lastContact: now,
      ...(fc
        ? {
            firstContactStage: fc,
            firstContactDate: lead.firstContactDate ?? now,
            firstContactAt: lead.firstContactAt ?? now,
          }
        : {}),
    },
  });
  await db.activity.create({
    data: {
      leadId: lead.id,
      userId,
      type: ActivityType.STAGE_CHANGE,
      note: fc
        ? `تم تسجيل أول تواصل: ${firstContactStageLabels[fc]} (${sourceLabel})`
        : `نُقل إلى «${stageLabels[stage]}» (${sourceLabel})`,
    },
  });
  // تحريك المرحلة = مبادرة تواصل → يوقف عدّاد إعادة التوجيه.
  await markContacted(db, lead.id, now);

  return { firstContact: fc };
}
