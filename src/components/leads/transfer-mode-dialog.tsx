"use client";

import { useState } from "react";
import type { TransferMode } from "@/lib/transfer-mode";

/**
 * نافذة خيارَي التحويل اليدوي لعميل واحد (درج العميل) — بنفس نصوص وخيارات
 * نافذة التحويل الجماعية في /leads، فلا يختلف قرار المالك باختلاف مكان الضغط.
 */
export function TransferModeDialog({
  leadName, employeeName, onClose, onConfirm,
}: {
  leadName: string;
  employeeName: string;
  onClose: () => void;
  onConfirm: (mode: TransferMode) => void;
}) {
  const [mode, setMode] = useState<TransferMode>("full");

  const options: { value: TransferMode; label: string; desc: string }[] = [
    { value: "full", label: "تحويل بالبيانات", desc: "الموظف الجديد يرى كل المتابعات والتاريخ — ويظهر على العميل وسم ⇄ «محوَّل»." },
    { value: "fresh", label: "تحويل كجديد", desc: "يصل للموظف كعميل جديد تمامًا: بلا تاريخ ظاهر وبلا أي وسم. السجل الكامل يبقى محفوظًا للمالك والأدمن." },
  ];

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-5 shadow-2xl">
          <div>
            <h2 className="font-bold text-foreground">تحويل «{leadName}» إلى {employeeName}</h2>
            <p className="mt-1 text-xs text-muted-foreground">اختر كيف يستلمه الموظف:</p>
          </div>

          <div className="space-y-2">
            {options.map((o) => (
              <label key={o.value} className={`block cursor-pointer rounded-xl border p-3 transition-colors ${mode === o.value ? "border-gold bg-gold/10" : "border-border hover:bg-secondary/40"}`}>
                <div className="flex items-center gap-2">
                  <input type="radio" name="reassign-mode" checked={mode === o.value} onChange={() => setMode(o.value)} />
                  <span className="text-sm font-medium text-foreground">{o.label}</span>
                </div>
                <p className="mt-1 pr-6 text-xs text-muted-foreground">{o.desc}</p>
              </label>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground">إلغاء</button>
            <button onClick={() => onConfirm(mode)} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">تنفيذ</button>
          </div>
        </div>
      </div>
    </>
  );
}
