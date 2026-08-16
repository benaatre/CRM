"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Building2, CircleAlert, Loader2, MapPin, X } from "lucide-react";
import { toArabicDigits } from "@/lib/format";
import "./attendance.css";

/**
 * شيت «وين أنت الآن؟» — إصلاح الدفعة الرابعة:
 *
 * القائمة **لا تُعرض إطلاقًا** قبل اكتمال قراءة الموقع — عند الفتح يظهر شريط
 * «نقرأ موقعك الآن…» بمؤشر دوران، وعند الفشل رسالة واضحة + «حاول مرة ثانية»
 * (لا قائمة بلا مسافات أبدًا). قراءة بدقة أسوأ من الحد تُعاد مرة واحدة آليًا.
 * الاختيار ثم زر تأكيد باسم الموقع: «تأكيد الانتقال إلى {الموقع}».
 *
 * المسافات من الخادم، والاختيار النهائي يعاد التحقق منه في punch بحسبة مستقلة.
 */

export type NearbyLocation = {
  id: string;
  name: string;
  type: "HQ" | "PROJECT";
  distanceMeters: number;
  inRange: boolean;
};

export type SheetReadResult = { locations: NearbyLocation[]; accuracy: number };

/** أسوأ دقة تُقبل بلا إعادة محاولة — نفس افتراض minAccuracyMeters. */
const RETRY_ACCURACY_M = 100;

/** «٢٤٠ م» / «١.٤ كم» — بأرقام عربية. */
function distanceLabel(meters: number): string {
  if (meters < 1000) return `${toArabicDigits(Math.round(meters))} م`;
  const km = (meters / 1000).toFixed(1);
  return `${toArabicDigits(km.endsWith(".0") ? km.slice(0, -2) : km)} كم`;
}

export function LocationSheet({
  open,
  read,
  busy,
  onPick,
  onClose,
}: {
  open: boolean;
  /** يقرأ الموقع ويجلب القائمة — يرميه الفشل، والشيت يدير الحالات. */
  read: () => Promise<SheetReadResult | NearbyLocation[]>;
  busy: boolean;
  onPick: (loc: NearbyLocation) => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<"reading" | "list" | "error">("reading");
  const [locations, setLocations] = useState<NearbyLocation[]>([]);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [selected, setSelected] = useState<NearbyLocation | null>(null);
  const runRef = useRef(0);

  const doRead = useCallback(async () => {
    const run = ++runRef.current;
    setPhase("reading");
    setSelected(null);
    setAccuracy(null);
    try {
      let result = await read();
      let acc = Array.isArray(result) ? 0 : result.accuracy;
      // دقة أسوأ من الحد — محاولة ثانية واحدة آليًا.
      if (!Array.isArray(result) && acc > RETRY_ACCURACY_M) {
        if (runRef.current !== run) return;
        setAccuracy(acc);
        result = await read();
        acc = Array.isArray(result) ? 0 : result.accuracy;
      }
      if (runRef.current !== run) return;
      setLocations(Array.isArray(result) ? result : result.locations);
      setAccuracy(Array.isArray(result) ? null : acc);
      setPhase("list");
    } catch {
      if (runRef.current !== run) return;
      setPhase("error");
    }
  }, [read]);

  // كل فتح = قراءة جديدة — لا قائمة قديمة ولا مسافات بائتة.
  useEffect(() => {
    if (open) void doRead();
  }, [open, doRead]);

  if (!open) return null;

  return (
    <div className="att-scope fixed inset-0 z-50 flex items-end justify-center sm:items-center" dir="rtl">
      <button type="button" aria-label="إغلاق" onClick={onClose} className="absolute inset-0 border-0" style={{ background: "rgba(0,0,0,0.55)" }} />

      <div className="relative w-full max-w-md rounded-t-3xl border border-[var(--att-esp-line)] p-4 pb-6 shadow-2xl sm:rounded-3xl" style={{ background: "var(--att-esp-bg)" }}>
        <div className="mb-3.5 flex items-center justify-between">
          <h3 className="text-[15px] font-bold text-[var(--att-esp-text)]">وين أنت الآن؟</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="flex size-8 items-center justify-center rounded-lg border border-[var(--att-esp-line)] text-[var(--att-esp-muted)]"
          >
            <X aria-hidden size={15} strokeWidth={1.8} />
          </button>
        </div>

        {/* ===== قراءة جارية — لا قائمة قبل الإحداثيات ===== */}
        {phase === "reading" && (
          <div className="flex items-center gap-2.5 rounded-xl border border-[var(--att-esp-line)] bg-[var(--att-esp-card)] px-3.5 py-4">
            <Loader2 aria-hidden size={17} strokeWidth={1.8} className="animate-spin" style={{ color: "var(--att-gold)" }} />
            <p className="text-[12.5px] text-[var(--att-esp-text)]">
              نقرأ موقعك الآن…
              {accuracy !== null && (
                <span className="block text-[10.5px]" style={{ color: "var(--att-esp-muted)" }}>
                  الدقة {toArabicDigits(Math.round(accuracy))} م — نحاول نحسّنها
                </span>
              )}
            </p>
          </div>
        )}

        {/* ===== فشل القراءة — رسالة واضحة وزر إعادة، لا قائمة بلا مسافات ===== */}
        {phase === "error" && (
          <div className="flex flex-col gap-2.5 rounded-xl border px-3.5 py-4" style={{ borderColor: "color-mix(in srgb, var(--att-seg-out) 40%, transparent)" }}>
            <p className="text-[12.5px] leading-relaxed text-[var(--att-esp-text)]">
              ما قدرنا نقرأ موقعك — تأكد أن إذن الموقع مفعّل وأنت بمكان مكشوف
            </p>
            <button
              type="button"
              onClick={() => void doRead()}
              className="min-h-10 rounded-xl border-0 text-[13px] font-extrabold"
              style={{ background: "var(--att-gold)", color: "var(--att-on-gold)" }}
            >
              حاول مرة ثانية
            </button>
          </div>
        )}

        {/* ===== القائمة — بعد الإحداثيات فقط، مرتّبة بالأقرب ===== */}
        {phase === "list" &&
          (locations.length === 0 ? (
            <p className="py-6 text-center text-[12.5px] text-[var(--att-esp-muted)]">ما فيه مواقع نشطة معرّفة</p>
          ) : (
            <>
              {accuracy !== null && (
                <p className="mb-2 text-[10.5px]" style={{ color: "var(--att-esp-muted)" }}>
                  قُرئ موقعك بدقة {toArabicDigits(Math.round(accuracy))} م
                </p>
              )}
              <ul className="max-h-[45vh] space-y-1.5 overflow-y-auto">
                {locations.map((l) => {
                  const isSel = selected?.id === l.id;
                  return (
                    <li key={l.id}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setSelected(l)}
                        className="flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-right transition-colors disabled:opacity-50"
                        style={{
                          borderColor: isSel ? "var(--att-gold)" : "var(--att-esp-line)",
                          background: isSel ? "color-mix(in srgb, var(--att-gold) 10%, transparent)" : "var(--att-esp-card)",
                          opacity: l.inRange || isSel ? 1 : 0.55,
                        }}
                      >
                        <span className="flex size-9 flex-none items-center justify-center rounded-lg border border-[var(--att-esp-line)]">
                          {l.type === "HQ" ? (
                            <Building2 aria-hidden size={16} strokeWidth={1.5} style={{ color: "var(--att-seg-hq)" }} />
                          ) : (
                            <MapPin aria-hidden size={16} strokeWidth={1.5} style={{ color: "var(--att-seg-project)" }} />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-bold text-[var(--att-esp-text)]">{l.name}</span>
                          <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--att-esp-muted)]">
                            يبعد {distanceLabel(l.distanceMeters)}
                            {!l.inRange && (
                              <span className="flex items-center gap-1 font-bold" style={{ color: "var(--att-seg-out)" }}>
                                <CircleAlert aria-hidden size={12} strokeWidth={1.8} />
                                خارج النطاق — يُسجَّل للمراجعة
                              </span>
                            )}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              {/* زر التأكيد باسم الموقع المختار */}
              <button
                type="button"
                disabled={busy || !selected}
                onClick={() => selected && onPick(selected)}
                className="mt-3 min-h-12 w-full rounded-[13px] border-0 text-[14px] font-extrabold disabled:opacity-50"
                style={{ background: "var(--att-gold)", color: "var(--att-on-gold)" }}
              >
                {busy ? "جاري التسجيل…" : selected ? `تأكيد الانتقال إلى ${selected.name}` : "اختر موقعك"}
              </button>
            </>
          ))}
      </div>
    </div>
  );
}

export default LocationSheet;
