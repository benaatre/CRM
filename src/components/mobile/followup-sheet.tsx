"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LeadStage } from "@prisma/client";
import { NI_REASONS, buildNotInterestedBody } from "@/components/leads/not-interested-dialog";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import {
  resultsFor, RESULT_LABEL, STEP_LABEL, FC_LABEL, buildBody, buildFirstContactBody,
  needsDate, needsNote, requiresDate, type InterestedStep, type FcKey, type SaveBody,
} from "@/lib/mobile-followup";
import { BottomSheet } from "./bottom-sheet";

const optionBase = {
  boxSizing: "border-box" as const,
  minHeight: 52,
  borderRadius: 12,
  fontSize: "13.5px",
  fontWeight: 600,
  padding: "0 14px",
};
const idle = {
  background: MOBILE_COLORS.card,
  color: MOBILE_COLORS.textSecondary,
  border: `1px solid ${MOBILE_COLORS.border}`,
};
const active = {
  background: MOBILE_COLORS.goldBg,
  color: MOBILE_COLORS.gold,
  border: `1px solid ${MOBILE_COLORS.goldBorder}`,
};

/** ملخص الموعد المختار بالعربي — التاريخ والوقت المحليان (نفس دلالة datetime-local السابقة). */
function fmtPicked(dateOnly: string, timeOnly: string): string {
  const d = new Date(`${dateOnly}T${timeOnly || "10:00"}`);
  const ds = new Intl.DateTimeFormat("ar-SA-u-nu-arab", { calendar: "gregory", dateStyle: "medium" }).format(d);
  const ts = new Intl.DateTimeFormat("ar-SA-u-nu-arab", { hour: "numeric", minute: "2-digit" }).format(d);
  return `${ds} — ${ts}`;
}

export function FollowupSheet({
  open,
  onClose,
  leadId,
  leadName,
  phone,
  stage,
  firstContact,
  projects,
  initialKey = null,
}: {
  open: boolean;
  onClose: () => void;
  leadId: string;
  /** اسم العميل ورقمه — يظهران تحت العنوان ليتأكد الموظف أنه على العميل الصح. */
  leadName: string;
  phone: string;
  stage: LeadStage;
  /** وضع «أول تواصل»: ما تحدّدت المرحلة الأولى ولا فيه متابعات. */
  firstContact: boolean;
  /** مشاريع الاختيار عند «زيارة» — نفس قائمة الويب. */
  projects: { id: string; name: string }[];
  /** فتح الورقة على نتيجة محددة مسبقًا (زر «تم الحجز» بملف العميل مثلًا). */
  initialKey?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sel, setSel] = useState<string | null>(initialKey);
  // إعادة الضبط على النتيجة المسبقة عند كل فتح (الورقة تبقى مركّبة بين الفتحات).
  useEffect(() => { if (open) setSel(initialKey); }, [open, initialKey]);
  const [step, setStep] = useState<InterestedStep | null>(null);
  const [visitAction, setVisitAction] = useState<"schedule" | "done" | null>(null);
  const [noShowChoice, setNoShowChoice] = useState<"resched" | "reject" | null>(null);
  const [visitKind, setVisitKind] = useState<"project" | "office">("project");
  const [visitMode, setVisitMode] = useState<"all" | "select">("all");
  const [selProjects, setSelProjects] = useState<Set<string>>(new Set());
  const [reasons, setReasons] = useState<Set<string>>(new Set());
  const [retry, setRetry] = useState<"yes" | "no">("no");
  const [note, setNote] = useState("");
  // الموعد بمنتقيين أصليين منفصلين — التاريخ إن اختير، والوقت افتراضيه ١٠ صباحًا.
  const [dateOnly, setDateOnly] = useState("");
  const [timeOnly, setTimeOnly] = useState("");
  const [error, setError] = useState<string | null>(null);
  const date = dateOnly ? `${dateOnly}T${timeOnly || "10:00"}` : "";

  const keys = firstContact ? (Object.keys(FC_LABEL) as FcKey[]) : resultsFor(stage);
  const label = (k: string) => (firstContact ? FC_LABEL[k as FcKey] : RESULT_LABEL[k]);

  const reset = () => {
    setSel(null); setStep(null); setVisitAction(null); setNoShowChoice(null);
    setReasons(new Set()); setRetry("no"); setNote(""); setDateOnly(""); setTimeOnly(""); setError(null);
    setVisitKind("project"); setVisitMode("all"); setSelProjects(new Set());
  };
  const pick = (k: string) => { reset(); setSel(k); };

  // «غير مهتم» (وكذلك رفض «ما حضر») يمرّ بالمسار المشترك مع الويب.
  const isNi = sel === "notInterested" || (sel === "noShow" && noShowChoice === "reject");
  const showDate = !!sel && sel !== "booked" && (isNi ? retry === "yes" : needsDate(sel, step) || sel === "interested" || sel === "onhold");
  const showNote = !!sel && sel !== "booked";
  // الإلزام يطابق قواعد الخادم (requiresDate) — البقية اختيارية وزر الحفظ لا ينتظرها.
  const dateRequired = requiresDate({ key: sel, step, visitAction, noShowChoice, niRetry: retry, firstContact });
  const saveDisabled = pending || (dateRequired && !dateOnly);

  function submit() {
    if (!sel) return;
    let body: SaveBody | null;
    if (isNi) {
      body = buildNotInterestedBody(reasons, retry, date, note) as SaveBody;
      if (sel === "noShow") body = { ...body, note: `ما حضر — ${body.note ?? ""}` };
    } else if (firstContact) {
      body = buildFirstContactBody(sel as FcKey, note, date);
    } else {
      body = buildBody({
        key: sel, stage, step, visitAction,
        noShowChoice: noShowChoice === "resched" ? "resched" : null,
        note, date, visitKind, visitMode, selProjects: [...selProjects],
      });
    }
    if (!body) { setError("اختر خطوة"); return; }
    if (needsNote(sel) && !note.trim()) { setError("اكتب سبب الانتظار"); return; }
    if (sel === "visit" && visitKind === "project" && visitMode === "select" && selProjects.size === 0) {
      setError("اختر مشروعًا واحدًا على الأقل");
      return;
    }

    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/leads/${leadId}/followups`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error ?? "صار خطأ"); return; }
      reset();
      onClose();
      router.refresh();
    });
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={firstContact ? "سجّل أول تواصل" : "تسجيل متابعة"}
      subtitle={
        <span style={{ fontSize: 11, color: MOBILE_COLORS.textMuted }}>
          {leadName} · <span dir="ltr">{phone}</span>
        </span>
      }
      footer={
        sel && sel !== "booked" ? (
          <button
            type="button"
            onClick={submit}
            disabled={saveDisabled}
            className="m-press m-sweep w-full"
            style={{
              boxSizing: "border-box", height: 52, borderRadius: 14, border: "none",
              background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg,
              fontSize: 16, fontWeight: 700, opacity: saveDisabled ? 0.6 : 1,
            }}
          >
            {pending ? "جارٍ الحفظ…" : dateRequired && !dateOnly ? "اختر تاريخ الموعد أولًا" : "حفظ"}
          </button>
        ) : null
      }
    >
      {/* أزرار النتائج — عمودان، حسب المرحلة، من شجرة الويب نفسها */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 16 }}>
        {keys.map((k) => (
          <button key={k} type="button" onClick={() => pick(k)}
            style={{ ...optionBase, ...(sel === k ? active : idle) }}>
            {label(k)}
          </button>
        ))}
      </div>

      {/* «تم الحجز»: نموذج الحجز الكامل (وحدة/أسعار/دفعات) في الويب — لا نسخة مبسّطة تفوّت حقولًا مالية */}
      {sel === "booked" && (
        <div
          style={{
            boxSizing: "border-box", marginTop: 14, background: MOBILE_COLORS.bg,
            border: `1px solid ${MOBILE_COLORS.goldBorder}`, borderRadius: 14, padding: 13,
          }}
        >
          <p style={{ fontSize: 13, color: MOBILE_COLORS.textSecondary, lineHeight: 1.7 }}>
            تسجيل الحجز يفتح نموذج الحجز الكامل (الوحدة والأسعار والدفعات) في ملف العميل على الويب.
          </p>
          <p
            style={{
              boxSizing: "border-box", marginTop: 11, borderRadius: 12, padding: "11px 13px",
              background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
              color: MOBILE_COLORS.textMuted, fontSize: 11.5, lineHeight: 1.8,
            }}
          >
            سجّل الحجز من الديسكتوب — نموذج الوحدة والدفعات ما انتقل للتطبيق بعد.
          </p>
        </div>
      )}

      {/* خطوة «مهتم» الاختيارية */}
      {sel === "interested" && !firstContact && (
        <Group title="الخطوة الجاية (اختياري)">
          {(Object.keys(STEP_LABEL) as InterestedStep[]).map((s) => (
            <Chip key={s} on={step === s} onClick={() => setStep(step === s ? null : s)}>{STEP_LABEL[s]}</Chip>
          ))}
        </Group>
      )}

      {/* زر «زيارة»: جدولة أو تسجيل زيارة تمّت */}
      {sel === "visit" && (
        <Group title="نوع الإجراء">
          <Chip on={visitAction !== "done"} onClick={() => setVisitAction("schedule")}>جدولة موعد</Chip>
          {stage === "VISIT_SCHEDULED" && (
            <Chip on={visitAction === "done"} onClick={() => setVisitAction("done")}>تمت الزيارة</Chip>
          )}
        </Group>
      )}

      {sel === "visit" && (
        <>
          <Group title="مكان الزيارة">
            <Chip on={visitKind === "project"} onClick={() => setVisitKind("project")}>زيارة المشروع</Chip>
            <Chip on={visitKind === "office"} onClick={() => setVisitKind("office")}>زيارة للمكتب</Chip>
          </Group>
          {visitKind === "project" && (
            <Group title="أي مشروع؟">
              <Chip on={visitMode === "all"} onClick={() => setVisitMode("all")}>جميع المشاريع</Chip>
              <Chip on={visitMode === "select"} onClick={() => setVisitMode("select")}>حدد المشاريع</Chip>
            </Group>
          )}
          {visitKind === "project" && visitMode === "select" && (
            <Group title="المشاريع">
              {projects.length === 0 ? (
                <span style={{ fontSize: "12.5px", color: MOBILE_COLORS.textMuted }}>ما فيه مشاريع</span>
              ) : (
                projects.map((p) => (
                  <Chip
                    key={p.id}
                    on={selProjects.has(p.name)}
                    onClick={() => setSelProjects((s) => {
                      const n = new Set(s); if (n.has(p.name)) n.delete(p.name); else n.add(p.name); return n;
                    })}
                  >
                    {p.name}
                  </Chip>
                ))
              )}
            </Group>
          )}
        </>
      )}

      {/* «ما حضر» بتدرّج */}
      {sel === "noShow" && (
        <Group title="وش نسوي؟">
          <Chip on={noShowChoice === "resched"} onClick={() => setNoShowChoice("resched")}>إعادة جدولة</Chip>
          <Chip on={noShowChoice === "reject"} onClick={() => setNoShowChoice("reject")}>انسحب</Chip>
        </Group>
      )}

      {/* أسباب «غير مهتم» + نحاول لاحقًا — نفس أسباب الويب */}
      {isNi && (
        <>
          <Group title="السبب">
            {NI_REASONS.map((r: string) => (
              <Chip key={r} on={reasons.has(r)} onClick={() => setReasons((s) => {
                const n = new Set(s); if (n.has(r)) n.delete(r); else n.add(r); return n;
              })}>{r}</Chip>
            ))}
          </Group>
          <Group title="نحاول معه لاحقًا؟">
            <Chip on={retry === "yes"} onClick={() => setRetry("yes")}>نحاول لاحقًا</Chip>
            <Chip on={retry === "no"} onClick={() => setRetry("no")}>نهائي</Chip>
          </Group>
        </>
      )}

      {/* الملاحظة + الموعد */}
      {showNote && (
        <div className="flex flex-col" style={{ gap: 11, marginTop: 16 }}>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={needsNote(sel!) ? "اكتب سبب الانتظار (إلزامي)…" : "اكتب ملاحظة…"}
            rows={3}
            style={{
              boxSizing: "border-box", background: MOBILE_COLORS.bg,
              border: `1px solid ${MOBILE_COLORS.border}`, borderRadius: 14,
              padding: "12px 13px", minHeight: 84, fontSize: 13,
              color: MOBILE_COLORS.textPrimary, resize: "vertical", outline: "none",
            }}
          />
          {showDate && (
            <div style={{
              boxSizing: "border-box", background: MOBILE_COLORS.bg,
              border: `1px solid ${MOBILE_COLORS.border}`, borderRadius: 14, padding: "12px 13px",
            }}>
              <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
                <span style={{ fontSize: 13, color: MOBILE_COLORS.textSecondary }}>الموعد الجاي</span>
                {/* شارة الإلزام — «مطلوب» فقط للنتائج التي يفرضها الخادم، والبقية اختيارية */}
                <span
                  style={{
                    boxSizing: "border-box", borderRadius: 7, padding: "3px 8px",
                    fontSize: "10.5px", fontWeight: 600,
                    ...(dateRequired
                      ? { background: MOBILE_COLORS.goldBg, color: MOBILE_COLORS.gold, border: `1px solid ${MOBILE_COLORS.goldBorder}` }
                      : { background: MOBILE_COLORS.card, color: MOBILE_COLORS.textMuted, border: `1px solid ${MOBILE_COLORS.border}` }),
                  }}
                >
                  {dateRequired ? "مطلوب" : "اختياري"}
                </span>
              </div>

              {/* منتقيان أصليان كبيران جنب بعض — بلا مواعيد جاهزة */}
              <div className="flex" style={{ gap: 8 }}>
                <label
                  className="flex flex-col justify-center"
                  style={{
                    boxSizing: "border-box", flex: 1, minHeight: 52, gap: 3,
                    background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
                    borderRadius: 12, padding: "7px 12px",
                  }}
                >
                  <span style={{ fontSize: "11.5px", color: MOBILE_COLORS.textSecondary }}>📅 التاريخ</span>
                  <input
                    type="date"
                    value={dateOnly}
                    onChange={(e) => setDateOnly(e.target.value)}
                    style={{ background: "transparent", border: "none", outline: "none", width: "100%", fontSize: 13, color: MOBILE_COLORS.textPrimary }}
                  />
                </label>
                <label
                  className="flex flex-col justify-center"
                  style={{
                    boxSizing: "border-box", flex: 1, minHeight: 52, gap: 3,
                    background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
                    borderRadius: 12, padding: "7px 12px",
                  }}
                >
                  <span style={{ fontSize: "11.5px", color: MOBILE_COLORS.textSecondary }}>🕐 الوقت</span>
                  <input
                    type="time"
                    value={timeOnly}
                    onChange={(e) => setTimeOnly(e.target.value)}
                    style={{ background: "transparent", border: "none", outline: "none", width: "100%", fontSize: 13, color: MOBILE_COLORS.textPrimary }}
                  />
                </label>
              </div>
              <div style={{ fontSize: 11, color: MOBILE_COLORS.textMuted, marginTop: 8 }}>
                {dateRequired
                  ? "اضغط لفتح منتقي التاريخ والوقت"
                  : "اضغط لفتح منتقي التاريخ والوقت — أو اتركه فارغًا"}
              </div>

              {/* ملخص الموعد المختار + مسح */}
              {dateOnly && (
                <div
                  className="flex items-center justify-between"
                  style={{
                    boxSizing: "border-box", marginTop: 9, gap: 8, borderRadius: 10, padding: "8px 11px",
                    background: MOBILE_STATUS.info.bg,
                    border: `1px solid ${MOBILE_STATUS.info.border}`,
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 600, color: MOBILE_STATUS.info.fg }}>
                    🗓️ الموعد: {fmtPicked(dateOnly, timeOnly)}
                  </span>
                  <button
                    type="button"
                    onClick={() => { setDateOnly(""); setTimeOnly(""); }}
                    style={{
                      boxSizing: "border-box", flexShrink: 0, borderRadius: 8, padding: "4px 9px",
                      fontSize: "11.5px", fontWeight: 600, border: `1px solid ${MOBILE_STATUS.info.border}`,
                      background: "transparent", color: MOBILE_STATUS.info.fg,
                    }}
                  >
                    ✕ مسح
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <p style={{
          marginTop: 12, borderRadius: 10, padding: "9px 12px", fontSize: 13, textAlign: "center",
          background: MOBILE_STATUS.danger.bg, color: MOBILE_STATUS.danger.fg,
          border: `1px solid ${MOBILE_STATUS.danger.border}`,
        }}>{error}</p>
      )}

    </BottomSheet>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      boxSizing: "border-box", marginTop: 14, background: MOBILE_COLORS.bg,
      border: `1px solid ${MOBILE_COLORS.border}`, borderRadius: 14, padding: 13,
    }}>
      <div style={{ fontSize: 12, color: MOBILE_COLORS.gold, fontWeight: 600, marginBottom: 9 }}>{title}</div>
      <div className="flex flex-wrap" style={{ gap: 7 }}>{children}</div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      style={{
        boxSizing: "border-box", minHeight: 44, display: "flex", alignItems: "center",
        padding: "0 12px", borderRadius: 10, fontSize: "12.5px", fontWeight: 600,
        ...(on ? active : { background: MOBILE_COLORS.card, color: MOBILE_COLORS.textSecondary, border: `1px solid ${MOBILE_COLORS.border}` }),
      }}>
      {children}
    </button>
  );
}

export default FollowupSheet;
