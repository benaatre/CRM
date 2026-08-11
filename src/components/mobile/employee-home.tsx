import Link from "next/link";
import type { LeadStage, FollowUpResult, Channel } from "@prisma/client";
import { stageLabels, channelLabel, followUpResultLabels } from "@/lib/labels";
import { STAGE_HEX } from "@/lib/stage-colors";
import { MOBILE_COLORS } from "@/lib/mobile-tokens";
import { toArabicDigits, elapsedLabel } from "@/lib/mobile-format";
import { avatarInitials } from "@/lib/mobile-avatar";
import { waPhone } from "@/lib/value-normalize";
import type { DayAppointment } from "@/lib/mobile-agenda";
import type { MyRecentFollowUp } from "@/lib/data/my-log";
import { MobileHeaderActions } from "@/components/mobile/header-actions";
import { NextAppointmentBanner } from "@/components/mobile/next-appointment-banner";
import { AppointmentsWheel } from "@/components/mobile/appointments-wheel";
import { EmployeeKpis } from "@/components/mobile/employee-kpis";

/**
 * رئيسية الموظف v2 (التصميم المعتمد) — server component يجمّع الأقسام:
 * ترويسة ← بانر «موعدك القادم» (client) ← مربعات ٢×٢ (client) ← ترس المواعيد (client)
 * ← ينتظرون تواصلك ← سجل متابعاتي ← قمع عملائي. عرض خالص: كل البيانات props.
 */

const ZAIN = { fontFamily: "var(--font-zain), var(--font-sans)" };

export type WaitingLead = {
  id: string;
  name: string;
  phone: string;
  channel: Channel;
  assignedAt: Date | null;
  daysWaiting: number;
};

/** لون نقطة نتيجة المتابعة — لوحة v2: نجاح أخضر · لم يرد أزرق · تفاوض كهرماني · غير مهتم أحمر. */
function logTone(result: FollowUpResult): string {
  if (result.startsWith("NOT_INTERESTED")) return MOBILE_COLORS.rose;
  if (result.startsWith("NOT_ANSWERED") || result === "NO_ANSWER_INTERESTED" || result === "CALL_LATER") return MOBILE_COLORS.sky;
  if (result === "NEGOTIATING" || result === "BANK_CHECK" || result === "ON_HOLD") return MOBILE_COLORS.amber;
  return MOBILE_COLORS.mint;
}

/** رأس قسم: شريط جانبي ٤px متوهّج + عنوان ١٨px + عدّاد يسارًا. */
function SectionHead({ title, bar, counter }: { title: string; bar: string; counter?: string }) {
  return (
    <div className="flex items-center justify-between" style={{ padding: "0 2px" }}>
      <div className="flex items-center" style={{ gap: 9 }}>
        <span aria-hidden style={{ width: 4, height: 18, borderRadius: 2, background: bar, boxShadow: `0 0 10px ${bar}` }} />
        <h2 style={{ fontSize: 18, fontWeight: 800, color: MOBILE_COLORS.textPrimary }}>{title}</h2>
      </div>
      {counter && <span style={{ fontSize: 11.5, color: MOBILE_COLORS.textMuted }}>{counter}</span>}
    </div>
  );
}

export function EmployeeHome({
  firstName, unread, appointments, kpis, waiting, recent, funnel,
}: {
  firstName: string;
  unread: number;
  appointments: DayAppointment[];
  kpis: { total: number; visits: number; bookings: number; closed: number };
  waiting: WaitingLead[];
  recent: MyRecentFollowUp[];
  funnel: { stage: LeadStage; count: number }[];
}) {
  const now = new Date();
  const shown = funnel.filter((f) => f.count > 0);
  const maxCount = Math.max(...shown.map((f) => f.count), 1);
  const waitingShown = waiting.slice(0, 2);

  return (
    <div className="m-screen flex flex-col" style={{ gap: 18 }}>
      {/* ===== ١) الترويسة ===== */}
      <header className="m-rise flex items-start justify-between" style={{ padding: "0 2px" }}>
        <div className="min-w-0">
          <div className="truncate" style={{ fontSize: 24, fontWeight: 800, color: MOBILE_COLORS.textPrimary }}>
            مرحبًا {firstName}
          </div>
          <div style={{ fontSize: 13, color: MOBILE_COLORS.textSecondary, marginTop: 5 }}>
            عندك{" "}
            <span style={{ fontWeight: 800, color: MOBILE_COLORS.gold }}>
              {toArabicDigits(appointments.length)} {appointments.length === 1 ? "موعد" : appointments.length === 2 ? "موعدين" : "مواعيد"}
            </span>{" "}
            اليوم
          </div>
        </div>
        {/* ثيم · بحث · جرس بشارة العدد — المكوّن القائم (قرار ٥: تبقى الثلاثة) */}
        <MobileHeaderActions unread={unread} />
      </header>

      {/* ===== ٢) البانر المثبّت «موعدك القادم» — يظهر فقط داخل نافذته الزمنية ===== */}
      <NextAppointmentBanner appointments={appointments} />

      {/* ===== ٣) المربعات الأربعة ===== */}
      <EmployeeKpis total={kpis.total} visits={kpis.visits} bookings={kpis.bookings} closed={kpis.closed} />

      {/* ===== ٤) ترس «مواعيد اليوم» ===== */}
      <section className="m-rise flex flex-col" style={{ gap: 11, animationDelay: "180ms" }}>
        <SectionHead title="مواعيد اليوم" bar={MOBILE_COLORS.gold} />
        {appointments.length === 0 ? (
          <div
            className="flex flex-col items-center"
            style={{
              boxSizing: "border-box", gap: 6, borderRadius: 16, padding: "26px 14px",
              background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
            }}
          >
            <span style={{ fontSize: 22 }} aria-hidden>🎉</span>
            <span style={{ fontSize: 13.5, color: MOBILE_COLORS.textSecondary }}>ما عندك مواعيد اليوم</span>
          </div>
        ) : (
          <AppointmentsWheel appointments={appointments} />
        )}
      </section>

      {/* ===== ٥) عملاء ينتظرون تواصلك ===== */}
      {waiting.length > 0 && (
        <section className="m-rise flex flex-col" style={{ gap: 10, animationDelay: "250ms" }}>
          <SectionHead
            title="عملاء ينتظرون تواصلك"
            bar={MOBILE_COLORS.sky}
            counter={`${toArabicDigits(waiting.length)} ${waiting.length === 1 ? "عميل" : "عملاء"}`}
          />
          {waitingShown.map((l) => (
            <div
              key={l.id}
              className="relative overflow-hidden"
              style={{
                boxSizing: "border-box",
                background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
                borderRadius: 16, padding: "12px 14px",
              }}
            >
              <span aria-hidden style={{ position: "absolute", insetInlineStart: 0, top: 10, bottom: 10, width: 4, borderRadius: 3, background: MOBILE_COLORS.sky, boxShadow: `0 0 12px ${MOBILE_COLORS.sky}` }} />
              <div className="flex items-center" style={{ gap: 10 }}>
                <span
                  className="flex flex-none items-center justify-center"
                  style={{ width: 46, height: 46, borderRadius: 23, fontSize: 15, fontWeight: 700, background: MOBILE_COLORS.skyBg, color: MOBILE_COLORS.sky }}
                >
                  {avatarInitials(l.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate" style={{ fontSize: 16, fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>{l.name}</div>
                  <div className="truncate" style={{ fontSize: 12, color: MOBILE_COLORS.textSecondary, marginTop: 3 }}>
                    ✨ جديد من {channelLabel(l.channel)}
                  </div>
                </div>
                <span
                  className="flex-none"
                  style={{
                    boxSizing: "border-box", borderRadius: 8, padding: "4px 9px",
                    fontSize: 10.5, fontWeight: 700, background: MOBILE_COLORS.skyBg, color: MOBILE_COLORS.sky,
                  }}
                >
                  قبل {l.assignedAt ? elapsedLabel(l.assignedAt, now) : `${toArabicDigits(l.daysWaiting)} يوم`}
                </span>
              </div>
              <div className="flex" style={{ gap: 8, marginTop: 11 }}>
                <a
                  href={`tel:${l.phone}`}
                  className="m-press flex flex-1 items-center justify-center"
                  style={{ boxSizing: "border-box", height: 40, borderRadius: 11, border: "none", background: MOBILE_COLORS.sky, color: MOBILE_COLORS.bg, fontSize: 13, fontWeight: 700, gap: 5 }}
                >
                  📞 اتصال
                </a>
                <a
                  href={`https://wa.me/${waPhone(l.phone)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="m-press flex flex-1 items-center justify-center"
                  style={{ boxSizing: "border-box", height: 40, borderRadius: 11, background: MOBILE_COLORS.sheet, border: `1px solid ${MOBILE_COLORS.border}`, color: MOBILE_COLORS.textPrimary, fontSize: 13, fontWeight: 600, gap: 5 }}
                >
                  💬 واتساب
                </a>
                <Link
                  href={`/m/leads/${l.id}`}
                  aria-label={`ملف العميل ${l.name}`}
                  className="m-press flex flex-none items-center justify-center"
                  style={{ boxSizing: "border-box", width: 44, height: 40, borderRadius: 11, background: MOBILE_COLORS.sheet, border: `1px solid ${MOBILE_COLORS.border}`, color: MOBILE_COLORS.textSecondary, fontSize: 15 }}
                >
                  ←
                </Link>
              </div>
            </div>
          ))}
          {waiting.length > waitingShown.length && (
            <Link
              href="/m/leads?stages=NEW"
              className="m-press flex items-center justify-center"
              style={{
                boxSizing: "border-box", minHeight: 44, borderRadius: 13,
                border: `1px dashed ${MOBILE_COLORS.border}`, color: MOBILE_COLORS.textSecondary,
                fontSize: 13, fontWeight: 600,
              }}
            >
              عرض الكل ({toArabicDigits(waiting.length)}) ←
            </Link>
          )}
        </section>
      )}

      {/* ===== ٦) سجل متابعاتي ===== */}
      {recent.length > 0 && (
        <section className="m-rise flex flex-col" style={{ gap: 10, animationDelay: "320ms" }}>
          <SectionHead title="سجل متابعاتي" bar={MOBILE_COLORS.mint} counter={`آخر ${toArabicDigits(recent.length)}`} />
          <div
            style={{
              boxSizing: "border-box",
              background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
              borderRadius: 16, padding: "4px 14px",
            }}
          >
            {recent.map((r, i) => (
              <Link
                key={r.id}
                href={`/m/leads/${r.leadId}`}
                className="flex items-center"
                style={{
                  boxSizing: "border-box", gap: 9, minHeight: 46,
                  borderBottom: i === recent.length - 1 ? "none" : `1px solid ${MOBILE_COLORS.line3}`,
                }}
              >
                <span
                  className="flex-none"
                  style={{ width: 8, height: 8, borderRadius: 5, background: logTone(r.result), boxShadow: `0 0 9px ${logTone(r.result)}` }}
                />
                <span className="min-w-0 flex-1 truncate" style={{ fontSize: 13.5, color: MOBILE_COLORS.textSecondary }}>
                  <span style={{ fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>{r.leadName}</span>
                  {" — "}
                  {followUpResultLabels[r.result]}
                </span>
                <span className="flex-none whitespace-nowrap" style={{ fontSize: 10.5, color: MOBILE_COLORS.textMuted }}>
                  قبل {elapsedLabel(r.createdAt, now)}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ===== ٧) قمع عملائي ===== */}
      {shown.length > 0 && (
        <section className="m-rise flex flex-col" style={{ gap: 11, animationDelay: "390ms" }}>
          <SectionHead title="قمع عملائي" bar={MOBILE_COLORS.gold} />
          <div
            className="flex flex-col"
            style={{
              boxSizing: "border-box", gap: 9,
              background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
              borderRadius: 16, padding: "13px 14px",
            }}
          >
            {shown.map((f, i) => (
              <div key={f.stage} className="flex items-center" style={{ gap: 9 }}>
                <span className="flex-none truncate text-right" style={{ width: 74, fontSize: 12, fontWeight: 600, color: STAGE_HEX[f.stage] }}>
                  {stageLabels[f.stage]}
                </span>
                <div className="flex-1 overflow-hidden" style={{ height: 28, borderRadius: 9, background: MOBILE_COLORS.line2 }}>
                  <div
                    className="m-fillx flex items-center justify-end"
                    style={{
                      boxSizing: "border-box",
                      height: "100%", borderRadius: 9, paddingInline: 8,
                      width: `${Math.max((f.count / maxCount) * 100, 12)}%`,
                      background: STAGE_HEX[f.stage],
                      animationDelay: `${i * 70}ms`, animationDuration: "1s",
                    }}
                  >
                    <span style={{ ...ZAIN, fontSize: 13.5, fontWeight: 800, color: MOBILE_COLORS.bg }}>
                      {toArabicDigits(f.count)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default EmployeeHome;
