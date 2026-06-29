"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PauseCircle, PlayCircle, Loader2 } from "lucide-react";
import { formatPauseRemaining, pauseReasonLabel, type PauseReasonCode, type PauseDurationCode } from "@/lib/availability";
import { pauseAvailability, resumeAvailability, type MyAvailability } from "@/lib/actions/availability";
import { PauseDialog } from "./availability-ui";

/** زر توفّر الموظف لنفسه (في الهيدر) — إيقاف/رجوع استقبال العملاء. */
export function SelfAvailabilityToggle({ initial }: { initial: MyAvailability }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showDialog, setShowDialog] = useState(false);

  function pause(reason: PauseReasonCode, duration: PauseDurationCode) {
    startTransition(async () => {
      const res = await pauseAvailability({ reason, duration });
      if (res.ok) { setShowDialog(false); router.refresh(); }
    });
  }
  function resume() {
    startTransition(async () => {
      const res = await resumeAvailability();
      if (res.ok) router.refresh();
    });
  }

  if (initial.paused) {
    return (
      <button onClick={resume} disabled={pending}
        title={`متوقف — ${pauseReasonLabel(initial.reason)} · ${formatPauseRemaining(initial.pauseUntil)}`}
        className="flex min-h-11 items-center gap-1.5 rounded-xl border border-success/40 px-3 py-2 text-sm font-medium text-success transition-colors hover:bg-success/10 disabled:opacity-50">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <PlayCircle className="size-4" />}
        <span className="hidden sm:inline">رجوع للاستقبال</span>
      </button>
    );
  }

  return (
    <>
      <button onClick={() => setShowDialog(true)}
        title="إيقاف استقبال العملاء الجدد مؤقتًا"
        className="flex min-h-11 items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive">
        <PauseCircle className="size-4" />
        <span className="hidden sm:inline">إيقاف الاستقبال</span>
      </button>
      {showDialog && (
        <PauseDialog title="إيقاف استقبال العملاء" pending={pending} onClose={() => setShowDialog(false)} onConfirm={pause} />
      )}
    </>
  );
}
