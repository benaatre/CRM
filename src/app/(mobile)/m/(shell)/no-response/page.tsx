import Link from "next/link";
import { ChevronLeft, PhoneMissed } from "lucide-react";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth-guards";
import {
  getPendingPullByEmployee, getNeverContactedLeads, getUnreachableLeads, getNeedsReview,
  getPullbackPreview,
} from "@/lib/data/no-response";
import { CATEGORY_LABEL } from "@/lib/no-response-escalation";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";

export const dynamic = "force-dynamic";

const card = {
  boxSizing: "border-box" as const,
  background: MOBILE_COLORS.card,
  border: `1px solid ${MOBILE_COLORS.border}`,
  borderRadius: 16,
  padding: "13px 14px",
};

/**
 * «لم يتم الرد» — غلاف قراءة لنفس دوال الديسكتوب بنفس الحارس requireRole(OWNER).
 * الأدوات التنفيذية (تراجع الدُفعات · مفتاح إعادة التوزيع · الاستلام) من الديسكتوب.
 */
export default async function MobileNoResponsePage() {
  await requireRole(Role.OWNER); // نفس فحص الديسكتوب حرفيًا.

  const [pending, neverContacted, unreachable, needsReview, pullback] = await Promise.all([
    getPendingPullByEmployee(),
    getNeverContactedLeads(),
    getUnreachableLeads(),
    getNeedsReview(),
    // المتأخرون عميلًا عميلًا (تحذير/يُسحب) بمدة التأخير والفئة — نفس معاينة الديسكتوب.
    getPullbackPreview(),
  ]);

  return (
    <div className="m-screen flex flex-col" style={{ gap: 13 }}>
      <div className="flex items-center" style={{ gap: 11 }}>
        <Link href="/m/more" aria-label="رجوع" className="flex items-center justify-center"
          style={{ minWidth: 44, minHeight: 44, marginInlineStart: -10, color: MOBILE_COLORS.textPrimary }}>
          <ChevronLeft size={20} strokeWidth={2} style={{ transform: "scaleX(-1)" }} aria-hidden />
        </Link>
        <div>
          <h1 style={{ fontSize: 17, fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>لم يتم الرد</h1>
          <div style={{ fontSize: "11.5px", color: MOBILE_COLORS.textMuted, marginTop: 3 }}>
            الحوكمة والسحب — الأدوات التنفيذية من الديسكتوب
          </div>
        </div>
      </div>

      {/* ===== الإجماليات ===== */}
      <div className="grid grid-cols-3" style={{ gap: 8 }}>
        {[
          { v: pending.totalGrace, l: "في المهلة", c: MOBILE_COLORS.textSecondary },
          { v: pending.totalWarning, l: "تحذير ٢٤س", c: MOBILE_STATUS.warning.fg },
          { v: pending.totalOverdue, l: "يُسحب الآن", c: MOBILE_STATUS.danger.fg },
        ].map((k) => (
          <div key={k.l} className="flex flex-col items-center justify-center"
            style={{ ...card, minHeight: 68, gap: 3, padding: "10px 8px" }}>
            <span style={{ fontSize: 19, fontWeight: 700, color: k.c, lineHeight: 1 }}>{toArabicDigits(k.v)}</span>
            <span style={{ fontSize: 10.5, color: MOBILE_COLORS.textSecondary }}>{k.l}</span>
          </div>
        ))}
      </div>

      {/* ===== المتأخرون عميلًا عميلًا — الانتظار حسب التصعيد (getPullbackPreview) ===== */}
      {pullback.length > 0 && (
        <div className="m-rise" style={{ ...card, borderInlineStart: `3px solid ${MOBILE_STATUS.danger.base}` }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: MOBILE_COLORS.textPrimary, marginBottom: 6 }}>
            المتأخرون — حسب التصعيد ({toArabicDigits(pullback.length)})
          </div>
          {pullback.slice(0, 20).map((r, i) => (
            <Link key={r.id} href={`/m/leads/${r.id}`} className="flex items-center justify-between"
              style={{ boxSizing: "border-box", gap: 8, minHeight: 48, borderTop: i === 0 ? "none" : `1px solid ${MOBILE_COLORS.line3}` }}>
              <span className="min-w-0 flex-1">
                <span className="flex items-center" style={{ gap: 6 }}>
                  <span className="min-w-0 truncate" style={{ fontSize: 13, fontWeight: 600, color: MOBILE_COLORS.textPrimary }}>{r.name}</span>
                  <span className="flex-none"
                    style={{
                      boxSizing: "border-box", fontSize: 9.5, fontWeight: 700, padding: "2px 7px", borderRadius: 6,
                      background: r.klass === "overdue" ? MOBILE_STATUS.danger.bg : MOBILE_STATUS.warning.bg,
                      color: r.klass === "overdue" ? MOBILE_STATUS.danger.fg : MOBILE_STATUS.warning.fg,
                    }}>
                    {r.klass === "overdue" ? "يُسحب الآن" : "إنذار"}
                  </span>
                </span>
                <span className="block truncate" style={{ fontSize: 11, color: MOBILE_COLORS.textMuted, marginTop: 2 }}>
                  {r.employee ?? "—"} · {CATEGORY_LABEL[r.category]} · مهلته {toArabicDigits(r.timeoutDays)} أيام
                </span>
              </span>
              <span className="flex-none" style={{ fontSize: "11.5px", fontWeight: 700, color: r.klass === "overdue" ? MOBILE_STATUS.danger.fg : MOBILE_STATUS.warning.fg }}>
                متأخر {toArabicDigits(r.daysLate)} يوم
              </span>
            </Link>
          ))}
          {pullback.length > 20 && (
            <p style={{ fontSize: 11, color: MOBILE_COLORS.textMuted, marginTop: 8 }}>
              +{toArabicDigits(pullback.length - 20)} آخرون بنفس الترتيب (يُسحب الآن أولًا ثم الأكثر تأخرًا)
            </p>
          )}
        </div>
      )}

      {/* ===== بانتظار السحب لكل موظف ===== */}
      {pending.employees.length > 0 && (
        <div style={{ ...card, borderInlineStart: `3px solid ${MOBILE_STATUS.warning.base}` }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: MOBILE_COLORS.textPrimary, marginBottom: 6 }}>
            بانتظار السحب — لكل موظف
          </div>
          {pending.employees.map((e, i) => (
            <div key={e.id} className="flex items-center justify-between"
              style={{ boxSizing: "border-box", gap: 8, minHeight: 44, borderTop: i === 0 ? "none" : `1px solid ${MOBILE_COLORS.line3}` }}>
              <span className="min-w-0 flex-1 truncate" style={{ fontSize: 13, color: MOBILE_COLORS.textPrimary }}>
                {e.name}
                {e.oldestOverdueDays > 0 && (
                  <span style={{ color: MOBILE_COLORS.textMuted }}> · أقدم تأخير {toArabicDigits(e.oldestOverdueDays)} يوم</span>
                )}
              </span>
              <span className="flex-none flex items-center" style={{ gap: 6, fontSize: "11.5px", fontWeight: 600 }}>
                <span style={{ color: MOBILE_STATUS.warning.fg }}>{toArabicDigits(e.totalWarning)}</span>
                <span style={{ color: MOBILE_STATUS.danger.fg }}>{toArabicDigits(e.totalOverdue)}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ===== صامتو التواصل (مُسند بلا أي متابعة +٣ أيام) ===== */}
      <div style={{ ...card, borderInlineStart: `3px solid ${MOBILE_STATUS.danger.base}` }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: MOBILE_COLORS.textPrimary, marginBottom: 6 }}>
          صامتو التواصل ({toArabicDigits(neverContacted.length)})
        </div>
        {neverContacted.length === 0 ? (
          <p style={{ fontSize: "12.5px", color: MOBILE_COLORS.textMuted }}>ما فيه — كل المُسندين تم التواصل معهم 🎉</p>
        ) : (
          neverContacted.slice(0, 15).map((l, i) => (
            <Link key={l.id} href={`/m/leads/${l.id}`} className="flex items-center justify-between"
              style={{ boxSizing: "border-box", gap: 8, minHeight: 44, borderTop: i === 0 ? "none" : `1px solid ${MOBILE_COLORS.line3}` }}>
              <span className="min-w-0 flex-1">
                <span className="block truncate" style={{ fontSize: 13, fontWeight: 600, color: MOBILE_COLORS.textPrimary }}>{l.name}</span>
                <span className="block" style={{ fontSize: 11, color: MOBILE_COLORS.textMuted, marginTop: 2 }}>{l.employeeName}</span>
              </span>
              <span className="flex-none" style={{ fontSize: "11.5px", fontWeight: 600, color: MOBILE_STATUS.danger.fg }}>
                {toArabicDigits(l.days)} يوم
              </span>
            </Link>
          ))
        )}
        {neverContacted.length > 15 && (
          <p style={{ fontSize: 11, color: MOBILE_COLORS.textMuted, marginTop: 8 }}>
            +{toArabicDigits(neverContacted.length - 15)} آخرون — القائمة الكاملة بالديسكتوب
          </p>
        )}
      </div>

      {/* ===== بحاجة لمراجعة + تعذّر الوصول ===== */}
      {(needsReview.noAssignDate.length > 0 || unreachable.length > 0) && (
        <div style={card}>
          {needsReview.noAssignDate.length > 0 && (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: MOBILE_COLORS.textPrimary, marginBottom: 6 }}>
                بحاجة لمراجعة — بلا تاريخ إسناد
              </div>
              {needsReview.noAssignDate.map((g) => (
                <div key={g.employeeId} className="flex items-center justify-between" style={{ minHeight: 36 }}>
                  <span style={{ fontSize: "12.5px", color: MOBILE_COLORS.textSecondary }}>{g.employeeName}</span>
                  <span style={{ fontSize: "12.5px", fontWeight: 600, color: MOBILE_STATUS.warning.fg }}>{toArabicDigits(g.count)}</span>
                </div>
              ))}
            </>
          )}
          {unreachable.length > 0 && (
            <div style={{ marginTop: needsReview.noAssignDate.length ? 10 : 0 }}>
              <div className="flex items-center" style={{ gap: 6, fontSize: 13, fontWeight: 700, color: MOBILE_COLORS.textPrimary, marginBottom: 6 }}>
                <PhoneMissed size={14} style={{ color: MOBILE_STATUS.danger.base }} aria-hidden />
                تعذّر الوصول ({toArabicDigits(unreachable.length)})
              </div>
              {unreachable.slice(0, 10).map((u) => (
                <div key={u.id} style={{ fontSize: "12.5px", color: MOBILE_COLORS.textSecondary, minHeight: 32, display: "flex", alignItems: "center" }}>
                  {u.name} — استنفده {toArabicDigits(u.exhaustedEmployees)} موظفون
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <p
        style={{
          boxSizing: "border-box", borderRadius: 12, padding: "11px 13px",
          border: `1px solid ${MOBILE_COLORS.border}`, background: MOBILE_COLORS.card,
          color: MOBILE_COLORS.textMuted, fontSize: 11.5, lineHeight: 1.8,
        }}
      >
        الأدوات التنفيذية (الاستلام وتراجع الدُفعات) — من الديسكتوب.
      </p>
    </div>
  );
}
