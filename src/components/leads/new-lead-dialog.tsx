"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { channelLabels, channelOrder, unitTypeLabels } from "@/lib/labels";
import type { UnitType } from "@prisma/client";
import { createLead } from "@/lib/actions/leads";
import { fetchSources } from "@/lib/actions/sources";
import type { SourceListItem } from "@/lib/data/sources";

type Employee = { id: string; name: string };

export function NewLeadDialog({
  open,
  onClose,
  isManager,
  employees,
}: {
  open: boolean;
  onClose: () => void;
  isManager: boolean;
  employees: Employee[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [channel, setChannel] = useState<string>("");
  const [sources, setSources] = useState<SourceListItem[]>([]);
  const [sourceSel, setSourceSel] = useState("");

  useEffect(() => { if (open) fetchSources().then(setSources).catch(() => {}); }, [open]);

  if (!open) return null;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!channel) { setError("اختر القناة (المنصة)"); return; }
    if (!sourceSel) { setError("اختر مصدر العميل"); return; }
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createLead(formData);
      if (res.ok) {
        router.refresh();
        onClose();
      } else {
        setError(res.error ?? "صار خطأ");
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="glass relative z-10 w-full max-w-lg rounded-2xl p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground">عميل جديد</h2>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-muted-foreground hover:bg-secondary">إغلاق</button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="الاسم *">
              <input name="name" required className="select-base" placeholder="اسم العميل" />
            </Field>
            <Field label="الجوال *">
              <input name="phone" required inputMode="numeric" dir="ltr" className="select-base" placeholder="05xxxxxxxx" />
            </Field>
            <div className="col-span-2">
              <Field label="المنصة / القناة *">
                <div className="flex flex-wrap gap-1.5">
                  {channelOrder.map((c) => (
                    <button
                      type="button"
                      key={c}
                      onClick={() => setChannel(c)}
                      className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${channel === c ? "border-gold bg-gold/15 text-gold" : "border-border text-muted-foreground hover:text-foreground"}`}
                    >
                      {channelLabels[c]}
                    </button>
                  ))}
                </div>
                <input type="hidden" name="channel" value={channel} />
              </Field>
            </div>
            <Field label="نوع الوحدة">
              <select name="unitType" className="select-base" defaultValue="">
                <option value="">—</option>
                {(Object.keys(unitTypeLabels) as UnitType[]).map((u) => (
                  <option key={u} value={u}>{unitTypeLabels[u]}</option>
                ))}
              </select>
            </Field>
            <Field label="الميزانية">
              <input name="budget" inputMode="numeric" dir="ltr" className="select-base" placeholder="مثال: 750000" />
            </Field>
            <Field label="المصدر *">
              <select name="sourceId" value={sourceSel} onChange={(e) => setSourceSel(e.target.value)} className="select-base">
                <option value="">— اختر المصدر —</option>
                {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            {isManager && (
              <Field label="الموظف المسؤول">
                <select name="assignedToId" className="select-base" defaultValue="">
                  <option value="">أنا</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>{emp.name}</option>
                  ))}
                </select>
              </Field>
            )}
          </div>
          <Field label="ملاحظات">
            <textarea name="notes" rows={2} className="select-base" placeholder="أي ملاحظة…" />
          </Field>

          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-xl border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
              إلغاء
            </button>
            <button type="submit" disabled={pending} className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
              {pending ? "جارٍ الحفظ…" : "أضف العميل"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
