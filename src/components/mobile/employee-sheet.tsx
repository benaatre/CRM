"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  fetchEmployeeDetail, fetchProjectsList, updateEmployee, inviteEmployee,
  type EmployeeDetail,
} from "@/lib/actions/team";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { BottomSheet } from "@/components/mobile/bottom-sheet";

/**
 * ورقة «إعدادات الموظف» — نسخة جوال من `team/employee-settings-dialog.tsx`
 * بنفس الحقول ونفس الأكشنات حرفيًا، بلا زيادة ولا نقصان:
 *   fetchEmployeeDetail · fetchProjectsList · updateEmployee · inviteEmployee
 * كلها `requireManager()` داخلها؛ وشاشة /m/team نفسها خلف requireManager.
 *
 * ملاحظة صلاحية منقولة كما هي: الفورم يعرض «مالك» في قائمة الدور، والخادم
 * (updateEmployee) يرفض غير EMPLOYEE/ADMIN ولا ينزّل مالكًا أبدًا.
 */
export function MobileEmployeeSheet({
  userId, name, onClose,
}: {
  userId: string | null;
  name: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [detail, setDetail] = useState<EmployeeDetail | null>(null);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [allowed, setAllowed] = useState<Set<string>>(new Set());
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteMsg, setInviteMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!userId) { setDetail(null); return; }
    setError(null);
    setInviteMsg(null);
    Promise.all([fetchEmployeeDetail(userId), fetchProjectsList()]).then(([d, p]) => {
      setDetail(d);
      setProjects(p);
      if (d) { setAllowed(new Set(d.allowedProjectIds)); setActive(d.active); }
    });
  }, [userId]);

  function sendInvite() {
    if (!userId) return;
    setInviteMsg(null);
    startTransition(async () => {
      const res = await inviteEmployee(userId);
      setInviteMsg({ ok: res.ok, text: res.ok ? (res.message ?? "تم الإرسال") : (res.error ?? "صار خطأ") });
    });
  }

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!userId) return;
    setError(null);
    const fd = new FormData(e.currentTarget);
    allowed.forEach((id) => fd.append("allowedProjects", id));
    fd.set("active", active ? "on" : "");
    startTransition(async () => {
      const res = await updateEmployee(userId, fd);
      if (res.ok) { router.refresh(); onClose(); }
      else setError(res.error ?? "صار خطأ");
    });
  }

  return (
    <BottomSheet
      open={!!userId}
      onClose={onClose}
      title="إعدادات الموظف"
      subtitle={name}
      tall
      footer={
        detail ? (
          /* خارج <form> — نربطه به بسمة form حتى يبقى زرّ إرسال حقيقيًا. */
          <button
            type="submit"
            form="m-emp-form"
            disabled={pending}
            className="m-press m-sweep w-full"
            style={{
              boxSizing: "border-box", height: 48, borderRadius: 12, border: "none",
              background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg,
              fontSize: 14, fontWeight: 700, opacity: pending ? 0.6 : 1,
            }}
          >
            {pending ? "جارٍ…" : "حفظ"}
          </button>
        ) : null
      }
    >
      {!detail ? (
        <p style={{ fontSize: "12.5px", color: MOBILE_COLORS.textMuted, padding: "26px 0", textAlign: "center" }}>
          جارٍ التحميل…
        </p>
      ) : (
        <form id="m-emp-form" onSubmit={save} style={{ marginTop: 18 }}>
          <div className="grid grid-cols-2" style={{ gap: 10 }}>
            <Field label="الاسم">
              <input name="name" required defaultValue={detail.name} style={fieldStyle} />
            </Field>
            <Field label="الجوال">
              <input name="phone" dir="ltr" defaultValue={detail.phone ?? ""} style={fieldStyle} />
            </Field>
          </div>

          <Field label="الإيميل (اختياري)">
            <input name="email" type="email" dir="ltr" defaultValue={detail.email ?? ""} placeholder="name@example.com" style={fieldStyle} />
          </Field>

          <Field label="الدور">
            <select name="role" defaultValue={detail.role} style={fieldStyle}>
              <option value="EMPLOYEE">موظف مبيعات</option>
              <option value="ADMIN">مدير</option>
            <option value="HR">موارد بشرية</option>
            <option value="FINANCE">مدير مالي</option>
              <option value="OWNER">مالك</option>
            </select>
          </Field>

          <Field label="تغيير الرمز (PIN)">
            <input name="pin" inputMode="numeric" dir="ltr" maxLength={6} placeholder="اتركه فارغ" style={fieldStyle} />
          </Field>

          <div className="grid grid-cols-2" style={{ gap: 10 }}>
            <Field label="الهدف الشهري">
              <input name="target" inputMode="numeric" dir="ltr" defaultValue={detail.targetDeals || ""} style={fieldStyle} />
            </Field>
            <Field label="الحد الأقصى للعملاء">
              <input name="maxClients" inputMode="numeric" dir="ltr" defaultValue={detail.maxClients ?? ""} placeholder="اختياري" style={fieldStyle} />
            </Field>
          </div>

          <Field label="المشاريع المسموح بيعها">
            <div
              style={{
                boxSizing: "border-box", borderRadius: 10, padding: "4px 12px",
                border: `1px solid ${MOBILE_COLORS.border}`, background: MOBILE_COLORS.bg,
              }}
            >
              {projects.length === 0 ? (
                <p style={{ fontSize: 11, color: MOBILE_COLORS.textMuted, padding: "12px 0" }}>ما فيه مشاريع</p>
              ) : (
                projects.map((p) => (
                  <label key={p.id} className="flex items-center" style={{ gap: 9, minHeight: 44, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={allowed.has(p.id)}
                      onChange={(e) => setAllowed((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.add(p.id); else n.delete(p.id);
                        return n;
                      })}
                      style={{ width: 18, height: 18, accentColor: MOBILE_COLORS.gold }}
                    />
                    <span style={{ fontSize: "12.5px", color: MOBILE_COLORS.textPrimary }}>{p.name}</span>
                  </label>
                ))
              )}
            </div>
          </Field>

          <Field label="ملاحظات خاصة">
            <textarea name="staffNotes" rows={2} defaultValue={detail.staffNotes ?? ""} style={{ ...fieldStyle, minHeight: 66, padding: "10px 12px", lineHeight: 1.8 }} />
          </Field>

          {/* دعوة الإيميل لتعيين الـPIN — نفس شرط الديسكتوب */}
          {detail.email ? (
            <div style={{ boxSizing: "border-box", marginTop: 14, borderRadius: 12, padding: "12px 13px", border: `1px solid ${MOBILE_COLORS.border}`, background: MOBILE_COLORS.bg }}>
              <div className="flex items-center justify-between" style={{ gap: 10 }}>
                <span className="min-w-0">
                  <span className="block" style={{ fontSize: "12.5px", fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>دعوة تغيير الرمز</span>
                  <span className="block" style={{ fontSize: 11, color: MOBILE_COLORS.textMuted, marginTop: 3, lineHeight: 1.7 }}>
                    يُرسل رابط على إيميل الموظف لتعيين رمز الدخول.
                  </span>
                </span>
                <button
                  type="button"
                  onClick={sendInvite}
                  disabled={pending}
                  className="flex-none"
                  style={{
                    boxSizing: "border-box", minHeight: 44, padding: "0 14px", borderRadius: 10,
                    border: `1px solid ${MOBILE_COLORS.goldBorder}`, background: MOBILE_COLORS.goldBg,
                    color: MOBILE_COLORS.gold, fontSize: 12, fontWeight: 700, opacity: pending ? 0.6 : 1,
                  }}
                >
                  إرسال دعوة
                </button>
              </div>
              {inviteMsg && (
                <p style={{
                  boxSizing: "border-box", marginTop: 9, borderRadius: 9, padding: "8px 11px", fontSize: 11,
                  background: inviteMsg.ok ? MOBILE_STATUS.success.bg : MOBILE_STATUS.danger.bg,
                  color: inviteMsg.ok ? MOBILE_STATUS.success.fg : MOBILE_STATUS.danger.fg,
                }}>
                  {inviteMsg.text}
                </p>
              )}
              <p style={{ fontSize: 10.5, color: MOBILE_COLORS.dim1, marginTop: 8 }}>
                لو غيّرت الإيميل، احفظ أولًا ثم أرسل الدعوة.
              </p>
            </div>
          ) : (
            <p style={{
              boxSizing: "border-box", marginTop: 14, borderRadius: 12, padding: "11px 13px", fontSize: 11,
              border: `1px dashed ${MOBILE_COLORS.border}`, color: MOBILE_COLORS.textMuted, lineHeight: 1.7,
            }}>
              أضف إيميلًا واحفظ لتفعيل «إرسال دعوة» تغيير الرمز.
            </p>
          )}

          {/* الحساب مفعّل */}
          <div
            className="flex items-center justify-between"
            style={{
              boxSizing: "border-box", marginTop: 14, minHeight: 52, borderRadius: 12, padding: "0 13px",
              border: `1px solid ${MOBILE_COLORS.border}`, background: MOBILE_COLORS.bg,
            }}
          >
            <span style={{ fontSize: 13, color: MOBILE_COLORS.textPrimary }}>الحساب مفعّل</span>
            <button
              type="button"
              onClick={() => setActive((a) => !a)}
              aria-pressed={active}
              aria-label="الحساب مفعّل"
              style={{
                boxSizing: "border-box", width: 52, height: 31, borderRadius: 16, border: "none",
                padding: 3, display: "flex", cursor: "pointer",
                justifyContent: active ? "flex-start" : "flex-end",
                background: active ? MOBILE_COLORS.gold : MOBILE_COLORS.border,
              }}
            >
              <span style={{ width: 25, height: 25, borderRadius: 13, background: "#FFFFFF" }} />
            </button>
          </div>

          {error && (
            <p style={{
              boxSizing: "border-box", marginTop: 12, borderRadius: 10, padding: "10px 12px", fontSize: "12.5px",
              background: MOBILE_STATUS.danger.bg, color: MOBILE_STATUS.danger.fg,
              border: `1px solid ${MOBILE_STATUS.danger.border}`,
            }}>
              {error}
            </p>
          )}

        </form>
      )}
    </BottomSheet>
  );
}

const fieldStyle = {
  boxSizing: "border-box" as const, width: "100%", minHeight: 44,
  background: MOBILE_COLORS.bg, border: `1px solid ${MOBILE_COLORS.border}`,
  borderRadius: 10, padding: "0 12px", fontSize: 13,
  color: MOBILE_COLORS.textPrimary, outline: "none",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block" style={{ marginTop: 12 }}>
      <span className="block" style={{ fontSize: "12.5px", color: MOBILE_COLORS.textSecondary, marginBottom: 6 }}>{label}</span>
      {children}
    </label>
  );
}

export default MobileEmployeeSheet;
