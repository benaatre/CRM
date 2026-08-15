import type { OwnerChannelRow, OwnerTeamFuRow, OwnerTrendPoint } from "@/lib/data/owner-dashboard";
import { toArabicDigits } from "@/lib/format";

/**
 * «التحليلات» — شبكة acard مزدوجة من المرجع (1.4fr/1fr):
 * يمين: أداء المنصّات (أشرطة) + اتجاه الأسبوع (SVG يدوي — لا مكتبة رسم بالمشروع).
 * يسار: متابعات كل موظف (عنده/أنجز/باقي/فات) — بياناته بنفس دلالات جدول الفريق.
 * كل الأرقام من الخادم؛ المكوّن عرض صرف (server component).
 */

const BAR_COLORS = ["var(--od-visit)", "var(--od-int)", "var(--od-try)", "var(--od-nego)", "var(--gold)", "var(--od-later)", "var(--od-red)", "var(--od-new)", "var(--od-t3)"];
const AV_COLORS = ["#34d494", "#5b9def", "#a98edb", "#e8a54d", "#5bbccb", "#cba45e", "#ff7a8a"];

function Card({ title, sub, children, header }: { title: string; sub: string; children: React.ReactNode; header?: React.ReactNode }) {
  return (
    <div className="rounded-[28px] p-[22px]" style={{ background: "var(--od-raised)" }}>
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <div className="mb-[3px] text-lg font-bold text-foreground">{title}</div>
          <div className="mb-[18px] text-[13px]" style={{ color: "var(--od-t3)" }}>{sub}</div>
        </div>
        {header}
      </div>
      {children}
    </div>
  );
}

function TrendChart({ points }: { points: OwnerTrendPoint[] }) {
  const W = 500, H = 130, PAD = 10;
  const max = Math.max(1, ...points.map((p) => Math.max(p.leads, p.bookings)));
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / Math.max(1, points.length - 1);
  const y = (v: number) => H - PAD - (v * (H - 2 * PAD)) / max;
  const path = (get: (p: OwnerTrendPoint) => number) => points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(get(p)).toFixed(1)}`).join(" ");

  return (
    <div>
      <svg width="100%" height={H + 20} viewBox={`0 0 ${W} ${H + 20}`} preserveAspectRatio="none" role="img" aria-label="اتجاه الأسبوع: عملاء جدد وحجوزات يوميًا">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} y1={H * f} x2={W} y2={H * f} stroke="var(--od-hair)" />
        ))}
        <path d={path((p) => p.leads)} fill="none" stroke="var(--gold)" strokeWidth={2.5} strokeLinejoin="round" />
        <path d={path((p) => p.bookings)} fill="none" stroke="var(--od-int)" strokeWidth={2.5} strokeLinejoin="round" />
        {points.map((p, i) => (
          <g key={p.dayKey}>
            <circle cx={x(i)} cy={y(p.leads)} r={3.5} fill="var(--gold)" />
            <circle cx={x(i)} cy={y(p.bookings)} r={3.5} fill="var(--od-int)" />
            <text x={x(i)} y={H + 16} textAnchor="middle" fontSize={11} fill="var(--od-t3)">{p.dayLabel}</text>
          </g>
        ))}
      </svg>
      <div className="mt-2 flex gap-4 text-xs">
        <span className="inline-flex items-center gap-1.5" style={{ color: "var(--gold)" }}>
          <span className="size-2 rounded-full" style={{ background: "var(--gold)" }} aria-hidden /> عملاء جدد
        </span>
        <span className="inline-flex items-center gap-1.5" style={{ color: "var(--od-int)" }}>
          <span className="size-2 rounded-full" style={{ background: "var(--od-int)" }} aria-hidden /> حجوزات
        </span>
      </div>
    </div>
  );
}

export function OwnerAnalytics({ channels, channelsSub, trend, teamFu, teamFuSub, teamFuFilter }: {
  channels: OwnerChannelRow[];
  channelsSub: string;
  trend: OwnerTrendPoint[];
  teamFu: OwnerTeamFuRow[];
  teamFuSub: string;
  teamFuFilter?: React.ReactNode;
}) {
  const maxCount = Math.max(1, ...channels.map((c) => c.count));
  return (
    <div className="grid items-start gap-[18px] xl:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
      <Card title="أداء المنصّات" sub={channelsSub}>
        {channels.length === 0 && (
          <div className="grid h-24 place-items-center text-sm" style={{ color: "var(--od-t3)" }}>ما فيه عملاء بالفترة</div>
        )}
        {channels.map((c, i) => (
          <div key={c.channel} className="mb-[17px] flex items-center gap-3.5 last:mb-0">
            <span className="w-20 flex-none text-[15px] font-medium" style={{ color: "var(--od-t1)" }}>{c.label}</span>
            <div className="h-7 min-w-0 flex-1 overflow-hidden rounded-[18px]" style={{ background: "var(--od-raised2)" }}>
              <span
                className="block h-full rounded-[14px]"
                style={{ width: `${Math.max(4, Math.round((c.count / maxCount) * 100))}%`, background: BAR_COLORS[i % BAR_COLORS.length] }}
              />
            </div>
            <span
              className="w-[68px] flex-none text-left text-2xl font-extrabold"
              style={{ color: BAR_COLORS[i % BAR_COLORS.length], fontFamily: "var(--font-zain), var(--font-sans)", fontVariantNumeric: "tabular-nums" }}
            >
              {toArabicDigits(c.count)}
            </span>
          </div>
        ))}

        <div className="mt-5 border-t pt-[18px]" style={{ borderColor: "var(--od-hair)" }}>
          <div className="mb-3.5 text-lg font-bold text-foreground">اتجاه الأسبوع</div>
          <TrendChart points={trend} />
        </div>
      </Card>

      <Card title="متابعات كل موظف" sub={teamFuSub} header={teamFuFilter}>
        {teamFu.length === 0 && (
          <div className="grid h-24 place-items-center text-sm" style={{ color: "var(--od-t3)" }}>ما فيه مواعيد بالفترة</div>
        )}
        {teamFu.map((r, i) => (
          <div key={r.id} className="flex items-center gap-3 border-b py-3 last:border-b-0" style={{ borderColor: "var(--od-hair)" }}>
            <span
              className="flex size-10 flex-none items-center justify-center rounded-2xl text-[15px] font-bold text-white"
              style={{ background: AV_COLORS[i % AV_COLORS.length], fontFamily: "var(--font-zain), var(--font-sans)" }}
            >
              {r.name.trim().charAt(0)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold" style={{ color: "var(--od-t1)" }}>{r.name}</div>
              <div className="mt-0.5 text-[11px]" style={{ color: "var(--od-t3)" }}>{toArabicDigits(r.total)} موعد بالفترة</div>
            </div>
            <div className="flex flex-none gap-1.5 text-center">
              {([
                ["أنجز", r.done, "var(--od-won)"],
                ["باقي", r.remaining, "var(--od-visit)"],
                ["فات", r.missed, "var(--od-red)"],
              ] as const).map(([k, v, color]) => (
                <div key={k} className="w-12 rounded-xl px-1 py-1.5" style={{ background: "var(--od-raised2)" }}>
                  <div className="text-base font-extrabold leading-none" style={{ color, fontFamily: "var(--font-zain), var(--font-sans)", fontVariantNumeric: "tabular-nums" }}>
                    {toArabicDigits(v)}
                  </div>
                  <div className="mt-1 text-[10px]" style={{ color: "var(--od-t3)" }}>{k}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
