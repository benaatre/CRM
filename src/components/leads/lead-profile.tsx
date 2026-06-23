"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PurchaseGoal, PurchaseMethod } from "@prisma/client";
import {
  purchaseGoalLabels, purchaseMethodLabels, stageLabels, stageColor,
  firstContactStageLabels, firstContactStageColor,
} from "@/lib/labels";
import { updateLeadIntake } from "@/lib/actions/leads";
import { cancelBooking } from "@/lib/actions/bookings";
import { formatDate } from "@/lib/format";
import type { LeadDetail } from "@/lib/data/leads";
import { BookingForm } from "@/components/bookings/booking-form";
import { FollowUpsForm } from "./followups-form";
import { FollowUpsTimeline } from "./followups-timeline";
import { useFollowUps } from "./use-followups";

export function LeadProfile({ detail, projects }: { detail: LeadDetail; projects: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [booking, setBooking] = useState<null | "reserve" | "sale">(null);

  const { items, loading, reload } = useFollowUps(detail.id);

  const [goal, setGoal] = useState<string>(detail.purchaseGoal ?? "");
  const [method, setMethod] = useState<string>(detail.purchaseMethod ?? "");
  const [priceMin, setPriceMin] = useState(detail.priceMin?.toString() ?? "");
  const [priceMax, setPriceMax] = useState(detail.priceMax?.toString() ?? "");
  const [areas, setAreas] = useState<string[]>(detail.preferredAreas ?? []);
  const [areaInput, setAreaInput] = useState("");
  const [projSel, setProjSel] = useState<Set<string>>(new Set(detail.preferredProjects ?? []));

  // أزرار الحجز/الشراء تظهر فقط لمرحلة مهتم أو تفاوض (وغير مؤرشف).
  const canBook = !detail.isArchived && (detail.stage === "INTERESTED" || detail.stage === "NEGOTIATION" || detail.stage === "VIEWING");

  function addArea() {
    const v = areaInput.trim();
    if (v && !areas.includes(v)) setAreas((a) => [...a, v]);
    setAreaInput("");
  }

  function save() {
    setMsg(null);
    startTransition(async () => {
      const res = await updateLeadIntake(detail.id, {
        purchaseGoal: (goal || null) as PurchaseGoal | null,
        purchaseMethod: (method || null) as PurchaseMethod | null,
        priceMin: priceMin ? Number(priceMin.replace(/\D/g, "")) : null,
        priceMax: priceMax ? Number(priceMax.replace(/\D/g, "")) : null,
        preferredAreas: areas,
        preferredProjects: [...projSel],
      });
      setMsg(res.ok ? "تم الحفظ" : res.error ?? "صار خطأ");
      router.refresh();
    });
  }

  function cancel(bookingId: string) {
    const reason = window.prompt("سبب إلغاء الحجز (اختياري):");
    if (reason === null) return; // ألغى نافذة السبب
    if (!window.confirm("متأكد من إلغاء الحجز؟ الوحدة بترجع «متاحة» والعميل يرجع لمرحلة «تفاوض».")) return;
    startTransition(async () => {
      const r = await cancelBooking(bookingId, reason.trim() || undefined);
      if (!r.ok && r.error) alert(r.error);
      reload();
      router.refresh();
    });
  }

  const wa = `https://wa.me/966${detail.phone.replace(/^0/, "")}`;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link href="/leads" className="inline-block text-sm text-muted-foreground hover:text-foreground">العملاء</Link>

      {/* الرأس */}
      <header className="glass flex flex-wrap items-start justify-between gap-4 rounded-2xl p-5">
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-full bg-gold/15 text-xl font-bold text-gold">{detail.name.charAt(0)}</div>
          <div>
            <h1 className="text-xl font-bold text-foreground">{detail.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span dir="ltr">{detail.phone}</span>
              <span className={`rounded-full border px-2 py-0.5 text-xs ${stageColor[detail.stage]}`}>{stageLabels[detail.stage]}</span>
              {detail.firstContactStage && <span className={`rounded-full border px-2 py-0.5 text-xs ${firstContactStageColor[detail.firstContactStage]}`}>{firstContactStageLabels[detail.firstContactStage]}</span>}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <a href={`tel:${detail.phone}`} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">اتصال</a>
          <a href={wa} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success hover:bg-success/25">واتساب</a>
        </div>
      </header>

      {detail.isArchived && (
        <div className="rounded-2xl border border-success/30 bg-success/5 px-4 py-3 text-center text-sm font-medium text-success">هذا العميل مؤرشف (تم الحجز/الشراء)</div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* العمود الأيمن العريض: البيانات + نموذج المتابعة */}
        <div className="space-y-6 lg:col-span-2">
          {/* البيانات الأساسية */}
          <section className="glass space-y-4 rounded-2xl p-5">
            <h2 className="font-semibold text-foreground">البيانات الأساسية</h2>
            <div className="grid grid-cols-2 gap-3">
              <Field label="هدف الشراء">
                <select value={goal} onChange={(e) => setGoal(e.target.value)} className="select-base">
                  <option value="">—</option>
                  {(Object.keys(purchaseGoalLabels) as PurchaseGoal[]).map((g) => <option key={g} value={g}>{purchaseGoalLabels[g]}</option>)}
                </select>
              </Field>
              <Field label="طريقة الشراء">
                <select value={method} onChange={(e) => setMethod(e.target.value)} className="select-base">
                  <option value="">—</option>
                  {(Object.keys(purchaseMethodLabels) as PurchaseMethod[]).map((m) => <option key={m} value={m}>{purchaseMethodLabels[m]}</option>)}
                </select>
              </Field>
              <Field label="السعر من"><input value={priceMin} onChange={(e) => setPriceMin(e.target.value.replace(/\D/g, ""))} inputMode="numeric" dir="ltr" className="select-base" /></Field>
              <Field label="السعر إلى"><input value={priceMax} onChange={(e) => setPriceMax(e.target.value.replace(/\D/g, ""))} inputMode="numeric" dir="ltr" className="select-base" /></Field>
            </div>

            <div className="space-y-2">
              <span className="text-xs text-muted-foreground">الأحياء المناسبة</span>
              <div className="flex flex-wrap gap-2">
                {areas.map((a) => (
                  <span key={a} className="flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs text-foreground">{a}<button onClick={() => setAreas((xs) => xs.filter((x) => x !== a))} className="text-muted-foreground hover:text-destructive" aria-label="حذف">×</button></span>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={areaInput} onChange={(e) => setAreaInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addArea(); } }} placeholder="اكتب حيًّا واضغط Enter…" className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-gold" />
                <button onClick={addArea} className="rounded-lg border border-border px-3 text-sm text-muted-foreground hover:text-foreground">إضافة</button>
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-xs text-muted-foreground">المشاريع المناسبة</span>
              <div className="grid grid-cols-2 gap-2 rounded-xl border border-border p-3">
                {projects.length === 0 ? <span className="text-xs text-muted-foreground">ما فيه مشاريع</span> : projects.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={projSel.has(p.id)} onChange={(e) => setProjSel((s) => { const n = new Set(s); e.target.checked ? n.add(p.id) : n.delete(p.id); return n; })} />
                    {p.name}
                  </label>
                ))}
              </div>
            </div>

            {msg && <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">{msg}</p>}
            <button onClick={save} disabled={pending} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">{pending ? "جارٍ الحفظ…" : "حفظ البيانات"}</button>
          </section>

          {/* محجوز: بطاقة تفاصيل الحجز + إلغاء — وإلا نموذج المتابعة */}
          {detail.isArchived ? (
            <section className="glass space-y-3 rounded-2xl p-5">
              <h2 className="font-semibold text-foreground">تفاصيل الحجز</h2>
              {detail.bookings.length === 0 ? (
                <p className="text-sm text-muted-foreground">لا توجد تفاصيل حجز.</p>
              ) : detail.bookings.map((b) => (
                <div key={b.id} className="space-y-1.5 rounded-xl border border-border p-4">
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">المشروع</span><span className="text-foreground">{b.projectName ?? "—"}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">الوحدة</span><span className="text-foreground">{b.unitNumber}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">تاريخ الحجز</span><span className="text-foreground">{formatDate(b.createdAt)}</span></div>
                  <button onClick={() => cancel(b.id)} disabled={pending} className="mt-2 w-full rounded-lg border border-destructive/40 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50">إلغاء الحجز</button>
                </div>
              ))}
            </section>
          ) : (
            <FollowUpsForm
              leadId={detail.id}
              stage={detail.stage}
              projects={projects}
              onSaved={() => { reload(); router.refresh(); }}
              onBook={canBook ? () => setBooking("reserve") : undefined}
            />
          )}

          {/* أزرار الحجز/الشراء */}
          {canBook && (
            <div className="flex flex-wrap gap-3">
              <button onClick={() => setBooking("reserve")} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">تم الحجز</button>
              <button onClick={() => setBooking("sale")} className="rounded-xl border border-gold/40 px-5 py-2.5 text-sm font-semibold text-gold hover:bg-gold/10">تم الشراء (كاش فوري)</button>
            </div>
          )}
        </div>

        {/* العمود الأيسر الضيق: سجل المتابعات */}
        <div className="lg:col-span-1">
          <FollowUpsTimeline items={items} loading={loading} />
        </div>
      </div>

      {booking && (
        <BookingForm
          open={!!booking}
          immediateSale={booking === "sale"}
          onClose={() => setBooking(null)}
          leadId={detail.id}
          leadName={detail.name}
          onDone={() => { reload(); router.refresh(); }}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1.5"><span className="text-xs text-muted-foreground">{label}</span>{children}</label>;
}
