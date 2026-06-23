"use client";

import { useState, useTransition } from "react";
import { toArabicDigits } from "@/lib/format";
import { distributeUnassigned, distributeLeastLoaded, distributeCustom, getEmployeeLoads } from "@/lib/actions/team";

type Mode = "equal" | "least" | "custom";

/** نافذة توزيع العملاء غير الموزّعين — بالتساوي / الأقل عملاءً / مخصص (جدول لكل موظف). */
export function DistributeDialog({
  availableUnassigned, onClose, onDone,
}: {
  availableUnassigned: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>("equal");
  const [loads, setLoads] = useState<{ id: string; name: string; count: number }[] | null>(null);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  function pickMode(m: Mode) {
    setMode(m); setError(null);
    if (m === "custom" && loads === null) {
      startTransition(async () => { setLoads(await getEmployeeLoads()); });
    }
  }

  const totalWanted = Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0);
  const over = totalWanted > availableUnassigned;
  const canRun = mode === "custom" ? !over && totalWanted > 0 : true;

  function run() {
    setError(null);
    startTransition(async () => {
      const res =
        mode === "equal" ? await distributeUnassigned()
          : mode === "least" ? await distributeLeastLoaded()
            : await distributeCustom((loads ?? []).map((e) => ({ userId: e.id, count: Number(alloc[e.id]) || 0 })));
      if (!res.ok) { setError(res.error ?? "صار خطأ"); return; }
      onDone();
      onClose();
    });
  }

  const opt = (m: Mode, label: string) => (
    <button type="button" onClick={() => pickMode(m)} className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${mode === m ? "border-gold bg-gold/15 text-gold" : "border-border text-muted-foreground hover:text-foreground"}`}>{label}</button>
  );

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-5 shadow-2xl">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-foreground">توزيع العملاء غير الموزّعين</h2>
            <span className="text-xs text-muted-foreground">{toArabicDigits(availableUnassigned)} متاح</span>
          </div>

          <div className="flex gap-2">
            {opt("equal", "بالتساوي")}
            {opt("least", "الأقل عملاءً")}
            {opt("custom", "مخصص")}
          </div>

          {mode === "custom" && (
            <div className="space-y-2 rounded-xl border border-gold/30 bg-gold/5 p-3">
              {loads === null ? (
                <p className="py-2 text-center text-xs text-muted-foreground">جارٍ التحميل…</p>
              ) : loads.length === 0 ? (
                <p className="py-2 text-center text-xs text-muted-foreground">ما فيه موظفون مفعّلون.</p>
              ) : (
                <>
                  <table className="w-full text-right text-sm">
                    <thead className="text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1.5 font-medium">الموظف</th>
                        <th className="px-2 py-1.5 font-medium">عملاؤه الآن</th>
                        <th className="px-2 py-1.5 font-medium">عدد العملاء</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loads.map((e) => (
                        <tr key={e.id} className="border-t border-border">
                          <td className="px-2 py-2 text-foreground">{e.name}</td>
                          <td className="px-2 py-2 text-muted-foreground">{toArabicDigits(e.count)}</td>
                          <td className="px-2 py-2">
                            <input value={alloc[e.id] ?? ""} onChange={(ev) => setAlloc((a) => ({ ...a, [e.id]: ev.target.value.replace(/\D/g, "") }))} inputMode="numeric" dir="ltr" placeholder="٠" className="w-16 rounded border border-border bg-background px-2 py-1 text-center text-foreground outline-none focus:border-gold" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <span className={`text-xs ${over ? "text-destructive" : "text-muted-foreground"}`}>المجموع: {toArabicDigits(totalWanted)} من {toArabicDigits(availableUnassigned)} متاح</span>
                  {over && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">المجموع أكبر من عدد العملاء المتاح ({toArabicDigits(availableUnassigned)}).</p>}
                </>
              )}
            </div>
          )}

          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground">إلغاء</button>
            <button onClick={run} disabled={pending || !canRun} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{pending ? "جارٍ التوزيع…" : "وزّع"}</button>
          </div>
        </div>
      </div>
    </>
  );
}
