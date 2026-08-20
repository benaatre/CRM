import Link from "next/link";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/format";
import { LEAVE_LABEL } from "@/lib/data/leaves";
import type { HrExtrasData } from "@/lib/data/finance-dashboard";
import type { LiveBoardPayload } from "@/lib/data/attendance";

/**
 * إضافات رئيسية HR — جوال (قرار 2026-08-20): «دوام الفريق اليوم» (قراءة من
 * getLiveBoard القائمة) + بطاقة طلبات الإجازة بانتظاره تفتح على الملفات.
 */

const STATE_LABEL: Record<string, { label: string; tone: { base: string; bg: string; border: string } }> = {
  on: { label: "مداوم", tone: MOBILE_STATUS.success },
  late: { label: "متأخر", tone: MOBILE_STATUS.warning },
  paused: { label: "مستأذن", tone: MOBILE_STATUS.warning },
  remote: { label: "عن بُعد", tone: MOBILE_STATUS.info ?? MOBILE_STATUS.success },
  miss: { label: "غائب", tone: MOBILE_STATUS.danger },
  exc: { label: "معذور", tone: MOBILE_STATUS.warning },
  done: { label: "أكمل", tone: MOBILE_STATUS.success },
};

export function MobileHrExtras({ data, live }: { data: HrExtrasData; live: LiveBoardPayload }) {
  const card = {
    background: MOBILE_COLORS.card,
    border: `1px solid ${MOBILE_COLORS.border}`,
    borderRadius: 16,
    padding: 14,
  } as const;
  const rows = live.mode === "today" ? live.rows : [];

  return (
    <div className="flex flex-col" style={{ gap: 13, marginTop: 13 }}>
      <div style={{ padding: "0 2px", fontSize: 14, fontWeight: 800, color: MOBILE_COLORS.gold }}>الموارد البشرية</div>

      {/* طلبات إجازة بانتظاره */}
      <div style={card}>
        <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: MOBILE_COLORS.textPrimary }}>طلبات إجازة بانتظارك</span>
          <span style={{ background: MOBILE_STATUS.warning.bg, color: MOBILE_STATUS.warning.fg, border: `1px solid ${MOBILE_STATUS.warning.border}`, borderRadius: 99, padding: "2px 9px", fontSize: 10.5, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
            {toArabicDigits(data.pendingLeaves.length)}
          </span>
        </div>
        {data.pendingLeaves.length === 0 ? (
          <div style={{ fontSize: 11, color: MOBILE_COLORS.textMuted }}>ما فيه طلبات معلّقة.</div>
        ) : (
          data.pendingLeaves.map((l) => (
            <Link
              key={l.id}
              href={`/m/employees/${l.userId}`}
              className="block"
              style={{ fontSize: 11.5, lineHeight: 1.9, padding: "6px 0", borderBottom: `1px solid ${MOBILE_COLORS.border}` }}
            >
              <b style={{ color: MOBILE_COLORS.textPrimary }}>{l.userName}</b>
              <span style={{ color: MOBILE_COLORS.textMuted }}> · {LEAVE_LABEL[l.typeKey] ?? l.typeKey} · {l.fromKey} ← {l.toKey}</span>
            </Link>
          ))
        )}
      </div>

      {/* دوام الفريق اليوم — قراءة */}
      <div style={card}>
        <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: MOBILE_COLORS.textPrimary }}>دوام الفريق اليوم</span>
          <Link href="/attendance" style={{ fontSize: 10.5, color: MOBILE_COLORS.gold, fontWeight: 700 }}>حوكمة الدوام ←</Link>
        </div>
        <div className="flex flex-wrap" style={{ gap: 6 }}>
          {rows.length === 0 && <span style={{ fontSize: 11, color: MOBILE_COLORS.textMuted }}>ما فيه بيانات دوام اليوم.</span>}
          {rows.map((r) => {
            const meta = STATE_LABEL[r.state] ?? STATE_LABEL.miss;
            return (
              <Link
                key={r.id}
                href={`/m/employees/${r.id}`}
                className="inline-flex items-center"
                style={{
                  gap: 6, minHeight: 44, padding: "0 11px", borderRadius: 11,
                  background: meta.tone.bg, border: `1px solid ${meta.tone.border}`,
                  fontSize: 11, fontWeight: 700, color: MOBILE_COLORS.textPrimary,
                }}
              >
                {r.name}
                <span style={{ color: meta.tone.base, fontSize: 10 }}>{meta.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
