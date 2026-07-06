"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Share2 } from "lucide-react";
import { distributeDuplicateLead } from "@/lib/actions/leads";
import type { UnarchiveMode } from "@/lib/actions/leads";

type Employee = { id: string; name: string };

// زر «توزيع» في بطاقة المكرر → يفتح حوار الأنماط الثلاثة.
export function DistributeDupButton({
  leadId, leadName, employees,
}: {
  leadId: string;
  leadName: string;
  employees: Employee[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 rounded-lg border border-gold/50 bg-gold/10 px-3 py-1.5 text-xs font-medium text-gold hover:bg-gold/20"
      >
        <Share2 className="size-3.5" /> توزيع
      </button>
      {open && (
        <DistributeDialog leadId={leadId} leadName={leadName} employees={employees} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function DistributeDialog({
  leadId, leadName, employees, onClose,
}: {
  leadId: string;
  leadName: string;
  employees: Employee[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<UnarchiveMode>("asis");
  const [to, setTo] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const needsEmployee = mode === "asis" || mode === "freshKeepEmployee";
  const canConfirm = !pending && (!needsEmployee || !!to);

  const options: { value: UnarchiveMode; label: string; desc: string }[] = [
    { value: "asis", label: "وزّعه بتحديثاته", desc: "ينقله للموظف المختار — المرحلة والمتابعات محفوظة كما هي." },
    { value: "freshKeepEmployee", label: "وزّعه كجديد لموظف", desc: "يرجّع المرحلة «جديد» ويُسنده للموظف المختار. المتابعات محفوظة." },
    { value: "freshUnassigned", label: "وزّعه كجديد غير موزّع", desc: "يرجّع المرحلة «جديد» ويشيله من الموظف — يروح حوض «غير موزّعين». المتابعات محفوظة." },
  ];

  function confirm() {
    setError(null);
    startTransition(async () => {
      const res = await distributeDuplicateLead(leadId, mode, needsEmployee ? to : null);
      if (!res.ok) { setError(res.error ?? "صار خطأ"); return; }
      onClose();
      router.refresh();
    });
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-5 shadow-2xl">
          <h2 className="font-bold text-foreground">توزيع «{leadName}»</h2>

          <div className="space-y-2">
            {options.map((o) => (
              <label key={o.value} className={`block cursor-pointer rounded-xl border p-3 transition-colors ${mode === o.value ? "border-gold bg-gold/10" : "border-border hover:bg-secondary/40"}`}>
                <div className="flex items-center gap-2">
                  <input type="radio" name="distribute-mode" checked={mode === o.value} onChange={() => setMode(o.value)} />
                  <span className="text-sm font-medium text-foreground">{o.label}</span>
                </div>
                <p className="mt-1 pr-6 text-xs text-muted-foreground">{o.desc}</p>
              </label>
            ))}
          </div>

          {needsEmployee && (
            <select value={to} onChange={(e) => setTo(e.target.value)} className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-gold">
              <option value="">اختر الموظف…</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          )}

          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground">إلغاء</button>
            <button type="button" onClick={confirm} disabled={!canConfirm} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{pending ? "جارٍ…" : "تنفيذ"}</button>
          </div>
        </div>
      </div>
    </>
  );
}
