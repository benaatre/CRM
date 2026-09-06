import Link from "next/link";
import { toArabicDigits } from "@/lib/format";

/**
 * بطاقة جسر «لوحة الأسبوع» بلوحة المالك — عرض وتنقل فقط، صفر منطق:
 * مصغّر حي من getLeaderboard القائمة (تُمرَّر الثلاثة الأوائل جاهزين من
 * OwnerDashboard — لا استعلام هنا)، وكامل البطاقة رابط يفتح /leaderboard.
 * الهوية: توكنات CSS حصرًا (--gold-aXX من globals + --od-* بنطاق اللوحة)،
 * وZain للأرقام العربية-الهندية عبر متغيّر الخط القائم. النبض يحترم تقليل الحركة.
 */

/** كأس/بوديوم — SVG خطي بحجم مقيّد (نفس عرف الأيقونات، لا إيموجي). */
function PodiumIcon() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" aria-hidden="true" style={{ maxWidth: 18, maxHeight: 18 }}>
      <path d="M9 20v-7h6v7M3 20v-4h6v4M15 20v-5h6v5M3 20h18M12 3l1 2 2.2.3-1.6 1.5.4 2.2-2-1-2 1 .4-2.2L8.8 5.3 11 5l1-2Z" />
    </svg>
  );
}

export type WeekCardRow = { id: string; name: string; score: number };

export function OwnerWeekCard({ top }: { top: WeekCardRow[] }) {
  const leader = top[0] ?? null;
  const rest = top.slice(1, 3);
  return (
    <Link
      href="/leaderboard"
      className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl px-5 py-4 transition-colors hover:bg-[var(--gold-a06)]"
      style={{ background: "var(--gold-a03)", border: "1px solid var(--gold-a20)" }}
    >
      <style>{`
        @keyframes owc-breathe { 0%, 100% { opacity: .55; transform: scale(1); } 50% { opacity: 1; transform: scale(1.3); } }
        .owc-pulse { animation: owc-breathe 2.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .owc-pulse { animation: none !important; } }
      `}</style>

      {/* العنوان + النقطة الحية */}
      <span className="flex items-center gap-2 text-[13.5px] font-bold text-foreground">
        <span aria-hidden className="owc-pulse size-2 rounded-full" style={{ background: "var(--gold)", boxShadow: "0 0 8px var(--gold-a60)" }} />
        <span className="text-gold"><PodiumIcon /></span>
        لوحة الأسبوع — سباق حي
      </span>

      {leader ? (
        <>
          {/* المتصدر: الاسم + الدرجة الذهبية بخط Zain */}
          <span className="flex items-baseline gap-2">
            <span className="text-[13px] font-semibold text-foreground">{leader.name}</span>
            <b
              className="text-[22px] font-extrabold leading-none text-gold"
              style={{ fontFamily: "var(--font-zain)", fontVariantNumeric: "tabular-nums", textShadow: "0 0 14px var(--gold-a35)" }}
            >
              {toArabicDigits(leader.score)}
            </b>
          </span>
          {/* الثاني والثالث — سطر مختصر */}
          {rest.length > 0 && (
            <span className="text-[12px]" style={{ color: "var(--od-t2)", fontVariantNumeric: "tabular-nums" }}>
              {rest.map((r, i) => `${toArabicDigits(i + 2)}· ${r.name} ${toArabicDigits(r.score)}`).join("  ·  ")}
            </span>
          )}
        </>
      ) : (
        <span className="text-[12.5px]" style={{ color: "var(--od-t3)" }}>ما فيه ترتيب بعد هذا الأسبوع</span>
      )}

      <span className="mr-auto text-[12px] font-medium text-gold">افتح اللوحة ←</span>
    </Link>
  );
}
