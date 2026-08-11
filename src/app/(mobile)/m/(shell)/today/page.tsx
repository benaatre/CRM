import { requireUser } from "@/lib/auth-guards";
import { getLeads, type LeadRow } from "@/lib/data/leads";
import { getMyRecentFollowups } from "@/lib/data/my-log";
import { getNotifications } from "@/lib/actions/notifications";
import { prisma } from "@/lib/prisma";
import { buildAgenda, buildDayAppointments } from "@/lib/mobile-agenda";
import { channelLabel } from "@/lib/labels";
import { FollowupsScreen, type FuAppointment } from "@/components/mobile/followups-screen";

export const dynamic = "force-dynamic";

/*
 * شاشة «متابعاتي» v3 — مجمّع بيانات خالص:
 * buildAgenda/buildDayAppointments (مصدر التقسيم الوحيد) لليوم، والفائت القديم
 * والقادم يُشتقّان من نفس صفوف getLeads (عرض فقط)، والسجل من getMyRecentFollowups
 * الموسّعة (take/skip + note/nextDate — توسعة معلنة). الأفعال كلها بالأوراق القائمة.
 */

function toAppointment(l: LeadRow, at: Date, kind: FuAppointment["kind"]): FuAppointment {
  return {
    leadId: l.id,
    name: l.name,
    phone: l.phone,
    at,
    kind,
    reason:
      kind === "visit"
        ? `زيارة ${l.projectName ?? "مشروع"}`
        : kind === "new"
          ? `أول تواصل — عميل جديد من ${channelLabel(l.channel)}`
          : l.waitingReason
            ? `موعد متابعة — ${l.waitingReason}`
            : "موعد متابعة مجدول",
    stage: l.stage,
    firstContact: l.stage === "NEW" && l.followUpsCount === 0,
  };
}

export default async function MobileTodayPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;

  const [leads, log, notif, projects] = await Promise.all([
    getLeads({ tab: "working", sort: "activity" }),
    getMyRecentFollowups(user.id, 40),
    getNotifications(),
    // نفس استعلام ملف العميل — لخيارات مكان الزيارة في ورقة المتابعة.
    prisma.project.findMany({ select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
  ]);

  const agenda = buildAgenda(leads);
  const { dayStart, dayEnd } = agenda;

  // اليوم (بما فيه الفائت اليوم) — نفس مصدر الرئيسية حرفيًا، مع مرحلة/أول-تواصل للورقة.
  const byId = new Map(leads.map((l) => [l.id, l]));
  const todayAppointments: FuAppointment[] = buildDayAppointments(agenda).map((a) => {
    const l = byId.get(a.leadId)!;
    return { ...a, stage: l.stage, firstContact: l.stage === "NEW" && l.followUpsCount === 0 };
  });

  // الفائت من الأيام السابقة: متابعات متأخرة (الأحدث أولًا — ترتيب الأجندة) + زيارات معلّقة قديمة.
  const oldVisits = leads
    .filter((l) => l.stage === "VISIT_SCHEDULED" && l.visitAt && l.visitAt < dayStart)
    .sort((a, b) => b.visitAt!.getTime() - a.visitAt!.getTime())
    .map((l) => toAppointment(l, l.visitAt as Date, "visit"));
  const missedOld: FuAppointment[] = [
    ...[...agenda.overdueRecent, ...agenda.overdueOld].map((l) =>
      toAppointment(l, l.nextFollowup as Date, l.stage === "NEW" ? "new" : "followup"),
    ),
    ...oldVisits,
  ];

  // القادمة (بعد اليوم): مواعيد متابعة مستقبلية + زيارات مجدولة مستقبلية — مرتبة زمنيًا.
  const upcoming: FuAppointment[] = [
    ...leads
      .filter((l) => l.nextFollowup && l.nextFollowup >= dayEnd)
      .map((l) => toAppointment(l, l.nextFollowup as Date, l.stage === "NEW" ? "new" : "followup")),
    ...leads
      .filter((l) => l.stage === "VISIT_SCHEDULED" && l.visitAt && l.visitAt >= dayEnd)
      .map((l) => toAppointment(l, l.visitAt as Date, "visit")),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  return (
    <FollowupsScreen
      todayAppointments={todayAppointments}
      missedOld={missedOld}
      upcoming={upcoming}
      log={log}
      unread={notif.unread}
      projects={projects}
      initialTab={sp.t}
    />
  );
}
