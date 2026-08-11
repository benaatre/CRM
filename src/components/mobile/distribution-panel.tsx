"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import {
  setAutoDistribute, updateDistributionConfig, updateAutoPilotConfig, runSweepNow,
  approveSweepPull, dismissSweepCandidate, dismissAllSweepCandidates,
  protectAllCurrentFromSweep, updateDailyAssignCaps,
  admitToAutoPool, transferToAutoPool, removeFromAutoPool, updateSweepCutoff,
  type DistConfig, type DistEmployee, type LastCron, type SweepCandidateRow,
} from "@/lib/actions/distribution";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";
import { toRiyadhInputValue } from "@/lib/format";
import { parseRiyadhLocal } from "@/lib/ksa-time";

/**
 * لوحة التوزيع للجوال — طبقة عرض فقط فوق سيرفر أكشنز الديسكتوب نفسها.
 * كل حدود القيم منسوخة من `lib/actions/distribution.ts` (لا حدود مخترعة):
 *   • الساعات: clampHour ⇒ ٠–٢٣            • distTimeoutMin ≥ ١
 *   • sweepWarnMin ١–١٢٠                    • distReceiveGapMin ٠–١٤٤٠
 *   • distWindowMin ≥ ١                     • posOrNull: ٠/فارغ ⇒ null (بلا سقف)
 *   • مع autoSweepEnabled: أرضية المهلة ٦٠  • dailyAssignCap > ٠ وإلا null
 * الحارس الخادمي داخل كل أكشن هو خط الدفاع الأول؛ الإخفاء هنا للعرض فقط.
 */

const card = {
  boxSizing: "border-box" as const,
  background: MOBILE_COLORS.card,
  border: `1px solid ${MOBILE_COLORS.border}`,
  borderRadius: 16,
  padding: 14,
};
const fieldStyle = {
  boxSizing: "border-box" as const,
  width: "100%",
  minHeight: 44,
  background: MOBILE_COLORS.bg,
  border: `1px solid ${MOBILE_COLORS.border}`,
  borderRadius: 10,
  padding: "0 12px",
  fontSize: 13,
  color: MOBILE_COLORS.textPrimary,
  outline: "none",
};
const labelStyle = { fontSize: "12.5px", color: MOBILE_COLORS.textSecondary, marginBottom: 6 } as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block" style={{ marginTop: 12 }}>
      <span className="block" style={labelStyle}>{label}</span>
      {children}
    </label>
  );
}

/** عنصر قائمة البركة — اسم + موظفه إن وُجد (اشتقاق عرضي من LeadRow). */
export type PoolLeadItem = { id: string; name: string; assignedToName: string | null };

/** هوية لونية خفيفة للقسم: حد جانبي ٣px بلون الحالة — ضمن ثيم أوبسيديان. */
const accent = (color: string) => ({ ...card, borderInlineStart: `3px solid ${color}` });

/** قيم السقف اليومي الجاهزة — والخيار «مخصص» يفتح حقل رقم (الحد الفعلي على الخادم: >٠ وإلا null). */
const CAP_PRESETS = [5, 10, 15, 20, 30, 50];

export function MobileDistributionPanel({
  config, employees, lastCron, isOwner, candidates,
  pool, admitList, transferList, removeList, sweepCutoffAt,
}: {
  config: DistConfig;
  employees: DistEmployee[];
  lastCron: LastCron;
  /** تفريع الديسكتوب حرفيًا — أقسام وأزرار المالك تحته فقط. */
  isOwner: boolean;
  candidates: SweepCandidateRow[];
  pool: { total: number; unassigned: number; assigned: number };
  admitList: PoolLeadItem[];
  transferList: PoolLeadItem[];
  removeList: PoolLeadItem[];
  sweepCutoffAt: Date;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [openSettings, setOpenSettings] = useState(false);
  // السقوف اليومية — مقفولة افتراضيًا (تسعة صفوف مفتوحة كانت تبتلع الشاشة).
  const [openCaps, setOpenCaps] = useState(false);

  // حالة النموذج — القيم الابتدائية من الخادم كما هي.
  const [f, setF] = useState({
    distStartHour: config.distStartHour,
    distEndHour: config.distEndHour,
    distTimeoutMin: config.distTimeoutMin,
    distPresenceMin: config.distPresenceMin,
    distReceiveGapMin: config.distReceiveGapMin,
    distInitialMode: config.distInitialMode,
    distReassignMode: config.distReassignMode,
    distBatchSize: config.distBatchSize ?? 0,
    distPerEmployeePerWindow: config.distPerEmployeePerWindow ?? 0,
    distWindowMin: config.distWindowMin,
  });
  // إعدادات الأتمتة (المالك فقط).
  const [ap, setAp] = useState({
    autoSweepEnabled: config.autoSweepEnabled,
    sweepWarnMin: config.sweepWarnMin,
    sweepStartHour: config.sweepStartHour,
    sweepEndHour: config.sweepEndHour,
  });
  const [caps, setCaps] = useState<Record<string, string>>(
    Object.fromEntries(employees.map((e) => [e.id, e.dailyAssignCap != null ? String(e.dailyAssignCap) : ""])),
  );
  // اختيار بركة التوزيع (checkboxes) — مجموعة واحدة لكل عملية.
  const [poolTab, setPoolTab] = useState<"admit" | "transfer" | "remove" | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const toggleSel = (id: string) =>
    setSel((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // حاجز السحب التاريخي (المالك) — datetime-local بوقت حائط الرياض (نفس تفسير الحفظ).
  const [cutoff, setCutoff] = useState(() => toRiyadhInputValue(sweepCutoffAt));

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, okText: string) =>
    startTransition(async () => {
      setMsg(null);
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: r.message ?? okText } : { ok: false, text: r.error ?? "صار خطأ" });
      if (r.ok) router.refresh();
    });

  return (
    <div className="flex flex-col" style={{ gap: 13 }}>
      {/* ===== المفتاح الرئيسي ===== */}
      <div className="m-rise flex items-center justify-between" style={accent(MOBILE_COLORS.gold)}>
        <div className="min-w-0">
          <div style={{ fontSize: "14.5px", fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>
            التوزيع التلقائي
          </div>
          <div style={{ fontSize: "11.5px", color: MOBILE_COLORS.textMuted, marginTop: 4 }}>
            {config.autoDistribute ? "شغّال" : "متوقف"}
            {lastCron.at
              ? ` · آخر دورة وزّعت ${toArabicDigits(lastCron.distributed)}`
              : " · ما فيه دورة بعد"}
          </div>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => setAutoDistribute(!config.autoDistribute), config.autoDistribute ? "أُوقف التوزيع" : "شُغّل التوزيع")}
          aria-pressed={config.autoDistribute}
          className="flex-none"
          style={{
            boxSizing: "border-box", width: 52, height: 31, borderRadius: 16, border: "none",
            padding: 3, display: "flex", cursor: "pointer",
            justifyContent: config.autoDistribute ? "flex-start" : "flex-end",
            background: config.autoDistribute ? MOBILE_COLORS.gold : MOBILE_COLORS.border,
            opacity: pending ? 0.6 : 1,
          }}
        >
          <span style={{ width: 25, height: 25, borderRadius: 13, background: "#FFFFFF" }} />
        </button>
      </div>

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

      {/* ===== إعدادات التوزيع (قابلة للطي) — requireManager ===== */}
      <div className="m-rise" style={{ ...accent(MOBILE_STATUS.info.base), animationDelay: "60ms" }}>
        <button
          type="button"
          onClick={() => setOpenSettings((v) => !v)}
          className="flex w-full items-center justify-between"
          style={{ minHeight: 44, background: "none", border: "none", padding: 0, cursor: "pointer" }}
        >
          <span style={{ fontSize: "14.5px", fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>
            إعدادات التوزيع
          </span>
          <ChevronDown
            size={18}
            style={{ color: MOBILE_COLORS.textMuted, transform: openSettings ? "rotate(180deg)" : "none", transition: "transform .2s" }}
            aria-hidden
          />
        </button>

        {openSettings && (
          <div>
            <div className="grid grid-cols-2" style={{ gap: 10 }}>
              <Row label="من الساعة (٠–٢٣)">
                <input type="number" min={0} max={23} style={fieldStyle} value={f.distStartHour}
                  onChange={(e) => setF({ ...f, distStartHour: Number(e.target.value) })} />
              </Row>
              <Row label="إلى الساعة (٠–٢٣)">
                <input type="number" min={0} max={23} style={fieldStyle} value={f.distEndHour}
                  onChange={(e) => setF({ ...f, distEndHour: Number(e.target.value) })} />
              </Row>
            </div>

            <Row label="مهلة السحب بالدقائق (١ فأكثر)">
              <input type="number" min={1} style={fieldStyle} value={f.distTimeoutMin}
                onChange={(e) => setF({ ...f, distTimeoutMin: Number(e.target.value) })} />
            </Row>
            <Row label="مدة الحضور بالدقائق">
              <input type="number" min={0} style={fieldStyle} value={f.distPresenceMin}
                onChange={(e) => setF({ ...f, distPresenceMin: Number(e.target.value) })} />
            </Row>
            <Row label="فاصل الاستقبال بالدقائق (٠ = بلا فاصل · حتى ١٤٤٠)">
              <input type="number" min={0} max={1440} style={fieldStyle} value={f.distReceiveGapMin}
                onChange={(e) => setF({ ...f, distReceiveGapMin: Number(e.target.value) })} />
            </Row>

            <Row label="طريقة التوزيع الأول">
              <select style={fieldStyle} value={f.distInitialMode}
                onChange={(e) => setF({ ...f, distInitialMode: e.target.value as DistConfig["distInitialMode"] })}>
                <option value="ROUND_ROBIN">بالترتيب</option>
                <option value="LEAST_LOADED">الأقل حملًا</option>
                <option value="MOST_ACTIVE">الأكثر نشاطًا</option>
              </select>
            </Row>
            <Row label="طريقة إعادة التوزيع">
              <select style={fieldStyle} value={f.distReassignMode}
                onChange={(e) => setF({ ...f, distReassignMode: e.target.value as DistConfig["distReassignMode"] })}>
                <option value="ROTATION">بالترتيب</option>
                <option value="LEAST_LOADED">الأقل حملًا</option>
                <option value="MOST_ACTIVE">الأكثر نشاطًا</option>
              </select>
            </Row>

            <div className="grid grid-cols-2" style={{ gap: 10 }}>
              <Row label="حجم الدفعة (٠ = بلا سقف)">
                <input type="number" min={0} style={fieldStyle} value={f.distBatchSize}
                  onChange={(e) => setF({ ...f, distBatchSize: Number(e.target.value) })} />
              </Row>
              <Row label="سقف الموظف بالنافذة (٠ = بلا)">
                <input type="number" min={0} style={fieldStyle} value={f.distPerEmployeePerWindow}
                  onChange={(e) => setF({ ...f, distPerEmployeePerWindow: Number(e.target.value) })} />
              </Row>
            </div>
            <Row label="طول النافذة بالدقائق (١ فأكثر)">
              <input type="number" min={1} style={fieldStyle} value={f.distWindowMin}
                onChange={(e) => setF({ ...f, distWindowMin: Number(e.target.value) })} />
            </Row>

            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    updateDistributionConfig({
                      ...config,
                      ...f,
                      // posOrNull على الخادم يحوّل ٠ إلى null — نمرّرها كما هي.
                      distBatchSize: f.distBatchSize,
                      distPerEmployeePerWindow: f.distPerEmployeePerWindow,
                    }),
                  "حُفظت الإعدادات",
                )
              }
              className="w-full"
              style={{
                boxSizing: "border-box", marginTop: 16, height: 48, borderRadius: 12, border: "none",
                background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg,
                fontSize: 14, fontWeight: 700, opacity: pending ? 0.6 : 1,
              }}
            >
              {pending ? "جارٍ الحفظ…" : "حفظ الإعدادات"}
            </button>
          </div>
        )}
      </div>

      {/* ===== السقوف اليومية — requireManager ===== */}
      {employees.length > 0 && (
        <div className="m-rise" style={{ ...accent(MOBILE_STATUS.warning.base), animationDelay: "120ms" }}>
          <button
            type="button"
            onClick={() => setOpenCaps((v) => !v)}
            className="flex w-full items-center justify-between"
            style={{ minHeight: 44, background: "none", border: "none", padding: 0, cursor: "pointer" }}
          >
            <span className="min-w-0 text-start">
              <span className="block" style={{ fontSize: "14.5px", fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>
                السقف اليومي لكل موظف
              </span>
              <span className="block" style={{ fontSize: "11.5px", color: MOBILE_COLORS.textMuted, marginTop: 4 }}>
                فارغ أو صفر = بلا سقف
              </span>
            </span>
            <ChevronDown
              size={18}
              style={{ color: MOBILE_COLORS.textMuted, transform: openCaps ? "rotate(180deg)" : "none", transition: "transform .2s" }}
              aria-hidden
            />
          </button>

          {openCaps && (
          <div>
          {employees.map((e) => (
            <div key={e.id} className="flex items-center justify-between" style={{ gap: 10, marginTop: 12 }}>
              <span className="min-w-0 flex-1 truncate" style={{ fontSize: 13, color: MOBILE_COLORS.textPrimary }}>
                {e.name}
                {!e.active && <span style={{ color: MOBILE_COLORS.textMuted }}> · موقوف</span>}
              </span>
              <div className="flex items-center" style={{ gap: 6 }}>
                <select
                  style={{ ...fieldStyle, width: 96 }}
                  value={
                    caps[e.id] === "" ? "" :
                    CAP_PRESETS.includes(Number(caps[e.id])) ? caps[e.id] : "custom"
                  }
                  onChange={(ev) => {
                    const val = ev.target.value;
                    if (val === "custom") setCaps({ ...caps, [e.id]: caps[e.id] && !CAP_PRESETS.includes(Number(caps[e.id])) ? caps[e.id] : "25" });
                    else setCaps({ ...caps, [e.id]: val });
                  }}
                >
                  <option value="">بلا سقف</option>
                  {CAP_PRESETS.map((c) => (
                    <option key={c} value={String(c)}>{toArabicDigits(c)}</option>
                  ))}
                  <option value="custom">مخصص</option>
                </select>
                {caps[e.id] !== "" && !CAP_PRESETS.includes(Number(caps[e.id])) && (
                  <input
                    type="number" min={1} inputMode="numeric" aria-label="سقف مخصص"
                    style={{ ...fieldStyle, width: 70 }}
                    value={caps[e.id] ?? ""}
                    onChange={(ev) => setCaps({ ...caps, [e.id]: ev.target.value })}
                  />
                )}
              </div>
            </div>
          ))}
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(
                () =>
                  updateDailyAssignCaps(
                    employees.map((e) => {
                      const raw = caps[e.id];
                      const n = Number(raw);
                      return { userId: e.id, cap: raw !== "" && Number.isFinite(n) && n > 0 ? n : null };
                    }),
                  ),
                "حُدّثت السقوف",
              )
            }
            className="w-full"
            style={{
              boxSizing: "border-box", marginTop: 14, height: 44, borderRadius: 12,
              border: `1px solid ${MOBILE_COLORS.border}`, background: MOBILE_COLORS.sheet,
              color: MOBILE_COLORS.textPrimary, fontSize: 13, fontWeight: 600, opacity: pending ? 0.6 : 1,
            }}
          >
            حفظ السقوف
          </button>
          </div>
          )}
        </div>
      )}

      {/* ===== دورة السحب الآن — requireManager ===== */}
      <div className="m-rise flex items-center justify-between" style={{ ...accent(MOBILE_COLORS.dim1), animationDelay: "180ms" }}>
        <div className="min-w-0">
          <div style={{ fontSize: 13, fontWeight: 600, color: MOBILE_COLORS.textPrimary }}>تشغيل دورة السحب الآن</div>
          <div style={{ fontSize: "11.5px", color: MOBILE_COLORS.textMuted, marginTop: 4 }}>
            يفحص المتأخرين ويجهّز المرشّحين
          </div>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => runSweepNow(), "تمّت الدورة")}
          className="flex-none"
          style={{
            boxSizing: "border-box", height: 38, padding: "0 14px", borderRadius: 10,
            border: `1px solid ${MOBILE_COLORS.border}`, background: MOBILE_COLORS.sheet,
            color: MOBILE_COLORS.gold, fontSize: 13, fontWeight: 700, opacity: pending ? 0.6 : 1,
          }}
        >
          شغّلها
        </button>
      </div>

      {/* ===== بركة التوزيع التلقائي — requireManager (admit/transfer/remove/count) ===== */}
      <div className="m-rise" style={{ ...accent(MOBILE_STATUS.success.base), animationDelay: "210ms" }}>
        <div style={{ fontSize: "14.5px", fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>
          بركة التوزيع التلقائي
        </div>
        <div style={{ fontSize: "11.5px", color: MOBILE_COLORS.textMuted, marginTop: 4 }}>
          الإجمالي <b style={{ color: MOBILE_COLORS.gold }}>{toArabicDigits(pool.total)}</b>
          {" · "}غير موزّع <b style={{ color: MOBILE_STATUS.warning.fg }}>{toArabicDigits(pool.unassigned)}</b>
          {" · "}موزّع <b style={{ color: MOBILE_STATUS.success.fg }}>{toArabicDigits(pool.assigned)}</b>
        </div>

        <div className="flex" style={{ gap: 7, marginTop: 12 }}>
          {([
            ["admit", "إدخال", admitList.length],
            ["transfer", "تحويل", transferList.length],
            ["remove", "إخراج", removeList.length],
          ] as const).map(([key, label, n]) => (
            <button
              key={key}
              type="button"
              onClick={() => { setPoolTab(poolTab === key ? null : key); setSel(new Set()); }}
              className="flex-1"
              style={{
                boxSizing: "border-box", minHeight: 44, borderRadius: 10, fontSize: "12.5px", fontWeight: 600,
                ...(poolTab === key
                  ? { background: MOBILE_COLORS.goldBg, color: MOBILE_COLORS.gold, border: `1px solid ${MOBILE_COLORS.goldBorder}` }
                  : { background: MOBILE_COLORS.bg, color: MOBILE_COLORS.textSecondary, border: `1px solid ${MOBILE_COLORS.border}` }),
              }}
            >
              {label} ({toArabicDigits(n)})
            </button>
          ))}
        </div>

        {poolTab && (() => {
          const list = poolTab === "admit" ? admitList : poolTab === "transfer" ? transferList : removeList;
          const action = poolTab === "admit" ? admitToAutoPool : poolTab === "transfer" ? transferToAutoPool : removeFromAutoPool;
          const okText = poolTab === "admit" ? "أُدخلوا للبركة" : poolTab === "transfer" ? "حُوّلوا للبركة" : "أُخرجوا من البركة";
          const hint =
            poolTab === "admit" ? "غير الموزّعين خارج البركة — يدخلون التوزيع التلقائي"
            : poolTab === "transfer" ? "الموزّعون حاليًا — يُسحبون من موظفيهم إلى البركة"
            : "أعضاء البركة الحاليون — يخرجون من التوزيع التلقائي";
          return (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontSize: 11, color: MOBILE_COLORS.textMuted, marginBottom: 8, lineHeight: 1.6 }}>{hint}</p>
              {list.length === 0 ? (
                <p style={{ fontSize: "12.5px", color: MOBILE_COLORS.textMuted }}>ما فيه عملاء بهذي الفئة</p>
              ) : (
                <div className="m-noscroll" style={{ maxHeight: 280, overflowY: "auto" }}>
                  {list.map((l) => (
                    <label
                      key={l.id}
                      className="flex items-center"
                      style={{
                        boxSizing: "border-box", gap: 10, minHeight: 44, padding: "0 4px",
                        borderBottom: `1px solid ${MOBILE_COLORS.line3}`, cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={sel.has(l.id)}
                        onChange={() => toggleSel(l.id)}
                        style={{ width: 18, height: 18, accentColor: MOBILE_COLORS.gold }}
                      />
                      <span className="min-w-0 flex-1 truncate" style={{ fontSize: 13, color: MOBILE_COLORS.textPrimary }}>
                        {l.name}
                      </span>
                      {l.assignedToName && (
                        <span className="flex-none" style={{ fontSize: 11, color: MOBILE_COLORS.textMuted }}>
                          {l.assignedToName}
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              )}
              {sel.size > 0 && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => action([...sel]).then((r) => { setSel(new Set()); return r; }), okText)}
                  className="w-full"
                  style={{
                    boxSizing: "border-box", marginTop: 12, height: 48, borderRadius: 12, border: "none",
                    background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg,
                    fontSize: 14, fontWeight: 700, opacity: pending ? 0.6 : 1,
                  }}
                >
                  {pending ? "جارٍ…" : `${okText.replace("وا ", " ")} (${toArabicDigits(sel.size)})`}
                </button>
              )}
            </div>
          );
        })()}
      </div>

      {/* ======================================================================
          ما تحت هذا الحد للمالك حصرًا — تفريع isOwner نفسه في الديسكتوب.
          الإخفاء للعرض فقط؛ كل أكشن منها محروس بـrequireRole("OWNER") داخله.
         ====================================================================== */}
      {isOwner && (
        <>
          {/* ===== الأتمتة — updateAutoPilotConfig ===== */}
          <div className="m-rise" style={{ ...card, animationDelay: "240ms", borderColor: MOBILE_COLORS.goldBorder }}>
            <div style={{ fontSize: "14.5px", fontWeight: 700, color: MOBILE_COLORS.gold }}>
              الأتمتة — المالك فقط
            </div>

            <div className="flex items-center justify-between" style={{ marginTop: 12 }}>
              <span style={{ fontSize: 13, color: MOBILE_COLORS.textPrimary }}>السحب التلقائي للمتأخر</span>
              <button
                type="button"
                onClick={() => setAp({ ...ap, autoSweepEnabled: !ap.autoSweepEnabled })}
                aria-pressed={ap.autoSweepEnabled}
                style={{
                  boxSizing: "border-box", width: 52, height: 31, borderRadius: 16, border: "none",
                  padding: 3, display: "flex", cursor: "pointer",
                  justifyContent: ap.autoSweepEnabled ? "flex-start" : "flex-end",
                  background: ap.autoSweepEnabled ? MOBILE_COLORS.gold : MOBILE_COLORS.border,
                }}
              >
                <span style={{ width: 25, height: 25, borderRadius: 13, background: "#FFFFFF" }} />
              </button>
            </div>
            {ap.autoSweepEnabled && (
              <p style={{ fontSize: 11, color: MOBILE_STATUS.warning.fg, marginTop: 8, lineHeight: 1.6 }}>
                مع السحب التلقائي، المهلة ما تنزل عن ٦٠ دقيقة (أرضية أمان على الخادم).
              </p>
            )}

            <Row label="دقائق الإنذار قبل السحب (١–١٢٠)">
              <input type="number" min={1} max={120} style={fieldStyle} value={ap.sweepWarnMin}
                onChange={(e) => setAp({ ...ap, sweepWarnMin: Number(e.target.value) })} />
            </Row>
            <div className="grid grid-cols-2" style={{ gap: 10 }}>
              <Row label="نافذة السحب من (٠–٢٣)">
                <input type="number" min={0} max={23} style={fieldStyle} value={ap.sweepStartHour}
                  onChange={(e) => setAp({ ...ap, sweepStartHour: Number(e.target.value) })} />
              </Row>
              <Row label="إلى (٠–٢٣)">
                <input type="number" min={0} max={23} style={fieldStyle} value={ap.sweepEndHour}
                  onChange={(e) => setAp({ ...ap, sweepEndHour: Number(e.target.value) })} />
              </Row>
            </div>

            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    updateAutoPilotConfig({
                      autoSweepEnabled: ap.autoSweepEnabled,
                      distTimeoutMin: f.distTimeoutMin,
                      sweepWarnMin: ap.sweepWarnMin,
                      sweepStartHour: ap.sweepStartHour,
                      sweepEndHour: ap.sweepEndHour,
                      distReassignMode: f.distReassignMode,
                    }),
                  "حُفظت الأتمتة",
                )
              }
              className="w-full"
              style={{
                boxSizing: "border-box", marginTop: 16, height: 48, borderRadius: 12, border: "none",
                background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg,
                fontSize: 14, fontWeight: 700, opacity: pending ? 0.6 : 1,
              }}
            >
              حفظ الأتمتة
            </button>

            {/* الحاجز التاريخي: العدّاد لا يبدأ قبل هذي اللحظة — updateSweepCutoff (مالك). */}
            <Row label="الحاجز التاريخي للسحب (لا يُحتسب ما قبله)">
              <div className="flex" style={{ gap: 8 }}>
                <input
                  type="datetime-local"
                  style={{ ...fieldStyle, flex: 1 }}
                  value={cutoff}
                  onChange={(e) => setCutoff(e.target.value)}
                />
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => updateSweepCutoff(parseRiyadhLocal(cutoff).toISOString()), "حُدّث الحاجز")}
                  style={{
                    boxSizing: "border-box", minHeight: 44, padding: "0 14px", borderRadius: 10,
                    border: `1px solid ${MOBILE_COLORS.goldBorder}`, background: MOBILE_COLORS.goldBg,
                    color: MOBILE_COLORS.gold, fontSize: 13, fontWeight: 700, opacity: pending ? 0.6 : 1,
                  }}
                >
                  حفظ
                </button>
              </div>
            </Row>

            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => protectAllCurrentFromSweep(), "حُصّن الحاليون من السحب")}
              className="w-full"
              style={{
                boxSizing: "border-box", marginTop: 10, height: 44, borderRadius: 12,
                border: `1px solid ${MOBILE_COLORS.border}`, background: MOBILE_COLORS.sheet,
                color: MOBILE_COLORS.textPrimary, fontSize: 13, fontWeight: 600, opacity: pending ? 0.6 : 1,
              }}
            >
              حصّن العملاء الحاليين من السحب
            </button>
          </div>

          {/* ===== مرشّحو السحب — approve/dismiss ===== */}
          <div className="m-rise" style={{ ...card, animationDelay: "300ms" }}>
            <div className="flex items-center justify-between">
              <span style={{ fontSize: "14.5px", fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>
                مرشّحو السحب ({toArabicDigits(candidates.length)})
              </span>
              {candidates.length > 0 && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => dismissAllSweepCandidates(), "أُلغي كل المرشّحين")}
                  style={{
                    boxSizing: "border-box", minHeight: 44, padding: "0 10px", borderRadius: 10,
                    border: "none", background: "none", color: MOBILE_COLORS.textMuted,
                    fontSize: 12, fontWeight: 600,
                  }}
                >
                  ألغِ الكل
                </button>
              )}
            </div>

            {candidates.length === 0 ? (
              <p style={{ fontSize: "12.5px", color: MOBILE_COLORS.textMuted, marginTop: 10 }}>
                ما فيه مرشّحون الآن
              </p>
            ) : (
              candidates.map((c) => (
                <div
                  key={c.id}
                  style={{
                    boxSizing: "border-box", marginTop: 10, padding: "11px 12px", borderRadius: 12,
                    background: MOBILE_COLORS.bg, border: `1px solid ${MOBILE_COLORS.border}`,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: MOBILE_COLORS.textPrimary }}>
                    {c.leadName}
                  </div>
                  <div style={{ fontSize: "11.5px", color: MOBILE_COLORS.textMuted, marginTop: 4 }}>
                    {c.fromName ?? "غير مُسند"}
                  </div>
                  <div className="flex" style={{ gap: 8, marginTop: 10 }}>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => approveSweepPull(c.id), "تمّ السحب")}
                      className="flex-1"
                      style={{
                        boxSizing: "border-box", minHeight: 44, borderRadius: 10, border: "none",
                        background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg,
                        fontSize: 13, fontWeight: 700,
                      }}
                    >
                      اسحبه
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => dismissSweepCandidate(c.id), "أُلغي المرشّح")}
                      className="flex-1"
                      style={{
                        boxSizing: "border-box", minHeight: 44, borderRadius: 10,
                        border: `1px solid ${MOBILE_COLORS.border}`, background: MOBILE_COLORS.sheet,
                        color: MOBILE_COLORS.textSecondary, fontSize: 13, fontWeight: 600,
                      }}
                    >
                      تجاهل
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default MobileDistributionPanel;
