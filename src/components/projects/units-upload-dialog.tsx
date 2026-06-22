"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X, FileUp, ClipboardPaste, Loader2 } from "lucide-react";
import { toArabicDigits } from "@/lib/format";
import { parseUnitsSheet, commitUnits, type UnitImportRow } from "@/lib/actions/projects";

export function UnitsUploadDialog({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [rows, setRows] = useState<UnitImportRow[] | null>(null);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  if (!open) return null;

  const newCount = rows?.filter((r) => !r.exists).length ?? 0;
  const existCount = rows?.filter((r) => r.exists).length ?? 0;

  function preview(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null); setResult(null); setRows(null);
    const fd = new FormData(e.currentTarget);
    fd.set("mode", mode); fd.set("projectId", projectId);
    startTransition(async () => {
      const res = await parseUnitsSheet(fd);
      if (res.ok) setRows(res.rows ?? []);
      else setError(res.error ?? "صار خطأ");
    });
  }
  function commit() {
    if (!rows) return;
    startTransition(async () => {
      const res = await commitUnits(projectId, rows, updateExisting);
      if (res.ok) { setResult(`أُضيف ${toArabicDigits(res.created ?? 0)} · حُدّث ${toArabicDigits(res.updated ?? 0)} · تُخطّي ${toArabicDigits(res.skipped ?? 0)}`); router.refresh(); setRows(null); }
      else setError(res.error ?? "صار خطأ");
    });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="glass relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground">رفع وحدات Excel</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary"><X className="size-5" /></button>
        </div>

        {error && <p className="mb-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        {result && <p className="mb-3 rounded-lg bg-success/10 px-3 py-2 text-sm text-success">{result}</p>}

        <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-secondary p-1">
          {([["file", "ملف Excel/CSV", FileUp], ["paste", "لصق", ClipboardPaste]] as const).map(([v, label, Icon]) => (
            <button key={v} onClick={() => { setMode(v); setRows(null); }} className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium ${mode === v ? "bg-card text-gold" : "text-muted-foreground"}`}><Icon className="size-4" /> {label}</button>
          ))}
        </div>
        <p className="mb-2 text-xs text-muted-foreground">الأعمدة: رقم الوحدة / النوع / الدور / المساحة / السعر / الحالة. «رقم الوحدة» إجباري.</p>

        <form onSubmit={preview} className="space-y-3">
          {mode === "file"
            ? <input type="file" name="file" accept=".csv,.xlsx,.xls" required className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-foreground" />
            : <textarea name="text" required rows={4} dir="ltr" placeholder={"رقم الوحدة,النوع,الدور,المساحة,السعر,الحالة"} className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm" />}
          <button type="submit" disabled={pending} className="flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">{pending && <Loader2 className="size-4 animate-spin" />} معاينة</button>
        </form>

        {rows && (
          <>
            <div className="mt-4 flex-1 overflow-y-auto rounded-xl border border-border">
              <table className="w-full text-right text-sm">
                <thead className="sticky top-0 bg-secondary text-muted-foreground"><tr><th className="px-3 py-2 font-medium">رقم الوحدة</th><th className="px-3 py-2 font-medium">السعر</th><th className="px-3 py-2 font-medium">الحالة</th></tr></thead>
                <tbody>
                  {rows.slice(0, 150).map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-3 py-2 text-foreground" dir="ltr">{r.number}</td>
                      <td className="px-3 py-2 text-muted-foreground" dir="ltr">{r.price ? toArabicDigits(Number(r.price).toLocaleString("en-US")) : "—"}</td>
                      <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs ${r.exists ? "bg-warning/15 text-warning" : "bg-success/15 text-success"}`}>{r.exists ? "موجودة" : "جديدة"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} />
                حدّث الوحدات الموجودة ({toArabicDigits(existCount)})
              </label>
              <button onClick={commit} disabled={pending} className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">استيراد (جديد {toArabicDigits(newCount)})</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
