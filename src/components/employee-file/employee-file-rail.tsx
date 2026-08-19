"use client";

import { useState } from "react";
import { toArabicDigits } from "@/lib/format";
import type { EFBundle } from "./types";
import type { ToastFn } from "./employee-file-view";

/**
 * العمود الجانبي اللاصق — هوية بنبض حي + أدوات المالك + بند الإجازة المتوسّع +
 * الإعدادات السريعة (متزامنة مع اللوحة الكاملة — نفس الحالة من الأب) + الدوائر.
 * القرارات كلها عبر مسارات v3/الإجازات القائمة؛ المعطّل بصريًا = فجوة موثّقة.
 */

const RADAR_LABEL: Record<string, string> = {
  present: "بالموقع", out: "خارج النطاق", weak: "إشارة ضعيفة", gap: "انقطاع نبض", off: "غير متصل",
};

export function EmployeeFileRail(props: {
  bundle: EFBundle;
  showToast: ToastFn;
  onOpenCheckout: () => void;
  onExport: () => void;
  winStart: number;
  winEnd: number;
  goalHours: number;
  setWinStart: (v: number) => void;
  setWinEnd: (v: number) => void;
  setGoalHours: (f: (g: number) => number) => void;
  onSaveSchedule: () => void;
  savingSched: boolean;
  refresh: () => void;
}) {
  const { bundle, showToast, refresh } = props;
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveDone, setLeaveDone] = useState<string | null>(null);
  const [deduct, setDeduct] = useState(true);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [callBusy, setCallBusy] = useState(false);
  const [repairOpen, setRepairOpen] = useState(false);

  const lv = bundle.leaves.pending[0] ?? null;
  const bal = bundle.leaves.balance;

  const triggerCall = async () => {
    setCallBusy(true);
    try {
      const res = await fetch("/api/attendance/verification/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: bundle.user.id }),
      });
      const d = (await res.json()) as { ok: boolean; error?: string; message?: string };
      if (d.ok) showToast("✓ أُرسل نداء التحقق — بانتظار رده");
      else showToast(d.error ?? d.message ?? "ما نقدر نرسل النداء الآن", true);
    } catch {
      showToast("تعذّر الاتصال — حاول مرة ثانية", true);
    }
    setCallBusy(false);
  };

  const decideLeave = async (approve: boolean) => {
    if (!lv) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/leaves/${lv.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          approve ? { decision: "APPROVE", deductFromBalance: deduct } : { decision: "REJECT", note: note.trim() || undefined },
        ),
      });
      const d = (await res.json()) as { ok: boolean; message?: string };
      if (d.ok) {
        if (approve) {
          setLeaveDone(`اعتُمدت ${lv.rangeText} · استُثنيت تلقائيًا${deduct ? " · خُصمت من رصيده" : ""}`);
          showToast(`✓ اعتُمدت الإجازة ${lv.rangeText} · استُثنيت من الغياب تلقائيًا${deduct ? ` · خُصمت من رصيده` : ""}`);
        } else {
          setLeaveDone(`رُفض طلب ${lv.rangeText}`);
          showToast(`رُفض طلب الإجازة ${lv.rangeText} · قُيّد بالتدقيق`);
        }
        refresh();
      } else showToast(d.message ?? "تعذّر تنفيذ القرار", true);
    } catch {
      showToast("تعذّر الاتصال — حاول مرة ثانية", true);
    }
    setBusy(false);
  };

  const closeDayNow = async () => {
    if (!bundle.openSession) return;
    setBusy(true);
    try {
      const res = await fetch("/api/attendance/session-repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "CLOSE",
          sessionId: bundle.openSession.id,
          atIso: new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 16),
          reason: "قفل اليوم يدويًا من ملف الموظف",
        }),
      });
      const d = (await res.json()) as { ok: boolean; error?: string };
      if (d.ok) {
        showToast("✓ قُفل اليوم يدويًا · قُيّد بالتدقيق باسمك");
        refresh();
      } else showToast(d.error ?? "تعذّر القفل", true);
    } catch {
      showToast("تعذّر الاتصال", true);
    }
    setBusy(false);
  };

  return (
    <div className="rail">
      {/* الهوية */}
      <div className="card">
        <div className="idmini">
          <div className="av">{bundle.user.name.trim().charAt(0)}</div>
          <div style={{ flex: 1 }}>
            <h2>{bundle.user.name}</h2>
            <p>
              <span className={`pulse ${bundle.user.online ? "" : "off"}`} /> {bundle.user.online ? "متصل" : "غير متصل"}
              {" · "}
              {RADAR_LABEL[bundle.radar.state] ?? bundle.radar.state}
              {bundle.radar.locationName ? ` — ${bundle.radar.locationName}` : ""}
              {" · "}
              {bundle.enforcement.mode === "STRICT" ? "ملزم بالبصمة" : bundle.enforcement.mode === "WATCH_ONLY" ? "مراقبة فقط" : "معفى مؤقتًا"}
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 7, marginTop: 13 }}>
          <button type="button" className="btn gold mini" style={{ flex: 1, justifyContent: "center" }} onClick={() => void triggerCall()} disabled={callBusy}>
            {callBusy ? "جاري…" : "نداء تحقق"}
          </button>
          <button type="button" className="btn ghost mini" onClick={props.onExport}>تصدير</button>
        </div>
      </div>

      {/* أدوات المالك */}
      <div className="card" style={{ background: "linear-gradient(155deg,#1a1408,#111214)", borderColor: "rgba(203,164,94,.25)" }}>
        <h4 style={{ color: "var(--gold)" }}>
          أدوات المالك <span className="hc">برسالة أو بصمت — أنت المتحكم</span>
        </h4>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <button
            type="button"
            className="btn red mini"
            style={{ justifyContent: "flex-start" }}
            onClick={props.onOpenCheckout}
            disabled={!bundle.openSession}
            title={bundle.openSession ? undefined : "ما فيه جلسة مفتوحة الآن"}
          >
            سجّل له انصراف الآن
          </button>
          <button type="button" className="btn ghost mini" style={{ justifyContent: "flex-start" }} disabled title="تسجيل حضور بالنيابة غير موصول بعد — البصم ذاتي فقط (فجوة موثّقة)">
            سجّل له حضورًا
          </button>
          <button type="button" className="btn ghost mini" style={{ justifyContent: "flex-start" }} onClick={() => setRepairOpen((v) => !v)}>
            صحّح جلسة سابقة
          </button>
          <button
            type="button"
            className="btn ghost mini"
            style={{ justifyContent: "flex-start" }}
            onClick={() => void closeDayNow()}
            disabled={!bundle.openSession || busy}
            title={bundle.openSession ? "يقفل الجلسة المفتوحة الآن" : "ما فيه جلسة مفتوحة — اليوم مقفول أصلًا"}
          >
            قفل اليوم يدويًا
          </button>
        </div>
        {repairOpen && <RepairPanel bundle={bundle} showToast={showToast} refresh={refresh} />}
      </div>

      {/* بند الإجازة */}
      {leaveDone ? (
        <div className="leave-wrap">
          <div className="leave-done">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            {leaveDone}
          </div>
        </div>
      ) : lv ? (
        <div className={`leave-wrap ${leaveOpen ? "open" : ""}`}>
          <button type="button" className="leave-chip" onClick={() => setLeaveOpen((v) => !v)}>
            <span className="n">{toArabicDigits(bundle.leaves.pending.length)}</span>
            <div className="tt2">
              طلب إجازة ينتظرك
              <span>{lv.typeLabel} · {toArabicDigits(lv.days)} {lv.days === 1 ? "يوم" : lv.days === 2 ? "يومان" : "أيام"} · {lv.rangeText} · قدّمه {lv.createdText}</span>
            </div>
            <svg className="chev" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
          </button>
          <div className="leave-exp">
            <div className="lq">«{lv.reason}»</div>
            <div className="lvctl">
              <div>استثناء تلقائي من الغياب<div className="d">أول ما تعتمد — ما يُحسب غيابًا ولا يُنادى</div></div>
              <button type="button" className="tog on" disabled title="يحدث دائمًا مع الاعتماد — غير قابل للفصل" aria-label="استثناء تلقائي" />
            </div>
            <div className="lvctl">
              <div>خصم من رصيده<div className="d">رصيده الآن {toArabicDigits(bal.remainingDays)} من {toArabicDigits(bal.entitledDays)}{deduct ? ` — بعد الاعتماد ${toArabicDigits(Math.max(0, bal.remainingDays - lv.days))}` : ""}</div></div>
              <button type="button" className={`tog ${deduct ? "on" : ""}`} onClick={() => setDeduct((v) => !v)} aria-label="خصم من الرصيد" />
            </div>
            <div className="lvctl">
              <div>إشعاره بالقرار</div>
              <button type="button" className="tog on" disabled title="إشعار قرار الإجازة غير موصول بعد (فجوة موثّقة)" aria-label="إشعار القرار" />
            </div>
            {rejecting ? (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 7 }}>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="ملاحظة الرفض (اختيارية)"
                  style={{ width: "100%", borderRadius: 10, border: "1px solid var(--line)", background: "transparent", color: "var(--text)", padding: "8px 10px", fontSize: 11.5, resize: "none", fontFamily: "inherit" }}
                />
                <div style={{ display: "flex", gap: 7 }}>
                  <button type="button" className="btn red mini" disabled={busy} onClick={() => void decideLeave(false)}>{busy ? "..." : "تأكيد الرفض"}</button>
                  <button type="button" className="btn ghost mini" onClick={() => { setRejecting(false); setNote(""); }}>إلغاء</button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 7, marginTop: 10 }}>
                <button type="button" className="btn green mini" disabled={busy} onClick={() => void decideLeave(true)}>✓ اعتماد</button>
                <button type="button" className="btn red mini" disabled={busy} onClick={() => setRejecting(true)}>رفض</button>
                <button type="button" className="btn ghost mini" disabled title="تعديل مدة الطلب غير موصول بعد (فجوة موثّقة)">تعديل</button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="card">
          <h4>الإجازات <span className="hc">رصيده {toArabicDigits(bal.remainingDays)} من {toArabicDigits(bal.entitledDays)}</span></h4>
          <div className="subtxt" style={{ marginTop: 0 }}>ما فيه طلب إجازة معلّق.</div>
        </div>
      )}

      {/* الإعدادات السريعة — متزامنة مع اللوحة الكاملة */}
      <div className="card">
        <h4>الإعدادات <span className="hc">عدّل مباشرة — يُقيَّد بالتدقيق</span></h4>
        <div className="srow">
          <div>وضع الدوام<div className="sd">تبديل الأوضاع غير موصول بعد (م٤ج)</div></div>
          <span className="sv2" style={{ opacity: 0.7 }}>
            {bundle.enforcement.mode === "STRICT" ? "ملزم — كامل" : bundle.enforcement.mode === "WATCH_ONLY" ? "مراقبة فقط" : "معفى مؤقتًا"}
          </span>
        </div>
        <div className="srow">
          <div>نافذة البداية<div className="sd">اضغط الوقت لتغييره</div></div>
          <span style={{ display: "flex", gap: 5, alignItems: "center" }}>
            <span
              className="chipq"
              onClick={() => {
                const order = [480, 540, 600];
                props.setWinStart(order[(order.indexOf(props.winStart) + 1) % order.length] ?? 540);
              }}
            >
              {toArabicDigits(props.winStart / 60 > 12 ? props.winStart / 60 - 12 : props.winStart / 60)} {props.winStart < 720 ? "ص" : "م"}
            </span>
            <span style={{ fontSize: 10, color: "var(--muted)" }}>إلى</span>
            <span
              className="chipq"
              onClick={() => {
                const order = [600, 660, 720].filter((v) => v > props.winStart);
                const cur = order.indexOf(props.winEnd);
                props.setWinEnd(order[(cur + 1) % order.length] ?? 660);
              }}
            >
              {toArabicDigits(props.winEnd / 60 > 12 ? props.winEnd / 60 - 12 : props.winEnd / 60)} {props.winEnd < 720 ? "ص" : "م"}
            </span>
          </span>
        </div>
        <div className="srow">
          <div>هدف اليوم — ساعات</div>
          <div className="mini-step">
            <button type="button" onClick={() => props.setGoalHours((g) => Math.max(4, g - 1))}>−</button>
            <span className="v num">{toArabicDigits(props.goalHours)}</span>
            <button type="button" onClick={() => props.setGoalHours((g) => Math.min(12, g + 1))}>+</button>
          </div>
        </div>
        <div className="srow">
          <div>نداءات عشوائية/يوم<div className="sd">إعداد عام لكل الفريق</div></div>
          <div className="mini-step">
            <button type="button" disabled>−</button>
            <span className="v num">{toArabicDigits(bundle.globalView.verificationPerDay)}</span>
            <button type="button" disabled>+</button>
          </div>
        </div>
        <div className="srow">
          <div>نداء خروج النطاق<div className="sd">مهلة {toArabicDigits(bundle.globalView.maxOutOfZoneMinutes)} د — عام</div></div>
          <button type="button" className="tog on" disabled aria-label="إعداد عام" />
        </div>
        <button type="button" className="btn gold mini" style={{ width: "100%", justifyContent: "center", marginTop: 11 }} onClick={props.onSaveSchedule} disabled={props.savingSched}>
          {props.savingSched ? "جاري الحفظ…" : "حفظ التعديلات"}
        </button>
      </div>

      {/* الدوائر المسموحة */}
      <div className="card">
        <h4>الدوائر المسموحة <span className="hc">تنطبق على الجميع</span></h4>
        <div className="zones">
          {bundle.zones.map((z) => (
            <span key={z.id} className={`zone ${z.active ? "" : "off"}`} title="النطاقات عامة لكل الفريق — إدارتها من حوكمة الدوام">
              {z.active ? "✓ " : ""}{z.name}
            </span>
          ))}
        </div>
        <div style={{ fontSize: 9.5, color: "var(--muted)", marginTop: 9 }}>{bundle.deviceLine}</div>
      </div>
    </div>
  );
}

/** تصحيح جلسة سابقة — EDIT عبر session-repair القائمة (سبب إلزامي، يُقيَّد بالتدقيق). */
function RepairPanel({ bundle, showToast, refresh }: { bundle: EFBundle; showToast: ToastFn; refresh: () => void }) {
  const [sessionId, setSessionId] = useState("");
  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const sessions = bundle.repairSessions.filter((s) => !s.voided).slice(0, 12);
  const sel = sessions.find((s) => s.id === sessionId) ?? null;

  const submit = async () => {
    if (!sel || !reason.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/attendance/session-repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "EDIT",
          sessionId: sel.id,
          startIso: startLocal || undefined,
          endIso: endLocal || undefined,
          reason: reason.trim(),
        }),
      });
      const d = (await res.json()) as { ok: boolean; error?: string };
      if (d.ok) {
        showToast("✓ صُححت الجلسة وأُعيد حساب الدقائق · قُيّدت بالتدقيق باسمك");
        setSessionId(""); setStartLocal(""); setEndLocal(""); setReason("");
        refresh();
      } else showToast(d.error ?? "تعذّر التصحيح", true);
    } catch {
      showToast("تعذّر الاتصال", true);
    }
    setBusy(false);
  };

  const inputStyle = { width: "100%", borderRadius: 9, border: "1px solid var(--line)", background: "#0c0d0f", color: "var(--text)", padding: "7px 9px", fontSize: 11, fontFamily: "inherit" } as const;
  return (
    <div style={{ marginTop: 11, borderTop: "1px solid var(--line)", paddingTop: 11, display: "flex", flexDirection: "column", gap: 7 }}>
      <select value={sessionId} onChange={(e) => { setSessionId(e.target.value); const s = sessions.find((x) => x.id === e.target.value); setStartLocal(s?.startedLocal ?? ""); setEndLocal(s?.endedLocal ?? ""); }} style={inputStyle}>
        <option value="">اختر جلسة…</option>
        {sessions.map((s) => (
          <option key={s.id} value={s.id}>
            {s.dayKey} · {s.startedText} ← {s.endedText ?? "مفتوحة"}{s.autoClosed ? " (آلي)" : ""}
          </option>
        ))}
      </select>
      {sel && (
        <>
          <label style={{ fontSize: 9.5, color: "var(--muted)" }}>البداية<input type="datetime-local" value={startLocal} onChange={(e) => setStartLocal(e.target.value)} style={{ ...inputStyle, marginTop: 4 }} dir="ltr" /></label>
          <label style={{ fontSize: 9.5, color: "var(--muted)" }}>النهاية<input type="datetime-local" value={endLocal} onChange={(e) => setEndLocal(e.target.value)} style={{ ...inputStyle, marginTop: 4 }} dir="ltr" /></label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="سبب التصحيح (إلزامي — يظهر بالتدقيق)" style={inputStyle} />
          <button type="button" className="btn gold mini" style={{ justifyContent: "center" }} disabled={busy || !reason.trim()} onClick={() => void submit()}>
            {busy ? "جاري…" : "تصحيح الجلسة"}
          </button>
        </>
      )}
    </div>
  );
}
