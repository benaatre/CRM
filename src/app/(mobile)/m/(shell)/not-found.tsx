import Link from "next/link";
import { MOBILE_COLORS } from "@/lib/mobile-tokens";
import { BackButton } from "@/components/back-button";

/**
 * «غير موجود» داخل قشرة الجوال.
 *
 * موضعها مقصود: شقيقة `(shell)/layout.tsx` — فحدّ الالتقاط يقع **تحت** القشرة،
 * ويلتقط `notFound()` الصادر من كل صفحات /m تحتها (‏leads/[id] · projects/[id]‏)
 * فتُعرض داخل القشرة بشريط الزئبق ظاهرًا لا صفحة عارية خارج التطبيق.
 * لو وُضعت أعلى (في m/ أو الجذر) لخرج المستخدم من التطبيق بصريًا.
 *
 * ملاحظة: المسارات **غير المطابقة** (‏/m/xyz‏) تبقى من نصيب الجذر — قاعدة
 * App Router: not-found المتداخلة تلتقط نداءات notFound() فقط.
 */
export default function MobileNotFound() {
  return (
    <div className="m-screen flex flex-col items-center justify-center text-center" style={{ gap: 14, minHeight: "60dvh" }}>
      <div style={{ fontSize: 44, color: MOBILE_COLORS.gold }} aria-hidden>⚑</div>

      <h1 style={{ fontSize: 19, fontWeight: 800, color: MOBILE_COLORS.textPrimary }}>
        ما لقينا هذي الصفحة
      </h1>
      <p style={{ fontSize: 13, lineHeight: 1.9, color: MOBILE_COLORS.textSecondary, maxWidth: 300 }}>
        يمكن الرابط قديم، أو الشي اللي تدوّره انحذف أو ما عاد لك صلاحية عليه.
      </p>

      <div className="flex flex-col" style={{ gap: 9, width: "100%", maxWidth: 280, marginTop: 6 }}>
        <Link
          href="/m"
          className="m-press flex items-center justify-center"
          style={{
            boxSizing: "border-box", minHeight: 50, borderRadius: 14,
            background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg,
            fontSize: 14, fontWeight: 800,
          }}
        >
          رجوع للرئيسية
        </Link>
        <BackButton
          className="m-press"
          style={{
            boxSizing: "border-box", minHeight: 50, borderRadius: 14,
            background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
            color: MOBILE_COLORS.textSecondary, fontSize: 14, fontWeight: 700,
          }}
        />
      </div>

      <p style={{ fontSize: 11, color: MOBILE_COLORS.textMuted, marginTop: 18 }} dir="ltr">
        رقم فال REGA: 1200021029
      </p>
    </div>
  );
}
