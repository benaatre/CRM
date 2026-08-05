"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Scale, Feather, SlidersHorizontal, UserPlus, Share2, Archive, Trash2, Zap } from "lucide-react";
import type { TransferMode } from "@/lib/transfer-mode";
import { MODE_OPTIONS } from "@/components/leads/transfer-mode-dialog";
import {
  distributeUnassigned, distributeLeastLoaded, distributeCustom, getEmployeeLoads,
} from "@/lib/actions/team";
import { transferLeads, bulkArchive, bulkDelete } from "@/lib/actions/leads";
import { admitToAutoPool } from "@/lib/actions/distribution";
import { channelLabel } from "@/lib/labels";
import type { Channel } from "@prisma/client";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { MobileNewLeadSheet } from "@/components/mobile/new-lead-sheet";
import { MobileActionBar } from "@/components/mobile/action-bar";

export type UnassignedRow = {
  id: string;
  name: string;
  phone: string;
  channel: Channel;
  /** «معك من …» يُحسب بالخادم — هنا نص جاهز فقط. */
  agoText: string;
  inAutoPool: boolean;
};

type Employee = { id: string; name: string };
type Loads = Awaited<ReturnType<typeof getEmployeeLoads>>;
type DistHow = "equal" | "least" | "custom";

const fieldStyle = {
  boxSizing: "border-box" as const,
  width: "100%", minHeight: 44,
  background: MOBILE_COLORS.bg, border: `1px solid ${MOBILE_COLORS.border}`,
  borderRadius: 10, padding: "0 12px", fontSize: 13, color: MOBILE_COLORS.textPrimary, outline: "none",
};

/** صفّا وضع الاستلام (بالبيانات/كجديد) — نفس نصوص MODE_OPTIONS حرفيًا. */
function ModePick({ variant, value, onChange }: {
  variant: "transfer" | "distribute";
  value: TransferMode;
  onChange: (m: TransferMode) => void;
}) {
  return (
    <div className="flex flex-col" style={{ gap: 8, marginTop: 12 }}>
      <span style={{ fontSize: "12.5px", color: MOBILE_COLORS.textSecondary }}>حالة العميل عند استلام الموظف:</span>
      {MODE_OPTIONS[variant].map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className="text-start"
          style={{
            boxSizing: "border-box", borderRadius: 12, padding: "11px 13px",
            ...(value === o.value
              ? { background: MOBILE_COLORS.goldBg, border: `1px solid ${MOBILE_COLORS.goldBorder}` }
              : { background: MOBILE_COLORS.bg, border: `1px solid ${MOBILE_COLORS.border}` }),
          }}
        >
          <span className="block" style={{ fontSize: 13, fontWeight: 700, color: value === o.value ? MOBILE_COLORS.gold : MOBILE_COLORS.textPrimary }}>
            {o.label}
          </span>
          <span className="block" style={{ fontSize: 11, color: MOBILE_COLORS.textMuted, marginTop: 4, lineHeight: 1.7 }}>
            {o.desc}
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * لوحة «غير الموزّعين» — نقل تبويب unassigned من leads-view + أدوات UnassignedTools
 * حرفيًا: نفس الأكشنات (distributeUnassigned/LeastLoaded/Custom · transferLeads ·
 * admitToAutoPool · bulkArchive · bulkDelete · createLead) بنفس حراسها الخادمية.
 * وضع الاستلام (بالبيانات/كجديد) يُسأل قبل كل تنفيذ — لا توزيع صامت بضغطة.
 */
export function MobileUnassignedPanel({
  rows, employees, isManager,
}: {
  rows: UnassignedRow[];
  employees: Employee[];
  isManager: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [showNew, setShowNew] = useState(false);
  // ورقة التوزيع الجماعي: الطريقة + وضع الاستلام (+ أعداد مخصص).
  const [distHow, setDistHow] = useState<DistHow | null>(null);
  const [distMode, setDistMode] = useState<TransferMode>("full");
  const [perEmp, setPerEmp] = useState("");
  const [loads, setLoads] = useState<Loads | null>(null);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  // ورقة التحويل اليدوي للمحدّدين.
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferTo, setTransferTo] = useState("");
  const [transferMode, setTransferMode] = useState<TransferMode>("full");

  const allSelected = rows.length > 0 && sel.size === rows.length;

  const toggleSel = (id: string) =>
    setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, okText: string, after?: () => void) =>
    startTransition(async () => {
      setMsg(null);
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: r.message ?? okText } : { ok: false, text: r.error ?? "صار خطأ" });
      if (r.ok) { after?.(); router.refresh(); }
    });

  function openDist(how: DistHow) {
    setDistHow(how);
    setDistMode("full");
    if (how === "custom" && loads === null) {
      startTransition(async () => { setLoads(await getEmployeeLoads()); });
    }
  }

  function confirmDist() {
    const how = distHow!;
    const per = Number(perEmp) || 0;
    setDistHow(null);
    run(
      () =>
        how === "equal" ? distributeUnassigned(distMode, per > 0 ? per : undefined)
          : how === "least" ? distributeLeastLoaded(distMode)
            : distributeCustom((loads ?? []).map((e) => ({ userId: e.id, count: Number(alloc[e.id]) || 0 })), distMode),
      "تم التوزيع",
      () => { setSel(new Set()); setAlloc({}); setLoads(null); },
    );
  }

  const totalWanted = Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0);
  const over = totalWanted > rows.length;
  const overCap = (loads ?? []).some((e) => e.remaining != null && (Number(alloc[e.id]) || 0) > e.remaining);

  const distTools: { how: DistHow; label: string; icon: typeof Scale }[] = [
    { how: "equal", label: "بالتساوي", icon: Scale },
    { how: "least", label: "الأقل عملاءً", icon: Feather },
    { how: "custom", label: "مخصص", icon: SlidersHorizontal },
  ];

  return (
    <div className="flex flex-col" style={{ gap: 13 }}>
      {msg && (
        <p
          className="m-rise"
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

      {/* ===== طريقة الإضافة (الاستيراد من الديسكتوب — لا زرّ يفتح المتصفح هنا) ===== */}
      <button
        type="button"
        onClick={() => setShowNew(true)}
        className="m-rise m-press flex w-full items-center justify-center"
        style={{
          boxSizing: "border-box", gap: 7, minHeight: 48, borderRadius: 13, border: "none",
          background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg, fontSize: 13, fontWeight: 700,
        }}
      >
        <UserPlus size={16} aria-hidden /> عميل جديد
      </button>

      {/* ===== التوزيع الجماعي — يعمل على كل غير الموزّعين ===== */}
      <div style={{ marginTop: 4, padding: "0 2px" }}>
        <div style={{ fontSize: "12.5px", fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>
          توزيع الكل
        </div>
        <div style={{ fontSize: 10.5, color: MOBILE_COLORS.textMuted, marginTop: 3 }}>
          يوزّع {toArabicDigits(rows.length)} عميل دفعة واحدة — بلا تحديد
        </div>
      </div>
      <div className="m-rise grid grid-cols-3" style={{ gap: 9, animationDelay: "60ms" }}>
        {distTools.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.how}
              type="button"
              disabled={pending || rows.length === 0}
              onClick={() => openDist(t.how)}
              className="m-iconbtn flex flex-col items-center justify-center"
              style={{
                boxSizing: "border-box", gap: 6, minHeight: 66, borderRadius: 14,
                background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
                opacity: pending || rows.length === 0 ? 0.5 : 1,
              }}
            >
              <Icon size={17} style={{ color: MOBILE_COLORS.gold }} aria-hidden />
              <span style={{ fontSize: "11.5px", fontWeight: 600, color: MOBILE_COLORS.textPrimary }}>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* ===== التحديد اليدوي — إجراءات على المحدَّد وحده ===== */}
      {rows.length > 0 && (
        <div style={{ marginTop: 6, padding: "0 2px", borderTop: `1px solid ${MOBILE_COLORS.line3}`, paddingTop: 12 }}>
          <div style={{ fontSize: "12.5px", fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>
            تحديد يدوي
          </div>
          <div style={{ fontSize: 10.5, color: MOBILE_COLORS.textMuted, marginTop: 3 }}>
            حدّد من القائمة، والإجراءات تنطبق على المحدَّد فقط
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex items-center justify-between" style={{ padding: "0 2px" }}>
          <span style={{ fontSize: "11.5px", color: MOBILE_COLORS.textMuted }}>
            {sel.size > 0 ? `محدّد ${toArabicDigits(sel.size)} من ${toArabicDigits(rows.length)}` : `${toArabicDigits(rows.length)} عميل`}
          </span>
          <button
            type="button"
            onClick={() => setSel(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
            style={{
              boxSizing: "border-box", minHeight: 36, padding: "0 12px", borderRadius: 9,
              border: `1px solid ${allSelected ? MOBILE_COLORS.goldBorder : MOBILE_COLORS.border}`,
              background: allSelected ? MOBILE_COLORS.goldBg : "none",
              color: allSelected ? MOBILE_COLORS.gold : MOBILE_COLORS.textSecondary,
              fontSize: 11.5, fontWeight: 600,
            }}
          >
            {allSelected ? "إلغاء تحديد الكل" : "تحديد الكل"}
          </button>
        </div>
      )}

      <div className="flex flex-col" style={{ gap: 9 }}>
        {rows.length === 0 ? (
          <div className="flex flex-col items-center text-center"
            style={{ boxSizing: "border-box", gap: 9, padding: "34px 16px", background: MOBILE_COLORS.card, borderRadius: 16, border: `1px solid ${MOBILE_COLORS.border}` }}>
            <Share2 size={34} style={{ color: MOBILE_COLORS.textMuted }} aria-hidden />
            <p style={{ fontSize: "12.5px", color: MOBILE_COLORS.textSecondary }}>ما فيه عملاء غير موزّعين 🎉</p>
          </div>
        ) : (
          rows.map((l, i) => {
            const on = sel.has(l.id);
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => toggleSel(l.id)}
                className="m-rise m-leadcard flex items-center text-start"
                style={{
                  boxSizing: "border-box", gap: 11, minHeight: 60, borderRadius: 15, padding: "11px 13px",
                  background: MOBILE_COLORS.card,
                  border: `1px solid ${on ? MOBILE_COLORS.goldBorder : MOBILE_COLORS.border}`,
                  animationDelay: `${Math.min(i, 10) * 40}ms`,
                }}
              >
                <span
                  className="flex flex-none items-center justify-center"
                  style={{
                    boxSizing: "border-box", width: 22, height: 22, borderRadius: 11,
                    border: `2px solid ${on ? MOBILE_COLORS.gold : MOBILE_COLORS.dim2}`,
                    background: on ? MOBILE_COLORS.gold : "transparent",
                    transition: "background .15s, border-color .15s",
                  }}
                  aria-hidden
                >
                  {on && <span style={{ width: 8, height: 8, borderRadius: 4, background: MOBILE_COLORS.bg }} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center" style={{ gap: 6 }}>
                    <span className="min-w-0 truncate" style={{ fontSize: "14.5px", fontWeight: 600, color: MOBILE_COLORS.textPrimary }}>
                      {l.name}
                    </span>
                    {l.inAutoPool && (
                      <span className="flex-none" title="داخل بركة التوزيع التلقائي"
                        style={{ boxSizing: "border-box", fontSize: 9.5, fontWeight: 700, padding: "2px 7px", borderRadius: 6, background: MOBILE_COLORS.goldBg, color: MOBILE_COLORS.gold }}>
                        تلقائي
                      </span>
                    )}
                  </span>
                  <span className="block truncate" style={{ fontSize: "11.5px", color: MOBILE_COLORS.textMuted, marginTop: 3 }}>
                    <span dir="ltr">{l.phone}</span> · {channelLabel(l.channel)} · {l.agoText}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* ===== شريط الإجراءات السفلي — يطفو فوق شريط التبويبات عند وجود تحديد ===== */}
      {sel.size > 0 && (
        <MobileActionBar count={sel.size}>
            {[
              {
                label: `تحويل (${toArabicDigits(sel.size)})`, icon: Share2, tone: "gold" as const,
                onClick: () => { setShowTransfer(true); setTransferTo(""); setTransferMode("full"); },
              },
              {
                label: `للبول التلقائي (${toArabicDigits(sel.size)})`, icon: Zap, tone: "plain" as const,
                onClick: () => run(() => admitToAutoPool([...sel]), "أُدخلوا بركة التوزيع التلقائي", () => setSel(new Set())),
              },
              {
                label: `أرشفة (${toArabicDigits(sel.size)})`, icon: Archive, tone: "plain" as const,
                onClick: () => run(() => bulkArchive([...sel]), "أُرشفوا", () => setSel(new Set())),
              },
              ...(isManager
                ? [{
                    label: `حذف (${toArabicDigits(sel.size)})`, icon: Trash2, tone: "danger" as const,
                    onClick: () => {
                      if (confirm(`متأكد تبي تحذف ${toArabicDigits(sel.size)} عميل نهائيًا؟ ما يمكن التراجع.`))
                        run(() => bulkDelete([...sel]), "حُذفوا", () => setSel(new Set()));
                    },
                  }]
                : []),
            ].map((a) => {
              const Icon = a.icon;
              const tone =
                a.tone === "gold" ? { background: MOBILE_COLORS.goldBg, color: MOBILE_COLORS.gold, border: `1px solid ${MOBILE_COLORS.goldBorder}` }
                  : a.tone === "danger" ? { background: MOBILE_STATUS.danger.bg, color: MOBILE_STATUS.danger.fg, border: `1px solid ${MOBILE_STATUS.danger.border}` }
                    : { background: MOBILE_COLORS.card, color: MOBILE_COLORS.textPrimary, border: `1px solid ${MOBILE_COLORS.border}` };
              return (
                <button
                  key={a.label}
                  type="button"
                  disabled={pending}
                  onClick={a.onClick}
                  className="flex flex-none items-center whitespace-nowrap"
                  style={{
                    boxSizing: "border-box", gap: 6, minHeight: 40, padding: "0 12px", borderRadius: 11,
                    fontSize: 12, fontWeight: 600, opacity: pending ? 0.6 : 1, ...tone,
                  }}
                >
                  <Icon size={14} aria-hidden /> {a.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setSel(new Set())}
              className="m-press flex-none"
              style={{ boxSizing: "border-box", minHeight: 40, padding: "0 10px", border: "none", background: "none", color: MOBILE_COLORS.textMuted, fontSize: 12 }}
            >
              إلغاء
            </button>
        </MobileActionBar>
      )}

      {/* ===== ورقة التوزيع الجماعي ===== */}
      <BottomSheet
        open={distHow !== null}
        onClose={() => setDistHow(null)}
        title={distHow === "equal" ? "توزيع بالتساوي" : distHow === "least" ? "توزيع على الأقل عملاءً" : "توزيع مخصص"}
        subtitle={`${toArabicDigits(rows.length)} عميل غير موزّع`}
        tall
        footer={
          <button
            type="button"
            disabled={pending || (distHow === "custom" && (over || overCap || totalWanted === 0))}
            onClick={confirmDist}
            className="m-press m-sweep w-full"
            style={{
              boxSizing: "border-box", height: 48, borderRadius: 12, border: "none",
              background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg, fontSize: 14, fontWeight: 700,
              opacity: pending || (distHow === "custom" && (over || overCap || totalWanted === 0)) ? 0.5 : 1,
            }}
          >
            {pending ? "جارٍ…" : "وزّع الآن"}
          </button>
        }
      >
        {distHow === "equal" && (
          <label className="block" style={{ marginTop: 14 }}>
            <span className="block" style={{ fontSize: "12.5px", color: MOBILE_COLORS.textSecondary, marginBottom: 6 }}>
              عدد لكل موظف (فارغ = بالتساوي على الجميع)
            </span>
            <input value={perEmp} onChange={(e) => setPerEmp(e.target.value.replace(/\D/g, ""))} inputMode="numeric" dir="ltr" style={fieldStyle} placeholder="مثال: 5" />
          </label>
        )}

        {distHow === "custom" && (
          <div style={{ marginTop: 14 }}>
            {loads === null ? (
              <p style={{ fontSize: "12.5px", color: MOBILE_COLORS.textMuted, textAlign: "center", padding: "14px 0" }}>جارٍ التحميل…</p>
            ) : loads.length === 0 ? (
              <p style={{ fontSize: "12.5px", color: MOBILE_COLORS.textMuted, textAlign: "center", padding: "14px 0" }}>ما فيه موظفون مفعّلون.</p>
            ) : (
              <>
                {loads.map((e) => {
                  const rowOver = e.remaining != null && (Number(alloc[e.id]) || 0) > e.remaining;
                  return (
                    <div key={e.id} className="flex items-center justify-between" style={{ gap: 10, minHeight: 52, borderBottom: `1px solid ${MOBILE_COLORS.line3}` }}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate" style={{ fontSize: 13, fontWeight: 600, color: MOBILE_COLORS.textPrimary }}>{e.name}</span>
                        <span className="block" style={{ fontSize: 10.5, color: MOBILE_COLORS.textMuted, marginTop: 2 }}>
                          عنده {toArabicDigits(e.count)} · متبقّي {e.remaining == null ? "بلا حد" : toArabicDigits(e.remaining)}
                        </span>
                      </span>
                      <input
                        value={alloc[e.id] ?? ""}
                        onChange={(ev) => setAlloc((a) => ({ ...a, [e.id]: ev.target.value.replace(/\D/g, "") }))}
                        inputMode="numeric" dir="ltr" placeholder="٠"
                        aria-label={`عدد ${e.name}`}
                        style={{ ...fieldStyle, width: 74, textAlign: "center", borderColor: rowOver ? MOBILE_STATUS.danger.base : MOBILE_COLORS.border }}
                      />
                    </div>
                  );
                })}
                <p style={{ fontSize: 11.5, color: over ? MOBILE_STATUS.danger.fg : MOBILE_COLORS.textMuted, marginTop: 10 }}>
                  المجموع: {toArabicDigits(totalWanted)} من {toArabicDigits(rows.length)} متاح
                  {overCap ? " — في موظف تجاوز سعته المتبقية" : ""}
                </p>
              </>
            )}
          </div>
        )}

        <ModePick variant="distribute" value={distMode} onChange={setDistMode} />

      </BottomSheet>

      {/* ===== ورقة التحويل اليدوي للمحدّدين ===== */}
      <BottomSheet
        open={showTransfer}
        onClose={() => setShowTransfer(false)}
        title={`تحويل ${toArabicDigits(sel.size)} عميل`}
        subtitle="اختر الموظف ثم طريقة النقل"
        tall
        footer={
          <button
            type="button"
            disabled={pending || !transferTo}
            onClick={() => {
              setShowTransfer(false);
              run(() => transferLeads([...sel], transferTo, transferMode), "حُوّلوا", () => setSel(new Set()));
            }}
            className="m-press m-sweep w-full"
            style={{
              boxSizing: "border-box", height: 48, borderRadius: 12, border: "none",
              background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg, fontSize: 14, fontWeight: 700,
              opacity: pending || !transferTo ? 0.5 : 1,
            }}
          >
            {pending
              ? "جارٍ…"
              : `حوّل ${toArabicDigits(sel.size)} عملاء${employees.find((e) => e.id === transferTo) ? ` لـ${employees.find((e) => e.id === transferTo)!.name}` : ""}`}
          </button>
        }
      >
        {/* ١) الموظف — نفس شرائح ورقة التحويل في /m/leads */}
        <section style={{ marginTop: 18 }}>
          <h3 style={{ fontSize: "12.5px", fontWeight: 700, color: MOBILE_COLORS.textMuted, marginBottom: 10 }}>
            ١) الموظف المستلم
          </h3>
          <div className="flex flex-wrap" style={{ gap: 7 }}>
            {employees.map((e) => {
              const on = transferTo === e.id;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setTransferTo(on ? "" : e.id)}
                  className="m-press flex items-center whitespace-nowrap"
                  style={{
                    boxSizing: "border-box", minHeight: 40, padding: "0 14px", borderRadius: 20,
                    fontSize: 13, fontWeight: 600,
                    ...(on
                      ? { background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg, border: `1px solid ${MOBILE_COLORS.gold}` }
                      : { background: MOBILE_COLORS.bg, color: MOBILE_COLORS.textSecondary, border: `1px solid ${MOBILE_COLORS.border}` }),
                  }}
                >
                  {e.name}
                </button>
              );
            })}
          </div>
        </section>

        {/* ٢) طريقة النقل — نفس نصوص MODE_OPTIONS */}
        <section style={{ marginTop: 6 }}>
          <h3 style={{ fontSize: "12.5px", fontWeight: 700, color: MOBILE_COLORS.textMuted, marginBottom: 2, marginTop: 12 }}>
            ٢) طريقة النقل
          </h3>
          <ModePick variant="transfer" value={transferMode} onChange={setTransferMode} />
        </section>

      </BottomSheet>

      <MobileNewLeadSheet open={showNew} onClose={() => setShowNew(false)} isManager={isManager} employees={employees} />
    </div>
  );
}

export default MobileUnassignedPanel;
