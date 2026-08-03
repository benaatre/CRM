import Link from "next/link";
import { Bell, CheckCircle2 } from "lucide-react";
import { requireUser, isManager } from "@/lib/auth-guards";
import { getLeads, type LeadRow } from "@/lib/data/leads";
import { dayStartKSA, DAY_MS } from "@/lib/ksa-time";
import { buildAgenda } from "@/lib/mobile-agenda";
import { channelLabel } from "@/lib/labels";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { greeting, toArabicDigits, waitingBasisOf, elapsedLabel } from "@/lib/mobile-format";
import { MobileLeadCard } from "@/components/mobile/lead-card";
import { UrgencyCard, type UrgencyChip } from "@/components/mobile/urgency-card";
import { MobileOwnerHome } from "@/components/mobile/owner-home";

// البيانات تتغيّر مع كل متابعة — لا تُخزَّن الصفحة.
export const dynamic = "force-dynamic";

export default async function MobileHomePage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const user = await requireUser();
  if (isManager(user.role)) {
    const sp = await searchParams;
    return <MobileOwnerHome user={user} period={sp.p} />;
  }

  /*
   * مصدر واحد محجَّم بالدور: getLeads (tab=working) — الموظف يرى عملاءه فقط عبر
   * scopeForUser، والتبويب يستبعد المؤرشف والمحجوز/المقفول أصلًا.
   */
  const leads = await getLeads({ tab: "working", sort: "activity" });

  const now = new Date();
  // كل التقسيم الزمني من المصدر المشترك — لا منطق تاريخ في هذي الصفحة.
  const { dueToday, overdueRecent, overdueOld, visitsToday, notContacted } = buildAgenda(leads, now);
  const overdueCount = overdueRecent.length + overdueOld.length;
  const taskCount = dueToday.length;
  const firstName = (user.name ?? "").trim().split(/\s+/)[0] || "زميلي";

  /* ===== البطاقة ١: ما تواصلت معهم (أحمر) ===== */
  const untouchedSorted = [...notContacted].sort((a, b) => b.daysWaiting - a.daysWaiting);
  const oldest = untouchedSorted[0];
  const untouchedChips: UrgencyChip[] = untouchedSorted.slice(0, 4).map((l) => ({
    name: l.name,
    sub: `${channelLabel(l.channel)} · من ${l.assignedAt ? elapsedLabel(l.assignedAt, now) : `${toArabicDigits(l.daysWaiting)} يوم`}`,
    dot: l.daysWaiting >= 1 ? MOBILE_STATUS.danger.base : MOBILE_STATUS.warning.base,
    fg: l.daysWaiting >= 1 ? MOBILE_STATUS.danger.fg : MOBILE_STATUS.warning.fg,
  }));

  /* ===== البطاقة ٢: متابعات اليوم (ذهبي) ===== */
  const followupChips: UrgencyChip[] = [
    ...overdueRecent.slice(0, 2).map((l) => ({
      name: l.name,
      sub: `متأخر · ${fmtShort(l.nextFollowup!)}`,
      dot: MOBILE_STATUS.danger.base,
      fg: MOBILE_STATUS.danger.fg,
    })),
    ...dueToday.slice(0, 2).map((l) => ({
      name: l.name,
      sub: `اتصال · ${fmtTime(l.nextFollowup!)}`,
      dot: MOBILE_COLORS.gold,
      fg: MOBILE_COLORS.textPrimary,
    })),
  ];
  const followupSub = [
    overdueCount ? `${toArabicDigits(overdueCount)} متأخرة` : null,
    dueToday[0] ? `أقرب موعد الساعة ${fmtTime(dueToday[0].nextFollowup!)}` : null,
  ].filter(Boolean).join(" · ") || "ما عليك مواعيد اليوم";

  /* ===== البطاقة ٣: زيارات اليوم (أزرق) ===== */
  const visitChips: UrgencyChip[] = visitsToday.slice(0, 3).map((l) => ({
    name: `زيارة — ${l.name}`,
    sub: `${l.projectName ?? "المشروع"} · ${fmtTime(l.visitAt!)}`,
    dot: MOBILE_STATUS.info.base,
    fg: MOBILE_STATUS.info.fg,
  }));

  /* ===== ابدأ بهذول — حصص لا أولوية صارمة ===== */
  const lateSorted = [...overdueRecent, ...dueToday.filter((l) => l.nextFollowup! < now), ...overdueOld];
  const freshUntouched = notContacted.filter((l) => !l.lastContact);
  const TOP_MAX = 5;
  const seen = new Set<string>();
  const top: { lead: LeadRow; late: boolean; reason: string }[] = [];
  const take = (rows: LeadRow[], quota: number, isLate: boolean, reasonOf: (l: LeadRow) => string) => {
    let n = 0;
    for (const l of rows) {
      if (n >= quota || top.length >= TOP_MAX || seen.has(l.id)) continue;
      seen.add(l.id);
      top.push({ lead: l, late: isLate, reason: reasonOf(l) });
      n++;
    }
  };
  take(visitsToday, 2, false, (l) => `زيارة اليوم ${fmtTime(l.visitAt!)}`);
  take(lateSorted, 2, true, (l) => overdueLabel(l.nextFollowup!, now));
  take(freshUntouched, 1, false, () => "جديد — ما تواصلت معه");
  take(lateSorted, TOP_MAX, true, (l) => overdueLabel(l.nextFollowup!, now));
  take(freshUntouched, TOP_MAX, false, () => "جديد — ما تواصلت معه");

  return (
    <div className="flex flex-col" style={{ gap: 16 }}>
      {/* ===== الترويسة (النموذج: جرس ٤٢ بشارة + صورة رمزية ٤٢) ===== */}
      <header className="flex items-start justify-between" style={{ padding: "0 2px" }}>
        <div className="min-w-0">
          <div className="truncate" style={{ fontSize: 21, fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>
            {greeting(now)}، {firstName}
          </div>
          <div style={{ fontSize: 13, color: MOBILE_COLORS.textSecondary, marginTop: 4 }}>
            عندك {toArabicDigits(taskCount)} {taskWord(taskCount)} اليوم
          </div>
        </div>
        <div className="flex items-center" style={{ gap: 9 }}>
          {/* الجرس: لا نظام إشعارات في الجوال بعد — الشارة = المتأخرات (رقم فعلي قابل للفعل) ويفتح متابعات اليوم. */}
          <Link
            href="/m/today"
            aria-label="التنبيهات"
            className="relative flex items-center justify-center"
            style={{
              boxSizing: "border-box", width: 42, height: 42, borderRadius: 14,
              background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
            }}
          >
            <Bell size={19} style={{ color: MOBILE_COLORS.textSecondary }} aria-hidden />
            {overdueCount > 0 && (
              <span
                className="absolute flex items-center justify-center"
                style={{
                  boxSizing: "border-box", top: -6, left: -6, minWidth: 19, height: 19,
                  borderRadius: 10, background: MOBILE_STATUS.danger.base, color: "#FFFFFF",
                  fontSize: 10, fontWeight: 700, padding: "0 5px",
                  border: `2px solid ${MOBILE_COLORS.bg}`,
                }}
              >
                {toArabicDigits(overdueCount)}
              </span>
            )}
          </Link>
          <div
            className="flex items-center justify-center"
            style={{
              boxSizing: "border-box", width: 42, height: 42, borderRadius: 21,
              background: MOBILE_COLORS.sheet, border: `1px solid ${MOBILE_COLORS.border}`,
              fontSize: 16, fontWeight: 600, color: MOBILE_COLORS.gold,
            }}
            aria-hidden
          >
            {firstName.slice(0, 1)}
          </div>
        </div>
      </header>

      {/* ===== البطاقات المجمّعة الثلاث ===== */}
      <div className="flex flex-col" style={{ gap: 11 }}>
        {notContacted.length > 0 && (
          <UrgencyCard
            href="/m/new"
            title="ما تواصلت معهم"
            count={notContacted.length}
            cta="اقتحمهم"
            color={MOBILE_STATUS.danger.base}
            fg={MOBILE_STATUS.danger.fg}
            border={MOBILE_STATUS.danger.border}
            subColor={MOBILE_STATUS.danger.fg}
            sub={
              oldest?.assignedAt
                ? `أقدمهم ينتظر من ${elapsedLabel(oldest.assignedAt, now)} — الرد السريع يرفع التحويل ٩ أضعاف`
                : "الرد السريع يرفع التحويل ٩ أضعاف"
            }
            chips={untouchedChips}
          />
        )}
        <UrgencyCard
          href="/m/today"
          title="متابعات اليوم"
          count={taskCount}
          cta="خلّصها"
          color={MOBILE_COLORS.gold}
          fg={MOBILE_COLORS.textPrimary}
          border={MOBILE_COLORS.goldBorder}
          subColor={MOBILE_COLORS.textMuted}
          sub={followupSub}
          chips={followupChips}
        />
        {visitsToday.length > 0 && (
          <UrgencyCard
            href="/m/today?t=visits"
            title="زيارات وتنبيهات اليوم"
            count={visitsToday.length}
            cta="شوفها"
            color={MOBILE_STATUS.info.base}
            fg={MOBILE_STATUS.info.fg}
            border={MOBILE_STATUS.info.base}
            subColor={MOBILE_STATUS.info.fg}
            sub={`${toArabicDigits(visitsToday.length)} ${visitsToday.length === 1 ? "زيارة" : "زيارات"} على موعد اليوم — أقربها ${fmtTime(visitsToday[0].visitAt!)}`}
            chips={visitChips}
          />
        )}
      </div>

      {/* ===== ابدأ بهذول (١٥/٧٠٠ + مؤشر «ن من م») ===== */}
      <section>
        <div className="flex items-baseline justify-between" style={{ marginTop: 4, padding: "0 2px" }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>ابدأ بهذول</h2>
          {taskCount > 0 && (
            <span style={{ fontSize: "11.5px", color: MOBILE_COLORS.textMuted }}>
              {toArabicDigits(Math.min(top.length, taskCount))} من {toArabicDigits(taskCount)}
            </span>
          )}
        </div>

        {top.length === 0 ? (
          <div
            className="mt-2 flex flex-col items-center gap-2 rounded-xl px-4 py-8 text-center"
            style={{ backgroundColor: MOBILE_COLORS.card }}
          >
            <CheckCircle2 className="size-8" style={{ color: MOBILE_COLORS.textMuted }} aria-hidden />
            <p className="text-sm" style={{ color: MOBILE_COLORS.textSecondary }}>
              خلّصت مهام اليوم 🎉
            </p>
          </div>
        ) : (
          <>
            <div className="mt-2 flex flex-col" style={{ gap: 10 }}>
              {top.map((item) => (
                <MobileLeadCard
                  key={item.lead.id}
                  lead={item.lead}
                  late={item.late}
                  reason={item.reason}
                  waitingBasis={waitingBasisOf(item.lead)}
                />
              ))}
            </div>
            <Link
              href="/m/leads"
              className="flex min-h-11 items-center justify-center text-[0.8125rem]"
              style={{ color: MOBILE_COLORS.textMuted }}
            >
              شوف كل العملاء ›
            </Link>
          </>
        )}
      </section>
    </div>
  );
}

/** تمييز العدد: مفرد «مهمة» ومثنّى «مهمتين» وجمع قلّة «مهام» وتمييز مفرد «مهمة». */
function taskWord(n: number): string {
  if (n === 1) return "مهمة";
  if (n === 2) return "مهمتين";
  if (n <= 10) return "مهام";
  return "مهمة";
}

/** «متأخرة …» — كم انزاح الموعد عن الآن. */
function overdueLabel(due: Date, now: Date): string {
  const days = Math.floor((dayStartKSA(now).getTime() - dayStartKSA(due).getTime()) / DAY_MS);
  if (days <= 0) return "فات موعدها اليوم";
  if (days === 1) return "متأخرة من أمس";
  if (days === 2) return "متأخرة يومين";
  if (days <= 10) return `متأخرة ${toArabicDigits(days)} أيام`;
  return `متأخرة ${toArabicDigits(days)} يومًا`;
}

/** وقت الرياض بصيغة عربية قصيرة (٤:٣٠ م). */
function fmtTime(d: Date): string {
  return new Intl.DateTimeFormat("ar-SA-u-nu-arab", {
    timeZone: "Asia/Riyadh", hour: "numeric", minute: "2-digit",
  }).format(d);
}

/** «أمس ٤:٠٠» أو «٢ أغسطس» — للمتأخرات في الصفوف المصغّرة. */
function fmtShort(d: Date): string {
  const days = Math.floor((dayStartKSA().getTime() - dayStartKSA(d).getTime()) / DAY_MS);
  if (days === 1) return `أمس ${fmtTime(d)}`;
  return new Intl.DateTimeFormat("ar-SA-u-nu-arab", {
    timeZone: "Asia/Riyadh", day: "numeric", month: "short",
  }).format(d);
}
