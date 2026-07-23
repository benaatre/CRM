"use client";

import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { followUpSectionLabels, followUpSectionColor, followUpResultLabels, stageLabels } from "@/lib/labels";
import { formatDateTime, toArabicDigits } from "@/lib/format";
import type { FollowUpItem } from "./use-followups";

/**
 * سجل المتابعات + تعديل ضمن الصلاحية (الجزء ١ — التذكيرات):
 * الموظف يعدّل متابعته خلال ساعة (ملاحظة + موعد فقط)، والمالك/المدير أي وقت شامل النتيجة.
 * زر التعديل يظهر حسب canEdit من الخادم — والخادم يعيد فرض الصلاحية عند الحفظ.
 */
export function FollowUpsTimeline({ items, loading, leadId, onChanged }: {
  items: FollowUpItem[];
  loading: boolean;
  leadId?: string;
  onChanged?: () => void;
}) {
  const [editing, setEditing] = useState<FollowUpItem | null>(null);

  return (
    <div className="glass rounded-2xl p-5">
      <h2 className="mb-4 font-semibold text-foreground">سجل المتابعات ({toArabicDigits(items.length)})</h2>
      {loading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">جارٍ التحميل…</p>
      ) : items.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">ما فيه متابعات بعد.</p>
      ) : (
        <ol className="space-y-4 border-r border-border pr-4">
          {items.map((f) => {
            const dotColor = f.section === "NOT_INTERESTED" || f.result.startsWith("NOT_INTERESTED")
              ? "bg-destructive"
              : f.section === "NO_ANSWER"
                ? "bg-warning"
                : f.result === "BOOKED"
                  ? "bg-success"
                  : "bg-gold";
            return (
              <li key={f.id} className="relative">
                <span className={`absolute -right-[1.30rem] top-1.5 size-2 rounded-full ${dotColor}`} />
                <div className="flex flex-wrap items-center gap-2">
                  {f.section && (
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] ${followUpSectionColor[f.section]}`}>
                      {followUpSectionLabels[f.section]}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">{formatDateTime(f.createdAt)}</span>
                  {f.edited && (
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground" title="عُدّلت بعد تسجيلها — الأصل محفوظ في سجل التدقيق">مُعدَّلة</span>
                  )}
                  {f.canEdit && leadId && (
                    <button
                      onClick={() => setEditing(f)}
                      className="rounded-lg border border-border p-1 text-muted-foreground hover:border-gold/40 hover:text-gold"
                      title={f.canEditResult ? "تعديل المتابعة (شامل النتيجة)" : "تعديل الملاحظة والموعد (خلال ساعة من التسجيل)"}
                    ><Pencil className="size-3" /></button>
                  )}
                </div>
                <p className="mt-1 text-sm font-medium text-foreground">{f.note || followUpResultLabels[f.result]}</p>
                {f.nextDate && <p className="mt-0.5 text-xs text-info">المتابعة القادمة: {formatDateTime(f.nextDate)}</p>}
                {f.stageAfter && <p className="mt-0.5 text-xs text-muted-foreground">انتقل إلى: {stageLabels[f.stageAfter]}</p>}
                {f.employeeName && <p className="mt-0.5 text-xs text-muted-foreground/70">{f.employeeName}</p>}
              </li>
            );
          })}
        </ol>
      )}

      {editing && leadId && (
        <EditFollowUpDialog
          item={editing}
          leadId={leadId}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChanged?.(); }}
        />
      )}
    </div>
  );
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function EditFollowUpDialog({ item, leadId, onClose, onSaved }: {
  item: FollowUpItem; leadId: string; onClose: () => void; onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState(item.note ?? "");
  const [nextDate, setNextDate] = useState(toLocalInput(item.nextDate));
  const [result, setResult] = useState(item.result);
  const [err, setErr] = useState<string | null>(null);

  function save() {
    setErr(null);
    startTransition(async () => {
      const res = await fetch(`/api/leads/${leadId}/followups`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          followupId: item.id,
          note,
          nextDate: nextDate || null,
          ...(item.canEditResult && result !== item.result ? { result } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error ?? "صار خطأ"); return; }
      onSaved();
    });
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-3 rounded-2xl border border-border bg-card p-5 shadow-2xl">
          <h3 className="font-bold text-foreground">تعديل المتابعة</h3>
          <p className="text-xs text-muted-foreground">
            {item.canEditResult
              ? "تعديل مدير — تغيير النتيجة يحرّك مرحلة العميل بالمسار المعتاد."
              : "تقدر تعدّل الملاحظة والموعد خلال ساعة من التسجيل — النتيجة ما تتعدل."}
          </p>

          {item.canEditResult && (
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">النتيجة</span>
              <select value={result} onChange={(e) => setResult(e.target.value as FollowUpItem["result"])} className="select-base">
                {(Object.keys(followUpResultLabels) as FollowUpItem["result"][]).map((r) => (
                  <option key={r} value={r}>{followUpResultLabels[r]}</option>
                ))}
              </select>
            </label>
          )}

          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">الملاحظة</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-gold" />
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">موعد المتابعة القادم</span>
            <input type="datetime-local" value={nextDate} onChange={(e) => setNextDate(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-gold" />
          </label>

          {err && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{err}</p>}

          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground">إلغاء</button>
            <button onClick={save} disabled={pending} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">حفظ</button>
          </div>
        </div>
      </div>
    </>
  );
}
