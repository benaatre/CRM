"use client";

import { useState } from "react";
import type { TransferMode } from "@/lib/transfer-mode";

type Variant = "transfer" | "distribute";
type Option = { value: TransferMode; label: string; desc: string };

/**
 * نصوص الخيارين — مصدر واحد تشاركه النافذة وواجهات التوزيع التي تعرضهما مضمّنين،
 * فلا يختلف ما يقرأه المالك باختلاف مكان الضغط.
 * transfer: نقل بين موظفين (وسم ⇄ «محوَّل» في وضع «بالبيانات»).
 * distribute: توزيع من حوض «غير الموزّعين» — لا وسم إطلاقًا، والفرق في كشف التاريخ فقط.
 */
export const MODE_OPTIONS: Record<Variant, Option[]> = {
  transfer: [
    { value: "full", label: "تحويل بالبيانات", desc: "الموظف الجديد يرى كل المتابعات والتاريخ — ويظهر على العميل وسم ⇄ «محوَّل»." },
    { value: "fresh", label: "تحويل كجديد", desc: "يصل للموظف كعميل جديد تمامًا: بلا تاريخ ظاهر وبلا أي وسم. السجل الكامل يبقى محفوظًا للمالك والأدمن." },
  ],
  distribute: [
    { value: "full", label: "توزيع بالبيانات", desc: "من له متابعات سابقة (مسترد أو مسحوب) يصل للموظف وتاريخه ظاهر أمامه." },
    { value: "fresh", label: "توزيع كعملاء جدد", desc: "من له تاريخ سابق يصل نظيفًا — متابعاته القديمة تُخفى عن الموظف وتبقى كاملة لك. الجدد فعلًا لا يتأثرون." },
  ],
};

/** نافذة اختيار وضع النقل/التوزيع — الوضع إلزامي، لا تنفيذ صامت بضغطة. */
export function TransferModeDialog({
  title, variant = "transfer", confirmLabel = "تنفيذ", onClose, onConfirm,
}: {
  title: string;
  variant?: Variant;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: (mode: TransferMode) => void;
}) {
  const [mode, setMode] = useState<TransferMode>("full");
  const options = MODE_OPTIONS[variant];

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-5 shadow-2xl">
          <div>
            <h2 className="font-bold text-foreground">{title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">اختر كيف يستلمه الموظف:</p>
          </div>

          <div className="space-y-2">
            {options.map((o) => (
              <label key={o.value} className={`block cursor-pointer rounded-xl border p-3 transition-colors ${mode === o.value ? "border-gold bg-gold/10" : "border-border hover:bg-secondary/40"}`}>
                <div className="flex items-center gap-2">
                  <input type="radio" name="lead-mode" checked={mode === o.value} onChange={() => setMode(o.value)} />
                  <span className="text-sm font-medium text-foreground">{o.label}</span>
                </div>
                <p className="mt-1 pr-6 text-xs text-muted-foreground">{o.desc}</p>
              </label>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground">إلغاء</button>
            <button onClick={() => onConfirm(mode)} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">{confirmLabel}</button>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * صفّ اختيار الوضع مضمّنًا (لواجهات التوزيع التي هي نافذة أصلًا — لا نضع نافذة داخل نافذة).
 * نفس الخيارات والنصوص حرفيًا.
 */
export function ModeChoiceRow({
  variant = "distribute", value, onChange,
}: {
  variant?: Variant;
  value: TransferMode;
  onChange: (mode: TransferMode) => void;
}) {
  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <span className="text-xs font-medium text-foreground">حالة العميل عند استلام الموظف:</span>
      {MODE_OPTIONS[variant].map((o) => (
        <label key={o.value} className={`block cursor-pointer rounded-lg border p-2.5 transition-colors ${value === o.value ? "border-gold bg-gold/10" : "border-border hover:bg-secondary/40"}`}>
          <div className="flex items-center gap-2">
            <input type="radio" name={`mode-row-${variant}`} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span className="text-sm font-medium text-foreground">{o.label}</span>
          </div>
          <p className="mt-1 pr-6 text-[11px] text-muted-foreground">{o.desc}</p>
        </label>
      ))}
    </div>
  );
}
