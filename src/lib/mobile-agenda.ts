import type { LeadRow } from "@/lib/data/leads";
import { dayStartKSA, DAY_MS } from "@/lib/ksa-time";
import { channelLabel } from "@/lib/labels";

/**
 * أجندة الموظف — **المصدر الوحيد** لتقسيم عملائه زمنيًا.
 *
 * وُجدت لأن /m و/m/today كانا يحسبان التقسيم كلٌّ على حدة، فاختلف الرقمان
 * للشيء نفسه. أي شاشة تعرض «اليوم/متأخر/زيارات» تقرأ من هنا حصرًا.
 */

/** بعد هذا الحدّ يُعتبر التأخير «من زمن» ويُطوى حتى لا يتصدّر الشاشة. */
export const STALE_DAYS = 30;

export type Agenda = {
  /** مواعيد اليوم وحده (بين بداية يوم الرياض ونهايته). */
  dueToday: LeadRow[];
  /** متأخر خلال آخر ٣٠ يومًا — الأحدث تأخّرًا أولًا (الأقرب للإنقاذ). */
  overdueRecent: LeadRow[];
  /** متأخر أكثر من ٣٠ يومًا — الأحدث أولًا كذلك. */
  overdueOld: LeadRow[];
  /** زيارات اليوم مرتّبة بالساعة. */
  visitsToday: LeadRow[];
  /** «لم يتم التواصل»: مرحلة NEW — نفس تعريف getNotContactedCount المعتمد في الويب. */
  notContacted: LeadRow[];
  /** مرحلة «لم يرد». */
  notAnswered: LeadRow[];
  dayStart: Date;
  dayEnd: Date;
};

export function buildAgenda(leads: LeadRow[], now: Date = new Date()): Agenda {
  const dayStart = dayStartKSA(now);
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);
  const staleBefore = new Date(dayStart.getTime() - STALE_DAYS * DAY_MS);

  const dueToday = leads
    .filter((l) => l.nextFollowup && l.nextFollowup >= dayStart && l.nextFollowup < dayEnd)
    .sort((a, b) => a.nextFollowup!.getTime() - b.nextFollowup!.getTime());

  // الأحدث تأخّرًا أولًا: من فات موعده أمس أولى بالإنقاذ ممن فات من ثلاثة أشهر.
  const overdue = leads
    .filter((l) => l.nextFollowup && l.nextFollowup < dayStart)
    .sort((a, b) => b.nextFollowup!.getTime() - a.nextFollowup!.getTime());

  return {
    dueToday,
    overdueRecent: overdue.filter((l) => l.nextFollowup! >= staleBefore),
    overdueOld: overdue.filter((l) => l.nextFollowup! < staleBefore),
    visitsToday: leads
      .filter((l) => l.visitAt && l.visitAt >= dayStart && l.visitAt < dayEnd)
      .sort((a, b) => a.visitAt!.getTime() - b.visitAt!.getTime()),
    // مرحلة NEW حصرًا — «طلب التواصل في وقت آخر» تترك firstContactStage فارغة
    // رغم حصول تواصل فعلي، فالاعتماد عليها يضخّم العدد كذبًا.
    notContacted: leads.filter((l) => l.stage === "NEW"),
    notAnswered: leads.filter((l) => l.stage === "ATTEMPTED"),
    dayStart,
    dayEnd,
  };
}

// ===================== مواعيد اليوم (رئيسية الموظف v2 — البانر + الترس) =====================

/** موعد واحد في يوم الموظف — زيارة أو متابعة أو أول تواصل مع عميل جديد. */
export type DayAppointment = {
  leadId: string;
  name: string;
  phone: string;
  at: Date;
  kind: "visit" | "followup" | "new";
  /** سطر السبب — مركّب من النوع والمرحلة (قرار معتمد: بلا توسعة select للملاحظة الفعلية). */
  reason: string;
};

/**
 * يركّب مواعيد اليوم من الأجندة (زيارات اليوم + مواعيد اليوم) مرتبة بالساعة.
 * العميل بموعد اتصال وزيارة معًا يظهر مرتين — التزامان مستقلان.
 */
export function buildDayAppointments(a: Agenda): DayAppointment[] {
  const visits: DayAppointment[] = a.visitsToday.map((l) => ({
    leadId: l.id,
    name: l.name,
    phone: l.phone,
    at: l.visitAt as Date,
    kind: "visit",
    reason: `زيارة ${l.projectName ?? "مشروع"} — جهّز تفاصيل الوحدات`,
  }));
  const followups: DayAppointment[] = a.dueToday.map((l) => ({
    leadId: l.id,
    name: l.name,
    phone: l.phone,
    at: l.nextFollowup as Date,
    kind: l.stage === "NEW" ? "new" : "followup",
    reason:
      l.stage === "NEW"
        ? `أول تواصل — عميل جديد من ${channelLabel(l.channel)}`
        : l.waitingReason
          ? `موعد متابعة — ${l.waitingReason}`
          : "موعد متابعة مجدول",
  }));
  return [...visits, ...followups].sort((x, y) => x.at.getTime() - y.at.getTime());
}
