"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PurchaseGoal, PurchaseMethod, Channel } from "@prisma/client";
import {
  purchaseGoalLabels, purchaseMethodLabels, purchaseMethodOptions, stageLabels, stageColor,
  paymentMethodLabels, bankLabels, nationalityLabels, cashPaymentTypeLabels, channelLabels,
  followUpResultLabels, followUpTypeLabels,
} from "@/lib/labels";
import { updateLeadIntake, updateLeadChannel } from "@/lib/actions/leads";
import { fetchSources } from "@/lib/actions/sources";
import type { SourceListItem } from "@/lib/data/sources";
import { cancelBooking } from "@/lib/actions/bookings";
import { formatDate, formatCurrencyFull, toArabicDigits } from "@/lib/format";
import type { LeadDetail, LeadTransferHistory } from "@/lib/data/leads";
import { BookingForm } from "@/components/bookings/booking-form";
import { FollowUpsForm } from "./followups-form";
import { FollowUpsTimeline } from "./followups-timeline";
import { useFollowUps } from "./use-followups";

type Tab = "data" | "followups" | "ai" | "transfers";
type Analysis = { temperature: string; interest: number; nextStep: string; whatsapp: string; source?: string };

const tempColor: Record<string, string> = {
  "حار": "bg-destructive/15 text-destructive",
  "دافئ": "bg-warning/15 text-warning",
  "بارد": "bg-info/15 text-info",
};

export function LeadProfile({ detail, projects, transferHistory }: { detail: LeadDetail; projects: { id: string; name: string }[]; transferHistory: LeadTransferHistory | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>("data");
  // تبويب «سجل التحويلات» للمالك فقط (transferHistory != null يعني مالك — الصلاحية من الخادم).
  const tabs: [Tab, string][] = [["data", "بيانات"], ["followups", "المتابعة والزيارات"], ["ai", "مساعد كلود"]];
  if (transferHistory) tabs.push(["transfers", "سجل التحويلات"]);
  const [reserveMode, setReserveMode] = useState<"reserve" | "instant" | null>(null);
  const { items, loading, reload } = useFollowUps(detail.id);

  const wa = `https://wa.me/966${detail.phone.replace(/^0/, "")}`;

  function cancel(bookingId: string) {
    const reason = window.prompt("سبب إلغاء الحجز (اختياري):");
    if (reason === null) return;
    if (!window.confirm("متأكد من إلغاء الحجز؟ الوحدة بترجع «متاحة» والعميل يرجع لمرحلة «تفاوض».")) return;
    startTransition(async () => {
      const r = await cancelBooking(bookingId, reason.trim() || undefined);
      if (!r.ok && r.error) alert(r.error);
      reload();
      router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* الهيدر */}
      <header className="glass rounded-2xl p-5">
        <div className="flex items-start justify-between gap-3">
          <Link href="/leads" className="rounded-lg border border-border px-2.5 py-1 text-sm text-muted-foreground hover:text-foreground" title="رجوع">×</Link>
          <div className="flex items-center gap-3 text-right">
            <div>
              <h1 className="text-xl font-bold text-foreground">{detail.name}</h1>
              <div className="mt-1 flex flex-wrap items-center justify-end gap-2 text-sm text-muted-foreground">
                <span dir="ltr">{detail.phone}</span>
                <span className={`rounded-full border px-2 py-0.5 text-xs ${stageColor[detail.stage]}`}>{stageLabels[detail.stage]}</span>
              </div>
            </div>
            <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-gold/15 text-xl font-bold text-gold">{detail.name.charAt(0)}</div>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <a href={`tel:${detail.phone}`} className="flex-1 rounded-lg bg-primary py-2.5 text-center text-sm font-medium text-primary-foreground hover:opacity-90">اتصل</a>
          <a href={wa} target="_blank" rel="noopener noreferrer" className="flex-1 rounded-lg bg-success/15 py-2.5 text-center text-sm font-medium text-success hover:bg-success/25">واتساب</a>
        </div>
      </header>

      {/* التبويبات — قابلة للتمرير أفقيًا على الجوال */}
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1">
        {tabs.map(([v, label]) => (
          <button key={v} onClick={() => setTab(v)} className={`flex-1 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${tab === v ? "bg-secondary text-gold" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>
        ))}
      </div>

      {tab === "data" && <DataTab detail={detail} projects={projects} onSaved={() => router.refresh()} />}

      {tab === "followups" && (
        <div className="space-y-5">
          {detail.isArchived ? (
            <section className="glass space-y-3 rounded-2xl p-5">
              <h2 className="font-semibold text-foreground">تفاصيل الحجز</h2>
              {detail.bookings.length === 0 ? (
                <p className="text-sm text-muted-foreground">لا توجد تفاصيل حجز.</p>
              ) : detail.bookings.map((b) => (
                <div key={b.id} className="space-y-2 rounded-xl border border-border p-4">
                  {b.discountExceeded && (
                    <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">تم تجاوز الخصم المسموح — تحذير للمدير.</p>
                  )}
                  <BRow label="المشروع" value={b.projectName ?? "—"} />
                  <BRow label="الوحدة" value={b.unitNumber} ltr />
                  <BRow label="الدور" value={b.floor ?? "—"} />
                  <BRow label="الجنسية" value={b.nationality ? nationalityLabels[b.nationality] : "—"} />
                  <BRow label={b.nationality === "RESIDENT" ? "رقم الإقامة" : "رقم الهوية"} value={b.nationalId ?? "—"} ltr />
                  {b.secondaryPhone && <BRow label="رقم إضافي" value={b.secondaryPhone} ltr />}
                  <div className="my-1 border-t border-border" />
                  <BRow label="سعر الوحدة" value={formatCurrencyFull(b.price)} />
                  <BRow label="الخصم" value={(b.discount ?? 0) > 0 ? `- ${formatCurrencyFull(b.discount)}` : "—"} />
                  <BRow label="السعر النهائي" value={formatCurrencyFull(b.finalPrice)} strong />
                  {(b.taxAmount ?? b.vatAmount) != null && <BRow label="ضريبة" value={formatCurrencyFull(b.taxAmount ?? b.vatAmount)} />}
                  {(b.taxAmount ?? b.vatAmount) != null && <BRow label="الإجمالي مع الضريبة" value={formatCurrencyFull((b.finalPrice ?? 0) + (b.taxAmount ?? b.vatAmount ?? 0))} strong />}
                  <BRow label="العربون" value={b.deposit != null ? formatCurrencyFull(b.deposit) : "—"} />
                  <div className="my-1 border-t border-border" />
                  <BRow label="طريقة الدفع" value={b.paymentMethod ? `${paymentMethodLabels[b.paymentMethod]}${b.bankName ? ` · ${bankLabels[b.bankName]}` : ""}` : "—"} />
                  {b.cashPaymentType && <BRow label="دفع الكاش" value={`${cashPaymentTypeLabels[b.cashPaymentType]}${b.installmentsCount ? ` (${b.installmentsCount} دفعة)` : ""}`} />}
                  <BRow label="تاريخ الحجز" value={formatDate(b.createdAt)} />
                  {b.sellerName && <BRow label="الموظف" value={b.sellerName} />}
                  <button onClick={() => cancel(b.id)} disabled={pending} className="mt-2 w-full rounded-lg border border-destructive/40 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50">إلغاء الحجز</button>
                </div>
              ))}
            </section>
          ) : (
            <FollowUpsForm
              leadId={detail.id}
              stage={detail.stage}
              firstContactStage={detail.firstContactStage}
              projects={projects}
              onSaved={() => { reload(); router.refresh(); }}
              onBook={() => setReserveMode("reserve")}
            />
          )}
          <FollowUpsTimeline items={items} loading={loading} />
        </div>
      )}

      {tab === "ai" && <AiTab leadId={detail.id} phone={detail.phone} />}

      {tab === "transfers" && transferHistory && <TransferHistorySection data={transferHistory} />}

      {/* زرّان ثابتان دائمًا (إلا لو العميل محجوز/مشترٍ مسبقًا) */}
      {!detail.isArchived && (
        <div className="sticky bottom-3 z-30 flex gap-2 rounded-2xl border border-border bg-card/90 p-2 shadow-2xl backdrop-blur">
          <button onClick={() => setReserveMode("reserve")} className="min-h-12 flex-1 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground hover:opacity-90">تم الحجز</button>
          <button onClick={() => setReserveMode("instant")} className="min-h-12 flex-1 rounded-xl bg-success/15 py-3 text-sm font-semibold text-success hover:bg-success/25">شراء فوري</button>
        </div>
      )}

      {reserveMode && (
        <BookingForm
          open={!!reserveMode}
          leadId={detail.id}
          leadName={detail.name}
          immediateSale={reserveMode === "instant"}
          onClose={() => setReserveMode(null)}
          onDone={() => { reload(); router.refresh(); }}
        />
      )}
    </div>
  );
}

// ===== تبويب البيانات =====
function DataTab({ detail, projects, onSaved }: { detail: LeadDetail; projects: { id: string; name: string }[]; onSaved: () => void }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [goal, setGoal] = useState<string>(detail.purchaseGoal ?? "");
  const [method, setMethod] = useState<string>(detail.purchaseMethod ?? "");
  const [priceMin, setPriceMin] = useState(detail.priceMin?.toString() ?? "");
  const [priceMax, setPriceMax] = useState(detail.priceMax?.toString() ?? "");
  const [areas, setAreas] = useState<string[]>(detail.preferredAreas ?? []);
  const [areaInput, setAreaInput] = useState("");
  const [projSel, setProjSel] = useState<Set<string>>(new Set(detail.preferredProjects ?? []));
  const [sources, setSources] = useState<SourceListItem[]>([]);
  const [sourceSel, setSourceSel] = useState(detail.sourceId ?? "");

  useEffect(() => { fetchSources().then(setSources).catch(() => {}); }, []);

  function addArea() {
    const v = areaInput.trim();
    if (v && !areas.includes(v)) setAreas((a) => [...a, v]);
    setAreaInput("");
  }
  function save() {
    setMsg(null);
    startTransition(async () => {
      const res = await updateLeadIntake(detail.id, {
        purchaseGoal: (goal || null) as PurchaseGoal | null,
        purchaseMethod: (method || null) as PurchaseMethod | null,
        priceMin: priceMin ? Number(priceMin.replace(/\D/g, "")) : null,
        priceMax: priceMax ? Number(priceMax.replace(/\D/g, "")) : null,
        preferredAreas: areas,
        preferredProjects: [...projSel],
        sourceId: sourceSel || null,
      });
      setMsg(res.ok ? "تم الحفظ" : res.error ?? "صار خطأ");
      onSaved();
    });
  }

  return (
    <section className="glass space-y-4 rounded-2xl p-5">
      <div className="grid grid-cols-2 gap-3">
        <Field label="هدف الشراء">
          <select value={goal} onChange={(e) => setGoal(e.target.value)} className="select-base">
            <option value="">—</option>
            {(Object.keys(purchaseGoalLabels) as PurchaseGoal[]).map((g) => <option key={g} value={g}>{purchaseGoalLabels[g]}</option>)}
          </select>
        </Field>
        <Field label="طريقة الشراء">
          <select value={method} onChange={(e) => setMethod(e.target.value)} className="select-base">
            <option value="">—</option>
            {purchaseMethodOptions.map((m) => <option key={m} value={m}>{purchaseMethodLabels[m]}</option>)}
          </select>
        </Field>
        <Field label="السعر من"><input value={priceMin} onChange={(e) => setPriceMin(e.target.value.replace(/\D/g, ""))} inputMode="numeric" dir="ltr" className="select-base" /></Field>
        <Field label="السعر إلى"><input value={priceMax} onChange={(e) => setPriceMax(e.target.value.replace(/\D/g, ""))} inputMode="numeric" dir="ltr" className="select-base" /></Field>
        <Field label="القناة">
          {/* تعديل القناة للمالك/المدير فقط — الخادم يرفض الموظف برسالة واضحة. */}
          <select
            defaultValue={detail.channel}
            disabled={pending}
            onChange={(e) => startTransition(async () => {
              const res = await updateLeadChannel(detail.id, e.target.value as Channel);
              setMsg(res.ok ? "تم تغيير القناة" : res.error ?? "صار خطأ");
              onSaved();
            })}
            className="select-base"
          >
            {(Object.keys(channelLabels) as Channel[]).map((c) => <option key={c} value={c}>{channelLabels[c]}</option>)}
          </select>
        </Field>
        <Field label="المصدر">
          <select value={sourceSel} onChange={(e) => setSourceSel(e.target.value)} className="select-base">
            {/* fallback: عند غياب مصدر مهيكل، نعرض نص المصدر المخزّن (للمستوردين) بدل «—». */}
            <option value="">{!sourceSel && detail.source ? detail.source : "—"}</option>
            {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
      </div>

      <div className="space-y-2">
        <span className="text-xs text-muted-foreground">الأحياء المناسبة</span>
        <div className="flex flex-wrap gap-2">
          {areas.map((a) => (
            <span key={a} className="flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs text-foreground">{a}<button onClick={() => setAreas((xs) => xs.filter((x) => x !== a))} className="text-muted-foreground hover:text-destructive" aria-label="حذف">×</button></span>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={areaInput} onChange={(e) => setAreaInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addArea(); } }} placeholder="اكتب حيًّا واضغط Enter…" className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-gold" />
          <button onClick={addArea} className="rounded-lg border border-border px-3 text-sm text-muted-foreground hover:text-foreground">إضافة</button>
        </div>
      </div>

      <div className="space-y-2">
        <span className="text-xs text-muted-foreground">المشاريع المناسبة</span>
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-border p-3">
          {projects.length === 0 ? <span className="text-xs text-muted-foreground">ما فيه مشاريع</span> : projects.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={projSel.has(p.id)} onChange={(e) => setProjSel((s) => { const n = new Set(s); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })} />
              {p.name}
            </label>
          ))}
        </div>
      </div>

      {msg && <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">{msg}</p>}
      <button onClick={save} disabled={pending} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">{pending ? "جارٍ الحفظ…" : "حفظ البيانات"}</button>
    </section>
  );
}

// ===== تبويب مساعد كلود =====
function AiTab({ leadId, phone }: { leadId: string; phone: string }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [copied, setCopied] = useState(false);

  async function analyze() {
    setAnalyzing(true);
    setAnalysis(null);
    try {
      const res = await fetch("/api/analyze-lead", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadId }) });
      const data = await res.json();
      if (res.ok) setAnalysis(data);
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <section className="glass space-y-4 rounded-2xl p-5">
      <button onClick={analyze} disabled={analyzing} className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
        {analyzing ? "جارٍ التحليل…" : "حلّل العميل"}
      </button>

      {analysis && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className={`rounded-full px-3 py-1 text-sm font-bold ${tempColor[analysis.temperature] ?? "bg-secondary text-foreground"}`}>{analysis.temperature}</span>
            <div className="flex-1">
              <div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>نسبة الاهتمام</span><span className="text-gold">{analysis.interest}٪</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-gold" style={{ width: `${analysis.interest}%` }} /></div>
            </div>
          </div>

          <div className="rounded-xl border border-border p-3">
            <div className="text-xs text-muted-foreground">الخطوة القادمة</div>
            <p className="mt-1 text-sm text-foreground">{analysis.nextStep}</p>
          </div>

          <div className="rounded-xl border border-border p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">رسالة واتساب جاهزة</span>
              <button onClick={() => { navigator.clipboard.writeText(analysis.whatsapp); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="text-xs text-gold">{copied ? "تم النسخ" : "نسخ"}</button>
            </div>
            <p className="whitespace-pre-wrap text-sm text-foreground">{analysis.whatsapp}</p>
            <a href={`https://wa.me/966${phone.replace(/^0/, "")}?text=${encodeURIComponent(analysis.whatsapp)}`} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block rounded-lg bg-success/15 px-3 py-1.5 text-xs font-medium text-success hover:bg-success/25">إرسال واتساب</a>
          </div>

          {analysis.source && <p className="text-center text-xs text-muted-foreground/60">المصدر: {analysis.source}</p>}
        </div>
      )}
    </section>
  );
}

// ===== سجل التحويلات (للمالك فقط) =====
const REASON_LABELS: Record<string, string> = {
  initial: "إسناد أولي",
  timeout: "سحب بعد تأخّر التواصل",
  no_response: "سحب — لم يتم الرد",
  no_response_neglect: "سحب — تقصير (انتهت المهلة)",
  no_response_exhausted: "سحب — استنفاد محاولات (تابع وما رد)",
  manual_pull: "سحب يدوي (الإدارة)",
  manual_redistribute: "توزيع يدوي",
};

function TransferHistorySection({ data }: { data: LeadTransferHistory }) {
  return (
    <div className="space-y-5">
      <section className="glass space-y-3 rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-foreground">سجل التحويلات</h2>
          <span className="rounded-full bg-gold/15 px-2.5 py-0.5 text-xs font-medium text-gold">تحوّل {toArabicDigits(data.transferCount)} مرة</span>
        </div>
        {data.transfers.length === 0 ? (
          <p className="text-sm text-muted-foreground">ما فيه تحويلات مسجّلة.</p>
        ) : (
          <ol className="space-y-2">
            {data.transfers.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3 text-sm">
                <div className="flex items-center gap-2 text-foreground">
                  <span>{t.fromName ?? "—"}</span>
                  <span className="text-muted-foreground">←</span>
                  <span className="font-medium">{t.toName ?? "الحوض"}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="rounded bg-secondary px-1.5 py-0.5">{REASON_LABELS[t.reason] ?? t.reason}</span>
                  <span>{formatDate(t.createdAt)}</span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="glass space-y-3 rounded-2xl p-5">
        <h2 className="font-semibold text-foreground">متابعات كل موظف (بنصّها وكاتبها)</h2>
        {data.followUps.length === 0 ? (
          <p className="text-sm text-muted-foreground">ما فيه متابعات مسجّلة.</p>
        ) : (
          <ul className="space-y-2">
            {data.followUps.map((f) => (
              <li key={f.id} className="space-y-1 rounded-xl border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-gold">{f.authorName ?? "—"}</span>
                  <span className="text-muted-foreground">{formatDate(f.createdAt)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="rounded bg-secondary px-1.5 py-0.5 text-foreground">{followUpTypeLabels[f.type]}</span>
                  <span className="rounded bg-secondary px-1.5 py-0.5 text-muted-foreground">{followUpResultLabels[f.result]}</span>
                </div>
                {f.note && <p className="whitespace-pre-wrap text-sm text-foreground">{f.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1.5"><span className="text-xs text-muted-foreground">{label}</span>{children}</label>;
}

function BRow({ label, value, strong, ltr }: { label: string; value: string; strong?: boolean; ltr?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? "font-bold text-gold" : "text-foreground"} dir={ltr ? "ltr" : undefined}>{value}</span>
    </div>
  );
}
