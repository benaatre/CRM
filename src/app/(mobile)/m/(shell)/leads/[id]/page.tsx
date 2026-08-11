import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireUser, isManager } from "@/lib/auth-guards";
import { getLeadDetail } from "@/lib/data/leads";
import { getSettings } from "@/lib/data/settings";
import { prisma } from "@/lib/prisma";
import type { FollowUpResult } from "@prisma/client";
import { stageLabel, channelLabel, priorityLabel, activityTypeLabels, followUpResultLabels } from "@/lib/labels";
import { stageChipClass, STAGE_HEX } from "@/lib/stage-colors";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits, waitingLabel, waitingBasisOf } from "@/lib/mobile-format";
import { MobileProfileActions } from "@/components/mobile/profile-actions";
import { LeadProfileV3, type ProfileData } from "@/components/mobile/lead-profile-v3";

export const dynamic = "force-dynamic";

export default async function MobileLeadProfile({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ log?: string }>;
}) {
  const user = await requireUser();
  const [{ id }, sp] = await Promise.all([params, searchParams]);

  // getLeadDetail محجَّمة: الموظف لا يفتح عميل غيره (ترجع null ⇒ 404).
  const lead = await getLeadDetail(id);
  if (!lead) notFound();

  // نفس استعلام صفحة الويب — لاختيار مكان الزيارة في ورقة المتابعة.
  const projects = await prisma.project.findMany({
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });

  const firstContact = lead.firstContactStage === null && lead.followUpsCount === 0;

  // ===== المرحلة د: نسخة الموظف v3 — المدير/المالك على العرض القائم حتى المرحلة هـ =====
  if (!isManager(user.role)) {
    const settings = await getSettings();
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
    return <LeadProfileV3 lead={profile} projects={projects} falLicense={settings.falLicense ?? null} />;
  }
  // نص الانتظار يتبع أساسه (آخر تواصل أم الإسناد) — لا يُخمَّن.
  const basis = waitingBasisOf(lead);

  // الخط الزمني الموحّد: دمج عرضي للمتابعات (المجلوبة أصلًا) مع الأنشطة — الأحدث أولًا.
  const now = new Date();
  const timeline = [
    ...lead.followUps.map((f) => ({ kind: "fu" as const, at: f.createdAt, f })),
    ...lead.activities.map((a) => ({ kind: "act" as const, at: a.createdAt, a })),
  ].sort((x, y) => y.at.getTime() - x.at.getTime());

  const facts: { k: string; v: string; color?: string }[] = [
    { k: "الجوال", v: lead.phone },
    { k: "القناة", v: channelLabel(lead.channel) },
    { k: "الأولوية", v: priorityLabel(lead.priority) },
    { k: "المحاولات", v: toArabicDigits(lead.attempts) },
    { k: "الانتظار", v: waitingLabel(lead.daysWaiting, basis) },
    ...(lead.projectName ? [{ k: "المشروع", v: lead.projectName }] : []),
    ...(lead.nextFollowup ? [{ k: "المتابعة الجاية", v: fmtDateTime(lead.nextFollowup), color: MOBILE_COLORS.gold }] : []),
    ...(lead.visitAt ? [{ k: "موعد الزيارة", v: fmtDateTime(lead.visitAt), color: MOBILE_COLORS.gold }] : []),
  ];

  return (
    <div>
      {/* الترويسة الثابتة */}
      <div
        className="sticky top-0 z-20"
        style={{
          boxSizing: "border-box",
          background: MOBILE_COLORS.bg,
          borderBottom: `1px solid ${MOBILE_COLORS.border}`,
          paddingTop: "env(safe-area-inset-top)",
        }}
      >
        <Link
          href="/m/leads"
          className="flex items-center"
          style={{ minHeight: 44, gap: 5, color: MOBILE_COLORS.textSecondary, fontSize: 13 }}
        >
          <ChevronLeft size={18} style={{ transform: "scaleX(-1)" }} aria-hidden />
          رجوع
        </Link>

        <div className="flex items-start justify-between" style={{ gap: 10, marginTop: 6 }}>
          <div className="min-w-0">
            <h1 className="truncate" style={{ fontSize: 21, fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>
              {lead.name}
            </h1>
            <div style={{ fontSize: "12.5px", color: MOBILE_COLORS.textMuted, marginTop: 5 }}>
              {waitingLabel(lead.daysWaiting, basis)} · {channelLabel(lead.channel)}
            </div>
          </div>
          <span
            className={`shrink-0 whitespace-nowrap border font-semibold ${stageChipClass[lead.stage]}`}
            style={{ fontSize: 11, padding: "5px 10px", borderRadius: 8 }}
          >
            {stageLabel(lead.stage)}
          </span>
        </div>

        <MobileProfileActions
          leadId={lead.id}
          phone={lead.phone}
          leadName={lead.name}
          stage={lead.stage}
          firstContact={firstContact}
          meName={(user.name ?? "").trim().split(/\s+/)[0] || "فريق السلطان"}
          projects={projects}
          autoOpenFollowup={sp.log === "call"}
        />
      </div>

      <div className="flex flex-col" style={{ gap: 16, padding: "14px 0" }}>
        {/* بطاقة الحقائق */}
        <div
          style={{
            boxSizing: "border-box",
            background: MOBILE_COLORS.card,
            border: `1px solid ${MOBILE_COLORS.border}`,
            borderRadius: 16,
            padding: "5px 14px",
          }}
        >
          {facts.map((f, i) => (
            <div
              key={f.k}
              className="flex items-center justify-between"
              style={{
                minHeight: 40,
                fontSize: 13,
                borderBottom: i === facts.length - 1 ? "none" : `1px solid ${MOBILE_COLORS.line3}`,
              }}
            >
              <span style={{ color: MOBILE_COLORS.textMuted }}>{f.k}</span>
              <span dir={f.k === "الجوال" ? "ltr" : undefined} style={{ color: f.color ?? MOBILE_COLORS.textPrimary, fontWeight: 500 }}>
                {f.v}
              </span>
            </div>
          ))}
        </div>

        {/* الخط الزمني */}
        <section>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: MOBILE_COLORS.textPrimary, marginBottom: 14 }}>
            الخط الزمني
          </h2>
          {timeline.length === 0 ? (
            <p style={{ fontSize: "12.5px", color: MOBILE_COLORS.textMuted }}>
              ما فيه أحداث بعد — سجّل أول تواصل.
            </p>
          ) : (
            <div className="flex flex-col">
              {timeline.map((item, i) => (
                <div key={item.kind === "fu" ? `f-${item.f.id}` : `a-${item.a.id}`} className="flex" style={{ gap: 12 }}>
                  <div className="flex flex-none flex-col items-center" style={{ width: 12 }}>
                    <span
                      style={{
                        width: 10, height: 10, borderRadius: 6, marginTop: 4,
                        background: item.kind === "fu" ? fuTone(item.f.result) : STAGE_HEX[lead.stage],
                      }}
                    />
                    {i < timeline.length - 1 && (
                      <span style={{ flex: 1, width: "1.5px", background: MOBILE_COLORS.border }} />
                    )}
                  </div>
                  {item.kind === "fu" ? (
                    <div style={{ flex: 1, paddingBottom: 20 }}>
                      {/* سطر النتيجة */}
                      <div style={{ fontSize: "13.5px", fontWeight: 800, color: MOBILE_COLORS.textPrimary }}>
                        {followUpResultLabels[item.f.result]}
                      </div>
                      {/* الملاحظة — نص ثانوي (لا خافت) حفاظًا على التباين */}
                      {item.f.note && (
                        <div style={{ fontSize: 12, color: MOBILE_COLORS.textSecondary, marginTop: 5, lineHeight: 1.7 }}>
                          {item.f.note}
                        </div>
                      )}
                      {/* شارة الموعد القادم — تظهر فقط لموعد لم يحن بعد */}
                      {item.f.nextDate && item.f.nextDate > now && (
                        <span
                          className="inline-block"
                          style={{
                            boxSizing: "border-box", marginTop: 7, borderRadius: 8,
                            padding: "4px 9px", fontSize: "11.5px", fontWeight: 600,
                            background: MOBILE_STATUS.info.bg,
                            color: MOBILE_STATUS.info.fg,
                            border: `1px solid ${MOBILE_STATUS.info.border}`,
                          }}
                        >
                          🗓️ الموعد القادم: {fmtDateTime(item.f.nextDate)}
                        </span>
                      )}
                      {/* الوقت + المسجّل — سطر مستقل أسفل المحتوى */}
                      <div style={{ fontSize: "10.5px", color: MOBILE_COLORS.textMuted, marginTop: 6 }}>
                        {fmtDateTime(item.f.createdAt)} · {item.f.userName ?? "النظام"}
                      </div>
                    </div>
                  ) : (
                    <div style={{ flex: 1, paddingBottom: 20 }}>
                      <div style={{ fontSize: "13.5px", fontWeight: 600, color: MOBILE_COLORS.textPrimary }}>
                        {activityTypeLabels[item.a.type]}
                      </div>
                      {item.a.note && (
                        <div
                          style={{
                            boxSizing: "border-box",
                            fontSize: "12.5px", color: MOBILE_COLORS.textSecondary,
                            marginTop: 6, lineHeight: 1.65,
                            background: MOBILE_COLORS.card,
                            border: `1px solid ${MOBILE_COLORS.border}`,
                            borderRadius: 12, padding: "9px 11px",
                          }}
                        >
                          {item.a.note}
                        </div>
                      )}
                      {/* الوقت + المسجّل — سطر مستقل (كان الوقت يزاحم العنوان يسارًا) */}
                      <div style={{ fontSize: "10.5px", color: MOBILE_COLORS.textMuted, marginTop: 6 }}>
                        {fmtDateTime(item.a.createdAt)} · {item.a.userName ?? "النظام"}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** لون نقطة المتابعة حسب طبيعة نتيجتها — تصنيف عرض فقط فوق رباعيات الحالة الموجودة. */
function fuTone(result: FollowUpResult): string {
  if (result.startsWith("NOT_INTERESTED")) return MOBILE_STATUS.danger.base;
  if (result.startsWith("NOT_ANSWERED") || result === "NO_ANSWER_INTERESTED") return MOBILE_STATUS.warning.base;
  if (result === "ON_HOLD" || result === "BANK_CHECK" || result === "CALL_LATER" || result === "VISIT_NO_SHOW_RESCHEDULED")
    return MOBILE_STATUS.info.base;
  return MOBILE_STATUS.success.base; // مهتم / زيارة / تفاوض / حجز / موعد
}

function fmtDateTime(d: Date): string {
  return new Intl.DateTimeFormat("ar-SA-u-nu-arab", {
    timeZone: "Asia/Riyadh", dateStyle: "medium", timeStyle: "short",
  }).format(d);
}
