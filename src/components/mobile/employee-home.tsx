import Link from "next/link";
import type { LeadStage, FollowUpResult, Channel } from "@prisma/client";
import { ChevronLeft, Phone } from "lucide-react";
import { stageLabels, channelLabel, followUpResultLabels } from "@/lib/labels";
import { STAGE_HEX } from "@/lib/stage-colors";
import { MOBILE_COLORS } from "@/lib/mobile-tokens";
import { toArabicDigits, elapsedLabel } from "@/lib/mobile-format";
import { avatarInitials } from "@/lib/mobile-avatar";
import type { DayAppointment } from "@/lib/mobile-agenda";
import type { MyRecentFollowUp } from "@/lib/data/my-log";
import { DiwanTopbar } from "@/components/mobile/diwan-topbar";
import { DiwanDial } from "@/components/mobile/diwan-dial";
import { DiwanInvite } from "@/components/mobile/diwan-invite";
import { DiwanCaroz } from "@/components/mobile/diwan-caroz";
import { AttendanceBadge } from "@/components/mobile/attendance-badge";
import { AttendanceCard } from "@/components/attendance/attendance-card";

/**
 * رئيسية الموظف «الديوان» — مطابقة حرفية للمرجع (بنيةً وقيمًا وترتيبًا):
 * توب بار ← ترويسة (تحية + شارة مداوم + تاريخ + ملخص + دائرة ١٢٨) ← بطاقة
 * الدوام ← موعدك القادم ← كاروسيل متابعات اليوم ← المتراكمة ← ينتظرون أول
 * تواصل ← سجل متابعاتي ← قمع عملائي ← خط + سطر فال.
 *
 * server component عرض خالص: كل البيانات props من مصادر v2 القائمة.
 * المحذوف عن النسخة السابقة (غير موجود بالمرجع): مربعات KPI، بانر الموعد
 * المثبّت (حلّت محله بطاقة .invite)، ترس المواعيد (حل محله الكاروسيل).
 */

const ZAIN = { fontFamily: "var(--font-zain), var(--font-sans)", fontVariantNumeric: "tabular-nums" as const };

export type WaitingLead = {
  id: string;
  name: string;
  phone: string;
  channel: Channel;
  assignedAt: Date | null;
  daysWaiting: number;
};

/** لون نقطة السجل — لوحة الديوان: نجاح أخضر · لم يرد أزرق · تفاوض كهرماني · غير مهتم أحمر. */
function logTone(result: FollowUpResult): string {
  if (result.startsWith("NOT_INTERESTED")) return MOBILE_COLORS.dwRed;
  if (result.startsWith("NOT_ANSWERED") || result === "NO_ANSWER_INTERESTED" || result === "CALL_LATER") return MOBILE_COLORS.dwBlue;
  if (result === "NEGOTIATING" || result === "BANK_CHECK" || result === "ON_HOLD") return MOBILE_COLORS.dwAmber;
  return MOBILE_COLORS.dwGreen;
}

/** «الخميس ١٣ أغسطس ٢٠٢٦» — gregory صريح بتوقيت الرياض (قاعدة ثابتة). */
function dateLabel(d: Date): string {
  return new Intl.DateTimeFormat("ar-SA-u-nu-arab", {
    calendar: "gregory", timeZone: "Asia/Riyadh",
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(d);
}

/** «صباح الخير / مساء الخير» بساعة الرياض. */
function greeting(d: Date): string {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Riyadh", hour: "numeric", hour12: false }).format(d));
  return h < 12 ? "صباح الخير" : "مساء الخير";
}

/** رأس قسم `.sec-h` من المرجع: عنوان ١٢.٥ خفيف متباعد + «الكل» يسارًا. */
function SecH({ title, all, href }: { title: string; all: string; href: string }) {
  return (
    <div className="flex items-baseline justify-between" style={{ margin: "26px 2px 11px" }}>
      <h2 style={{ fontSize: 12.5, fontWeight: 500, letterSpacing: "0.06em", color: MOBILE_COLORS.textSecondary }}>{title}</h2>
      <Link href={href} className="flex items-center" style={{ gap: 4, fontSize: 11.5, fontWeight: 500, color: MOBILE_COLORS.textMuted }}>
        {all}
        <ChevronLeft size={12} strokeWidth={1.8} aria-hidden />
      </Link>
    </div>
  );
}

export function EmployeeHome({
  firstName, companyName, unread, appointments, notes, doneCount, lateCount, doneLeadIds,
  backlogCount, waiting, recent, funnel, totalClients, falLicense,
}: {
  firstName: string;
  companyName: string;
  unread: number;
  appointments: DayAppointment[];
  /** leadId ← نص آخر متابعة (LeadRow.lastNote) — للدعوة والكاروسيل. */
  notes: Record<string, string | null>;
  /** مواعيد اليوم التي سُجّلت لعميلها متابعة اليوم — الدائرة والملخص. */
  doneCount: number;
  /** «المتعثر»: فات وقته بلا إنجاز. */
  lateCount: number;
  doneLeadIds: string[];
  /** المتابعات القديمة المتراكمة (فائتة ما قبل اليوم). */
  backlogCount: number;
  waiting: WaitingLead[];
  recent: MyRecentFollowUp[];
  funnel: { stage: LeadStage; count: number }[];
  totalClients: number;
  falLicense: string | null;
}) {
  const now = new Date();
  const shown = funnel.filter((f) => f.count > 0);
  const maxCount = Math.max(...shown.map((f) => f.count), 1);
  const waitingShown = waiting.slice(0, 3);
  // «التالي بعد Z د» — أول موعد قادم لعميل لم تُنجز متابعته.
  const doneSet = new Set(doneLeadIds);
  const next = appointments.find((a) => a.at.getTime() > now.getTime() && !doneSet.has(a.leadId));
  const nextMin = next ? Math.max(1, Math.round((next.at.getTime() - now.getTime()) / 60_000)) : null;
  // «X باليوم» لتصفية المتراكمة خلال ١٤ يومًا.
  const perDay = backlogCount > 0 ? Math.max(1, Math.ceil(backlogCount / 14)) : 0;

  return (
    <div className="m-screen flex flex-col">
      {/* ===== التوب بار اللاصق ===== */}
      <DiwanTopbar companyName={companyName} unread={unread} />

      {/* ===== الترويسة المدمجة `.head` ===== */}
      <header className="m-rise flex items-center" style={{ padding: "20px 2px 0", gap: 16 }}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center" style={{ gap: 9 }}>
            <h1 className="truncate" style={{ fontSize: 19, fontWeight: 500, letterSpacing: "-0.01em", color: MOBILE_COLORS.textPrimary }}>
              {greeting(now)}، {firstName}
            </h1>
            <AttendanceBadge />
          </div>
          <div style={{ fontSize: 11.5, color: MOBILE_COLORS.textSecondary, marginTop: 6 }}>{dateLabel(now)}</div>
          <div style={{ fontSize: 11.5, color: MOBILE_COLORS.textSecondary, marginTop: 3 }}>
            أنجزت <b style={{ ...ZAIN, fontWeight: 600, color: MOBILE_COLORS.gold }}>{toArabicDigits(doneCount)}</b>
            {lateCount > 0 && (
              <>
                {" "}· متعثر <span style={{ ...ZAIN, fontWeight: 600, color: MOBILE_COLORS.dwAmber }}>{toArabicDigits(lateCount)}</span>
              </>
            )}
            {nextMin !== null && (
              <>
                {" "}· التالي بعد <b style={{ ...ZAIN, fontWeight: 600, color: MOBILE_COLORS.gold }}>{toArabicDigits(nextMin)}</b> د
              </>
            )}
          </div>
        </div>
        <div className="m-rise">
          <DiwanDial done={doneCount} total={appointments.length} />
        </div>
      </header>

      {/* ===== بطاقة الدوام `.attWrap` — margin-top 18 (المرساة لزر الكبسولة) ===== */}
      <div id="att-card" className="m-rise" style={{ marginTop: 18, animationDelay: "60ms" }}>
        <AttendanceCard theme="mobile" />
      </div>

      {/* ===== الموعد القادم `.invite` ===== */}
      <DiwanInvite appointments={appointments} notes={notes} />

      {/* ===== متابعات اليوم `.caroz` ===== */}
      <SecH title="متابعات اليوم" all="القائمة الكاملة" href="/m/today" />
      <DiwanCaroz appointments={appointments} notes={notes} doneLeadIds={doneLeadIds} />

      {/* ===== المتراكمة `.backlog` ===== */}
      {backlogCount > 0 && (
        <div
          className="m-rise flex items-center"
          style={{
            boxSizing: "border-box", gap: 13, padding: "14px 15px", marginTop: 12,
            background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.hair}`, borderRadius: 20,
          }}
        >
          <div className="flex-none" style={{ ...ZAIN, fontSize: 25, fontWeight: 800, lineHeight: 1, color: MOBILE_COLORS.dwAmber }}>
            {toArabicDigits(backlogCount)}
          </div>
          <div className="flex-1">
            <h4 style={{ fontSize: 12.5, fontWeight: 600, color: MOBILE_COLORS.textPrimary }}>متابعات قديمة تنتظر التصفية</h4>
            <p style={{ fontSize: 11, color: MOBILE_COLORS.textSecondary, marginTop: 3, lineHeight: 1.6 }}>
              <span style={ZAIN}>{toArabicDigits(perDay)}</span> باليوم — تتخلص منها خلال <span style={ZAIN}>{toArabicDigits(14)}</span> يوم
            </p>
          </div>
          <Link
            href="/m/today"
            className="m-press flex-none"
            style={{
              boxSizing: "border-box", color: MOBILE_COLORS.dwAmber, borderRadius: 10, padding: "9px 12px",
              fontSize: 11, fontWeight: 600, background: MOBILE_COLORS.sheet,
            }}
          >
            ابدأ التصفية
          </Link>
        </div>
      )}

      {/* ===== ينتظرون أول تواصل `.wrow` ===== */}
      {waiting.length > 0 && (
        <>
          <SecH title="ينتظرون أول تواصل" all={`${toArabicDigits(waiting.length)} ${waiting.length === 1 ? "عميل" : "عملاء"}`} href="/m/leads?stages=NEW" />
          <div className="m-rise overflow-hidden" style={{ background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.hair}`, borderRadius: 20 }}>
            {waitingShown.map((l, i) => {
              const hot = l.assignedAt !== null && now.getTime() - l.assignedAt.getTime() < 60 * 60_000;
              return (
                <div
                  key={l.id}
                  className="flex items-center"
                  style={{
                    boxSizing: "border-box", gap: 11, padding: "11px 13px",
                    borderTop: i === 0 ? "none" : `1px solid ${MOBILE_COLORS.hair}`,
                  }}
                >
                  <span
                    className="flex flex-none items-center justify-center"
                    style={{
                      ...ZAIN, width: 36, height: 36, borderRadius: 12, fontSize: 13, fontWeight: 700,
                      background: MOBILE_COLORS.sheet, color: MOBILE_COLORS.textSecondary,
                    }}
                  >
                    {avatarInitials(l.name)}
                  </span>
                  <Link href={`/m/leads/${l.id}`} className="min-w-0 flex-1" style={{ fontSize: 12.5, fontWeight: 600, color: MOBILE_COLORS.textPrimary }}>
                    <span className="block truncate">{l.name}</span>
                    <small className="block truncate" style={{ fontSize: 10.5, fontWeight: 400, color: MOBILE_COLORS.textMuted, marginTop: 2 }}>
                      {channelLabel(l.channel)}
                    </small>
                  </Link>
                  <span className="flex-none" style={{ fontSize: 10, fontWeight: 600, color: hot ? MOBILE_COLORS.dwAmber : MOBILE_COLORS.textMuted }}>
                    قبل {l.assignedAt ? elapsedLabel(l.assignedAt, now) : `${toArabicDigits(l.daysWaiting)} يوم`}
                  </span>
                  <a
                    href={`tel:${l.phone}`}
                    aria-label={`اتصال بـ${l.name}`}
                    className="m-press flex flex-none items-center justify-center"
                    style={{
                      boxSizing: "border-box", width: 33, height: 33, borderRadius: 10,
                      background: MOBILE_COLORS.sheet, color: MOBILE_COLORS.dwBlue,
                    }}
                  >
                    <Phone size={14} strokeWidth={1.7} aria-hidden />
                  </a>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ===== سجل متابعاتي `.log` ===== */}
      {recent.length > 0 && (
        <>
          <SecH title="سجل متابعاتي" all="الكل" href="/m/today" />
          <div className="m-rise" style={{ background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.hair}`, borderRadius: 20, padding: "2px 14px" }}>
            {recent.map((r, i) => (
              <Link
                key={r.id}
                href={`/m/leads/${r.leadId}`}
                className="flex items-center"
                style={{
                  boxSizing: "border-box", gap: 10, padding: "10px 0", fontSize: 11.5,
                  borderTop: i === 0 ? "none" : `1px solid ${MOBILE_COLORS.hair}`,
                }}
              >
                <span className="flex-none" style={{ width: 6, height: 6, borderRadius: "50%", opacity: 0.8, background: logTone(r.result) }} />
                <span className="min-w-0 flex-1 truncate" style={{ color: MOBILE_COLORS.textSecondary }}>
                  <b style={{ fontWeight: 600, color: MOBILE_COLORS.textPrimary }}>{r.leadName}</b>
                  {" — "}
                  {followUpResultLabels[r.result]}
                </span>
                <span className="flex-none" style={{ fontSize: 9.5, color: MOBILE_COLORS.textMuted }}>
                  قبل {elapsedLabel(r.createdAt, now)}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}

      {/* ===== قمع عملائي `.fun` ===== */}
      {shown.length > 0 && (
        <>
          <SecH title="قمع عملائي" all={`${toArabicDigits(totalClients)} عميل`} href="/m/leads" />
          <div className="m-rise" style={{ background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.hair}`, borderRadius: 20, padding: "14px 15px" }}>
            {shown.map((f) => (
              <div key={f.stage} className="flex items-center" style={{ gap: 10, padding: "4.5px 0" }}>
                <span className="flex-none truncate" style={{ width: 80, fontSize: 11, color: MOBILE_COLORS.textSecondary }}>
                  {stageLabels[f.stage]}
                </span>
                <div className="flex-1 overflow-hidden" style={{ height: 5, borderRadius: 4, background: MOBILE_COLORS.sheet }}>
                  <div
                    style={{
                      height: "100%", borderRadius: 4, opacity: 0.75,
                      width: `${Math.max((f.count / maxCount) * 100, 3)}%`,
                      /* ألوان المراحل: STAGE_HEX المصدر الوحيد (قاعدة المشروع — تتقدم على لوحة المرجع) */
                      background: STAGE_HEX[f.stage],
                      transition: "width .7s cubic-bezier(.23,1,.32,1)",
                    }}
                  />
                </div>
                <span className="flex-none" style={{ ...ZAIN, width: 32, fontSize: 12, fontWeight: 700, color: MOBILE_COLORS.textSecondary }}>
                  {toArabicDigits(f.count)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ===== الخط الخاتم + سطر فال ===== */}
      <div aria-hidden style={{ height: 1, margin: "24px 0 0", background: `linear-gradient(90deg, transparent, ${MOBILE_COLORS.hair}, transparent)` }} />
      {falLicense && (
        <div className="text-center" style={{ margin: "26px 0 0", fontSize: 10, color: MOBILE_COLORS.textMuted }}>
          ترخيص فال (REGA) <span style={ZAIN}>{toArabicDigits(falLicense)}</span>
        </div>
      )}
    </div>
  );
}

export default EmployeeHome;
