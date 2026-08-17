"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, MapPin, RadarIcon } from "lucide-react";
import { toArabicDigits } from "@/lib/format";
import type { LocationRadar } from "@/lib/data/attendance";

/**
 * لوحة «المواقع الحية» (الحضور بالرادار — ر٤) — الاستعلام المعكوس مرئيًا:
 * لكل موقع من داخله الآن (نبضته inZone حديثة + جلسة مفتوحة). المأهول أخضر
 * بأسماء ساكنيه، والفارغ رمادي. تحديث كل ٣٠ث (وضع اليوم، التبويب ظاهر).
 *
 * يرفع `presentUserIds` للأب فتضيف البلاطات نقطة «موقعه مؤكّد الآن» — فمن
 * سقط من الرادار (خرج/انقطع) لا يظهر مؤكّدًا ولو جلسته مفتوحة (يحل بدر/سعود).
 */
export function LocationRadar({
  initial,
  onPresent,
}: {
  initial: LocationRadar;
  onPresent?: (userIds: string[]) => void;
}) {
  const [radar, setRadar] = useState<LocationRadar>(initial);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/attendance/radar", { cache: "no-store" });
      const data = (await res.json()) as { ok: boolean } & LocationRadar;
      if (data.ok) setRadar(data);
    } catch {
      /* الحالي يبقى — التحديث القادم يعوّض */
    }
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    onPresent?.(radar.presentUserIds);
  }, [radar.presentUserIds, onPresent]);

  const populated = radar.locations.filter((l) => l.present.length > 0);
  const empty = radar.locations.filter((l) => l.present.length === 0);
  const totalPresent = radar.presentUserIds.length;

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RadarIcon aria-hidden size={17} strokeWidth={1.8} className="text-muted-foreground" />
          <h2 className="text-sm font-bold text-foreground">المواقع الحية</h2>
        </div>
        <span className="text-xs text-muted-foreground">
          {totalPresent > 0
            ? `${toArabicDigits(totalPresent)} داخل المواقع الآن`
            : "ما فيه أحد داخل موقع الآن"}
          <span className="mr-1.5 text-[10.5px]">· آخر {toArabicDigits(radar.radarFreshMinutes)} د</span>
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {populated.map((l) => (
          <div key={l.id} className="rounded-xl border border-success/40 bg-success/5 p-3">
            <div className="flex items-center gap-2">
              {l.type === "HQ" ? (
                <Building2 aria-hidden size={15} strokeWidth={1.7} className="text-success" />
              ) : (
                <MapPin aria-hidden size={15} strokeWidth={1.7} className="text-success" />
              )}
              <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-foreground">{l.name}</span>
              <span className="flex-none rounded-md bg-success/15 px-1.5 py-0.5 text-[11px] font-bold text-success">
                {toArabicDigits(l.present.length)}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {l.present.map((p) => (
                <span key={p.userId} className="rounded-md bg-secondary px-2 py-0.5 text-[11px] text-foreground">
                  {p.name}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {empty.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">فارغة:</span>
          {empty.map((l) => (
            <span key={l.id} className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
              {l.name}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

export default LocationRadar;
