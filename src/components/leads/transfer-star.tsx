import { Star, PhoneMissed } from "lucide-react";

/**
 * علامة العميل المحوّل بجانب اسمه (ثابتة، بلا أنيميشن):
 *  - استنفاد محاولات (exhausted): أيقونة اتصال حمراء + «تم التواصل ولم يتم الرد».
 *  - تقصير (neglect): نجمة ذهبية + «عميل محوّل — يحتاج اهتمام».
 * تظهر لو show=true (أُعيد توجيهه بلا متابعة بعد الإسناد)، وتختفي أول متابعة. يُحسب على الخادم.
 */
export function TransferStar({ show, exhausted }: { show: boolean; exhausted?: boolean }) {
  if (!show) return null;
  if (exhausted) {
    return (
      <span title="تم التواصل ولم يتم الرد" className="inline-flex shrink-0 align-middle">
        <PhoneMissed className="size-3.5 text-destructive" aria-label="تم التواصل ولم يتم الرد" />
      </span>
    );
  }
  return (
    <span title="عميل محوّل — يحتاج اهتمام" className="inline-flex shrink-0 align-middle">
      <Star className="size-3.5 fill-gold text-gold" aria-label="عميل محوّل — يحتاج اهتمام" />
    </span>
  );
}
