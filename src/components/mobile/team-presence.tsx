import type { PresenceRow } from "@/lib/data/team";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { elapsedLabel } from "@/lib/mobile-format";

/**
 * «آخر ظهور للموظفين» — صفوف مبسّطة: اسم + نقطة خضراء نابضة «نشط الآن» أو وقت نسبي.
 * server component خالص — النبض m-pulse والدخول m-rise من CSS (يحترمان prefers-reduced-motion).
 */
export function TeamPresence({ rows, now }: { rows: PresenceRow[]; now: Date }) {
  return (
    <div className="flex flex-col" style={{ gap: 7 }}>
      {rows.map((r, i) => (
        <div
          key={r.id}
          className="m-rise flex items-center justify-between"
          style={{
            boxSizing: "border-box", gap: 10, minHeight: 42,
            background: MOBILE_COLORS.card,
            border: `1px solid ${MOBILE_COLORS.border}`,
            borderRadius: 12, padding: "8px 12px",
            animationDelay: `${i * 50}ms`,
          }}
        >
          <span className="truncate" style={{ fontSize: 13, fontWeight: 600, color: MOBILE_COLORS.textPrimary }}>
            {r.name}
          </span>
          {r.online ? (
            <span className="flex flex-none items-center" style={{ gap: 6 }}>
              <span className="m-pulse" style={{ width: 8, height: 8, borderRadius: 5, background: MOBILE_STATUS.success.base }} />
              <span style={{ fontSize: "11.5px", fontWeight: 600, color: MOBILE_STATUS.success.fg }}>نشط الآن</span>
            </span>
          ) : (
            <span className="flex flex-none items-center" style={{ gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 5, background: MOBILE_COLORS.dim1 }} />
              <span style={{ fontSize: "11.5px", color: MOBILE_COLORS.textMuted }}>
                {r.lastSeenAt ? `آخر ظهور قبل ${elapsedLabel(r.lastSeenAt, now)}` : "لم يظهر بعد"}
              </span>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export default TeamPresence;
