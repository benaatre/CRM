"use client";

import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";
import { MobileEmployeeSheet } from "@/components/mobile/employee-sheet";

/**
 * قائمة الفريق — كل صف يفتح ورقة إعدادات الموظف (نفس حقول وأكشنات الديسكتوب).
 * النصوص الزمنية تصل **محسوبة من الخادم** (lastSeenText) فلا يختلف الترطيب عند
 * انقلاب اليوم بتوقيت الرياض.
 */
export type RosterRow = {
  id: string;
  name: string;
  roleText: string;
  isOwnerRole: boolean;
  phone: string | null;
  online: boolean;
  active: boolean;
  paused: boolean;
  pauseText: string | null;
  /** «آخر ظهور: اليوم ٣:٤٥ م» — محسوب على الخادم. */
  lastSeenText: string;
  total: number;
  closed: number;
  target: number;
  activityRate: number;
};

export function MobileTeamRoster({ rows }: { rows: RosterRow[] }) {
  const [open, setOpen] = useState<{ id: string; name: string } | null>(null);

  return (
    <>
      <div className="flex flex-col" style={{ gap: 9 }}>
        {rows.map((m, i) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setOpen({ id: m.id, name: m.name })}
            className="m-rise block w-full text-start"
            style={{
              boxSizing: "border-box",
              background: MOBILE_COLORS.card,
              border: `1px solid ${MOBILE_COLORS.border}`,
              borderRadius: 16, padding: "13px 14px",
              opacity: m.active ? 1 : 0.55,
              animationDelay: `${Math.min(i, 8) * 45}ms`,
            }}
          >
            <div className="flex items-center justify-between" style={{ gap: 8 }}>
              <span className="flex min-w-0 flex-1 items-center" style={{ gap: 8 }}>
                <span
                  className="flex-none"
                  style={{ width: 8, height: 8, borderRadius: 5, background: m.online ? MOBILE_STATUS.success.base : MOBILE_COLORS.dim2 }}
                  aria-hidden
                />
                <span className="min-w-0">
                  <span className="block truncate" style={{ fontSize: "14.5px", fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>
                    {m.name}
                  </span>
                  {m.phone && (
                    <span className="block truncate" dir="ltr" style={{ fontSize: 11, color: MOBILE_COLORS.textMuted, marginTop: 2 }}>
                      {m.phone}
                    </span>
                  )}
                </span>
              </span>
              <span className="flex flex-none items-center" style={{ gap: 6 }}>
                <span
                  style={{
                    boxSizing: "border-box", fontSize: "10.5px", fontWeight: 600, padding: "3px 8px", borderRadius: 7,
                    background: m.isOwnerRole ? MOBILE_COLORS.goldBg : MOBILE_COLORS.line2,
                    color: m.isOwnerRole ? MOBILE_COLORS.gold : MOBILE_COLORS.textSecondary,
                  }}
                >
                  {m.roleText}
                </span>
                <ChevronLeft size={16} style={{ color: MOBILE_COLORS.dim1 }} aria-hidden />
              </span>
            </div>

            {/* آخر ظهور بالضبط + الحالة */}
            <div style={{ fontSize: "11.5px", color: MOBILE_COLORS.textSecondary, marginTop: 8 }}>
              {m.online
                ? <span style={{ color: MOBILE_STATUS.success.fg }}>متصل الآن</span>
                : <>آخر ظهور: {m.lastSeenText}</>}
              {!m.active && <span style={{ color: MOBILE_COLORS.textMuted }}> · الحساب موقوف</span>}
            </div>
            {m.paused && m.pauseText && (
              <div style={{ fontSize: 11, color: MOBILE_STATUS.warning.fg, marginTop: 4 }}>{m.pauseText}</div>
            )}

            {/* عملاء · مقفول · الهدف */}
            <div className="grid grid-cols-3" style={{ gap: 7, marginTop: 11 }}>
              <Stat value={toArabicDigits(m.total)} label="عملاء" color={MOBILE_COLORS.textPrimary} />
              <Stat value={toArabicDigits(m.closed)} label="مقفول" color={MOBILE_STATUS.success.fg} />
              <Stat value={m.target > 0 ? toArabicDigits(m.target) : "—"} label="الهدف" color={MOBILE_COLORS.gold} />
            </div>

            <div className="flex items-center" style={{ gap: 9, marginTop: 10 }}>
              <span className="flex-none" style={{ fontSize: 11, color: MOBILE_COLORS.textMuted }}>النشاط</span>
              <span className="flex-1 overflow-hidden" style={{ height: 6, borderRadius: 3, background: MOBILE_COLORS.border, display: "block" }}>
                <span style={{ display: "block", height: "100%", borderRadius: 3, width: `${m.activityRate}%`, background: MOBILE_COLORS.gold }} />
              </span>
              <span className="flex-none" style={{ fontSize: 11, fontWeight: 600, color: MOBILE_COLORS.gold }}>
                {toArabicDigits(m.activityRate)}٪
              </span>
            </div>
          </button>
        ))}
      </div>

      <MobileEmployeeSheet userId={open?.id ?? null} name={open?.name ?? ""} onClose={() => setOpen(null)} />
    </>
  );
}

function Stat({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <span
      className="block text-center"
      style={{ boxSizing: "border-box", borderRadius: 10, padding: "8px 4px", background: MOBILE_COLORS.bg }}
    >
      <span className="block" style={{ fontSize: 15, fontWeight: 700, color }}>{value}</span>
      <span className="block" style={{ fontSize: 10.5, color: MOBILE_COLORS.textMuted, marginTop: 2 }}>{label}</span>
    </span>
  );
}

export default MobileTeamRoster;
