"use client";

import { useState, useTransition } from "react";
import {
  Building2,
  Clock,
  BadgeCheck,
  Coins,
  Wallet,
  AlertTriangle,
} from "lucide-react";
import type { BookingStage } from "@prisma/client";
import {
  bookingStageOrder,
  bookingStageLabels,
  paymentMethodLabels,
  bankLabels,
  nationalityLabels,
  deliveryStatusLabels,
} from "@/lib/labels";
import { formatCurrency, formatCurrencyFull, formatNumberShort } from "@/lib/format";
import type { BookingCard, BookingsData } from "@/lib/data/bookings";
import { updateBookingStage, toggleFinanceRejected } from "@/lib/actions/bookings";

export function BookingsList({ data }: { data: BookingsData }) {
  const kpis = [
    { label: "إجمالي الحجوزات", value: formatNumberShort(data.kpis.total), icon: Building2, accent: "text-gold" },
    { label: "قيد البيع", value: formatNumberShort(data.kpis.inProgress), icon: Clock, accent: "text-warning" },
    { label: "تم البيع", value: formatNumberShort(data.kpis.sold), icon: BadgeCheck, accent: "text-success" },
    { label: "إجمالي العرابين", value: formatCurrency(data.kpis.deposits), icon: Coins, accent: "text-info" },
    { label: "قيمة المبيعات", value: formatCurrency(data.kpis.salesValue), icon: Wallet, accent: "text-gold" },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-foreground">خط المبيعات</h1>
        <p className="mt-1 text-sm text-muted-foreground">الحجوزات وتقدّم البيع وحالة التمويل</p>
      </header>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="glass rounded-2xl p-4">
              <Icon className={`size-5 ${k.accent}`} />
              <div className={`mt-2 text-lg font-bold ${k.accent}`}>{k.value}</div>
              <div className="text-xs text-muted-foreground">{k.label}</div>
            </div>
          );
        })}
      </section>

      {data.cards.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground">ما فيه حجوزات بعد.</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {data.cards.map((b) => (
            <BookingCardView key={b.id} b={b} isManager={data.manager} />
          ))}
        </div>
      )}
    </div>
  );
}

function BookingCardView({ b, isManager }: { b: BookingCard; isManager: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const currentIdx = bookingStageOrder.indexOf(b.stage);

  function setStage(stage: BookingStage) {
    setError(null);
    startTransition(async () => {
      const res = await updateBookingStage(b.id, stage);
      if (!res.ok) setError(res.error ?? "صار خطأ");
    });
  }
  function toggleFinance() {
    setError(null);
    startTransition(async () => {
      const res = await toggleFinanceRejected(b.id, !b.financeRejected);
      if (!res.ok) setError(res.error ?? "صار خطأ");
    });
  }

  return (
    <article
      className={`glass rounded-2xl p-5 ${b.financeRejected ? "border-destructive/50" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-foreground">{b.leadName}</h3>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {b.nationality ? nationalityLabels[b.nationality] : "—"}
            {b.nationalId ? ` · هوية ${b.nationalId}` : ""}
            {b.phone ? ` · ` : ""}
            {b.phone && <span dir="ltr">{b.phone}</span>}
          </div>
          <div className="mt-1 text-sm text-gold">
            {b.projectName ?? "—"} · وحدة <span dir="ltr">{b.unitNumber}</span>
          </div>
        </div>
        {b.financeRejected && (
          <span className="flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-1 text-xs text-destructive">
            <AlertTriangle className="size-3.5" />
            رفض تمويل
          </span>
        )}
      </div>

      {/* شريط تقدّم البيع */}
      <div className="mt-4">
        <div className="flex gap-1">
          {bookingStageOrder.map((s, i) => (
            <div
              key={s}
              className={`h-1.5 flex-1 rounded-full ${i <= currentIdx ? "bg-gold" : "bg-secondary"}`}
              title={bookingStageLabels[s]}
            />
          ))}
        </div>
        <div className="mt-1.5 flex justify-between text-[0.65rem] text-muted-foreground">
          {bookingStageOrder.map((s, i) => (
            <span key={s} className={i === currentIdx ? "font-bold text-gold" : ""}>
              {bookingStageLabels[s]}
            </span>
          ))}
        </div>
      </div>

      {/* تفاصيل مالية */}
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <Row label="الدفع" value={`${paymentMethodLabels[b.paymentMethod]}${b.bankName ? ` · ${bankLabels[b.bankName]}` : ""}`} />
        <Row label="العربون" value={formatCurrencyFull(b.deposit)} />
        <Row label="السعر" value={formatCurrencyFull(b.price)} />
        <Row label="الخصم" value={b.discount > 0 ? `- ${formatCurrencyFull(b.discount)}` : "—"} />
        <Row label="بعد الخصم" value={formatCurrencyFull(b.finalPrice)} strong />
        <Row label="محصّل" value={formatCurrencyFull(b.collected)} />
        <Row label="التسليم" value={deliveryStatusLabels[b.deliveryStatus]} />
        {isManager && <Row label="البائع" value={b.sellerName ?? "—"} />}
      </dl>

      {/* تحكم */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <select
          value={b.stage}
          disabled={pending}
          onChange={(e) => setStage(e.target.value as BookingStage)}
          className="select-base w-auto"
        >
          {bookingStageOrder.map((s) => (
            <option key={s} value={s}>{bookingStageLabels[s]}</option>
          ))}
        </select>
        <button
          onClick={toggleFinance}
          disabled={pending}
          className={`rounded-lg border px-3 py-2 text-xs transition-colors ${
            b.financeRejected
              ? "border-success/40 text-success hover:bg-success/10"
              : "border-destructive/40 text-destructive hover:bg-destructive/10"
          }`}
        >
          {b.financeRejected ? "ألغِ رفض التمويل" : "علّم رفض تمويل"}
        </button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
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
