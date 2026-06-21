import Link from "next/link";
import {
  Users,
  Flame,
  Building2,
  CalendarClock,
  BadgeCheck,
  TrendingUp,
  Phone,
} from "lucide-react";
import { requireUser } from "@/lib/auth-guards";
import { getDashboard, normalizePeriod } from "@/lib/data/dashboard";
import { stageLabels, stageColor } from "@/lib/labels";
import { formatNumberShort, timeAgo } from "@/lib/format";
import { PeriodFilter } from "@/components/dashboard/period-filter";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const user = await requireUser();
  const period = normalizePeriod((await searchParams).period);
  const d = await getDashboard(period);

  const kpis = [
    { label: "إجمالي العملاء", value: formatNumberShort(d.kpis.totalClients), icon: Users, accent: "gold", span: "md:col-span-2 md:row-span-2", big: true },
    { label: "غير موزّعين", value: formatNumberShort(d.kpis.unassigned), icon: Flame, accent: "danger", hide: !d.manager },
    { label: "الحجوزات", value: formatNumberShort(d.kpis.bookings), icon: Building2, accent: "info" },
    { label: "الزيارات", value: formatNumberShort(d.kpis.visits), icon: CalendarClock, accent: "muted" },
    { label: "صفقات مقفولة", value: formatNumberShort(d.kpis.closedWon), icon: BadgeCheck, accent: "success" },
    { label: "معدل التحويل", value: `${formatNumberShort(d.kpis.conversion)}٪`, icon: TrendingUp, accent: "gold" },
  ].filter((k) => !k.hide);

  const accent: Record<string, string> = {
    gold: "text-gold",
    danger: "text-destructive",
    success: "text-success",
    info: "text-info",
    muted: "text-muted-foreground",
  };

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">هلا {user.name} 👋</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {d.manager ? "نظرة عامة على كل النشاط." : "نظرة على عملائك ومتابعاتك."}
          </p>
        </div>
        <PeriodFilter current={period} />
      </header>

      {/* مؤشرات Bento */}
      <section className="grid auto-rows-[140px] grid-cols-2 gap-5 md:grid-cols-4">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div
              key={k.label}
              className={`group glass flex flex-col justify-between rounded-2xl p-5 shadow-sm transition-colors hover:border-gold/40 ${k.span ?? ""}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{k.label}</span>
                <Icon className={`size-5 ${accent[k.accent]}`} />
              </div>
              <div className={`font-bold ${accent[k.accent]} ${k.big ? "text-5xl" : "text-3xl"}`}>
                {k.value}
              </div>
            </div>
          );
        })}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ليدات تنتظر أول تواصل */}
        <Card title="ليدات تنتظر أول تواصل" hint="سرعة الرد ترفع التحويل ٩ أضعاف" accentBar="bg-destructive">
          {d.waitingFirstContact.length === 0 ? (
            <Empty text="ما فيه ليدات جديدة تنتظر 👌" />
          ) : (
            <ul className="divide-y divide-border">
              {d.waitingFirstContact.map((l) => (
                <li key={l.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <div className="font-medium text-foreground">{l.name}</div>
                    <div className="text-xs text-muted-foreground" dir="ltr">{l.phone}</div>
                  </div>
                  <div className="text-left">
                    <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                      {timeAgo(l.createdAt)}
                    </span>
                    {d.manager && l.assignedToName && (
                      <div className="mt-1 text-xs text-muted-foreground">{l.assignedToName}</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* متابعات اليوم */}
        <Card title="متابعات اليوم" hint="المستحقّة اليوم أو فات موعدها" accentBar="bg-gold">
          {d.followupsToday.length === 0 ? (
            <Empty text="ما عندك متابعات مستحقّة 🎉" />
          ) : (
            <ul className="divide-y divide-border">
              {d.followupsToday.map((l) => (
                <li key={l.id} className="flex items-center justify-between py-2.5">
                  <div className="flex items-center gap-2">
                    <Phone className="size-4 text-muted-foreground" />
                    <div>
                      <div className="font-medium text-foreground">{l.name}</div>
                      <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${stageColor[l.stage]}`}>
                        {stageLabels[l.stage]}
                      </span>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">{timeAgo(l.nextFollowup)}</span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/leads" className="mt-3 block text-center text-sm text-gold hover:underline">
            كل العملاء ←
          </Link>
        </Card>
      </div>

      {/* قمع المبيعات */}
      <Card title="قمع المبيعات" hint="عدد العملاء في كل مرحلة">
        <div className="space-y-2">
          {(() => {
            const max = Math.max(...d.funnel.map((f) => f.count), 1);
            return d.funnel.map((f) => (
              <div key={f.stage} className="flex items-center gap-3">
                <span className="w-28 shrink-0 text-sm text-muted-foreground">{stageLabels[f.stage]}</span>
                <div className="h-7 flex-1 overflow-hidden rounded-lg bg-secondary">
                  <div
                    className="flex h-full items-center justify-end rounded-lg bg-gradient-to-l from-gold to-gold-dark px-2 text-xs font-medium text-primary-foreground"
                    style={{ width: `${Math.max((f.count / max) * 100, 6)}%` }}
                  >
                    {f.count > 0 ? formatNumberShort(f.count) : ""}
                  </div>
                </div>
              </div>
            ));
          })()}
        </div>
      </Card>

      {/* أداء الموظفين (للمدير) */}
      {d.manager && d.team.length > 0 && (
        <Card title="أداء الموظفين" hint="ملخّص نشاط كل موظف نحو هدفه">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {d.team.map((t) => (
              <div key={t.id} className="rounded-xl border border-border p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-semibold text-foreground">{t.name}</span>
                  <span className="text-xs text-muted-foreground">نشاط {formatNumberShort(t.activityRate)}٪</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <Stat label="عملاء" value={t.total} />
                  <Stat label="لم يُتواصل" value={t.notContacted} danger={t.notContacted > 0} />
                  <Stat label="محاولات" value={t.attempts} />
                  <Stat label="زيارات" value={t.visits} />
                  <Stat label="حجوزات" value={t.bookings} />
                  <Stat label="مقفول" value={t.closed} success />
                </div>
                {t.progress !== null && (
                  <div className="mt-3">
                    <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                      <span>الهدف {t.target}</span>
                      <span className="text-gold">{formatNumberShort(t.progress)}٪</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full bg-gold" style={{ width: `${Math.min(t.progress, 100)}%` }} />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function Card({
  title,
  hint,
  accentBar,
  children,
}: {
  title: string;
  hint?: string;
  accentBar?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass rounded-2xl p-5">
      <div className="mb-4 flex items-center gap-2">
        {accentBar && <span className={`h-5 w-1 rounded-full ${accentBar}`} />}
        <div>
          <h2 className="font-semibold text-foreground">{title}</h2>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, danger, success }: { label: string; value: number; danger?: boolean; success?: boolean }) {
  return (
    <div className="rounded-lg bg-secondary/50 py-2">
      <div className={`text-base font-bold ${danger ? "text-destructive" : success ? "text-success" : "text-foreground"}`}>
        {formatNumberShort(value)}
      </div>
      <div className="text-muted-foreground">{label}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{text}</p>;
}
