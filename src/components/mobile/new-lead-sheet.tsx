"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { UnitType } from "@prisma/client";
import { createLead } from "@/lib/actions/leads";
import { fetchSources } from "@/lib/actions/sources";
import type { SourceListItem } from "@/lib/data/sources";
import { unitTypeLabels } from "@/lib/labels";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { DistrictSelect } from "@/components/leads/district-select";

type Employee = { id: string; name: string };

const fieldStyle = {
  boxSizing: "border-box" as const,
  width: "100%",
  minHeight: 44,
  background: MOBILE_COLORS.bg,
  border: `1px solid ${MOBILE_COLORS.border}`,
  borderRadius: 10,
  padding: "0 12px",
  fontSize: 13,
  color: MOBILE_COLORS.textPrimary,
  outline: "none",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block" style={{ marginTop: 12 }}>
      <span className="block" style={{ fontSize: "12.5px", color: MOBILE_COLORS.textSecondary, marginBottom: 6 }}>{label}</span>
      {children}
    </label>
  );
}

/**
 * ورقة «عميل جديد» — نقل NewLeadDialog للجوال بنفس الحقول والأكشن حرفيًا:
 * createLead(FormData) + fetchSources() + DistrictSelect المشترك.
 * المصدر إجباري (نفس تحقق الديسكتوب قبل الإرسال، والخادم يعيد فرضه) — والقناة تُشتق منه على الخادم.
 */
export function MobileNewLeadSheet({
  open, onClose, isManager, employees,
}: {
  open: boolean;
  onClose: () => void;
  isManager: boolean;
  employees: Employee[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<SourceListItem[]>([]);
  const [sourceSel, setSourceSel] = useState("");
  const [areas, setAreas] = useState<string[]>([]);

  useEffect(() => {
    if (open) { fetchSources().then(setSources).catch(() => {}); setAreas([]); setSourceSel(""); setError(null); }
  }, [open]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!sourceSel) { setError("اختر مصدر العميل"); return; }
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createLead(formData);
      if (res.ok) { router.refresh(); onClose(); }
      else setError(res.error ?? "صار خطأ");
    });
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="عميل جديد"
      subtitle="نفس نموذج الديسكتوب — المصدر إجباري"
      tall
      footer={
        /* خارج <form> — سمة form تبقيه زرّ إرسال حقيقيًا. */
        <button
          type="submit"
          form="m-newlead-form"
          disabled={pending}
          className="m-press m-sweep w-full"
          style={{
            boxSizing: "border-box", height: 48, borderRadius: 12, border: "none",
            background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg,
            fontSize: 14, fontWeight: 700, opacity: pending ? 0.6 : 1,
          }}
        >
          {pending ? "جارٍ الحفظ…" : "أضف العميل"}
        </button>
      }
    >
      <form id="m-newlead-form" onSubmit={onSubmit} style={{ marginTop: 6 }}>
        <Row label="الاسم *"><input name="name" required style={fieldStyle} placeholder="اسم العميل" /></Row>
        <Row label="الجوال *"><input name="phone" required inputMode="numeric" dir="ltr" style={fieldStyle} placeholder="05xxxxxxxx" /></Row>

        <Row label="المصدر *">
          <select name="sourceId" value={sourceSel} onChange={(e) => setSourceSel(e.target.value)} style={fieldStyle}>
            <option value="">— اختر المصدر —</option>
            {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Row>

        <div className="grid grid-cols-2" style={{ gap: 10 }}>
          <Row label="نوع الوحدة">
            <select name="unitType" style={fieldStyle} defaultValue="">
              <option value="">—</option>
              {(Object.keys(unitTypeLabels) as UnitType[]).map((u) => (
                <option key={u} value={u}>{unitTypeLabels[u]}</option>
              ))}
            </select>
          </Row>
          <Row label="الميزانية">
            <input name="budget" inputMode="numeric" dir="ltr" style={fieldStyle} placeholder="750000" />
          </Row>
        </div>

        {isManager && (
          <Row label="الموظف المسؤول">
            <select name="assignedToId" style={fieldStyle} defaultValue="">
              <option value="">أنا</option>
              {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
            </select>
          </Row>
        )}

        {/* نفس مكوّن الأحياء المشترك — يكتب على preferredAreas حصرًا. */}
        <div style={{ marginTop: 12 }}>
          <DistrictSelect value={areas} onChange={setAreas} disabled={pending} />
          {areas.map((a) => <input key={a} type="hidden" name="preferredAreas" value={a} />)}
        </div>

        <Row label="ملاحظات">
          <textarea name="notes" rows={2} style={{ ...fieldStyle, minHeight: 62, padding: "10px 12px", lineHeight: 1.8 }} placeholder="أي ملاحظة…" />
        </Row>

        {error && (
          <p style={{
            boxSizing: "border-box", marginTop: 12, borderRadius: 10, padding: "9px 12px", fontSize: "12.5px",
            background: MOBILE_STATUS.danger.bg, color: MOBILE_STATUS.danger.fg,
            border: `1px solid ${MOBILE_STATUS.danger.border}`,
          }}>
            {error}
          </p>
        )}

      </form>
    </BottomSheet>
  );
}

export default MobileNewLeadSheet;
