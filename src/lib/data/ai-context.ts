import "server-only";

import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { stageLabels, channelLabels } from "@/lib/labels";

/** يبني ملخّصًا مضغوطًا (مُحجّمًا بالدور) لتغذية المساعد الذكي — بدون بيانات حساسة زائدة. */
export async function buildAiContext(user: { id: string; role: Role }): Promise<string> {
  const manager = user.role === "OWNER" || user.role === "ADMIN";
  const where = manager ? {} : { assignedToId: user.id };

  const [total, byStage, byChannel, dueFollowups, closedWon, bookingAgg] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.groupBy({ by: ["stage"], where, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["channel"], where, _count: { _all: true } }),
    prisma.lead.count({
      where: { ...where, nextFollowup: { lte: new Date() }, stage: { notIn: ["CLOSED_WON", "CLOSED_LOST"] } },
    }),
    prisma.lead.count({ where: { ...where, stage: "CLOSED_WON" } }),
    prisma.booking.aggregate({
      where: manager ? {} : { sellerId: user.id },
      _sum: { finalPrice: true, deposit: true, collected: true },
      _count: { _all: true },
    }),
  ]);

  const stages: Record<string, number> = {};
  for (const g of byStage) stages[stageLabels[g.stage]] = g._count._all;
  const channels: Record<string, number> = {};
  for (const g of byChannel) channels[channelLabels[g.channel]] = g._count._all;

  const context = {
    دور_المستخدم: manager ? "مدير" : "موظف",
    نطاق_البيانات: manager ? "كل الشركة" : "عملاء الموظف فقط",
    إجمالي_العملاء: total,
    العملاء_حسب_المرحلة: stages,
    العملاء_حسب_القناة: channels,
    متابعات_مستحقّة_اليوم: dueFollowups,
    صفقات_مقفولة: closedWon,
    معدل_التحويل_تقريبي: total > 0 ? `${Math.round((closedWon / total) * 100)}%` : "0%",
    الحجوزات: {
      العدد: bookingAgg._count._all,
      قيمة_بعد_الخصم: bookingAgg._sum.finalPrice ? Number(bookingAgg._sum.finalPrice) : 0,
      إجمالي_العرابين: bookingAgg._sum.deposit ? Number(bookingAgg._sum.deposit) : 0,
      المحصّل: bookingAgg._sum.collected ? Number(bookingAgg._sum.collected) : 0,
    },
  };

  return JSON.stringify(context, null, 2);
}
