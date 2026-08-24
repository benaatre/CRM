import Link from "next/link";
import { Crown } from "lucide-react";
import { SOP } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";

/**
 * «لوحة الأسبوع» (رئيسية المالك — leaderboard-inline): سباق الأشرطة من
 * getLeaderboard القائمة — الرتبة + الاسم (الأول بالتاج) + الدرجة + شريط بطول
 * نسبي لأعلى درجة، ثم «خارج الترتيب» chips وسطر المعادلة. عرض خادمي خالص:
 * الصفوف تصل مرتّبة ومرقّمة من الدالة نفسها — صفر معادلة جديدة هنا.
 */

const ZAIN = { fontFamily: "var(--font-zain), var(--font-sans)", fontVariantNumeric: "tabular-nums" as const };

/* فضّي/برونزي: توكنا SOP مضافان في mobile.css (ليل/نهار) — خارج خريطة lib عمدًا. */
const SILVER = "var(--sop-silver)";
const BRONZE = "var(--sop-bronze)";
/** لون كل مركز: ذهبي/فضّي/برونزي ثم دورة هادئة (المرجع حرفيًا). */
const CALM = [SOP.blue, SOP.teal, SOP.mut];
function rankColor(rank: number): string {
  if (rank === 1) return SOP.gold2;
  if (rank === 2) return SILVER;
  if (rank === 3) return BRONZE;
  return CALM[(rank - 4) % CALM.length];
}

export type LeaderboardRaceRow = {
  id: string;
  rank: number;
  name: string;
  score: number;
};

export function OwnerLeaderboardSection({
  rows, unranked, rangeText, current, showLast, hrefThis, hrefLast,
}: {
  /** المرتَّبون كما وصلوا من getLeaderboard (score تنازليًا، rank معبّأ). */
  rows: LeaderboardRaceRow[];
  /** خارج الترتيب (بلا عملاء مسندين) — أسماء فقط. */
  unranked: string[];
  /** «٢٣ – ٢٩ أغسطس ٢٠٢٦» بيوم الرياض — يُصاغ في الخادم. */
  rangeText: string;
  current: "this" | "last";
  /** «الأسبوع السابق» امتياز المالك — الأدمن لا يرى الزر (ويثبت خادميًا). */
  showLast: boolean;
  hrefThis: string;
  hrefLast: string;
}) {
  const max = rows[0]?.score ?? 0;
  const leader = rows[0] ?? null;

  const filters: { key: "this" | "last"; label: string; href: string }[] = [
    { key: "this", label: "هذا الأسبوع", href: hrefThis },
    ...(showLast ? [{ key: "last" as const, label: "الأسبوع السابق", href: hrefLast }] : []),
  ];

  return (
    <>
      {/* فلتر الفترة */}
      <div className="flex" style={{ gap: 6 }}>
        {filters.map((f) => {
          const on = current === f.key;
          return (
            <Link
              key={f.key}
              href={f.href}
              scroll={false}
              aria-current={on ? "true" : undefined}
              className={`${on ? "" : "m-raise"} m-press-sc flex flex-1 items-center justify-center whitespace-nowrap`}
              style={{
                boxSizing: "border-box", minHeight: 34, padding: "8px 4px", borderRadius: 11,
                fontSize: "10.5px", fontWeight: on ? 700 : 600,
                ...(on
                  ? { color: SOP.onGold, background: `linear-gradient(135deg, ${SOP.gold2}, ${SOP.gold})`, boxShadow: `0 3px 9px color-mix(in srgb, ${SOP.gold} 32%, transparent)` }
                  : { color: SOP.tx2 }),
              }}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {/* نطاق الأسبوع */}
      <div className="text-center" style={{ ...ZAIN, fontSize: 9, color: SOP.mut, marginTop: -5 }}>{rangeText}</div>

      {/* سباق الأشرطة */}
      <div className="m-raise m-rise" style={{ boxSizing: "border-box", borderRadius: 16, padding: "14px 13px" }}>
        {rows.length === 0 ? (
          <div className="text-center" style={{ padding: 10, fontSize: 12, color: SOP.mut }}>
            ما فيه ترتيب هذا الأسبوع بعد
          </div>
        ) : (
          rows.map((r, i) => {
            const c = rankColor(r.rank);
            const pct = max > 0 ? (r.score / max) * 100 : 0;
            const width = Math.max(2, Math.round(pct));
            return (
              <div key={r.id} style={{ marginBottom: i === rows.length - 1 ? 0 : 13 }}>
                <div className="flex items-center" style={{ gap: 8, marginBottom: 5 }}>
                  <span className="flex-none text-center" style={{ ...ZAIN, width: 16, fontSize: 12, fontWeight: 800, color: r.rank === 1 ? SOP.gold2 : SOP.mut }}>
                    {toArabicDigits(r.rank)}
                  </span>
                  <span className="min-w-0 flex-1 truncate" style={{ fontSize: "11.5px", fontWeight: 600, color: SOP.tx }}>
                    {r.name}
                    {r.rank === 1 && (
                      <Crown size={12} strokeWidth={1.9} style={{ display: "inline", verticalAlign: -2, marginInlineStart: 4, color: SOP.gold2, maxWidth: 22, maxHeight: 22 }} aria-hidden />
                    )}
                  </span>
                  <span className="flex-none" style={{ ...ZAIN, fontSize: 15, fontWeight: 800, color: c }}>
                    {toArabicDigits(r.score)}
                  </span>
                </div>
                <div className="overflow-hidden" style={{ height: 12, borderRadius: 6, background: SOP.sd, marginInlineStart: 24 }}>
                  <i
                    className="m-fillx block"
                    style={{
                      height: "100%", borderRadius: 6, width: `${width}%`,
                      background: `linear-gradient(90deg, ${c}, color-mix(in srgb, ${c} 55%, ${SOP.plane}))`,
                      transform: "scaleX(1)", transformOrigin: "right",
                      animationDelay: `${120 + i * 70}ms`,
                    }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* خارج الترتيب — يُخفى إن لم يوجد */}
      {unranked.length > 0 && (
        <div>
          <div style={{ fontSize: 9, color: SOP.mut, marginBottom: 7 }}>خارج الترتيب — بلا عملاء مسندين هذا الأسبوع:</div>
          <div className="flex flex-wrap" style={{ gap: 6 }}>
            {unranked.map((n) => (
              <span key={n} className="m-raise" style={{ boxSizing: "border-box", fontSize: 10, padding: "6px 11px", borderRadius: 9, color: SOP.tx2 }}>
                {n}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* سطر المعادلة */}
      <div className="m-inset" style={{ boxSizing: "border-box", borderRadius: 12, padding: 11, fontSize: "8.5px", color: SOP.mut, lineHeight: 1.7 }}>
        <b style={{ color: SOP.gold2 }}>الدرجة</b> = الإنجاز × الجودة (٠٫٨–١٫٢).
        {leader && leader.score > 0 && <> الطول نسبة لأعلى درجة ({leader.name} {toArabicDigits(leader.score)} = ١٠٠٪).</>}
        {" "}عرض وترتيب فقط — بلا مكافآت مالية.
      </div>
    </>
  );
}

export default OwnerLeaderboardSection;
