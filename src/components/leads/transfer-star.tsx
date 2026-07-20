import { Star } from "lucide-react";

/**
 * نجمة العميل المحوّل ⭐ — ثابتة (بلا أنيميشن)، ذهبية، بجانب اسم العميل.
 * تظهر لو isTransferred (أُعيد توجيهه + ما فيه متابعة بعد آخر إسناد)؛ تختفي أول متابعة.
 * الشرط يُحسب على الخادم في LeadRow.isTransferred.
 */
export function TransferStar({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span title="عميل محوّل — يحتاج اهتمام" className="inline-flex shrink-0 align-middle">
      <Star className="size-3.5 fill-gold text-gold" aria-label="عميل محوّل — يحتاج اهتمام" />
    </span>
  );
}
