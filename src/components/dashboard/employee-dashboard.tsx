import Link from "next/link";
import { Zain } from "next/font/google";
import {
  Phone, MessageCircle, ChevronLeft, AlertTriangle, Users, Building2,
  ClipboardList, Check, TrendingUp, Clock,
} from "lucide-react";
import type { DashboardData, TodayAppointment } from "@/lib/data/dashboard";
import type { MyNoResponseAlert } from "@/lib/data/no-response";
import type { MyRank } from "@/lib/data/leaderboard";
import type { MyOverdue } from "@/lib/data/my-overdue";
import type { MyRecentFollowUp } from "@/lib/data/my-log";
import { stageLabels } from "@/lib/labels";
import { STAGE_HEX } from "@/lib/stage-colors";
import { INTEREST_UMBRELLA } from "@/lib/lead-filters";
import { waPhone } from "@/lib/value-normalize";
import { toArabicDigits } from "@/lib/format";
import { DAY_MS } from "@/lib/ksa-time";
import { NextAppointment } from "./next-appointment";
import { TodayFollowups } from "./today-followups";
import { OverdueSection } from "./overdue-section";
import { InterestedRiver, type RiverLead } from "./interested-river";

/**
 * داشبورد الموظف (المتصفح) — دليل التصميم ٢٠٢٦:
 * أيقونات SVG خطية (lucide بـstroke 1.6) · صفر إيموجي · الذهبي لعنصر واحد فقط
 * (بطاقة «موعدك القادم») · بلا حدود حول العناصر — الفصل بالمسافة واختلاف السطح.
 *
 * عرض خالص: كل الأرقام من getDashboard/getMyRank/getMyNoResponseAlert القائمة،
 * والتقسيم الزمني بيوم الرياض (ksa-time) لا بيوم الخادم.
 */

// خط الأرقام العرضية — يُحمَّل هنا وحده فلا يمسّ تخطيط الويب المشترك.
const zain = Zain({ subsets: ["arabic"], weight: ["700", "800"], display: "swap" });

const NUM = { fontVariantNumeric: "tabular-nums" as const };

export function EmployeeDashboard({
  data, alert, myRank, firstName, overdue, openAppts, doneToday, interested, period,
}: {
  data: DashboardData;
  alert: MyNoResponseAlert;
  myRank: MyRank | null;
  firstName: string;
  /** متأخرات ما قبل اليوم — عدّاداتها وصفوفها من getMyOverdue (نطاق الموظف). */
  overdue: MyOverdue;
  /** مواعيد اليوم بعد استبعاد من سُجّلت نتيجته (منع التكرار على الخادم). */
  openAppts: TodayAppointment[];
  /** منجزات اليوم من سجل الموظف. */
  doneToday: MyRecentFollowUp[];
  /** عملاء مظلة «مهتم» — النهر الحي (الأنشط أولًا من فرز activity). */
  interested: RiverLead[];
  period?: string;
}) {
  const k = data.kpis;
  // «موعدك القادم» = أقرب موعد مفتوح (الفائت يظهر بعنوانه الأحمر داخل البطاقة).
  const next = openAppts[0];

  const stats = [
    { k: "عملائي", v: k.totalClients, u: `${toArabicDigits(data.waitingCount)} ينتظرون أول تواصل`, Icon: Users },
    { k: "زياراتي", v: k.visits, u: "ضمن الفترة", Icon: Building2 },
    { k: "حجوزاتي", v: k.bookings, u: "ضمن الفترة", Icon: ClipboardList },
    { k: "صفقاتي المقفولة", v: k.closedWon, u: "ضمن الفترة", Icon: Check },
  ];

  return (
    <div className="space-y-8">
      {/* ===== تنبيه «لم يتم الرد» — يظهر فقط عند وجود متأخرين ===== */}
      {(alert.warningCount > 0 || alert.pulled > 0) && (
        <section className="flex flex-wrap items-center gap-4 rounded-3xl bg-destructive/[0.07] p-6">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-destructive/15 text-destructive">
            <AlertTriangle className="size-5" strokeWidth={1.6} />
          </span>
          <div className="min-w-0 flex-1">
            {alert.warningCount > 0 && (
              <div className="text-[16.5px] font-semibold text-foreground">
                <b className={`${zain.className} ms-1 text-[19px] font-extrabold text-destructive`} style={NUM}>
                  {toArabicDigits(alert.warningCount)}
                </b>{" "}
                عملاء ينتظرون ردّك
              </div>
            )}
            <div className="mt-1 text-[13.5px] leading-6 text-muted-foreground">
              {alert.warningCount > 0 && (
                <>
                  إذا ما تواصلت معهم يرجعون للتوزيع التلقائي
                  {alert.warningMinHoursLeft != null && (
                    <> خلال <b className="font-semibold text-destructive" style={NUM}>{toArabicDigits(alert.warningMinHoursLeft)} ساعة</b></>
                  )}
                  .
                </>
              )}
              {alert.pulled > 0 && (
                <div>سُحب منك <b className="font-semibold text-destructive" style={NUM}>{toArabicDigits(alert.pulled)}</b> عملاء لعدم التواصل خلال آخر أسبوع.</div>
              )}
            </div>
          </div>
          <Link
            href="/leads?stages=NEW,ATTEMPTED&sort=oldest"
            className="inline-flex h-12 shrink-0 items-center gap-2 rounded-2xl bg-destructive px-6 text-[14.5px] font-semibold text-background transition-opacity hover:opacity-90"
          >
            <Phone className="size-[17px]" strokeWidth={1.6} /> شوفهم
          </Link>
        </section>
      )}

      {/* ===== يومك ===== */}
      <SecTitle title="يومك" sub={`المواعيد والعملاء اللي ينتظرونك — هلا ${firstName}`} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        {/* يمين: العمل */}
        <div className="min-w-0 space-y-6">
          {next ? (
            <NextAppointment appt={next} zainClass={zain.className} />
          ) : (
            <section className="rounded-3xl bg-card p-7">
              <div className="flex items-center gap-2 text-[12.5px] font-medium text-muted-foreground">موعدك القادم</div>
              <p className="mt-4 text-[16px] font-semibold text-foreground">ما عندك مواعيد اليوم</p>
              <p className="mt-1.5 text-[13.5px] text-muted-foreground">وقتك فاضي للعملاء اللي ينتظرون أول تواصل تحت.</p>
            </section>
          )}

          {/* متابعات اليوم بثلاث حالات: فاتت ← قادمة (البكرة) ← منجزة */}
          <TodayFollowups appts={openAppts} done={doneToday} zainClass={zain.className} />

          {/* متأخرة عن موعدها — صفوف كاملة بفلاتر مدة بعدّادات حقيقية */}
          <OverdueSection data={overdue} period={period} zainClass={zain.className} />

        </div>

        {/* يسار: الأرقام */}
        <div className="min-w-0 space-y-6">
          {/* تحويل الزيارات إلى حجوزات (الحجوزات ÷ الزيارات) */}
          <section className="rounded-3xl bg-card p-7">
            <div className="text-[12.5px] font-medium text-muted-foreground">تحويل الزيارات إلى حجوزات</div>
            <div className="mt-3 flex items-end gap-3">
              <div className={`${zain.className} text-[46px] font-extrabold leading-none tracking-tight text-foreground`} style={NUM}>
                {toArabicDigits(k.conversion)}<sup className="text-[20px]">٪</sup>
              </div>
              <div className="mb-1.5 inline-flex items-center gap-1 text-[12.5px] text-muted-foreground">
                <TrendingUp className="size-4" strokeWidth={1.6} /> حجوزات ÷ زيارات
              </div>
            </div>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-gold" style={{ width: `${Math.min(k.conversion, 100)}%` }} />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-muted-foreground">
              <span style={NUM}>حجزت {toArabicDigits(k.bookings)}</span>
              <span style={NUM}>من {toArabicDigits(k.visits)} زيارة</span>
            </div>
          </section>

          {/* أرقامك */}
          <div className="grid grid-cols-2 gap-4">
            {stats.map((s) => (
              <div key={s.k} className="rounded-3xl bg-card p-6">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[12.5px] font-medium text-muted-foreground">{s.k}</span>
                  <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-secondary/60 text-muted-foreground">
                    <s.Icon className="size-[15px]" strokeWidth={1.6} />
                  </span>
                </div>
                <div className={`${zain.className} mt-3 text-[34px] font-extrabold leading-none ${s.v === 0 ? "text-muted-foreground/60" : "text-foreground"}`} style={NUM}>
                  {toArabicDigits(s.v)}
                </div>
                <div className="mt-2 text-[12.5px] text-muted-foreground">{s.u}</div>
              </div>
            ))}
          </div>

          {/* ترتيبك */}
          {myRank?.ranked && (
            <Link href="/leaderboard" className="block rounded-3xl bg-card p-7 transition-colors hover:bg-card/70">
              <div className="flex items-center gap-4">
                <span className={`${zain.className} grid size-11 shrink-0 place-items-center rounded-2xl bg-secondary/60 text-[19px] font-extrabold text-foreground`} style={NUM}>
                  {toArabicDigits(myRank.rank)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[16px] font-semibold text-foreground">ترتيبك هالأسبوع</div>
                  <div className="mt-1 text-[13.5px] text-muted-foreground">
                    {myRank.gapToNext
                      ? `تحتاج ${toArabicDigits(myRank.gapToNext.pts)} درجة تعدّي ${myRank.gapToNext.name}`
                      : "أنت الأول — حافظ على الصدارة"}
                  </div>
                </div>
                <div className="shrink-0 text-center leading-none">
                  <b className={`${zain.className} text-[22px] font-extrabold text-foreground`} style={NUM}>{toArabicDigits(myRank.score)}</b>
                  <span className="mt-1 block text-[11.5px] text-muted-foreground">درجة</span>
                </div>
                <ChevronLeft className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.6} />
              </div>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-gold"
                  style={{ width: `${myRank.total > 0 ? Math.round(((myRank.total - myRank.rank + 1) / myRank.total) * 100) : 0}%` }}
                />
              </div>
            </Link>
          )}

          {/* قمع عملائي */}
          <section className="rounded-3xl bg-card p-7">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-[16px] font-semibold text-foreground">قمع عملائي</h3>
              <Link href="/analytics" className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground">
                التحليلات <ChevronLeft className="size-3.5" strokeWidth={1.6} />
              </Link>
            </div>
            <div className="mt-4 space-y-2">
              {(() => {
                const max = Math.max(...data.funnel.map((f) => f.count), 1);
                return data.funnel.map((f) => (
                  <div key={f.stage} className="flex items-center gap-3">
                    <span className="w-[86px] shrink-0 truncate text-[12.5px] text-muted-foreground">{stageLabels[f.stage]}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${f.count > 0 ? Math.max((f.count / max) * 100, 3) : 0}%`, background: STAGE_HEX[f.stage] }}
                      />
                    </div>
                    <span className={`w-9 shrink-0 text-left text-[12.5px] font-semibold ${f.count === 0 ? "text-muted-foreground/60" : "text-foreground"}`} style={NUM}>
                      {toArabicDigits(f.count)}
                    </span>
                  </div>
                ));
              })()}
            </div>
          </section>

          {/* ينتظرون أول تواصل */}
          <section className="rounded-3xl bg-card p-7">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-[16px] font-semibold text-foreground">
                  <b className={`${zain.className} me-1.5 text-[22px] font-extrabold text-foreground`} style={NUM}>
                    {toArabicDigits(data.waitingCount)}
                  </b>
                  عميل ينتظرون أول تواصل
                </div>
                <p className="mt-1.5 text-[13.5px] text-muted-foreground">الأقدم أولًا — سرعة الرد ترفع فرصة التحويل</p>
              </div>
              <Link href="/leads?stages=NEW&sort=oldest" className="inline-flex items-center gap-1 text-[13.5px] font-medium text-muted-foreground transition-colors hover:text-foreground">
                عرض الكل <ChevronLeft className="size-4" strokeWidth={1.6} />
              </Link>
            </div>

            {data.waitingFirstContact.length === 0 ? (
              <p className="mt-6 text-[13.5px] text-muted-foreground">ما فيه عملاء ينتظرون أول تواصل.</p>
            ) : (
              <div className="mt-4 divide-y divide-white/[.055]">
                {data.waitingFirstContact.map((l) => {
                  const days = l.createdAt ? Math.max(0, Math.floor((Date.now() - l.createdAt.getTime()) / DAY_MS)) : null;
                  const urgent = days != null && days >= 7;
                  return (
                    <div key={l.id} className="group flex items-center gap-4 py-[18px]">
                      <div className="grid w-12 shrink-0 place-items-center text-center leading-none">
                        <b className={`${zain.className} text-[20px] font-extrabold ${urgent ? "text-destructive" : "text-foreground"}`} style={NUM}>
                          {days != null ? toArabicDigits(days) : "—"}
                        </b>
                        <span className="mt-1 text-[11.5px] text-muted-foreground">يوم</span>
                      </div>
                      {/* العمود أضيق بعد النقل — الاسم يُقتطع والسطر الثانوي يلتف */}
                      <div className="min-w-0 flex-1">
                        <Link href={`/leads/${l.id}`} className="block truncate text-[15.5px] font-semibold text-foreground transition-colors hover:text-gold">{l.name}</Link>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted-foreground">
                          <span className="inline-flex items-center gap-1.5" dir="ltr"><Phone className="size-[13px]" strokeWidth={1.6} />{l.phone}</span>
                          <span className="inline-flex items-center gap-1.5"><Clock className="size-[13px]" strokeWidth={1.6} />{stageLabels[l.stage]}</span>
                        </div>
                      </div>
                      <RowActions phone={l.phone} leadId={l.id} name={l.name} />
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* عملاء مهتمون — النهر الحي، مباشرة تحت «ينتظرون أول تواصل» */}
          <InterestedRiver
            leads={interested}
            umbrellaHref={`/leads?stages=${INTEREST_UMBRELLA.join(",")}&sort=activity`}
            zainClass={zain.className}
          />
        </div>
      </div>

      {/* ===== أين وصل عملاؤك ===== */}
      <SecTitle title="أين وصل عملاؤك" sub="المهتمون مقابل من خرجوا من خط البيع" href="/analytics" />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-3xl bg-card p-7">
          <h3 className="text-[16px] font-semibold text-foreground">مهتمون</h3>
          <p className="mt-1 text-[13.5px] text-muted-foreground">العملاء المهتمون فعليًا في خط البيع</p>
          <div className="mt-5 flex items-baseline gap-2">
            <b className={`${zain.className} text-[46px] font-extrabold leading-none tracking-tight text-success`} style={NUM}>
              {toArabicDigits(data.sentiment.interested.total)}
            </b>
            <span className="text-[13.5px] text-muted-foreground">عميل مهتم</span>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-5">
            {[
              { l: "مهتم", v: data.sentiment.interested.interested },
              { l: "موعد زيارة", v: data.sentiment.interested.visitScheduled },
              { l: "زار مشروع", v: data.sentiment.interested.viewed },
              { l: "تفاوض", v: data.sentiment.interested.negotiating },
              { l: "موعد لاحق", v: data.sentiment.interested.followUpLater },
            ].map((c) => (
              <div key={c.l} className="rounded-2xl bg-secondary/40 py-3 text-center">
                <b className={`${zain.className} block text-[19px] font-extrabold ${c.v === 0 ? "text-muted-foreground/60" : "text-foreground"}`} style={NUM}>
                  {toArabicDigits(c.v)}
                </b>
                <span className="mt-1 block text-[11.5px] text-muted-foreground">{c.l}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-3xl bg-card p-7">
          <h3 className="text-[16px] font-semibold text-foreground">غير مهتمين</h3>
          <p className="mt-1 text-[13.5px] text-muted-foreground">انسحبوا أو ما ناسبهم</p>
          <div className="mt-5 flex items-baseline gap-2">
            <b className={`${zain.className} text-[46px] font-extrabold leading-none tracking-tight text-destructive`} style={NUM}>
              {toArabicDigits(data.sentiment.notInterested.total)}
            </b>
            <span className="text-[13.5px] text-muted-foreground">عميل</span>
          </div>
          {(() => {
            const r = data.sentiment.notInterested.reasons;
            const chips = [
              { l: "الموقع", v: r.location }, { l: "السعر", v: r.price }, { l: "المساحة", v: r.space },
              { l: "زار وما ناسبه", v: r.visited }, { l: "حسبة البنك", v: r.bank }, { l: "مسوّق", v: r.marketer },
              { l: "أخرى", v: r.other }, { l: "نهائي", v: r.final }, { l: "غير محدّد", v: r.unspecified },
            ].filter((c) => c.v > 0);
            return chips.length === 0 ? (
              <p className="mt-5 text-[13.5px] text-muted-foreground">ما تسجّل سبب بعد.</p>
            ) : (
              <div className="mt-5 flex flex-wrap gap-2">
                {chips.map((c) => (
                  <span key={c.l} className="inline-flex items-center gap-2 rounded-xl bg-secondary/40 px-3.5 py-2 text-[12.5px] text-muted-foreground">
                    {c.l} <b className="font-semibold text-foreground" style={NUM}>{toArabicDigits(c.v)}</b>
                  </span>
                ))}
              </div>
            );
          })()}
        </section>
      </div>
    </div>
  );
}

/** عنوان قسم — شعرة ذهبية رفيعة + عنوان + وصف (بلا حدود ولا خلفية). */
function SecTitle({ title, sub, href }: { title: string; sub: string; href?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span aria-hidden className="h-5 w-[3px] shrink-0 rounded-full bg-gold" />
      <h2 className="text-[19px] font-semibold tracking-tight text-foreground">{title}</h2>
      <span className="text-[13.5px] text-muted-foreground">{sub}</span>
      {href && (
        <Link href={href} className="ms-auto inline-flex items-center gap-1 text-[13.5px] text-muted-foreground transition-colors hover:text-foreground">
          التحليلات <ChevronLeft className="size-4" strokeWidth={1.6} />
        </Link>
      )}
    </div>
  );
}

/**
 * أزرار الصف — تظهر عند المرور افتراضيًا (الشاشة ساكنة حتى تُحتاج).
 * `always`: ظاهرة دائمًا (الصفوف العاجلة كالمتأخرات) · `gold`: زر الاتصال بلون accent.
 */
function RowActions({ phone, leadId, name, primary, always, gold }: {
  phone: string; leadId: string; name: string; primary?: string; always?: boolean; gold?: boolean;
}) {
  const reveal = always
    ? ""
    : "md:translate-x-1.5 md:opacity-0 md:transition-all md:group-hover:translate-x-0 md:group-hover:opacity-100 md:group-focus-within:translate-x-0 md:group-focus-within:opacity-100";
  return (
    <div className={`flex shrink-0 items-center gap-1.5 opacity-100 transition-opacity ${reveal}`}>
      <a
        href={`tel:${phone}`}
        aria-label={`اتصال بـ${name}`}
        className={`inline-flex h-10 items-center gap-1.5 rounded-xl px-3.5 text-[12.5px] font-semibold transition-colors ${
          gold ? "bg-gold text-background hover:opacity-90" : "bg-info/15 text-info hover:bg-info/25"
        }`}
      >
        <Phone className="size-[14px]" strokeWidth={1.6} />{primary ?? "اتصال"}
      </a>
      <a
        href={`https://wa.me/${waPhone(phone)}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`واتساب ${name}`}
        className="grid size-10 place-items-center rounded-xl bg-success/15 text-success transition-colors hover:bg-success/25"
      >
        <MessageCircle className="size-[14px]" strokeWidth={1.6} />
      </a>
      <Link
        href={`/leads/${leadId}`}
        aria-label={`ملف العميل ${name}`}
        className="grid size-10 place-items-center rounded-xl bg-secondary/60 text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-[14px]" strokeWidth={1.6} />
      </Link>
    </div>
  );
}

export default EmployeeDashboard;
