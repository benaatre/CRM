"use client";

import { Building2, CircleAlert, MapPin } from "lucide-react";
import { toArabicDigits } from "@/lib/format";
import { hmLabel } from "@/lib/attendance-ui";
import "./attendance.css";

/**
 * خط اليوم متعدد المواقع + سجل المحطات القابل للطي — مكوّنان مشتركان بين
 * بطاقة الموظف (يومه الجاري) وملف الموظف عند المالك (كل يوم على حدة).
 *
 * كل الألوان من متغيرات `attendance.css`؛ المدد الحيّة تُحسب من `now` الممرر
 * (الأب يملك المؤقّت) — لا مؤقّتات داخلية هنا.
 */

export type StationDto = {
  kind: "HQ" | "PROJECT" | "OUT";
  name: string;
  fromIso: string;
  fromText: string;
  toIso: string | null;
  toText: string | null;
};

export type VerificationDto = {
  status: "SENT" | "CONFIRMED" | "OUT_OF_ZONE" | "MISSED";
  atIso: string;
  atText: string;
};

const SEG_VAR: Record<StationDto["kind"], string> = {
  HQ: "var(--att-seg-hq)",
  PROJECT: "var(--att-seg-project)",
  OUT: "var(--att-seg-out)",
};

/* ═══════════════════ خط اليوم ═══════════════════ */

/**
 * مقاطع ملوّنة على مدى [بداية الجلسة، max(نهاية دوامه، الآن)] — ذهبي للمقر،
 * سماوي للمشروع، أحمر خارج النطاق — مع دبابيس عند نقاط الانتقال ومؤشر «الآن».
 * الاتجاه RTL: البداية يمينًا، فالمواضع بـ`right%`.
 */
export function DayLine({
  stations,
  startIso,
  shiftEndIso,
  now,
  startLabel,
  endLabel,
}: {
  stations: StationDto[];
  startIso: string;
  shiftEndIso: string;
  now: number;
  startLabel: string;
  endLabel: string;
}) {
  const start = new Date(startIso).getTime();
  const shiftEnd = new Date(shiftEndIso).getTime();
  const lastEnd = stations.reduce((m, s) => Math.max(m, new Date(s.toIso ?? s.fromIso).getTime()), 0);
  const end = Math.max(shiftEnd, now, lastEnd);
  const span = Math.max(1, end - start);
  const pos = (t: number) => Math.min(100, Math.max(0, ((t - start) / span) * 100));

  return (
    <div>
      <div className="relative h-2.5">
        {/* السكة */}
        <span aria-hidden className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[var(--att-rail)]" />
        {/* علامة نهاية الدوام — متقطعة بعدها لو الدوام ممتد */}
        {stations.map((s, i) => {
          const f = new Date(s.fromIso).getTime();
          const t = s.toIso ? new Date(s.toIso).getTime() : now;
          return (
            <span
              key={`${s.fromIso}-${i}`}
              aria-hidden
              className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full"
              style={{ right: `${pos(f)}%`, width: `${Math.max(0.5, pos(t) - pos(f))}%`, background: SEG_VAR[s.kind] }}
            />
          );
        })}
        {/* دبابيس نقاط الانتقال */}
        {stations.slice(1).map((s, i) => (
          <span
            key={`pin-${s.fromIso}-${i}`}
            aria-hidden
            className="absolute top-1/2 size-[7px] -translate-y-1/2 translate-x-1/2 rounded-full border border-[var(--att-esp-bg,var(--att-card))]"
            style={{ right: `${pos(new Date(s.fromIso).getTime())}%`, background: SEG_VAR[s.kind] }}
          />
        ))}
        {/* مؤشر «الآن» */}
        {now >= start && now <= end && (
          <span
            aria-hidden
            className="absolute top-1/2 -translate-y-1/2 translate-x-1/2"
            style={{ right: `${pos(now)}%` }}
          >
            <span className="att-pulse block size-[9px] rounded-full bg-[var(--att-text)]" />
          </span>
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10.5px] text-[var(--att-muted)]">
        <span>{startLabel}</span>
        <span>{endLabel}</span>
      </div>
    </div>
  );
}

/* ═══════════════════ سجل المحطات ═══════════════════ */

const VERIF_NOTE: Record<VerificationDto["status"], { text: string; tone: "ok" | "warn" }> = {
  CONFIRMED: { text: "تحقق مؤكد", tone: "ok" },
  OUT_OF_ZONE: { text: "تحقق خارج النطاق", tone: "warn" },
  MISSED: { text: "نداء تحقق فائت", tone: "warn" },
  SENT: { text: "نداء تحقق قائم", tone: "warn" },
};

/**
 * لكل محطة: الأيقونة + الاسم + «من ← إلى» + المدة + ملاحظة التحقق. المحطة
 * الحالية شارتها «الآن» تنبض ومدتها تزيد حيًّا. الصفوف تدخل متدرجة (60ms).
 */
export function StationsLog({
  stations,
  verifications = [],
  now,
}: {
  stations: StationDto[];
  verifications?: VerificationDto[];
  now: number;
}) {
  if (stations.length === 0) {
    return <p className="py-2 text-[11.5px] text-[var(--att-muted)]">ما فيه تحركات مسجّلة</p>;
  }

  return (
    <ul className="space-y-1">
      {stations.map((s, i) => {
        const from = new Date(s.fromIso).getTime();
        const to = s.toIso ? new Date(s.toIso).getTime() : now;
        const minutes = Math.max(0, Math.round((to - from) / 60_000));
        const current = s.toIso === null;
        // ملاحظة التحقق: نداءات وقعت داخل نافذة المحطة.
        const note = verifications.find((v) => {
          const t = new Date(v.atIso).getTime();
          return t >= from && t <= to;
        });

        return (
          <li
            key={`${s.fromIso}-${i}`}
            className="att-row-in flex items-center gap-2.5 rounded-xl border border-[var(--att-line)] bg-[var(--att-card2)] px-3 py-2.5"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <span className="flex size-8 flex-none items-center justify-center rounded-lg border border-[var(--att-line)]">
              {s.kind === "HQ" ? (
                <Building2 aria-hidden size={15} strokeWidth={1.5} style={{ color: SEG_VAR.HQ }} />
              ) : s.kind === "OUT" ? (
                <CircleAlert aria-hidden size={15} strokeWidth={1.5} style={{ color: SEG_VAR.OUT }} />
              ) : (
                <MapPin aria-hidden size={15} strokeWidth={1.5} style={{ color: SEG_VAR.PROJECT }} />
              )}
            </span>

            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-[12.5px] font-bold text-[var(--att-text)]">{s.name}</span>
                {current && (
                  <span className="flex flex-none items-center gap-1 rounded-md border border-[var(--att-on)]/40 px-1.5 py-0.5 text-[9.5px] font-bold text-[var(--att-on)]">
                    <span aria-hidden className="att-pulse size-1.5 rounded-full bg-[var(--att-on)]" />
                    الآن
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-[10.5px] text-[var(--att-muted)]">
                {s.fromText} ← {current ? "الآن" : (s.toText ?? "—")}
                {note && (
                  <span
                    className="ms-2 font-medium"
                    style={{ color: VERIF_NOTE[note.status].tone === "ok" ? "var(--att-on)" : "var(--att-late)" }}
                  >
                    · {VERIF_NOTE[note.status].text} {note.atText}
                  </span>
                )}
              </span>
            </span>

            <span className="flex-none text-[11.5px] font-bold tabular-nums text-[var(--att-text)]">
              {minutes >= 60 ? hmLabel(minutes, toArabicDigits) : `${toArabicDigits(minutes)} د`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
