import "server-only";

// سقوف استقبال الموظف في التوزيع — المصدر الوحيد لحسابهما.
//
// سقفان مستقلان يعملان معًا:
//   ١) سقف النافذة (Settings.distPerEmployeePerWindow خلال Settings.distWindowMin دقيقة)
//      يمنع «الرمي الدفعي»: موظف يستقبل عشرين عميلًا في دقيقة واحدة.
//   ٢) السقف اليومي (User.dailyAssignCap منذ ٠٠:٠٠ بتوقيت الرياض) يحدّ الحمل اليومي.
//
// كلاهما يُحسب بـgroupBy واحد لكل دالة — لا استعلام لكل موظف (كان سيصير N+1 في كل دورة كرون).
//
// المرجع الزمني هو Lead.assignedAt لأنه الختم الوحيد الذي تكتبه كل مسارات الإسناد
// (assignmentData في lib/assignment.ts). فالعدّ يشمل الإسناد اليدوي والتلقائي معًا —
// أي أنه «حمل الموظف اليوم» لا «ما جاءه من المحرك وحده». هذا مقصود: المحرك يحترم
// الحمل الكلي، والتوزيع اليدوي يحذّر عند التجاوز ولا يُمنع (قرار المدير فوق السقف).

import { prisma } from "@/lib/prisma";
import { dayStartKSA } from "@/lib/ksa-time";

/** عدد ما استقبله كل موظف خلال آخر windowMin دقيقة. المفتاح = معرّف الموظف. */
export async function countInWindow(
  userIds: string[],
  now: Date,
  windowMin: number,
): Promise<Map<string, number>> {
  if (userIds.length === 0 || windowMin <= 0) return new Map();
  const since = new Date(now.getTime() - windowMin * 60_000);
  const rows = await prisma.lead.groupBy({
    by: ["assignedToId"],
    where: { assignedToId: { in: userIds }, assignedAt: { gte: since } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.assignedToId as string, r._count._all]));
}

/** عدد ما استقبله كل موظف منذ بداية اليوم (٠٠:٠٠ بتوقيت الرياض). */
export async function countToday(userIds: string[], now: Date): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();
  const rows = await prisma.lead.groupBy({
    by: ["assignedToId"],
    where: { assignedToId: { in: userIds }, assignedAt: { gte: dayStartKSA(now) } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.assignedToId as string, r._count._all]));
}

/**
 * «فاصل الاستقبال» (منظم الوتيرة): يرجّع الموظفين الذين استقبلوا أي عميل خلال آخر
 * gapMin دقيقة — فيُستبعدون من الإسناد الآلي حتى يمر الفاصل (عميل واحد كل X دقائق).
 * المرجع assignedAt أيًّا كان مصدره (يدوي أو آلي): من استلم توًا لا يُرمى عليه ثانٍ فورًا.
 * الإسناد اليدوي نفسه لا يخضع للفاصل — الفلترة تُطبَّق في المسارات الآلية حصرًا.
 */
export async function receiveGapBlockedIds(userIds: string[], gapMin: number, now: Date): Promise<Set<string>> {
  if (userIds.length === 0 || gapMin <= 0) return new Set();
  const since = new Date(now.getTime() - gapMin * 60_000);
  const rows = await prisma.lead.groupBy({
    by: ["assignedToId"],
    where: { assignedToId: { in: userIds }, assignedAt: { gte: since } },
    _count: { _all: true },
  });
  return new Set(rows.map((r) => r.assignedToId as string));
}

export type LimitSettings = {
  distPerEmployeePerWindow: number | null;
  distWindowMin: number;
};

/**
 * يرجّع مجموعة الموظفين الذين بلغوا أيًّا من السقفين (نافذة أو يومي) — فيُستبعدون.
 * استعلامان اثنان فقط مهما كان عدد الموظفين، ويُتخطّى كلٌّ منهما لو سقفه غير مفعّل.
 */
export async function atLimitUserIds(
  userIds: string[],
  caps: Map<string, number | null>, // dailyAssignCap لكل موظف (null = بلا سقف)
  settings: LimitSettings,
  now: Date,
): Promise<Set<string>> {
  const blocked = new Set<string>();
  if (userIds.length === 0) return blocked;

  // ١) سقف النافذة — مشترك لكل الموظفين (من الإعدادات).
  if (settings.distPerEmployeePerWindow != null && settings.distPerEmployeePerWindow > 0) {
    const inWindow = await countInWindow(userIds, now, settings.distWindowMin);
    for (const id of userIds) {
      if ((inWindow.get(id) ?? 0) >= settings.distPerEmployeePerWindow) blocked.add(id);
    }
  }

  // ٢) السقف اليومي — لكل موظف سقفه. نتخطّى الاستعلام كليًا لو ما فيه ولا سقف مضبوط.
  const anyDaily = userIds.some((id) => (caps.get(id) ?? null) != null);
  if (anyDaily) {
    const today = await countToday(userIds, now);
    for (const id of userIds) {
      const cap = caps.get(id) ?? null;
      if (cap != null && cap > 0 && (today.get(id) ?? 0) >= cap) blocked.add(id);
    }
  }

  return blocked;
}
