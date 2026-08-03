import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { requireUser, isManager } from "@/lib/auth-guards";
import { getLeads, type LeadRow } from "@/lib/data/leads";
import { dayStartKSA, DAY_MS } from "@/lib/ksa-time";
import { buildAgenda } from "@/lib/mobile-agenda";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { greeting, toArabicDigits, waitingBasisOf } from "@/lib/mobile-format";
import { MobileStatTile } from "@/components/mobile/stat-tile";
import { MobileLeadCard } from "@/components/mobile/lead-card";

// البيانات تتغيّر مع كل متابعة — لا تُخزَّن الصفحة.
export const dynamic = "force-dynamic";

export default async function MobileHomePage() {
  const user = await requireUser();

  // لوحة المالك/المدير لها احتياجات مختلفة (بيانات الفريق) — مرحلة لاحقة.
  if (isManager(user.role)) {
    return (
      <div
        className="rounded-xl p-5 text-center"
        style={{ backgroundColor: MOBILE_COLORS.card, color: MOBILE_COLORS.textSecondary }}
      >
        <h1 className="text-base font-medium text-white">لوحة المالك</h1>
        <p className="mt-2 text-sm">قيد الإنشاء</p>
      </div>
    );
  }

  /*
   * مصدر واحد محجَّم بالدور: getLeads (tab=working) — الموظف يرى عملاءه فقط عبر
   * scopeForUser، والتبويب يستبعد المؤرشف والمحجوز/المقفول أصلًا.
   * تجنّبنا getDashboard عمدًا: محجّمة لكنها ~١٥ استعلامًا (قمع + مشاعر + فريق)
   * لا تحتاجها هذي الشاشة.
   */
  const leads = await getLeads({ tab: "working", sort: "activity" });

  const now = new Date();
  // كل التقسيم الزمني من المصدر المشترك — لا منطق تاريخ في هذي الصفحة.
  const { dueToday, overdueRecent, overdueOld, visitsToday, notContacted, notAnswered } =
    buildAgenda(leads, now);
  const overdueCount = overdueRecent.length + overdueOld.length;

  /*
   * «ابدأ بهذول» بحصص لا بأولوية صارمة: التسلسل الصارم (كل المتأخر ثم الزيارات
   * ثم الجدد) كان يجوّع الفئتين الأخريين — ٧٢ متأخرًا تملأ الخمسة دائمًا، فتظهر
   * كلها بزر ذهبي واحد. الحصص تضمن ظهور زيارة اليوم والعميل الجديد.
   */
  const lateSorted = [...overdueRecent, ...dueToday.filter((l) => l.nextFollowup! < now), ...overdueOld];
  const freshUntouched = notContacted.filter((l) => !l.lastContact);

  const TOP_MAX = 5;
  const seen = new Set<string>();
  const top: { lead: LeadRow; late: boolean; reason: string }[] = [];
  const take = (
    rows: LeadRow[],
    quota: number,
    isLate: boolean,
    reasonOf: (l: LeadRow) => string,
  ) => {
    let n = 0;
    for (const l of rows) {
      if (n >= quota || top.length >= TOP_MAX || seen.has(l.id)) continue;
      seen.add(l.id);
      top.push({ lead: l, late: isLate, reason: reasonOf(l) });
      n++;
    }
  };

  // زيارة اليوم أولًا: موعد مثبَّت بساعة لا يُؤجَّل، بخلاف متابعة انزاحت.
  take(visitsToday, 2, false, (l) => `زيارة اليوم ${fmtTime(l.visitAt!)}`);
  take(lateSorted, 2, true, (l) => overdueLabel(l.nextFollowup!, now));
  take(freshUntouched, 1, false, () => "جديد — ما تواصلت معه");
  // ما بقي من مقاعد يملأه الأشد إلحاحًا (المتأخر) ثم الجدد.
  take(lateSorted, TOP_MAX, true, (l) => overdueLabel(l.nextFollowup!, now));
  take(freshUntouched, TOP_MAX, false, () => "جديد — ما تواصلت معه");

  // مهام اليوم = مواعيد اليوم وحدها — نفس رقم عدّاد «متابعات اليوم» بالضبط.
  // (المتراكم له شارته الحمراء المنفصلة، فضمّه هنا كان يعطي رقمين للشيء نفسه.)
  const taskCount = dueToday.length;
  const firstName = (user.name ?? "").trim().split(/\s+/)[0] || "زميلي";

  return (
    <div>
      {/* ===== الترويسة ===== */}
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-[1.0625rem] font-medium text-white">
            {greeting(now)}، {firstName}
          </div>
          <div className="mt-0.5 text-xs" style={{ color: MOBILE_COLORS.textMuted }}>
            عندك {toArabicDigits(taskCount)} {taskWord(taskCount)} اليوم
          </div>
        </div>
        <div
          className="flex size-[34px] shrink-0 items-center justify-center rounded-full text-sm font-semibold"
          style={{ backgroundColor: "#1A1A1D", color: MOBILE_COLORS.gold }}
          aria-hidden
        >
          {firstName.slice(0, 1)}
        </div>
      </header>

      {/* ===== العدّادات ===== */}
      <div className="flex gap-[7px] px-4">
        <MobileStatTile
          count={notContacted.length}
          label="لم يتم التواصل"
          href="/m/new"
          bg={MOBILE_STATUS.danger.bg}
          countColor={MOBILE_STATUS.danger.fg}
          labelColor="#E29A9A"
        />
        <MobileStatTile
          count={notAnswered.length}
          label="لم يرد"
          href="/m/leads?stage=ATTEMPTED"
          countColor={MOBILE_STATUS.warning.fg}
        />
        <MobileStatTile
          count={dueToday.length}
          label="متابعات اليوم"
          href="/m/today"
          countColor={MOBILE_COLORS.gold}
          badge={overdueCount ? `${toArabicDigits(overdueCount)} متأخرة` : undefined}
        />
      </div>

      {/* ===== ابدأ بهذول ===== */}
      <section className="mt-5 px-4">
        <h2 className="mb-2 text-xs" style={{ color: MOBILE_COLORS.textMuted }}>
          ابدأ بهذول
        </h2>

        {top.length === 0 ? (
          <div
            className="flex flex-col items-center gap-2 rounded-xl px-4 py-8 text-center"
            style={{ backgroundColor: MOBILE_COLORS.card }}
          >
            <CheckCircle2 className="size-8" style={{ color: MOBILE_COLORS.textMuted }} aria-hidden />
            <p className="text-sm" style={{ color: MOBILE_COLORS.textSecondary }}>
              خلّصت مهام اليوم 🎉
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-col" style={{ gap: 10 }}>
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
    timeZone: "Asia/Riyadh",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}
