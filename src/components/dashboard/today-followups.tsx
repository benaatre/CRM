"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Phone, MessageCircle, ChevronLeft, Check, AlertTriangle, MapPin } from "lucide-react";
import type { TodayAppointment } from "@/lib/data/dashboard";
import type { MyRecentFollowUp } from "@/lib/data/my-log";
import { stageLabels, followUpResultLabels } from "@/lib/labels";
import { waPhone } from "@/lib/value-normalize";
import { formatTime, toArabicDigits } from "@/lib/format";
import { DAY_MS } from "@/lib/ksa-time";
import { FollowUpsDrawer } from "@/components/leads/followups-drawer";
import { FollowupsReel } from "./followups-reel";

/**
 * «متابعات اليوم» بثلاث حالات مرتّبة بالإلحاح: فاتت ← قادمة ← منجزة.
 *
 * المصادر (كلها قائمة): الفائتة والقادمة من `todayAppointments`، والمنجزة من
 * `getMyRecentFollowups` مفلترة بيوم الرياض. الخادم يستبعد من المواعيد كل عميل
 * ظهر في منجزات اليوم (مطابقة بمعرّف العميل) فلا يتكرر الصف بين قسمين.
 *
 * زر ✓ يفتح **ورقة تسجيل النتيجة القائمة** (FollowUpsDrawer → FollowUpsForm)،
 * وبعد الحفظ يُحدَّث الخادم فينتقل الصف لقسم «منجزة» وتتحدّث العدّادات والشريط.
 */

const NUM = { fontVariantNumeric: "tabular-nums" as const };

/** «فات موعده من X» — دقائق ثم ساعات ثم أيام. */
function lateLabel(ms: number): string {
  const mins = Math.max(1, Math.floor(ms / 60_000));
  if (mins < 60) return `${toArabicDigits(mins)} ${mins <= 10 ? "دقائق" : "دقيقة"}`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 24) return hours === 1 ? "ساعة" : hours === 2 ? "ساعتين" : `${toArabicDigits(hours)} ${hours <= 10 ? "ساعات" : "ساعة"}`;
  const days = Math.floor(ms / DAY_MS);
  return days === 1 ? "يوم" : days === 2 ? "يومين" : `${toArabicDigits(days)} ${days <= 10 ? "أيام" : "يومًا"}`;
}

type Target = { leadId: string; name: string; stage: TodayAppointment["stage"] } | null;

export function TodayFollowups({ appts, done, zainClass }: {
  /** مواعيد اليوم (بعد استبعاد من سُجّلت نتيجته) — الفائتة والقادمة معًا. */
  appts: TodayAppointment[];
  /** منجزات اليوم من سجل الموظف. */
  done: MyRecentFollowUp[];
  zainClass: string;
}) {
  const router = useRouter();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [target, setTarget] = useState<Target>(null);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const late = appts.filter((a) => a.at.getTime() < nowMs);
  const upcoming = appts.filter((a) => a.at.getTime() >= nowMs);
  // M = مجموع الثلاثة فعلًا (لا المجدولة وحدها) حتى لا يكذب الرقم.
  const total = late.length + upcoming.length + done.length;
  if (total === 0) return null;

  const donePct = Math.round((done.length / total) * 100);
  const latePct = Math.round((late.length / total) * 100);
  const allDone = late.length === 0 && upcoming.length === 0;

  return (
    <section className="rounded-3xl bg-card p-7">
      {/* ===== الترويسة: ثلاثة عدّادات + شريط مقسّم + سطر الحصيلة ===== */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h3 className="text-[16px] font-semibold text-foreground">متابعات اليوم</h3>
        <div className="flex items-center gap-5">
          <Counter n={late.length} label="فاتت" tone="text-destructive" zainClass={zainClass} />
          <Counter n={upcoming.length} label="قادمة" tone="text-foreground" zainClass={zainClass} />
          <Counter n={done.length} label="منجزة" tone="text-success" zainClass={zainClass} />
        </div>
      </div>

      <div className="mt-4 flex h-1.5 overflow-hidden rounded-full bg-secondary">
        <div className="h-full bg-success transition-[width] duration-500" style={{ width: `${donePct}%` }} />
        <div className="h-full bg-destructive transition-[width] duration-500" style={{ width: `${latePct}%` }} />
      </div>

      <p className="mt-3 text-[13.5px] text-muted-foreground" style={NUM}>
        أنجزت <b className="font-semibold text-success">{toArabicDigits(done.length)}</b> من <b className="font-semibold text-foreground">{toArabicDigits(total)}</b>
        {late.length > 0 && <> · <b className="font-semibold text-destructive">{toArabicDigits(late.length)}</b> فاتت بلا نتيجة</>}
        {upcoming.length > 0 && <> · باقي <b className="font-semibold text-foreground">{toArabicDigits(upcoming.length)}</b></>}
      </p>

      {allDone && (
        <p className="mt-5 text-[14.5px] font-semibold text-success">خلّصت متابعات اليوم — ما بقي عليك شي.</p>
      )}

      {/* ===== ١) فاتت مواعيدها ===== */}
      {late.length > 0 && (
        <div className="mt-6">
          <h4 className="text-[12.5px] font-semibold text-destructive">فاتت مواعيدها</h4>
          <div className="mt-3 space-y-2">
            {late.map((a) => (
              <div
                key={`${a.leadId}-${a.kind}-${a.at.getTime()}`}
                className="flex items-center gap-4 rounded-2xl border-s-2 border-destructive bg-secondary/40 p-4 transition-colors"
              >
                <span className={`${zainClass} w-14 shrink-0 text-[18px] font-extrabold leading-none text-destructive`} style={NUM}>
                  {formatTime(a.at).replace(/\s*[صم]$/, "")}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/leads/${a.leadId}`} className="text-[15.5px] font-semibold text-foreground transition-colors hover:text-gold">{a.name}</Link>
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-destructive/15 px-2.5 py-1 text-[11px] font-semibold text-destructive">
                      <AlertTriangle className="size-[12px]" strokeWidth={1.6} />
                      فات موعده من {lateLabel(nowMs - a.at.getTime())}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5" dir="ltr"><Phone className="size-[13px]" strokeWidth={1.6} />{a.phone}</span>
                    {a.projectName && (
                      <span className="inline-flex items-center gap-1.5"><MapPin className="size-[13px]" strokeWidth={1.6} />{a.projectName}</span>
                    )}
                    <span>{stageLabels[a.stage]}</span>
                  </div>
                  {/* «كان: …» يظهر فقط إن توفّرت الملاحظة */}
                  {a.lastNote && (
                    <p className="mt-1.5 line-clamp-1 text-[12.5px] text-muted-foreground/80">كان: {a.lastNote.text}</p>
                  )}
                </div>
                <Actions a={a} onLog={() => setTarget({ leadId: a.leadId, name: a.name, stage: a.stage })} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== ٢) قادمة اليوم — البكرة ===== */}
      {upcoming.length > 0 && (
        <div className="mt-6">
          <h4 className="text-[12.5px] font-semibold text-muted-foreground">قادمة اليوم</h4>
          <div className="mt-3">
            <FollowupsReel items={upcoming} zainClass={zainClass} />
          </div>
        </div>
      )}

      {/* ===== ٣) منجزة ===== */}
      {done.length > 0 && (
        <div className="mt-6">
          <h4 className="text-[12.5px] font-semibold text-success">منجزة</h4>
          <div className="mt-3 space-y-1.5">
            {done.map((f) => (
              <div key={f.id} className="flex items-center gap-3 rounded-xl px-4 py-2.5 opacity-70 transition-opacity hover:opacity-100">
                <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-success/15 text-success">
                  <Check className="size-[13px]" strokeWidth={1.8} />
                </span>
                <Link href={`/leads/${f.leadId}`} className="shrink-0 text-[13.5px] font-medium text-muted-foreground line-through decoration-muted-foreground/40 transition-colors hover:text-foreground">
                  {f.leadName}
                </Link>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-success/90">{followUpResultLabels[f.result]}</span>
                <span className="shrink-0 text-[11.5px] text-muted-foreground/70" style={NUM}>{formatTime(f.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ورقة تسجيل النتيجة القائمة — بلا أي إجراء جديد */}
      {target && (
        <FollowUpsDrawer
          leadId={target.leadId}
          leadName={target.name}
          stage={target.stage}
          onClose={() => setTarget(null)}
          onChanged={() => router.refresh()}
        />
      )}
    </section>
  );
}

function Counter({ n, label, tone, zainClass }: { n: number; label: string; tone: string; zainClass: string }) {
  return (
    <div className="text-center leading-none">
      <b className={`${zainClass} text-[22px] font-extrabold ${n === 0 ? "text-muted-foreground/50" : tone}`} style={NUM}>
        {toArabicDigits(n)}
      </b>
      <span className="mt-1.5 block text-[11.5px] text-muted-foreground">{label}</span>
    </div>
  );
}

function Actions({ a, onLog }: { a: TodayAppointment; onLog: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <a
        href={`tel:${a.phone}`}
        aria-label={`اتصال بـ${a.name}`}
        className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-gold px-3.5 text-[12.5px] font-semibold text-background transition-opacity hover:opacity-90"
      >
        <Phone className="size-[14px]" strokeWidth={1.6} /> اتصال
      </a>
      <a
        href={`https://wa.me/${waPhone(a.phone)}`}
        target="_blank" rel="noopener noreferrer"
        aria-label={`واتساب ${a.name}`}
        className="grid size-10 place-items-center rounded-xl bg-success/15 text-success transition-colors hover:bg-success/25"
      >
        <MessageCircle className="size-[14px]" strokeWidth={1.6} />
      </a>
      <button
        type="button"
        onClick={onLog}
        aria-label={`سجّل نتيجة ${a.name}`}
        title="سجّل النتيجة"
        className="grid size-10 place-items-center rounded-xl border border-dashed border-success/35 text-success transition-colors hover:bg-success/10"
      >
        <Check className="size-[14px]" strokeWidth={1.8} />
      </button>
      <Link
        href={`/leads/${a.leadId}`}
        aria-label={`ملف العميل ${a.name}`}
        className="grid size-10 place-items-center rounded-xl bg-secondary/60 text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-[14px]" strokeWidth={1.6} />
      </Link>
    </div>
  );
}

export default TodayFollowups;
