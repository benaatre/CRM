"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { createBooking, fetchProjectsWithUnits } from "@/lib/actions/bookings";
import type { ProjectWithUnits } from "@/lib/data/bookings";
import { toArabicDigits } from "@/lib/format";

/** نموذج حجز مبسّط: مشروع + وحدة متاحة + تأكيد. يُستدعى من زر «تم الحجز» (تفاوض). */
export function ReserveDialog({
  leadId, leadName, onClose, onDone,
}: {
  leadId: string;
  leadName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [projects, setProjects] = useState<ProjectWithUnits[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectId, setProjectId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProjectsWithUnits().then((p) => { setProjects(p); setLoading(false); });
  }, []);

  const units = useMemo(() => projects.find((p) => p.id === projectId)?.units ?? [], [projects, projectId]);

  function confirm() {
    if (!unitId) { setError("اختر الوحدة"); return; }
    const unit = units.find((u) => u.id === unitId);
    if (!unit?.price) { setError("الوحدة بدون سعر محدّد"); return; }
    const fd = new FormData();
    fd.set("leadId", leadId);
    fd.set("unitId", unitId);
    fd.set("price", String(unit.price));
    setError(null);
    startTransition(async () => {
      const res = await createBooking(fd);
      if (!res.ok) { setError(res.error ?? "صار خطأ"); return; }
      onDone();
      onClose();
    });
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-5 shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-bold text-foreground">تم الحجز — {leadName}</h2>
            <button onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-muted-foreground hover:bg-secondary">×</button>
          </div>

          {loading ? (
            <p className="py-4 text-center text-sm text-muted-foreground">جارٍ تحميل المشاريع…</p>
          ) : (
            <>
              <label className="block space-y-1.5">
                <span className="text-xs text-muted-foreground">المشروع</span>
                <select value={projectId} onChange={(e) => { setProjectId(e.target.value); setUnitId(""); }} className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-gold">
                  <option value="">اختر المشروع…</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs text-muted-foreground">الوحدة المتاحة</span>
                <select value={unitId} onChange={(e) => setUnitId(e.target.value)} disabled={!projectId} className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-gold disabled:opacity-50">
                  <option value="">{projectId ? (units.length ? "اختر الوحدة…" : "ما فيه وحدات متاحة") : "اختر المشروع أولًا"}</option>
                  {units.map((u) => <option key={u.id} value={u.id}>{u.number}{u.price ? ` — ${toArabicDigits(u.price.toLocaleString("en-US"))} ر.س` : ""}</option>)}
                </select>
              </label>

              {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

              <div className="flex justify-end gap-2">
                <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground">إلغاء</button>
                <button onClick={confirm} disabled={pending || !unitId} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{pending ? "جارٍ…" : "تأكيد الحجز"}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
