import Link from "next/link";
import type { LeadStage, FollowUpResult, Channel } from "@prisma/client";
import { ChevronLeft, Phone } from "lucide-react";
import { stageLabels, channelLabel, followUpResultLabels } from "@/lib/labels";
import { STAGE_HEX } from "@/lib/stage-colors";
import { SOP } from "@/lib/mobile-tokens";
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
  if (result.startsWith("NOT_INTERESTED")) return SOP.red;
  if (result.startsWith("NOT_ANSWERED") || result === "NO_ANSWER_INTERESTED" || result === "CALL_LATER") return SOP.blue;
  if (result === "NEGOTIATING" || result === "BANK_CHECK" || result === "ON_HOLD") return SOP.amber;
  return SOP.green;
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
      <h2 style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: "0.06em", color: SOP.tx2 }}>{title}</h2>
      <Link href={href} className="flex items-center" style={{ gap: 4, fontSize: 11.5, fontWeight: 500, color: SOP.mut }}>
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
            <h1 className="truncate" style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-0.01em", color: SOP.tx }}>
              {greeting(now)}، {firstName}
            </h1>
            <AttendanceBadge />
          </div>
          <div style={{ fontSize: 11.5, color: SOP.tx2, marginTop: 6 }}>{dateLabel(now)}</div>
          <div style={{ fontSize: 11.5, color: SOP.tx2, marginTop: 3 }}>
            أنجزت <b style={{ ...ZAIN, fontWeight: 700, color: SOP.green }}>{toArabicDigits(doneCount)}</b>
            {lateCount > 0 && (
              <>
                {" "}· متعثر <span style={{ ...ZAIN, fontWeight: 700, color: SOP.red }}>{toArabicDigits(lateCount)}</span>
              </>
            )}
            {nextMin !== null && (
              <>
                {" "}· التالي بعد <b style={{ ...ZAIN, fontWeight: 700, color: SOP.gold }}>{toArabicDigits(nextMin)}</b> د
              </>
            )}
          </div>
        </div>
        {/* حلقة المهام «N/M» داخل سطح غائر ناعم */}
        <div className="m-rise m-inset flex items-center justify-center" style={{ boxSizing: "border-box", borderRadius: 999, padding: 8 }}>
          <DiwanDial done={doneCount} total={appointments.length} />
        </div>
      </header>

      {/* ===== بطاقة الدوام `.attWrap` — margin-top 18 (المرساة لزر الكبسولة) ===== */}
      <div id="att-card" className="m-rise" style={{ marginTop: 18, animationDelay: "60ms" }}>
        <AttendanceCard theme="mobile" />
      </div>

      {/* ===== الموعد القادم `.invite` ===== */}
      <DiwanInvite appointments={appointments} notes={notes} doneLeadIds={doneLeadIds} />

      {/* ===== متابعات اليوم `.caroz` ===== */}
      <SecH title="متابعات اليوم" all="القائمة الكاملة" href="/m/today" />
      <DiwanCaroz appointments={appointments} notes={notes} doneLeadIds={doneLeadIds} />

      {/* ===== المتراكمة `.backlog` ===== */}
      {backlogCount > 0 && (
        <div
          className="m-raise m-rise flex items-center"
          style={{ boxSizing: "border-box", gap: 13, padding: "14px 15px", marginTop: 12, borderRadius: 20, borderInlineStart: `3px solid ${SOP.amber}` }}
        >
          <div className="flex-none" style={{ ...ZAIN, fontSize: 25, fontWeight: 800, lineHeight: 1, color: SOP.amber }}>
            {toArabicDigits(backlogCount)}
          </div>
          <div className="flex-1">
            <h4 style={{ fontSize: 12.5, fontWeight: 700, color: SOP.tx }}>متابعات قديمة تنتظر التصفية</h4>
            <p style={{ fontSize: 11, color: SOP.tx2, marginTop: 3, lineHeight: 1.6 }}>
              <span style={ZAIN}>{toArabicDigits(perDay)}</span> باليوم — تتخلص منها خلال <span style={ZAIN}>{toArabicDigits(14)}</span> يوم
            </p>
          </div>
          <Link
            href="/m/today?t=late"
            className="m-press-sc flex-none"
            style={{
              boxSizing: "border-box", color: SOP.amber, borderRadius: 10, padding: "9px 12px",
              fontSize: 11, fontWeight: 700, background: `color-mix(in srgb, ${SOP.amber} 14%, transparent)`,
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
          <div className="m-raise m-rise overflow-hidden" style={{ borderRadius: 20 }}>
            {waitingShown.map((l, i) => {
              const hot = l.assignedAt !== null && now.getTime() - l.assignedAt.getTime() < 60 * 60_000;
              return (
                <div
                  key={l.id}
                  className="flex items-center"
                  style={{
                    boxSizing: "border-box", gap: 11, padding: "11px 13px",
                    borderTop: i === 0 ? "none" : `1px solid ${SOP.edge}`,
                  }}
                >
                  <span
                    className="flex flex-none items-center justify-center"
                    style={{
                      ...ZAIN, width: 36, height: 36, borderRadius: 12, fontSize: 13, fontWeight: 800,
                      background: `linear-gradient(135deg, ${SOP.gold2}, ${SOP.gold})`, color: SOP.onGold,
                    }}
                  >
                    {avatarInitials(l.name)}
                  </span>
                  <Link href={`/m/leads/${l.id}`} className="min-w-0 flex-1" style={{ fontSize: 12.5, fontWeight: 600, color: SOP.tx }}>
                    <span className="block truncate">{l.name}</span>
                    <small className="block truncate" style={{ fontSize: 10.5, fontWeight: 400, color: SOP.mut, marginTop: 2 }}>
                      {channelLabel(l.channel)}
                    </small>
                  </Link>
                  <span className="flex-none" style={{ ...ZAIN, fontSize: 10, fontWeight: 600, color: hot ? SOP.amber : SOP.mut }}>
                    قبل {l.assignedAt ? elapsedLabel(l.assignedAt, now) : `${toArabicDigits(l.daysWaiting)} يوم`}
                  </span>
                  <a
                    href={`tel:${l.phone}`}
                    aria-label={`اتصال بـ${l.name}`}
                    className="m-press-sc flex flex-none items-center justify-center"
                    style={{
                      boxSizing: "border-box", width: 36, height: 36, borderRadius: 11,
                      background: `color-mix(in srgb, ${SOP.green} 16%, ${SOP.plane})`, color: SOP.green,
                    }}
                  >
                    <Phone size={15} strokeWidth={2} aria-hidden />
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
          <div className="m-raise m-rise" style={{ borderRadius: 20, padding: "2px 14px" }}>
            {recent.map((r, i) => (
              <Link
                key={r.id}
                href={`/m/leads/${r.leadId}`}
                className="flex items-center"
                style={{
                  boxSizing: "border-box", gap: 10, padding: "10px 0", fontSize: 11.5,
                  borderTop: i === 0 ? "none" : `1px solid ${SOP.edge}`,
                }}
              >
                <span className="flex-none" style={{ width: 7, height: 7, borderRadius: "50%", background: logTone(r.result), boxShadow: `0 0 8px ${logTone(r.result)}` }} />
                <span className="min-w-0 flex-1 truncate" style={{ color: SOP.tx2 }}>
                  <b style={{ fontWeight: 700, color: SOP.tx }}>{r.leadName}</b>
                  {" — "}
                  {followUpResultLabels[r.result]}
                </span>
                <span className="flex-none" style={{ fontSize: 9.5, color: SOP.mut }}>
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
          <div className="m-raise m-rise" style={{ borderRadius: 20, padding: "14px 15px" }}>
            {shown.map((f) => (
              <div key={f.stage} className="flex items-center" style={{ gap: 10, padding: "4.5px 0" }}>
                <span className="flex-none truncate" style={{ width: 80, fontSize: 11, color: SOP.tx2 }}>
                  {stageLabels[f.stage]}
                </span>
                <div className="m-inset flex-1 overflow-hidden" style={{ height: 7, borderRadius: 4 }}>
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
                <span className="flex-none" style={{ ...ZAIN, width: 32, fontSize: 12, fontWeight: 700, color: SOP.tx2 }}>
                  {toArabicDigits(f.count)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ===== الخط الخاتم + سطر فال ===== */}
      <div aria-hidden style={{ height: 1, margin: "24px 0 0", background: `linear-gradient(90deg, transparent, ${SOP.edge2}, transparent)` }} />
      {falLicense && (
        <div className="text-center" style={{ margin: "26px 0 0", fontSize: 10, color: SOP.mut }}>
          ترخيص فال (REGA) <span style={ZAIN}>{toArabicDigits(falLicense)}</span>
        </div>
      )}
    </div>
  );
}

export default EmployeeHome;
