"use client";

import { followUpSectionLabels, followUpSectionColor, followUpResultLabels } from "@/lib/labels";
import { formatDateTime, toArabicDigits } from "@/lib/format";
import type { FollowUpItem } from "./use-followups";

export function FollowUpsTimeline({ items, loading }: { items: FollowUpItem[]; loading: boolean }) {
  return (
    <div className="glass rounded-2xl p-5">
      <h2 className="mb-4 font-semibold text-foreground">سجل المتابعات ({toArabicDigits(items.length)})</h2>
      {loading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">جارٍ التحميل…</p>
      ) : items.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">ما فيه متابعات بعد.</p>
      ) : (
        <ol className="space-y-4 border-r border-border pr-4">
          {items.map((f) => {
            const dotColor = f.section === "NOT_INTERESTED" || f.result.startsWith("NOT_INTERESTED")
              ? "bg-destructive"
              : f.section === "NO_ANSWER"
                ? "bg-warning"
                : f.result === "BOOKED"
                  ? "bg-success"
                  : "bg-gold";
            return (
              <li key={f.id} className="relative">
                <span className={`absolute -right-[1.30rem] top-1.5 size-2 rounded-full ${dotColor}`} />
                <div className="flex flex-wrap items-center gap-2">
                  {f.section && (
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] ${followUpSectionColor[f.section]}`}>
                      {followUpSectionLabels[f.section]}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">{formatDateTime(f.createdAt)}</span>
                </div>
                <p className="mt-1 text-sm font-medium text-foreground">{f.note || followUpResultLabels[f.result]}</p>
                {f.nextDate && <p className="mt-0.5 text-xs text-info">المتابعة القادمة: {formatDateTime(f.nextDate)}</p>}
                {f.employeeName && <p className="mt-0.5 text-xs text-muted-foreground/70">{f.employeeName}</p>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
