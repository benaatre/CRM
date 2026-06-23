"use client";

import type { LeadStage } from "@prisma/client";
import { stageLabels, stageColor } from "@/lib/labels";
import { FollowUpsForm } from "./followups-form";
import { FollowUpsTimeline } from "./followups-timeline";
import { useFollowUps } from "./use-followups";

export function FollowUpsDrawer({
  leadId, leadName, stage, onClose, onChanged,
}: {
  leadId: string | null;
  leadName: string;
  stage: LeadStage;
  onClose: () => void;
  onChanged?: () => void;
}) {
  if (!leadId) return null;
  return <DrawerBody leadId={leadId} leadName={leadName} stage={stage} onClose={onClose} onChanged={onChanged} />;
}

function DrawerBody({
  leadId, leadName, stage, onClose, onChanged,
}: {
  leadId: string;
  leadName: string;
  stage: LeadStage;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { items, loading, reload } = useFollowUps(leadId);
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-r border-border bg-card shadow-2xl">
        <header className="flex items-start justify-between border-b border-border p-5">
          <div>
            <h2 className="text-lg font-bold text-foreground">متابعات العميل</h2>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{leadName}</span>
              <span className={`rounded-full border px-2 py-0.5 text-xs ${stageColor[stage]}`}>{stageLabels[stage]}</span>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-muted-foreground hover:bg-secondary">إغلاق</button>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <FollowUpsForm leadId={leadId} stage={stage} projects={[]} onSaved={() => { reload(); onChanged?.(); }} />
          <FollowUpsTimeline items={items} loading={loading} />
        </div>
      </aside>
    </>
  );
}
