"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, PauseCircle, X, Check } from "lucide-react";
import {
  PAUSE_REASONS, PAUSE_DURATIONS, pauseReasonLabel, formatPauseRemaining,
  type PauseReasonCode, type PauseDurationCode,
} from "@/lib/availability";

/** شارة حالة التوفّر — خضراء «متاح» أو حمراء «متوقف — السبب · الوقت المتبقّي». */
export function AvailabilityBadge({
  paused, reason, pauseUntil, compact = false,
}: {
  paused: boolean;
  reason: string | null;
  pauseUntil: Date | string | null;
  compact?: boolean;
}) {
  if (!paused) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2 py-0.5 text-xs text-success">
        <span className="size-2 rounded-full bg-success" /> متاح
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/15 px-2 py-0.5 text-xs text-destructive" title="متوقف عن استقبال العملاء">
      <PauseCircle className="size-3.5" />
      متوقف — {pauseReasonLabel(reason)}
      {!compact && <span className="text-destructive/70">· {formatPauseRemaining(pauseUntil)}</span>}
    </span>
  );
}

/** نافذة اختيار سبب ومدة الإيقاف — تُرسم عبر Portal في وسط الشاشة. */
export function PauseDialog({
  title, pending, onClose, onConfirm,
}: {
  title: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: (reason: PauseReasonCode, duration: PauseDurationCode) => void;
}) {
  const [reason, setReason] = useState<PauseReasonCode>("BUSY");
  const [duration, setDuration] = useState<PauseDurationCode>("manual");
  const [mounted, setMounted] = useState(false);

  // Portal لا يعمل إلا بعد التركيب على العميل (SSR-safe).
  useEffect(() => setMounted(true), []);
  // Esc للإغلاق + منع تمرير الخلفية أثناء فتح النافذة.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  if (!mounted) return null;

  const optClass = (active: boolean) =>
    `flex items-center justify-between gap-2 rounded-xl border px-3.5 py-3 text-sm font-medium transition-colors ${
      active
        ? "border-gold bg-gold/15 text-gold ring-1 ring-gold/40"
        : "border-border text-muted-foreground hover:border-gold/40 hover:text-foreground"
    }`;

  return createPortal(
    <div dir="rtl" className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* خلفية معتمة */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* النافذة */}
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-gold/30 bg-[#0A0A0B] shadow-2xl"
      >
        {/* الترويسة */}
        <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-destructive/15 text-destructive">
              <PauseCircle className="size-5" />
            </span>
            <h2 className="text-base font-bold text-gold">{title}</h2>
          </div>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
            <X className="size-5" />
          </button>
        </div>

        {/* المحتوى */}
        <div className="space-y-5 px-5 py-5">
          {/* السبب */}
          <section className="space-y-2.5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <span className="h-4 w-1 rounded-full bg-gold" /> السبب
            </h3>
            <div className="grid grid-cols-2 gap-2.5">
              {PAUSE_REASONS.map((r) => (
                <button key={r.code} type="button" onClick={() => setReason(r.code)} className={optClass(reason === r.code)}>
                  <span>{r.label}</span>
                  {reason === r.code && <Check className="size-4 shrink-0" />}
                </button>
              ))}
            </div>
          </section>

          {/* المدة */}
          <section className="space-y-2.5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <span className="h-4 w-1 rounded-full bg-gold" /> المدة
            </h3>
            <div className="grid grid-cols-2 gap-2.5">
              {PAUSE_DURATIONS.map((d) => (
                <button key={d.code} type="button" onClick={() => setDuration(d.code)} className={optClass(duration === d.code)}>
                  <span>{d.label}</span>
                  {duration === d.code && <Check className="size-4 shrink-0" />}
                </button>
              ))}
            </div>
          </section>
        </div>

        {/* الأزرار */}
        <div className="flex items-center justify-end gap-2.5 border-t border-border/70 px-5 py-4">
          <button onClick={onClose} className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
            إلغاء
          </button>
          <button
            onClick={() => onConfirm(reason, duration)}
            disabled={pending}
            className="flex items-center gap-2 rounded-xl bg-destructive px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending && <Loader2 className="size-4 animate-spin" />} إيقاف الاستقبال
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
