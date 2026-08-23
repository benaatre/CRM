import Link from "next/link";
import { MOBILE_COLORS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";

export type UrgencyChip = {
  /** نقطة اللون يمين الاسم. */
  dot: string;
  /** لون اسم الصف. */
  fg: string;
  name: string;
  sub: string;
};

/**
 * البطاقة المجمّعة في رئيسية الموظف — منقولة حرفيًا من النموذج (isEmpHome ›
 * urgency): زوايا ١٨ · حشوة 12/13/13 · فجوة ٩ · حد بلون الحالة · دخول riseIn
 * بتأخير متدرّج ٩٠ms · صفوف مصغّرة بعرض أدنى ١٣٢ وتمرير أفقي.
 */
export function UrgencyCard({
  href,
  title,
  count,
  cta,
  color,
  fg,
  border,
  subColor,
  sub,
  chips,
  delayMs = 0,
}: {
  href: string;
  title: string;
  count: number;
  cta: string;
  /** لون العدّاد والسهم (--bad / --gold / --info). */
  color: string;
  /** لون العنوان. */
  fg: string;
  /** لون إطار البطاقة. */
  border: string;
  /** لون سطر الرؤية. */
  subColor: string;
  sub: string;
  chips: UrgencyChip[];
  /** تأخير الدخول المتدرّج — النموذج: stagger(…, 90). */
  delayMs?: number;
}) {
  return (
    <Link
      href={href}
      className="m-urgency m-rise flex flex-col overflow-hidden text-right"
      style={{
        boxSizing: "border-box",
        background: MOBILE_COLORS.card,
        border: `1px solid ${border}`,
        borderRadius: 18,
        padding: "12px 13px 13px",
        gap: 9,
        animationDelay: `${delayMs}ms`,
      }}
    >
      <div className="flex w-full items-center justify-between" style={{ gap: 8 }}>
        <div className="flex items-center" style={{ gap: 8 }}>
          {/* «صفر» ليس إنذارًا — الرقاقة الملوّنة تختفي بدل أن تعرض ٠ بلا معنى. */}
          {count > 0 && (
            <span
              className="flex items-center justify-center"
              style={{
                boxSizing: "border-box", minWidth: 23, height: 23, borderRadius: 8,
                background: color, color: "var(--sop-tx)",
                fontSize: 12, fontWeight: 700, padding: "0 6px",
              }}
            >
              {toArabicDigits(count)}
            </span>
          )}
          <span style={{ fontSize: "14.5px", fontWeight: 700, color: fg }}>{title}</span>
        </div>
        <span className="whitespace-nowrap" style={{ fontSize: 12, fontWeight: 600, color }}>
          {cta} ←
        </span>
      </div>

      <div style={{ fontSize: "11.5px", color: subColor, lineHeight: 1.6 }}>{sub}</div>

      {chips.length > 0 && (
        <div className="m-noscroll flex w-full overflow-x-auto" style={{ gap: 8, paddingBottom: 2 }}>
          {chips.map((c) => (
            <div
              key={c.name + c.sub}
              className="flex-none"
              style={{
                boxSizing: "border-box", minWidth: 132,
                background: MOBILE_COLORS.sheet,
                border: `1px solid ${MOBILE_COLORS.border}`,
                borderRadius: 13, padding: "9px 11px",
              }}
            >
              <div className="flex items-center" style={{ gap: 6 }}>
                <span
                  className="flex-none"
                  style={{ width: 7, height: 7, borderRadius: 4, background: c.dot }}
                />
                <span className="whitespace-nowrap" style={{ fontSize: "12.5px", fontWeight: 600, color: c.fg }}>
                  {c.name}
                </span>
              </div>
              <div className="whitespace-nowrap" style={{ fontSize: "10.5px", color: MOBILE_COLORS.textMuted, marginTop: 5 }}>
                {c.sub}
              </div>
            </div>
          ))}
        </div>
      )}
    </Link>
  );
}

export default UrgencyCard;
