"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PaymentMethod } from "@prisma/client";
import { bankLabels, paymentMethodLabels } from "@/lib/labels";
import { formatCurrencyFull, toArabicDigits } from "@/lib/format";
import { createBooking, updateBooking, fetchProjectsWithUnits } from "@/lib/actions/bookings";
import type { ProjectWithUnits, BookingCard } from "@/lib/data/bookings";

type CashType = "CHECK" | "TRANSFER" | "INSTALLMENTS";
type UnitLite = ProjectWithUnits["units"][number];

/** السعر الأساسي للوحدة حسب الوضع: «قبل الخصم» = السعر، «بعد الخصم» = discountedPrice أو محسوب من النسبة. */
function unitBasePrice(u: UnitLite, mode: "before" | "after"): number | null {
  if (mode === "before") return u.price;
  if (u.discountedPrice != null) return u.discountedPrice;
  if (u.price != null && u.discountPercent != null) return Math.round(u.price * (1 - u.discountPercent / 100));
  return u.price;
}

export function BookingForm({
  open, onClose, leadId, leadName, onDone, presetUnitId, immediateSale = false, booking,
}: {
  open: boolean;
  onClose: () => void;
  leadId: string;
  leadName: string;
  onDone?: () => void;
  presetUnitId?: string;
  immediateSale?: boolean;
  booking?: BookingCard; // مُرّر = وضع تعديل (يُهيّئ الفورم بقيم الحجز)
}) {
  const editing = !!booking;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [projects, setProjects] = useState<ProjectWithUnits[]>([]);
  const [projectId, setProjectId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [price, setPrice] = useState("");
  const [discount, setDiscount] = useState("");
  const [deposit, setDeposit] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [cashType, setCashType] = useState<CashType>("CHECK");
  const [nationality, setNationality] = useState<"SAUDI" | "RESIDENT">("SAUDI");
  const [vatIncluded, setVatIncluded] = useState(false);
  const [priceMode, setPriceMode] = useState<"before" | "after">("after");
  const [instRows, setInstRows] = useState<{ amount: string; date: string }[]>([{ amount: "", date: "" }]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    fetchProjectsWithUnits().then((ps) => {
      // وضع التعديل: الوحدة الحالية ليست ضمن «المتاحة» — نحقنها في مشروعها لتظهر مختارة.
      if (booking && booking.projectId) {
        ps = ps.map((p) =>
          p.id === booking.projectId && !p.units.some((u) => u.id === booking.unitId)
            ? { ...p, units: [{ id: booking.unitId, number: booking.unitNumber, price: booking.price, discountedPrice: null, discountPercent: null }, ...p.units] }
            : p,
        );
      }
      setProjects(ps);
    });
  }, [open, booking]);

  // تعبئة الفورم بقيم الحجز عند فتح وضع التعديل.
  useEffect(() => {
    if (!open || !booking) return;
    setProjectId(booking.projectId ?? "");
    setUnitId(booking.unitId);
    setPrice(booking.price != null ? String(booking.price) : "");
    setDiscount(booking.discount != null && booking.discount > 0 ? String(booking.discount) : "");
    setDeposit(booking.deposit != null ? String(booking.deposit) : "");
    setIdNumber(booking.nationalId ?? "");
    setMethod(booking.paymentMethod ?? "CASH");
    setNationality(booking.nationality === "RESIDENT" ? "RESIDENT" : "SAUDI");
    setVatIncluded(booking.subjectToTax);
    setCashType((booking.cashPaymentType as CashType) ?? "CHECK");
    if (booking.installments && booking.installments.length) {
      setInstRows(booking.installments.map((r) => ({ amount: String(r.amount), date: r.date })));
    }
  }, [open, booking]);

  const units = useMemo(() => projects.find((p) => p.id === projectId)?.units ?? [], [projects, projectId]);

  // تعبئة الوحدة المحدّدة مسبقًا (من شبكة المشروع)
  useEffect(() => {
    if (presetUnitId && projects.length) {
      const proj = projects.find((p) => p.units.some((u) => u.id === presetUnitId));
      if (proj) {
        setProjectId(proj.id);
        setUnitId(presetUnitId);
        const u = proj.units.find((x) => x.id === presetUnitId);
        if (u) { setPriceMode("after"); const bp = unitBasePrice(u, "after"); if (bp != null) setPrice(String(bp)); }
      }
    }
  }, [presetUnitId, projects]);

  // الوحدة المختارة + هل فيها خصم مخزّن (نسبة أو سعر بعد الخصم) → نعرض خيار قبل/بعد.
  const selUnit = units.find((u) => u.id === unitId);
  const hasUnitDiscount = !!selUnit && (selUnit.discountedPrice != null || selUnit.discountPercent != null);
  function changePriceMode(mode: "before" | "after") {
    setPriceMode(mode);
    if (selUnit) { const bp = unitBasePrice(selUnit, mode); if (bp != null) setPrice(String(bp)); }
  }

  const priceNum = Number(price.replace(/\D/g, "")) || 0;
  const discountNum = Number(discount.replace(/\D/g, "")) || 0;
  const finalPrice = priceNum - discountNum;
  const tax = vatIncluded ? Math.round(finalPrice * 0.05) : 0;
  // المحصّل (العربون) والمتبقي — لحظيًا.
  const depositNum = Number(deposit.replace(/\D/g, "")) || 0;
  const totalAfterDiscount = finalPrice + tax;
  const remaining = totalAfterDiscount - depositNum;

  // الحد الأقصى للخصم من إعدادات المشروع
  const selProject = projects.find((p) => p.id === projectId);
  const maxCandidates = [
    selProject?.maxDiscountPercent ? Math.round(priceNum * (selProject.maxDiscountPercent / 100)) : null,
    selProject?.maxDiscountAmount ?? null,
  ].filter((v): v is number => v != null);
  const maxDiscount = maxCandidates.length ? Math.min(...maxCandidates) : null;
  const discountExceeds = maxDiscount != null && discountNum > maxDiscount;
  const showCash = method === "CASH" || method === "CASH_AND_FINANCE";
  const showFinance = method === "BANK_FINANCE" || method === "CASH_AND_FINANCE";

  if (!open) return null;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("leadId", leadId);
    fd.set("includesVAT", vatIncluded ? "yes" : "no");

    if (showCash && cashType === "INSTALLMENTS") {
      const rows = instRows
        .filter((r) => r.amount)
        .map((r) => ({ amount: Number(r.amount.replace(/\D/g, "")) || 0, date: r.date }));
      fd.set("installments", JSON.stringify(rows));
      fd.set("installmentsCount", String(rows.length));
    }
    startTransition(async () => {
      let res;
      if (editing && booking) {
        fd.set("bookingId", booking.id);
        res = await updateBooking(fd);
      } else {
        // الشراء الفوري = نفس فورم الحجز، لكن الوحدة تُباع والعميل يُقفل (داخل createBooking).
        fd.set("immediateSale", immediateSale ? "yes" : "no");
        res = await createBooking(fd);
      }
      if (res.ok) { router.refresh(); onDone?.(); onClose(); }
      else setError(res.error ?? "صار خطأ");
    });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="glass relative z-10 flex max-h-[92vh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground">{editing ? "تعديل الحجز" : immediateSale ? "شراء فوري" : "حجز جديد"}</h2>
            <p className="text-xs text-muted-foreground">للعميل: {leadName}</p>
            {idNumber.trim() && (
              <p className="text-xs text-muted-foreground">{nationality === "SAUDI" ? "رقم الهوية" : "رقم الإقامة"}: <span dir="ltr">{idNumber.trim()}</span></p>
            )}
          </div>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-muted-foreground hover:bg-secondary">إغلاق</button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {/* جنسية العميل + الهوية/الإقامة */}
          <div className="rounded-xl border border-border p-3">
            <div className="mb-2 text-xs font-medium text-muted-foreground">جنسية العميل</div>
            <div className="grid grid-cols-2 gap-2">
              {([["SAUDI", "مواطن سعودي"], ["RESIDENT", "أجنبي"]] as const).map(([v, label]) => (
                <label key={v} className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-sm ${nationality === v ? "border-gold/50 bg-gold/10 text-gold" : "border-border text-muted-foreground"}`}>
                  <input type="radio" name="nationality" value={v} checked={nationality === v} onChange={() => setNationality(v)} className="hidden" />
                  {label}
                </label>
              ))}
            </div>
            <label className="mt-3 block space-y-1.5">
              <span className="text-xs text-muted-foreground">{nationality === "SAUDI" ? "رقم الهوية (١٠ أرقام) *" : "رقم الإقامة *"}</span>
              <input name="nationalId" value={idNumber} onChange={(e) => setIdNumber(e.target.value.replace(/\D/g, ""))} required inputMode="numeric" dir="ltr" maxLength={nationality === "SAUDI" ? 10 : 12} pattern={nationality === "SAUDI" ? "\\d{10}" : "\\d{8,12}"} className="select-base" />
            </label>
            <label className="mt-3 block space-y-1.5">
              <span className="text-xs text-muted-foreground">رقم إضافي (اختياري)</span>
              <input name="secondaryPhone" defaultValue={booking?.secondaryPhone ?? ""} inputMode="numeric" dir="ltr" className="select-base" placeholder="05xxxxxxxx" />
            </label>
          </div>

          {/* المشروع */}
          <Field label="المشروع *">
            <select value={projectId} onChange={(e) => { setProjectId(e.target.value); setUnitId(""); }} required className="select-base">
              <option value="" disabled>اختر المشروع</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>

          {/* الوحدة (متاحة فقط) */}
          <Field label="الوحدة *">
            <select name="unitId" value={unitId} onChange={(e) => { const id = e.target.value; setUnitId(id); const u = units.find((x) => x.id === id); if (u) { setPriceMode("after"); const bp = unitBasePrice(u, "after"); if (bp != null) setPrice(String(bp)); } }} required disabled={!projectId} className="select-base">
              <option value="" disabled>{projectId ? (units.length ? "اختر الوحدة" : "ما فيه وحدات متاحة") : "اختر المشروع أول"}</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.number}{u.price ? ` — ${toArabicDigits(u.price.toLocaleString("en-US"))} ر.س` : ""}</option>)}
            </select>
          </Field>

          {/* خيار السعر قبل/بعد الخصم — يظهر فقط للوحدات اللي فيها خصم مخزّن */}
          {hasUnitDiscount && selUnit && (
            <div className="rounded-xl border border-border p-3">
              <div className="mb-2 text-sm text-foreground">سعر الوحدة (فيها خصم)</div>
              <div className="grid grid-cols-2 gap-2">
                {([["after", "السعر بعد الخصم"], ["before", "السعر قبل الخصم"]] as const).map(([v, label]) => {
                  const bp = unitBasePrice(selUnit, v) ?? 0;
                  return (
                    <label key={v} className={`flex cursor-pointer flex-col items-center gap-0.5 rounded-lg border px-2 py-2 text-xs ${priceMode === v ? "border-gold/50 bg-gold/10 text-gold" : "border-border text-muted-foreground"}`}>
                      <input type="radio" name="priceModeRadio" checked={priceMode === v} onChange={() => changePriceMode(v)} className="hidden" />
                      <span>{label}</span>
                      <span className="font-semibold" dir="ltr">{formatCurrencyFull(bp)}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* المبالغ — عمود واحد على الجوال */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="سعر الشقة *"><input name="price" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))} required inputMode="numeric" dir="ltr" className="select-base" /></Field>
            <Field label="الخصم"><input name="discount" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/\D/g, ""))} inputMode="numeric" dir="ltr" className="select-base" /></Field>
            <Field label="العربون"><input name="deposit" value={deposit} onChange={(e) => setDeposit(e.target.value.replace(/\D/g, ""))} inputMode="numeric" dir="ltr" className="select-base" /></Field>
          </div>

          {/* ضريبة ٥٪ على السعر بعد الخصم */}
          <div className="rounded-xl border border-border p-3">
            <div className="mb-2 text-sm text-foreground">تُضاف ضريبة (٥٪) على السعر؟</div>
            <div className="grid grid-cols-2 gap-2">
              {([[true, "نعم"], [false, "لا"]] as const).map(([v, label]) => (
                <label key={String(v)} className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-sm ${vatIncluded === v ? "border-gold/50 bg-gold/10 text-gold" : "border-border text-muted-foreground"}`}>
                  <input type="radio" name="vatRadio" checked={vatIncluded === v} onChange={() => setVatIncluded(v)} className="hidden" />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {maxDiscount != null && (
            <p className={`rounded-lg px-3 py-2 text-xs ${discountExceeds ? "bg-destructive/10 text-destructive" : "bg-secondary/50 text-muted-foreground"}`}>
              {discountExceeds ? `الخصم تجاوز الحد المسموح (${formatCurrencyFull(maxDiscount)}) — يحتاج موافقة المدير` : `الحد الأقصى للخصم: ${formatCurrencyFull(maxDiscount)}`}
            </p>
          )}

          {/* ملخّص السعر + الدفع */}
          <div className="space-y-1 rounded-lg bg-secondary/50 px-3 py-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">السعر بعد الخصم</span><span className="text-foreground">{formatCurrencyFull(finalPrice)}</span></div>
            {vatIncluded && <div className="flex justify-between"><span className="text-muted-foreground">ضريبة (٥٪)</span><span className="text-warning">{formatCurrencyFull(tax)}</span></div>}
            <div className="flex justify-between border-t border-border pt-1"><span className="text-muted-foreground">الإجمالي</span><span className="font-bold text-gold">{formatCurrencyFull(totalAfterDiscount)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">المبلغ المحصّل</span><span className="text-success">{formatCurrencyFull(depositNum)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">المبلغ المتبقي</span><span className={remaining < 0 ? "font-bold text-destructive" : "font-bold text-foreground"}>{formatCurrencyFull(remaining)}</span></div>
          </div>
          {remaining < 0 && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">العربون أكبر من سعر الشقة</p>}

          {/* طريقة الدفع */}
          <Field label="طريقة الدفع *">
            <div className="grid grid-cols-3 gap-2">
              {(["CASH", "BANK_FINANCE", "CASH_AND_FINANCE"] as PaymentMethod[]).map((m) => (
                <label key={m} className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs ${method === m ? "border-gold/50 bg-gold/10 text-gold" : "border-border text-muted-foreground"}`}>
                  <input type="radio" name="paymentMethod" value={m} checked={method === m} onChange={() => setMethod(m)} className="hidden" />
                  {paymentMethodLabels[m]}
                </label>
              ))}
            </div>
          </Field>

          {/* تفاصيل الكاش */}
          {showCash && (
            <div className="space-y-3 rounded-xl border border-border p-3">
              <div className="text-xs font-medium text-muted-foreground">تفاصيل الكاش</div>
              {method === "CASH_AND_FINANCE" && (
                <Field label="المبلغ الكاش"><input name="cashAmount" defaultValue={booking?.cashAmount != null ? String(booking.cashAmount) : ""} inputMode="numeric" dir="ltr" className="select-base" /></Field>
              )}
              <Field label="طريقة دفع الكاش">
                <div className="grid grid-cols-3 gap-2">
                  {(["CHECK", "TRANSFER", "INSTALLMENTS"] as CashType[]).map((t) => (
                    <label key={t} className={`flex cursor-pointer items-center justify-center rounded-lg border px-2 py-1.5 text-xs ${cashType === t ? "border-gold/50 bg-gold/10 text-gold" : "border-border text-muted-foreground"}`}>
                      <input type="radio" name="cashPaymentType" value={t} checked={cashType === t} onChange={() => setCashType(t)} className="hidden" />
                      {t === "CHECK" ? "شيك" : t === "TRANSFER" ? "تحويل" : "دفعات"}
                    </label>
                  ))}
                </div>
              </Field>
              {cashType === "CHECK" && <Field label="موعد الشيك المتوقع"><input name="expectedCheckDate" type="date" defaultValue={booking?.expectedCheckDate ? new Date(booking.expectedCheckDate).toISOString().slice(0, 10) : ""} className="select-base" /></Field>}
              {cashType === "TRANSFER" && <Field label="تاريخ التحويل المتوقع"><input name="expectedTransferDate" type="date" defaultValue={booking?.expectedTransferDate ? new Date(booking.expectedTransferDate).toISOString().slice(0, 10) : ""} className="select-base" /></Field>}
              {cashType === "INSTALLMENTS" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>الدفعات ({toArabicDigits(instRows.length)})</span>
                    <button type="button" onClick={() => setInstRows((r) => [...r, { amount: "", date: "" }])} className="text-gold">أضف دفعة</button>
                  </div>
                  {instRows.map((row, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input value={row.amount} onChange={(e) => setInstRows((r) => r.map((x, j) => j === i ? { ...x, amount: e.target.value.replace(/\D/g, "") } : x))} inputMode="numeric" dir="ltr" placeholder="القيمة" className="w-1/2 rounded-lg border border-border bg-background px-2 py-1.5 text-sm" />
                      <input value={row.date} onChange={(e) => setInstRows((r) => r.map((x, j) => j === i ? { ...x, date: e.target.value } : x))} type="date" className="flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-sm" />
                      {instRows.length > 1 && <button type="button" onClick={() => setInstRows((r) => r.filter((_, j) => j !== i))} className="text-xs text-destructive">حذف</button>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* تفاصيل التمويل */}
          {showFinance && (
            <div className="space-y-3 rounded-xl border border-border p-3">
              <div className="text-xs font-medium text-muted-foreground">تفاصيل التمويل</div>
              <Field label="البنك *">
                <select name="bankName" required className="select-base" defaultValue={booking?.bankName ?? ""}>
                  <option value="" disabled>اختر البنك</option>
                  {(Object.keys(bankLabels) as (keyof typeof bankLabels)[]).map((b) => <option key={b} value={b}>{bankLabels[b]}</option>)}
                </select>
              </Field>
            </div>
          )}

          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">{error}</p>}

          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="min-h-12 flex-1 rounded-xl border border-border px-4 text-sm text-muted-foreground sm:flex-none">إلغاء</button>
            <button type="submit" disabled={pending} className="min-h-12 flex-1 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
              {pending ? "جارٍ…" : editing ? "حفظ التعديلات" : immediateSale ? "سجّل الشراء" : "سجّل الحجز"}
            </button>
          </div>
        </form>
      </div>
    </div>
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
