"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Ban, BadgeCheck, Building2, CalendarDays, Check, Clock, Handshake, Heart, Landmark, MapPin,
  PauseCircle, PhoneOff, UserX, X,
} from "lucide-react";
import type { LeadStage } from "@prisma/client";
import { NI_REASONS, buildNotInterestedBody } from "@/components/leads/not-interested-dialog";
import { formatTime, RIYADH_TZ } from "@/lib/format";
import { parseRiyadhLocal } from "@/lib/ksa-time";
import { MOBILE_COLORS, SOP } from "@/lib/mobile-tokens";
import { avatarInitials } from "@/lib/mobile-avatar";
import {
  resultsFor, RESULT_LABEL, STEP_LABEL, FC_LABEL, buildBody, buildFirstContactBody,
  needsDate, needsNote, requiresDate, type InterestedStep, type FcKey, type SaveBody,
} from "@/lib/mobile-followup";
import { BottomSheet } from "./bottom-sheet";

/**
 * ورقة «تسجيل متابعة» — الشيت الفخم («أوبسيديان ناعم Pro»، client-file-premium):
 * إعادة تنسيق فقط — الشجرة والإلزام والجسم المُرسَل حرفيًا كما هي (lib/mobile-followup +
 * buildNotInterestedBody المشترك + POST /api/leads/[id]/followups + router.refresh).
 * المظهر: رأس يتلوّن بلون النتيجة (توهّج radial) + شريحة العميل، كروت نتائج بمربّع أيقونة
 * ملوّن يمتلئ عند الاختيار مع علامة صح وتوهّج، فروع تظهر بانسيابية (max-height)،
 * حقول تاريخ/وقت غائرة بأيقونات lucide، زر حفظ بتدرّج ذهبي. بلا إيموجي.
 */

const ZAIN = { fontFamily: "var(--font-zain), var(--font-sans)", fontVariantNumeric: "tabular-nums" as const };

/** لون وأيقونة كل نتيجة (المرجع): زيارة أزرق · موعد لاحق تركوازي · تفاوض بنفسجي · حسبة البنك أزرق
 *  · في الانتظار رمادي · غير مهتم أحمر · مهتم أخضر · لا يرد كهرماني · طلب لاحق تركوازي · تم الحجز ذهبي. */
function resultTone(key: string): { color: string; icon: React.ReactNode } {
  const ic = (el: React.ReactNode) => el;
  switch (key) {
    case "visit": return { color: SOP.blue, icon: ic(<MapPin size={18} strokeWidth={2} aria-hidden />) };
    case "appointment": return { color: SOP.teal, icon: ic(<CalendarDays size={18} strokeWidth={2} aria-hidden />) };
    case "negotiation": return { color: SOP.purple, icon: ic(<Handshake size={18} strokeWidth={2} aria-hidden />) };
    case "bankcheck": return { color: SOP.blue, icon: ic(<Landmark size={18} strokeWidth={2} aria-hidden />) };
    case "onhold": return { color: SOP.neutral, icon: ic(<PauseCircle size={18} strokeWidth={2} aria-hidden />) };
    case "notInterested": return { color: SOP.red, icon: ic(<Ban size={18} strokeWidth={2} aria-hidden />) };
    case "interested": return { color: SOP.green, icon: ic(<Heart size={18} strokeWidth={2} aria-hidden />) };
    case "noanswer": return { color: SOP.amber, icon: ic(<PhoneOff size={18} strokeWidth={2} aria-hidden />) };
    case "calllater": return { color: SOP.teal, icon: ic(<Clock size={18} strokeWidth={2} aria-hidden />) };
    case "noShow": return { color: SOP.amber, icon: ic(<UserX size={18} strokeWidth={2} aria-hidden />) };
    case "booked": return { color: SOP.gold, icon: ic(<BadgeCheck size={18} strokeWidth={2} aria-hidden />) };
    default: return { color: SOP.gold, icon: ic(<Check size={18} strokeWidth={2} aria-hidden />) };
  }
}

/** ملخص الموعد المختار بالعربي — القيمة المختارة تعني وقت حائط الرياض (نفس تفسير الخادم). */
function fmtPicked(dateOnly: string, timeOnly: string): string {
  const d = parseRiyadhLocal(`${dateOnly}T${timeOnly || "10:00"}`);
  const ds = new Intl.DateTimeFormat("ar-SA-u-nu-arab", { calendar: "gregory", timeZone: RIYADH_TZ, dateStyle: "medium" }).format(d);
  return `${ds} — ${formatTime(d)}`;
}

/** سطح غائر ناعم (حقول/مجموعات). */
const inset = {
  boxSizing: "border-box" as const,
  background: SOP.page,
  border: `1px solid ${SOP.edge}`,
  boxShadow: `inset 3px 3px 8px ${SOP.sd}, inset -3px -3px 8px ${SOP.sl}`,
};

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

  // لون الرأس يتبع النتيجة المختارة (ذهبي قبل الاختيار).
  const accent = sel ? resultTone(sel).color : SOP.gold;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={firstContact ? "سجّل أول تواصل" : "تسجيل متابعة"}
      subtitle={
        <span className="flex items-center" style={{ gap: 8 }}>
          <span className="flex flex-none items-center justify-center" style={{ boxSizing: "border-box", width: 26, height: 26, borderRadius: 8, fontSize: 10.5, fontWeight: 800, background: `linear-gradient(135deg, ${SOP.gold2}, ${SOP.gold})`, color: SOP.onGold }} aria-hidden>
            {avatarInitials(leadName)}
          </span>
          <span style={{ fontSize: 12, fontWeight: 700, color: SOP.tx }}>{leadName}</span>
          <span dir="ltr" style={{ ...ZAIN, fontSize: 11, color: SOP.mut }}>{phone}</span>
        </span>
      }
      footer={
        sel && sel !== "booked" ? (
          <button
            type="button"
            onClick={submit}
            disabled={saveDisabled}
            className="m-press-sc m-sweep flex w-full items-center justify-center"
            style={{
              boxSizing: "border-box", height: 52, gap: 8, borderRadius: 14, border: "none",
              background: `linear-gradient(135deg, ${SOP.gold2}, ${SOP.gold})`, color: SOP.onGold,
              fontSize: 16, fontWeight: 700, opacity: saveDisabled ? 0.6 : 1,
              boxShadow: saveDisabled ? "none" : `0 8px 20px color-mix(in srgb, ${SOP.gold} 35%, transparent)`,
            }}
          >
            <Check size={18} strokeWidth={2.4} aria-hidden />
            {pending ? "جارٍ الحفظ…" : dateRequired && !dateOnly ? "اختر تاريخ الموعد أولًا" : "حفظ"}
          </button>
        ) : null
      }
    >
      {/* توهّج الرأس — يبدّل لونه مع النتيجة المختارة (زخرفة بحتة، يمتد لحافتي الورقة) */}
      <div
        aria-hidden
        style={{
          height: 54, margin: "-6px -18px 0", pointerEvents: "none",
          background: `radial-gradient(ellipse 70% 100% at 50% 0%, color-mix(in srgb, ${accent} 26%, transparent), transparent 70%)`,
          transition: "background .35s ease",
        }}
      />

      {/* كروت النتائج — عمودان، حسب المرحلة، من شجرة الويب نفسها */}
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", color: SOP.mut, marginTop: -30, marginBottom: 8 }}>
        {firstContact ? "نتيجة أول تواصل" : "نتيجة المتابعة"}
      </div>
      <div className="grid grid-cols-2" style={{ gap: 8 }}>
        {keys.map((k) => {
          const on = sel === k;
          const t = resultTone(k);
          return (
            <button
              key={k}
              type="button"
              onClick={() => pick(k)}
              aria-pressed={on}
              className={`${on ? "" : "m-raise"} m-press-sc relative flex items-center`}
              style={{
                boxSizing: "border-box", minHeight: 54, gap: 9, borderRadius: 13, padding: "0 10px", fontSize: 13, fontWeight: 700, textAlign: "start",
                ...(on
                  ? { background: `color-mix(in srgb, ${t.color} 12%, ${SOP.plane})`, color: t.color, border: `1px solid ${t.color}`, boxShadow: `0 0 16px color-mix(in srgb, ${t.color} 35%, transparent)` }
                  : { color: SOP.tx2 }),
              }}
            >
              <span className="flex flex-none items-center justify-center" style={{ boxSizing: "border-box", width: 32, height: 32, borderRadius: 10, background: on ? t.color : `color-mix(in srgb, ${t.color} 14%, transparent)`, color: on ? SOP.onGold : t.color, transition: "background .2s" }}>
                {on ? <Check size={17} strokeWidth={2.6} aria-hidden /> : t.icon}
              </span>
              <span className="min-w-0 truncate">{label(k)}</span>
            </button>
          );
        })}
      </div>

      {/* «تم الحجز»: نموذج الحجز الكامل (وحدة/أسعار/دفعات) في الويب — لا نسخة مبسّطة تفوّت حقولًا مالية */}
      <Reveal open={sel === "booked"}>
        <div style={{ ...inset, marginTop: 14, borderRadius: 14, padding: 13, borderInlineStart: `3px solid ${SOP.gold}` }}>
          <p style={{ fontSize: 13, color: SOP.tx2, lineHeight: 1.7 }}>
            تسجيل الحجز يفتح نموذج الحجز الكامل (الوحدة والأسعار والدفعات) في ملف العميل على الويب.
          </p>
          <p style={{ boxSizing: "border-box", marginTop: 11, borderRadius: 12, padding: "11px 13px", background: `color-mix(in srgb, ${SOP.gold} 10%, transparent)`, color: SOP.mut, fontSize: 11.5, lineHeight: 1.8 }}>
            سجّل الحجز من الديسكتوب — نموذج الوحدة والدفعات ما انتقل للتطبيق بعد.
          </p>
        </div>
      </Reveal>

      {/* خطوة «مهتم» الاختيارية */}
      <Reveal open={sel === "interested" && !firstContact}>
        <Group title="الخطوة الجاية (اختياري)">
          {(Object.keys(STEP_LABEL) as InterestedStep[]).map((s) => (
            <Chip key={s} on={step === s} onClick={() => setStep(step === s ? null : s)}>{STEP_LABEL[s]}</Chip>
          ))}
        </Group>
      </Reveal>

      {/* زر «زيارة»: جدولة أو تسجيل زيارة تمّت */}
      <Reveal open={sel === "visit"}>
        <Group title="نوع الإجراء">
          <Chip on={visitAction !== "done"} onClick={() => setVisitAction("schedule")} icon={<CalendarDays size={13} strokeWidth={2} aria-hidden />}>جدولة موعد</Chip>
          {stage === "VISIT_SCHEDULED" && (
            <Chip on={visitAction === "done"} onClick={() => setVisitAction("done")} icon={<Check size={13} strokeWidth={2.4} aria-hidden />}>تمت الزيارة</Chip>
          )}
        </Group>
        <Group title="مكان الزيارة">
          <Chip on={visitKind === "project"} onClick={() => setVisitKind("project")} icon={<Building2 size={13} strokeWidth={2} aria-hidden />}>زيارة المشروع</Chip>
          <Chip on={visitKind === "office"} onClick={() => setVisitKind("office")} icon={<MapPin size={13} strokeWidth={2} aria-hidden />}>زيارة للمكتب</Chip>
        </Group>
        <Reveal open={visitKind === "project"}>
          <Group title="أي مشروع؟">
            <Chip on={visitMode === "all"} onClick={() => setVisitMode("all")}>جميع المشاريع</Chip>
            <Chip on={visitMode === "select"} onClick={() => setVisitMode("select")}>حدد المشاريع</Chip>
          </Group>
        </Reveal>
        <Reveal open={visitKind === "project" && visitMode === "select"}>
          <Group title="المشاريع">
            {projects.length === 0 ? (
              <span style={{ fontSize: "12.5px", color: SOP.mut }}>ما فيه مشاريع</span>
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
        </Reveal>
      </Reveal>

      {/* «ما حضر» بتدرّج */}
      <Reveal open={sel === "noShow"}>
        <Group title="وش نسوي؟">
          <Chip on={noShowChoice === "resched"} onClick={() => setNoShowChoice("resched")} icon={<CalendarDays size={13} strokeWidth={2} aria-hidden />}>إعادة جدولة</Chip>
          <Chip on={noShowChoice === "reject"} onClick={() => setNoShowChoice("reject")} tone={SOP.red} icon={<Ban size={13} strokeWidth={2} aria-hidden />}>انسحب</Chip>
        </Group>
      </Reveal>

      {/* أسباب «غير مهتم» + نحاول لاحقًا — نفس أسباب الويب */}
      <Reveal open={isNi}>
        <Group title="السبب">
          {NI_REASONS.map((r: string) => (
            <Chip key={r} on={reasons.has(r)} tone={SOP.red} onClick={() => setReasons((s) => {
              const n = new Set(s); if (n.has(r)) n.delete(r); else n.add(r); return n;
            })}>{r}</Chip>
          ))}
        </Group>
        <Group title="نحاول معه لاحقًا؟">
          <Chip on={retry === "yes"} onClick={() => setRetry("yes")}>نحاول لاحقًا</Chip>
          <Chip on={retry === "no"} onClick={() => setRetry("no")} tone={SOP.red}>نهائي</Chip>
        </Group>
      </Reveal>

      {/* الملاحظة + الموعد */}
      <Reveal open={showNote}>
        <div className="flex flex-col" style={{ gap: 11, marginTop: 16 }}>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={needsNote(sel ?? "") ? "اكتب سبب الانتظار (إلزامي)…" : "اكتب ملاحظة…"}
            rows={3}
            style={{
              ...inset, borderRadius: 14, padding: "12px 13px", minHeight: 84, fontSize: 13,
              color: SOP.tx, resize: "vertical", outline: "none",
            }}
          />
          <Reveal open={showDate}>
            <div style={{ ...inset, borderRadius: 14, padding: "12px 13px" }}>
              <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
                <span className="flex items-center" style={{ gap: 6, fontSize: 13, color: SOP.tx2 }}>
                  <CalendarDays size={14} strokeWidth={2} aria-hidden /> الموعد الجاي
                </span>
                {/* شارة الإلزام — «مطلوب» فقط للنتائج التي يفرضها الخادم، والبقية اختيارية */}
                <span
                  style={{
                    boxSizing: "border-box", borderRadius: 7, padding: "3px 8px",
                    fontSize: "10.5px", fontWeight: 700,
                    ...(dateRequired
                      ? { background: `color-mix(in srgb, ${SOP.gold} 14%, transparent)`, color: SOP.gold, border: `1px solid color-mix(in srgb, ${SOP.gold} 40%, transparent)` }
                      : { background: SOP.plane, color: SOP.mut, border: `1px solid ${SOP.edge}` }),
                  }}
                >
                  {dateRequired ? "مطلوب" : "اختياري"}
                </span>
              </div>

              {/* منتقيان أصليان كبيران جنب بعض — بلا مواعيد جاهزة */}
              <div className="flex" style={{ gap: 8 }}>
                <label className="flex flex-col justify-center" style={{ boxSizing: "border-box", flex: 1, minHeight: 52, gap: 3, background: SOP.plane, border: `1px solid ${SOP.edge}`, borderRadius: 12, padding: "7px 12px" }}>
                  <span className="flex items-center" style={{ gap: 5, fontSize: "11.5px", color: SOP.tx2 }}><CalendarDays size={13} strokeWidth={2} aria-hidden /> التاريخ</span>
                  <input
                    type="date"
                    value={dateOnly}
                    onChange={(e) => setDateOnly(e.target.value)}
                    style={{ background: "transparent", border: "none", outline: "none", width: "100%", fontSize: 13, color: SOP.tx }}
                  />
                </label>
                <label className="flex flex-col justify-center" style={{ boxSizing: "border-box", flex: 1, minHeight: 52, gap: 3, background: SOP.plane, border: `1px solid ${SOP.edge}`, borderRadius: 12, padding: "7px 12px" }}>
                  <span className="flex items-center" style={{ gap: 5, fontSize: "11.5px", color: SOP.tx2 }}><Clock size={13} strokeWidth={2} aria-hidden /> الوقت</span>
                  <input
                    type="time"
                    value={timeOnly}
                    onChange={(e) => setTimeOnly(e.target.value)}
                    style={{ background: "transparent", border: "none", outline: "none", width: "100%", fontSize: 13, color: SOP.tx }}
                  />
                </label>
              </div>
              <div style={{ fontSize: 11, color: SOP.mut, marginTop: 8 }}>
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
                    background: `color-mix(in srgb, ${SOP.blue} 14%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${SOP.blue} 35%, transparent)`,
                  }}
                >
                  <span className="flex items-center" style={{ ...ZAIN, gap: 6, fontSize: 12, fontWeight: 600, color: SOP.blue }}>
                    <CalendarDays size={13} strokeWidth={2} aria-hidden /> الموعد: {fmtPicked(dateOnly, timeOnly)}
                  </span>
                  <button
                    type="button"
                    aria-label="مسح الموعد"
                    onClick={() => { setDateOnly(""); setTimeOnly(""); }}
                    className="m-press-sc flex flex-none items-center"
                    style={{
                      boxSizing: "border-box", gap: 4, borderRadius: 8, padding: "4px 9px",
                      fontSize: "11.5px", fontWeight: 600, border: `1px solid color-mix(in srgb, ${SOP.blue} 35%, transparent)`,
                      background: "transparent", color: SOP.blue,
                    }}
                  >
                    <X size={12} strokeWidth={2.4} aria-hidden /> مسح
                  </button>
                </div>
              )}
            </div>
          </Reveal>
        </div>
      </Reveal>

      {error && (
        <p style={{
          marginTop: 12, borderRadius: 10, padding: "9px 12px", fontSize: 13, textAlign: "center",
          background: MOBILE_COLORS.roseBg, color: SOP.red,
          border: `1px solid color-mix(in srgb, ${SOP.red} 35%, transparent)`,
        }}>{error}</p>
      )}

    </BottomSheet>
  );
}

/** انسيابية ظهور الفروع — max-height + opacity (تحترم prefers-reduced-motion عبر media). */
function Reveal({ open, children }: { open: boolean; children: React.ReactNode }) {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return (
    <div
      aria-hidden={!open}
      style={{
        display: "grid",
        gridTemplateRows: open ? "1fr" : "0fr",
        opacity: open ? 1 : 0,
        transition: reduced ? "none" : "grid-template-rows .28s cubic-bezier(.22,1,.36,1), opacity .22s ease",
        pointerEvents: open ? "auto" : "none",
      }}
    >
      <div style={{ minHeight: 0, overflow: "hidden" }}>{open ? children : null}</div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ ...inset, marginTop: 14, borderRadius: 14, padding: 13 }}>
      <div style={{ fontSize: 12, color: SOP.gold, fontWeight: 700, marginBottom: 9 }}>{title}</div>
      <div className="flex flex-wrap" style={{ gap: 7 }}>{children}</div>
    </div>
  );
}

/** شريحة الاختيار المعتمدة — مفعّلة بلونها (ذهبي افتراضيًا) وعلامة صح، خاملة بسطح بارز. */
function Chip({ on, onClick, children, tone = SOP.gold, icon }: { on: boolean; onClick: () => void; children: React.ReactNode; tone?: string; icon?: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`${on ? "" : "m-raise"} m-press-sc flex items-center`}
      style={{
        boxSizing: "border-box", minHeight: 44, gap: 5,
        padding: "0 12px", borderRadius: 11, fontSize: "12.5px", fontWeight: 600,
        ...(on
          ? { background: `color-mix(in srgb, ${tone} 14%, transparent)`, color: tone, border: `1px solid ${tone}` }
          : { color: SOP.tx2 }),
      }}>
      {on ? <Check size={13} strokeWidth={2.5} aria-hidden /> : icon}
      {children}
    </button>
  );
}

export default FollowupSheet;
