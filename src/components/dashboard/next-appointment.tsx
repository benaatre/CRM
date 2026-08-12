"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Phone, MessageCircle, ChevronLeft, Check, AlignLeft, Clock, Building2, MapPin } from "lucide-react";
import type { TodayAppointment } from "@/lib/data/dashboard";
import { stageLabels } from "@/lib/labels";
import { waPhone } from "@/lib/value-normalize";
import { formatTime, formatDateTime, toArabicDigits } from "@/lib/format";

/**
 * بطاقة «موعدك القادم» — العنصر الفعّال الوحيد في الشاشة (ولذلك وحده يحمل الذهبي).
 * client لسببين فقط: حلقة العدّ التنازلي ومؤقّتها (بتنظيف كامل). البيانات كلها props.
 *
 * الحلقة تمتلئ كلما اقترب الموعد ضمن نافذة ساعة، وتحترم prefers-reduced-motion
 * (الانتقال يُلغى فتقفز للقيمة). لا حركة متكررة بلا سبب.
 */

const MIN = 60_000;
const WINDOW_MS = 60 * MIN; // نافذة العدّ: آخر ساعة قبل الموعد

/** «٢١ دقيقة» / «بعد ساعتين» / «فات من ٥ دقائق» — نص الحالة بجانب اللون (وصولية). */
function statusOf(diffMs: number): { label: string; sub: string; late: boolean } {
  const mins = Math.round(Math.abs(diffMs) / MIN);
  if (diffMs < 0) {
    if (mins < 60) return { label: toArabicDigits(mins), sub: "دقيقة تأخير", late: true };
    const h = Math.round(mins / 60);
    return { label: toArabicDigits(h), sub: h === 1 ? "ساعة تأخير" : "ساعات تأخير", late: true };
  }
  if (mins < 60) return { label: toArabicDigits(Math.max(1, mins)), sub: "دقيقة", late: false };
  const h = Math.round(mins / 60);
  return { label: toArabicDigits(h), sub: h === 1 ? "ساعة" : "ساعات", late: false };
}

export function NextAppointment({ appt, zainClass }: { appt: TodayAppointment; zainClass: string }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const at = new Date(appt.at);
  const diff = at.getTime() - nowMs;
  const st = statusOf(diff);
  // نسبة الامتلاء: صفر خارج النافذة، وتزيد كلما اقترب الموعد؛ الفائت ممتلئ.
  const pct = diff <= 0 ? 100 : Math.max(0, Math.min(100, Math.round((1 - diff / WINDOW_MS) * 100)));
  // نصف القطر لحلقة ٧٢px بسماكة ٤ (الأقصى ٣٤ — ٣١ يترك هامشًا داخليًا للرقم).
  const R = 31;
  const C = 2 * Math.PI * R;
  const tone = st.late ? "text-destructive" : "text-gold";
  const isVisit = appt.kind === "visit";

  return (
    <section className="rounded-3xl bg-card p-7">
      {/*
        العنوان يتبع الحالة الفعلية لا الاسم الثابت: الموعد الذي مضى وقته يُسمّى
        «موعد متأخر» بالأحمر (مع الحلقة الحمراء)، وغير الفائت «موعدك القادم» بالذهبي.
      */}
      <div className="flex items-center gap-2 text-[12.5px] font-medium">
        <span className={st.late ? "font-semibold text-destructive" : "font-semibold text-gold"}>
          {st.late ? "موعد متأخر" : "موعدك القادم"}
        </span>
        <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12.5px] font-semibold ${isVisit ? "bg-warning/10 text-warning" : "bg-info/10 text-info"}`}>
          {isVisit ? <Building2 className="size-[13px]" strokeWidth={1.6} /> : <Phone className="size-[13px]" strokeWidth={1.6} />}
          {isVisit ? "زيارة مشروع" : "متابعة اتصال"}
        </span>
      </div>
      {st.late && (
        <p className="mt-1.5 text-[13.5px] text-destructive">فات موعده — تواصل الآن</p>
      )}

      {/* البطل: الوقت + العميل + حلقة العدّ */}
      <div className="mt-5 flex flex-wrap items-center gap-6">
        <div className="flex items-baseline gap-2">
          <span className={`${zainClass} text-[52px] font-extrabold leading-none tracking-tight text-foreground`} style={{ fontVariantNumeric: "tabular-nums" }}>
            {formatTime(at).replace(/\s*[صم]$/, "")}
          </span>
          <span className="text-[13.5px] text-muted-foreground">{/\sص$/.test(formatTime(at)) ? "صباحًا" : "مساءً"}</span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-[26px] font-semibold leading-tight tracking-tight text-foreground">{appt.name}</div>
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13.5px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5" dir="ltr">
              <Phone className="size-[15px]" strokeWidth={1.6} />{appt.phone}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-[15px]" strokeWidth={1.6} />{stageLabels[appt.stage]}
            </span>
            {appt.projectName && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-[15px]" strokeWidth={1.6} />{appt.projectName}
              </span>
            )}
          </div>
        </div>

        {/*
          الحلقة: الرقم وحده داخلها بمقاس مقروء، ونص الوحدة **تحتها** لا بداخلها —
          كان النصان محشورين في ٥٤px فيتجاوز النص الحلقة ويصير غير مقروء.
          نبضة تلاشٍ على الرقم عند التأخير فقط (motion-safe تحترم تقليل الحركة).
        */}
        <div className="flex shrink-0 flex-col items-center gap-2">
          <div className="relative grid size-[72px] place-items-center">
            <svg width="72" height="72" className="-rotate-90" aria-hidden>
              <circle cx="36" cy="36" r={R} fill="none" strokeWidth="4" className="stroke-secondary" />
              <circle
                cx="36" cy="36" r={R} fill="none" strokeWidth="4" strokeLinecap="round"
                className={st.late ? "stroke-destructive" : "stroke-gold"}
                strokeDasharray={C}
                strokeDashoffset={C * (1 - pct / 100)}
                style={{ transition: "stroke-dashoffset 1s cubic-bezier(.32,.72,0,1)" }}
              />
            </svg>
            <b
              className={`absolute ${zainClass} text-[27px] font-extrabold leading-none ${tone} ${st.late ? "motion-safe:animate-pulse" : ""}`}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {st.label}
            </b>
          </div>
          <span className={`whitespace-nowrap text-center text-[11.5px] font-medium ${st.late ? "text-destructive" : "text-muted-foreground"}`}>
            {st.sub}
          </span>
        </div>
      </div>

      {/* آخر ملاحظة — تغني عن فتح الملف قبل الاتصال */}
      {appt.lastNote && (
        <div className="mt-6 rounded-2xl bg-secondary/40 p-5">
          <div className="flex items-center gap-2 text-[12.5px] font-medium text-muted-foreground">
            <AlignLeft className="size-[15px]" strokeWidth={1.6} />
            ملاحظتك من آخر متابعة
          </div>
          <p className="mt-2.5 text-[14.5px] leading-7 text-foreground">{appt.lastNote.text}</p>
          <div className="mt-2 text-[12.5px] text-muted-foreground/80">{formatDateTime(appt.lastNote.at)}</div>
        </div>
      )}

      {/* الأفعال */}
      <div className="mt-6 flex flex-wrap items-center gap-2.5">
        {/*
          الفعل الرئيسي بلون accent الذهبي (‎.btn.call = var(--accent) في التصميم المعتمد).
          الأزرق دلالة **وسم** نوع الموعد (شريحة «متابعة اتصال») لا لون زر رئيسي.
        */}
        <a
          href={`tel:${appt.phone}`}
          className="inline-flex h-12 items-center gap-2 rounded-2xl bg-gold px-6 text-[14.5px] font-semibold text-background transition-opacity hover:opacity-90"
        >
          <Phone className="size-[17px]" strokeWidth={1.6} /> اتصال
        </a>
        <a
          href={`https://wa.me/${waPhone(appt.phone)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-12 items-center gap-2 rounded-2xl bg-success/15 px-6 text-[14.5px] font-semibold text-success transition-colors hover:bg-success/25"
        >
          <MessageCircle className="size-[17px]" strokeWidth={1.6} /> واتساب
        </a>
        <Link
          href={`/leads/${appt.leadId}`}
          aria-label={`ملف العميل ${appt.name}`}
          className="inline-flex size-12 items-center justify-center rounded-2xl bg-secondary/60 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-[17px]" strokeWidth={1.6} />
        </Link>
        {/* ثانوي مخطّط (‎.btn.done في التصميم) — الذهبي محجوز لعنصر واحد هو زر الاتصال */}
        <Link
          href={`/leads/${appt.leadId}`}
          className="inline-flex h-12 items-center gap-2 rounded-2xl border border-dashed border-success/35 px-6 text-[14.5px] font-semibold text-success transition-colors hover:bg-success/10 ms-auto"
        >
          <Check className="size-[17px]" strokeWidth={1.6} /> سجّل النتيجة
        </Link>
      </div>
    </section>
  );
}

export default NextAppointment;
