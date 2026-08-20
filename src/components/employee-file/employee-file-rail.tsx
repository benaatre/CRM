"use client";

import { useState } from "react";
import { toArabicDigits } from "@/lib/format";
import type { EFBundle } from "./types";
import type { ToastFn, EFCfgState } from "./employee-file-view";

/**
 * العمود الجانبي اللاصق — كل عنصر حي (ملف الموظف الحي): هوية بنبض + أدوات المالك
 * الأربعة شغّالة + بند الإجازة (اعتماد/رفض/تعديل + إشعار القرار) + الإعدادات
 * السريعة المتزامنة مع اللوحة (نفس الحالة من الأب) + الدوائر.
 */

const RADAR_LABEL: Record<string, string> = {
  present: "بالموقع", out: "خارج النطاق", weak: "إشارة ضعيفة", gap: "انقطاع نبض", off: "غير متصل",
};
const MODE_LABEL: Record<EFCfgState["mode"], string> = {
  STRICT: "ملزم — كامل", WATCH_ONLY: "مراقبة فقط", EXEMPT: "معفى مؤقتًا",
};

export function EmployeeFileRail(props: {
  bundle: EFBundle;
  showToast: ToastFn;
  onOpenCheckout: () => void;
  onExport: () => void;
  winStart: number;
  winEnd: number;
  goalHours: number;
  cfg: EFCfgState;
  /** يمرّر للوحة «إلزام البصمة» — التعديل في مكان واحد فقط (UX 2026-08-19). */
  onEditSettings: () => void;
  refresh: () => void;
}) {
  const { bundle, showToast, refresh, cfg } = props;
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveDone, setLeaveDone] = useState<string | null>(null);
  const [deduct, setDeduct] = useState(true);
  const [notifyDecision, setNotifyDecision] = useState(true);
  const [rejecting, setRejecting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editFrom, setEditFrom] = useState("");
  const [editTo, setEditTo] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [callBusy, setCallBusy] = useState(false);
  const [repairOpen, setRepairOpen] = useState(false);
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [lockConfirm, setLockConfirm] = useState(false);
  const [lockReason, setLockReason] = useState("");

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
          approve
            ? { decision: "APPROVE", deductFromBalance: deduct, notifyEmployee: notifyDecision }
            : { decision: "REJECT", note: note.trim() || undefined, notifyEmployee: notifyDecision },
        ),
      });
      const d = (await res.json()) as { ok: boolean; message?: string };
      if (d.ok) {
        if (approve) {
          setLeaveDone(`اعتُمدت ${lv.rangeText} · استُثنيت تلقائيًا${deduct ? " · خُصمت من رصيده" : ""}${notifyDecision ? " · وصله الإشعار" : ""}`);
          showToast(`✓ اعتُمدت الإجازة ${lv.rangeText} · استُثنيت من الغياب تلقائيًا${deduct ? ` · خُصمت من رصيده` : ""}${notifyDecision ? " · وأُشعر الموظف" : ""}`);
        } else {
          setLeaveDone(`رُفض طلب ${lv.rangeText}${notifyDecision ? " · وصله الإشعار" : ""}`);
          showToast(`رُفض طلب الإجازة ${lv.rangeText} · قُيّد بالتدقيق${notifyDecision ? " · وأُشعر الموظف" : ""}`);
        }
        refresh();
      } else showToast(d.message ?? "تعذّر تنفيذ القرار", true);
    } catch {
      showToast("تعذّر الاتصال — حاول مرة ثانية", true);
    }
    setBusy(false);
  };

  const submitEdit = async () => {
    if (!lv || !editFrom || !editTo) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/leaves/${lv.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "EDIT", edit: { fromKey: editFrom, toKey: editTo } }),
      });
      const d = (await res.json()) as { ok: boolean; message?: string };
      if (d.ok) {
        showToast("✓ عُدّل مدى الطلب · قُيّد بالتدقيق باسمك");
        setEditing(false);
        refresh();
      } else showToast(d.message ?? "تعذّر التعديل", true);
    } catch {
      showToast("تعذّر الاتصال", true);
    }
    setBusy(false);
  };

  const lockDay = async () => {
    if (!lockReason.trim()) { showToast("اكتب سبب القفل", true); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/attendance/day-lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: bundle.user.id, reason: lockReason.trim() }),
      });
      const d = (await res.json()) as { ok: boolean; error?: string };
      if (d.ok) {
        showToast("✓ قُفل اليوم نهائيًا — بصمة جديدة = يوم جديد · قُيّد بالتدقيق باسمك");
        setLockConfirm(false);
        setLockReason("");
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
              {cfg.mode === "STRICT" ? "ملزم بالبصمة" : cfg.mode === "WATCH_ONLY" ? "مراقبة فقط" : "معفى مؤقتًا"}
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
          <button
            type="button"
            className="btn ghost mini"
            style={{ justifyContent: "flex-start" }}
            onClick={() => setCheckinOpen(true)}
            disabled={!!bundle.openSession || bundle.todayLocked}
            title={bundle.openSession ? "عنده جلسة مفتوحة أصلًا" : bundle.todayLocked ? "يومه مقفول" : undefined}
          >
            سجّل له حضورًا
          </button>
          <button type="button" className="btn ghost mini" style={{ justifyContent: "flex-start" }} onClick={() => setRepairOpen((v) => !v)}>
            صحّح جلسة سابقة
          </button>
          <button
            type="button"
            className="btn ghost mini"
            style={{ justifyContent: "flex-start" }}
            onClick={() => setLockConfirm((v) => !v)}
            disabled={bundle.todayLocked}
            title={bundle.todayLocked ? "اليوم مقفول أصلًا" : "يوم انقفل انقفل — بصمة جديدة = يوم جديد"}
          >
            {bundle.todayLocked ? "اليوم مقفول ✓" : "قفل اليوم يدويًا"}
          </button>
        </div>
        {lockConfirm && !bundle.todayLocked && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 7 }}>
            <input
              value={lockReason}
              onChange={(e) => setLockReason(e.target.value)}
              placeholder="سبب القفل (إلزامي — يظهر بالتدقيق)"
              style={{ width: "100%", borderRadius: 9, border: "1px solid var(--line)", background: "#0c0d0f", color: "var(--text)", padding: "7px 9px", fontSize: 11, fontFamily: "inherit" }}
            />
            <div style={{ display: "flex", gap: 7 }}>
              <button type="button" className="btn red mini" disabled={busy || !lockReason.trim()} onClick={() => void lockDay()}>
                {busy ? "..." : "تأكيد القفل — يوم انقفل انقفل"}
              </button>
              <button type="button" className="btn ghost mini" onClick={() => setLockConfirm(false)}>إلغاء</button>
            </div>
          </div>
        )}
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
              <button type="button" className="tog on" disabled title="يحدث دائمًا مع الاعتماد" aria-label="استثناء تلقائي" />
            </div>
            <div className="lvctl">
              <div>خصم من رصيده<div className="d">رصيده الآن {toArabicDigits(bal.remainingDays)} من {toArabicDigits(bal.entitledDays)}{deduct ? ` — بعد الاعتماد ${toArabicDigits(Math.max(0, bal.remainingDays - lv.days))}` : ""}</div></div>
              <button type="button" className={`tog ${deduct ? "on" : ""}`} onClick={() => setDeduct((v) => !v)} aria-label="خصم من الرصيد" />
            </div>
            <div className="lvctl">
              <div>إشعاره بالقرار<div className="d">push فوري باعتماد/رفض طلبه</div></div>
              <button type="button" className={`tog ${notifyDecision ? "on" : ""}`} onClick={() => setNotifyDecision((v) => !v)} aria-label="إشعار القرار" />
            </div>
            {editing ? (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 7 }}>
                <div style={{ display: "flex", gap: 7 }}>
                  <label style={{ flex: 1, fontSize: 9.5, color: "var(--muted)" }}>
                    من
                    <input type="date" value={editFrom} onChange={(e) => setEditFrom(e.target.value)} dir="ltr" style={{ marginTop: 3, width: "100%", borderRadius: 9, border: "1px solid var(--line)", background: "#0c0d0f", color: "var(--text)", padding: "6px 8px", fontSize: 11 }} />
                  </label>
                  <label style={{ flex: 1, fontSize: 9.5, color: "var(--muted)" }}>
                    إلى
                    <input type="date" value={editTo} min={editFrom} onChange={(e) => setEditTo(e.target.value)} dir="ltr" style={{ marginTop: 3, width: "100%", borderRadius: 9, border: "1px solid var(--line)", background: "#0c0d0f", color: "var(--text)", padding: "6px 8px", fontSize: 11 }} />
                  </label>
                </div>
                <div style={{ display: "flex", gap: 7 }}>
                  <button type="button" className="btn gold mini" disabled={busy || !editFrom || !editTo} onClick={() => void submitEdit()}>{busy ? "..." : "حفظ التعديل"}</button>
                  <button type="button" className="btn ghost mini" onClick={() => setEditing(false)}>إلغاء</button>
                </div>
              </div>
            ) : rejecting ? (
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
                <button type="button" className="btn ghost mini" disabled={busy} onClick={() => { setEditFrom(lv.fromKey); setEditTo(lv.toKey); setEditing(true); }}>تعديل</button>
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

      {/* ملخص الإعدادات — قراءة فقط: التعديل حصريًا في لوحة «إلزام البصمة» (UX 2026-08-19) */}
      <div className="card">
        <h4>الإعدادات <span className="hc">ملخص — التعديل من اللوحة الرئيسية</span></h4>
        <div className="sumline">
          <span className="sl">الوضع</span>
          <span className={`sv ${cfg.mode !== "STRICT" ? "gold" : ""}`}>{MODE_LABEL[cfg.mode]}</span>
        </div>
        <div className="sumline">
          <span className="sl">نافذة البداية</span>
          <span className="sv num">
            {toArabicDigits(props.winStart / 60 > 12 ? props.winStart / 60 - 12 : props.winStart / 60)} {props.winStart < 720 ? "ص" : "م"}
            {" — "}
            {toArabicDigits(props.winEnd / 60 > 12 ? props.winEnd / 60 - 12 : props.winEnd / 60)} {props.winEnd < 720 ? "ص" : "م"}
          </span>
        </div>
        <div className="sumline">
          <span className="sl">هدف اليوم</span>
          <span className="sv num">{toArabicDigits(props.goalHours)} ساعات</span>
        </div>
        {cfg.mode === "EXEMPT" && (
          <div className="sumline">
            <span className="sl">معفى حتى</span>
            <span className="sv gold">{cfg.exemptUntilKey ? cfg.exemptUntilKey.split("-").reverse().map((x) => toArabicDigits(Number(x))).join("/") : "بلا نهاية"}{cfg.exemptReason ? ` · ${cfg.exemptReason}` : ""}</span>
          </div>
        )}
        <button type="button" className="btn ghost mini" style={{ width: "100%", justifyContent: "center", marginTop: 11 }} onClick={props.onEditSettings}>
          تعديل الإعدادات
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

      {checkinOpen && (
        <ManualCheckinModal bundle={bundle} onClose={() => setCheckinOpen(false)} showToast={showToast} refresh={refresh} />
      )}
    </div>
  );
}

/** مودال «تسجيل حضور بالنيابة» — الآن/وقت مخصص + إشعار أو صامت + سبب إلزامي. */
function ManualCheckinModal({ bundle, onClose, showToast, refresh }: { bundle: EFBundle; onClose: () => void; showToast: ToastFn; refresh: () => void }) {
  const [timeMode, setTimeMode] = useState<"now" | "custom">("now");
  const [customLocal, setCustomLocal] = useState("");
  const [notifyOn, setNotifyOn] = useState(true);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!reason.trim()) { showToast("اكتب سبب التسجيل", true); return; }
    if (timeMode === "custom" && !customLocal) { showToast("حدّد الوقت", true); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/attendance/manual-checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: bundle.user.id,
          atIso: timeMode === "custom" ? customLocal : undefined,
          reason: reason.trim(),
          notify: notifyOn,
        }),
      });
      const d = (await res.json()) as { ok: boolean; error?: string };
      if (d.ok) {
        onClose();
        showToast(notifyOn ? "✓ سُجّل الحضور · أُرسل الإشعار · قُيّد بالتدقيق" : "✓ سُجّل الحضور · صامت — ما وصله شيء · قُيّد بالتدقيق");
        refresh();
      } else showToast(d.error ?? "تعذّر التسجيل", true);
    } catch {
      showToast("تعذّر الاتصال — حاول مرة ثانية", true);
    }
    setBusy(false);
  };

  return (
    <div className="ef ef-overlay" dir="rtl" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h3>تسجيل حضور — {bundle.user.name}</h3>
        <div className="ms">حاضر فعلًا وما بصم (جهاز/إذن/ظرف)؟ سجّل له أنت — وأنت تقرر توصله رسالة أو لا.</div>
        <div className="mrow">
          <label>وقت الحضور</label>
          <div className="timebox">
            <button type="button" className={`tchip ${timeMode === "now" ? "on" : ""}`} onClick={() => setTimeMode("now")}>الآن</button>
            <button type="button" className={`tchip ${timeMode === "custom" ? "on" : ""}`} onClick={() => setTimeMode("custom")}>وقت مخصص…</button>
          </div>
          {timeMode === "custom" && (
            <input type="datetime-local" value={customLocal} onChange={(e) => setCustomLocal(e.target.value)} style={{ marginTop: 8 }} dir="ltr" />
          )}
        </div>
        <div className="mrow">
          <label>السبب — إلزامي، يظهر بالتدقيق</label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="مثال: جواله خرب وحضر بالمقر"
            style={{ width: "100%", borderRadius: 10, border: "1px solid #1c1e22", background: "#0c0d0f", color: "#EDEDEF", padding: "9px 12px", fontSize: 12, fontFamily: "inherit" }}
          />
        </div>
        <div className="mrow">
          <label>الإشعار — أنت المتحكم</label>
          <div className={`notify-opt ${notifyOn ? "on" : ""}`} onClick={() => setNotifyOn(true)}>
            <span className="radio2" />
            <div style={{ flex: 1 }}>
              <div className="nt">أرسل له إشعارًا</div>
              <div className="ns">توصله رسالة push فورية:</div>
              <div className="msg-preview">«سجّلت لك الإدارة حضورًا — عدّاد دوامك شغّال الآن.»</div>
            </div>
          </div>
          <div className={`notify-opt ${!notifyOn ? "on" : ""}`} onClick={() => setNotifyOn(false)}>
            <span className="radio2" />
            <div><div className="nt">بدون رسالة — تسجيل صامت</div><div className="ns">يُقيَّد بملفه وسجل التدقيق فقط.</div></div>
          </div>
        </div>
        <div className="mfoot">
          <button type="button" className="btn gold" onClick={() => void confirm()} disabled={busy}>{busy ? "جاري…" : "تأكيد الحضور"}</button>
          <button type="button" className="btn ghost" onClick={onClose}>إلغاء</button>
        </div>
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
