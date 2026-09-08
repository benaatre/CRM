import Link from "next/link";
import { toArabicDigits } from "@/lib/format";

/**
 * بطاقة جسر «لوحة الأسبوع» بلوحة المالك — عرض وتنقل فقط، صفر منطق:
 * مصغّر حي من getLeaderboard القائمة (الثلاثة الأوائل يصلون جاهزين من
 * OwnerDashboard — لا استعلام هنا)، وكامل البطاقة رابط يفتح /leaderboard.
 *
 * تجويد 2026-09-08 (لقطة المالك): بلوك متصدر متماسك بتاج ودرجة ضخمة،
 * الوصيفان رقاقتان مستقلتان بدل السطر النقطي المشوش، والفراغ الميت حُسم
 * بعنقود واحد يتنفس. **صفر لا يُتوَّج**: انطلاقة الأسبوع (الكل صفر) تعرض
 * حالة «السباق ينطلق» بدل تتويج صفرٍ ذهبي — عرضٌ خالص فوق نفس البيانات.
 */

/** كأس — SVG خطي بحجم مقيّد (لا إيموجي). */
function TrophyIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinejoin="round" strokeLinecap="round" aria-hidden="true" style={{ maxWidth: 22, maxHeight: 22 }}>
      <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4z" />
      <path d="M7 6H4a2 2 0 0 0 2 4h1M17 6h3a2 2 0 0 1-2 4h-1" />
    </svg>
  );
}

/** تاج المتصدر — صغير بجانب اسمه. */
function CrownIcon() {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinejoin="round" strokeLinecap="round" aria-hidden="true" style={{ maxWidth: 14, maxHeight: 14 }}>
      <path d="M4 17h16M4.5 17 3 8.5 8 12l4-6 4 6 5-3.5L19.5 17h-15Z" />
    </svg>
  );
}

export type WeekCardRow = { id: string; name: string; score: number };

export function OwnerWeekCard({ top }: { top: WeekCardRow[] }) {
  const leader = top[0] ?? null;
  const rest = top.slice(1, 3);
  // انطلاقة الأسبوع: لا أحد سجّل شيئًا بعد — لا نتوّج صفرًا.
  const racing = leader !== null && leader.score > 0;

  return (
    <Link
      href="/leaderboard"
      className="n-btn relative mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 overflow-hidden px-5 py-[15px]"
      style={{
        // البطاقة المتوّجة (SOP v2): سطح ممزوج بالذهب، حد المتوّج a45، وظل raise + توهج خارجي.
        background: "linear-gradient(160deg, color-mix(in srgb, var(--gold) 13%, var(--plane)), var(--plane))",
        border: "1px solid var(--gold-a45)",
        borderRadius: 16,
        boxShadow: "5px 5px 12px var(--sd), -5px -5px 12px var(--sl), 0 0 22px var(--gold-glow)",
      }}
    >
      {/* توهج يتنفس — زخرفة خالصة (دروع الحركة في owner-sop.css) */}
      <span aria-hidden className="od-breathe pointer-events-none absolute inset-0" style={{ boxShadow: "inset 0 0 28px var(--gold-glow)" }} />

      {/* عنقود العنوان: بئر كأس غائر + سطران (الاسم + الحالة الحية) */}
      <span className="relative flex items-center gap-3">
        <span className="sop-inset flex size-[38px] items-center justify-center" style={{ color: "var(--gold)", background: "var(--gold-glow)", borderRadius: 12 }}>
          <TrophyIcon />
        </span>
        <span>
          <span className="block text-[14px] font-bold leading-tight" style={{ color: "var(--tx)" }}>لوحة الأسبوع</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: "var(--gold)" }}>
            <span aria-hidden className="od-pulse size-[7px] rounded-full" style={{ background: "var(--gold)", boxShadow: "0 0 8px var(--gold-a45)" }} />
            سباق حي
          </span>
        </span>
      </span>

      {/* فاصل عمودي رقيق يفصل الهوية عن الترتيب */}
      <span aria-hidden className="relative hidden h-8 w-px sm:block" style={{ background: "var(--gold-a25)" }} />

      {racing ? (
        <>
          {/* المتصدر: تاج + اسم + درجة Zain ضخمة — القطعة الذهبية الوحيدة الصارخة */}
          <span className="relative flex items-center gap-2.5">
            <span className="flex items-center gap-1.5" style={{ color: "var(--gold)" }}>
              <CrownIcon />
              <span className="text-[14.5px] font-bold" style={{ color: "var(--tx)" }}>{leader!.name}</span>
            </span>
            <b
              className="text-[26px] font-extrabold leading-none"
              style={{ color: "var(--gold)", fontFamily: "var(--font-zain), var(--font-sans)", fontVariantNumeric: "tabular-nums", textShadow: "0 0 14px var(--gold-a25)" }}
            >
              {toArabicDigits(leader!.score)}
            </b>
          </span>

          {/* الوصيفان: رقاقتان مستقلتان — رتبة ذهبية خافتة + اسم + درجة */}
          {rest.length > 0 && (
            <span className="relative flex items-center gap-2">
              {rest.map((r, i) => (
                <span
                  key={r.id}
                  className="inline-flex items-baseline gap-1.5 rounded-full px-3 py-1 text-[12px]"
                  style={{ border: "1px solid var(--edge-2)", background: "color-mix(in srgb, var(--plane-hi) 60%, transparent)" }}
                >
                  <b style={{ color: "var(--gold)", fontFamily: "var(--font-zain), var(--font-sans)" }}>{toArabicDigits(i + 2)}</b>
                  <span style={{ color: "var(--tx2)" }}>{r.name}</span>
                  <b style={{ color: "var(--tx)", fontFamily: "var(--font-zain), var(--font-sans)", fontVariantNumeric: "tabular-nums" }}>{toArabicDigits(r.score)}</b>
                </span>
              ))}
            </span>
          )}
        </>
      ) : (
        // انطلاقة الأسبوع — لا تتويج لصفر: دعوة هادئة بدل درجة فارغة.
        <span className="relative text-[12.5px]" style={{ color: "var(--tx2)" }}>
          السباق انطلق — أول متابعة تشعل العدّاد، والصدارة شاغرة
        </span>
      )}

      {/* رقاقة الفتح — حبة ذهبية شفيفة بأقصى اليسار */}
      <span
        className="relative rounded-full px-3.5 py-1.5 text-[12px] font-medium"
        style={{ marginInlineStart: "auto", color: "var(--gold)", border: "1px solid var(--gold-a25)", background: "var(--gold-glow)" }}
      >
        افتح اللوحة ←
      </span>
    </Link>
  );
}
