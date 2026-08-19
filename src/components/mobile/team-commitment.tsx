import Link from "next/link";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";

/**
 * «التزام الموظفين بالمتابعات» v3 — صفوف مضغوطة مرتّبة **بالأسوأ أولًا** (من الخادم):
 * أفاتار + الاسم (+ شارة «X فايتة») + سطر «أنجز N من M متابعة مجدولة» + النسبة
 * بشريطها (أخضر/كهرماني/أحمر). من بلا مواعيد بالنافذة: سطر مصغّر واحد.
 * server component خالص — الامتلاء بأنيميشن m-fillx (transform، يحترم تقليل الحركة).
 */

export type CommitmentRow = {
  id: string;
  name: string;
  done: number;
  missed: number;
  total: number;
  pct: number;
  lastLabel: string;
};

const ZAIN = { fontFamily: "var(--font-zain), var(--font-sans)" };

function pctTone(pct: number) {
  if (pct >= 90) return MOBILE_STATUS.success.base;
  if (pct >= 65) return MOBILE_STATUS.warning.base;
  return MOBILE_STATUS.danger.base;
}

export function TeamCommitment({ rows, idleNames, teamHref = "/m/team", fileLinks = false }: {
  /** أصحاب المواعيد بالنافذة فقط — الأسوأ نسبةً أولًا (ترتيب الخادم). */
  rows: CommitmentRow[];
  /** من بلا مواعيد مجدولة بالنافذة — سطر مصغّر. */
  idleNames: string[];
  teamHref?: string;
  /** اسم الموظف يفتح ملفه /m/employees/[id] — يُمرَّر true للمالك فقط. */
  fileLinks?: boolean;
}) {
  return (
    <div className="overflow-hidden" style={{ borderRadius: 18, background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}` }}>
      {rows.length === 0 && (
        <div className="text-center" style={{ padding: 16, fontSize: 12, color: MOBILE_COLORS.textMuted }}>
          ما فيه متابعات مجدولة بهذه النافذة
        </div>
      )}
      {rows.map((r, i) => {
        const tone = pctTone(r.pct);
        return (
          <div key={r.id} className="m-rise flex items-center" style={{ gap: 11, padding: "12px 14px", borderBottom: `1px solid ${MOBILE_COLORS.border}`, animationDelay: `${i * 60}ms` }}>
            <span className="flex flex-none items-center justify-center" style={{ boxSizing: "border-box", width: 38, height: 38, borderRadius: 12, background: MOBILE_COLORS.goldBg, color: MOBILE_COLORS.gold, fontSize: 15, fontWeight: 800, ...ZAIN }}>
              {r.name.trim().charAt(0)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center" style={{ gap: 6 }}>
                {fileLinks ? (
                  <Link href={`/m/employees/${r.id}`} className="truncate" style={{ fontSize: "13.5px", fontWeight: 800, color: MOBILE_COLORS.textPrimary }}>
                    {r.name}
                  </Link>
                ) : (
                  <span className="truncate" style={{ fontSize: "13.5px", fontWeight: 800, color: MOBILE_COLORS.textPrimary }}>{r.name}</span>
                )}
                {r.missed > 0 && (
                  <span className="flex-none" style={{ boxSizing: "border-box", fontSize: "9.5px", fontWeight: 800, padding: "3px 8px", borderRadius: 8, background: MOBILE_STATUS.danger.bg, color: MOBILE_STATUS.danger.base }}>
                    {toArabicDigits(r.missed)} فايتة
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: MOBILE_COLORS.textMuted, marginTop: 4, fontWeight: 600 }}>
                أنجز <b style={{ ...ZAIN, fontSize: "12.5px", color: MOBILE_COLORS.textSecondary }}>{toArabicDigits(r.done)}</b> من{" "}
                <b style={{ ...ZAIN, fontSize: "12.5px", color: MOBILE_COLORS.textSecondary }}>{toArabicDigits(r.total)}</b> متابعة مجدولة
                {r.missed > 0 && <> · <span style={{ color: MOBILE_STATUS.danger.base, fontWeight: 800 }}>{toArabicDigits(r.missed)} فاتت بلا نتيجة</span></>}
              </div>
            </div>
            <div className="flex-none text-center" style={{ minWidth: 52 }}>
              <div style={{ ...ZAIN, fontSize: 19, fontWeight: 800, color: tone }}>{toArabicDigits(r.pct)}٪</div>
              <div className="overflow-hidden" style={{ height: 4, width: 52, borderRadius: 3, background: MOBILE_COLORS.line2, marginTop: 5 }}>
                <div className="m-fillx" style={{ height: "100%", borderRadius: 3, background: tone, transform: `scaleX(${r.pct / 100})`, transformOrigin: "right", animationDelay: `${150 + i * 80}ms` }} />
              </div>
            </div>
          </div>
        );
      })}
      {idleNames.length > 0 && (
        <div className="flex items-center" style={{ gap: 6, padding: "11px 14px", fontSize: 11, color: MOBILE_COLORS.textMuted, fontWeight: 700, borderBottom: `1px solid ${MOBILE_COLORS.border}` }}>
          <span className="flex" aria-hidden>
            {idleNames.slice(0, 5).map((n, i) => (
              <span key={i} className="flex items-center justify-center" style={{ boxSizing: "border-box", width: 22, height: 22, borderRadius: 7, background: MOBILE_COLORS.sheet, border: `1px solid ${MOBILE_COLORS.border}`, fontSize: 10, fontWeight: 800, color: MOBILE_COLORS.textMuted, marginInlineStart: i === 0 ? 0 : -6 }}>
                {n.trim().charAt(0)}
              </span>
            ))}
          </span>
          <span style={{ marginInlineStart: 4 }}>{toArabicDigits(idleNames.length)} موظفين ما عندهم متابعات مجدولة بهذه النافذة</span>
        </div>
      )}
      <Link href={teamHref} className="block text-center" style={{ padding: 12, fontSize: 12, fontWeight: 800, color: MOBILE_COLORS.gold }}>
        عرض كل الفريق ←
      </Link>
    </div>
  );
}

export default TeamCommitment;
