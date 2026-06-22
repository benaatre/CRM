"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, Ban, Loader2, Plus, Upload, Pencil, Trash2 } from "lucide-react";
import type { UnitStatus } from "@prisma/client";
import { unitTypeLabel, unitStatusLabels } from "@/lib/labels";
import { formatCurrency, toArabicDigits } from "@/lib/format";
import type { UnitRow } from "@/lib/data/projects";
import { cancelBooking } from "@/lib/actions/bookings";
import { deleteUnit } from "@/lib/actions/projects";
import { UnitForm } from "./unit-form";
import { UnitsUploadDialog } from "./units-upload-dialog";

const statusCard: Record<UnitStatus, string> = {
  AVAILABLE: "border-success/40 bg-success/5",
  RESERVED: "border-warning/40 bg-warning/5",
  SOLD: "border-destructive/40 bg-destructive/5",
};
const statusBadge: Record<UnitStatus, string> = {
  AVAILABLE: "bg-success/15 text-success",
  RESERVED: "bg-warning/15 text-warning",
  SOLD: "bg-destructive/15 text-destructive",
};

export function UnitsGrid({ rows, projectId }: { rows: UnitRow[]; projectId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [editUnit, setEditUnit] = useState<UnitRow | null>(null);

  const filtered = useMemo(
    () => rows.filter((u) => !q || u.number.includes(q) || unitTypeLabel(u.type).includes(q)),
    [rows, q],
  );

  function cancel(bookingId: string, unitNumber: string) {
    if (!confirm(`متأكد تبي تلغي حجز وحدة ${unitNumber}؟ بترجع «متاحة».`)) return;
    const reason = prompt("سبب الإلغاء (اختياري):") ?? undefined;
    startTransition(async () => { await cancelBooking(bookingId, reason || undefined); router.refresh(); });
  }
  function remove(u: UnitRow) {
    if (!confirm(`متأكد تبي تحذف وحدة ${u.number}؟`)) return;
    startTransition(async () => { const res = await deleteUnit(u.id); if (!res.ok) alert(res.error); router.refresh(); });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث برقم الوحدة أو النوع…" className="w-full rounded-xl border border-border bg-card py-2.5 pr-9 pl-3 text-sm outline-none focus:border-gold" />
        </div>
        <button onClick={() => setShowUpload(true)} className="flex items-center gap-2 rounded-xl border border-border px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground"><Upload className="size-4" /> رفع وحدات Excel</button>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"><Plus className="size-4" /> إضافة وحدة</button>
      </div>

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">ما فيه وحدات.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((u) => (
            <div key={u.id} className={`rounded-2xl border p-4 ${statusCard[u.status]}`}>
              <div className="flex items-start justify-between">
                <div className="text-lg font-bold text-foreground" dir="ltr">{u.number}</div>
                <span className={`rounded-full px-2 py-0.5 text-xs ${statusBadge[u.status]}`}>{unitStatusLabels[u.status]}</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>النوع: {unitTypeLabel(u.type)}</span>
                <span>الدور: {u.floor ?? "—"}</span>
                <span>المساحة: {u.area ? `${toArabicDigits(u.area)} م²` : "—"}</span>
                <span className="text-gold">{formatCurrency(u.price)}</span>
              </div>
              {u.buyerName && <div className="mt-2 text-xs text-muted-foreground">المشتري: {u.buyerName}</div>}
              {u.notes && <div className="mt-1 text-xs text-muted-foreground/70">{u.notes}</div>}

              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => setEditUnit(u)} className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"><Pencil className="size-3.5" /> تعديل</button>
                {u.status === "RESERVED" && u.bookingId && (
                  <button onClick={() => cancel(u.bookingId!, u.number)} disabled={pending} className="flex items-center gap-1 rounded-lg border border-destructive/40 px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50">{pending ? <Loader2 className="size-3.5 animate-spin" /> : <Ban className="size-3.5" />} إلغاء الحجز</button>
                )}
                {!u.bookingId && (
                  <button onClick={() => remove(u)} disabled={pending} className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-destructive/40 hover:text-destructive disabled:opacity-50"><Trash2 className="size-3.5" /> حذف</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && <UnitForm open={showAdd} onClose={() => setShowAdd(false)} projectId={projectId} />}
      {editUnit && <UnitForm open={!!editUnit} onClose={() => setEditUnit(null)} projectId={projectId} unit={editUnit} />}
      {showUpload && <UnitsUploadDialog open={showUpload} onClose={() => setShowUpload(false)} projectId={projectId} />}
    </div>
  );
}
