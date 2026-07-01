"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Database, Link2, Plus, Trash2, X, Check, CircleSlash, CheckCircle2, AlertTriangle,
} from "lucide-react";
import { toArabicDigits, formatDateTime } from "@/lib/format";
import type { SourceRow, SheetLinkRow, SourceListItem } from "@/lib/data/sources";
import {
  addSource, deleteSource, addSheetLink, toggleSheetLink, deleteSheetLink,
} from "@/lib/actions/sources";

export function SourcesPanel({
  sources, links,
}: {
  sources: SourceRow[];
  links: SheetLinkRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // إضافة مصدر
  const [showAddSource, setShowAddSource] = useState(false);
  const [newSource, setNewSource] = useState("");
  // إضافة رابط
  const [showAddLink, setShowAddLink] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newLinkSource, setNewLinkSource] = useState("");

  const sourceOptions: SourceListItem[] = sources.map((s) => ({ id: s.id, name: s.name }));

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
        <h2 className="font-semibold text-foreground">المصادر وروابط جوجل شيت</h2>
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

        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-right text-sm">
            <thead className="bg-secondary/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">المصدر</th>
                <th className="px-4 py-2.5 font-medium">عملاء</th>
                <th className="px-4 py-2.5 font-medium">روابط</th>
                <th className="px-4 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => {
                const linked = s.leadCount > 0 || s.linkCount > 0;
                return (
                  <tr key={s.id} className="border-t border-border">
                    <td className="px-4 py-2.5 text-foreground">
                      {s.name}
                      {s.isDefault && <span className="mr-2 rounded-full bg-secondary px-1.5 py-0.5 text-[0.65rem] text-muted-foreground">افتراضي</span>}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{toArabicDigits(s.leadCount)}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{toArabicDigits(s.linkCount)}</td>
                    <td className="px-4 py-2.5 text-left">
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

      {/* ===== جدول روابط جوجل شيت ===== */}
      <section className="space-y-3 border-t border-border/60 pt-5">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground"><Link2 className="size-4 text-gold" /> روابط جوجل شيت</h3>
          {!showAddLink && (
            <button onClick={() => setShowAddLink(true)} className="flex items-center gap-1.5 rounded-lg border border-gold/40 px-3 py-1.5 text-xs font-medium text-gold hover:bg-gold/10">
              <Plus className="size-3.5" /> إضافة رابط جديد
            </button>
          )}
        </div>

        {showAddLink && (
          <div className="space-y-3 rounded-xl border border-gold/30 bg-gold/5 p-3">
            <label className="block space-y-1.5">
              <span className="text-xs text-muted-foreground">رابط جوجل شيت</span>
              <input value={newUrl} onChange={(e) => setNewUrl(e.target.value)} dir="ltr" placeholder="https://docs.google.com/spreadsheets/d/..." className="select-base w-full" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs text-muted-foreground">المصدر المرتبط *</span>
              <select value={newLinkSource} onChange={(e) => setNewLinkSource(e.target.value)} className="select-base w-full">
                <option value="">— اختر المصدر —</option>
                {sourceOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <p className="rounded-lg bg-secondary/60 px-3 py-2 text-[0.7rem] leading-5 text-muted-foreground">
              ملاحظة: بعد إعداد ربط Google (المرحلة القادمة) لازم تشارك الشيت مع إيميل حساب الخدمة ليقدر يقرأه.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowAddLink(false); setNewUrl(""); setNewLinkSource(""); }} className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground">إلغاء</button>
              <button
                onClick={() => run(() => addSheetLink(newUrl, newLinkSource), () => { setNewUrl(""); setNewLinkSource(""); setShowAddLink(false); })}
                disabled={pending || !newUrl.trim() || !newLinkSource}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                حفظ
              </button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-right text-sm">
            <thead className="bg-secondary/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">الرابط</th>
                <th className="px-4 py-2.5 font-medium">المصدر</th>
                <th className="px-4 py-2.5 font-medium">آخر مزامنة</th>
                <th className="px-4 py-2.5 font-medium">الحالة</th>
                <th className="px-4 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {links.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">ما فيه روابط مضافة بعد.</td></tr>
              ) : links.map((l) => (
                <tr key={l.id} className={`border-t border-border ${l.isActive ? "" : "opacity-50"}`}>
                  <td className="px-4 py-2.5">
                    <span className="text-muted-foreground" title={l.sheetUrl} dir="ltr">…/{l.sheetId.slice(0, 10)}…</span>
                  </td>
                  <td className="px-4 py-2.5 text-foreground">{l.sourceName}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{l.lastSyncAt ? formatDateTime(l.lastSyncAt) : "—"}</td>
                  <td className="px-4 py-2.5">
                    {l.lastSyncStatus === "success" ? (
                      <span className="inline-flex items-center gap-1 text-xs text-success"><CheckCircle2 className="size-3.5" /> نجاح</span>
                    ) : l.lastSyncStatus === "error" ? (
                      <span className="inline-flex items-center gap-1 text-xs text-destructive" title={l.lastSyncError ?? "خطأ"}><AlertTriangle className="size-3.5" /> خطأ</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-left">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => run(() => toggleSheetLink(l.id, !l.isActive))}
                        disabled={pending}
                        title={l.isActive ? "تعطيل" : "تفعيل"}
                        className={`rounded-lg p-1.5 ${l.isActive ? "text-success hover:bg-success/10" : "text-muted-foreground hover:bg-secondary"}`}
                      >
                        {l.isActive ? <Check className="size-4" /> : <CircleSlash className="size-4" />}
                      </button>
                      <button onClick={() => run(() => deleteSheetLink(l.id))} disabled={pending} title="حذف" className="rounded-lg p-1.5 text-destructive hover:bg-destructive/10">
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
