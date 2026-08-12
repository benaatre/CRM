"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { createLead } from "@/lib/actions/leads";
import { fetchSources } from "@/lib/actions/sources";
import type { SourceListItem } from "@/lib/data/sources";
import { DistrictSelect } from "./district-select";

type Employee = { id: string; name: string };

export function NewLeadDialog({
  open,
  onClose,
  onCreated,
  isManager,
  employees,
}: {
  open: boolean;
  onClose: () => void;
  /** يُستدعى بعد نجاح الإضافة (للتوست) — اختياري فلا يتأثر أي مستدعٍ قائم. */
  onCreated?: () => void;
  isManager: boolean;
  employees: Employee[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<SourceListItem[]>([]);
  const [sourceSel, setSourceSel] = useState("");
  // «في أي حي تفضّل التملك؟» — اختياري، بلا إلزام.
  const [areas, setAreas] = useState<string[]>([]);
  // بوّابة الخروج للـbody — انظر تعليق العرض أسفل الملف.
  const [mounted, setMounted] = useState(false);

  useEffect(() => { if (open) { fetchSources().then(setSources).catch(() => {}); setAreas([]); } }, [open]);
  useEffect(() => { setMounted(true); }, []);

  if (!open || !mounted) return null;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!sourceSel) { setError("اختر مصدر العميل"); return; }
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createLead(formData);
      if (res.ok) {
        router.refresh();
        onClose();
        onCreated?.();
      } else {
        setError(res.error ?? "صار خطأ");
      }
    });
  }

  /*
   * عطلان أُصلحا معًا:
   * ١) `fixed` لا يُقاس من الشاشة إذا كان أحد أجداده يحمل backdrop-filter/filter/
   *    transform — فهذه تُنشئ **حاوية احتواء** لعناصر fixed. الترويسة الزجاجية
   *    (backdrop-blur) صارت جدًّا للنموذج، فتموضع داخلها لا في الشاشة. الحل:
   *    بوّابة (portal) إلى document.body — تخرجه من أي جدّ مهما كانت مرشّحاته.
   * ٢) المحتوى الأطول من الشاشة كان يُقصّ من الأعلى بلا وصول: مركز flex يفيض
   *    في الاتجاهين. الحل: الغلاف يمرّر (overflow-y-auto) والتوسيط عبر
   *    min-h-full — فيتوسّط إن اتّسع، ويمرّر من أعلاه إن طال.
   */
  return createPortal(
    <div className="fixed inset-0 z-[100] overflow-y-auto overscroll-contain">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex min-h-full items-center justify-center p-4">
      <div className="glass relative z-10 w-full max-w-lg rounded-2xl p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground">عميل جديد</h2>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-muted-foreground hover:bg-secondary">إغلاق</button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="الاسم *">
              <input name="name" required className="select-base" placeholder="اسم العميل" />
            </Field>
            <Field label="الجوال *">
              <input name="phone" required inputMode="numeric" dir="ltr" className="select-base" placeholder="05xxxxxxxx" />
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
          {/* اختياري — يُرسل كقيم متعددة بنفس الاسم، والخادم يقبل المعتمدة فقط. */}
          <DistrictSelect value={areas} onChange={setAreas} disabled={pending} />
          {areas.map((a) => <input key={a} type="hidden" name="preferredAreas" value={a} />)}
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
    </div>,
    document.body,
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
