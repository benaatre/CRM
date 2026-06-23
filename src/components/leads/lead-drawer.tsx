"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Channel, LeadStage, Priority, UnitType, PurchaseMethod, PurchaseGoal } from "@prisma/client";
import {
  X, Phone, MessageCircle, Loader2, Sparkles, Copy, Check,
} from "lucide-react";
import {
  stageOrder, stageLabels, stageColor, channelLabels, priorityLabels,
  unitTypeLabels, purchaseMethodLabels, purchaseGoalLabels, districtOptions,
} from "@/lib/labels";
import type { LeadDetail } from "@/lib/data/leads";
import {
  fetchLeadDetail, updateLeadStage, updateLeadFields,
  reassignLead, updateLead,
} from "@/lib/actions/leads";
import { BookingForm } from "@/components/bookings/booking-form";
import { cancelBooking } from "@/lib/actions/bookings";
import { FollowUpsForm } from "./followups-form";
import { FollowUpsTimeline } from "./followups-timeline";
import { useFollowUps } from "./use-followups";

type Employee = { id: string; name: string };
type Tab = "data" | "timeline" | "ai";
type Analysis = { temperature: string; interest: number; nextStep: string; whatsapp: string; source?: string };

const tempColor: Record<string, string> = {
  "حار": "bg-destructive/15 text-destructive",
  "دافئ": "bg-warning/15 text-warning",
  "بارد": "bg-info/15 text-info",
};

export function LeadDrawer({
  leadId, onClose, isManager, employees,
}: {
  leadId: string | null;
  onClose: () => void;
  isManager: boolean;
  employees: Employee[];
}) {
  const router = useRouter();
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>("data");
  const [showBooking, setShowBooking] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [copied, setCopied] = useState(false);

  async function load(id: string) {
    setLoading(true);
    setLead(await fetchLeadDetail(id));
    setLoading(false);
  }
  useEffect(() => {
    if (leadId) { setTab("data"); setAnalysis(null); load(leadId); }
    else setLead(null);
  }, [leadId]);

  function refresh() {
    if (leadId) load(leadId);
    router.refresh();
  }

  function saveData(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!lead) return;
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      await updateLead(lead.id, {
        name: String(fd.get("name") ?? ""),
        phone: String(fd.get("phone") ?? ""),
        channel: fd.get("channel") as Channel,
        budget: String(fd.get("budget") ?? ""),
        unitType: (fd.get("unitType") as UnitType) || null,
        priority: fd.get("priority") as Priority,
        purchaseMethod: (fd.get("purchaseMethod") as PurchaseMethod) || null,
        purchaseGoal: (fd.get("purchaseGoal") as PurchaseGoal) || null,
        preferredDistrict: String(fd.get("preferredDistrict") ?? ""),
      });
      refresh();
    });
  }

  function cancelLeadBooking() {
    if (!lead?.bookingId) return;
    if (!confirm("متأكد تبي تلغي حجز هذا العميل؟ الوحدة بترجع «متاحة».")) return;
    const reason = prompt("سبب الإلغاء (اختياري):") ?? undefined;
    startTransition(async () => { await cancelBooking(lead.bookingId!, reason || undefined); refresh(); });
  }

  async function analyze() {
    if (!lead) return;
    setAnalyzing(true);
    setAnalysis(null);
    try {
      const res = await fetch("/api/analyze-lead", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadId: lead.id }),
      });
      const data = await res.json();
      if (res.ok) setAnalysis(data);
    } finally {
      setAnalyzing(false);
    }
  }

  if (!leadId) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      {/* اللوحة تنزلق من اليمين */}
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-r border-border bg-card shadow-2xl">
        {loading && !lead ? (
          <div className="flex flex-1 items-center justify-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
        ) : !lead ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-muted-foreground">العميل غير موجود أو ما عندك صلاحية.</p>
            <button onClick={onClose} className="text-sm text-gold">إغلاق</button>
          </div>
        ) : (
          <>
            {/* الرأس */}
            <header className="border-b border-border p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex size-11 items-center justify-center rounded-full bg-gold/15 text-lg font-bold text-gold">
                    {lead.name.charAt(0)}
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-foreground">{lead.name}</h2>
                    <div className="mt-1 flex items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-xs ${stageColor[lead.stage]}`}>{stageLabels[lead.stage]}</span>
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">{lead.attempts} محاولة</span>
                    </div>
                  </div>
                </div>
                <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary"><X className="size-5" /></button>
              </div>
              <div className="mt-3 flex gap-2">
                <a href={`tel:${lead.phone}`} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground hover:opacity-90"><Phone className="size-4" /> اتصال</a>
                <a href={`https://wa.me/966${lead.phone.replace(/^0/, "")}`} target="_blank" rel="noopener noreferrer" className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-success/15 py-2 text-sm font-medium text-success hover:bg-success/25"><MessageCircle className="size-4" /> واتساب</a>
              </div>
            </header>

            {/* التبويبات */}
            <div className="flex border-b border-border">
              {([["data", "البيانات"], ["timeline", "المتابعة"], ["ai", "مساعد كلود"]] as const).map(([v, label]) => (
                <button key={v} onClick={() => setTab(v)} className={`flex-1 py-3 text-sm font-medium transition-colors ${tab === v ? "border-b-2 border-gold text-gold" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {/* تبويب البيانات */}
              {tab === "data" && (
                <form onSubmit={saveData} className="space-y-3">
                  <DField label="الاسم"><input name="name" defaultValue={lead.name} className="select-base" /></DField>
                  <DField label="الجوال"><input name="phone" defaultValue={lead.phone} dir="ltr" className="select-base" /></DField>
                  <div className="grid grid-cols-2 gap-3">
                    <DField label="القناة">
                      <select name="channel" defaultValue={lead.channel} className="select-base">
                        {(Object.keys(channelLabels) as Channel[]).map((c) => <option key={c} value={c}>{channelLabels[c]}</option>)}
                      </select>
                    </DField>
                    <DField label="الأولوية">
                      <select name="priority" defaultValue={lead.priority} className="select-base">
                        {(Object.keys(priorityLabels) as Priority[]).map((p) => <option key={p} value={p}>{priorityLabels[p]}</option>)}
                      </select>
                    </DField>
                    <DField label="نوع الوحدة">
                      <select name="unitType" defaultValue={lead.unitType ?? ""} className="select-base">
                        <option value="">—</option>
                        {(Object.keys(unitTypeLabels) as UnitType[]).map((u) => <option key={u} value={u}>{unitTypeLabels[u]}</option>)}
                      </select>
                    </DField>
                    <DField label="الميزانية"><input name="budget" defaultValue={lead.budget ?? ""} dir="ltr" className="select-base" /></DField>
                    <DField label="طريقة الشراء">
                      <select name="purchaseMethod" defaultValue={lead.purchaseMethod ?? ""} className="select-base">
                        <option value="">—</option>
                        {(Object.keys(purchaseMethodLabels) as PurchaseMethod[]).map((m) => <option key={m} value={m}>{purchaseMethodLabels[m]}</option>)}
                      </select>
                    </DField>
                    <DField label="هدف الشراء">
                      <select name="purchaseGoal" defaultValue={lead.purchaseGoal ?? ""} className="select-base">
                        <option value="">—</option>
                        {(Object.keys(purchaseGoalLabels) as PurchaseGoal[]).map((g) => <option key={g} value={g}>{purchaseGoalLabels[g]}</option>)}
                      </select>
                    </DField>
                    <DField label="الحي المفضّل">
                      <select name="preferredDistrict" defaultValue={lead.preferredDistrict ?? ""} className="select-base">
                        <option value="">—</option>
                        {districtOptions.map((d) => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </DField>
                  </div>

                  <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
                    <DField label="المرحلة">
                      <select
                        value={lead.stage}
                        disabled={pending}
                        onChange={(e) => {
                          const v = e.target.value as LeadStage;
                          // اختيار «محجوز/عربون» يفتح نموذج الحجز بدل تغيير المرحلة مباشرة
                          if (v === "RESERVED") { setShowBooking(true); return; }
                          startTransition(async () => { await updateLeadStage(lead.id, v); refresh(); });
                        }}
                        className="select-base"
                      >
                        {stageOrder.map((s) => <option key={s} value={s}>{stageLabels[s]}</option>)}
                      </select>
                    </DField>
                    {isManager && (
                      <DField label="الموظف">
                        <select value={lead.assignedTo?.id ?? ""} disabled={pending} onChange={(e) => startTransition(async () => { await reassignLead(lead.id, e.target.value); refresh(); })} className="select-base">
                          {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                        </select>
                      </DField>
                    )}
                    <DField label="المتابعة القادمة">
                      <input type="date" defaultValue={lead.nextFollowup ? new Date(lead.nextFollowup).toISOString().slice(0, 10) : ""} disabled={pending} onChange={(e) => startTransition(async () => { await updateLeadFields(lead.id, { nextFollowup: e.target.value || null }); refresh(); })} className="select-base" />
                    </DField>
                  </div>

                  {lead.bookingId && (
                    <button type="button" onClick={cancelLeadBooking} disabled={pending} className="w-full rounded-lg border border-destructive/40 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50">إلغاء الحجز</button>
                  )}
                  <button type="submit" disabled={pending} className="w-full rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">{pending ? "جارٍ الحفظ…" : "حفظ البيانات"}</button>
                </form>
              )}

              {/* تبويب المتابعة — النظام الذكي الجديد (FollowUp) */}
              {tab === "timeline" && (
                <DrawerFollowups leadId={lead.id} stage={lead.stage} onChanged={refresh} />
              )}

              {/* تبويب مساعد كلود */}
              {tab === "ai" && (
                <div className="space-y-4">
                  <button onClick={analyze} disabled={analyzing} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
                    {analyzing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                    حلّل العميل
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
                          <button onClick={() => { navigator.clipboard.writeText(analysis.whatsapp); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="flex items-center gap-1 text-xs text-gold">
                            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} نسخ
                          </button>
                        </div>
                        <p className="whitespace-pre-wrap text-sm text-foreground">{analysis.whatsapp}</p>
                        <a href={`https://wa.me/966${lead.phone.replace(/^0/, "")}?text=${encodeURIComponent(analysis.whatsapp)}`} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-success/15 px-3 py-1.5 text-xs font-medium text-success hover:bg-success/25"><MessageCircle className="size-3.5" /> إرسال واتساب</a>
                      </div>

                      {analysis.source && <p className="text-center text-xs text-muted-foreground/60">المصدر: {analysis.source}</p>}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </aside>

      {lead && (
        <BookingForm
          open={showBooking}
          onClose={() => setShowBooking(false)}
          leadId={lead.id}
          leadName={lead.name}
          onDone={refresh}
        />
      )}
    </>
  );
}

function DrawerFollowups({ leadId, stage, onChanged }: { leadId: string; stage: LeadStage; onChanged: () => void }) {
  const { items, loading, reload } = useFollowUps(leadId);
  return (
    <div className="space-y-4">
      <FollowUpsForm leadId={leadId} stage={stage} projects={[]} onSaved={() => { reload(); onChanged(); }} />
      <FollowUpsTimeline items={items} loading={loading} />
    </div>
  );
}

function DField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
