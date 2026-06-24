"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PaymentMethod } from "@prisma/client";
import { bankLabels, paymentMethodLabels } from "@/lib/labels";
import { formatCurrencyFull, toArabicDigits } from "@/lib/format";
import { createBooking, createCashSales, fetchProjectsWithUnits } from "@/lib/actions/bookings";
import type { ProjectWithUnits } from "@/lib/data/bookings";

type CashType = "CHECK" | "TRANSFER" | "INSTALLMENTS";

export function BookingForm({
  open, onClose, leadId, leadName, onDone, presetUnitId, immediateSale = false,
}: {
  open: boolean;
  onClose: () => void;
  leadId: string;
  leadName: string;
  onDone?: () => void;
  presetUnitId?: string;
  immediateSale?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [projects, setProjects] = useState<ProjectWithUnits[]>([]);
  const [projectId, setProjectId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [multiSel, setMultiSel] = useState<Set<string>>(new Set());
  const [price, setPrice] = useState("");
  const [discount, setDiscount] = useState("");
  const [deposit, setDeposit] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [cashType, setCashType] = useState<CashType>("CHECK");
  const [nationality, setNationality] = useState<"SAUDI" | "RESIDENT">("SAUDI");
  const [vatIncluded, setVatIncluded] = useState(false);
  const [instRows, setInstRows] = useState<{ amount: string; date: string }[]>([{ amount: "", date: "" }]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { fetchProjectsWithUnits().then(setProjects); setError(null); }
  }, [open]);

  const units = useMemo(() => projects.find((p) => p.id === projectId)?.units ?? [], [projects, projectId]);

  // تعبئة الوحدة المحدّدة مسبقًا (من شبكة المشروع)
  useEffect(() => {
    if (presetUnitId && projects.length) {
      const proj = projects.find((p) => p.units.some((u) => u.id === presetUnitId));
      if (proj) {
        setProjectId(proj.id);
        setUnitId(presetUnitId);
        const u = proj.units.find((x) => x.id === presetUnitId);
        if (u?.price) setPrice(String(u.price));
      }
    }
  }, [presetUnitId, projects]);

  const priceNum = Number(price.replace(/\D/g, "")) || 0;
  const discountNum = Number(discount.replace(/\D/g, "")) || 0;
  const finalPrice = priceNum - discountNum;
  const vat = vatIncluded ? Math.round(finalPrice * 0.15) : 0;
  // المحصّل (العربون) والمتبقي — لحظيًا.
  const depositNum = Number(deposit.replace(/\D/g, "")) || 0;
  const totalAfterDiscount = finalPrice + vat;
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
  const immediateTotal = units.filter((u) => multiSel.has(u.id)).reduce((s, u) => s + (u.price ?? 0), 0);

  if (!open) return null;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("leadId", leadId);
    fd.set("includesVAT", vatIncluded ? "yes" : "no");

    // شراء كاش فوري — يدعم وحدة أو أكثر (createCashSales).
    if (immediateSale) {
      if (multiSel.size === 0) { setError("اختر وحدة واحدة على الأقل"); return; }
      fd.set("unitIds", [...multiSel].join(","));
      startTransition(async () => {
        const res = await createCashSales(fd);
        if (res.ok) { router.refresh(); onDone?.(); onClose(); }
        else setError(res.error ?? "صار خطأ");
      });
      return;
    }

    if (showCash && cashType === "INSTALLMENTS") {
      const rows = instRows
        .filter((r) => r.amount)
        .map((r) => ({ amount: Number(r.amount.replace(/\D/g, "")) || 0, date: r.date }));
      fd.set("installments", JSON.stringify(rows));
      fd.set("installmentsCount", String(rows.length));
    }
    startTransition(async () => {
      const res = await createBooking(fd);
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
            <h2 className="text-lg font-bold text-foreground">{immediateSale ? "تسجيل شراء (كاش فوري)" : "حجز جديد"}</h2>
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
              <input name="secondaryPhone" inputMode="numeric" dir="ltr" className="select-base" placeholder="05xxxxxxxx" />
            </label>
          </div>

          {/* المشروع */}
          <Field label="المشروع *">
            <select value={projectId} onChange={(e) => { setProjectId(e.target.value); setUnitId(""); setMultiSel(new Set()); }} required className="select-base">
              <option value="" disabled>اختر المشروع</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>

          {/* الوحدة: اختيار متعدد للشراء الفوري، واحدة للحجز */}
          {immediateSale ? (
            <div className="space-y-2">
              <span className="text-xs text-muted-foreground">الوحدات * (تقدر تختار أكثر من وحدة)</span>
              {!projectId ? (
                <p className="text-xs text-muted-foreground">اختر المشروع أول</p>
              ) : units.length === 0 ? (
                <p className="text-xs text-muted-foreground">ما فيه وحدات متاحة</p>
              ) : (
                <div className="grid grid-cols-2 gap-2 rounded-xl border border-border p-3">
                  {units.map((u) => (
                    <label key={u.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={multiSel.has(u.id)} onChange={(e) => setMultiSel((s) => { const n = new Set(s); e.target.checked ? n.add(u.id) : n.delete(u.id); return n; })} />
                      <span>{u.number}{u.price ? ` — ${toArabicDigits(u.price.toLocaleString("en-US"))}` : " — بدون سعر"}</span>
                    </label>
                  ))}
                </div>
              )}
              {multiSel.size > 0 && (
                <div className="flex justify-between rounded-lg bg-secondary/50 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">عدد الوحدات: {toArabicDigits(multiSel.size)}</span>
                  <span className="font-bold text-gold">{formatCurrencyFull(immediateTotal)}</span>
                </div>
              )}
            </div>
          ) : (
            <Field label="الوحدة *">
              <select name="unitId" value={unitId} onChange={(e) => { setUnitId(e.target.value); const u = units.find((x) => x.id === e.target.value); if (u?.price) setPrice(String(u.price)); }} required disabled={!projectId} className="select-base">
                <option value="" disabled>{projectId ? (units.length ? "اختر الوحدة" : "ما فيه وحدات متاحة") : "اختر المشروع أول"}</option>
                {units.map((u) => <option key={u.id} value={u.id}>{u.number}{u.price ? ` — ${toArabicDigits(u.price.toLocaleString("en-US"))}` : ""}</option>)}
              </select>
            </Field>
          )}

          {/* المبالغ (للحجز فقط) */}
          {!immediateSale && (
            <div className="grid grid-cols-3 gap-3">
              <Field label="سعر الشقة *"><input name="price" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))} required inputMode="numeric" dir="ltr" className="select-base" /></Field>
              <Field label="الخصم"><input name="discount" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/\D/g, ""))} inputMode="numeric" dir="ltr" className="select-base" /></Field>
              <Field label="العربون"><input name="deposit" value={deposit} onChange={(e) => setDeposit(e.target.value.replace(/\D/g, ""))} inputMode="numeric" dir="ltr" className="select-base" /></Field>
            </div>
          )}

          {/* ضريبة القيمة المضافة (VAT 15%) */}
          {!immediateSale && (
            <div className="rounded-xl border border-border p-3">
              <div className="mb-2 text-sm text-foreground">هل يشمل ضريبة القيمة المضافة (١٥٪)؟</div>
              <div className="grid grid-cols-2 gap-2">
                {([[true, "نعم"], [false, "لا"]] as const).map(([v, label]) => (
                  <label key={String(v)} className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-sm ${vatIncluded === v ? "border-gold/50 bg-gold/10 text-gold" : "border-border text-muted-foreground"}`}>
                    <input type="radio" name="vatRadio" checked={vatIncluded === v} onChange={() => setVatIncluded(v)} className="hidden" />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          )}

          {!immediateSale && maxDiscount != null && (
            <p className={`rounded-lg px-3 py-2 text-xs ${discountExceeds ? "bg-destructive/10 text-destructive" : "bg-secondary/50 text-muted-foreground"}`}>
              {discountExceeds ? "تجاوز الحد الأقصى المسموح للخصم" : `الحد الأقصى للخصم: ${formatCurrencyFull(maxDiscount)}`}
            </p>
          )}

          {/* ملخّص السعر + الدفع (للحجز فقط) */}
          {!immediateSale && (<>
          <div className="space-y-1 rounded-lg bg-secondary/50 px-3 py-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">السعر بعد الخصم</span><span className="text-foreground">{formatCurrencyFull(finalPrice)}</span></div>
            {vatIncluded && <div className="flex justify-between"><span className="text-muted-foreground">ضريبة القيمة المضافة (١٥٪)</span><span className="text-warning">{formatCurrencyFull(vat)}</span></div>}
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
                <Field label="المبلغ الكاش"><input name="cashAmount" inputMode="numeric" dir="ltr" className="select-base" /></Field>
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
              {cashType === "CHECK" && <Field label="موعد الشيك المتوقع"><input name="expectedCheckDate" type="date" className="select-base" /></Field>}
              {cashType === "TRANSFER" && <Field label="تاريخ التحويل المتوقع"><input name="expectedTransferDate" type="date" className="select-base" /></Field>}
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
                <select name="bankName" required className="select-base" defaultValue="">
                  <option value="" disabled>اختر البنك</option>
                  {(Object.keys(bankLabels) as (keyof typeof bankLabels)[]).map((b) => <option key={b} value={b}>{bankLabels[b]}</option>)}
                </select>
              </Field>
            </div>
          )}
          </>)}

          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-border px-4 py-2 text-sm text-muted-foreground">إلغاء</button>
            <button type="submit" disabled={pending} className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
              {pending ? "جارٍ…" : immediateSale ? "سجّل الشراء" : "سجّل الحجز"}
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
