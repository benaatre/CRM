"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PauseCircle, PlayCircle, Loader2 } from "lucide-react";
import type { PauseReasonCode, PauseDurationCode } from "@/lib/availability";
import { pauseAvailability, resumeAvailability } from "@/lib/actions/availability";
import { AvailabilityBadge, PauseDialog } from "./availability-ui";

/** تحكّم المالك/المدير بتوفّر موظف معيّن — شارة + زر إيقاف/تفعيل. */
export function ManageEmployeeAvailability({
  employee, showBadge = true,
}: {
  employee: { id: string; name: string; paused: boolean; pauseReason: string | null; pauseUntil: Date | string | null };
  showBadge?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showDialog, setShowDialog] = useState(false);

  function pause(reason: PauseReasonCode, duration: PauseDurationCode) {
    startTransition(async () => {
      const res = await pauseAvailability({ userId: employee.id, reason, duration });
      if (res.ok) { setShowDialog(false); router.refresh(); }
    });
  }
  function resume() {
    startTransition(async () => {
      const res = await resumeAvailability({ userId: employee.id });
      if (res.ok) router.refresh();
    });
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {showBadge && <AvailabilityBadge paused={employee.paused} reason={employee.pauseReason} pauseUntil={employee.pauseUntil} />}
      {employee.paused ? (
        <button onClick={resume} disabled={pending} title="تفعيل الاستقبال"
          className="rounded-lg p-1 text-success hover:bg-success/10 disabled:opacity-50">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <PlayCircle className="size-4" />}
        </button>
      ) : (
        <button onClick={() => setShowDialog(true)} title="إيقاف الاستقبال"
          className="rounded-lg p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
          <PauseCircle className="size-4" />
        </button>
      )}
      {showDialog && (
        <PauseDialog title={`إيقاف استقبال — ${employee.name}`} pending={pending} onClose={() => setShowDialog(false)} onConfirm={pause} />
      )}
    </span>
  );
}
