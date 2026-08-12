"use client";

import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";

/**
 * توست نجاح — أسفل اليسار، يختفي بعد ١٢ ثانية **ويتوقف عدّاده عند المرور**
 * (فلا يهرب من تحت مؤشر المستخدم وهو يقرأه). المؤقّت مُنظَّف عند التفكيك
 * وعند كل إعادة تسليح، ويُلغى العدّ كليًا مع prefers-reduced-motion؟ لا —
 * الإخفاء التلقائي سلوك لا حركة، فيبقى؛ الحركة وحدها (الانزلاق) هي المشروطة.
 */

const LIFE_MS = 12_000;

export function SuccessToast({ message, onDone }: { message: string; onDone: () => void }) {
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const arm = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(onDone, LIFE_MS);
  };
  const hold = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };

  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    arm();
    return () => {
      cancelAnimationFrame(raf);
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={hold}
      onMouseLeave={arm}
      className={`fixed bottom-5 left-5 z-[90] flex max-w-sm items-start gap-3 rounded-2xl bg-card p-4 shadow-2xl transition-all duration-300 ease-out ${
        shown ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
      }`}
      style={{ borderInlineStartWidth: 3, borderInlineStartColor: "var(--success)" }}
    >
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg bg-success/15 text-success">
        <Check className="size-[14px]" strokeWidth={1.8} />
      </span>
      <p className="min-w-0 flex-1 text-[13.5px] leading-6 text-foreground">{message}</p>
      <button
        onClick={onDone}
        aria-label="إغلاق"
        className="grid size-6 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
      >
        <X className="size-[14px]" strokeWidth={1.6} />
      </button>
    </div>
  );
}

export default SuccessToast;
