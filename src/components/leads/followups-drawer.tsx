"use client";

import { useEffect } from "react";
import type { LeadStage, FirstContactStage } from "@prisma/client";
import { stageLabels, stageColor } from "@/lib/labels";
import { FollowUpsForm } from "./followups-form";
import { FollowUpsTimeline } from "./followups-timeline";
import { useFollowUps } from "./use-followups";

export function FollowUpsDrawer({
  leadId, leadName, stage, firstContactStage, onClose, onChanged,
}: {
  leadId: string | null;
  leadName: string;
  stage: LeadStage;
  firstContactStage?: FirstContactStage | null;
  onClose: () => void;
  onChanged?: () => void;
}) {
  if (!leadId) return null;
  return <DrawerBody leadId={leadId} leadName={leadName} stage={stage} firstContactStage={firstContactStage} onClose={onClose} onChanged={onChanged} />;
}

function DrawerBody({
  leadId, leadName, stage, firstContactStage, onClose, onChanged,
}: {
  leadId: string;
  leadName: string;
  stage: LeadStage;
  firstContactStage?: FirstContactStage | null;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { items, loading, reload } = useFollowUps(leadId);

  // الدرج مفتوح = الصفحة خلفه ما تتمرّر (الجوال كان يمرّر الخلفية تحت الدرج)، وEsc يغلقه.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-r border-border bg-card shadow-2xl" role="dialog" aria-modal="true">
        <header className="flex items-start justify-between gap-2 border-b border-border p-4 sm:p-5">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-foreground">متابعات العميل</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">{leadName}</span>
              <span className={`rounded-full border px-2 py-0.5 text-xs ${stageColor[stage]}`}>{stageLabels[stage]}</span>
            </div>
          </div>
          <button onClick={onClose} className="flex min-h-11 shrink-0 items-center rounded-lg px-3 text-sm text-muted-foreground hover:bg-secondary">إغلاق</button>
        </header>
        <div
          className="flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-5"
          style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        >
          <FollowUpsForm leadId={leadId} stage={stage} firstContactStage={firstContactStage} projects={[]} onSaved={() => { reload(); onChanged?.(); }} />
          <FollowUpsTimeline items={items} loading={loading} leadId={leadId} onChanged={() => { reload(); onChanged?.(); }} />
        </div>
      </aside>
    </>
  );
}
