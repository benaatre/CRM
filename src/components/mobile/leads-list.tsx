"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Channel, LeadStage } from "@prisma/client";
import { STAGE_HEX, stageChipClass } from "@/lib/stage-colors";
import { stageLabel, channelLabel } from "@/lib/labels";
import { MOBILE_COLORS } from "@/lib/mobile-tokens";
import { waitingLabel, waitingBasisOf } from "@/lib/mobile-format";

export type MobileLeadRow = {
  id: string;
  name: string;
  stage: LeadStage;
  channel: Channel;
  daysWaiting: number;
  /** لتحديد أساس نص الانتظار (آخر تواصل أم الإسناد) — لا يُخمَّن. */
  lastContact: Date | null;
  assignedAt: Date | null;
};

const PAGE = 20;

/**
 * قائمة العملاء بتمرير لانهائي — الصفوف كلها محمّلة من الخادم (محجَّمة بالدور)،
 * والعرض يتدرّج على العميل بـIntersectionObserver. لا استعلام إضافي لكل صفحة.
 */
export function MobileLeadsList({ rows }: { rows: MobileLeadRow[] }) {
  const [shown, setShown] = useState(Math.min(PAGE, rows.length));
  const sentinel = useRef<HTMLDivElement | null>(null);

  // الفلاتر تغيّر الصفوف — نرجّع العدّاد لأول صفحة.
  useEffect(() => { setShown(Math.min(PAGE, rows.length)); }, [rows]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || shown >= rows.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setShown((n) => Math.min(n + PAGE, rows.length));
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown, rows.length]);

  return (
    <div className="flex flex-col" style={{ gap: 9 }}>
      {rows.slice(0, shown).map((l) => (
        <Link
          key={l.id}
          href={`/m/leads/${l.id}`}
          className="relative flex items-center overflow-hidden text-right"
          style={{
            boxSizing: "border-box",
            background: MOBILE_COLORS.card,
            border: `1px solid ${MOBILE_COLORS.border}`,
            borderRadius: 15,
            padding: "12px 16px 12px 13px",
            gap: 10,
            minHeight: 44,
          }}
        >
          <span
            className="absolute bottom-0 right-0 top-0"
            style={{ width: 3, background: STAGE_HEX[l.stage] }}
            aria-hidden
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate" style={{ fontSize: "14.5px", fontWeight: 600, color: MOBILE_COLORS.textPrimary }}>
              {l.name}
            </span>
            <span className="block truncate" style={{ fontSize: "11.5px", color: MOBILE_COLORS.textMuted, marginTop: 4 }}>
              {waitingLabel(l.daysWaiting, waitingBasisOf(l))} · {channelLabel(l.channel)}
            </span>
          </span>
          <span
            className={`shrink-0 whitespace-nowrap border font-semibold ${stageChipClass[l.stage]}`}
            style={{ fontSize: "10.5px", padding: "4px 9px", borderRadius: 7 }}
          >
            {stageLabel(l.stage)}
          </span>
        </Link>
      ))}

      {shown < rows.length && (
        <div ref={sentinel} className="flex flex-col" style={{ gap: 9 }} aria-hidden>
          <div style={{ height: 66, borderRadius: 15, background: MOBILE_COLORS.card }} className="animate-pulse" />
          <div style={{ height: 66, borderRadius: 15, background: MOBILE_COLORS.card, opacity: 0.6 }} className="animate-pulse" />
        </div>
      )}
    </div>
  );
}

export default MobileLeadsList;
