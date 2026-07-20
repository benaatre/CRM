import Link from "next/link";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { formatCount } from "@/lib/format";
import type { MyAlertLine } from "@/lib/data/no-response";

// بانر إنذار لوحة الموظف — سطر مفصّل لكل فئة تصعيد (بلا رد / تابع مرة / مرتين / ٣) بنصّها الحرفي.
// يظهر فقط لو عنده عملاء متأخرون أو سُحب منه مؤخّرًا. ثيم أوبسيديان + الأحمر للتنبيه فقط.
export function NoResponseBanner({ lines, pulled }: { lines: MyAlertLine[]; pulled: number }) {
  if (lines.length === 0 && pulled <= 0) return null;

  // رابط عملائه المتأخرين: مراحل عدم الرد، الأقدم نشاطًا أولًا (الأكثر عرضة للسحب).
  const lateHref = "/leads?stages=NEW,ATTEMPTED&sort=oldest";

  return (
    <div className="animate-[nrb-in_.4s_ease-out] rounded-2xl border border-destructive/40 bg-destructive/[0.07] p-4">
      <style>{`@keyframes nrb-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}`}</style>
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/15">
          <AlertTriangle className="size-5 animate-pulse text-destructive" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          {lines.map((l) => (
            <p key={l.followUps} className="text-sm font-bold text-destructive">{l.message}</p>
          ))}
          {pulled > 0 && (
            <p className="text-sm font-medium text-destructive/90">
              تم سحب {formatCount(pulled)} عملاء منك لعدم التواصل.
            </p>
          )}
        </div>
        {lines.length > 0 && (
          <Link
            href={lateHref}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/20"
          >
            شوف عملائي المتأخرين <ArrowLeft className="size-4" />
          </Link>
        )}
      </div>
    </div>
  );
}
