"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import type { UnitType, UnitStatus, Floor } from "@prisma/client";
import { unitTypeLabels, unitStatusLabels, floorLabels } from "@/lib/labels";
import { createUnit, updateUnit } from "@/lib/actions/projects";
import type { UnitRow } from "@/lib/data/projects";

export function UnitForm({ open, onClose, projectId, unit }: { open: boolean; onClose: () => void; projectId: string; unit?: UnitRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isEdit = !!unit;

  if (!open) return null;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = isEdit ? await updateUnit(unit!.id, fd) : await createUnit(projectId, fd);
      if (res.ok) { router.refresh(); onClose(); }
      else setError(res.error ?? "صار خطأ");
    });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="glass relative z-10 w-full max-w-md rounded-2xl p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground">{isEdit ? "تعديل وحدة" : "وحدة جديدة"}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary"><X className="size-5" /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="رقم الوحدة *"><input name="number" required dir="ltr" defaultValue={unit?.number ?? ""} className="select-base" /></Field>
            <Field label="النوع">
              <select name="type" defaultValue={unit?.type ?? "APARTMENT"} className="select-base">
                {(Object.keys(unitTypeLabels) as UnitType[]).map((t) => <option key={t} value={t}>{unitTypeLabels[t]}</option>)}
              </select>
            </Field>
            <Field label="الدور">
              <select name="floorLevel" defaultValue={unit?.floorLevel ?? ""} className="select-base">
                <option value="">—</option>
                {(Object.keys(floorLabels) as Floor[]).map((f) => <option key={f} value={f}>{floorLabels[f]}</option>)}
              </select>
            </Field>
            <Field label="المساحة م²"><input name="area" inputMode="numeric" dir="ltr" defaultValue={unit?.area ?? ""} className="select-base" /></Field>
            <Field label="المساحة الإجمالية م²"><input name="totalArea" inputMode="numeric" dir="ltr" defaultValue={unit?.totalArea ?? ""} className="select-base" placeholder="اختياري" /></Field>
            <Field label="السعر الأصلي"><input name="price" inputMode="numeric" dir="ltr" defaultValue={unit?.price ?? ""} className="select-base" /></Field>
            <Field label="السعر بعد الخصم"><input name="discountedPrice" inputMode="numeric" dir="ltr" defaultValue={unit?.discountedPrice ?? ""} className="select-base" placeholder="اختياري" /></Field>
            <Field label="نسبة الخصم %"><input name="discountPercent" inputMode="numeric" dir="ltr" defaultValue={unit?.discountPercent ?? ""} className="select-base" placeholder="اختياري" /></Field>
            <Field label="الحالة">
              <select name="status" defaultValue={unit?.status ?? "AVAILABLE"} className="select-base">
                {(Object.keys(unitStatusLabels) as UnitStatus[]).map((s) => <option key={s} value={s}>{unitStatusLabels[s]}</option>)}
              </select>
            </Field>
          </div>
          <Field label="ملاحظات"><input name="notes" defaultValue={unit?.notes ?? ""} className="select-base" /></Field>

          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-border px-4 py-2 text-sm text-muted-foreground">إلغاء</button>
            <button type="submit" disabled={pending} className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{pending ? "جارٍ…" : isEdit ? "حفظ" : "أضف"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1.5"><span className="text-xs text-muted-foreground">{label}</span>{children}</label>;
}
