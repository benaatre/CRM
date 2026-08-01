"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Database, Plus, Trash2, X } from "lucide-react";
import { toArabicDigits } from "@/lib/format";
import type { SourceRow } from "@/lib/data/sources";
import { addSource, deleteSource } from "@/lib/actions/sources";

// إدارة أسماء المصادر فقط — روابط جوجل شيت القديمة أُخفيت من الواجهة (بلا حذف أعمدة):
// «مصادر العملاء» الجديدة (SheetSourcesPanel) هي الظاهرة الوحيدة لإدارة شيتات المزامنة.
export function SourcesPanel({ sources }: { sources: SourceRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // إضافة مصدر
  const [showAddSource, setShowAddSource] = useState(false);
  const [newSource, setNewSource] = useState("");

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) { after?.(); router.refresh(); }
      else setError(res.error ?? "صار خطأ");
    });
  }

  return (
    <div className="glass space-y-6 rounded-2xl p-6">
      <div className="flex items-center gap-2">
        <Database className="size-5 text-gold" />
        <h2 className="font-semibold text-foreground">أسماء المصادر</h2>
      </div>
      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {/* ===== جدول المصادر ===== */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground"><span className="h-4 w-1 rounded-full bg-gold" /> المصادر</h3>
          {!showAddSource && (
            <button onClick={() => setShowAddSource(true)} className="flex items-center gap-1.5 rounded-lg border border-gold/40 px-3 py-1.5 text-xs font-medium text-gold hover:bg-gold/10">
              <Plus className="size-3.5" /> إضافة مصدر جديد
            </button>
          )}
        </div>

        {showAddSource && (
          <div className="flex items-center gap-2 rounded-xl border border-gold/30 bg-gold/5 p-3">
            <input
              autoFocus value={newSource} onChange={(e) => setNewSource(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && newSource.trim()) run(() => addSource(newSource), () => { setNewSource(""); setShowAddSource(false); }); }}
              placeholder="اسم المصدر الجديد" className="select-base flex-1"
            />
            <button onClick={() => run(() => addSource(newSource), () => { setNewSource(""); setShowAddSource(false); })} disabled={pending || !newSource.trim()} className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">حفظ</button>
            <button onClick={() => { setShowAddSource(false); setNewSource(""); }} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary"><X className="size-4" /></button>
          </div>
        )}

        <div className="scroll-x rounded-xl border border-border">
          <table className="crm-table min-w-[420px] text-sm">
            <thead className="bg-secondary/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">المصدر</th>
                <th className="w-[5rem] px-4 py-2.5 font-medium">عملاء</th>
                <th className="w-[5rem] px-4 py-2.5 font-medium">روابط</th>
                <th className="w-[3.5rem] px-4 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => {
                const linked = s.leadCount > 0 || s.linkCount > 0;
                return (
                  <tr key={s.id} className="border-t border-border">
                    <td className="px-4 py-2.5 text-foreground">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="min-w-0 max-w-full truncate" title={s.name}>{s.name}</span>
                        {s.isDefault && <span className="cell-keep rounded-full bg-secondary px-1.5 py-0.5 text-[0.65rem] text-muted-foreground">افتراضي</span>}
                      </span>
                    </td>
                    <td className="cell-keep px-4 py-2.5 text-muted-foreground">{toArabicDigits(s.leadCount)}</td>
                    <td className="cell-keep px-4 py-2.5 text-muted-foreground">{toArabicDigits(s.linkCount)}</td>
                    <td className="cell-keep px-4 py-2.5 text-left">
                      <button
                        onClick={() => run(() => deleteSource(s.id))}
                        disabled={pending || linked}
                        title={linked ? "ما يمكن حذف مصدر مرتبط بعملاء أو روابط" : "حذف المصدر"}
                        className="rounded-lg p-1.5 text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}
