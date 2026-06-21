"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { syncGoogleSheet } from "@/lib/actions/settings";

// مزامنة دورية تلقائية لجوجل شيت أثناء فتح صفحة الفريق (كل ٥ دقائق).
// للمزامنة في الخلفية دائمًا استخدم cron على /api/sync-sheet.
export function SheetAutoSync({ enabled, intervalMin = 5 }: { enabled: boolean; intervalMin?: number }) {
  const router = useRouter();
  const [last, setLast] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const run = async () => {
      const res = await syncGoogleSheet();
      if (res.ok && (res.created ?? 0) > 0) {
        setLast(`+${res.created} عميل من الشيت`);
        router.refresh();
      }
    };
    const t = setInterval(run, intervalMin * 60_000);
    return () => clearInterval(t);
  }, [enabled, intervalMin, router]);

  if (!enabled) return null;
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <RefreshCw className="size-3.5" />
      مزامنة الشيت تلقائيًا كل {intervalMin} دقائق {last ? `· ${last}` : ""}
    </div>
  );
}
