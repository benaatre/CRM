"use client";

import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import type { FollowUpResult } from "@prisma/client";
import { followUpSectionLabels, followUpSectionColor, followUpResultLabels, stageLabels } from "@/lib/labels";
import { formatDateTime, toArabicDigits, toRiyadhInputValue } from "@/lib/format";
import { NI_REASONS, NI_REASON_RESULT } from "./not-interested-dialog";
import type { FollowUpItem, SystemEvent } from "./use-followups";

/**
 * خيارات تعديل النتيجة للمدير — نفس أزرار الموظف البسيطة، كل زر يترجم داخليًا
 * للنتيجة الصحيحة (لا dropdown بأسماء enum التقنية). النتائج التاريخية النادرة
 * التي بلا زر تبقى معروضة كتسمية فقط — ليست خيار إنشاء.
 */
const EDIT_CHOICES: { label: string; result: FollowUpResult }[] = [
  { label: "مهتم", result: "INTERESTED_SCHEDULED" },
  { label: "زيارة", result: "INTERESTED_VISIT_SCHEDULED" },
  { label: "في الانتظار", result: "ON_HOLD" },
  { label: "حسبة البنك", result: "BANK_CHECK" },
  { label: "طلب التواصل في وقت آخر", result: "CALL_LATER" },
  { label: "لم يرد", result: "NOT_ANSWERED_SCHEDULED" },
];
const NI_RESULTS = new Set<FollowUpResult>(Object.values(NI_REASON_RESULT));

/**
 * سجل المتابعات + تعديل ضمن الصلاحية (الجزء ١ — التذكيرات):
 * الموظف يعدّل متابعته خلال ساعة (ملاحظة + موعد فقط)، والمالك/المدير أي وقت شامل النتيجة.
 * زر التعديل يظهر حسب canEdit من الخادم — والخادم يعيد فرض الصلاحية عند الحفظ.
 */
export function FollowUpsTimeline({ items, systemEvents = [], loading, leadId, onChanged }: {
  items: FollowUpItem[];
  /** أفعال النظام (بلا مستخدم) — تُدمج في السجل موسومةً، ولا تُعدّ متابعات. */
  systemEvents?: SystemEvent[];
  loading: boolean;
  leadId?: string;
  onChanged?: () => void;
}) {
  const [editing, setEditing] = useState<FollowUpItem | null>(null);

  // الدمج بالترتيب الزمني — المتابعات (بشرية) وأحداث النظام في خط واحد يقرأه الموظف.
  const timeline = [
    ...items.map((f) => ({ kind: "fu" as const, at: f.createdAt, fu: f })),
    ...systemEvents.map((s) => ({ kind: "sys" as const, at: s.createdAt, sys: s })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return (
    <div className="glass rounded-2xl p-5">
      <h2 className="mb-4 font-semibold text-foreground">سجل المتابعات ({toArabicDigits(items.length)})</h2>
      {loading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">جارٍ التحميل…</p>
      ) : timeline.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">ما فيه متابعات بعد.</p>
      ) : (
        <ol className="space-y-4 border-r border-border pr-4">
          {timeline.map((entry) => {
            // حدث من النظام: موسوم صراحةً، بلا اسم موظف، وبلا زر تعديل.
            if (entry.kind === "sys") {
              const s = entry.sys;
              return (
                <li key={`sys-${s.id}`} className="relative">
                  <span className="absolute -right-[1.30rem] top-1.5 size-2 rounded-full bg-muted-foreground/60" />
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="rounded-full border border-muted-foreground/30 bg-secondary/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                      title="إجراء نفّذه النظام تلقائيًا — ما سجّله أي موظف"
                    >⚙️ تلقائي — النظام</span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(s.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{s.note}</p>
                </li>
              );
            }
            const f = entry.fu;
            return (() => {
            const dotColor = f.section === "NOT_INTERESTED" || f.result.startsWith("NOT_INTERESTED")
              ? "bg-destructive"
              : f.section === "NO_ANSWER"
                ? "bg-warning"
                : f.result === "BOOKED"
                  ? "bg-success"
                  : "bg-gold";
            return (
              <li key={f.id} className="relative">
                <span className={`absolute -right-[1.30rem] top-1.5 size-2 rounded-full ${dotColor}`} />
                <div className="flex flex-wrap items-center gap-2">
                  {f.section && (
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] ${followUpSectionColor[f.section]}`}>
                      {followUpSectionLabels[f.section]}
                    </span>
                  )}
                  {/* كاتب المتابعة ظاهر في الصدر لا في الهامش: المتابعة القادمة مع عميل
                      منقول «بمحتواه» تخصّ مالكه السابق — الوسم يمنع سؤال «مين سجّل هذي؟» */}
                  {f.employeeName && (
                    f.byCurrentOwner ? (
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] ${f.mine ? "border-gold/30 bg-gold/10 text-gold" : "border-border bg-secondary/60 text-muted-foreground"}`}>
                        {f.employeeName}
                      </span>
                    ) : (
                      <span
                        className="rounded-full border border-info/40 bg-info/10 px-2 py-0.5 text-[10px] font-medium text-info"
                        title="سجّلها قبل نقل العميل إليك — ليست من تسجيلك"
                      >
                        {f.employeeName} · قبل نقل العميل
                      </span>
                    )
                  )}
                  <span className="text-xs text-muted-foreground">{formatDateTime(f.createdAt)}</span>
                  {f.edited && (
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground" title="عُدّلت بعد تسجيلها — الأصل محفوظ في سجل التدقيق">مُعدَّلة</span>
                  )}
                  {f.canEdit && leadId && (
                    <button
                      onClick={() => setEditing(f)}
                      className="rounded-lg border border-border p-1 text-muted-foreground hover:border-gold/40 hover:text-gold"
                      title={f.canEditResult ? "تعديل المتابعة (شامل النتيجة)" : "تعديل الملاحظة والموعد (خلال ساعة من التسجيل)"}
                    ><Pencil className="size-3" /></button>
                  )}
                </div>
                <p className="mt-1 text-sm font-medium text-foreground">{f.note || followUpResultLabels[f.result]}</p>
                {f.nextDate && <p className="mt-0.5 text-xs text-info">المتابعة القادمة: {formatDateTime(f.nextDate)}</p>}
                {f.stageAfter && <p className="mt-0.5 text-xs text-muted-foreground">انتقل إلى: {stageLabels[f.stageAfter]}</p>}
              </li>
            );
            })();
          })}
        </ol>
      )}

      {editing && leadId && (
        <EditFollowUpDialog
          item={editing}
          leadId={leadId}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChanged?.(); }}
        />
      )}
    </div>
  );
}

// التعبئة بوقت حائط الرياض (لا توقيت المتصفح) — نفس تفسير الخادم عند الحفظ.
const toLocalInput = toRiyadhInputValue;

function EditFollowUpDialog({ item, leadId, onClose, onSaved }: {
  item: FollowUpItem; leadId: string; onClose: () => void; onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState(item.note ?? "");
  const [nextDate, setNextDate] = useState(toLocalInput(item.nextDate));
  const [result, setResult] = useState(item.result);
  const [err, setErr] = useState<string | null>(null);

  function save() {
    setErr(null);
    startTransition(async () => {
      // ما تغيّر فقط يُرسل — غياب الحقل عند الخادم يعني «لا تلمسه»:
      // تعديل الملاحظة وحدها ما عاد يمسح موعد المتابعة القادم من العميل.
      const res = await fetch(`/api/leads/${leadId}/followups`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          followupId: item.id,
          ...(note !== (item.note ?? "") ? { note } : {}),
          ...(nextDate !== toLocalInput(item.nextDate) ? { nextDate: nextDate || null } : {}),
          ...(item.canEditResult && result !== item.result ? { result } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error ?? "صار خطأ"); return; }
      onSaved();
    });
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-3 rounded-2xl border border-border bg-card p-5 shadow-2xl">
          <h3 className="font-bold text-foreground">تعديل المتابعة</h3>
          <p className="text-xs text-muted-foreground">
            {item.canEditResult
              ? "تعديل مدير — تغيير النتيجة يحرّك مرحلة العميل بالمسار المعتاد."
              : "تقدر تعدّل الملاحظة والموعد خلال ساعة من التسجيل — النتيجة ما تتعدل."}
          </p>

          {item.canEditResult && (
            <div className="space-y-2">
              <span className="text-xs text-muted-foreground">النتيجة</span>
              {/* النتيجة الحالية بلا زر (تاريخية) تُعرض كتسمية — الاختيار الجديد بالأزرار فقط */}
              {!EDIT_CHOICES.some((c) => c.result === result) && !NI_RESULTS.has(result) && (
                <p className="rounded-lg bg-secondary/60 px-2.5 py-1.5 text-xs text-muted-foreground">الحالية: {followUpResultLabels[result]}</p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {EDIT_CHOICES.map((c) => (
                  <button key={c.result} type="button" onClick={() => setResult(c.result)} className={`rounded-lg border px-2.5 py-1.5 text-xs ${result === c.result ? "border-gold bg-gold/15 text-gold" : "border-border text-muted-foreground hover:text-foreground"}`}>{c.label}</button>
                ))}
                <button type="button" onClick={() => setResult(NI_RESULTS.has(result) ? result : NI_REASON_RESULT[NI_REASONS[0]])} className={`rounded-lg border px-2.5 py-1.5 text-xs ${NI_RESULTS.has(result) ? "border-destructive bg-destructive/10 text-destructive" : "border-border text-muted-foreground hover:text-foreground"}`}>غير مهتم</button>
              </div>
              {/* «غير مهتم»: السبب يحدد النتيجة المنظّمة — نفس أسباب الموظف */}
              {NI_RESULTS.has(result) && (
                <div className="grid grid-cols-2 gap-1.5">
                  {NI_REASONS.map((r) => (
                    <button key={r} type="button" onClick={() => setResult(NI_REASON_RESULT[r])} className={`rounded-lg border px-2.5 py-1.5 text-xs ${result === NI_REASON_RESULT[r] ? "border-destructive bg-destructive/10 text-destructive" : "border-border text-muted-foreground"}`}>{r}</button>
                  ))}
                </div>
              )}
            </div>
          )}

          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">الملاحظة</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-gold" />
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">موعد المتابعة القادم</span>
            <input type="datetime-local" value={nextDate} onChange={(e) => setNextDate(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-gold" />
          </label>

          {err && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{err}</p>}

          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground">إلغاء</button>
            <button onClick={save} disabled={pending} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">حفظ</button>
          </div>
        </div>
      </div>
    </>
  );
}
