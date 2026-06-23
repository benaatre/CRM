"use client";

import { useEffect, useState, useTransition } from "react";
import type { FollowUpType, FollowUpResult, FollowUpSection, LeadStage } from "@prisma/client";

type Project = { id: string; name: string };
type View = "interested" | "negotiation" | "noAnswer" | "notInterested";

type SaveBody = {
  type: FollowUpType;
  result: FollowUpResult;
  section: FollowUpSection;
  stage: LeadStage;
  note?: string;
  nextDate?: string;
};

function viewForStage(stage: LeadStage): View {
  switch (stage) {
    case "INTERESTED":
    case "VIEWING":
      return "interested";
    case "NEGOTIATION":
    case "RESERVED":
      return "negotiation";
    case "CLOSED_LOST":
      return "notInterested";
    default:
      return "noAnswer"; // NEW / ATTEMPTED / FOLLOW_UP_LATER
  }
}

const VISIT_REASONS = ["الموقع", "السعر", "المساحة"];
const NOT_INTERESTED_REASONS = ["سعر غير مناسب", "المساحات", "الموقع", "غير مهتم نهائيًا"];

export function FollowUpsForm({
  leadId, stage, projects, onSaved, onBook,
}: {
  leadId: string;
  stage: LeadStage;
  projects: Project[];
  onSaved: () => void;
  onBook?: () => void;
}) {
  const [view, setView] = useState<View>(viewForStage(stage));
  const [sel, setSel] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // حقول فرعية
  const [date, setDate] = useState("");
  const [visitMode, setVisitMode] = useState<"all" | "select">("all");
  const [selProjects, setSelProjects] = useState<Set<string>>(new Set());
  const [reasons, setReasons] = useState<Set<string>>(new Set());
  const [retry, setRetry] = useState<"yes" | "no">("no");
  const [retryDate, setRetryDate] = useState("");
  const [note, setNote] = useState("");

  // إعادة ضبط العرض على مرحلة العميل عند تغيّرها (بعد الحفظ).
  useEffect(() => { setView(viewForStage(stage)); }, [stage]);

  function clearFields() {
    setSel(null); setDate(""); setVisitMode("all"); setSelProjects(new Set());
    setReasons(new Set()); setRetry("no"); setRetryDate(""); setNote(""); setError(null);
  }

  function save(body: SaveBody, thenView?: View) {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/leads/${leadId}/followups`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.error ?? "صار خطأ"); return; }
      clearFields();
      if (thenView) setView(thenView);
      onSaved();
    });
  }

  function toggle(setS: React.Dispatch<React.SetStateAction<Set<string>>>, v: string) {
    setS((s) => { const n = new Set(s); n.has(v) ? n.delete(v) : n.add(v); return n; });
  }

  // ===== أزرار قابلة لإعادة الاستخدام =====
  const Opt = ({ k, label, onClick }: { k: string; label: string; onClick: () => void }) => (
    <button type="button" onClick={onClick} className={`w-full rounded-lg border px-3 py-2.5 text-right text-sm transition-colors ${sel === k ? "border-gold bg-gold/15 text-gold" : "border-border text-muted-foreground hover:text-foreground"}`}>
      {label}
    </button>
  );
  const SaveBtn = ({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) => (
    <button type="button" onClick={onClick} disabled={pending || disabled} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
      {pending ? "جارٍ…" : "حفظ المتابعة"}
    </button>
  );
  const dateField = (label: string, v: string, set: (s: string) => void) => (
    <label className="block space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input type="datetime-local" value={v} onChange={(e) => set(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-gold" />
    </label>
  );
  const noteField = (
    <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="ملاحظة (اختياري)…" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-gold" />
  );

  return (
    <section className="glass space-y-3 rounded-2xl p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-foreground">وش صار في المتابعة؟</h2>
        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
          {view === "interested" ? "مهتم" : view === "negotiation" ? "تفاوض" : view === "noAnswer" ? "لم يرد" : "غير مهتم"}
        </span>
      </div>

      {/* ===== لم يرد ===== */}
      {view === "noAnswer" && (
        <div className="space-y-2">
          <Opt k="callAgain" label="جُدّلت مكالمة أخرى" onClick={() => setSel("callAgain")} />
          {sel === "callAgain" && (
            <div className="space-y-2 rounded-lg border border-gold/30 bg-gold/5 p-3">
              {dateField("تاريخ ووقت المكالمة القادمة", date, setDate)}
              {noteField}
              <SaveBtn disabled={!date} onClick={() => save({ type: "CALL", result: "NOT_ANSWERED_SCHEDULED", section: "NO_ANSWER", stage: "ATTEMPTED", note: composeNote("جُدّلت مكالمة أخرى", [], note), nextDate: date })} />
            </div>
          )}
          <Opt k="" label="أُرسلت له رسالة واتساب" onClick={() => save({ type: "WHATSAPP", result: "NOT_ANSWERED_WHATSAPP", section: "NO_ANSWER", stage: "ATTEMPTED", note: "أُرسلت له رسالة واتساب" })} />
          <Opt k="" label="تم الرد — مهتم" onClick={() => { clearFields(); setView("interested"); }} />
          <Opt k="" label="تم الرد — غير مهتم" onClick={() => { clearFields(); setView("notInterested"); }} />
          <Opt k="" label="لم يرد للمرة الثانية" onClick={() => save({ type: "CALL", result: "NOT_ANSWERED_SCHEDULED", section: "NO_ANSWER", stage: "ATTEMPTED", note: "لم يرد للمرة الثانية" })} />
          <Opt k="" label="قام هو بالاتصال بي" onClick={() => { clearFields(); setView("interested"); }} />
        </div>
      )}

      {/* ===== مهتم ===== */}
      {view === "interested" && (
        <div className="space-y-2">
          <Opt k="" label="أُرسلت له رسالة واتساب" onClick={() => save({ type: "WHATSAPP", result: "INTERESTED_SENT_INFO", section: "INTERESTED", stage: "INTERESTED", note: "أُرسلت له رسالة واتساب" })} />

          <Opt k="visitDate" label="جُدّل موعد زيارة" onClick={() => setSel("visitDate")} />
          {sel === "visitDate" && (
            <div className="space-y-2 rounded-lg border border-gold/30 bg-gold/5 p-3">
              {dateField("تاريخ ووقت الزيارة", date, setDate)}
              {noteField}
              <SaveBtn disabled={!date} onClick={() => save({ type: "VISIT_PROJECT", result: "INTERESTED_SCHEDULED", section: "INTERESTED", stage: "INTERESTED", note: composeNote("جُدّل موعد زيارة", [], note), nextDate: date })} />
            </div>
          )}

          <Opt k="" label="زار الشركة" onClick={() => save({ type: "VISIT_OFFICE", result: "INTERESTED_VISITED", section: "INTERESTED", stage: "INTERESTED", note: "زار الشركة" })} />

          <Opt k="visitProjects" label="زار المشاريع" onClick={() => setSel("visitProjects")} />
          {sel === "visitProjects" && (
            <div className="space-y-2 rounded-lg border border-gold/30 bg-gold/5 p-3">
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
              {noteField}
              <SaveBtn
                disabled={visitMode === "select" && selProjects.size === 0}
                onClick={() => {
                  const detail = visitMode === "all" ? "زار جميع المشاريع" : `زار المشاريع: ${[...selProjects].join("، ")}`;
                  save({ type: "VISIT_PROJECT", result: "INTERESTED_VISITED", section: "INTERESTED", stage: "INTERESTED", note: composeNote(detail, [], note) });
                }}
              />
            </div>
          )}

          <Opt k="didntSuit" label="زار ولم يناسبه" onClick={() => setSel("didntSuit")} />
          {sel === "didntSuit" && (
            <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <span className="text-xs text-muted-foreground">السبب (اختياري — أكثر من واحد):</span>
              <div className="grid grid-cols-3 gap-2">
                {VISIT_REASONS.map((r) => (
                  <button key={r} type="button" onClick={() => toggle(setReasons, r)} className={`rounded-lg border px-2 py-1.5 text-xs ${reasons.has(r) ? "border-destructive bg-destructive/10 text-destructive" : "border-border text-muted-foreground"}`}>{r}</button>
                ))}
              </div>
              {noteField}
              {retryBlock()}
              <SaveBtn
                disabled={retry === "yes" && !retryDate}
                onClick={() => save({
                  type: "CALL",
                  result: retry === "yes" ? "FOLLOW_UP_SCHEDULED" : "NOT_INTERESTED_FINAL",
                  section: "NOT_INTERESTED",
                  stage: retry === "yes" ? "FOLLOW_UP_LATER" : "CLOSED_LOST",
                  note: composeNote("زار ولم يناسبه", [...reasons], note),
                  nextDate: retry === "yes" ? retryDate : undefined,
                })}
              />
            </div>
          )}

          <Opt k="" label="في مرحلة التفاوض" onClick={() => save({ type: "CALL", result: "NEGOTIATING", section: "INTERESTED", stage: "NEGOTIATION", note: "انتقل لمرحلة التفاوض" }, "negotiation")} />
        </div>
      )}

      {/* ===== تفاوض ===== */}
      {view === "negotiation" && (
        <div className="space-y-2">
          <Opt k="negFollow" label="زار ولم يرد — جدّل متابعة" onClick={() => setSel("negFollow")} />
          {sel === "negFollow" && (
            <div className="space-y-2 rounded-lg border border-gold/30 bg-gold/5 p-3">
              {dateField("تاريخ ووقت المتابعة القادمة", date, setDate)}
              {noteField}
              <SaveBtn disabled={!date} onClick={() => save({ type: "CALL", result: "FOLLOW_UP_SCHEDULED", section: "INTERESTED", stage: "NEGOTIATION", note: composeNote("زار ولم يرد — جدّل متابعة", [], note), nextDate: date })} />
            </div>
          )}
          {onBook ? (
            <Opt k="" label="تم الحجز" onClick={() => onBook()} />
          ) : (
            <p className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">للحجز افتح ملف العميل.</p>
          )}
        </div>
      )}

      {/* ===== غير مهتم ===== */}
      {view === "notInterested" && (
        <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <span className="text-xs text-muted-foreground">السبب (اختياري — أكثر من واحد):</span>
          <div className="grid grid-cols-2 gap-2">
            {NOT_INTERESTED_REASONS.map((r) => (
              <button key={r} type="button" onClick={() => toggle(setReasons, r)} className={`rounded-lg border px-2.5 py-2 text-xs ${reasons.has(r) ? "border-destructive bg-destructive/10 text-destructive" : "border-border text-muted-foreground"}`}>{r}</button>
            ))}
          </div>
          {noteField}
          {retryBlock()}
          <SaveBtn
            disabled={retry === "yes" && !retryDate}
            onClick={() => save({
              type: "CALL",
              result: retry === "yes" ? "FOLLOW_UP_SCHEDULED" : "NOT_INTERESTED_FINAL",
              section: "NOT_INTERESTED",
              stage: retry === "yes" ? "FOLLOW_UP_LATER" : "CLOSED_LOST",
              note: composeNote("غير مهتم", [...reasons], note),
              nextDate: retry === "yes" ? retryDate : undefined,
            })}
          />
        </div>
      )}

      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
    </section>
  );

  // كتلة «نحاول معه بعد فترة؟» (تُستخدم في «زار ولم يناسبه» و«غير مهتم»)
  function retryBlock() {
    return (
      <div className="space-y-2">
        <span className="text-xs text-muted-foreground">نحاول معه بعد فترة؟</span>
        <div className="flex gap-2">
          <button type="button" onClick={() => setRetry("yes")} className={`flex-1 rounded-lg border px-2.5 py-1.5 text-xs ${retry === "yes" ? "border-gold bg-gold/15 text-gold" : "border-border text-muted-foreground"}`}>نعم</button>
          <button type="button" onClick={() => setRetry("no")} className={`flex-1 rounded-lg border px-2.5 py-1.5 text-xs ${retry === "no" ? "border-gold bg-gold/15 text-gold" : "border-border text-muted-foreground"}`}>لا</button>
        </div>
        {retry === "yes" && dateField("تاريخ المحاولة القادمة", retryDate, setRetryDate)}
      </div>
    );
  }
}

function composeNote(base: string, reasons: string[], extra: string): string {
  const parts = [base];
  if (reasons.length) parts.push(`الأسباب: ${reasons.join("، ")}`);
  if (extra.trim()) parts.push(extra.trim());
  return parts.join(" — ");
}
