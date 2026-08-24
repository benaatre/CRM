import Link from "next/link";
import { ChevronLeft, Bell } from "lucide-react";
import { SOP } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";

/**
 * «دوام وحالة الفريق» (رئيسية المالك — owner-home-final §٢): صفوف مختصرة
 * بحلقة نسبة الدوام + النشاط + شارة الحالة + سطر الاستقبال، وملخّص عدّادات
 * الحالات فوقها. عرض خادمي خالص: كل النصوص والنِسب تصل جاهزة من owner-home
 * (getLiveBoard + getTeam) — صفر استدعاء هنا.
 */

const ZAIN = { fontFamily: "var(--font-zain), var(--font-sans)", fontVariantNumeric: "tabular-nums" as const };

/** حالة العرض المبسّطة — مشتقة من TileState على الخادم. */
export type OwnerTeamState = "on" | "done" | "remote" | "paused" | "leave" | "miss";

export type OwnerTeamRow = {
  id: string;
  name: string;
  state: OwnerTeamState;
  /** نسبة إنجاز الدوام ٪ (محسوبة من targetMinutes + المنجز والحي). */
  pct: number;
  /** «نشط الآن» أو «آخر ظهور قبل X» — محسوب على الخادم. */
  activityText: string;
  activeNow: boolean;
  /** «الدوام ٦:١٩/٨س» · «عن بُعد · منذ ٣:١٠» · «دوامه ٩:٠٠ ص» … */
  metaText: string | null;
  /** سطر أحمر (غياب متتالٍ) — للمقصّر الحقيقي فقط. */
  dangerText: string | null;
  /** الاستقبال (للبائعين فقط): مفتوح أو مقفول بسببه ومتى يرجع — ليس إنذارًا. */
  reception: { open: boolean; text: string } | null;
  badgeText: string;
};

/** لون كل حالة — من توكنز SOP حصرًا (نفس رباعية المرجع). */
function tone(state: OwnerTeamState): string {
  if (state === "on" || state === "done") return SOP.green;
  if (state === "remote") return SOP.teal;
  if (state === "paused") return SOP.amber;
  if (state === "leave") return SOP.neutral;
  return SOP.red; // miss
}

/** حلقة نسبة الدوام ٤٢px (المرجع حرفيًا) + نقطة «نشط الآن». */
function RingAvatar({ pct, color, live }: { pct: number; color: string; live: boolean }) {
  const r = 17;
  const c = 2 * Math.PI * r; // ≈ ١٠٦٫٨
  const off = c * (1 - Math.min(pct, 100) / 100);
  return (
    <span className="relative flex-none" style={{ width: 42, height: 42 }}>
      <svg data-svg-free width={42} height={42} viewBox="0 0 42 42" style={{ maxWidth: 42, maxHeight: 42, transform: "rotate(-90deg)" }} aria-hidden>
        <circle cx={21} cy={21} r={r} fill="none" stroke={SOP.sd} strokeWidth={4} />
        <circle cx={21} cy={21} r={r} fill="none" stroke={color} strokeWidth={4} strokeLinecap={pct > 0 ? "round" : undefined} strokeDasharray={c} strokeDashoffset={off} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center" style={{ ...ZAIN, fontSize: pct >= 100 ? 10 : 12, fontWeight: 800, color }}>
        {toArabicDigits(pct)}٪
      </span>
      <span
        aria-hidden
        className={live ? "m-pulse absolute" : "absolute"}
        style={{
          bottom: 0, insetInlineEnd: 0, width: 11, height: 11, borderRadius: 6,
          background: live ? SOP.green : SOP.mut,
          border: `2.5px solid ${SOP.plane}`,
        }}
      />
    </span>
  );
}

export function OwnerTeamSection({ rows, summary, teamHref = "/m/team" }: {
  rows: OwnerTeamRow[];
  /** عدّادات الحالات بالترتيب — تصل جاهزة (الصفري يُسقط في الخادم). */
  summary: { label: string; count: number; color: string }[];
  teamHref?: string;
}) {
  return (
    <>
      {/* ملخّص الحالات */}
      <div className="m-noscroll flex overflow-x-auto" style={{ gap: 7 }}>
        {summary.map((s) => (
          <div key={s.label} className="m-raise flex-none text-center" style={{ boxSizing: "border-box", borderRadius: 11, padding: "7px 12px" }}>
            <div style={{ ...ZAIN, fontSize: 15, fontWeight: 800, color: s.color }}>{toArabicDigits(s.count)}</div>
            <div style={{ fontSize: "7.5px", color: SOP.mut, marginTop: 1 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* الصفوف */}
      <div className="flex flex-col" style={{ gap: 9 }}>
        {rows.map((r, i) => {
          const c = tone(r.state);
          const miss = r.state === "miss";
          return (
            <div
              key={r.id}
              className="m-raise m-rise flex items-center"
              style={{
                boxSizing: "border-box", borderRadius: 15, padding: "11px 12px", gap: 11,
                borderInlineStart: `3px solid ${c}`,
                animationDelay: `${Math.min(i, 8) * 60}ms`,
                // المقصّر الحقيقي فقط يبرز أحمر — الاستقبال المقفول عادي بسببه.
                ...(miss ? { background: `linear-gradient(140deg, color-mix(in srgb, ${SOP.red} 8%, ${SOP.plane}), ${SOP.plane})` } : {}),
              }}
            >
              <RingAvatar pct={r.pct} color={c} live={r.activeNow} />
              <div className="min-w-0 flex-1">
                <div className="truncate" style={{ fontSize: 13, fontWeight: 700, color: SOP.tx }}>{r.name}</div>
                <div className="flex flex-wrap items-center" style={{ gap: "3px 9px", fontSize: 9, color: SOP.mut, marginTop: 4 }}>
                  <span className="flex items-center" style={{ gap: 4, color: r.activeNow ? SOP.green : SOP.mut }}>
                    <i
                      aria-hidden
                      className={r.activeNow ? "m-pulse" : undefined}
                      style={{ width: 6, height: 6, borderRadius: 3, background: r.activeNow ? SOP.green : SOP.mut, boxShadow: r.activeNow ? `0 0 6px ${SOP.green}` : "none" }}
                    />
                    {r.activityText}
                  </span>
                  {r.metaText && <span>{r.metaText}</span>}
                  {r.dangerText && <span style={{ color: SOP.red, fontWeight: 700 }}>{r.dangerText}</span>}
                </div>
              </div>
              <div className="flex flex-none flex-col items-end" style={{ gap: 5 }}>
                <span
                  className="flex items-center whitespace-nowrap"
                  style={{
                    boxSizing: "border-box", gap: 4, fontSize: "8.5px", fontWeight: 700,
                    padding: "4px 8px", borderRadius: 7,
                    color: c, background: `color-mix(in srgb, ${c} 15%, transparent)`,
                  }}
                >
                  {r.badgeText}
                </span>
                {r.reception && (
                  <span
                    className="flex items-center whitespace-nowrap"
                    style={{
                      boxSizing: "border-box", gap: 4, fontSize: "8.5px", fontWeight: 700,
                      padding: "3px 8px", borderRadius: 6,
                      color: r.reception.open ? SOP.green : SOP.neutral,
                      background: `color-mix(in srgb, ${r.reception.open ? SOP.green : SOP.neutral} 13%, transparent)`,
                    }}
                  >
                    <Bell size={10} strokeWidth={2} style={{ maxWidth: 22, maxHeight: 22 }} aria-hidden />
                    {r.reception.text}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {rows.length === 0 && (
          <div className="m-raise text-center" style={{ borderRadius: 15, padding: 16, fontSize: 12, color: SOP.mut }}>
            ما فيه موظفون مرصودون
          </div>
        )}
      </div>

      {/* عرض كل الفريق */}
      <Link
        href={teamHref}
        className="m-press-sc flex w-full items-center justify-center"
        style={{
          boxSizing: "border-box", gap: 6, padding: 10, borderRadius: 12,
          border: `1px solid ${SOP.edge}`, color: SOP.gold2, fontSize: 11, fontWeight: 600,
        }}
      >
        عرض كل الفريق ({toArabicDigits(rows.length)})
        <ChevronLeft size={13} strokeWidth={2} style={{ maxWidth: 22, maxHeight: 22 }} aria-hidden />
      </Link>
    </>
  );
}

export default OwnerTeamSection;
