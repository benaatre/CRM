"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Building2, Clock, BadgeCheck, Coins, Wallet, AlertTriangle, History, Ban,
} from "lucide-react";
import type { BookingStage } from "@prisma/client";
import {
  bookingStageOrder, bookingStageLabels, paymentMethodLabels, bankLabels,
  nationalityLabels, deliveryStatusLabels, cashPaymentTypeLabels,
} from "@/lib/labels";
import { formatCurrency, formatCurrencyFull, formatNumberShort, formatDate, timeAgo, toArabicDigits } from "@/lib/format";
import type { BookingCard, BookingsData } from "@/lib/data/bookings";
import { updateBookingStage, setFinanceRejected, cancelBooking } from "@/lib/actions/bookings";

export function BookingsList({ data }: { data: BookingsData }) {
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | "mine">("all");
  const [stageFilter, setStageFilter] = useState<"all" | "working" | "delivered">("all");

  // تحديث تلقائي كل ٣٠ ثانية (خط مبيعات مشترك)
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 30000);
    return () => clearInterval(t);
  }, [router]);

  // الفلاتر تعمل مع بعض: الملكية (الكل/حجوزاتي) + المرحلة (جاري العمل/تم التسليم).
  const cards = useMemo(() => {
    let c = filter === "mine" ? data.cards.filter((x) => x.sellerId === data.currentUserId) : data.cards;
    if (stageFilter === "working") c = c.filter((x) => x.stage !== "DELIVERED");
    else if (stageFilter === "delivered") c = c.filter((x) => x.stage === "DELIVERED");
    return c;
  }, [data.cards, data.currentUserId, filter, stageFilter]);

  const kpis = [
    { label: "إجمالي الحجوزات", value: formatNumberShort(data.kpis.total), icon: Building2, accent: "text-gold" },
    { label: "قيد البيع", value: formatNumberShort(data.kpis.inProgress), icon: Clock, accent: "text-warning" },
    { label: "تم البيع والاستلام", value: formatNumberShort(data.kpis.sold), icon: BadgeCheck, accent: "text-success", green: true },
    { label: "إجمالي العرابين", value: formatCurrency(data.kpis.deposits), icon: Coins, accent: "text-info" },
    { label: "قيمة المبيعات", value: formatCurrency(data.kpis.salesValue), icon: Wallet, accent: "text-gold" },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">خط المبيعات</h1>
          <p className="mt-1 text-sm text-muted-foreground">كل الحجوزات مرئية للفريق · يتحدّث تلقائيًا</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-xl border border-border bg-card p-1">
            {([["all", "كل الحجوزات"], ["mine", "حجوزاتي فقط"]] as const).map(([v, label]) => (
              <button key={v} onClick={() => setFilter(v)} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${filter === v ? "bg-secondary text-gold" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>
            ))}
          </div>
          <div className="flex gap-1 rounded-xl border border-border bg-card p-1">
            {([["working", "جاري العمل"], ["delivered", "تم البيع والتسليم"]] as const).map(([v, label]) => (
              <button key={v} onClick={() => setStageFilter((cur) => (cur === v ? "all" : v))} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${stageFilter === v ? "bg-secondary text-gold" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>
            ))}
          </div>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {kpis.map((k) => {
          const Icon = k.icon;
          const green = k.label === "تم البيع والاستلام";
          return (
            <div key={k.label} className={`rounded-2xl p-4 ${green ? "border border-success/40 bg-success/10" : "glass"}`}>
              <Icon className={`size-5 ${k.accent}`} />
              <div className={`mt-2 text-lg font-bold ${k.accent}`}>{k.value}</div>
              <div className={`text-xs ${green ? "text-success" : "text-muted-foreground"}`}>{k.label}</div>
            </div>
          );
        })}
      </section>

      {cards.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground">ما فيه حجوزات{filter === "mine" ? " لك" : ""} بعد.</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {cards.map((b) => <BookingCardView key={b.id} b={b} manager={data.manager} />)}
        </div>
      )}
    </div>
  );
}

function BookingCardView({ b, manager }: { b: BookingCard; manager: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason] = useState("");
  const [showLog, setShowLog] = useState(false);
  // SOLD وDELIVERED مدموجان في «تم البيع والاستلام» (= DELIVERED). نخفي SOLD من الواجهة.
  const STAGES = bookingStageOrder.filter((s) => s !== "SOLD");
  const effStage: BookingStage = b.stage === "SOLD" ? "DELIVERED" : b.stage;
  const currentIdx = STAGES.indexOf(effStage);

  function setStage(stage: BookingStage) {
    setError(null);
    startTransition(async () => {
      const res = await updateBookingStage(b.id, stage);
      if (!res.ok) setError(res.error ?? "صار خطأ");
      else router.refresh();
    });
  }
  function markRejected() {
    startTransition(async () => {
      const res = await setFinanceRejected(b.id, true, reason);
      if (res.ok) { setShowReason(false); setReason(""); router.refresh(); }
      else setError(res.error ?? "صار خطأ");
    });
  }
  function clearRejected() {
    startTransition(async () => { await setFinanceRejected(b.id, false); router.refresh(); });
  }
  function cancel() {
    if (!confirm(`متأكد تبي تلغي حجز وحدة ${b.unitNumber}؟ بترجع «متاحة» ويختفي من خط المبيعات.`)) return;
    const reason = prompt("سبب الإلغاء (اختياري):") ?? undefined;
    startTransition(async () => {
      const res = await cancelBooking(b.id, reason || undefined);
      if (!res.ok) setError(res.error ?? "صار خطأ");
      else router.refresh();
    });
  }

  const delivered = effStage === "DELIVERED";
  return (
    <article className={`glass overflow-hidden rounded-2xl p-5 ${delivered ? "border-[#16a34a] bg-[#16a34a]/[0.08]" : b.discountOverage > 0 ? "border-destructive" : b.financeRejected ? "border-destructive/50" : ""}`}>
      {/* شريط تجاوز الخصم — بارز فوق الكرت */}
      {b.discountOverage > 0 && (
        <div className="-mx-5 -mt-5 mb-4 bg-destructive px-4 py-2.5 text-center text-sm font-bold text-white">
          ⚠️ تم تجاوز الخصم المقرر بـ {formatCurrencyFull(b.discountOverage)}
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-foreground">{b.leadName}</h3>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {b.nationality ? nationalityLabels[b.nationality] : "—"}
            {b.nationalId ? ` · ${b.nationality === "RESIDENT" ? "إقامة" : "هوية"} ${b.nationalId}` : ""}
            {b.phone ? " · " : ""}{b.phone && <span dir="ltr">{b.phone}</span>}
          </div>
          <div className="mt-1 text-sm text-gold">{b.projectName ?? "—"} · وحدة <span dir="ltr">{b.unitNumber}</span></div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {delivered && (
            <span className="flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium" style={{ color: "#16a34a", background: "rgba(22,163,74,0.15)" }}><BadgeCheck className="size-3.5" /> تم البيع والاستلام</span>
          )}
          {b.financeRejected && (
            <span className="flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-1 text-xs text-destructive"><AlertTriangle className="size-3.5" /> رفض تمويل</span>
          )}
          {manager && b.discountExceeded && (
            <span className="flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-1 text-xs text-destructive"><AlertTriangle className="size-3.5" /> تجاوز الخصم</span>
          )}
        </div>
      </div>

      {/* شريط تقدّم البيع */}
      <div className="mt-4">
        <div className="flex gap-1">
          {STAGES.map((s, i) => (
            <div key={s} className={`h-1.5 flex-1 rounded-full ${i <= currentIdx ? "bg-gold" : "bg-secondary"}`} title={bookingStageLabels[s]} />
          ))}
        </div>
        <div className="mt-1.5 flex justify-between text-[0.65rem] text-muted-foreground">
          {STAGES.map((s, i) => <span key={s} className={i === currentIdx ? "font-bold text-gold" : ""}>{bookingStageLabels[s]}</span>)}
        </div>
      </div>

      {/* تفاصيل مالية */}
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <Row label="الدفع" value={`${paymentMethodLabels[b.paymentMethod]}${b.bankName ? ` · ${bankLabels[b.bankName]}` : ""}`} />
        <Row label="العربون" value={formatCurrencyFull(b.deposit)} />
        <Row label="السعر" value={formatCurrencyFull(b.price)} />
        <Row label="الخصم" value={b.discount > 0 ? `- ${formatCurrencyFull(b.discount)}` : "—"} />
        <Row label="بعد الخصم" value={formatCurrencyFull(b.finalPrice)} strong />
        {b.subjectToTax && b.taxAmount != null && <Row label="الضريبة ٥٪" value={formatCurrencyFull(b.taxAmount)} />}
        {b.subjectToTax && b.taxAmount != null && <Row label="الإجمالي" value={formatCurrencyFull(b.finalPrice + b.taxAmount)} strong />}
        {b.includesVAT && b.vatAmount != null && <Row label="ض. القيمة المضافة ١٥٪" value={formatCurrencyFull(b.vatAmount)} />}
        {b.includesVAT && b.vatAmount != null && <Row label="الإجمالي مع VAT" value={formatCurrencyFull(b.finalPrice + b.vatAmount)} strong />}
        {b.secondaryPhone && <Row label="رقم إضافي" value={b.secondaryPhone} />}
        <Row label="محصّل" value={formatCurrencyFull(b.collected)} />
        {b.expectedTransferDate && <Row label="موعد التحويل" value={formatDate(b.expectedTransferDate)} />}
        {b.installments && b.installments.length > 0 && <Row label="الدفعات" value={`${toArabicDigits(b.installments.length)} دفعة`} />}
        {b.cashAmount != null && <Row label="مبلغ الكاش" value={formatCurrencyFull(b.cashAmount)} />}
        {b.expectedCheckDate && <Row label="موعد الشيك" value={formatDate(b.expectedCheckDate)} />}
        {b.cashPaymentType && <Row label="دفع الكاش" value={cashPaymentTypeLabels[b.cashPaymentType] + (b.installmentsCount ? ` (${toArabicDigits(b.installmentsCount)})` : "")} />}
        <Row label="التسليم" value={deliveryStatusLabels[b.deliveryStatus]} />
        {b.sellerName && <Row label="البائع" value={b.sellerName} />}
      </dl>

      {b.financeRejected && b.financeRejectedReason && (
        <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">السبب: {b.financeRejectedReason}</p>
      )}

      {manager && b.discountExceeded && b.discountPercentAtBooking != null && (
        <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          تم تجاوز الخصم المسموح: الخصم {toArabicDigits(b.discountPercentAtBooking)}٪ والمسموح {toArabicDigits(b.maxDiscountPercentAtBooking ?? 0)}٪
          {b.maxDiscountPercentAtBooking != null && ` (فرق ${toArabicDigits(Math.round((b.discountPercentAtBooking - b.maxDiscountPercentAtBooking) * 100) / 100)}٪)`}
        </p>
      )}

      {/* تحكم */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <select value={effStage} disabled={pending} onChange={(e) => setStage(e.target.value as BookingStage)} className="select-base w-auto">
          {STAGES.map((s) => <option key={s} value={s}>{bookingStageLabels[s]}</option>)}
        </select>
        {b.financeRejected ? (
          <button onClick={clearRejected} disabled={pending} className="rounded-lg border border-success/40 px-3 py-2 text-xs text-success hover:bg-success/10">ألغِ رفض التمويل</button>
        ) : (
          <button onClick={() => setShowReason((v) => !v)} disabled={pending} className="rounded-lg border border-destructive/40 px-3 py-2 text-xs text-destructive hover:bg-destructive/10">فشل التمويل</button>
        )}
        <button onClick={() => setShowLog((v) => !v)} className="flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground"><History className="size-3.5" /> السجل</button>
        <button onClick={cancel} disabled={pending} className="flex items-center gap-1 rounded-lg border border-destructive/40 px-3 py-2 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"><Ban className="size-3.5" /> إلغاء الحجز</button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>

      {showReason && !b.financeRejected && (
        <div className="mt-2 flex gap-2">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="سبب فشل التمويل…" className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-destructive" />
          <button onClick={markRejected} disabled={pending} className="rounded-lg bg-destructive/15 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/25">تأكيد</button>
        </div>
      )}

      {/* سجل التغييرات */}
      {showLog && (
        <div className="mt-3 space-y-1.5 rounded-lg bg-secondary/40 p-3 text-xs">
          {b.events.length === 0 ? (
            <p className="text-muted-foreground">ما فيه سجل.</p>
          ) : (
            b.events.map((e, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-foreground">{bookingStageLabels[e.toStage]}</span>
                <span className="text-muted-foreground">{e.userName ?? "—"} · {timeAgo(e.createdAt)}</span>
              </div>
            ))
          )}
        </div>
      )}
    </article>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={strong ? "font-bold text-gold" : "text-foreground"}>{value}</dd>
    </div>
  );
}
