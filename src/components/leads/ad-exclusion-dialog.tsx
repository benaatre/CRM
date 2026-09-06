"use client";

import { useEffect, useState, useTransition } from "react";
import { FileDown } from "lucide-react";
import { buildAdExclusion, type AdExclusionOpts } from "@/lib/actions/ad-exclusion";
import { toArabicDigits } from "@/lib/format";

/**
 * زر «تصدير للاستبعاد الإعلاني» + نافذة الخيارات — للمالك حصرًا (الصفحة تُخفيه
 * لغيره والأكشن يصده server-side). عرض وتوليد ملف فقط — صفر كتابة على العملاء.
 * التنزيل بنمط CSV القائم بالنظام (Blob + BOM ليقرأه Excel عربيًا سليمًا).
 */
export function AdExclusionDialog() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [includeArchived, setIncludeArchived] = useState(true);
  const [months, setMonths] = useState<AdExclusionOpts["months"]>(0);
  const [count, setCount] = useState<number | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // العدّاد الحي: «سيُصدَّر N عميلًا» — يُعاد حسابه مع كل تغيير خيار.
  useEffect(() => {
    if (!open) return;
    setCount(null); setError(null);
    let alive = true;
    buildAdExclusion({ includeArchived, months }, true).then((r) => {
      if (!alive) return;
      if (r.ok) { setCount(r.count); setSkipped(r.skippedInvalidPhone); }
      else setError(r.error);
    });
    return () => { alive = false; };
  }, [open, includeArchived, months]);

  function download() {
    setError(null);
    startTransition(async () => {
      const r = await buildAdExclusion({ includeArchived, months }, false);
      if (!r.ok) { setError(r.error); return; }
      if (!r.csv || !r.filename) { setError("ما فيه صفوف للتصدير"); return; }
      const blob = new Blob(["﻿" + r.csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = r.filename;
      a.click();
      URL.revokeObjectURL(a.href);
      setOpen(false);
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <FileDown className="size-3.5" strokeWidth={1.6} /> تصدير للاستبعاد الإعلاني
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="glass relative z-10 w-full max-w-md rounded-2xl p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold text-foreground">تصدير للاستبعاد الإعلاني</h2>
              <button onClick={() => setOpen(false)} className="rounded-lg px-2 py-1 text-sm text-muted-foreground hover:bg-secondary">إغلاق</button>
            </div>
            <p className="mb-4 text-xs leading-5 text-muted-foreground">
              كل «غير مهتم» (مقفول-خسارة بكل أسبابه) بصيغة تقبلها منصات الإعلان مباشرة (‏Meta Custom Audience — جوال دولي ‎+966).
              من له موعد متابعة مستقبلي يُستبعد تلقائيًا، و«موعد لاحق» لا يدخل أصلًا (ضمن مظلة المهتم).
            </p>

            <label className="mb-3 flex cursor-pointer items-center justify-between rounded-xl border border-border px-3 py-2.5 text-sm text-foreground">
              تضمين المؤرشفين
              <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} className="size-4 accent-[var(--gold)]" />
            </label>

            <div className="mb-4">
              <div className="mb-1.5 text-xs text-muted-foreground">مدة الإغلاق</div>
              <div className="grid grid-cols-4 gap-2">
                {([[0, "الكل"], [3, "٣ أشهر"], [6, "٦ أشهر"], [12, "سنة"]] as const).map(([v, label]) => (
                  <label key={v} className={`flex cursor-pointer items-center justify-center rounded-lg border px-2 py-2 text-xs ${months === v ? "border-gold/50 bg-gold/10 text-gold" : "border-border text-muted-foreground"}`}>
                    <input type="radio" checked={months === v} onChange={() => setMonths(v)} className="hidden" />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <div className="mb-4 rounded-xl bg-secondary/50 px-4 py-3 text-center text-sm" style={{ fontVariantNumeric: "tabular-nums" }}>
              {count === null && !error ? (
                <span className="text-muted-foreground">جارٍ العدّ…</span>
              ) : count !== null ? (
                <>
                  سيُصدَّر <b className="text-gold">{toArabicDigits(count)}</b> عميلًا
                  {skipped > 0 && <span className="text-muted-foreground"> · استُبعد {toArabicDigits(skipped)} لرقم غير صالح</span>}
                </>
              ) : null}
            </div>

            {error && <p className="mb-3 rounded-lg bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">{error}</p>}

            <button
              onClick={download}
              disabled={pending || !count}
              className="min-h-11 w-full rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "جارٍ التوليد…" : "نزّل ملف CSV"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
