import { notFound } from "next/navigation";
import { requireClientAccess, requireUser, isManager } from "@/lib/auth-guards";
import { getLeadDetail, getLeadTransferHistory } from "@/lib/data/leads";
import { getSettings } from "@/lib/data/settings";
import { prisma } from "@/lib/prisma";
import { channelLabel, reasonLabel } from "@/lib/labels";
import { elapsedLabel } from "@/lib/mobile-format";
import { LeadProfileV3, type ProfileData, type OwnerExtras } from "@/components/mobile/lead-profile-v3";

export const dynamic = "force-dynamic";

/*
 * ملف العميل v3 (المرحلتان د + هـ) — الصفحة مجمّع بيانات خالص:
 * getLeadDetail المحجّمة (الموظف لا يفتح عميل غيره) + سجل التحويلات (OWNER فقط —
 * ترجع null للأدمن فيختفي تبويبه) + قائمة الموظفين لورقة التحويل. كل الأفعال
 * في المكوّن عبر الأكشنات القائمة بحراسها الخادمية.
 */
export default async function MobileLeadProfile({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ log?: string }>;
}) {
  const user = await requireClientAccess(true);
  const [{ id }, sp] = await Promise.all([params, searchParams]);

  const lead = await getLeadDetail(id);
  if (!lead) notFound();

  const [projects, settings] = await Promise.all([
    // نفس استعلام صفحة الويب — لاختيار مكان الزيارة في ورقة المتابعة.
    prisma.project.findMany({ select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
    getSettings(),
  ]);

  const firstContact = lead.firstContactStage === null && lead.followUpsCount === 0;
  const profile: ProfileData = {
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    stage: lead.stage,
    channel: lead.channel,
    assignedAt: lead.assignedAt,
    lastContact: lead.lastContact,
    nextFollowup: lead.nextFollowup,
    visitAt: lead.visitAt,
    followUpsCount: lead.followUpsCount,
    firstContact,
    purchaseGoal: lead.purchaseGoal,
    purchaseMethod: lead.purchaseMethod,
    priceMin: lead.priceMin,
    priceMax: lead.priceMax,
    sourceId: lead.sourceId,
    preferredAreas: lead.preferredAreas,
    preferredProjects: lead.preferredProjects,
    followUps: lead.followUps,
    activities: lead.activities,
  };

  // إضافات المالك/الأدمن — الحراسة الفعلية بالخادم (الأكشنات محروسة أصلًا).
  let ownerExtras: OwnerExtras | null = null;
  if (isManager(user.role)) {
    const [history, employees] = await Promise.all([
      getLeadTransferHistory(id),
      prisma.user.findMany({
        where: { role: { in: ["EMPLOYEE", "HR"] }, active: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    ]);
    // آخر إسناد فعلي (toName ≠ null) — طريقته المعرّبة لشريحة الموظف المسؤول.
    const lastAssign = history ? [...history.transfers].reverse().find((t) => t.toName !== null) : null;
    ownerExtras = {
      assignedToName: lead.assignedTo?.name ?? null,
      assignMethodLabel: lastAssign ? reasonLabel(lastAssign.reason) : null,
      assignedAgo: lead.assignedAt ? elapsedLabel(lead.assignedAt, new Date()) : null,
      followupsWithCurrent: lead.followUpsCount,
      employees,
      transfers: history?.transfers ?? null,
      allFollowUps: history?.followUps ?? null,
      // تعدد الحجوزات (البند ٣): بطاقة تحصيل مستقلة لكل حجز — المبالغ من bookingCollection لكل حجز.
      bookings: lead.bookings
        .filter((b) => b.collected != null)
        .map((b) => ({
          id: b.id,
          unit: `${b.projectName ?? "وحدة"} — ${b.unitNumber}`,
          collected: b.collected ?? 0,
          remaining: b.remaining ?? 0,
        })),
      canAddPayment: user.role === "OWNER",
      channelText: channelLabel(lead.channel),
    };
  }

  return (
    <LeadProfileV3
      lead={profile}
      projects={projects}
      falLicense={settings.falLicense ?? null}
      meName={(user.name ?? "").trim().split(/\s+/)[0] || "فريق السلطان"}
      autoOpenFollowup={sp.log === "call"}
      ownerExtras={ownerExtras}
    />
  );
}
