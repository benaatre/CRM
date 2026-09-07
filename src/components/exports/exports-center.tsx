"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { FileDown, Filter } from "lucide-react";
import type { Channel, LeadStage } from "@prisma/client";
import { buildExport } from "@/lib/actions/exports";
import {
  PAYMENT_OPTIONS, SLICE_META, SUB_OPTIONS, columnsOf, familyOf, groupKeys,
  type ColumnGroup, type ExportFilters, type ExportSlice,
} from "@/lib/export-columns";
import { stageLabels } from "@/lib/labels";
import { toArabicDigits } from "@/lib/format";

/**
 * «مركز التصدير» — ثلاث خطوات على شاشة واحدة (يمين→يسار): الشريحة، الأعمدة،
 * المعاينة الحية والتنزيل. عرض خالص فوق buildExport (المالك حصرًا server-side).
 * أوبسيديان: توكنات --gold-aXX + Zain للأرقام العربية-الهندية + RTL.
 */

const NUM = { fontVariantNumeric: "tabular-nums" as const };
const PREPARED: ExportSlice[] = ["ad_exclusion", "interested", "visited", "bookings", "sales", "all"];
const ALL_STAGES = Object.keys(stageLabels) as LeadStage[];

export function ExportsCenter({ zainClass, initialSlice, initialCounts, channels, employees }: {
  zainClass: string;
  initialSlice: ExportSlice;
  initialCounts: Record<ExportSlice, number>;
  channels: { value: Channel; label: string; count: number }[];
  employees: { id: string; name: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [slice, setSlice] = useState<ExportSlice>(initialSlice);
  // الفلاتر المركبة — المراحل للمخصص، والبقية لكل شرائح عائلتها.
  const [stages, setStages] = useState<LeadStage[]>([]);
  const [chSel, setChSel] = useState<Channel[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [months, setMonths] = useState<0 | 3 | 6 | 12>(0);
  const [includeArchived, setIncludeArchived] = useState(true);
  const [excludeFuture, setExcludeFuture] = useState(false);
  // التفصيل الداخلي للشريحة: التصنيفات الفرعية المحددة (الافتراضي الكل) + طرق الدفع.
  const [sub, setSub] = useState<string[]>(SUB_OPTIONS[initialSlice].map((o) => o.key));
  const [payments, setPayments] = useState<string[]>(PAYMENT_OPTIONS.map((o) => o.key));
  const [subCounts, setSubCounts] = useState<Record<string, number>>({});
  const [paymentCounts, setPaymentCounts] = useState<Record<string, number>>({});
  // الأعمدة.
  const [group, setGroup] = useState<ColumnGroup>("ads");
  const [manual, setManual] = useState<string[]>([]);
  // المعاينة.
  const [count, setCount] = useState<number | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [headers, setHeaders] = useState<string[]>([]);
  const [sample, setSample] = useState<string[][]>([]);
  const [error, setError] = useState<string | null>(null);

  const family = familyOf(slice);
  const defs = columnsOf(family);
  const isBooking = family === "booking";
  const lockedFuture = slice === "ad_exclusion"; // مقفول-مفعّل إجباريًا (الخادم يفرضه أيضًا)
  const subOpts = SUB_OPTIONS[slice];

  // تبديل الشريحة يعيد لوحها الفرعي لحالته الافتراضية: الكل محدد.
  function selectSlice(s: ExportSlice) {
    setSlice(s);
    setSub(SUB_OPTIONS[s].map((o) => o.key));
    setPayments(PAYMENT_OPTIONS.map((o) => o.key));
  }

  const filters: ExportFilters = useMemo(() => ({
    // الفلتر الفرعي يُرسل فقط حين يكون جزئيًا (الكل = بلا فلتر).
    ...(subOpts.length && sub.length < subOpts.length ? { sub } : {}),
    ...(isBooking && payments.length < PAYMENT_OPTIONS.length ? { payments } : {}),
    ...(slice === "custom" && stages.length ? { stages } : {}),
    ...(chSel.length && !isBooking ? { channels: chSel } : {}),
    ...(employeeId ? { employeeId } : {}),
    months,
    includeArchived,
    excludeFutureNext: lockedFuture ? true : excludeFuture,
  }), [slice, stages, chSel, employeeId, months, includeArchived, excludeFuture, lockedFuture, isBooking, sub, payments, subOpts]);

  // المعاينة الحية — نداء واحد (preview) يغطي العدّاد والعينة، مع كل تغيير.
  useEffect(() => {
    let alive = true;
    setError(null); setCount(null);
    buildExport(slice, filters, { group, manual }, "preview").then((r) => {
      if (!alive) return;
      if (!r.ok) { setError(r.error); return; }
      setCount(r.count); setSkipped(r.skippedInvalidPhone);
      setHeaders(r.headersAr ?? []); setSample(r.sample ?? []);
      setSubCounts(r.subCounts ?? {}); setPaymentCounts(r.paymentCounts ?? {});
    });
    return () => { alive = false; };
  }, [slice, filters, group, manual]);

  function download() {
    setError(null);
    startTransition(async () => {
      const r = await buildExport(slice, filters, { group, manual }, "csv");
      if (!r.ok) { setError(r.error); return; }
      if (!r.csv || !r.filename) { setError("ما فيه صفوف للتصدير"); return; }
      const blob = new Blob(["﻿" + r.csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = r.filename;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  const toggle = <T,>(arr: T[], v: T): T[] => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  return (
    <div className="mx-auto max-w-[1280px]">
      <header className="mb-5">
        <h1 className="flex items-center gap-2.5 text-[26px] font-bold tracking-tight text-foreground">
          <FileDown className="size-6 text-gold" strokeWidth={1.6} /> مركز التصدير
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground">شرائح جاهزة أو فلاتر مركبة → أعمدة → معاينة وتنزيل CSV — وكل تنزيل بسطر تدقيق.</p>
      </header>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[300px_280px_minmax(0,1fr)]">
        {/* ===== ١) الشريحة ===== */}
        <section className="space-y-2">
          <StepTitle n="١" title="الشريحة" />
          {PREPARED.map((s) => (
            <div key={s}>
              <button
                onClick={() => selectSlice(s)}
                className="flex w-full items-center justify-between gap-2 rounded-xl border px-4 py-3 text-right transition-colors"
                style={slice === s
                  ? { borderColor: "var(--gold-a60)", background: "var(--gold-a06)" }
                  : { borderColor: "var(--hairline)", background: "var(--card)" }}
              >
                <span className="min-w-0">
                  <span className={`block text-[13px] font-semibold ${slice === s ? "text-gold" : "text-foreground"}`}>{SLICE_META[s].title}</span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground/70">{SLICE_META[s].desc}</span>
                </span>
                <b className={`${zainClass} shrink-0 text-[19px] font-extrabold ${slice === s ? "text-gold" : "text-muted-foreground"}`} style={NUM}>
                  {toArabicDigits(initialCounts[s] ?? 0)}
                </b>
              </button>

              {/* لوح التفصيل الداخلي — تحت البطاقة المختارة فقط: كل تصنيف تشيك مستقل بعدّه الحي */}
              {slice === s && subOpts.length > 0 && (
                <div className="mt-1.5 space-y-2 rounded-xl px-3 py-2.5" style={{ background: "var(--gold-a03)", border: "1px solid var(--gold-a20)" }}>
                  <div className="text-[10.5px] text-muted-foreground">التصنيفات الفرعية — ألغِ ما لا تريده بالملف</div>
                  <div className="flex flex-wrap gap-1.5">
                    {subOpts.map((o) => (
                      <Chip key={o.key} on={sub.includes(o.key)} onClick={() => setSub((a) => toggle(a, o.key))}>
                        {o.label} <span style={NUM}>{toArabicDigits(subCounts[o.key] ?? 0)}</span>
                      </Chip>
                    ))}
                  </div>
                  {isBooking && (
                    <>
                      <div className="text-[10.5px] text-muted-foreground">طريقة الدفع</div>
                      <div className="flex flex-wrap gap-1.5">
                        {PAYMENT_OPTIONS.map((o) => (
                          <Chip key={o.key} on={payments.includes(o.key)} onClick={() => setPayments((a) => toggle(a, o.key))}>
                            {o.label} <span style={NUM}>{toArabicDigits(paymentCounts[o.key] ?? 0)}</span>
                          </Chip>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
          <button
            onClick={() => selectSlice("custom")}
            className="flex w-full items-center gap-2 rounded-xl border border-dashed px-4 py-3 text-right text-[13px] font-semibold transition-colors"
            style={slice === "custom"
              ? { borderColor: "var(--gold-a60)", background: "var(--gold-a06)", color: "var(--gold)" }
              : { borderColor: "var(--hairline)", color: "var(--muted-foreground)" }}
          >
            <Filter className="size-4" strokeWidth={1.6} /> {SLICE_META.custom.title}
            <span className="mr-auto text-[11px] font-normal text-muted-foreground/70">{SLICE_META.custom.desc}</span>
          </button>

          {/* الفلاتر — تحت البطاقات (تخص الشريحة المختارة) */}
          <div className="space-y-3 rounded-xl border border-border p-3.5">
            {slice === "custom" && (
              <div>
                <div className="mb-1.5 text-[11px] text-muted-foreground">المراحل (متعدد)</div>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_STAGES.map((s) => (
                    <Chip key={s} on={stages.includes(s)} onClick={() => setStages((a) => toggle(a, s))}>{stageLabels[s]}</Chip>
                  ))}
                </div>
              </div>
            )}
            {!isBooking && (
              <div>
                <div className="mb-1.5 text-[11px] text-muted-foreground">المصدر الإعلاني (متعدد)</div>
                <div className="flex flex-wrap gap-1.5">
                  {channels.map((c) => (
                    <Chip key={c.value} on={chSel.includes(c.value)} onClick={() => setChSel((a) => toggle(a, c.value))}>
                      {c.label} <span style={NUM}>{toArabicDigits(c.count)}</span>
                    </Chip>
                  ))}
                </div>
              </div>
            )}
            <label className="block">
              <span className="mb-1.5 block text-[11px] text-muted-foreground">{isBooking ? "البائع" : "الموظف المسند"}</span>
              <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="select-base text-sm">
                <option value="">الكل</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </label>
            <div>
              <div className="mb-1.5 text-[11px] text-muted-foreground">المدة {slice === "ad_exclusion" ? "(على الإقفال)" : "(على الدخول)"}</div>
              <div className="grid grid-cols-4 gap-1.5">
                {([[0, "الكل"], [3, "٣ أشهر"], [6, "٦ أشهر"], [12, "سنة"]] as const).map(([v, label]) => (
                  <Chip key={v} on={months === v} onClick={() => setMonths(v)}>{label}</Chip>
                ))}
              </div>
            </div>
            {!isBooking && (
              <label className="flex cursor-pointer items-center justify-between text-[12.5px] text-foreground">
                تضمين المؤرشفين
                <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} className="size-4 accent-[var(--gold)]" />
              </label>
            )}
            {!isBooking && (
              <label className={`flex items-center justify-between text-[12.5px] ${lockedFuture ? "text-muted-foreground" : "cursor-pointer text-foreground"}`}>
                استثناء أصحاب المواعيد المستقبلية{lockedFuture && <span className="text-[10.5px] text-gold"> (إجباري بالاستبعاد)</span>}
                <input type="checkbox" checked={lockedFuture ? true : excludeFuture} disabled={lockedFuture} onChange={(e) => setExcludeFuture(e.target.checked)} className="size-4 accent-[var(--gold)]" />
              </label>
            )}
          </div>
        </section>

        {/* ===== ٢) الأعمدة ===== */}
        <section className="space-y-2">
          <StepTitle n="٢" title="الأعمدة" />
          {([["ads", "إعلاني", "phone وحده بصيغة +966 — رفع مباشر بمنصات الإعلان"], ["basic", "أساسي", "رقم + اسم"], ["full", "كامل", "كل الأعمدة المرجعية لهذه الشريحة"], ["manual", "يدوي", "اختر أي تركيبة أعمدة"]] as const).map(([v, title, desc]) => (
            <button
              key={v}
              onClick={() => setGroup(v)}
              className="w-full rounded-xl border px-4 py-3 text-right transition-colors"
              style={group === v
                ? { borderColor: "var(--gold-a60)", background: "var(--gold-a06)" }
                : { borderColor: "var(--hairline)", background: "var(--card)" }}
            >
              <span className={`block text-[13px] font-semibold ${group === v ? "text-gold" : "text-foreground"}`}>{title}</span>
              <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground/70">{desc}</span>
            </button>
          ))}
          {group === "manual" && (
            <div className="max-h-[340px] space-y-1 overflow-y-auto rounded-xl border border-border p-3">
              {defs.map((d) => (
                <label key={d.key} className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 text-[12.5px] text-foreground hover:bg-secondary/50">
                  {d.label}
                  <input type="checkbox" checked={manual.includes(d.key)} onChange={() => setManual((a) => toggle(a, d.key))} className="size-4 accent-[var(--gold)]" />
                </label>
              ))}
            </div>
          )}
        </section>

        {/* ===== ٣) المعاينة والتنزيل ===== */}
        <section className="min-w-0 space-y-3">
          <StepTitle n="٣" title="المعاينة والتنزيل" />
          <div className="rounded-2xl p-5 text-center" style={{ background: "var(--gold-a03)", border: "1px solid var(--gold-a20)" }}>
            {count === null && !error ? (
              <span className="text-sm text-muted-foreground">جارٍ العدّ…</span>
            ) : error ? (
              <span className="text-sm text-destructive">{error}</span>
            ) : (
              <>
                <div className="text-[12.5px] text-muted-foreground">سيُصدَّر</div>
                <div className={`${zainClass} text-[44px] font-extrabold leading-none text-gold`} style={{ ...NUM, textShadow: "0 0 18px var(--gold-a35)" }}>
                  {toArabicDigits(count ?? 0)}
                </div>
                <div className="mt-1 text-[12px] text-muted-foreground">
                  {isBooking ? "صفًا" : "عميلًا"}
                  {skipped > 0 && <> · استُبعد {toArabicDigits(skipped)} لرقم غير صالح</>}
                </div>
              </>
            )}
          </div>

          {/* عينة أول ٥ صفوف — بالأعمدة المختارة نفسها، تتحدث مع كل تغيير */}
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border bg-secondary/40 text-muted-foreground">
                  {headers.map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 text-right font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {sample.length === 0 ? (
                  <tr><td colSpan={Math.max(headers.length, 1)} className="px-3 py-4 text-center text-muted-foreground/70">ما فيه صفوف بهذه الفلاتر</td></tr>
                ) : sample.map((row, i) => (
                  <tr key={i} className="border-b border-border/50 text-foreground">
                    {row.map((cell, j) => (
                      <td key={j} className="whitespace-nowrap px-3 py-2" dir={headers[j]?.includes("+966") ? "ltr" : undefined} style={NUM}>{cell || "—"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {count != null && count > 5 && <p className="text-[11px] text-muted-foreground/70">عينة أول ٥ صفوف — الملف الكامل بالتنزيل.</p>}

          <button
            onClick={download}
            disabled={pending || !count}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <FileDown className="size-4" strokeWidth={1.8} />
            {pending ? "جارٍ التوليد…" : `نزّل CSV (${toArabicDigits(count ?? 0)})`}
          </button>
        </section>
      </div>
    </div>
  );
}

function StepTitle({ n, title }: { n: string; title: string }) {
  return (
    <div className="mb-1 flex items-center gap-2 text-[13.5px] font-bold text-foreground">
      <span className="flex size-6 items-center justify-center rounded-full text-[12px] text-gold" style={{ background: "var(--gold-a12)", border: "1px solid var(--gold-a35)" }}>{n}</span>
      {title}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border px-2.5 py-1 text-[11.5px] transition-colors"
      style={on
        ? { borderColor: "var(--gold-a60)", background: "var(--gold-a12)", color: "var(--gold)" }
        : { borderColor: "var(--hairline)", color: "var(--muted-foreground)" }}
    >
      {children}
    </button>
  );
}
