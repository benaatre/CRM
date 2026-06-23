"use client";

import { useState, useTransition } from "react";
import type { FollowUpType, FollowUpResult, FollowUpSection, LeadStage } from "@prisma/client";

type Project = { id: string; name: string };

type SaveBody = {
  type: FollowUpType;
  result: FollowUpResult;
  section: FollowUpSection | null;
  stage: LeadStage;
  note?: string;
  nextDate?: string;
};

const CALL_NI_REASONS = ["الموقع", "السعر", "المساحة", "غير مهتم نهائيًا"];
const VISIT_REASONS = ["الموقع", "السعر", "المساحة"];
const NI_REASONS = ["الموقع", "السعر", "المساحة", "غير مهتم نهائيًا"];

const PANEL = "space-y-2 rounded-lg border border-gold/30 bg-gold/5 p-3";
const PANEL_NI = "space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3";

export function FollowUpsForm({
  leadId, stage, projects, onSaved, onBook,
}: {
  leadId: string;
  stage: LeadStage;
  projects: Project[];
  onSaved: () => void;
  onBook?: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [sel, setSel] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [visitMode, setVisitMode] = useState<"all" | "select">("all");
  const [selProjects, setSelProjects] = useState<Set<string>>(new Set());
  const [reasons, setReasons] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");

  // كتلة «غير مهتم» (مستقلة)
  const [niReasons, setNiReasons] = useState<Set<string>>(new Set());
  const [niNote, setNiNote] = useState("");
  const [niPlan, setNiPlan] = useState<"retry" | null>(null);
  const [niDate, setNiDate] = useState("");

  function openSel(k: string) {
    setSel(k); setError(null);
    setDate(""); setVisitMode("all"); setSelProjects(new Set()); setReasons(new Set()); setNote("");
  }
  function clearAll() {
    setSel(null); setDate(""); setVisitMode("all"); setSelProjects(new Set()); setReasons(new Set()); setNote("");
    setNiReasons(new Set()); setNiNote(""); setNiPlan(null); setNiDate(""); setError(null);
  }

  function save(body: SaveBody) {
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

  function toggle(setS: React.Dispatch<React.SetStateAction<Set<string>>>, v: string) {
    setS((s) => { const n = new Set(s); n.has(v) ? n.delete(v) : n.add(v); return n; });
  }

  // ===== مولّدات JSX (دوال — مو مكوّنات — عشان ما يفقد الإدخال التركيز) =====
  const opt = (k: string, label: string, onClick: () => void) => (
    <button type="button" onClick={onClick} className={`w-full rounded-lg border px-3 py-2.5 text-right text-sm transition-colors ${sel === k ? "border-gold bg-gold/15 text-gold" : "border-border text-muted-foreground hover:text-foreground"}`}>
      {label}
    </button>
  );
  const header = (title: string) => <div className="pt-2 text-xs font-semibold text-gold/80">{title}</div>;
  const saveBtn = (onClick: () => void, disabled?: boolean) => (
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
  const noteField = (v: string, set: (s: string) => void) => (
    <textarea value={v} onChange={(e) => set(e.target.value)} rows={2} placeholder="ملاحظة (اختياري)…" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-gold" />
  );
  const reasonsRow = (list: string[], setS: React.Dispatch<React.SetStateAction<Set<string>>>, cur: Set<string>) => (
    <div className="grid grid-cols-2 gap-2">
      {list.map((r) => (
        <button key={r} type="button" onClick={() => toggle(setS, r)} className={`rounded-lg border px-2.5 py-1.5 text-xs ${cur.has(r) ? "border-destructive bg-destructive/10 text-destructive" : "border-border text-muted-foreground"}`}>{r}</button>
      ))}
    </div>
  );

  // الأقسام تتصفّى حسب مرحلة العميل الحالية.
  const booked = stage === "RESERVED" || stage === "CLOSED_WON";
  const showContact = !booked && stage !== "CLOSED_LOST";
  const showInterested = stage === "INTERESTED" || stage === "FOLLOW_UP_LATER";
  const showNegotiation = stage === "VIEWING" || stage === "NEGOTIATION";
  const showNotInterested = stage === "CLOSED_LOST";

  return (
    <section className="glass space-y-2 rounded-2xl p-5">
      <h2 className="font-semibold text-foreground">وش صار؟</h2>

      {booked && (
        <p className="rounded-lg border border-success/30 bg-success/5 px-3 py-3 text-sm text-success">العميل محجوز — افتح ملف العميل لإدارة الحجز أو إلغائه.</p>
      )}

      {/* ── التواصل ── */}
      {showContact && <>
        {header("التواصل")}
        {opt("", "اتصلت — رد — مهتم", () => save({ type: "CALL", result: "INTERESTED_SENT_INFO", section: "INTERESTED", stage: "INTERESTED", note: "اتصلت — رد — مهتم" }))}

        {opt("callNI", "اتصلت — رد — غير مهتم", () => openSel("callNI"))}
        {sel === "callNI" && (
          <div className={PANEL_NI}>
            <span className="text-xs text-muted-foreground">السبب (اختياري — أكثر من واحد):</span>
            {reasonsRow(CALL_NI_REASONS, setReasons, reasons)}
            {noteField(note, setNote)}
            {saveBtn(() => save({ type: "CALL", result: "NOT_INTERESTED_FINAL", section: "NOT_INTERESTED", stage: "CLOSED_LOST", note: composeNote("اتصلت — رد — غير مهتم", [...reasons], note) }))}
          </div>
        )}

        {opt("", "اتصلت — ما رد", () => save({ type: "CALL", result: "NOT_ANSWERED_SCHEDULED", section: "NO_ANSWER", stage: "ATTEMPTED", note: "اتصلت — ما رد" }))}
        {opt("", "أرسلت له واتساب", () => save({ type: "WHATSAPP", result: "INTERESTED_SENT_INFO", section: null, stage, note: "أرسلت له واتساب" }))}
        {opt("", "هو اتصل بي — مهتم", () => save({ type: "CALL", result: "INTERESTED_SENT_INFO", section: "INTERESTED", stage: "INTERESTED", note: "هو اتصل بي — مهتم" }))}
      </>}

      {/* ── المهتم ── */}
      {showInterested && <>
        {header("المهتم")}
        {opt("visitDate", "جدّلت له زيارة", () => openSel("visitDate"))}
        {sel === "visitDate" && (
          <div className={PANEL}>
            {dateField("تاريخ ووقت الزيارة", date, setDate)}
            {noteField(note, setNote)}
            {saveBtn(() => save({ type: "VISIT_PROJECT", result: "INTERESTED_SCHEDULED", section: "INTERESTED", stage: "FOLLOW_UP_LATER", note: composeNote("جدّلت له زيارة", [], note), nextDate: date }), !date)}
          </div>
        )}

        {opt("", "زار الشركة", () => save({ type: "VISIT_OFFICE", result: "INTERESTED_VISITED", section: "INTERESTED", stage, note: "زار الشركة" }))}

        {opt("visitProjects", "زار المشاريع", () => openSel("visitProjects"))}
        {sel === "visitProjects" && (
          <div className={PANEL}>
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
            {noteField(note, setNote)}
            {saveBtn(() => {
              const detail = visitMode === "all" ? "زار جميع المشاريع" : `زار المشاريع: ${[...selProjects].join("، ")}`;
              save({ type: "VISIT_PROJECT", result: "INTERESTED_VISITED", section: "INTERESTED", stage: "VIEWING", note: composeNote(detail, [], note) });
            }, visitMode === "select" && selProjects.size === 0)}
          </div>
        )}

        {opt("visitNI", "زار ولم يناسبه", () => openSel("visitNI"))}
        {sel === "visitNI" && (
          <div className={PANEL_NI}>
            <span className="text-xs text-muted-foreground">السبب (اختياري — أكثر من واحد):</span>
            {reasonsRow(VISIT_REASONS, setReasons, reasons)}
            {noteField(note, setNote)}
            {saveBtn(() => save({ type: "VISIT_PROJECT", result: "NOT_INTERESTED_FINAL", section: "NOT_INTERESTED", stage: "CLOSED_LOST", note: composeNote("زار ولم يناسبه", [...reasons], note) }))}
          </div>
        )}
      </>}

      {/* ── التفاوض ── */}
      {showNegotiation && <>
        {header("التفاوض")}
        {opt("thinking", "لا يزال يفكر — جدّل متابعة", () => openSel("thinking"))}
        {sel === "thinking" && (
          <div className={PANEL}>
            {dateField("تاريخ ووقت المتابعة القادمة", date, setDate)}
            {noteField(note, setNote)}
            {saveBtn(() => save({ type: "CALL", result: "FOLLOW_UP_SCHEDULED", section: "INTERESTED", stage: "NEGOTIATION", note: composeNote("لا يزال يفكر — جدّل متابعة", [], note), nextDate: date }), !date)}
          </div>
        )}
        {onBook ? (
          opt("", "تم الحجز", () => onBook())
        ) : (
          <p className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">للحجز افتح ملف العميل.</p>
        )}
      </>}

      {/* ── غير مهتم ── */}
      {showNotInterested && <>
        {header("غير مهتم")}
        <div className={PANEL_NI}>
          <span className="text-xs text-muted-foreground">السبب (اختياري — أكثر من واحد):</span>
          {reasonsRow(NI_REASONS, setNiReasons, niReasons)}
          {noteField(niNote, setNiNote)}
          <div className="flex gap-2">
            <button type="button" onClick={() => setNiPlan(niPlan === "retry" ? null : "retry")} className={`flex-1 rounded-lg border px-2.5 py-1.5 text-xs ${niPlan === "retry" ? "border-gold bg-gold/15 text-gold" : "border-border text-muted-foreground"}`}>نحاول بعد فترة</button>
            <button type="button" onClick={() => save({ type: "CALL", result: "NOT_INTERESTED_FINAL", section: "NOT_INTERESTED", stage: "CLOSED_LOST", note: composeNote("غير مهتم — أُغلق نهائيًا", [...niReasons], niNote) })} disabled={pending} className="flex-1 rounded-lg border border-destructive/40 px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50">أغلق نهائيًا</button>
          </div>
          {niPlan === "retry" && (
            <div className="space-y-2">
              {dateField("تاريخ المحاولة القادمة", niDate, setNiDate)}
              {saveBtn(() => save({ type: "CALL", result: "FOLLOW_UP_SCHEDULED", section: "NOT_INTERESTED", stage: "FOLLOW_UP_LATER", note: composeNote("غير مهتم — نحاول بعد فترة", [...niReasons], niNote), nextDate: niDate }), !niDate)}
            </div>
          )}
        </div>
      </>}

      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
    </section>
  );
}

function composeNote(base: string, reasons: string[], extra: string): string {
  const parts = [base];
  if (reasons.length) parts.push(`الأسباب: ${reasons.join("، ")}`);
  if (extra.trim()) parts.push(extra.trim());
  return parts.join(" — ");
}
