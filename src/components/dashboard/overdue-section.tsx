import Link from "next/link";
import { Phone, MessageCircle, ChevronLeft, MapPin } from "lucide-react";
import type { MyOverdue, OverdueBucket } from "@/lib/data/my-overdue";
import { OVERDUE_BUCKETS } from "@/lib/data/my-overdue";
import { stageLabels } from "@/lib/labels";
import { waPhone } from "@/lib/value-normalize";
import { toArabicDigits } from "@/lib/format";

/**
 * «متأخرة عن موعدها» — صفوف كاملة بأزرار ظاهرة دائمًا + فلاتر مدة بعدّادات حقيقية.
 *
 * العدّادات والصفوف من `getMyOverdue` (نطاق الموظف وحده)، والفلتر عبر بارامتر
 * الرابط `?late=` فيُجلب فعليًا من الخادم — لا فلترة صفوف محمّلة مسبقًا.
 */

const NUM = { fontVariantNumeric: "tabular-nums" as const };

/** رابط الشريحة مع الحفاظ على فلتر الفترة (?period=) القائم. */
function chipHref(bucket: OverdueBucket, period?: string): string {
  const qp = new URLSearchParams();
  if (bucket !== "all") qp.set("late", bucket);
  if (period) qp.set("period", period);
  const qs = qp.toString();
  return qs ? `/dashboard?${qs}` : "/dashboard";
}

export function OverdueSection({ data, period, zainClass }: {
  data: MyOverdue;
  period?: string;
  zainClass: string;
}) {
  const { counts, rows, total, bucket } = data;
  if (counts.all === 0) return null;

  return (
    <section className="rounded-3xl bg-card p-7">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-[16px] font-semibold text-foreground">متأخرة عن موعدها</h3>
        <span className="text-[12.5px] text-muted-foreground">فات موعدها قبل اليوم — الأقدم أولًا</span>
      </div>
      {/* الموظف يسأل: وين متأخرات اليوم؟ — الجواب فوق لا هنا */}
      <p className="mt-1.5 text-[12px] text-muted-foreground/70">متأخرات اليوم في قسم متابعات اليوم فوق</p>

      {/* فلاتر المدة — كل واحدة بعدّادها الحقيقي */}
      <div className="mt-4 flex flex-wrap gap-2">
        {OVERDUE_BUCKETS.map((b) => {
          const on = b.key === bucket;
          const n = counts[b.key];
          return (
            <Link
              key={b.key}
              href={chipHref(b.key, period)}
              scroll={false}
              aria-current={on}
              className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-[12.5px] font-semibold transition-colors ${
                on ? "bg-gold text-background" : "bg-secondary/60 text-muted-foreground hover:text-foreground"
              }`}
            >
              {b.label}
              <span className={on ? "opacity-80" : "opacity-60"} style={NUM}>{toArabicDigits(n)}</span>
            </Link>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <p className="mt-6 text-[13.5px] text-muted-foreground">ما فيه متأخرات في هالفترة.</p>
      ) : (
        <>
          <div className="mt-4 divide-y divide-white/[.055]">
            {rows.map((l) => {
              const urgent = l.daysLate > 7; // يحمرّ بعد أسبوع فقط
              return (
                <div key={l.id} className="flex items-center gap-4 py-[18px]">
                  <div className="grid w-14 shrink-0 place-items-center text-center leading-none">
                    {l.daysLate === 1 ? (
                      <span className={`text-[13.5px] font-semibold ${urgent ? "text-destructive" : "text-foreground"}`}>أمس</span>
                    ) : (
                      <>
                        <b className={`${zainClass} text-[20px] font-extrabold ${urgent ? "text-destructive" : "text-foreground"}`} style={NUM}>
                          {toArabicDigits(l.daysLate)}
                        </b>
                        <span className="mt-1 text-[11.5px] text-muted-foreground">يوم تأخير</span>
                      </>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/leads/${l.id}`} className="text-[16px] font-semibold text-foreground transition-colors hover:text-gold">{l.name}</Link>
                      <span className="inline-flex items-center rounded-lg bg-secondary/60 px-2.5 py-1 text-[11.5px] font-semibold text-muted-foreground">
                        {stageLabels[l.stage]}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13.5px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5" dir="ltr"><Phone className="size-[14px]" strokeWidth={1.6} />{l.phone}</span>
                      {/* المشروع غير المحدَّد يُخفى سطره — لا «—» ولا نص بديل */}
                      {l.projectName && (
                        <span className="inline-flex items-center gap-1.5"><MapPin className="size-[14px]" strokeWidth={1.6} />{l.projectName}</span>
                      )}
                    </div>
                  </div>

                  {/* عاجلة — الأزرار ظاهرة دائمًا */}
                  <div className="flex shrink-0 items-center gap-1.5">
                    <a
                      href={`tel:${l.phone}`}
                      aria-label={`اتصال بـ${l.name}`}
                      className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-gold px-3.5 text-[12.5px] font-semibold text-background transition-opacity hover:opacity-90"
                    >
                      <Phone className="size-[14px]" strokeWidth={1.6} /> اتصال
                    </a>
                    <a
                      href={`https://wa.me/${waPhone(l.phone)}`}
                      target="_blank" rel="noopener noreferrer"
                      aria-label={`واتساب ${l.name}`}
                      className="grid size-10 place-items-center rounded-xl bg-success/15 text-success transition-colors hover:bg-success/25"
                    >
                      <MessageCircle className="size-[14px]" strokeWidth={1.6} />
                    </a>
                    <Link
                      href={`/leads/${l.id}`}
                      aria-label={`ملف العميل ${l.name}`}
                      className="grid size-10 place-items-center rounded-xl bg-secondary/60 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <ChevronLeft className="size-[14px]" strokeWidth={1.6} />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>

          {total > rows.length && (
            <Link
              href="/leads?stages=NEW,ATTEMPTED,INTERESTED,FOLLOW_UP_LATER&sort=oldest"
              className="mt-4 inline-flex items-center gap-1 text-[13.5px] font-semibold text-gold transition-opacity hover:opacity-80"
            >
              عرض الـ{toArabicDigits(total)} كاملين <ChevronLeft className="size-4" strokeWidth={1.6} />
            </Link>
          )}
        </>
      )}
    </section>
  );
}

export default OverdueSection;
