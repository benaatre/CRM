"use client";

import { Building2, CircleAlert, MapPin, X } from "lucide-react";
import { toArabicDigits } from "@/lib/format";
import "./attendance.css";

/**
 * شيت «وين أنت الآن؟» — قائمة المواقع النشطة مرتبة بالأقرب مع المسافة.
 *
 * عرض فقط: القراءة والمسافات جاءت من الخادم، والاختيار يُرسل له فيعيد حساب
 * Haversine بنفسه ولا يثق بادعاء العميل. الخارج عن النطاق معطّل بصريًا لكنه
 * يبقى قابلًا للاختيار مع تحذير — التسجيل خارج النطاق قرار مسجَّل لا خطأ.
 */

export type NearbyLocation = {
  id: string;
  name: string;
  type: "HQ" | "PROJECT";
  distanceMeters: number;
  inRange: boolean;
};

/** «٢٤٠ م» / «١.٤ كم» — بأرقام عربية. */
function distanceLabel(meters: number): string {
  if (meters < 1000) return `${toArabicDigits(Math.round(meters))} م`;
  const km = (meters / 1000).toFixed(1);
  return `${toArabicDigits(km.endsWith(".0") ? km.slice(0, -2) : km)} كم`;
}

export function LocationSheet({
  open,
  locations,
  busy,
  onPick,
  onClose,
}: {
  open: boolean;
  locations: NearbyLocation[];
  busy: boolean;
  onPick: (loc: NearbyLocation) => void;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="att-scope fixed inset-0 z-50 flex items-end justify-center sm:items-center" dir="rtl">
      {/* الخلفية — الضغط عليها يغلق */}
      <button type="button" aria-label="إغلاق" onClick={onClose} className="absolute inset-0 bg-black/55" />

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

        {locations.length === 0 ? (
          <p className="py-6 text-center text-[12.5px] text-[var(--att-esp-muted)]">ما فيه مواقع نشطة معرّفة</p>
        ) : (
          <ul className="max-h-[55vh] space-y-1.5 overflow-y-auto">
            {locations.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onPick(l)}
                  className="flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-right transition-colors disabled:opacity-50"
                  style={{
                    borderColor: "var(--att-esp-line)",
                    background: "var(--att-esp-card)",
                    opacity: busy ? undefined : l.inRange ? 1 : 0.55,
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
                          خارج النطاق
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default LocationSheet;
