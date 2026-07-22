import Link from "next/link";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { formatCount, toArabicDigits } from "@/lib/format";

// §٥: بانر الموظف — «⚠ N عملاء يُسحبون منك خلال ٢٤ ساعة» (N = حالة warning).
// أصفر (>٦ ساعات متبقّية) ← أحمر (<٦ ساعات). يختفي عند N=0. بلا إشعار وبلا صوت. للموظف فقط.
export function NoResponseBanner({
  warningCount, warningMinHoursLeft, pulled,
}: {
  warningCount: number;
  warningMinHoursLeft: number | null;
  pulled: number;
}) {
  if (warningCount <= 0 && pulled <= 0) return null;

  // رابط عملائه المعرّضين للسحب: مراحل عدم الرد، الأقدم نشاطًا أولًا.
  const lateHref = "/leads?stages=NEW,ATTEMPTED&sort=oldest";
  const urgent = warningMinHoursLeft != null && warningMinHoursLeft < 6; // أقل من ٦ ساعات → أحمر
  const tone = urgent
    ? { border: "border-destructive/50", bg: "bg-destructive/[0.08]", text: "text-destructive", chip: "bg-destructive/15" }
    : { border: "border-warning/50", bg: "bg-warning/[0.08]", text: "text-warning", chip: "bg-warning/15" };

  return (
    <div className={`rounded-2xl border ${tone.border} ${tone.bg} p-4`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-full ${tone.chip}`}>
          <AlertTriangle className={`size-5 ${tone.text}`} />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          {warningCount > 0 && (
            <p className={`text-sm font-bold ${tone.text}`}>
              ⚠ {toArabicDigits(warningCount)} عملاء يُسحبون منك خلال ٢٤ ساعة — بادر بمتابعتهم.
            </p>
          )}
          {pulled > 0 && (
            <p className="text-sm font-medium text-destructive/90">تم سحب {formatCount(pulled)} عملاء منك لعدم التواصل.</p>
          )}
        </div>
        {warningCount > 0 && (
          <Link
            href={lateHref}
            className={`flex shrink-0 items-center gap-1.5 rounded-xl border ${tone.border} px-4 py-2 text-sm font-semibold ${tone.text} transition-colors hover:opacity-80`}
          >
            شوف هؤلاء العملاء <ArrowLeft className="size-4" />
          </Link>
        )}
      </div>
    </div>
  );
}
