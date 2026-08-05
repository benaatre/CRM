"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, AlertTriangle, Share2, LogOut, Trash2 } from "lucide-react";
import type { DupGroup, DupMember } from "@/lib/data/duplicates";
import type { UnarchiveMode } from "@/lib/actions/leads";
import { distributeDuplicateLead, pullDuplicateLead, archiveDuplicateLead } from "@/lib/actions/leads";
import { stageChipClass } from "@/lib/stage-colors";
import { stageLabels, channelLabels, followUpResultLabels } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";
import { BottomSheet } from "@/components/mobile/bottom-sheet";

/**
 * أدوات «العملاء المكررون» على الجوال — طبقة عرض فوق أكشنز الديسكتوب نفسها:
 *   • distributeDuplicateLead(leadId, mode, toUserId)  ← زر «توزيع»
 *   • pullDuplicateLead(leadId)                        ← زر «سحب»
 *   • archiveDuplicateLead(leadId)                     ← زر «حذف» (أرشفة كمكرر)
 * الثلاثة محروسة داخلها بـ`role !== "OWNER"` والصفحة نفسها requireRole(OWNER).
 *
 * الفلاتر منسوخة حرفيًا من `duplicates-view.tsx`: الكل / اليوم / آخر ٧ أيام /
 * نطاق مخصص — والمرجع دائمًا **أحدث إضافة في المجموعة** (lastAddedAt).
 * فرقٌ واحد عن الديسكتوب: الحالة محليّة لا في الرابط (شاشة واحدة، فلتر عابر).
 */

// نافذة «آخر ٧ أيام» — متدحرجة على lastAddedAt (فلترة عرض فقط، لا صلاحيات).
const DUP_WEEK_MS = 7 * 24 * 3_600_000;

type Range = "" | "today" | "week" | "custom";
type Employee = { id: string; name: string };

/** نسخة `inRange` من الديسكتوب حرفيًا — «متى تجدّد هذا التكرار» لا متى بدأ. */
function inRange(g: DupGroup, range: Range, from: string, to: string, weekCutoff: number): boolean {
  const t = new Date(g.lastAddedAt).getTime();
  if (range === "today") return g.newToday;
  if (range === "week") return t >= weekCutoff;
  if (range === "custom" && (from || to)) {
    // النطاق شامل للطرفين: «من» من أول اليوم، و«إلى» لآخر لحظة فيه.
    if (from && t < new Date(`${from}T00:00:00`).getTime()) return false;
    if (to && t > new Date(`${to}T23:59:59.999`).getTime()) return false;
  }
  return true;
}

const chipStyle = (on: boolean) => ({
  boxSizing: "border-box" as const, minHeight: 36, padding: "0 13px", borderRadius: 18,
  fontSize: "12.5px", fontWeight: 600, whiteSpace: "nowrap" as const,
  ...(on
    ? { background: MOBILE_COLORS.goldBg, color: MOBILE_COLORS.gold, border: `1px solid ${MOBILE_COLORS.goldBorder}` }
    : { background: MOBILE_COLORS.card, color: MOBILE_COLORS.textSecondary, border: `1px solid ${MOBILE_COLORS.border}` }),
});

const fieldStyle = {
  boxSizing: "border-box" as const, width: "100%", minHeight: 44,
  background: MOBILE_COLORS.bg, border: `1px solid ${MOBILE_COLORS.border}`,
  borderRadius: 10, padding: "0 12px", fontSize: 13,
  color: MOBILE_COLORS.textPrimary, outline: "none",
};

export function MobileDuplicatesPanel({
  groups, totalGroups, newTodayGroups, employees,
}: {
  groups: DupGroup[];
  totalGroups: number;
  newTodayGroups: number;
  employees: Employee[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [range, setRange] = useState<Range>("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  /** العميل المفتوحة له ورقة التوزيع. */
  const [distTarget, setDistTarget] = useState<DupMember | null>(null);
  const [mode, setMode] = useState<UnarchiveMode>("freshKeepEmployee");
  const [toUser, setToUser] = useState("");

  /*
   * Date.now() لا يُقرأ إلا بعد تفاعل المستخدم مع شريحة «آخر ٧ أيام» — الحالة
   * الابتدائية "" فلا يدخل نتيجة التصيير الأول، وبهذا لا يختلف الخادم عن العميل.
   */
  const weekCutoff = range === "week" ? Date.now() - DUP_WEEK_MS : 0;
  const shown = groups.filter((g) => inRange(g, range, from, to, weekCutoff));

  const run = (confirmMsg: string | null, fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    startTransition(async () => {
      setMsg(null);
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error ?? "صار خطأ" });
      if (r.ok) router.refresh();
    });
  };

  const MODES: { value: UnarchiveMode; label: string; desc: string }[] = [
    { value: "freshKeepEmployee", label: "كعميل جديد", desc: "يصله نظيفًا تمامًا: مرحلة «جديد»، بلا تاريخ ظاهر ولا مواعيد قديمة — والسجل الكامل محفوظ لك." },
    { value: "asis", label: "بمتابعاته", desc: "ينقله بحالته كاملة — المرحلة والمتابعات ظاهرة للموظف المستلم." },
  ];

  return (
    <>
      {/* ===== الفلاتر ===== */}
      <div className="m-noscroll flex overflow-x-auto" style={{ gap: 7, paddingBottom: 2 }}>
        <button type="button" className="flex flex-none items-center" onClick={() => setRange("")} style={chipStyle(range === "")}>
          الكل ({toArabicDigits(totalGroups)})
        </button>
        <button type="button" className="flex flex-none items-center" onClick={() => setRange("today")} style={chipStyle(range === "today")}>
          اليوم ({toArabicDigits(newTodayGroups)})
        </button>
        <button type="button" className="flex flex-none items-center" onClick={() => setRange("week")} style={chipStyle(range === "week")}>
          آخر ٧ أيام
        </button>
        <button type="button" className="flex flex-none items-center" onClick={() => setRange(range === "custom" ? "" : "custom")} style={chipStyle(range === "custom")}>
          نطاق مخصص
        </button>
      </div>

      {range === "custom" && (
        <div className="grid grid-cols-2" style={{ gap: 9 }}>
          <label className="block">
            <span className="block" style={{ fontSize: "11.5px", color: MOBILE_COLORS.textSecondary, marginBottom: 5 }}>من تاريخ</span>
            <input type="date" style={fieldStyle} value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="block">
            <span className="block" style={{ fontSize: "11.5px", color: MOBILE_COLORS.textSecondary, marginBottom: 5 }}>إلى تاريخ</span>
            <input type="date" style={fieldStyle} value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      )}

      {msg && (
        <p
          style={{
            boxSizing: "border-box", borderRadius: 10, padding: "10px 12px", fontSize: "12.5px",
            background: msg.ok ? MOBILE_STATUS.success.bg : MOBILE_STATUS.danger.bg,
            color: msg.ok ? MOBILE_STATUS.success.fg : MOBILE_STATUS.danger.fg,
            border: `1px solid ${msg.ok ? MOBILE_STATUS.success.border : MOBILE_STATUS.danger.border}`,
          }}
        >
          {msg.text}
        </p>
      )}

      {/* ===== المجموعات ===== */}
      {totalGroups === 0 ? (
        <Empty text="ما فيه عملاء مكررون — كل رقم جوال في سجل حيّ واحد 👌" />
      ) : shown.length === 0 ? (
        <Empty text="ما فيه مجموعات ضمن هذا الفلتر." />
      ) : (
        shown.map((g, i) => (
          <div
            key={g.key}
            className="m-rise"
            style={{
              boxSizing: "border-box", background: MOBILE_COLORS.card,
              border: `1px solid ${g.hasReserved ? MOBILE_STATUS.danger.border : MOBILE_COLORS.border}`,
              borderRadius: 16, padding: "13px 14px", animationDelay: `${Math.min(i, 8) * 60}ms`,
            }}
          >
            {/* رأس المجموعة */}
            <div className="flex flex-wrap items-center" style={{ gap: 7 }}>
              {g.hasReserved
                ? <AlertTriangle size={15} style={{ color: MOBILE_STATUS.danger.base, flex: "none" }} aria-hidden />
                : <Copy size={15} style={{ color: MOBILE_COLORS.gold, flex: "none" }} aria-hidden />}
              <span dir="ltr" style={{ fontSize: "14.5px", fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>{g.phone}</span>
              <span style={{ boxSizing: "border-box", fontSize: "10.5px", fontWeight: 600, padding: "3px 8px", borderRadius: 7, background: MOBILE_COLORS.line2, color: MOBILE_COLORS.textSecondary }}>
                مكرّر {toArabicDigits(g.duplicateCount)} مرات
              </span>
              {g.newToday && (
                <span style={{ boxSizing: "border-box", fontSize: "10.5px", fontWeight: 600, padding: "3px 8px", borderRadius: 7, background: MOBILE_COLORS.goldBg, color: MOBILE_COLORS.gold }}>
                  جديد اليوم
                </span>
              )}
            </div>
            {g.hasReserved && (
              <div style={{ fontSize: "10.5px", fontWeight: 700, color: MOBILE_STATUS.danger.fg, marginTop: 7, lineHeight: 1.7 }}>
                مكرر مع محجوز! — محجوب عن التوزيع التلقائي، القرار لك يدويًا
              </div>
            )}
            <div style={{ fontSize: 11, color: MOBILE_COLORS.textMuted, marginTop: 6 }}>
              أول إضافة: {formatDate(g.firstAddedAt)}
            </div>

            {/* السجلات */}
            <div className="flex flex-col" style={{ marginTop: 6 }}>
              {g.members.map((m) => (
                <div key={m.id} style={{ borderTop: `1px solid ${MOBILE_COLORS.line3}`, paddingTop: 10, marginTop: 10 }}>
                  <Link href={`/m/leads/${m.id}`} className="flex items-start justify-between" style={{ gap: 8 }}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate" style={{ fontSize: 13, fontWeight: 600, color: MOBILE_COLORS.textPrimary }}>
                        {m.name}
                        {m.addedToday && <span style={{ color: MOBILE_COLORS.gold }}> · جديد اليوم</span>}
                      </span>
                      <span className="block truncate" style={{ fontSize: 11, color: MOBILE_COLORS.textMuted, marginTop: 2 }}>
                        {m.assignedToName ?? "غير موزّع"} · {channelLabels[m.channel]}
                        {m.sourceName ? ` · ${m.sourceName}` : ""} · {formatDate(m.createdAt)}
                      </span>
                      <span className="block truncate" style={{ fontSize: 11, color: MOBILE_COLORS.dim1, marginTop: 2 }}>
                        آخر متابعة:{" "}
                        {m.lastFollowUp
                          ? `${followUpResultLabels[m.lastFollowUp.result]} · ${formatDate(m.lastFollowUp.createdAt)}`
                          : "—"}
                      </span>
                    </span>
                    <span className={`shrink-0 whitespace-nowrap border font-semibold ${stageChipClass[m.stage]}`}
                      style={{ fontSize: "10.5px", padding: "3px 8px", borderRadius: 7 }}>
                      {stageLabels[m.stage]}
                    </span>
                  </Link>

                  {/* الأفعال — نفس أزرار الديسكتوب حرفيًا */}
                  <div className="flex" style={{ gap: 7, marginTop: 9 }}>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => { setDistTarget(m); setMode("freshKeepEmployee"); setToUser(""); }}
                      className="flex flex-1 items-center justify-center"
                      style={{
                        boxSizing: "border-box", gap: 5, minHeight: 40, borderRadius: 10,
                        border: `1px solid ${MOBILE_COLORS.goldBorder}`, background: MOBILE_COLORS.goldBg,
                        color: MOBILE_COLORS.gold, fontSize: 12, fontWeight: 700, opacity: pending ? 0.6 : 1,
                      }}
                    >
                      <Share2 size={13} aria-hidden /> توزيع
                    </button>

                    {m.assignedToId && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => run(
                          `تسحب «${m.name}» من ${m.assignedToName ?? "موظفه"}؟ يرجع «غير موزّع» فورًا.`,
                          () => pullDuplicateLead(m.id),
                          "سُحب من موظفه",
                        )}
                        className="flex flex-1 items-center justify-center"
                        style={{
                          boxSizing: "border-box", gap: 5, minHeight: 40, borderRadius: 10,
                          border: `1px solid ${MOBILE_COLORS.border}`, background: MOBILE_COLORS.sheet,
                          color: MOBILE_COLORS.textPrimary, fontSize: 12, fontWeight: 600, opacity: pending ? 0.6 : 1,
                        }}
                      >
                        <LogOut size={13} aria-hidden /> سحب
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(
                        `تحذف «${m.name}»؟ يُؤرشف بسبب «مكرر» (السجل والمتابعات محفوظة) — وأخوه الحيّ يفكّ حجبه تلقائيًا.`,
                        () => archiveDuplicateLead(m.id),
                        "أُرشف كمكرر",
                      )}
                      className="flex flex-1 items-center justify-center"
                      style={{
                        boxSizing: "border-box", gap: 5, minHeight: 40, borderRadius: 10,
                        border: `1px solid ${MOBILE_STATUS.danger.border}`, background: MOBILE_STATUS.danger.bg,
                        color: MOBILE_STATUS.danger.fg, fontSize: 12, fontWeight: 600, opacity: pending ? 0.6 : 1,
                      }}
                    >
                      <Trash2 size={13} aria-hidden /> حذف
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {/* ===== ورقة التوزيع — نفس وضعَي حوار الديسكتوب ===== */}
      <BottomSheet
        open={!!distTarget}
        onClose={() => setDistTarget(null)}
        title={distTarget ? `توزيع «${distTarget.name}»` : "توزيع"}
        subtitle="المتابعات محفوظة في الوضعين — الفرق في ما يراه المستلم"
        tall
        footer={
          <button
            type="button"
            disabled={pending || !toUser || !distTarget}
            onClick={() => {
              const t = distTarget;
              if (!t) return;
              run(null, () => distributeDuplicateLead(t.id, mode, toUser).then((r) => {
                if (r.ok) setDistTarget(null);
                return r;
              }), "وُزّع العميل");
            }}
            className="m-press m-sweep w-full"
            style={{
              boxSizing: "border-box", height: 48, borderRadius: 12, border: "none",
              background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg,
              fontSize: 14, fontWeight: 700, opacity: pending || !toUser ? 0.5 : 1,
            }}
          >
            {pending ? "جارٍ…" : "وزّعه"}
          </button>
        }
      >
        <div style={{ marginTop: 18 }}>
          {MODES.map((o) => {
            const on = mode === o.value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => setMode(o.value)}
                className="block w-full text-start"
                style={{
                  boxSizing: "border-box", borderRadius: 12, padding: "12px 13px", marginBottom: 9,
                  background: on ? MOBILE_COLORS.goldBg : MOBILE_COLORS.bg,
                  border: `1px solid ${on ? MOBILE_COLORS.goldBorder : MOBILE_COLORS.border}`,
                }}
              >
                <span className="block" style={{ fontSize: 13, fontWeight: 700, color: on ? MOBILE_COLORS.gold : MOBILE_COLORS.textPrimary }}>
                  {o.label}
                </span>
                <span className="block" style={{ fontSize: 11, color: MOBILE_COLORS.textMuted, marginTop: 4, lineHeight: 1.7 }}>
                  {o.desc}
                </span>
              </button>
            );
          })}

          <label className="block" style={{ marginTop: 14 }}>
            <span className="block" style={{ fontSize: "12.5px", color: MOBILE_COLORS.textSecondary, marginBottom: 6 }}>الموظف</span>
            <select style={fieldStyle} value={toUser} onChange={(e) => setToUser(e.target.value)}>
              <option value="">اختر الموظف…</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>

        </div>
      </BottomSheet>
    </>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div
      className="flex flex-col items-center text-center"
      style={{
        boxSizing: "border-box", gap: 9, padding: "34px 16px",
        background: MOBILE_COLORS.card, borderRadius: 16, border: `1px solid ${MOBILE_COLORS.border}`,
      }}
    >
      <Copy size={34} style={{ color: MOBILE_COLORS.textMuted }} aria-hidden />
      <p style={{ fontSize: "12.5px", color: MOBILE_COLORS.textSecondary }}>{text}</p>
    </div>
  );
}

export default MobileDuplicatesPanel;
