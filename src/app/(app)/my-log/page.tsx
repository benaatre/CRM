import { redirect } from "next/navigation";
import Link from "next/link";
import { History } from "lucide-react";
import { requireUser, isManager } from "@/lib/auth-guards";
import { getMyDailyLog, type MyLogPeriod } from "@/lib/data/my-log";
import { toArabicDigits } from "@/lib/format";

export const dynamic = "force-dynamic";

const PERIODS: { key: MyLogPeriod; label: string }[] = [
  { key: "today", label: "اليوم" },
  { key: "yesterday", label: "أمس" },
  { key: "week", label: "الأسبوع" },
];

function timeLabel(at: Date): string {
  return new Intl.DateTimeFormat("ar-SA-u-nu-arab", { timeZone: "Asia/Riyadh", hour: "numeric", minute: "2-digit" }).format(at);
}

/**
 * «سجلّي» — نشاط الموظف هو فقط + تقرير يومه.
 * الحارس على الخادم: الهوية من الجلسة حصرًا (requireUser) — أي معرّف في الرابط يُتجاهل
 * كليًا، والفلترة داخل استعلامات getMyDailyLog لا في الواجهة.
 * المالك/المدير لهم صفحة التدقيق الكاملة — يُحوَّلون إليها.
 */
export default async function MyLogPage({ searchParams }: { searchParams: Promise<{ p?: string; page?: string }> }) {
  const user = await requireUser();
  if (isManager(user.role)) redirect("/audit");

  const sp = await searchParams;
  // البارامترات المقبولة: الفترة ورقم الصفحة فقط — لا معرّف مستخدم من الرابط أبدًا.
  const period: MyLogPeriod = sp.p === "yesterday" || sp.p === "week" ? sp.p : "today";
  const page = /^\d+$/.test(sp.page ?? "") ? Number(sp.page) : 1;

  const log = await getMyDailyLog(user.id, period, page);
  const r = log.report;

  // السطر التحفيزي — لهجة سعودية، بلا توبيخ.
  const motivation =
    r.dueCount > 0 && r.missed === 0
      ? "يوم مكتمل — كل مواعيدك منجزة 👏"
      : r.missed > 0
        ? `باقي ${toArabicDigits(r.missed)} ${r.missed === 1 ? "موعد" : "مواعيد"} — تقدر تلحقها 💪`
        : r.followups > 0
          ? "شغل مستمر — واصل 🚀"
          : "ما سجّلت شيئًا بعد — ابدأ بأقرب عميل لك";

  const duePct = r.dueCount > 0 ? Math.round((r.fulfilled / r.dueCount) * 100) : 0;
  const href = (p: MyLogPeriod, pg = 1) => `/my-log?p=${p}${pg > 1 ? `&page=${pg}` : ""}`;

  const counters = [
    { label: "متابعات مسجّلة", value: r.followups, cls: "text-gold" },
    { label: "أول تواصل بعملاء جدد", value: r.firstContacts, cls: "text-info" },
    { label: "زيارات تمّت", value: r.visitsDone, cls: "text-sky-300" },
    { label: "حجوزات", value: r.bookings, cls: "text-success" },
    { label: "نقاط الفترة", value: r.points, cls: "text-gold" },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <History className="size-6 text-gold" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">سجلّي</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">نشاطك وتقرير يومك — لك وحدك</p>
          </div>
        </div>
        {/* فلتر الفترة */}
        <div className="flex items-center gap-1.5">
          {PERIODS.map((p) => (
            <Link
              key={p.key}
              href={href(p.key)}
              className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${log.period === p.key ? "border-gold bg-gold/15 text-gold" : "border-border text-muted-foreground hover:text-foreground"}`}
            >
              {p.label}
            </Link>
          ))}
        </div>
      </header>

      {/* تقرير الفترة */}
      <section className="glass space-y-4 rounded-2xl p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {counters.map((c) => (
            <div key={c.label} className="rounded-xl border border-border p-3 text-center">
              <div className={`text-xl font-bold ${c.cls}`} style={{ fontVariantNumeric: "tabular-nums" }}>{toArabicDigits(c.value)}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{c.label}</div>
            </div>
          ))}
        </div>

        {/* شريط المواعيد */}
        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {r.dueCount > 0
                ? <>أنجزت <span className="font-bold text-foreground">{toArabicDigits(r.fulfilled)}</span> من <span className="font-bold text-foreground">{toArabicDigits(r.dueCount)}</span> {r.dueCount === 1 ? "موعد" : "مواعيد"}</>
                : "ما فيه مواعيد مستحقة في الفترة"}
            </span>
            {r.dueCount > 0 && <span className="font-bold text-gold">{toArabicDigits(duePct)}٪</span>}
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-secondary">
            <div className={`h-full rounded-full transition-all ${duePct === 100 ? "bg-success" : "bg-gold"}`} style={{ width: `${Math.max(r.dueCount > 0 ? 3 : 0, duePct)}%` }} />
          </div>
        </div>

        <p className="rounded-xl bg-gold/5 px-3 py-2 text-sm font-medium text-gold">{motivation}</p>
      </section>

      {/* الخط الزمني */}
      {log.days.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">ما فيه نشاط في هذه الفترة.</p>
      ) : (
        <div className="space-y-5">
          {log.days.map((d) => (
            <section key={d.key}>
              <h2 className="mb-2 text-sm font-bold text-foreground">{d.label}</h2>
              <div className="space-y-1.5">
                {d.events.map((e, i) => (
                  <div key={`${d.key}-${i}`} className="flex items-center gap-3 rounded-xl border border-border bg-card/60 px-3 py-2.5 text-sm">
                    <span className="shrink-0 text-base">{e.icon}</span>
                    <span className="min-w-0 flex-1 truncate text-foreground">
                      {e.text}
                      {e.leadId && (
                        <> · <Link href={`/leads/${e.leadId}`} className="font-medium text-gold hover:underline">{e.leadName}</Link></>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground" dir="ltr">{timeLabel(e.at)}</span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* ترقيم للأقدم */}
      {(log.hasMore || log.page > 1) && (
        <div className="flex items-center justify-between text-sm">
          {log.page > 1
            ? <Link href={href(log.period, log.page - 1)} className="rounded-lg border border-border px-3 py-1.5 text-muted-foreground hover:text-foreground">→ الأحدث</Link>
            : <span />}
          {log.hasMore && (
            <Link href={href(log.period, log.page + 1)} className="rounded-lg border border-border px-3 py-1.5 text-muted-foreground hover:text-foreground">عرض الأقدم ←</Link>
          )}
        </div>
      )}

      <p className="text-center text-[11px] text-muted-foreground">رخصة فال {toArabicDigits(1200021029)}</p>
    </div>
  );
}
