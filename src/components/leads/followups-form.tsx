"use client";

import { useState, useTransition } from "react";
import type { FollowUpType, FollowUpResult, FollowUpSection, LeadStage, FirstContactStage } from "@prisma/client";
import { stageLabels } from "@/lib/labels";
import { NotInterestedReasons, buildNotInterestedBody } from "./not-interested-dialog";

type Project = { id: string; name: string };
type SaveBody = {
  type: FollowUpType;
  result: FollowUpResult;
  section: FollowUpSection;
  stage: LeadStage;
  note?: string;
  nextDate?: string;
};

// أزرار نتيجة المتابعة المتاحة حسب مرحلة العميل الحالية — كل مرحلة تعرض خطواتها
// المباشرة التالية فقط (حسب قمع المبيعات)، لا كل الخيارات مع بعض.
function resultsFor(stage: LeadStage): string[] {
  switch (stage) {
    // أول تواصل: لسة ما تأكّد اهتمامه → نتائج الاتصال الأول فقط.
    case "NEW":
    case "ATTEMPTED":
      return ["interested", "noanswer", "appointment", "notInterested"];
    // مهتم: نحرّكه للأمام (موعد/زيارة/تفاوض) أو لم يرد أو ينسحب.
    case "INTERESTED":
      return ["appointment", "visit", "negotiation", "noanswer", "notInterested"];
    // موعد لاحق: نعاود ونحاول نوصله لزيارة.
    case "FOLLOW_UP_LATER":
      return ["interested", "noanswer", "visit", "notInterested"];
    // زار المشروع: إما تفاوض أو ينسحب.
    case "VIEWING":
      return ["negotiation", "notInterested"];
    // تفاوض: إما يحجز أو ينسحب.
    case "NEGOTIATION":
      return ["booked", "notInterested"];
    default:
      return [];
  }
}

const LABEL: Record<string, string> = {
  interested: "مهتم", noanswer: "لم يرد", appointment: "موعد لاحق",
  visit: "زيارة", negotiation: "تفاوض", notInterested: "غير مهتم", booked: "تم الحجز",
};

export function FollowUpsForm({
  leadId, stage, firstContactStage, projects, onSaved, onBook,
}: {
  leadId: string;
  stage: LeadStage;
  firstContactStage?: FirstContactStage | null;
  projects: Project[];
  onSaved: () => void;
  onBook?: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [fcSel, setFcSel] = useState<"interested" | "noanswer" | "notInterested" | null>(null);

  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const [visitMode, setVisitMode] = useState<"all" | "select">("all");
  const [selProjects, setSelProjects] = useState<Set<string>>(new Set());
  const [reasons, setReasons] = useState<Set<string>>(new Set());
  const [niRetry, setNiRetry] = useState<"yes" | "no">("no");

  const buttons = resultsFor(stage);

  function pick(key: string) {
    if (key === "booked") { onBook?.(); return; }
    setSel(key); setError(null);
    setNote(""); setDate(""); setVisitMode("all"); setSelProjects(new Set()); setReasons(new Set()); setNiRetry("no");
  }
  function clearAll() {
    setSel(null); setNote(""); setDate(""); setVisitMode("all"); setSelProjects(new Set()); setReasons(new Set()); setNiRetry("no"); setError(null);
  }
  function toggle(setS: React.Dispatch<React.SetStateAction<Set<string>>>, v: string) {
    setS((s) => { const n = new Set(s); if (n.has(v)) n.delete(v); else n.add(v); return n; });
  }
  function compose(base: string, rs: string[], extra: string) {
    const parts = [base];
    if (rs.length) parts.push(`الأسباب: ${rs.join("، ")}`);
    if (extra.trim()) parts.push(extra.trim());
    return parts.join(" — ");
  }

  function post(body: SaveBody) {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/leads/${leadId}/followups`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.error ?? "صار خطأ"); return; }
      clearAll();
      onSaved();
    });
  }

  function submit() {
    if (!sel) return;
    switch (sel) {
      case "interested":
        return post({ type: "CALL", result: "INTERESTED_SENT_INFO", section: "INTERESTED", stage: "INTERESTED", note: compose("مهتم", [], note) });
      case "noanswer":
        return post({ type: "CALL", result: "NOT_ANSWERED_SCHEDULED", section: "NO_ANSWER", stage: "ATTEMPTED", note: compose("لم يرد", [], note) });
      case "appointment":
        return post({ type: "CALL", result: "INTERESTED_SCHEDULED", section: "INTERESTED", stage: "FOLLOW_UP_LATER", note: compose("موعد لاحق", [], note), nextDate: date });
      case "visit": {
        const detail = visitMode === "all" ? "زيارة — جميع المشاريع" : `زيارة — ${[...selProjects].join("، ")}`;
        return post({ type: "VISIT_PROJECT", result: "INTERESTED_VISITED", section: "INTERESTED", stage: "VIEWING", note: compose(detail, [], note), nextDate: date });
      }
      case "negotiation":
        return post({ type: "CALL", result: "NEGOTIATING", section: "INTERESTED", stage: "NEGOTIATION", note: compose("تفاوض", [], note) });
      case "notInterested":
        // منطق «غير مهتم» موحّد عبر المكوّن المشترك (نفس النتيجة المنظّمة ونفس الملاحظة).
        return post(buildNotInterestedBody(reasons, niRetry, date, note));
    }
  }

  // أول تواصل: ٣ خيارات إلزامية تحدّد المرحلة الأولى ومرحلة العميل.
  const FC_MAP = {
    interested: { result: "INTERESTED_SENT_INFO", section: "INTERESTED", stage: "INTERESTED", label: "مهتم" },
    noanswer: { result: "NOT_ANSWERED_SCHEDULED", section: "NO_ANSWER", stage: "ATTEMPTED", label: "لا يرد" },
    notInterested: { result: "NOT_INTERESTED_FINAL", section: "NOT_INTERESTED", stage: "CLOSED_LOST", label: "غير مهتم" },
  } as const;
  function submitFirstContact() {
    if (!fcSel) return;
    // «غير مهتم» في أول تواصل = نفس منطق المتابعة العادية (أسباب منظّمة + retry).
    if (fcSel === "notInterested") {
      return post(buildNotInterestedBody(reasons, niRetry, date, note));
    }
    const m = FC_MAP[fcSel];
    post({ type: "CALL", result: m.result as FollowUpResult, section: m.section as FollowUpSection, stage: m.stage as LeadStage, note: compose(`تم تسجيل أول تواصل: ${m.label}`, [], note) });
  }

  // وضع «أول تواصل»: ما تحدّدت المرحلة الأولى بعد (null صريح) → الأزرار الثلاثة الإلزامية.
  if (firstContactStage === null) {
    return (
      <section className="glass space-y-3 rounded-2xl p-5">
        <h2 className="font-semibold text-foreground">سجّل أول تواصل مع العميل</h2>
        <p className="text-xs text-muted-foreground">اختر نتيجة أول تواصل (إلزامي):</p>
        <div className="flex flex-wrap gap-2">
          {(["interested", "noanswer", "notInterested"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => { setFcSel(k); setError(null); setReasons(new Set()); setNiRetry("no"); setDate(""); }}
              className={`rounded-lg border px-4 py-2 text-sm transition-colors ${fcSel === k ? "border-[#22c55e] bg-[#22c55e]/15 text-[#22c55e]" : "border-border text-muted-foreground hover:text-foreground"}`}
            >
              {FC_MAP[k].label}
            </button>
          ))}
        </div>
        {fcSel && (
          <div className="space-y-3 rounded-xl border border-gold/30 bg-gold/5 p-3">
            {/* «غير مهتم» في أول تواصل: نفس شرائح الأسباب المنظّمة + «نحاول لاحقًا» */}
            {fcSel === "notInterested" && (
              <NotInterestedReasons
                reasons={reasons}
                onToggle={(r) => toggle(setReasons, r)}
                retry={niRetry}
                onRetry={setNiRetry}
                date={date}
                onDate={setDate}
              />
            )}
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="ملاحظة (اختياري)…" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-gold" />
            {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
            <div className="flex justify-end">
              <button type="button" onClick={submitFirstContact} disabled={pending || (fcSel === "notInterested" && niRetry === "yes" && !date)} className="rounded-lg bg-primary px-5 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">{pending ? "جارٍ…" : "حفظ أول تواصل"}</button>
            </div>
          </div>
        )}
        {error && !fcSel && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
      </section>
    );
  }

  // تعطيل الحفظ لو الحقول الإجبارية ناقصة.
  const saveDisabled = pending || (
    sel === "appointment" ? !date
      : sel === "visit" ? !date || (visitMode === "select" && selProjects.size === 0)
        : sel === "notInterested" ? (niRetry === "yes" && !date)
          : false
  );

  if (buttons.length === 0) {
    return (
      <section className="glass rounded-2xl p-5 text-sm text-muted-foreground">
        ما فيه إجراءات متابعة لهذه المرحلة.
      </section>
    );
  }

  return (
    <section className="glass space-y-3 rounded-2xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-foreground">سجّل نتيجة المتابعة</h2>
        <span className="text-xs text-muted-foreground">الخيارات حسب المرحلة الحالية: <span className="text-gold">{stageLabels[stage]}</span></span>
      </div>

      <div className="flex flex-wrap gap-2">
        {buttons.map((k) => {
          if (k === "booked" && !onBook) {
            return <span key={k} className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">للحجز افتح ملف العميل</span>;
          }
          const active = sel === k;
          return (
            <button key={k} type="button" onClick={() => pick(k)} className={`rounded-lg border px-4 py-2 text-sm transition-colors ${active ? "border-[#22c55e] bg-[#22c55e]/15 text-[#22c55e]" : "border-border text-muted-foreground hover:text-foreground"}`}>
              {LABEL[k]}
            </button>
          );
        })}
      </div>

      {sel && sel !== "booked" && (
        <div className="space-y-3 rounded-xl border border-gold/30 bg-gold/5 p-3">
          {/* موعد لاحق: تاريخ */}
          {sel === "appointment" && (
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">تاريخ ووقت المتابعة القادمة</span>
              <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-gold" />
            </label>
          )}

          {/* زيارة: المشاريع + تاريخ */}
          {sel === "visit" && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <button type="button" onClick={() => setVisitMode("all")} className={`flex-1 rounded-lg border px-2.5 py-1.5 text-xs ${visitMode === "all" ? "border-gold bg-gold/15 text-gold" : "border-border text-muted-foreground"}`}>زار جميع المشاريع</button>
                <button type="button" onClick={() => setVisitMode("select")} className={`flex-1 rounded-lg border px-2.5 py-1.5 text-xs ${visitMode === "select" ? "border-gold bg-gold/15 text-gold" : "border-border text-muted-foreground"}`}>حدد المشاريع</button>
              </div>
              {visitMode === "select" && (
                <div className="grid grid-cols-2 gap-2 rounded-lg border border-border p-2">
                  {projects.length === 0 ? <span className="text-xs text-muted-foreground">ما فيه مشاريع</span> : projects.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-xs text-foreground">
                      <input type="checkbox" checked={selProjects.has(p.name)} onChange={() => toggle(setSelProjects, p.name)} />
                      {p.name}
                    </label>
                  ))}
                </div>
              )}
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">تاريخ ووقت الزيارة</span>
                <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-gold" />
              </label>
            </div>
          )}

          {/* غير مهتم: أسباب + نحاول لاحقًا — عبر المكوّن المشترك */}
          {sel === "notInterested" && (
            <NotInterestedReasons
              reasons={reasons}
              onToggle={(r) => toggle(setReasons, r)}
              retry={niRetry}
              onRetry={setNiRetry}
              date={date}
              onDate={setDate}
            />
          )}

          {/* ملاحظة (اختياري) لكل الأنواع */}
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="اكتب ملاحظة عن العميل…" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-gold" />

          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={clearAll} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground">إلغاء</button>
            <button type="button" onClick={submit} disabled={saveDisabled} className="rounded-lg bg-primary px-5 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">{pending ? "جارٍ…" : "حفظ"}</button>
          </div>
        </div>
      )}

      {error && !sel && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
    </section>
  );
}
