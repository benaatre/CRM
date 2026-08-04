"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LeadStage } from "@prisma/client";
import { NI_REASONS, buildNotInterestedBody } from "@/components/leads/not-interested-dialog";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import {
  resultsFor, RESULT_LABEL, STEP_LABEL, FC_LABEL, buildBody, buildFirstContactBody,
  needsDate, needsNote, type InterestedStep, type FcKey, type SaveBody,
} from "@/lib/mobile-followup";
import { BottomSheet } from "./bottom-sheet";
import { MobileExternalLink } from "./external-link";

const optionBase = {
  boxSizing: "border-box" as const,
  minHeight: 44,
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

/** مواعيد سريعة — تحسب datetime-local محليًا بلا مكتبة. */
function quickDate(days: number, hour = 10): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function FollowupSheet({
  open,
  onClose,
  leadId,
  stage,
  firstContact,
  projects,
}: {
  open: boolean;
  onClose: () => void;
  leadId: string;
  stage: LeadStage;
  /** وضع «أول تواصل»: ما تحدّدت المرحلة الأولى ولا فيه متابعات. */
  firstContact: boolean;
  /** مشاريع الاختيار عند «زيارة» — نفس قائمة الويب. */
  projects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sel, setSel] = useState<string | null>(null);
  const [step, setStep] = useState<InterestedStep | null>(null);
  const [visitAction, setVisitAction] = useState<"schedule" | "done" | null>(null);
  const [noShowChoice, setNoShowChoice] = useState<"resched" | "reject" | null>(null);
  const [visitKind, setVisitKind] = useState<"project" | "office">("project");
  const [visitMode, setVisitMode] = useState<"all" | "select">("all");
  const [selProjects, setSelProjects] = useState<Set<string>>(new Set());
  const [reasons, setReasons] = useState<Set<string>>(new Set());
  const [retry, setRetry] = useState<"yes" | "no">("no");
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  const keys = firstContact ? (Object.keys(FC_LABEL) as FcKey[]) : resultsFor(stage);
  const label = (k: string) => (firstContact ? FC_LABEL[k as FcKey] : RESULT_LABEL[k]);

  const reset = () => {
    setSel(null); setStep(null); setVisitAction(null); setNoShowChoice(null);
    setReasons(new Set()); setRetry("no"); setNote(""); setDate(""); setError(null);
    setVisitKind("project"); setVisitMode("all"); setSelProjects(new Set());
  };
  const pick = (k: string) => { reset(); setSel(k); };

  // «غير مهتم» (وكذلك رفض «ما حضر») يمرّ بالمسار المشترك مع الويب.
  const isNi = sel === "notInterested" || (sel === "noShow" && noShowChoice === "reject");
  const showDate = !!sel && sel !== "booked" && (isNi ? retry === "yes" : needsDate(sel, step) || sel === "interested" || sel === "onhold");
  const showNote = !!sel && sel !== "booked";

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
      subtitle={firstContact ? "اختر نتيجة أول تواصل (إلزامي)" : "وش صار مع العميل؟"}
    >
      {/* أزرار النتائج — حسب المرحلة، من شجرة الويب نفسها */}
      <div className="flex flex-wrap" style={{ gap: 8, marginTop: 16 }}>
        {keys.map((k) => (
          <button key={k} type="button" onClick={() => pick(k)}
            style={{ ...optionBase, flex: 1, minWidth: "30%", ...(sel === k ? active : idle) }}>
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
          <MobileExternalLink
            href={`/leads/${leadId}`}
            className="flex w-full items-center justify-center"
            showIcon={false}
            style={{
              boxSizing: "border-box", marginTop: 11, height: 48, borderRadius: 12,
              background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg,
              fontSize: 14, fontWeight: 700,
            }}
          >
            افتح ملف العميل في الويب
          </MobileExternalLink>
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
              </div>
              <div className="flex flex-wrap" style={{ gap: 7, marginBottom: 10 }}>
                {[["بكرة", 1], ["بعد يومين", 2], ["الأسبوع الجاي", 7]].map(([l, d]) => (
                  <Chip key={String(l)} on={date === quickDate(d as number)} onClick={() => setDate(quickDate(d as number))}>
                    {l as string}
                  </Chip>
                ))}
              </div>
              <input
                type="datetime-local"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                style={{
                  boxSizing: "border-box", width: "100%", minHeight: 44,
                  background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
                  borderRadius: 10, padding: "0 12px", fontSize: 13,
                  color: MOBILE_COLORS.textPrimary, outline: "none",
                }}
              />
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

      {sel && sel !== "booked" && (
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="w-full"
          style={{
            boxSizing: "border-box", marginTop: 16, height: 52, borderRadius: 14, border: "none",
            background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg,
            fontSize: 16, fontWeight: 700, opacity: pending ? 0.6 : 1,
          }}
        >
          {pending ? "جارٍ الحفظ…" : "حفظ"}
        </button>
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
